import {
  collection,
  getCountFromServer,
  query,
  where
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../lib/firebase';
import {
  getListingLimitForPlan,
  type BoostType,
  type SubscriptionPlan,
  type UserRole
} from '../config/revenueConfig';

const functions = getFunctions();

export const getUserSubscriptionPlan = (profile: any): SubscriptionPlan => {
  const plan = profile?.subscription?.plan;
  return ['free', 'starter', 'pro', 'business'].includes(plan) ? plan : 'free';
};

export const getActiveListingCount = async (sellerId: string) => {
  const activeListingsQuery = query(
    collection(db, 'listings'),
    where('sellerId', '==', sellerId),
    where('status', '==', 'active')
  );

  const snapshot = await getCountFromServer(activeListingsQuery);
  return snapshot.data().count;
};

export const validateSellerListingLimit = async (sellerId: string, profile: any) => {
  const plan = getUserSubscriptionPlan(profile);
  const limit = getListingLimitForPlan(plan);

  if (limit === Infinity) {
    return { allowed: true, plan, limit, activeCount: 0 };
  }

  const activeCount = await getActiveListingCount(sellerId);

  return {
    allowed: activeCount < limit,
    plan,
    limit,
    activeCount,
    message:
      activeCount >= limit
        ? plan === 'free'
          ? 'You have reached your free listing limit. Upgrade to Starter to add more products.'
          : `You have reached your ${plan} listing limit. Upgrade your plan to add more products.`
        : ''
  };
};

export const purchaseSubscription = async (plan: SubscriptionPlan, role: UserRole) => {
  const callable = httpsCallable(functions, 'purchaseSubscription');
  const result = await callable({ plan, role });
  return result.data as any;
};

export const purchaseListingBoost = async (listingId: string, boostType: BoostType) => {
  const callable = httpsCallable(functions, 'purchaseListingBoost');
  const result = await callable({ listingId, boostType });
  return result.data as any;
};

export const requestVerification = async (
  verificationType: 'seller' | 'driver' | 'business',
  notes = ''
) => {
  const callable = httpsCallable(functions, 'requestVerification');
  const result = await callable({ verificationType, notes });
  return result.data as any;
};

export const requestPayout = async (amount: number, phoneNumber: string) => {
  const callable = httpsCallable(functions, 'requestPayout');
  const result = await callable({ amount, phoneNumber });
  return result.data as any;
};
