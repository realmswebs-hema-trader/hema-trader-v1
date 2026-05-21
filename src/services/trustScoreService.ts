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
import {
  FOUNDER_BADGES,
  getFounderUserFields,
  isFounderIdentity
} from '../lib/founder';

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
  | 'phone_verified'
  | 'identity_verified'
  | 'driver_verified'
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

export const calculateVerificationScore = (profile: any) => {
  if (isFounderIdentity(profile)) return 100;

  let score = 0;

  if (profile?.emailVerified !== false) score += 15;
  if (profile?.phoneVerified) score += 30;

  if (
    profile?.identityVerified ||
    profile?.verificationStatus === 'verified' ||
    profile?.governmentIdUrl
  ) {
    score += profile?.identityVerified || profile?.verificationStatus === 'verified' ? 35 : 15;
  }

  if (profile?.driverVerified) score += 15;

  const hasCommunityProof =
    safeNumber(profile?.successfulTrades ?? profile?.completedTrades ?? profile?.totalTrades) > 0 ||
    safeNumber(profile?.averageRating || profile?.avgDriverRating) >= 4 ||
    safeNumber(profile?.followersCount) >= 5;

  if (hasCommunityProof) score += 5;

  return Math.min(score, 100);
};

export const getTrustBadges = (profile: any) => {
  if (isFounderIdentity(profile)) {
    return FOUNDER_BADGES;
  }

  const score = safeNumber(profile?.trustScore, 50);
  const badges: string[] = [];

  if (profile?.phoneVerified) badges.push('Phone Verified');

  if (profile?.identityVerified || profile?.verificationStatus === 'verified') {
    badges.push('Verified Identity');
  }

  if (profile?.driverVerified) badges.push('Verified Driver');
  if (score >= 61) badges.push('Trusted');
  if (score >= 81) badges.push('Elite Trader');
  if (profile?.roles?.includes?.('driver') && score >= 81) badges.push('Elite Driver');
  if (safeNumber(profile?.responseRate) >= 90) badges.push('Fast Responder');
  if (safeNumber(profile?.averageRating || profile?.avgDriverRating) >= 4.7) badges.push('Top Rated');

  const lastActiveAt = getMillis(profile?.lastActiveAt);
  if (lastActiveAt && Date.now() - lastActiveAt < 24 * 60 * 60 * 1000) {
    badges.push('Active Trader');
  }

  if (
    score >= 96 &&
    profile?.phoneVerified &&
    (profile?.identityVerified || profile?.verificationStatus === 'verified')
  ) {
    badges.push('Elite Verified');
  }

  return badges;
};

export const calculateProfileCompletion = (profile: any) => {
  if (isFounderIdentity(profile)) return 100;

  const fields = [
    profile?.photoURL,
    profile?.bannerURL,
    profile?.displayName || profile?.name,
    profile?.username,
    profile?.bio,
    profile?.location || profile?.city,
    profile?.phoneNumber,
    profile?.tradeCategory || profile?.businessCategory || profile?.businessDescription
  ];

  const completed = fields.filter(Boolean).length;
  return Math.round((completed / fields.length) * 100);
};

export const calculateTrustScore = (profile: any) => {
  if (isFounderIdentity(profile)) return 100;

  const baseScore = 50;

  const emailBonus = profile?.emailVerified !== false ? 2 : 0;
  const phoneBonus = profile?.phoneVerified ? 7 : 0;

  const identityVerified =
    profile?.identityVerified || profile?.verificationStatus === 'verified';

  const identityBonus = identityVerified ? 9 : profile?.governmentIdUrl && profile?.selfieUrl ? 3 : 0;
  const driverBonus = profile?.driverVerified ? 5 : 0;

  const successfulTrades = safeNumber(
    profile?.successfulTrades ?? profile?.completedTrades ?? profile?.totalTrades
  );
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
  const profileCompletion = safeNumber(
    profile?.profileCompletion,
    calculateProfileCompletion(profile)
  );
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

  const escrowBonus =
    escrowSuccessRate >= 95
      ? 8
      : escrowSuccessRate >= 80
        ? 5
        : escrowSuccessRate >= 60
          ? 2
          : successfulTrades > 0
            ? -8
            : 0;

  const deliveryRateBonus =
    deliveryCompletionRate >= 95
      ? 6
      : deliveryCompletionRate >= 80
        ? 3
        : deliveryCompletionRate >= 60
          ? 1
          : completedDeliveries > 0
            ? -7
            : 0;

  const ratingBonus =
    averageRating >= 4.8
      ? 12
      : averageRating >= 4.4
        ? 9
        : averageRating >= 4
          ? 5
          : averageRating >= 3
            ? 0
            : averageRating > 0
              ? -12
              : 0;

  const responseBonus =
    responseRate >= 95
      ? 6
      : responseRate >= 80
        ? 4
        : responseRate >= 50
          ? 1
          : responseRate > 0
            ? -5
            : 0;

  const repeatCustomerBonus = clamp(repeatCustomers * 1.5, 0, 6);
  const profileBonus =
    profileCompletion >= 90 ? 7 : profileCompletion >= 70 ? 4 : profileCompletion >= 45 ? 1 : -4;
  const ageBonus = accountAgeDays >= 365 ? 6 : accountAgeDays >= 180 ? 4 : accountAgeDays >= 30 ? 2 : 0;
  const followerBonus = clamp(followersCount / 20, 0, 5);
  const activityBonusOrPenalty = daysInactive > 60 ? -8 : daysInactive > 30 ? -4 : daysInactive > 14 ? -2 : 3;

  const failedTradePenalty = clamp(failedTrades * 4, 0, 18);
  const cancellationPenalty = clamp(cancelledTransactions * 3, 0, 18);
  const failedDeliveryPenalty = clamp(failedDeliveries * 4, 0, 16);
  const disputePenalty = clamp(disputes * 7, 0, 25);
  const reportPenalty = clamp(reportCount * 4 + fraudReportCount * 8, 0, 35);
  const warningPenalty = clamp(warnings * 6, 0, 24);

  const rawScore =
    baseScore +
    emailBonus +
    phoneBonus +
    identityBonus +
    driverBonus +
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
    activityBonusOrPenalty +
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
  const founder = isFounderIdentity(profile);

  const [reviewsSnap, reportsSnap] = await Promise.all([
    getDocs(query(collection(db, 'reviews'), where('reviewedUserId', '==', userId))),
    getDocs(query(collection(db, 'reports'), where('targetId', '==', userId)))
  ]);

  const reviews = reviewsSnap.docs
    .map(reviewDoc => reviewDoc.data())
    .filter(review => review.status !== 'removed');

  const reports = founder
    ? []
    : reportsSnap.docs
        .map(reportDoc => reportDoc.data())
        .filter(report => report.status !== 'dismissed');

  const averageRating = founder
    ? 5
    : reviews.length
      ? Number(average(reviews.map(review => safeNumber(review.rating))).toFixed(2))
      : safeNumber(profile.averageRating || profile.avgDriverRating);

  const fraudReportCount = founder
    ? 0
    : reports.filter(report =>
        ['fraud', 'scam', 'fake_products', 'fake_review'].includes(report.reason)
      ).length;

  const identityVerified =
    founder ||
    profile.identityVerified ||
    profile.verificationStatus === 'verified' ||
    Boolean(profile.governmentIdVerified);

  const mergedProfile = {
    ...profile,
    ...metricOverrides,
    ...(founder ? getFounderUserFields() : {}),
    averageRating,
    reportCount: founder ? 0 : reports.length,
    fraudReportCount,
    profileCompletion: founder ? 100 : calculateProfileCompletion(profile),
    verificationScore: founder ? 100 : calculateVerificationScore(profile),
    identityVerified
  };

  const previousScore = safeNumber(profile.trustScore, founder ? 100 : 50);
  const trustScore = founder ? 100 : calculateTrustScore(mergedProfile);
  const trustLevel = founder ? 'VERIFIED ELITE' : getTrustLevel(trustScore);
  const visibilityMultiplier = founder ? 2 : getTrustVisibilityMultiplier(trustScore);

  const riskStatus = founder
    ? 'clear'
    : trustScore <= 20
      ? 'high_risk'
      : trustScore <= 40
        ? 'restricted'
        : fraudReportCount >= 3
          ? 'fraud_review'
          : 'clear';

  const instantTransactionsEnabled = founder || (trustScore >= 41 && fraudReportCount < 3);
  const premiumVisibility = founder || trustScore >= 81;

  const updates = removeUndefined({
    ...(founder ? getFounderUserFields() : {}),

    trustScore,
    trustLevel,
    trustBadges: founder
      ? FOUNDER_BADGES
      : getTrustBadges({ ...mergedProfile, trustScore }),
    trustVisibilityMultiplier: visibilityMultiplier,
    marketplaceVisibility: visibilityMultiplier,
    premiumVisibility,
    instantTransactionsEnabled,
    accountRiskStatus: riskStatus,
    fraudProtectionStatus: riskStatus === 'clear' ? 'protected' : 'under_review',
    searchRankBoost: visibilityMultiplier,

    averageRating,
    reportCount: founder ? 0 : reports.length,
    fraudReportCount,
    profileCompletion: founder ? 100 : calculateProfileCompletion(profile),

    verificationScore: founder ? 100 : calculateVerificationScore(mergedProfile),
    verificationStatus: founder ? 'verified' : profile.verificationStatus || 'unverified',
    emailVerified: founder ? true : profile.emailVerified !== false,
    phoneVerified: founder ? true : Boolean(profile.phoneVerified),
    identityVerified: Boolean(identityVerified),
    driverVerified: founder ? true : Boolean(profile.driverVerified),
    eliteVerified: founder ? true : trustScore >= 96 && Boolean(identityVerified),

    governmentIdUrl: profile.governmentIdUrl || profile.idFrontUrl || '',
    selfieUrl: profile.selfieUrl || '',
    driverLicenseUrl: profile.driverLicenseUrl || '',

    successfulTrades: founder
      ? Math.max(
          safeNumber(mergedProfile.successfulTrades ?? mergedProfile.completedTrades ?? mergedProfile.totalTrades),
          1
        )
      : safeNumber(
          mergedProfile.successfulTrades ?? mergedProfile.completedTrades ?? mergedProfile.totalTrades
        ),
    failedTrades: founder ? 0 : safeNumber(mergedProfile.failedTrades),
    completedDeliveries: founder
      ? Math.max(safeNumber(mergedProfile.completedDeliveries ?? mergedProfile.deliveriesCount), 1)
      : safeNumber(mergedProfile.completedDeliveries ?? mergedProfile.deliveriesCount),
    cancelledTransactions: founder ? 0 : safeNumber(mergedProfile.cancelledTransactions),
    escrowSuccessRate: founder
      ? 100
      : safeNumber(
          mergedProfile.escrowSuccessRate,
          safeNumber(mergedProfile.successfulTrades) ? 90 : 0
        ),
    responseRate: founder ? 100 : safeNumber(mergedProfile.responseRate),
    repeatCustomers: safeNumber(mergedProfile.repeatCustomers),
    followersCount: safeNumber(mergedProfile.followersCount),
    memberSince: profile.memberSince || profile.createdAt || serverTimestamp(),
    trustUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await updateDoc(userRef, updates);

  if (!founder && trustScore !== previousScore) {
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

  if (!founder && riskStatus !== 'clear') {
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
  const userSnap = await getDoc(doc(db, 'users', userId));
  const profile = userSnap.exists() ? userSnap.data() : null;

  if (isFounderIdentity(profile)) {
    return updateUserTrustMetrics(userId);
  }

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
  const userSnap = await getDoc(doc(db, 'users', userId));
  const profile = userSnap.exists() ? userSnap.data() : null;

  if (isFounderIdentity(profile)) {
    return updateUserTrustMetrics(userId);
  }

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
    const founder = isFounderIdentity(profile);
    const trustScore = founder ? 100 : safeNumber(profile.trustScore, calculateTrustScore(profile));

    callback({
      profile: founder ? { ...profile, ...getFounderUserFields() } : profile,
      trustScore,
      trustLevel: founder ? 'VERIFIED ELITE' : getTrustLevel(trustScore),
      trustBadges: founder
        ? FOUNDER_BADGES
        : profile.trustBadges || getTrustBadges({ ...profile, trustScore }),
      visibilityMultiplier: founder ? 2 : getTrustVisibilityMultiplier(trustScore)
    });
  });
};

export const getListingRankScore = (listing: any) => {
  const founderBoost = isFounderIdentity({
    email: listing.sellerEmail,
    isFounder: listing.sellerIsFounder,
    founderVerified: listing.sellerFounderVerified
  })
    ? 1000
    : 0;

  const trustScore = safeNumber(listing.sellerTrustScore ?? listing.trustScore);
  const verifiedBoost =
    listing.sellerIdentityVerified ||
    listing.identityVerified ||
    listing.verificationStatus === 'verified'
      ? 16
      : 0;
  const phoneBoost = listing.sellerPhoneVerified || listing.phoneVerified ? 8 : 0;
  const ratingBoost = safeNumber(listing.sellerRating ?? listing.averageRating) * 8;
  const escrowBoost = listing.escrowProtected !== false ? 12 : 0;
  const activityBoost = getMillis(listing.updatedAt || listing.createdAt) / 1000000000000;

  return (
    founderBoost +
    trustScore * 2 +
    verifiedBoost +
    phoneBoost +
    ratingBoost +
    escrowBoost +
    activityBoost
  );
};

export const rankListingsByTrust = <T extends Record<string, any>>(listings: T[]) => {
  return [...listings].sort((a, b) => getListingRankScore(b) - getListingRankScore(a));
};
