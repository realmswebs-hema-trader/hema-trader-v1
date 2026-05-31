import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  Timestamp,
  getFirestore
} from 'firebase-admin/firestore';

initializeApp();

const db = getFirestore();
const ADMIN_EMAIL = 'realmswebs@gmail.com';
const CURRENCY = 'XAF';

const platformFee = { rate: 0.02, minimum: 500, maximum: 10000 };
const subscriptions = {
  free: 0,
  starter: 2500,
  pro: 7500,
  business: 20000
} as const;

const boosts = {
  oneDay: { amount: 500, hours: 24 },
  threeDays: { amount: 1000, hours: 72 },
  sevenDays: { amount: 2000, hours: 168 },
  homepage: { amount: 5000, hours: 168 }
} as const;

const verificationPrices = {
  seller: 2500,
  driver: 2000,
  business: 10000
} as const;

const withdrawalFee = { rate: 0.01, minimum: 200 };

const monthKey = () => new Date().toISOString().slice(0, 7);

const assertUser = (request: any) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  return request.auth;
};

const assertAdmin = (request: any) => {
  const email = request.auth?.token?.email;

  if (email !== ADMIN_EMAIL) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
};

const calculatePlatformFee = (amount: number) => {
  const fee = Math.round(amount * platformFee.rate);
  return Math.min(Math.max(fee, platformFee.minimum), platformFee.maximum);
};

const calculateWithdrawalFee = (amount: number) =>
  Math.max(Math.round(amount * withdrawalFee.rate), withdrawalFee.minimum);

const recordRevenue = async (
  tx: FirebaseFirestore.Transaction,
  data: Record<string, any>
) => {
  const revenueRef = db.collection('platformRevenue').doc();

  tx.set(revenueRef, {
    ...data,
    currency: CURRENCY,
    monthKey: monthKey(),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'server'
  });

  return revenueRef.id;
};

const debitWallet = async (
  tx: FirebaseFirestore.Transaction,
  userId: string,
  amount: number
) => {
  const walletRef = db.collection('wallets').doc(userId);
  const walletSnap = await tx.get(walletRef);
  const balance = Number(walletSnap.data()?.availableBalance || 0);

  if (balance < amount) {
    throw new HttpsError('failed-precondition', 'Insufficient wallet balance.');
  }

  tx.set(
    walletRef,
    {
      availableBalance: FieldValue.increment(-amount),
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
};

export const releaseTradeEscrowWithRevenue = onCall(async request => {
  const auth = assertUser(request);
  const { tradeId } = request.data || {};

  if (!tradeId) throw new HttpsError('invalid-argument', 'tradeId is required.');

  await db.runTransaction(async tx => {
    const tradeRef = db.collection('trades').doc(tradeId);
    const tradeSnap = await tx.get(tradeRef);

    if (!tradeSnap.exists) {
      throw new HttpsError('not-found', 'Trade not found.');
    }

    const trade = tradeSnap.data() || {};

    if (trade.buyerId !== auth.uid && request.auth?.token?.email !== ADMIN_EMAIL) {
      throw new HttpsError('permission-denied', 'Only buyer can release escrow.');
    }

    if (trade.status === 'completed') return;

    const amount = Number(trade.amount || trade.paymentAmount || 0);
    const fee = calculatePlatformFee(amount);
    const sellerPayout = Math.max(amount - fee, 0);

    tx.set(
      db.collection('wallets').doc(trade.sellerId),
      {
        availableBalance: FieldValue.increment(sellerPayout),
        totalEarned: FieldValue.increment(sellerPayout),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    const revenueId = await recordRevenue(tx, {
      category: 'trade_fee',
      source: 'trade',
      amount: fee,
      tradeId,
      buyerId: trade.buyerId,
      sellerId: trade.sellerId
    });

    tx.update(tradeRef, {
      status: 'completed',
      escrowStatus: 'released',
      platformFee: fee,
      sellerPayout,
      platformRevenueId: revenueId,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    tx.set(db.collection('transactions').doc(), {
      userId: trade.sellerId,
      direction: 'credit',
      type: 'seller_payout',
      amount: sellerPayout,
      currency: CURRENCY,
      tradeId,
      status: 'completed',
      createdAt: FieldValue.serverTimestamp()
    });
  });

  return { success: true };
});

export const settleDeliveryCommission = onCall(async request => {
  const auth = assertUser(request);
  const { tradeId, deliveryId, driverId, deliveryFee } = request.data || {};

  const fee = Number(deliveryFee || 0);
  if (!tradeId || !driverId || fee <= 0) {
    throw new HttpsError('invalid-argument', 'Delivery data is invalid.');
  }

  await db.runTransaction(async tx => {
    const platformCommission = Math.round(fee * 0.2);
    const driverPayout = Math.round(fee * 0.8);

    tx.set(
      db.collection('wallets').doc(driverId),
      {
        availableBalance: FieldValue.increment(driverPayout),
        totalEarned: FieldValue.increment(driverPayout),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    await recordRevenue(tx, {
      category: 'delivery_commission',
      source: 'delivery',
      amount: platformCommission,
      tradeId,
      deliveryId,
      driverId,
      buyerId: auth.uid
    });

    tx.set(db.collection('transactions').doc(), {
      userId: driverId,
      direction: 'credit',
      type: 'driver_delivery_earning',
      amount: driverPayout,
      currency: CURRENCY,
      tradeId,
      deliveryId,
      status: 'completed',
      createdAt: FieldValue.serverTimestamp()
    });
  });

  return { success: true };
});

export const purchaseSubscription = onCall(async request => {
  const auth = assertUser(request);
  const { plan, role } = request.data || {};

  if (!['starter', 'pro', 'business'].includes(plan)) {
    throw new HttpsError('invalid-argument', 'Invalid paid plan.');
  }

  const amount = subscriptions[plan as keyof typeof subscriptions];
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.runTransaction(async tx => {
    await debitWallet(tx, auth.uid, amount);

    const subRef = db.collection('subscriptions').doc();

    tx.set(subRef, {
      userId: auth.uid,
      plan,
      role: role || 'seller',
      status: 'active',
      amount,
      currency: CURRENCY,
      startedAt: now,
      expiresAt,
      paymentStatus: 'paid',
      createdAt: FieldValue.serverTimestamp()
    });

    tx.set(
      db.collection('users').doc(auth.uid),
      {
        subscription: {
          plan,
          role: role || 'seller',
          status: 'active',
          startedAt: now,
          expiresAt,
          paymentStatus: 'paid'
        },
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    await recordRevenue(tx, {
      category: 'subscription',
      source: 'subscription',
      amount,
      userId: auth.uid,
      subscriptionId: subRef.id
    });
  });

  return { success: true };
});

export const purchaseListingBoost = onCall(async request => {
  const auth = assertUser(request);
  const { listingId, boostType } = request.data || {};

  if (!listingId || !boosts[boostType as keyof typeof boosts]) {
    throw new HttpsError('invalid-argument', 'Invalid boost request.');
  }

  const boost = boosts[boostType as keyof typeof boosts];
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(Date.now() + boost.hours * 60 * 60 * 1000);

  await db.runTransaction(async tx => {
    const listingRef = db.collection('listings').doc(listingId);
    const listingSnap = await tx.get(listingRef);

    if (!listingSnap.exists) throw new HttpsError('not-found', 'Listing not found.');

    const listing = listingSnap.data() || {};

    if (listing.ownerId !== auth.uid && listing.sellerId !== auth.uid) {
      throw new HttpsError('permission-denied', 'Only listing owner can boost.');
    }

    await debitWallet(tx, auth.uid, boost.amount);

    const boostRef = db.collection('boosts').doc();

    tx.set(boostRef, {
      userId: auth.uid,
      listingId,
      boostType,
      amountPaid: boost.amount,
      currency: CURRENCY,
      startedAt: now,
      expiresAt,
      status: 'active',
      createdAt: FieldValue.serverTimestamp()
    });

    tx.update(listingRef, {
      boost: {
        isBoosted: true,
        boostType,
        startedAt: now,
        expiresAt,
        amountPaid: boost.amount
      },
      updatedAt: FieldValue.serverTimestamp()
    });

    await recordRevenue(tx, {
      category: 'listing_boost',
      source: 'boost',
      amount: boost.amount,
      userId: auth.uid,
      listingId,
      boostId: boostRef.id
    });
  });

  return { success: true };
});

export const requestVerification = onCall(async request => {
  const auth = assertUser(request);
  const { verificationType, notes } = request.data || {};

  if (!verificationPrices[verificationType as keyof typeof verificationPrices]) {
    throw new HttpsError('invalid-argument', 'Invalid verification type.');
  }

  const amount = verificationPrices[verificationType as keyof typeof verificationPrices];

  await db.runTransaction(async tx => {
    await debitWallet(tx, auth.uid, amount);

    const verificationRef = db.collection('verifications').doc();

    tx.set(verificationRef, {
      userId: auth.uid,
      verificationType,
      notes: notes || '',
      amountPaid: amount,
      currency: CURRENCY,
      status: 'pending',
      paymentStatus: 'paid',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    await recordRevenue(tx, {
      category: 'verification',
      source: 'verification',
      amount,
      userId: auth.uid,
      verificationId: verificationRef.id
    });
  });

  return { success: true };
});

export const reviewVerificationRequest = onCall(async request => {
  assertUser(request);
  assertAdmin(request);

  const { verificationId, decision } = request.data || {};

  if (!verificationId || !['approved', 'rejected'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'Invalid review decision.');
  }

  const verificationRef = db.collection('verifications').doc(verificationId);
  const verificationSnap = await verificationRef.get();

  if (!verificationSnap.exists) {
    throw new HttpsError('not-found', 'Verification request not found.');
  }

  const verification = verificationSnap.data() || {};
  const updates: Record<string, any> = {
    verificationStatus: decision === 'approved' ? 'verified' : 'unverified',
    updatedAt: FieldValue.serverTimestamp()
  };

  if (decision === 'approved') {
    if (verification.verificationType === 'seller') updates.sellerVerified = true;
    if (verification.verificationType === 'driver') updates.driverVerified = true;
    if (verification.verificationType === 'business') updates.businessVerified = true;
  }

  await Promise.all([
    verificationRef.update({
      status: decision,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: request.auth?.uid
    }),
    db.collection('users').doc(verification.userId).set(updates, { merge: true })
  ]);

  return { success: true };
});

export const requestPayout = onCall(async request => {
  const auth = assertUser(request);
  const { amount, phoneNumber } = request.data || {};
  const grossAmount = Number(amount || 0);

  if (grossAmount <= 0 || !phoneNumber) {
    throw new HttpsError('invalid-argument', 'Invalid payout request.');
  }

  const fee = calculateWithdrawalFee(grossAmount);
  const netAmount = grossAmount - fee;

  if (netAmount <= 0) {
    throw new HttpsError('failed-precondition', 'Withdrawal amount is too low.');
  }

  await db.runTransaction(async tx => {
    await debitWallet(tx, auth.uid, grossAmount);

    const payoutRef = db.collection('payouts').doc();

    tx.set(payoutRef, {
      userId: auth.uid,
      amount: grossAmount,
      withdrawalFee: fee,
      netAmount,
      phoneNumber,
      currency: CURRENCY,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    await recordRevenue(tx, {
      category: 'withdrawal_fee',
      source: 'withdrawal',
      amount: fee,
      userId: auth.uid,
      payoutId: payoutRef.id
    });
  });

  return { success: true };
});
