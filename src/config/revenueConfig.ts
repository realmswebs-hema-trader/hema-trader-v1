export type SubscriptionPlan = 'free' | 'starter' | 'pro' | 'business';
export type UserRole = 'buyer' | 'seller' | 'driver' | 'admin';
export type BoostType = 'oneDay' | 'threeDays' | 'sevenDays' | 'homepage';

export const REVENUE_CONFIG = {
  currency: 'XAF',

  admin: {
    email: 'realmswebs@gmail.com'
  },

  platformFee: {
    rate: 0.02,
    minimum: 500,
    maximum: 10000
  },

  deliveryCommission: {
    platformRate: 0.2,
    driverRate: 0.8
  },

  subscriptions: {
    free: { amount: 0, activeListingLimit: 5 },
    starter: { amount: 2500, activeListingLimit: 25 },
    pro: { amount: 7500, activeListingLimit: 100 },
    business: { amount: 20000, activeListingLimit: Infinity }
  },

  boosts: {
    oneDay: { amount: 500, durationHours: 24, label: '24 Hours' },
    threeDays: { amount: 1000, durationHours: 72, label: '3 Days' },
    sevenDays: { amount: 2000, durationHours: 168, label: '7 Days' },
    homepage: { amount: 5000, durationHours: 168, label: 'Homepage Feature' }
  },

  verification: {
    seller: 2500,
    driver: 2000,
    business: 10000
  },

  withdrawals: {
    rate: 0.01,
    minimum: 200
  }
} as const;

export const calculatePlatformFee = (amount: number) => {
  const rawFee = amount * REVENUE_CONFIG.platformFee.rate;
  return Math.min(
    Math.max(rawFee, REVENUE_CONFIG.platformFee.minimum),
    REVENUE_CONFIG.platformFee.maximum
  );
};

export const calculateDeliveryCommission = (deliveryFee: number) => ({
  platformCommission: Math.round(deliveryFee * REVENUE_CONFIG.deliveryCommission.platformRate),
  driverPayout: Math.round(deliveryFee * REVENUE_CONFIG.deliveryCommission.driverRate)
});

export const calculateWithdrawalFee = (amount: number) =>
  Math.max(Math.round(amount * REVENUE_CONFIG.withdrawals.rate), REVENUE_CONFIG.withdrawals.minimum);

export const getSubscriptionAmount = (plan: SubscriptionPlan) =>
  REVENUE_CONFIG.subscriptions[plan].amount;

export const getListingLimitForPlan = (plan: SubscriptionPlan) =>
  REVENUE_CONFIG.subscriptions[plan].activeListingLimit;

export const getBoostAmount = (boostType: BoostType) =>
  REVENUE_CONFIG.boosts[boostType].amount;
