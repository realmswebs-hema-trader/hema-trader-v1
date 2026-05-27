import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { createRequire } from 'module';
import admin from 'firebase-admin';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { distanceBetween } from 'geofire-common';

dotenv.config();

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 3000);

const CAMPAY_BASE_URL =
  process.env.CAMPAY_BASE_URL ||
  'https://demo.campay.net/api/';

const CAMPAY_APP_USERNAME = process.env.CAMPAY_APP_USERNAME || '';
const CAMPAY_APP_PASSWORD = process.env.CAMPAY_APP_PASSWORD || '';
const CAMPAY_ACCESS_TOKEN = process.env.CAMPAY_ACCESS_TOKEN || '';
const CAMPAY_WEBHOOK_KEY = process.env.CAMPAY_WEBHOOK_KEY || '';

const DEFAULT_WALLET_CURRENCY =
  process.env.DEFAULT_WALLET_CURRENCY || 'XAF';

const PLATFORM_FEE_RATE = Number(process.env.PLATFORM_FEE_RATE || 0.02);
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;
const DELIVERY_PAYMENT_TIMEOUT_MS = 30 * 60 * 1000;
const INSUFFICIENT_DELIVERY_FUNDS_CODE = 'INSUFFICIENT_DELIVERY_FUNDS';
const INSUFFICIENT_DELIVERY_FUNDS_MESSAGE =
  'Your Hema Trader balance is not enough to hire this driver. Please fund your account to continue delivery.';
const DELIVERY_AUTO_CANCEL_MESSAGE =
  'Delivery payment was not completed within 30 minutes. The trade has been cancelled and the buyer has been refunded.';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs') as {
  hash: (data: string, saltOrRounds: number) => Promise<string>;
  compare: (data: string, encrypted: string) => Promise<boolean>;
};

type AuthRequest = express.Request & {
  user?: admin.auth.DecodedIdToken;
};

type RiskLevel = 'none' | 'low' | 'medium' | 'high';

const normalizeBaseUrl = (value: string) =>
  value.endsWith('/') ? value.slice(0, -1) : value;

const campayBaseUrl = normalizeBaseUrl(CAMPAY_BASE_URL);

const roundMoney = (value: unknown) => Math.round(Number(value || 0));

const now = () => FieldValue.serverTimestamp();

const uniqueReference = (prefix: string) =>
  `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

const normalizeCameroonPhone = (value: string) => {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.startsWith('237')) return digits;
  if (digits.length === 9 && digits.startsWith('6')) return `237${digits}`;

  return digits;
};

const maskPhone = (value: unknown) => {
  const digits = String(value || '');
  if (digits.length < 6) return digits;
  return `${digits.slice(0, 5)}****${digits.slice(-2)}`;
};

const getCampayErrorMessage = (payload: any) => {
  if (!payload) return '';

  if (typeof payload === 'string') return payload;
  if (payload.error) return String(payload.error);
  if (payload.message) return String(payload.message);
  if (payload.detail) return String(payload.detail);
  if (payload.status) return String(payload.status);

  if (Array.isArray(payload.non_field_errors)) {
    return payload.non_field_errors.join(' ');
  }

  const fieldMessages = Object.entries(payload)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join(' ')}`;
      if (typeof value === 'string') return `${key}: ${value}`;
      return '';
    })
    .filter(Boolean)
    .join(' ');

  return fieldMessages || JSON.stringify(payload);
};

const initializeFirebaseAdmin = () => {
  if (admin.apps.length > 0) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson))
    });
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      })
    });
    return;
  }

  admin.initializeApp();
};

initializeFirebaseAdmin();

const firestoreDatabaseId =
  process.env.FIRESTORE_DATABASE_ID ||
  process.env.VITE_FIRESTORE_DATABASE_ID ||
  '';

const db = firestoreDatabaseId
  ? getFirestore(admin.app(), firestoreDatabaseId)
  : getFirestore();

const asyncRoute =
  (
    handler: (
      req: AuthRequest,
      res: express.Response,
      next: express.NextFunction
    ) => Promise<void>
  ) =>
  (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
    handler(req, res, next).catch(next);
  };

const requireAuth = asyncRoute(async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : '';

  if (!token) {
    res.status(401).json({ error: 'Missing Firebase auth token.' });
    return;
  }

  req.user = await admin.auth().verifyIdToken(token);
  next();
});

const getUserId = (req: AuthRequest) => {
  if (!req.user?.uid) throw new Error('Unauthenticated request.');
  return req.user.uid;
};

const walletRef = (userId: string) => db.collection('wallets').doc(userId);

const walletSecurityRef = (userId: string) =>
  db.collection('walletSecurity').doc(userId);

const ledgerRef = (id: string) =>
  db.collection('walletTransactions').doc(id);

const assertValidPinFormat = (pin: string) => {
  if (!/^\d{4}$|^\d{6}$/.test(pin)) {
    throw new Error('Wallet PIN must be 4 or 6 digits.');
  }
};

const verifyWalletPinOrThrow = async (userId: string, pin: string) => {
  assertValidPinFormat(pin);

  const ref = walletSecurityRef(userId);
  const snap = await ref.get();
  const data = snap.data() || {};

  if (!snap.exists || !data.pinHash) {
    throw new Error('Create your Hema Wallet PIN first.');
  }

  const lockedUntil = data.lockedUntil?.toMillis?.() || 0;

  if (lockedUntil > Date.now()) {
    throw new Error('Wallet PIN is temporarily locked. Try again later.');
  }

  const isValid = await bcrypt.compare(pin, data.pinHash);

  if (!isValid) {
    const failedAttempts = Number(data.failedAttempts || 0) + 1;

    await ref.set(
      {
        failedAttempts,
        lockedUntil:
          failedAttempts >= MAX_PIN_ATTEMPTS
            ? Timestamp.fromDate(
                new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000)
              )
            : null,
        updatedAt: now()
      },
      { merge: true }
    );

    throw new Error('Incorrect Wallet PIN.');
  }

  await ref.set(
    {
      failedAttempts: 0,
      lockedUntil: null,
      lastVerifiedAt: now(),
      updatedAt: now()
    },
    { merge: true }
  );
};

const ensureWalletInTransaction = async (
  tx: FirebaseFirestore.Transaction,
  userId: string,
  currency = DEFAULT_WALLET_CURRENCY
) => {
  const ref = walletRef(userId);
  const snap = await tx.get(ref);

  if (!snap.exists) {
    tx.set(ref, {
      userId,
      availableBalance: 0,
      escrowBalance: 0,
      pendingWithdrawalBalance: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      currency,
      frozen: false,
      riskScore: 0,
      createdAt: now(),
      updatedAt: now()
    });

    return {
      userId,
      availableBalance: 0,
      escrowBalance: 0,
      pendingWithdrawalBalance: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      currency,
      frozen: false,
      riskScore: 0
    };
  }

  return snap.data() || {};
};

const writeLedger = (
  tx: FirebaseFirestore.Transaction,
  id: string,
  data: Record<string, unknown>
) => {
  tx.set(
    ledgerRef(id),
    {
      ...data,
      createdAt: now(),
      updatedAt: now()
    },
    { merge: true }
  );
};

const sendNotification = async (
  userId: string,
  data: Record<string, unknown>
) => {
  if (!userId) return;

  await db.collection('notifications').add({
    userId,
    recipientId: userId,
    read: false,
    status: 'unread',
    createdAt: now(),
    updatedAt: now(),
    ...data
  });
};

const assertWalletIsUsable = (wallet: any) => {
  if (wallet?.frozen) {
    throw new Error('Wallet is frozen. Contact support.');
  }
};

const timestampToMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value._seconds === 'number') return value._seconds * 1000;

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const deliveryPaymentDeadline = () =>
  Timestamp.fromDate(new Date(Date.now() + DELIVERY_PAYMENT_TIMEOUT_MS));

const getDeliveryFeeAmount = (trade: any) =>
  roundMoney(trade.agreedDeliveryFee || trade.deliveryFee || trade.deliveryPaymentAmount);

const getTradeCurrency = (trade: any) =>
  trade.paymentCurrency ||
  trade.currencyCode ||
  trade.currency ||
  DEFAULT_WALLET_CURRENCY;

const isAdminUser = async (userId: string, email?: string) => {
  if (email === 'realmswebs@gmail.com') return true;

  const [adminSnap, userSnap] = await Promise.all([
    db.collection('admins').doc(userId).get(),
    db.collection('users').doc(userId).get()
  ]);

  const userData = userSnap.data() || {};

  return (
    adminSnap.exists ||
    userData.isAdmin === true ||
    userData.roles?.includes?.('admin')
  );
};

const refundProductEscrowForTrade = async (
  tradeId: string,
  reason = 'delivery_payment_not_funded'
) => {
  const tradeRef = db.collection('trades').doc(tradeId);
  let summary: any = null;

  await db.runTransaction(async tx => {
    const tradeSnap = await tx.get(tradeRef);

    if (!tradeSnap.exists) throw new Error('Trade not found.');

    const trade = tradeSnap.data() || {};

    if (trade.refundProcessed === true) {
      summary = {
        tradeId,
        cancelled: trade.status === 'cancelled',
        refundProcessed: true,
        alreadyRefunded: true,
        buyerId: trade.buyerId,
        sellerId: trade.sellerId,
        driverId: trade.driverId || trade.assignedDriverId || '',
        listingId: trade.listingId || ''
      };
      return;
    }

    const productWasFunded =
      trade.paymentStatus === 'wallet_escrowed' ||
      trade.escrowStatus === 'funded' ||
      trade.status === 'funded' ||
      trade.status === 'shipped';

    if (!productWasFunded) {
      throw new Error('Product payment has not been funded, so no refund is due.');
    }

    if (trade.status === 'completed') {
      throw new Error('Completed trades cannot be automatically refunded.');
    }

    const amount = roundMoney(trade.paymentAmount || trade.amount);
    const currency = getTradeCurrency(trade);

    if (amount <= 0) {
      throw new Error('Refund amount is invalid.');
    }

    const listingRef = trade.listingId
      ? db.collection('listings').doc(trade.listingId)
      : null;
    const listingSnap = listingRef ? await tx.get(listingRef) : null;
    const listing = listingSnap?.data() || {};
    const isSingleListing =
      trade.listingInventoryType === 'single' ||
      listing.inventoryType === 'single';

    const buyerWallet = await ensureWalletInTransaction(tx, trade.buyerId, currency);

    if (Number(buyerWallet.escrowBalance || 0) < amount) {
      throw new Error('Buyer escrow balance is lower than the refund amount.');
    }

    tx.set(
      walletRef(trade.buyerId),
      {
        escrowBalance: FieldValue.increment(-amount),
        availableBalance: FieldValue.increment(amount),
        updatedAt: now()
      },
      { merge: true }
    );

    tx.update(tradeRef, {
      status: 'cancelled',
      escrowStatus: 'refunded',
      paymentStatus: 'refunded',
      deliveryRequestStatus: 'cancelled',
      deliveryStatus: 'cancelled',
      deliveryNegotiationStatus: 'cancelled',
      deliveryBargainStatus: 'cancelled',
      autoCancelReason: reason,
      cancellationReason: DELIVERY_AUTO_CANCEL_MESSAGE,
      refundProcessed: true,
      refundProcessedAt: now(),
      cancelledAt: now(),
      updatedAt: now()
    });

    writeLedger(tx, `product_refund_${tradeId}`, {
      userId: trade.buyerId,
      tradeId,
      listingId: trade.listingId || '',
      type: 'product_refund',
      amount,
      currency,
      direction: 'credit',
      status: 'completed',
      reason
    });

    if (listingRef && listingSnap?.exists && isSingleListing) {
      if (listing.activeTradeId === tradeId && listing.listingStatus !== 'sold') {
        tx.set(
          listingRef,
          {
            status: 'active',
            stockStatus: 'in_stock',
            listingStatus: 'available',
            activeTradeId: null,
            reservedAt: null,
            updatedAt: now()
          },
          { merge: true }
        );
      }
    }

    summary = {
      tradeId,
      cancelled: true,
      refundProcessed: true,
      amount,
      currency,
      buyerId: trade.buyerId,
      sellerId: trade.sellerId,
      driverId: trade.driverId || trade.assignedDriverId || '',
      listingId: trade.listingId || ''
    };
  });

  return summary;
};

const notifyAutoCancellation = async (summary: any) => {
  if (!summary?.buyerId) return;

  await Promise.all([
    sendNotification(summary.buyerId, {
      title: 'Trade Cancelled',
      body: DELIVERY_AUTO_CANCEL_MESSAGE,
      type: 'trade_update',
      targetType: 'trade',
      targetId: summary.tradeId,
      actionUrl: `/trade/${summary.tradeId}`
    }),
    sendNotification(summary.sellerId, {
      title: 'Trade Cancelled',
      body: 'Delivery payment was not funded on time. The buyer has been refunded and the item is available again if eligible.',
      type: 'trade_update',
      targetType: 'trade',
      targetId: summary.tradeId,
      actionUrl: `/trade/${summary.tradeId}`
    }),
    summary.driverId
      ? sendNotification(summary.driverId, {
          title: 'Delivery Cancelled',
          body: 'The delivery was cancelled because the buyer did not fund delivery on time.',
          type: 'delivery',
          targetType: 'trade',
          targetId: summary.tradeId,
          actionUrl: `/trade/${summary.tradeId}`
        })
      : Promise.resolve()
  ]);
};

const getCampayToken = async () => {
  if (CAMPAY_APP_USERNAME && CAMPAY_APP_PASSWORD) {
    try {
      const response = await axios.post(`${campayBaseUrl}/token/`, {
        username: CAMPAY_APP_USERNAME,
        password: CAMPAY_APP_PASSWORD
      });

      const token = response.data?.token;

      if (!token) {
        throw new Error('CamPay token response did not include a token.');
      }

      return token;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const message = getCampayErrorMessage(err.response?.data);

        console.error('CamPay token error:', {
          status: err.response?.status,
          response: err.response?.data
        });

        if (!CAMPAY_ACCESS_TOKEN) {
          throw new Error(
            message ||
              `CamPay token request failed with status ${err.response?.status || 'unknown'}.`
          );
        }
      } else if (!CAMPAY_ACCESS_TOKEN) {
        throw err;
      }
    }
  }

  if (CAMPAY_ACCESS_TOKEN) return CAMPAY_ACCESS_TOKEN;

  throw new Error('CamPay credentials are not configured.');
};

const campayRequest = async (
  method: 'get' | 'post',
  endpoint: string,
  data?: Record<string, unknown>
) => {
  const token = await getCampayToken();

  try {
    const response = await axios.request({
      method,
      url: `${campayBaseUrl}${endpoint}`,
      data,
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    return response.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const payload = err.response?.data;
      const message = getCampayErrorMessage(payload);

      console.error('CamPay API error:', {
        status: err.response?.status,
        endpoint,
        method,
        data: data
          ? {
              ...data,
              from: maskPhone(data.from),
              to: maskPhone(data.to)
            }
          : undefined,
        response: payload
      });

      throw new Error(
        message ||
          `CamPay request failed with status ${err.response?.status || 'unknown'}.`
      );
    }

    throw err;
  }
};

const campayCollect = async ({
  amount,
  phoneNumber,
  description,
  externalReference
}: {
  amount: number;
  phoneNumber: string;
  description: string;
  externalReference: string;
}) =>
  campayRequest('post', '/collect/', {
    amount: String(amount),
    currency: DEFAULT_WALLET_CURRENCY,
    from: normalizeCameroonPhone(phoneNumber),
    description,
    external_reference: externalReference
  });

const campayGetTransaction = async (reference: string) =>
  campayRequest('get', `/transaction/${reference}/`);

const campayDisburse = async ({
  amount,
  phoneNumber,
  description,
  externalReference
}: {
  amount: number;
  phoneNumber: string;
  description: string;
  externalReference: string;
}) =>
  campayRequest('post', '/withdraw/', {
    amount: String(amount),
    currency: DEFAULT_WALLET_CURRENCY,
    to: normalizeCameroonPhone(phoneNumber),
    description,
    external_reference: externalReference
  });

const calculateUserRisk = async (
  userId: string
): Promise<{ level: RiskLevel; flags: string[] }> => {
  const userSnap = await db.collection('users').doc(userId).get();

  if (!userSnap.exists) return { level: 'none', flags: [] };

  const data = userSnap.data() || {};
  const flags: string[] = [];
  let score = 0;

  const createdAtMillis = data.createdAt?.toMillis?.() || Date.now();
  const ageInHours = (Date.now() - createdAtMillis) / 3600000;

  if (ageInHours < 24) {
    flags.push('New Account');
    score += 30;
  }

  if ((data.warningCount || 0) > 0) {
    flags.push(`${data.warningCount} Warnings`);
    score += data.warningCount * 20;
  }

  if (data.reliabilityScore !== undefined && data.reliabilityScore < 70) {
    flags.push('Low Reliability');
    score += 40;
  }

  const level: RiskLevel =
    score >= 80 ? 'high' : score >= 40 ? 'medium' : score >= 10 ? 'low' : 'none';

  return { level, flags };
};

const completeWalletTopup = async (reference: string) => {
  const status = await campayGetTransaction(reference);
  const externalReference = status?.external_reference;

  if (!externalReference) {
    return { status: status?.status || 'UNKNOWN', credited: false };
  }

  const topupRef = db.collection('walletTopups').doc(externalReference);
  const topupSnap = await topupRef.get();

  if (!topupSnap.exists) {
    return { status: status?.status || 'UNKNOWN', credited: false };
  }

  const topup = topupSnap.data() || {};
  const paymentStatus = String(status?.status || '').toUpperCase();

  if (paymentStatus === 'PENDING') {
    return { status: 'PENDING', credited: false };
  }

  if (paymentStatus !== 'SUCCESSFUL') {
    await topupRef.set(
      {
        status: 'failed',
        providerStatus: paymentStatus,
        providerPayload: status,
        updatedAt: now()
      },
      { merge: true }
    );

    return { status: paymentStatus, credited: false };
  }

  await db.runTransaction(async tx => {
    const freshTopup = await tx.get(topupRef);
    const freshData = freshTopup.data() || {};

    if (freshData.status === 'completed') return;

    if (Number(status.amount || 0) < Number(freshData.amount || 0)) {
      throw new Error('CamPay amount is lower than expected.');
    }

    const wallet = await ensureWalletInTransaction(
      tx,
      freshData.userId,
      freshData.currency || DEFAULT_WALLET_CURRENCY
    );

    assertWalletIsUsable(wallet);

    tx.set(
      walletRef(freshData.userId),
      {
        availableBalance: FieldValue.increment(freshData.amount),
        currency: freshData.currency || DEFAULT_WALLET_CURRENCY,
        updatedAt: now()
      },
      { merge: true }
    );

    tx.set(
      topupRef,
      {
        status: 'completed',
        providerStatus: paymentStatus,
        providerReference: reference,
        providerPayload: status,
        completedAt: now(),
        updatedAt: now()
      },
      { merge: true }
    );

    writeLedger(tx, `wallet_topup_${externalReference}`, {
      userId: freshData.userId,
      type: 'wallet_topup',
      amount: freshData.amount,
      currency: freshData.currency || DEFAULT_WALLET_CURRENCY,
      direction: 'credit',
      status: 'completed',
      provider: 'campay',
      providerReference: reference,
      txRef: externalReference
    });
  });

  await sendNotification(topup.userId, {
    title: 'Wallet Funded',
    body: `Your Hema wallet was credited with ${topup.amount} ${
      topup.currency || DEFAULT_WALLET_CURRENCY
    }.`,
    type: 'wallet',
    targetType: 'wallet',
    actionUrl: '/wallet'
  });

  return { status: 'SUCCESSFUL', credited: true };
};

const completeFailedWithdrawal = async (
  withdrawalId: string,
  reason: string
) => {
  const withdrawalRef = db.collection('withdrawalRequests').doc(withdrawalId);

  await db.runTransaction(async tx => {
    const snap = await tx.get(withdrawalRef);

    if (!snap.exists) return;

    const data = snap.data() || {};

    if (['completed', 'failed'].includes(data.status)) return;

    tx.set(
      withdrawalRef,
      {
        status: 'failed',
        failureReason: reason,
        updatedAt: now()
      },
      { merge: true }
    );

    tx.set(
      walletRef(data.userId),
      {
        availableBalance: FieldValue.increment(data.amount),
        pendingWithdrawalBalance: FieldValue.increment(-data.amount),
        updatedAt: now()
      },
      { merge: true }
    );

    writeLedger(tx, `withdrawal_failed_${withdrawalId}`, {
      userId: data.userId,
      type: 'refund',
      amount: data.amount,
      currency: data.currency,
      direction: 'credit',
      status: 'completed',
      withdrawalId,
      providerReference: data.providerReference || ''
    });
  });
};

const completeSuccessfulWithdrawal = async (
  withdrawalId: string,
  providerPayload: any
) => {
  const withdrawalRef = db.collection('withdrawalRequests').doc(withdrawalId);
  const providerReference = String(
    providerPayload?.reference ||
      providerPayload?.operator_reference ||
      ''
  );

  await db.runTransaction(async tx => {
    const snap = await tx.get(withdrawalRef);

    if (!snap.exists) return;

    const data = snap.data() || {};

    if (data.status === 'completed') return;

    tx.set(
      withdrawalRef,
      {
        status: 'completed',
        providerStatus: 'SUCCESSFUL',
        providerPayload,
        completedAt: now(),
        updatedAt: now()
      },
      { merge: true }
    );

    tx.set(
      walletRef(data.userId),
      {
        pendingWithdrawalBalance: FieldValue.increment(-data.amount),
        totalWithdrawn: FieldValue.increment(data.amount),
        updatedAt: now()
      },
      { merge: true }
    );

    writeLedger(tx, `withdrawal_completed_${withdrawalId}`, {
      userId: data.userId,
      type: 'withdrawal',
      amount: data.amount,
      currency: data.currency,
      direction: 'debit',
      status: 'completed',
      withdrawalId,
      providerReference
    });
  });
};

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Hema Trader Wallet + Escrow Engine',
    provider: 'campay',
    walletApi: true,
    bcryptReady: typeof bcrypt.hash === 'function',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get(
  '/api/drivers/nearby',
  asyncRoute(async (req, res) => {
    const { lat, lng, radiusKm = 10 } = req.query;

    if (!lat || !lng) {
      res.status(400).json({ error: 'Center coordinates required' });
      return;
    }

    const center: [number, number] = [Number(lat), Number(lng)];

    const snap = await db
      .collection('users')
      .where('roles', 'array-contains', 'driver')
      .where('verificationStatus', '==', 'verified')
      .limit(100)
      .get();

    const drivers = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(driver => {
        const latitude =
          driver.currentLocation?.latitude ||
          driver.latitude ||
          driver.location?.lat;

        const longitude =
          driver.currentLocation?.longitude ||
          driver.longitude ||
          driver.location?.lng;

        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
          return false;
        }

        const distance = distanceBetween([latitude, longitude], center);
        return distance <= Number(radiusKm);
      })
      .sort((a, b) => (b.reliabilityScore || 0) - (a.reliabilityScore || 0));

    res.json(drivers);
  })
);

app.get(
  ['/api/wallet/me', '/api/wallet/me/'],
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);

    await db.runTransaction(async tx => {
      await ensureWalletInTransaction(tx, userId);
    });

    const [walletSnap, securitySnap, txSnap, withdrawalsSnap] = await Promise.all([
      walletRef(userId).get(),
      walletSecurityRef(userId).get(),
      db
        .collection('walletTransactions')
        .where('userId', '==', userId)
        .limit(50)
        .get(),
      db
        .collection('withdrawalRequests')
        .where('userId', '==', userId)
        .limit(20)
        .get()
    ]);

    const security = securitySnap.data() || {};

    const transactions = txSnap.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a: any, b: any) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });

    const withdrawals = withdrawalsSnap.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a: any, b: any) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });

    res.json({
      wallet: walletSnap.data(),
      walletSecurity: {
        hasPin: Boolean(security.pinHash),
        failedAttempts: Number(security.failedAttempts || 0),
        lockedUntil: security.lockedUntil || null
      },
      transactions,
      withdrawals
    });
  })
);

app.get(
  ['/api/wallet/security', '/api/wallet/security/'],
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const securitySnap = await walletSecurityRef(userId).get();
    const security = securitySnap.data() || {};

    res.json({
      hasPin: Boolean(security.pinHash),
      failedAttempts: Number(security.failedAttempts || 0),
      lockedUntil: security.lockedUntil || null
    });
  })
);

app.post(
  ['/api/wallet/create-pin', '/api/wallet/pin/set'],
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const pin = String(req.body.pin || '');
    const confirmPin = String(req.body.confirmPin || '');

    if (pin !== confirmPin) {
      res.status(400).json({ error: 'PIN confirmation does not match.' });
      return;
    }

    assertValidPinFormat(pin);

    const walletSnap = await walletRef(userId).get();
    const wallet = walletSnap.data() || {};
    const hasFundedAccount =
      Number(wallet.availableBalance || 0) > 0 ||
      Number(wallet.escrowBalance || 0) > 0 ||
      Number(wallet.pendingWithdrawalBalance || 0) > 0 ||
      Number(wallet.totalEarned || 0) > 0;

    if (!hasFundedAccount) {
      res.status(400).json({
        error: 'Fund your Hema account before creating a transaction PIN.'
      });
      return;
    }

    const pinHash = await bcrypt.hash(pin, 12);

    await walletSecurityRef(userId).set(
      {
        userId,
        pinHash,
        hasPin: true,
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: now(),
        updatedAt: now()
      },
      { merge: true }
    );

    await sendNotification(userId, {
      title: 'Wallet PIN Created',
      body: 'Your Hema Wallet transaction PIN is now active.',
      type: 'wallet',
      targetType: 'wallet',
      actionUrl: '/wallet'
    });

    res.json({ ok: true });
  })
);

app.post(
  '/api/wallet/verify-pin',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const walletPin = String(req.body.walletPin || req.body.pin || '');

    await verifyWalletPinOrThrow(userId, walletPin);

    res.json({ ok: true });
  })
);

app.post(
  ['/api/wallet/topup/start', '/api/campay/topup'],
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const amount = roundMoney(req.body.amount);
    const phoneNumber = normalizeCameroonPhone(String(req.body.phoneNumber || ''));
    const currency = req.body.currency || DEFAULT_WALLET_CURRENCY;

    if (amount <= 0) {
      res.status(400).json({ error: 'Enter a valid top-up amount.' });
      return;
    }

    if (!phoneNumber || phoneNumber.length < 12) {
      res.status(400).json({
        error: 'Enter a valid MTN or Orange Money number, including Cameroon code.'
      });
      return;
    }

    const txRef = uniqueReference(`wallet_topup_${userId}`);

    await db.collection('walletTopups').doc(txRef).set({
      userId,
      amount,
      currency,
      phoneNumber,
      txRef,
      status: 'pending',
      provider: 'campay',
      createdAt: now(),
      updatedAt: now()
    });

    const providerResponse = await campayCollect({
      amount,
      phoneNumber,
      description: 'Hema Trader wallet top-up',
      externalReference: txRef
    });

    await db.collection('walletTopups').doc(txRef).set(
      {
        providerReference: providerResponse?.reference || '',
        providerStatus: providerResponse?.status || 'PENDING',
        providerResponse,
        updatedAt: now()
      },
      { merge: true }
    );

    res.json({
      ok: true,
      txRef,
      amount,
      currency,
      providerReference: providerResponse?.reference || '',
      ussdCode: providerResponse?.ussd_code || '',
      operator: providerResponse?.operator || '',
      status: providerResponse?.status || 'PENDING',
      providerResponse
    });
  })
);

app.post(
  ['/api/wallet/topup/verify', '/api/campay/verify'],
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const txRef = String(req.body.txRef || '');
    const providerReference = String(req.body.providerReference || '');

    if (!txRef && !providerReference) {
      res.status(400).json({ error: 'Missing top-up reference.' });
      return;
    }

    let topupSnap: FirebaseFirestore.DocumentSnapshot | null = null;

    if (txRef) {
      topupSnap = await db.collection('walletTopups').doc(txRef).get();
    }

    if ((!topupSnap || !topupSnap.exists) && providerReference) {
      const snap = await db
        .collection('walletTopups')
        .where('providerReference', '==', providerReference)
        .limit(1)
        .get();

      topupSnap = snap.docs[0] || null;
    }

    if (!topupSnap || !topupSnap.exists) {
      res.status(404).json({ error: 'Top-up request not found.' });
      return;
    }

    const topup = topupSnap.data() || {};

    if (topup.userId !== userId) {
      res.status(403).json({ error: 'This top-up does not belong to you.' });
      return;
    }

    const reference = providerReference || topup.providerReference;

    if (!reference) {
      res.status(400).json({ error: 'CamPay reference is not ready yet.' });
      return;
    }

    const result = await completeWalletTopup(reference);

    res.json({
      ok: true,
      ...result
    });
  })
);

app.post(
  '/api/trades/pay-from-wallet',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const walletPin = String(req.body.walletPin || '');
    const tradeId = String(req.body.tradeId || '');

    await verifyWalletPinOrThrow(userId, walletPin);

    if (!tradeId) {
      res.status(400).json({ error: 'Missing tradeId.' });
      return;
    }

    const tradeRef = db.collection('trades').doc(tradeId);

    await db.runTransaction(async tx => {
      const tradeSnap = await tx.get(tradeRef);

      if (!tradeSnap.exists) throw new Error('Trade not found.');

      const trade = tradeSnap.data() || {};

      if (trade.buyerId !== userId) {
        throw new Error('Only the buyer can fund escrow.');
      }

      if (trade.status !== 'pending') {
        throw new Error('Only pending trades can be funded.');
      }

      const amount = roundMoney(trade.amount);
      const currency = trade.currencyCode || trade.currency || DEFAULT_WALLET_CURRENCY;
      const buyerWallet = await ensureWalletInTransaction(tx, userId, currency);

      assertWalletIsUsable(buyerWallet);

      if (Number(buyerWallet.availableBalance || 0) < amount) {
        throw new Error('Insufficient Hema wallet balance.');
      }

      const buyerRisk = await calculateUserRisk(userId);

      tx.set(
        walletRef(userId),
        {
          availableBalance: FieldValue.increment(-amount),
          escrowBalance: FieldValue.increment(amount),
          updatedAt: now()
        },
        { merge: true }
      );

      tx.update(tradeRef, {
        status: buyerRisk.level === 'high' ? 'disputed' : 'funded',
        escrowStatus: buyerRisk.level === 'high' ? 'reviewing' : 'funded',
        paymentStatus: 'wallet_escrowed',
        productPaymentStatus: 'paid',
        paymentProvider: 'hema_wallet',
        paymentAmount: amount,
        paymentCurrency: currency,
        riskLevel: buyerRisk.level,
        riskFlags: buyerRisk.flags,
        fundedAt: now(),
        updatedAt: now()
      });

      writeLedger(tx, `escrow_hold_${tradeId}`, {
        userId,
        type: 'escrow_hold',
        amount,
        currency,
        direction: 'debit',
        status: 'held',
        tradeId,
        listingId: trade.listingId,
        counterpartyId: trade.sellerId
      });
    });

    const tradeSnap = await tradeRef.get();
    const trade = tradeSnap.data() || {};

    await Promise.all([
      sendNotification(trade.buyerId, {
        title: 'Escrow Funded',
        body: 'Your payment is now locked in Hema escrow.',
        type: 'wallet',
        targetType: 'trade',
        targetId: tradeId,
        actionUrl: `/trade/${tradeId}`
      }),
      sendNotification(trade.sellerId, {
        title: 'Buyer Funded Escrow',
        body: 'The buyer has locked payment in escrow. Prepare the item.',
        type: 'trade_update',
        targetType: 'trade',
        targetId: tradeId,
        actionUrl: `/trade/${tradeId}`
      })
    ]);

    res.json({ ok: true, status: trade.status || 'funded' });
  })
);

app.get(
  '/api/delivery/validate-wallet',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const tradeId = String(req.query.tradeId || req.body?.tradeId || '');

    if (!tradeId) {
      res.status(400).json({ error: 'Missing tradeId.' });
      return;
    }

    const tradeRef = db.collection('trades').doc(tradeId);
    let result: any = null;

    await db.runTransaction(async tx => {
      const tradeSnap = await tx.get(tradeRef);

      if (!tradeSnap.exists) throw new Error('Trade not found.');

      const trade = tradeSnap.data() || {};

      if (trade.buyerId !== userId) {
        throw new Error('Only the buyer can validate delivery payment.');
      }

      if (!trade.driverId && !trade.assignedDriverId) {
        throw new Error('A driver must be selected first.');
      }

      if (trade.paymentStatus !== 'wallet_escrowed') {
        throw new Error('Product payment must be completed before delivery can be paid.');
      }

      const amount = getDeliveryFeeAmount(trade);

      if (amount <= 0 || !trade.deliveryFeeAgreed) {
        throw new Error('Delivery fee has not been agreed yet.');
      }

      const currency = getTradeCurrency(trade);
      const wallet = await ensureWalletInTransaction(tx, userId, currency);

      assertWalletIsUsable(wallet);

      const availableBalance = Number(wallet.availableBalance || 0);
      const canPay =
        trade.deliveryPaymentStatus === 'paid' ||
        availableBalance >= amount;
      const existingDeadline = trade.deliveryPaymentDeadlineAt || null;
      const deadline = existingDeadline || deliveryPaymentDeadline();

      if (!canPay) {
        tx.update(tradeRef, {
          deliveryPaymentStatus: 'pending_funding',
          deliveryPaymentRequiredAt: trade.deliveryPaymentRequiredAt || now(),
          deliveryPaymentDeadlineAt: deadline,
          autoCancelReason: 'delivery_payment_not_funded',
          updatedAt: now()
        });
      }

      result = {
        canPay,
        availableBalance,
        requiredAmount: amount,
        shortfall: Math.max(amount - availableBalance, 0),
        currency,
        message: canPay ? '' : INSUFFICIENT_DELIVERY_FUNDS_MESSAGE,
        deliveryPaymentRequiredAt: trade.deliveryPaymentRequiredAt || null,
        deliveryPaymentDeadlineAt: deadline
      };
    });

    res.json(result);
  })
);

app.post(
  '/api/delivery/pay-from-wallet',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const walletPin = String(req.body.walletPin || '');
    const tradeId = String(req.body.tradeId || '');
    const requestDeliveryRequestId = String(req.body.deliveryRequestId || '');

    await verifyWalletPinOrThrow(userId, walletPin);

    if (!tradeId) {
      res.status(400).json({ error: 'Missing tradeId.' });
      return;
    }

    const tradeRef = db.collection('trades').doc(tradeId);
    let paymentResult: any = null;

    await db.runTransaction(async tx => {
      const tradeSnap = await tx.get(tradeRef);

      if (!tradeSnap.exists) throw new Error('Trade not found.');

      const trade = tradeSnap.data() || {};

      if (trade.buyerId !== userId) {
        throw new Error('Only the buyer can pay delivery escrow.');
      }

      if (!trade.driverId && !trade.assignedDriverId) {
        throw new Error('A driver must be selected first.');
      }

      if (trade.paymentStatus !== 'wallet_escrowed') {
        throw new Error('Product payment must be completed before delivery can be paid.');
      }

      if (trade.deliveryPaymentStatus === 'paid') {
        paymentResult = {
          ok: true,
          alreadyPaid: true,
          status: 'paid',
          tradeId,
          deliveryRequestId: trade.deliveryRequestId || requestDeliveryRequestId || '',
          agreedFee: getDeliveryFeeAmount(trade)
        };
        return;
      }

      const amount = getDeliveryFeeAmount(trade);
      const currency = getTradeCurrency(trade);
      const driverId = trade.driverId || trade.assignedDriverId;

      if (amount <= 0 || !trade.deliveryFeeAgreed) {
        throw new Error('Delivery fee has not been agreed yet.');
      }

      const buyerWallet = await ensureWalletInTransaction(tx, userId, currency);

      assertWalletIsUsable(buyerWallet);

      const availableBalance = Number(buyerWallet.availableBalance || 0);

      if (availableBalance < amount) {
        const deadline = trade.deliveryPaymentDeadlineAt || deliveryPaymentDeadline();

        tx.update(tradeRef, {
          deliveryPaymentStatus: 'pending_funding',
          deliveryPaymentRequiredAt: trade.deliveryPaymentRequiredAt || now(),
          deliveryPaymentDeadlineAt: deadline,
          autoCancelReason: 'delivery_payment_not_funded',
          updatedAt: now()
        });

        paymentResult = {
          ok: false,
          code: INSUFFICIENT_DELIVERY_FUNDS_CODE,
          message: INSUFFICIENT_DELIVERY_FUNDS_MESSAGE,
          availableBalance,
          requiredAmount: amount,
          shortfall: amount - availableBalance,
          currency,
          deliveryPaymentDeadlineAt: deadline
        };
        return;
      }

      tx.set(
        walletRef(userId),
        {
          availableBalance: FieldValue.increment(-amount),
          escrowBalance: FieldValue.increment(amount),
          updatedAt: now()
        },
        { merge: true }
      );

      tx.update(tradeRef, {
        deliveryPaymentStatus: 'paid',
        deliveryNegotiationStatus: 'delivery_fee_paid',
        deliveryBargainStatus: 'delivery_fee_paid',
        deliveryStatus: 'delivery_fee_paid',
        deliveryPaymentProvider: 'hema_wallet',
        deliveryPaymentAmount: amount,
        deliveryFeePaid: amount,
        deliveryPaymentCurrency: currency,
        deliveryFeePaidAt: now(),
        deliveryPaidAt: now(),
        assignedDriverId: driverId,
        updatedAt: now()
      });

      const deliveryRequestId = trade.deliveryRequestId || requestDeliveryRequestId;

      if (deliveryRequestId) {
        tx.set(
          db.collection('deliveryRequests').doc(deliveryRequestId),
          {
            status: 'delivery_fee_paid',
            agreedFee: amount,
            deliveryFeePaidAt: now(),
            updatedAt: now()
          },
          { merge: true }
        );
      }

      writeLedger(tx, `delivery_escrow_hold_${tradeId}`, {
        userId,
        type: 'delivery_payment',
        amount,
        currency,
        direction: 'debit',
        status: 'held',
        tradeId,
        deliveryRequestId: deliveryRequestId || '',
        counterpartyId: driverId
      });

      paymentResult = {
        ok: true,
        status: 'paid',
        tradeId,
        deliveryRequestId: deliveryRequestId || '',
        agreedFee: amount,
        deliveryFeePaid: amount,
        walletTransactionId: `delivery_escrow_hold_${tradeId}`
      };
    });

    if (!paymentResult?.ok) {
      const tradeSnap = await tradeRef.get();
      const trade = tradeSnap.data() || {};

      await sendNotification(trade.buyerId || userId, {
        title: 'Fund Account Required',
        body: INSUFFICIENT_DELIVERY_FUNDS_MESSAGE,
        type: 'wallet',
        targetType: 'trade',
        targetId: tradeId,
        actionUrl: '/wallet'
      });

      res.status(402).json(paymentResult);
      return;
    }

    if (!paymentResult.alreadyPaid) {
      const tradeSnap = await tradeRef.get();
      const trade = tradeSnap.data() || {};

      await Promise.all([
        sendNotification(trade.buyerId, {
          title: 'Delivery Fee Paid',
          body: 'Delivery payment is locked until delivery is completed.',
          type: 'delivery',
          targetType: 'trade',
          targetId: tradeId,
          actionUrl: `/trade/${tradeId}`
        }),
        sendNotification(trade.driverId || trade.assignedDriverId, {
          title: 'Delivery Payment Secured',
          body: 'The buyer has locked your delivery fee in escrow. You can now start pickup.',
          type: 'delivery',
          targetType: 'trade',
          targetId: tradeId,
          actionUrl: `/trade/${tradeId}`
        })
      ]);
    }

    res.json(paymentResult);
  })
);

app.post(
  '/api/trades/auto-cancel-unfunded-delivery',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const tradeId = String(req.body.tradeId || '');

    if (!tradeId) {
      res.status(400).json({ error: 'Missing tradeId.' });
      return;
    }

    const tradeSnap = await db.collection('trades').doc(tradeId).get();

    if (!tradeSnap.exists) {
      res.status(404).json({ error: 'Trade not found.' });
      return;
    }

    const trade = tradeSnap.data() || {};
    const isParticipant =
      trade.buyerId === userId ||
      trade.sellerId === userId ||
      trade.driverId === userId ||
      trade.assignedDriverId === userId;

    if (!isParticipant && !(await isAdminUser(userId, req.user?.email))) {
      res.status(403).json({ error: 'You cannot cancel this trade.' });
      return;
    }

    if (trade.deliveryPaymentStatus === 'paid') {
      res.status(400).json({ error: 'Delivery payment has already been completed.' });
      return;
    }

    if (trade.deliveryPaymentStatus !== 'pending_funding') {
      res.status(400).json({ error: 'This trade is not waiting for delivery funding.' });
      return;
    }

    const deadlineMillis = timestampToMillis(trade.deliveryPaymentDeadlineAt);

    if (!deadlineMillis || deadlineMillis > Date.now()) {
      res.status(400).json({ error: 'Delivery payment deadline has not expired yet.' });
      return;
    }

    const summary = await refundProductEscrowForTrade(
      tradeId,
      'delivery_payment_not_funded'
    );

    await notifyAutoCancellation(summary);

    res.json({
      ok: true,
      ...summary,
      message: DELIVERY_AUTO_CANCEL_MESSAGE
    });
  })
);

app.post(
  '/api/trades/refund-product-payment',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const tradeId = String(req.body.tradeId || '');
    const reason = String(req.body.reason || 'manual_product_refund');

    if (!tradeId) {
      res.status(400).json({ error: 'Missing tradeId.' });
      return;
    }

    const tradeSnap = await db.collection('trades').doc(tradeId).get();

    if (!tradeSnap.exists) {
      res.status(404).json({ error: 'Trade not found.' });
      return;
    }

    const trade = tradeSnap.data() || {};
    const isAdmin = await isAdminUser(userId, req.user?.email);

    if (!isAdmin && trade.status !== 'cancelled') {
      res.status(403).json({
        error: 'Only admins can refund an active funded trade.'
      });
      return;
    }

    const summary = await refundProductEscrowForTrade(tradeId, reason);

    await sendNotification(summary.buyerId, {
      title: 'Buyer Refunded',
      body: 'Your product payment has been returned to your Hema Trader wallet.',
      type: 'wallet',
      targetType: 'trade',
      targetId: tradeId,
      actionUrl: '/wallet'
    });

    res.json({
      ok: true,
      ...summary
    });
  })
);

app.post(
  ['/api/trades/release-escrow', '/api/trades/finalize'],
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const walletPin = String(req.body.walletPin || '');
    const tradeId = String(req.body.tradeId || '');

    await verifyWalletPinOrThrow(userId, walletPin);

    if (!tradeId) {
      res.status(400).json({ error: 'Missing tradeId.' });
      return;
    }

    const tradeRef = db.collection('trades').doc(tradeId);
    let releaseSummary: any = null;

    await db.runTransaction(async tx => {
      const tradeSnap = await tx.get(tradeRef);

      if (!tradeSnap.exists) throw new Error('Trade not found.');

      const trade = tradeSnap.data() || {};

      if (trade.buyerId !== userId) {
        throw new Error('Only the buyer can confirm escrow release.');
      }

      if (trade.status === 'completed') {
        releaseSummary = { alreadyCompleted: true };
        return;
      }

      if (trade.paymentStatus !== 'wallet_escrowed') {
        throw new Error('Trade escrow was not funded from Hema wallet.');
      }

      const amount = roundMoney(trade.paymentAmount || trade.amount);
      const currency =
        trade.paymentCurrency ||
        trade.currencyCode ||
        trade.currency ||
        DEFAULT_WALLET_CURRENCY;

      const deliveryAmount =
        trade.driverId && trade.deliveryPaymentStatus === 'paid'
          ? roundMoney(trade.deliveryPaymentAmount || trade.deliveryFee)
          : 0;

      const totalHeld = amount + deliveryAmount;
      const singleListingRef = trade.listingId
        ? db.collection('listings').doc(trade.listingId)
        : null;
      const singleListingSnap = singleListingRef ? await tx.get(singleListingRef) : null;
      const singleListing = singleListingSnap?.data() || {};
      const isSingleListing =
        trade.listingInventoryType === 'single' ||
        singleListing.inventoryType === 'single';

      const buyerWallet = await ensureWalletInTransaction(tx, trade.buyerId, currency);

      if (Number(buyerWallet.escrowBalance || 0) < totalHeld) {
        throw new Error('Buyer escrow balance is lower than expected.');
      }

      const platformFee = roundMoney(amount * PLATFORM_FEE_RATE);
      const sellerPayout = amount - platformFee;

      await ensureWalletInTransaction(tx, trade.sellerId, currency);
      await ensureWalletInTransaction(tx, 'platform', currency);

      tx.set(
        walletRef(trade.buyerId),
        {
          escrowBalance: FieldValue.increment(-totalHeld),
          updatedAt: now()
        },
        { merge: true }
      );

      tx.set(
        walletRef(trade.sellerId),
        {
          availableBalance: FieldValue.increment(sellerPayout),
          totalEarned: FieldValue.increment(sellerPayout),
          updatedAt: now()
        },
        { merge: true }
      );

      tx.set(
        walletRef('platform'),
        {
          availableBalance: FieldValue.increment(platformFee),
          totalEarned: FieldValue.increment(platformFee),
          updatedAt: now()
        },
        { merge: true }
      );

      writeLedger(tx, `escrow_release_seller_${tradeId}`, {
        userId: trade.sellerId,
        type: 'escrow_release',
        amount: sellerPayout,
        currency,
        direction: 'credit',
        status: 'completed',
        tradeId,
        listingId: trade.listingId,
        counterpartyId: trade.buyerId
      });

      writeLedger(tx, `platform_fee_${tradeId}`, {
        userId: 'platform',
        type: 'platform_fee',
        amount: platformFee,
        currency,
        direction: 'credit',
        status: 'completed',
        tradeId,
        listingId: trade.listingId,
        counterpartyId: trade.sellerId
      });

      if (trade.driverId && deliveryAmount > 0) {
        await ensureWalletInTransaction(tx, trade.driverId, DEFAULT_WALLET_CURRENCY);

        tx.set(
          walletRef(trade.driverId),
          {
            availableBalance: FieldValue.increment(deliveryAmount),
            totalEarned: FieldValue.increment(deliveryAmount),
            updatedAt: now()
          },
          { merge: true }
        );

        writeLedger(tx, `delivery_escrow_release_${tradeId}`, {
          userId: trade.driverId,
          type: 'delivery_escrow_release',
          amount: deliveryAmount,
          currency: DEFAULT_WALLET_CURRENCY,
          direction: 'credit',
          status: 'completed',
          tradeId,
          counterpartyId: trade.buyerId
        });
      }

      tx.update(tradeRef, {
        status: 'completed',
        escrowStatus: 'released',
        paymentStatus: 'released',
        deliveryNegotiationStatus: trade.driverId
          ? 'completed'
          : trade.deliveryNegotiationStatus || null,
        deliveryStatus: trade.driverId ? 'completed' : trade.deliveryStatus || null,
        sellerPayout,
        platformFee,
        completedAt: now(),
        updatedAt: now()
      });

      if (singleListingRef && singleListingSnap?.exists && isSingleListing) {
        tx.set(
          singleListingRef,
          {
            status: 'sold',
            stockStatus: 'sold',
            listingStatus: 'sold',
            activeTradeId: null,
            soldAt: now(),
            soldByTradeId: tradeId,
            updatedAt: now()
          },
          { merge: true }
        );
      }

      releaseSummary = {
        sellerPayout,
        platformFee,
        deliveryAmount,
        currency
      };
    });

    const tradeSnap = await tradeRef.get();
    const trade = tradeSnap.data() || {};

    await Promise.all([
      sendNotification(trade.sellerId, {
        title: 'Escrow Released',
        body: 'Your funds are now available in your Hema wallet.',
        type: 'wallet',
        targetType: 'wallet',
        targetId: tradeId,
        actionUrl: '/wallet'
      }),
      trade.driverId
        ? sendNotification(trade.driverId, {
            title: 'Delivery Earnings Released',
            body: 'Your delivery fee is now available in your Hema wallet.',
            type: 'wallet',
            targetType: 'wallet',
            targetId: tradeId,
            actionUrl: '/wallet'
          })
        : Promise.resolve()
    ]);

    res.json({
      ok: true,
      status: 'released',
      releaseSummary
    });
  })
);

app.post(
  ['/api/wallet/withdraw', '/api/campay/withdraw'],
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const walletPin = String(req.body.walletPin || '');
    const amount = roundMoney(req.body.amount);
    const currency = req.body.currency || DEFAULT_WALLET_CURRENCY;
    const method = req.body.method || 'mobile_money';
    const phoneNumber = normalizeCameroonPhone(String(req.body.phoneNumber || ''));
    const accountName = String(req.body.accountName || '');
    const reference = uniqueReference(`withdraw_${userId}`);
    const withdrawalRef = db.collection('withdrawalRequests').doc();

    await verifyWalletPinOrThrow(userId, walletPin);

    if (amount <= 0) {
      res.status(400).json({ error: 'Enter a valid withdrawal amount.' });
      return;
    }

    if (method !== 'bank' && (!phoneNumber || phoneNumber.length < 12)) {
      res.status(400).json({
        error: 'Enter a valid MTN or Orange Money withdrawal number.'
      });
      return;
    }

    await db.runTransaction(async tx => {
      const wallet = await ensureWalletInTransaction(tx, userId, currency);

      assertWalletIsUsable(wallet);

      if (Number(wallet.availableBalance || 0) < amount) {
        throw new Error('Insufficient wallet balance.');
      }

      tx.set(
        walletRef(userId),
        {
          availableBalance: FieldValue.increment(-amount),
          pendingWithdrawalBalance: FieldValue.increment(amount),
          updatedAt: now()
        },
        { merge: true }
      );

      tx.set(withdrawalRef, {
        userId,
        amount,
        currency,
        method,
        phoneNumber,
        accountName,
        reference,
        status: method === 'bank' ? 'pending_manual_bank_payout' : 'processing',
        provider: method === 'bank' ? 'manual_bank' : 'campay',
        createdAt: now(),
        updatedAt: now()
      });

      writeLedger(tx, `withdrawal_pending_${withdrawalRef.id}`, {
        userId,
        type: 'withdrawal',
        amount,
        currency,
        direction: 'debit',
        status: method === 'bank' ? 'pending_manual_bank_payout' : 'processing',
        withdrawalId: withdrawalRef.id,
        providerReference: reference
      });
    });

    if (method === 'bank') {
      await sendNotification(userId, {
        title: 'Bank Withdrawal Requested',
        body: 'Your bank withdrawal is pending finance review.',
        type: 'wallet',
        targetType: 'wallet',
        actionUrl: '/wallet'
      });

      res.json({
        ok: true,
        status: 'pending_manual_bank_payout',
        withdrawalId: withdrawalRef.id
      });
      return;
    }

    try {
      const providerResponse = await campayDisburse({
        amount,
        phoneNumber,
        description: 'Hema Trader wallet withdrawal',
        externalReference: reference
      });

      const providerStatus = String(providerResponse?.status || 'PENDING').toUpperCase();

      await withdrawalRef.set(
        {
          providerReference: providerResponse?.reference || '',
          providerStatus,
          providerResponse,
          updatedAt: now()
        },
        { merge: true }
      );

      if (providerStatus === 'SUCCESSFUL') {
        await completeSuccessfulWithdrawal(withdrawalRef.id, providerResponse);
      }

      if (providerStatus === 'FAILED') {
        await completeFailedWithdrawal(withdrawalRef.id, 'CamPay marked payout failed.');
      }

      await sendNotification(userId, {
        title:
          providerStatus === 'SUCCESSFUL'
            ? 'Withdrawal Completed'
            : 'Withdrawal Processing',
        body:
          providerStatus === 'SUCCESSFUL'
            ? 'Your withdrawal has been paid.'
            : 'Your withdrawal is being processed.',
        type: 'wallet',
        targetType: 'wallet',
        actionUrl: '/wallet'
      });

      res.json({
        ok: true,
        status: providerStatus === 'SUCCESSFUL' ? 'completed' : 'processing',
        withdrawalId: withdrawalRef.id,
        providerResponse
      });
    } catch (err) {
      await completeFailedWithdrawal(
        withdrawalRef.id,
        err instanceof Error ? err.message : 'CamPay withdrawal failed.'
      );

      res.status(400).json({
        error: err instanceof Error ? err.message : 'Withdrawal failed.'
      });
    }
  })
);

app.all(
  '/api/campay/webhook',
  asyncRoute(async (req, res) => {
    const payload = {
      ...req.query,
      ...(typeof req.body === 'object' && req.body ? req.body : {})
    } as Record<string, any>;

    const providedKey =
      payload.webhook_key ||
      payload.app_webhook_key ||
      payload.key ||
      payload.secret ||
      payload.hash;

    if (CAMPAY_WEBHOOK_KEY && providedKey && providedKey !== CAMPAY_WEBHOOK_KEY) {
      res.status(401).json({ error: 'Invalid CamPay webhook key.' });
      return;
    }

    const reference =
      payload.reference ||
      payload.transaction_reference ||
      payload.transaction_id ||
      payload.ref;

    const externalReference =
      payload.external_reference ||
      payload.externalReference ||
      payload.txRef;

    let handled = false;

    if (reference) {
      const topupSnap = await db
        .collection('walletTopups')
        .where('providerReference', '==', String(reference))
        .limit(1)
        .get();

      if (!topupSnap.empty) {
        await completeWalletTopup(String(reference));
        handled = true;
      }

      const withdrawalSnap = await db
        .collection('withdrawalRequests')
        .where('providerReference', '==', String(reference))
        .limit(1)
        .get();

      const withdrawalDoc = withdrawalSnap.docs[0];

      if (withdrawalDoc) {
        const providerStatus = await campayGetTransaction(String(reference));
        const status = String(providerStatus?.status || '').toUpperCase();

        if (status === 'SUCCESSFUL') {
          await completeSuccessfulWithdrawal(withdrawalDoc.id, providerStatus);
        }

        if (status === 'FAILED') {
          await completeFailedWithdrawal(withdrawDoc.id, 'CamPay marked payout failed.');
        }

        handled = true;
      }
    }

    if (!handled && externalReference) {
      const topupDoc = await db
        .collection('walletTopups')
        .doc(String(externalReference))
        .get();

      const topup = topupDoc.data();

      if (topup?.providerReference) {
        await completeWalletTopup(topup.providerReference);
        handled = true;
      }

      const withdrawalSnap = await db
        .collection('withdrawalRequests')
        .where('reference', '==', String(externalReference))
        .limit(1)
        .get();

      const withdrawalDoc = withdrawalSnap.docs[0];

      if (withdrawalDoc) {
        const withdrawal = withdrawalDoc.data();

        if (withdrawal.providerReference) {
          const providerStatus = await campayGetTransaction(withdrawal.providerReference);
          const status = String(providerStatus?.status || '').toUpperCase();

          if (status === 'SUCCESSFUL') {
            await completeSuccessfulWithdrawal(withdrawalDoc.id, providerStatus);
          }

          if (status === 'FAILED') {
            await completeFailedWithdrawal(withdrawalDoc.id, 'CamPay marked payout failed.');
          }
        }

        handled = true;
      }
    }

    res.json({ ok: true, handled });
  })
);

app.post('/api/payments/verify', (_req, res) => {
  res.status(410).json({
    error:
      'Flutterwave payments are disabled. Use Hema Wallet funding and wallet escrow instead.'
  });
});

app.get(
  '/api/admin/finance/overview',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data() || {};

    const isAdmin =
      userData.isAdmin === true ||
      userData.roles?.includes?.('admin') ||
      req.user?.email === 'realmswebs@gmail.com';

    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required.' });
      return;
    }

    const [walletsSnap, withdrawalsSnap, txSnap] = await Promise.all([
      db.collection('wallets').limit(300).get(),
      db
        .collection('withdrawalRequests')
        .where('status', 'in', [
          'pending',
          'processing',
          'pending_manual_bank_payout'
        ])
        .limit(100)
        .get(),
      db.collection('walletTransactions').limit(300).get()
    ]);

    const wallets = walletsSnap.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    const pendingWithdrawals = withdrawalsSnap.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    const transactions = txSnap.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    const totals = wallets.reduce(
      (acc: any, wallet: any) => {
        acc.availableBalance += Number(wallet.availableBalance || 0);
        acc.escrowBalance += Number(wallet.escrowBalance || 0);
        acc.pendingWithdrawalBalance += Number(wallet.pendingWithdrawalBalance || 0);
        acc.totalEarned += Number(wallet.totalEarned || 0);
        acc.totalWithdrawn += Number(wallet.totalWithdrawn || 0);
        return acc;
      },
      {
        availableBalance: 0,
        escrowBalance: 0,
        pendingWithdrawalBalance: 0,
        totalEarned: 0,
        totalWithdrawn: 0
      }
    );

    res.json({
      totals,
      wallets,
      pendingWithdrawals,
      transactions
    });
  })
);

app.use('/api', (_req, res) => {
  res.status(404).json({
    error:
      'API route not found. Confirm the latest server.ts is deployed on Render.'
  });
});

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Server error:', err);

    res.status(400).json({
      error: err instanceof Error ? err.message : 'Server request failed.'
    });
  }
);

async function setupVite() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const assetsPath = path.join(distPath, 'assets');

    app.use(
      '/assets',
      express.static(assetsPath, {
        maxAge: '1y',
        immutable: true
      })
    );

    app.use(
      express.static(distPath, {
        etag: false,
        lastModified: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader(
              'Cache-Control',
              'no-store, no-cache, must-revalidate, proxy-revalidate'
            );
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
          }
        }
      })
    );

    app.get('*', (_req, res) => {
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hema Trader wallet server running at http://0.0.0.0:${PORT}`);
  });

  setInterval(async () => {
    try {
      const snap = await db
        .collection('notifications')
        .where('status', '==', 'pending')
        .limit(10)
        .get();

      await Promise.all(
        snap.docs.map(docSnap =>
          db.collection('notifications').doc(docSnap.id).set(
            {
              status: 'sent',
              updatedAt: now()
            },
            { merge: true }
          )
        )
      );
    } catch (err) {
      console.error('Notification queue error:', err);
    }
  }, 10000);

  setInterval(async () => {
    try {
      const snap = await db
        .collection('trades')
        .where('deliveryPaymentStatus', '==', 'pending_funding')
        .limit(50)
        .get();

      const expiredTrades = snap.docs.filter(docSnap => {
        const trade = docSnap.data() || {};
        const deadlineMillis = timestampToMillis(trade.deliveryPaymentDeadlineAt);
        return deadlineMillis > 0 && deadlineMillis <= Date.now();
      });

      await Promise.all(
        expiredTrades.map(async docSnap => {
          try {
            const summary = await refundProductEscrowForTrade(
              docSnap.id,
              'delivery_payment_not_funded'
            );

            if (summary?.refundProcessed) {
              await notifyAutoCancellation(summary);
            }
          } catch (err) {
            console.error(`Auto-cancel failed for trade ${docSnap.id}:`, err);
          }
        })
      );
    } catch (err) {
      console.error('Delivery payment auto-cancel worker error:', err);
    }
  }, 60000);
}

setupVite();
