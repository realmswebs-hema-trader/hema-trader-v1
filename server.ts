import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';
import admin from 'firebase-admin';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
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

const ledgerRef = (id: string) =>
  db.collection('walletTransactions').doc(id);

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

const getCampayToken = async () => {
  if (CAMPAY_ACCESS_TOKEN) return CAMPAY_ACCESS_TOKEN;

  if (!CAMPAY_APP_USERNAME || !CAMPAY_APP_PASSWORD) {
    throw new Error('CamPay credentials are not configured.');
  }

  const response = await axios.post(`${campayBaseUrl}/token/`, {
    username: CAMPAY_APP_USERNAME,
    password: CAMPAY_APP_PASSWORD
  });

  const token = response.data?.token;

  if (!token) {
    throw new Error('CamPay token request failed.');
  }

  return token;
};

const campayRequest = async (
  method: 'get' | 'post',
  endpoint: string,
  data?: Record<string, unknown>
) => {
  const token = await getCampayToken();

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
    body: `Your Hema wallet was credited with ${topup.amount} ${topup.currency || DEFAULT_WALLET_CURRENCY}.`,
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
  '/api/wallet/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);

    await db.runTransaction(async tx => {
      await ensureWalletInTransaction(tx, userId);
    });

    const [walletSnap, txSnap, withdrawalsSnap] = await Promise.all([
      walletRef(userId).get(),
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
      transactions,
      withdrawals
    });
  })
);

app.post(
  '/api/wallet/topup/start',
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
  '/api/wallet/topup/verify',
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
    const tradeId = String(req.body.tradeId || '');

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

app.post(
  '/api/delivery/pay-from-wallet',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const tradeId = String(req.body.tradeId || '');

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
        throw new Error('Only the buyer can pay delivery escrow.');
      }

      if (!trade.driverId) {
        throw new Error('A driver must be selected first.');
      }

      if (trade.deliveryPaymentStatus === 'paid') {
        throw new Error('Delivery escrow is already paid.');
      }

      const amount = roundMoney(trade.deliveryFee);
      const currency = DEFAULT_WALLET_CURRENCY;

      if (amount <= 0) {
        throw new Error('Delivery fee has not been agreed yet.');
      }

      const buyerWallet = await ensureWalletInTransaction(tx, userId, currency);

      assertWalletIsUsable(buyerWallet);

      if (Number(buyerWallet.availableBalance || 0) < amount) {
        throw new Error('Insufficient Hema wallet balance.');
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
        deliveryBargainStatus: 'paid',
        deliveryPaymentProvider: 'hema_wallet',
        deliveryPaymentAmount: amount,
        deliveryPaymentCurrency: currency,
        deliveryPaidAt: now(),
        updatedAt: now()
      });

      writeLedger(tx, `delivery_escrow_hold_${tradeId}`, {
        userId,
        type: 'delivery_payment',
        amount,
        currency,
        direction: 'debit',
        status: 'held',
        tradeId,
        counterpartyId: trade.driverId
      });
    });

    const tradeSnap = await tradeRef.get();
    const trade = tradeSnap.data() || {};

    await Promise.all([
      sendNotification(trade.buyerId, {
        title: 'Delivery Escrow Funded',
        body: 'Delivery payment is locked until delivery is completed.',
        type: 'delivery',
        targetType: 'trade',
        targetId: tradeId,
        actionUrl: `/trade/${tradeId}`
      }),
      sendNotification(trade.driverId, {
        title: 'Delivery Payment Secured',
        body: 'The buyer has locked your delivery fee in escrow.',
        type: 'delivery',
        targetType: 'trade',
        targetId: tradeId,
        actionUrl: `/trade/${tradeId}`
      })
    ]);

    res.json({ ok: true, status: 'paid' });
  })
);

app.post(
  ['/api/trades/release-escrow', '/api/trades/finalize'],
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const tradeId = String(req.body.tradeId || '');

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
        sellerPayout,
        platformFee,
        completedAt: now(),
        updatedAt: now()
      });

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
  '/api/wallet/withdraw',
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getUserId(req);
    const amount = roundMoney(req.body.amount);
    const currency = req.body.currency || DEFAULT_WALLET_CURRENCY;
    const method = req.body.method || 'mobile_money';
    const phoneNumber = normalizeCameroonPhone(String(req.body.phoneNumber || ''));
    const accountName = String(req.body.accountName || '');
    const reference = uniqueReference(`withdraw_${userId}`);
    const withdrawalRef = db.collection('withdrawalRequests').doc();

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
          await completeFailedWithdrawal(withdrawalDoc.id, 'CamPay marked payout failed.');
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

    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: 'API route not found.' });
        return;
      }

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
}

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

setupVite();
