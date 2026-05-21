import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '../lib/firebase';

export type ReviewCategory = 'seller' | 'buyer' | 'driver' | 'delivery' | 'escrow';

export interface RatingBreakdown {
  productQuality?: number;
  communication?: number;
  deliverySpeed?: number;
  trustworthiness?: number;
  packaging?: number;
  driverProfessionalism?: number;
  safety?: number;
  packageCondition?: number;
  escrowExperience?: number;
}

export interface ReputationReview {
  id: string;
  tradeId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerPhoto: string;
  reviewedUserId: string;
  rating: number;
  title: string;
  comment: string;
  category: ReviewCategory;
  tags: string[];
  breakdown: RatingBreakdown;
  isVerifiedTrade: boolean;
  escrowProtected: boolean;
  tradeType: string;
  response?: string;
  responseAt?: any;
  respondedBy?: string;
  helpfulCount: number;
  helpfulBy?: string[];
  images?: string[];
  reportCount?: number;
  status?: 'active' | 'hidden' | 'removed';
  createdAt: any;
  updatedAt?: any;
}

export const REVIEW_TAGS = [
  'Fast Delivery',
  'Honest Seller',
  'Excellent Packaging',
  'Trusted Driver',
  'Great Communication',
  'Escrow Protected',
  'Premium Service',
  'Highly Recommended',
  'Professional',
  'Accurate Listing',
  'Safe Delivery',
  'Would Trade Again'
];

export const REVIEW_CATEGORIES: { value: ReviewCategory; label: string }[] = [
  { value: 'seller', label: 'Seller Review' },
  { value: 'buyer', label: 'Buyer Review' },
  { value: 'driver', label: 'Driver Review' },
  { value: 'delivery', label: 'Delivery Review' },
  { value: 'escrow', label: 'Escrow Review' }
];

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const toDate = (value: any) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  return null;
};

const sortReviews = (reviews: ReputationReview[]) =>
  [...reviews].sort((a, b) => {
    const aTime = toDate(a.createdAt)?.getTime() || 0;
    const bTime = toDate(b.createdAt)?.getTime() || 0;
    return bTime - aTime;
  });

const getReviewId = (
  tradeId: string,
  reviewerId: string,
  reviewedUserId: string,
  category: ReviewCategory
) => `${tradeId}_${reviewerId}_${reviewedUserId}_${category}`;

const getTrustTier = (score: number) => {
  if (score >= 90) return 'Elite Trusted';
  if (score >= 75) return 'Verified Trusted';
  if (score >= 55) return 'Community Trader';
  if (score >= 35) return 'Limited Trust';
  return 'Under Review';
};

const cleanBreakdown = (breakdown: RatingBreakdown = {}) =>
  Object.fromEntries(
    Object.entries(breakdown).filter(([, value]) => typeof value === 'number' && value > 0)
  ) as RatingBreakdown;

const uploadReviewImages = async (reviewId: string, files: File[] = []) => {
  const uploads = files.slice(0, 5).map(async (file, index) => {
    const imageRef = ref(storage, `reviews/${reviewId}/${Date.now()}_${index}_${file.name}`);
    const snapshot = await uploadBytes(imageRef, file);
    return getDownloadURL(snapshot.ref);
  });

  return Promise.all(uploads);
};

export const calculateTrustScore = ({
  averageRating,
  totalReviews,
  deliveryCompletionRate,
  escrowSuccessRate,
  accountAgeDays,
  reportCount,
  fraudReportCount,
  verifiedIdentity,
  activityLevel
}: {
  averageRating: number;
  totalReviews: number;
  deliveryCompletionRate: number;
  escrowSuccessRate: number;
  accountAgeDays: number;
  reportCount: number;
  fraudReportCount: number;
  verifiedIdentity: boolean;
  activityLevel: number;
}) => {
  const ratingScore = clamp((averageRating / 5) * 35, 0, 35);
  const volumeScore = clamp((totalReviews / 50) * 10, 0, 10);
  const deliveryScore = clamp((deliveryCompletionRate / 100) * 12, 0, 12);
  const escrowScore = clamp((escrowSuccessRate / 100) * 12, 0, 12);
  const accountAgeScore = clamp((accountAgeDays / 365) * 8, 0, 8);
  const identityScore = verifiedIdentity ? 10 : 0;
  const activityScore = clamp(activityLevel, 0, 8);
  const reportPenalty = clamp(reportCount * 3 + fraudReportCount * 7, 0, 30);

  return Math.round(
    clamp(
      ratingScore +
        volumeScore +
        deliveryScore +
        escrowScore +
        accountAgeScore +
        identityScore +
        activityScore -
        reportPenalty,
      0,
      100
    )
  );
};

export const submitReview = async ({
  tradeId,
  reviewerId,
  reviewerName,
  reviewerPhoto,
  reviewedUserId,
  rating,
  title,
  comment,
  category,
  tags,
  breakdown,
  images,
  sendNotification
}: {
  tradeId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerPhoto: string;
  reviewedUserId: string;
  rating: number;
  title: string;
  comment: string;
  category: ReviewCategory;
  tags: string[];
  breakdown: RatingBreakdown;
  images?: File[];
  sendNotification?: (userId: string, data: any) => Promise<void>;
}) => {
  const tradeSnap = await getDoc(doc(db, 'trades', tradeId));

  if (!tradeSnap.exists()) {
    throw new Error('Trade not found. Reviews require a completed trade.');
  }

  const trade = tradeSnap.data();
  const participantIds = [trade.buyerId, trade.sellerId, trade.driverId].filter(Boolean);
  const isParticipant = participantIds.includes(reviewerId);
  const isReviewedParticipant = participantIds.includes(reviewedUserId);
  const isVerifiedTrade = trade.status === 'completed' && isParticipant && isReviewedParticipant;

  if (!isVerifiedTrade || reviewerId === reviewedUserId) {
    throw new Error('Only completed trade participants can leave verified reviews.');
  }

  const reviewId = getReviewId(tradeId, reviewerId, reviewedUserId, category);
  const reviewRef = doc(db, 'reviews', reviewId);
  const existingReview = await getDoc(reviewRef);

  if (existingReview.exists()) {
    throw new Error('You already reviewed this user for this trade category.');
  }

  const uploadedImages = await uploadReviewImages(reviewId, images || []);
  const normalizedRating = clamp(Number(rating), 1, 5);
  const escrowProtected = Boolean(trade.escrowStatus || trade.paymentStatus === 'verified');

  await setDoc(reviewRef, {
    tradeId,
    reviewerId,
    reviewerName,
    reviewerPhoto,
    reviewedUserId,
    rating: normalizedRating,
    title: title.trim(),
    comment: comment.trim(),
    category,
    tags,
    breakdown: cleanBreakdown(breakdown),
    isVerifiedTrade,
    escrowProtected,
    tradeType: trade.deliveryFee ? 'Escrow + Delivery' : 'Escrow Trade',
    helpfulCount: 0,
    helpfulBy: [],
    images: uploadedImages,
    reportCount: 0,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await addDoc(collection(db, 'activities'), {
    userId: reviewedUserId,
    actorId: reviewerId,
    actorName: reviewerName,
    type: 'review_received',
    title: 'New verified review',
    body: `${reviewerName} rated this trade ${normalizedRating}/5.`,
    targetId: reviewId,
    targetType: 'review',
    createdAt: serverTimestamp()
  });

  await sendNotification?.(reviewedUserId, {
    title: 'New Verified Review',
    body: `${reviewerName} rated you ${normalizedRating}/5.`,
    type: 'rating',
    targetId: reviewedUserId,
    targetType: 'profile',
    actionUrl: `/profile/${reviewedUserId}`
  });

  await syncUserReputation(reviewedUserId);

  return reviewId;
};

export const subscribeToUserReviews = (
  userId: string,
  callback: (reviews: ReputationReview[]) => void
) => {
  const reviewsQuery = query(collection(db, 'reviews'), where('reviewedUserId', '==', userId));

  return onSnapshot(reviewsQuery, snapshot => {
    const reviews = snapshot.docs
      .map(reviewDoc => ({
        id: reviewDoc.id,
        ...reviewDoc.data()
      })) as ReputationReview[];

    callback(sortReviews(reviews.filter(review => review.status !== 'removed')));
  });
};

export const markReviewHelpful = async (reviewId: string, userId: string) => {
  const helpfulRef = doc(db, 'reviews', reviewId, 'helpful', userId);
  const reviewRef = doc(db, 'reviews', reviewId);
  const helpfulSnap = await getDoc(helpfulRef);

  if (helpfulSnap.exists()) {
    await deleteDoc(helpfulRef);
    await updateDoc(reviewRef, {
      helpfulCount: increment(-1),
      helpfulBy: arrayRemove(userId),
      updatedAt: serverTimestamp()
    });
    return false;
  }

  await setDoc(helpfulRef, {
    userId,
    createdAt: serverTimestamp()
  });

  await updateDoc(reviewRef, {
    helpfulCount: increment(1),
    helpfulBy: arrayUnion(userId),
    updatedAt: serverTimestamp()
  });

  return true;
};

export const respondToReview = async (
  reviewId: string,
  responderId: string,
  response: string
) => {
  await updateDoc(doc(db, 'reviews', reviewId), {
    response: response.trim(),
    respondedBy: responderId,
    responseAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
};

export const reportReview = async ({
  reviewId,
  reporterId,
  reason,
  description
}: {
  reviewId: string;
  reporterId: string;
  reason: 'fake_review' | 'abuse' | 'spam' | 'harassment';
  description?: string;
}) => {
  const reviewSnap = await getDoc(doc(db, 'reviews', reviewId));

  await addDoc(collection(db, 'reports'), {
    type: 'review',
    reviewId,
    reporterId,
    targetId: reviewSnap.exists() ? reviewSnap.data().reviewedUserId : '',
    reason,
    description: description || '',
    status: 'pending',
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'reviews', reviewId), {
    reportCount: increment(1),
    updatedAt: serverTimestamp()
  });
};

export const getReviewSummary = async (userId: string) => {
  const [userSnap, reviewSnap, reportSnap] = await Promise.all([
    getDoc(doc(db, 'users', userId)),
    getDocs(query(collection(db, 'reviews'), where('reviewedUserId', '==', userId))),
    getDocs(query(collection(db, 'reports'), where('targetId', '==', userId)))
  ]);

  const profile = userSnap.exists() ? userSnap.data() : {};
  const reviews = reviewSnap.docs
    .map(reviewDoc => ({
      id: reviewDoc.id,
      ...reviewDoc.data()
    })) as ReputationReview[];

  const activeReviews = reviews.filter(review => review.status !== 'removed');
  const verifiedReviews = activeReviews.filter(review => review.isVerifiedTrade);
  const withPhotos = activeReviews.filter(review => review.images?.length);
  const averageRating = average(activeReviews.map(review => Number(review.rating || 0)));
  const driverReviews = activeReviews.filter(
    review => review.category === 'driver' || review.category === 'delivery'
  );
  const reportCount = reportSnap.docs.filter(report => report.data().status !== 'dismissed').length;
  const fraudReportCount = reportSnap.docs.filter(report =>
    ['fraud', 'scam', 'fake_products'].includes(report.data().reason)
  ).length;

  const createdAt = toDate(profile.createdAt);
  const accountAgeDays = createdAt
    ? Math.max(Math.floor((Date.now() - createdAt.getTime()) / 86400000), 1)
    : 1;

  const lastActiveAt = toDate(profile.lastActiveAt);
  const activityLevel =
    lastActiveAt && Date.now() - lastActiveAt.getTime() < 86400000 ? 8 : activeReviews.length > 0 ? 5 : 2;

  const responseRate =
    activeReviews.length > 0
      ? Math.round((activeReviews.filter(review => review.response).length / activeReviews.length) * 100)
      : profile.responseRate || 0;

  const escrowSuccessRate = profile.escrowSuccessRate ?? (activeReviews.length ? 95 : 0);
  const deliveryCompletionRate = profile.deliverySuccessRate ?? profile.deliveryCompletionRate ?? 0;

  const trustScore = calculateTrustScore({
    averageRating,
    totalReviews: activeReviews.length,
    deliveryCompletionRate,
    escrowSuccessRate,
    accountAgeDays,
    reportCount,
    fraudReportCount,
    verifiedIdentity: profile.verificationStatus === 'verified',
    activityLevel
  });

  return {
    averageRating: Number(averageRating.toFixed(2)),
    totalReviews: activeReviews.length,
    verifiedReviews: verifiedReviews.length,
    withPhotos: withPhotos.length,
    responseRate,
    escrowSuccessRate,
    deliveryCompletionRate,
    repeatCustomerRate: profile.repeatCustomerRate || 0,
    avgDriverRating: Number(average(driverReviews.map(review => review.rating)).toFixed(2)),
    driverReviews: driverReviews.length,
    trustScore,
    trustTier: getTrustTier(trustScore),
    recentPhotos: withPhotos.flatMap(review => review.images || []).slice(0, 8)
  };
};

export const syncUserReputation = async (userId: string) => {
  const summary = await getReviewSummary(userId);
  const reviewSnap = await getDocs(query(collection(db, 'reviews'), where('reviewedUserId', '==', userId)));
  const reviews = reviewSnap.docs.map(reviewDoc => reviewDoc.data() as ReputationReview);
  const negativeReviews = reviews.filter(review => Number(review.rating) <= 2).length;

  await updateDoc(doc(db, 'users', userId), {
    averageRating: summary.averageRating,
    totalReviews: summary.totalReviews,
    verifiedReviewsCount: summary.verifiedReviews,
    avgDriverRating: summary.avgDriverRating,
    driverReviewsCount: summary.driverReviews,
    trustScore: summary.trustScore,
    trustIntegrityScore: summary.trustScore,
    trustTier: summary.trustTier,
    negativeReviewCount: negativeReviews,
    reputationSummary: summary,
    accountFlag: summary.trustScore < 45 || negativeReviews >= 5 ? 'trust_review' : 'clear',
    updatedAt: serverTimestamp()
  });
};
