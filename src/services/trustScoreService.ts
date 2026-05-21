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
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';

import { db } from '../lib/firebase';

export const FOUNDER_EMAIL = 'realmswebs@gmail.com';
export const FOUNDER_NAME = 'Hema Trader';
export const FOUNDER_USERNAME = 'hema.trader';

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
  | 'founder_sync'
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

export const normalizeNameKey = (value = '') =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

export const isFounderEmail = (email?: string | null) =>
  email?.trim().toLowerCase() === FOUNDER_EMAIL;

export const isReservedFounderName = (value?: string, email?: string | null) => {
  if (!value || isFounderEmail(email)) return false;

  const normalized = normalizeNameKey(value);
  return ['hema trader', 'hematrader', 'hema-trader', 'hema.trader'].includes(normalized);
};

export const isFounderProfile = (profile?: any) =>
  Boolean(
    profile?.isFounder ||
      profile?.founderVerified ||
      isFounderEmail(profile?.email)
  );

export const FOUNDER_BADGES = [
  'Founder',
  'Hema Trader Founder',
  'Email Verified',
  'Phone Verified',
  'Verified Identity',
  'Verified Driver',
  'Trusted',
  'Elite Trader',
  'Elite Driver',
  'Fast Responder',
  'Top Rated',
  'Active Trader',
  'Elite Verified'
];

export const getFounderUserFields = (profile: any = {}) => ({
  displayName: FOUNDER_NAME,
  name: FOUNDER_NAME,
  username: FOUNDER_USERNAME,
  displayNameKey: normalizeNameKey(FOUNDER_NAME),
  usernameKey: normalizeNameKey(FOUNDER_USERNAME),
  email: FOUNDER_EMAIL,

  isFounder: true,
  founderVerified: true,
  isAdmin: true,
  roles: ['buyer', 'seller', 'driver', 'admin'],

  verificationStatus: 'verified',
  emailVerified: true,
  phoneVerified: true,
  identityVerified: true,
  driverVerified: true,
  eliteVerified: true,
  verificationScore: 100,

  trustScore: 100,
  trustLevel: 'VERIFIED ELITE',
  trustBadges: FOUNDER_BADGES,
  trustVisibilityMultiplier: 2,
  marketplaceVisibility: 2,
  searchRankBoost: 2,
  premiumVisibility: true,
  instantTransactionsEnabled: true,
  accountRiskStatus: 'clear',
  fraudProtectionStatus: 'protected',

  averageRating: 5,
  avgDriverRating: 5,
  communityRatingPercent: 100,

  successfulTrades: Math.max(safeNumber(profile.successfulTrades), 10),
  completedTrades: Math.max(safeNumber(profile.completedTrades), 10),
  totalTrades: Math.max(safeNumber(profile.totalTrades), 10),

  totalSales: Math.max(safeNumber(profile.totalSales), 10),
  salesCount: Math.max(safeNumber(profile.salesCount), 10),

  completedDeliveries: Math.max(safeNumber(profile.completedDeliveries), 10),
  deliveriesCount: Math.max(safeNumber(profile.deliveriesCount), 10),

  escrowSuccessRate: 100,
  deliveryCompletionRate: 100,
  deliverySuccessRate: 100,
  responseRate: 100,
  responseTime: 'Founder priority',

  failedTrades: 0,
  failedDeliveries: 0,
  cancelledTransactions: 0,
  disputeCount: 0,
  reportCount: 0,
  fraudReportCount: 0,
  warningCount: 0
});

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
  if (isFounderProfile(profile)) return 100;

  let score = 0;
  if (profile?.emailVerified !== false) score += 15;
  if (profile?.phoneVerified) score += 30;
  if (profile?.identityVerified || profile?.verificationStatus === 'verified') score += 35;
  else if (profile?.governmentIdUrl && profile?.selfieUrl) score += 15;
  if (profile?.driverVerified) score += 15;

  const hasCommunityProof =
    safeNumber(profile?.successfulTrades ?? profile?.completedTrades ?? profile?.totalTrades) > 0 ||
    safeNumber(profile?.averageRating || profile?.avgDriverRating) >= 4 ||
    safeNumber(profile?.followersCount) >= 5;

  if (hasCommunityProof) score += 5;
  return clamp(score);
};

export const getTrustBadges = (profile: any) => {
  if (isFounderProfile(profile)) return FOUNDER_BADGES;

  const score = safeNumber(profile?.trustScore, 50);
  const badges: string[] = [];

  if (profile?.phoneVerified) badges.push('Phone Verified');
  if (profile?.identityVerified || profile?.verificationStatus === 'verified') badges.push('Verified Identity');
  if (profile?.driverVerified) badges.push('Verified Driver');
  if (score >= 61) badges.push('Trusted');
  if (score >= 81) badges.push('Elite Trader');
  if (profile?.roles?.includes?.('driver') && score >= 81) badges.push('Elite Driver');
  if (safeNumber(profile?.responseRate) >= 90) badges.push('Fast Responder');
  if (safeNumber(profile?.averageRating || profile?.avgDriverRating) >= 4.7) badges.push('Top Rated');

  const lastActiveAt = getMillis(profile?.lastActiveAt);
  if (lastActiveAt && Date.now() - lastActiveAt < 86400000) badges.push('Active Trader');

  if (score >= 96 && profile?.phoneVerified && profile?.identityVerified) {
    badges.push('Elite Verified');
  }

  return badges;
};

export const calculateProfileCompletion = (profile: any) => {
  if (isFounderProfile(profile)) return 100;

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

  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
};

export const calculateTrustScore = (profile: any) => {
  if (isFounderProfile(profile)) return 100;

  const baseScore = 50;
  const emailBonus = profile?.emailVerified !== false ? 2 : 0;
  const phoneBonus = profile?.phoneVerified ? 7 : 0;
  const identityBonus =
    profile?.identityVerified || profile?.verificationStatus === 'verified'
      ? 9
      : profile?.governmentIdUrl && profile?.selfieUrl
        ? 3
        : 0;
  const driverBonus = profile?.driverVerified ? 5 : 0;

  const successfulTrades = safeNumber(profile?.successfulTrades ?? profile?.completedTrades ?? profile?.totalTrades);
  const completedDeliveries = safeNumber(profile?.completedDeliveries ?? profile?.deliveriesCount);
  const averageRating = safeNumber(profile?.averageRating || profile?.avgDriverRating);
  const responseRate = safeNumber(profile?.responseRate);
  const escrowSuccessRate = safeNumber(profile?.escrowSuccessRate, successfulTrades ? 90 : 0);
  const deliveryCompletionRate = safeNumber(profile?.deliveryCompletionRate ?? profile?.deliverySuccessRate, completedDeliveries ? 90 : 0);
  const profileCompletion = safeNumber(profile?.profileCompletion, calculateProfileCompletion(profile));

  const memberSince = getMillis(profile?.memberSince || profile?.createdAt);
  const accountAgeDays = memberSince ? Math.max(Math.floor((Date.now() - memberSince) / 86400000), 1) : 1;
  const lastActiveAt = getMillis(profile?.lastActiveAt);
  const daysInactive = lastActiveAt ? Math.floor((Date.now() - lastActiveAt) / 86400000) : 30;

  const rawScore =
    baseScore +
    emailBonus +
    phoneBonus +
    identityBonus +
    driverBonus +
    clamp(successfulTrades * 1.2, 0, 14) +
    clamp(completedDeliveries * 0.8, 0, 10) +
    (escrowSuccessRate >= 95 ? 8 : escrowSuccessRate >= 80 ? 5 : escrowSuccessRate >= 60 ? 2 : successfulTrades ? -8 : 0) +
    (deliveryCompletionRate >= 95 ? 6 : deliveryCompletionRate >= 80 ? 3 : deliveryCompletionRate >= 60 ? 1 : completedDeliveries ? -7 : 0) +
    (averageRating >= 4.8 ? 12 : averageRating >= 4.4 ? 9 : averageRating >= 4 ? 5 : averageRating > 0 && averageRating < 3 ? -12 : 0) +
    (responseRate >= 95 ? 6 : responseRate >= 80 ? 4 : responseRate >= 50 ? 1 : responseRate > 0 ? -5 : 0) +
    clamp(safeNumber(profile?.repeatCustomers) * 1.5, 0, 6) +
    (profileCompletion >= 90 ? 7 : profileCompletion >= 70 ? 4 : profileCompletion >= 45 ? 1 : -4) +
    (accountAgeDays >= 365 ? 6 : accountAgeDays >= 180 ? 4 : accountAgeDays >= 30 ? 2 : 0) +
    clamp(safeNumber(profile?.followersCount) / 20, 0, 5) +
    (daysInactive > 60 ? -8 : daysInactive > 30 ? -4 : daysInactive > 14 ? -2 : 3) +
    safeNumber(profile?.trustAdjustment) -
    clamp(safeNumber(profile?.failedTrades) * 4, 0, 18) -
    clamp(safeNumber(profile?.cancelledTransactions) * 3, 0, 18) -
    clamp(safeNumber(profile?.failedDeliveries) * 4, 0, 16) -
    clamp(safeNumber(profile?.disputeCount) * 7, 0, 25) -
    clamp(safeNumber(profile?.reportCount) * 4 + safeNumber(profile?.fraudReportCount) * 8, 0, 35) -
    clamp(safeNumber(profile?.warningCount) * 6, 0, 24);

  return Math.round(clamp(rawScore));
};

export const syncFounderAccount = async (userId: string) => {
  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);
  const profile = snap.exists() ? snap.data() : {};

  await setDoc(
    userRef,
    {
      uid: userId,
      ...getFounderUserFields(profile),
      trustUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  return {
    trustScore: 100,
    trustLevel: 'VERIFIED ELITE' as TrustLevel,
    visibilityMultiplier: 2,
    riskStatus: 'clear',
    instantTransactionsEnabled: true
  };
};

const findFounderUser = async () => {
  const founderSnap = await getDocs(
    query(collection(db, 'users'), where('email', '==', FOUNDER_EMAIL))
  );

  if (founderSnap.empty) return null;

  const founderDoc = founderSnap.docs[0];
  return {
    id: founderDoc.id,
    profile: founderDoc.data()
  };
};

export const ensureUserFollowsFounder = async (userId: string) => {
  const founder = await findFounderUser();
  if (!founder) return { followed: false, reason: 'founder_not_found' };
  if (founder.id === userId) return syncFounderAccount(userId);

  const followId = `${userId}_${founder.id}`;
  const followRef = doc(db, 'followers', followId);
  const followSnap = await getDoc(followRef);

  if (followSnap.exists()) {
    await syncFounderAccount(founder.id);
    return { followed: false, reason: 'already_following', founderId: founder.id };
  }

  const batch = writeBatch(db);

  batch.set(followRef, {
    followerId: userId,
    followingId: founder.id,
    autoFollowedFounder: true,
    createdAt: serverTimestamp()
  });

  batch.set(
    doc(db, 'users', userId),
    {
      followingCount: increment(1),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  batch.set(
    doc(db, 'users', founder.id),
    {
      ...getFounderUserFields(founder.profile),
      followersCount: increment(1),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  await batch.commit();

  return { followed: true, founderId: founder.id };
};

export const syncUserAndFounderOnAuth = async (authUser: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  emailVerified?: boolean;
}) => {
  if (isFounderEmail(authUser.email)) {
    return syncFounderAccount(authUser.uid);
  }

  const safeDisplayName = isReservedFounderName(authUser.displayName || '', authUser.email)
    ? authUser.email?.split('@')[0] || 'Hema User'
    : authUser.displayName || undefined;

  await setDoc(
    doc(db, 'users', authUser.uid),
    removeUndefined({
      uid: authUser.uid,
      email: authUser.email,
      emailVerified: authUser.emailVerified,
      displayName: safeDisplayName,
      name: safeDisplayName,
      displayNameKey: safeDisplayName ? normalizeNameKey(safeDisplayName) : undefined,
      photoURL: authUser.photoURL || undefined,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }),
    { merge: true }
  );

  return ensureUserFollowsFounder(authUser.uid);
};

export const backfillFounderFollowers = async () => {
  const founder = await findFounderUser();
  if (!founder) throw new Error('Founder account not found.');

  const usersSnap = await getDocs(collection(db, 'users'));
  let created = 0;
  let batch = writeBatch(db);
  let writes = 0;

  const commitBatch = async () => {
    if (writes > 0) {
      await batch.commit();
      batch = writeBatch(db);
      writes = 0;
    }
  };

  for (const userDoc of usersSnap.docs) {
    if (userDoc.id === founder.id) continue;

    const user = userDoc.data();
    if (isFounderProfile(user)) continue;

    const followId = `${userDoc.id}_${founder.id}`;
    const followRef = doc(db, 'followers', followId);
    const followSnap = await getDoc(followRef);

    if (followSnap.exists()) continue;

    batch.set(followRef, {
      followerId: userDoc.id,
      followingId: founder.id,
      autoFollowedFounder: true,
      backfilled: true,
      createdAt: serverTimestamp()
    });

    batch.set(
      doc(db, 'users', userDoc.id),
      {
        followingCount: increment(1),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    batch.set(
      doc(db, 'users', founder.id),
      {
        ...getFounderUserFields(founder.profile),
        followersCount: increment(1),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    created += 1;
    writes += 3;

    if (writes >= 450) await commitBatch();
  }

  await commitBatch();
  await syncFounderAccount(founder.id);

  return { created, founderId: founder.id };
};

export const updateUserTrustMetrics = async (
  userId: string,
  metricOverrides: Record<string, any> = {}
) => {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) throw new Error('User not found.');

  const profile = userSnap.data();

  if (isFounderProfile(profile)) {
    return syncFounderAccount(userId);
  }

  const [reviewsByReviewedSnap, reviewsByRevieweeSnap, reportsSnap] = await Promise.all([
    getDocs(query(collection(db, 'reviews'), where('reviewedUserId', '==', userId))),
    getDocs(query(collection(db, 'reviews'), where('revieweeId', '==', userId))),
    getDocs(query(collection(db, 'reports'), where('targetId', '==', userId)))
  ]);

  const reviewsMap = new Map<string, any>();
  reviewsByReviewedSnap.docs.forEach(reviewDoc => reviewsMap.set(reviewDoc.id, reviewDoc.data()));
  reviewsByRevieweeSnap.docs.forEach(reviewDoc => reviewsMap.set(reviewDoc.id, reviewDoc.data()));

  const reviews = [...reviewsMap.values()].filter(review => review.status !== 'removed');
  const reports = reportsSnap.docs
    .map(reportDoc => reportDoc.data())
    .filter(report => report.status !== 'dismissed');

  const averageRating = reviews.length
    ? Number(average(reviews.map(review => safeNumber(review.rating))).toFixed(2))
    : safeNumber(profile.averageRating || profile.avgDriverRating);

  const fraudReportCount = reports.filter(report =>
    ['fraud', 'scam', 'fake_products', 'fake_review'].includes(report.reason)
  ).length;

  const mergedProfile = {
    ...profile,
    ...metricOverrides,
    averageRating,
    reportCount: reports.length,
    fraudReportCount,
    profileCompletion: calculateProfileCompletion(profile)
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

  const updates = removeUndefined({
    trustScore,
    trustLevel,
    trustBadges: getTrustBadges({ ...mergedProfile, trustScore }),
    trustVisibilityMultiplier: visibilityMultiplier,
    marketplaceVisibility: visibilityMultiplier,
    searchRankBoost: visibilityMultiplier,
    premiumVisibility: trustScore >= 81,
    instantTransactionsEnabled: trustScore >= 41 && fraudReportCount < 3,
    accountRiskStatus: riskStatus,
    fraudProtectionStatus: riskStatus === 'clear' ? 'protected' : 'under_review',

    averageRating,
    communityRatingPercent: Math.round((averageRating / 5) * 100),
    reportCount: reports.length,
    fraudReportCount,
    profileCompletion: calculateProfileCompletion(mergedProfile),
    verificationScore: calculateVerificationScore(mergedProfile),

    emailVerified: profile.emailVerified !== false,
    phoneVerified: Boolean(profile.phoneVerified),
    identityVerified: Boolean(profile.identityVerified || profile.verificationStatus === 'verified'),
    driverVerified: Boolean(profile.driverVerified),

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
    instantTransactionsEnabled: trustScore >= 41 && fraudReportCount < 3
  };
};

export const applyTrustReward = async (userId: string, options: TrustAdjustmentOptions) => {
  const userSnap = await getDoc(doc(db, 'users', userId));
  if (userSnap.exists() && isFounderProfile(userSnap.data())) {
    return syncFounderAccount(userId);
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

export const applyTrustPenalty = async (userId: string, options: TrustAdjustmentOptions) => {
  const userSnap = await getDoc(doc(db, 'users', userId));
  if (userSnap.exists() && isFounderProfile(userSnap.data())) {
    return syncFounderAccount(userId);
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

    if (isFounderProfile(profile)) {
      callback({
        profile: { ...profile, ...getFounderUserFields(profile) },
        trustScore: 100,
        trustLevel: 'VERIFIED ELITE',
        trustBadges: FOUNDER_BADGES,
        visibilityMultiplier: 2
      });
      return;
    }

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
  const founderBoost =
    isFounderEmail(listing.sellerEmail) || listing.sellerIsFounder || listing.isFounder ? 1000 : 0;

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

  return founderBoost + trustScore * 2 + verifiedBoost + phoneBoost + ratingBoost + escrowBoost + activityBoost;
};

export const rankListingsByTrust = <T extends Record<string, any>>(listings: T[]) => {
  return [...listings].sort((a, b) => getListingRankScore(b) - getListingRankScore(a));
};
