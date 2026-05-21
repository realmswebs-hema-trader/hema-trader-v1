import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore';

import { db } from '../lib/firebase';

export type TrustLevel =
  | 'HIGH RISK'
  | 'LOW TRUST'
  | 'STANDARD'
  | 'TRUSTED'
  | 'ELITE'
  | 'VERIFIED ELITE';

export type TrustEventType =
  | 'trade_completed'
  | 'delivery_completed'
  | 'positive_review'
  | 'negative_review'
  | 'escrow_success'
  | 'dispute_opened'
  | 'report_received'
  | 'profile_completed'
  | 'verification_completed'
  | 'manual_reward'
  | 'manual_penalty';

interface TrustAdjustmentOptions {
  amount: number;
  reason: string;
  eventType?: TrustEventType;
  metadata?: Record<string, any>;
  metricUpdates?: Record<string, any>;
}

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const removeUndefined = (data: Record<string, any>) =>
  Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));

export const getTrustLevel = (score: number): TrustLevel => {
  if (score <= 20) return 'HIGH RISK';
  if (score <= 40) return 'LOW TRUST';
  if (score <= 60) return 'STANDARD';
  if (score <= 80) return 'TRUSTED';
  if (score <= 95) return 'ELITE';
  return 'VERIFIED ELITE';
};

export const getTrustVisibilityMultiplier = (score: number) => {
  if (score >= 96) return 2;
  if (score >= 81) return 1.65;
  if (score >= 61) return 1.25;
  if (score >= 41) return 1;
  if (score >= 21) return 0.55;
  return 0.2;
};

export const getTrustBadges = (profile: any) => {
  const score = safeNumber(profile?.trustScore, 50);
  const badges: string[] = [];

  if (profile?.identityVerified || profile?.verificationStatus === 'verified') {
    badges.push('Verified');
  }

  if (score >= 61) badges.push('Trusted');
  if (score >= 81) badges.push('Elite Trader');
  if (profile?.roles?.includes?.('driver') && score >= 81) badges.push('Elite Driver');
  if (safeNumber(profile?.responseRate) >= 90) badges.push('Fast Responder');
  if (safeNumber(profile?.averageRating) >= 4.7) badges.push('Top Rated');

  const lastActiveAt = getMillis(profile?.lastActiveAt);
  if (lastActiveAt && Date.now() - lastActiveAt < 24 * 60 * 60 * 1000) {
    badges.push('Active Trader');
  }

  return badges;
};

export const calculateProfileCompletion = (profile: any) => {
  const fields = [
    profile?.photoURL,
    profile?.bannerURL,
    profile?.displayName || profile?.name,
    profile?.username,
    profile?.bio,
    profile?.location || profile?.city,
    profile?.phoneNumber,
    profile?.businessCategory || profile?.businessDescription
  ];

  const completed = fields.filter(Boolean).length;
  return Math.round((completed / fields.length) * 100);
};

export const calculateTrustScore = (profile: any) => {
  const baseScore = 50;

  const identityBonus =
    profile?.identityVerified || profile?.verificationStatus === 'verified' ? 8 : 0;
  const phoneBonus = profile?.phoneVerified ? 3 : 0;
  const emailBonus = profile?.emailVerified !== false ? 2 : 0;
  const governmentIdBonus = profile?.governmentIdVerified ? 5 : 0;

  const successfulTrades = safeNumber(profile?.successfulTrades ?? profile?.completedTrades ?? profile?.totalTrades);
  const failedTrades = safeNumber(profile?.failedTrades);
  const cancelledTransactions = safeNumber(profile?.cancelledTransactions);
  const completedDeliveries = safeNumber(profile?.completedDeliveries ?? profile?.deliveriesCount);
  const failedDeliveries = safeNumber(profile?.failedDeliveries);
  const disputes = safeNumber(profile?.disputeCount);
  const warnings = safeNumber(profile?.warningCount);
  const reportCount = safeNumber(profile?.reportCount);
  const fraudReportCount = safeNumber(profile?.fraudReportCount);

  const escrowSuccessRate = safeNumber(profile?.escrowSuccessRate, successfulTrades ? 90 : 0);
  const deliveryCompletionRate = safeNumber(
    profile?.deliveryCompletionRate ?? profile?.deliverySuccessRate,
    completedDeliveries ? 90 : 0
  );
  const responseRate = safeNumber(profile?.responseRate, 0);
  const averageRating = safeNumber(profile?.averageRating || profile?.avgDriverRating);
  const repeatCustomers = safeNumber(profile?.repeatCustomers);
  const followersCount = safeNumber(profile?.followersCount);
  const profileCompletion = safeNumber(profile?.profileCompletion, calculateProfileCompletion(profile));
  const manualAdjustment = safeNumber(profile?.trustAdjustment);

  const memberSince = getMillis(profile?.memberSince || profile?.createdAt);
  const accountAgeDays = memberSince
    ? Math.max(Math.floor((Date.now() - memberSince) / 86400000), 1)
    : 1;

  const lastActiveAt = getMillis(profile?.lastActiveAt);
  const daysInactive = lastActiveAt
    ? Math.floor((Date.now() - lastActiveAt) / 86400000)
    : 30;

  const tradeBonus = clamp(successfulTrades * 1.2, 0, 14);
  const deliveryBonus = clamp(completedDeliveries * 0.8, 0, 10);
  const escrowBonus = escrowSuccessRate >= 95 ? 8 : escrowSuccessRate >= 80 ? 5 : escrowSuccessRate >= 60 ? 2 : -8;
  const deliveryRateBonus = deliveryCompletionRate >= 95 ? 6 : deliveryCompletionRate >= 80 ? 3 : deliveryCompletionRate >= 60 ? 1 : -7;
  const ratingBonus = averageRating >= 4.8 ? 12 : averageRating >= 4.4 ? 9 : averageRating >= 4 ? 5 : averageRating >= 3 ? 0 : -12;
  const responseBonus = responseRate >= 95 ? 6 : responseRate >= 80 ? 4 : responseRate >= 50 ? 1 : -5;
  const repeatCustomerBonus = clamp(repeatCustomers * 1.5, 0, 6);
  const profileBonus = profileCompletion >= 90 ? 7 : profileCompletion >= 70 ? 4 : profileCompletion >= 45 ? 1 : -4;
  const ageBonus = accountAgeDays >= 365 ? 6 : accountAgeDays >= 180 ? 4 : accountAgeDays >= 30 ? 2 : 0;
  const followerBonus = clamp(followersCount / 20, 0, 5);
  const activityPenalty = daysInactive > 60 ? -8 : daysInactive > 30 ? -4 : daysInactive > 14 ? -2 : 3;

  const failedTradePenalty = clamp(failedTrades * 4, 0, 18);
  const cancellationPenalty = clamp(cancelledTransactions * 3, 0, 18);
  const failedDeliveryPenalty = clamp(failedDeliveries * 4, 0, 16);
  const disputePenalty = clamp(disputes * 7, 0, 25);
  const reportPenalty = clamp(reportCount * 4 + fraudReportCount * 8, 0, 35);
  const warningPenalty = clamp(warnings * 6, 0, 24);

  const rawScore =
    baseScore +
    identityBonus +
    phoneBonus +
    emailBonus +
    governmentIdBonus +
    tradeBonus +
    deliveryBonus +
    escrowBonus +
    deliveryRateBonus +
    ratingBonus +
    responseBonus +
    repeatCustomerBonus +
    profileBonus +
    ageBonus +
    followerBonus +
    activityPenalty +
    manualAdjustment -
    failedTradePenalty -
    cancellationPenalty -
    failedDeliveryPenalty -
    disputePenalty -
    reportPenalty -
    warningPenalty;

  return Math.round(clamp(rawScore));
};

export const updateUserTrustMetrics = async (
  userId: string,
  metricOverrides: Record<string, any> = {}
) => {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    throw new Error('User not found.');
  }

  const profile = userSnap.data();

  const [reviewsSnap, reportsSnap] = await Promise.all([
    getDocs(query(collection(db, 'reviews'), where('reviewedUserId', '==', userId))),
    getDocs(query(collection(db, 'reports'), where('targetId', '==', userId)))
  ]);

  const reviews = reviewsSnap.docs
    .map(reviewDoc => reviewDoc.data())
    .filter(review => review.status !== 'removed');

  const reports = reportsSnap.docs
    .map(reportDoc => reportDoc.data())
    .filter(report => report.status !== 'dismissed');

  const averageRating = reviews.length
    ? Number(average(reviews.map(review => safeNumber(review.rating))).toFixed(2))
    : safeNumber(profile.averageRating);

  const fraudReportCount = reports.filter(report =>
    ['fraud', 'scam', 'fake_products', 'fake_review'].includes(report.reason)
  ).length;

  const mergedProfile = {
    ...profile,
    ...metricOverrides,
    averageRating,
    reportCount: reports.length,
    fraudReportCount,
    profileCompletion: calculateProfileCompletion(profile),
    identityVerified:
      profile.identityVerified ||
      profile.verificationStatus === 'verified' ||
      Boolean(profile.governmentIdVerified)
  };

  const previousScore = safeNumber(profile.trustScore, 50);
  const trustScore = calculateTrustScore(mergedProfile);
  const trustLevel = getTrustLevel(trustScore);
  const visibilityMultiplier = getTrustVisibilityMultiplier(trustScore);

  const riskStatus =
    trustScore <= 20
      ? 'high_risk'
      : trustScore <= 40
        ? 'restricted'
        : fraudReportCount >= 3
          ? 'fraud_review'
          : 'clear';

  const instantTransactionsEnabled = trustScore >= 41 && fraudReportCount < 3;
  const premiumVisibility = trustScore >= 81;

  const updates = removeUndefined({
    trustScore,
    trustLevel,
    trustBadges: getTrustBadges({ ...mergedProfile, trustScore }),
    trustVisibilityMultiplier: visibilityMultiplier,
    marketplaceVisibility: visibilityMultiplier,
    premiumVisibility,
    instantTransactionsEnabled,
    accountRiskStatus: riskStatus,
    fraudProtectionStatus: riskStatus === 'clear' ? 'protected' : 'under_review',
    searchRankBoost: visibilityMultiplier,
    averageRating,
    reportCount: reports.length,
    fraudReportCount,
    profileCompletion: calculateProfileCompletion(profile),
    identityVerified: mergedProfile.identityVerified,
    phoneVerified: Boolean(profile.phoneVerified),
    emailVerified: profile.emailVerified !== false,
    governmentIdVerified: Boolean(profile.governmentIdVerified),
    successfulTrades: safeNumber(mergedProfile.successfulTrades ?? mergedProfile.completedTrades ?? mergedProfile.totalTrades),
    failedTrades: safeNumber(mergedProfile.failedTrades),
    completedDeliveries: safeNumber(mergedProfile.completedDeliveries ?? mergedProfile.deliveriesCount),
    cancelledTransactions: safeNumber(mergedProfile.cancelledTransactions),
    escrowSuccessRate: safeNumber(mergedProfile.escrowSuccessRate, safeNumber(mergedProfile.successfulTrades) ? 90 : 0),
    responseRate: safeNumber(mergedProfile.responseRate),
    repeatCustomers: safeNumber(mergedProfile.repeatCustomers),
    followersCount: safeNumber(mergedProfile.followersCount),
    memberSince: profile.memberSince || profile.createdAt || serverTimestamp(),
    trustUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await updateDoc(userRef, updates);

  if (trustScore !== previousScore) {
    await addDoc(collection(db, 'trustHistory'), {
      userId,
      type: trustScore > previousScore ? 'score_increased' : 'score_decreased',
      amount: trustScore - previousScore,
      previousScore,
      newScore: trustScore,
      trustLevel,
      reason: 'Trust metrics recalculated',
      createdAt: serverTimestamp()
    });
  }

  if (riskStatus !== 'clear') {
    await addDoc(collection(db, 'activities'), {
      userId,
      type: 'trust_alert',
      title: 'Trust status under review',
      body: 'This account has been flagged by the automated trust engine.',
      createdAt: serverTimestamp()
    });
  }

  return {
    trustScore,
    trustLevel,
    visibilityMultiplier,
    riskStatus,
    instantTransactionsEnabled
  };
};

export const applyTrustReward = async (
  userId: string,
  options: TrustAdjustmentOptions
) => {
  const amount = Math.abs(options.amount);

  await addDoc(collection(db, 'trustHistory'), {
    userId,
    type: options.eventType || 'manual_reward',
    amount,
    reason: options.reason,
    metadata: options.metadata || {},
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'users', userId), {
    trustAdjustment: increment(amount),
    ...(options.metricUpdates || {}),
    lastTrustEventAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return updateUserTrustMetrics(userId);
};

export const applyTrustPenalty = async (
  userId: string,
  options: TrustAdjustmentOptions
) => {
  const amount = Math.abs(options.amount);

  await addDoc(collection(db, 'trustHistory'), {
    userId,
    type: options.eventType || 'manual_penalty',
    amount: -amount,
    reason: options.reason,
    metadata: options.metadata || {},
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'users', userId), {
    trustAdjustment: increment(-amount),
    ...(options.metricUpdates || {}),
    lastTrustEventAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return updateUserTrustMetrics(userId);
};

export const subscribeToUserTrust = (
  userId: string,
  callback: (trust: {
    profile: any;
    trustScore: number;
    trustLevel: TrustLevel;
    trustBadges: string[];
    visibilityMultiplier: number;
  }) => void
) => {
  return onSnapshot(doc(db, 'users', userId), snapshot => {
    if (!snapshot.exists()) return;

    const profile = snapshot.data();
    const trustScore = safeNumber(profile.trustScore, calculateTrustScore(profile));

    callback({
      profile,
      trustScore,
      trustLevel: getTrustLevel(trustScore),
      trustBadges: profile.trustBadges || getTrustBadges({ ...profile, trustScore }),
      visibilityMultiplier: getTrustVisibilityMultiplier(trustScore)
    });
  });
};

export const getListingRankScore = (listing: any) => {
  const trustScore = safeNumber(listing.sellerTrustScore ?? listing.trustScore);
  const verifiedBoost = listing.sellerVerified || listing.verificationStatus === 'verified' ? 20 : 0;
  const ratingBoost = safeNumber(listing.sellerRating ?? listing.averageRating) * 8;
  const escrowBoost = listing.escrowProtected !== false ? 12 : 0;
  const activityBoost = getMillis(listing.updatedAt || listing.createdAt) / 1000000000000;

  return trustScore * 2 + verifiedBoost + ratingBoost + escrowBoost + activityBoost;
};

export const rankListingsByTrust = <T extends Record<string, any>>(listings: T[]) => {
  return [...listings].sort((a, b) => getListingRankScore(b) - getListingRankScore(a));
};
