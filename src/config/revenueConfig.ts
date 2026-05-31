export const REVENUE_CONFIG = {
  currency: 'XAF',

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
    sellerStarter: 2500,
    sellerPro: 7500,
    sellerBusiness: 20000,
    driverPro: 2000,
    buyerPremium: 1500
  },

  boosts: {
    oneDay: 500,
    threeDays: 1000,
    sevenDays: 2000,
    homepage: 5000
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
  const fee = amount * REVENUE_CONFIG.platformFee.rate;

  return Math.min(
    Math.max(fee, REVENUE_CONFIG.platformFee.minimum),
    REVENUE_CONFIG.platformFee.maximum
  );
};

export const calculateDeliveryCommission = (deliveryFee: number) => {
  const platformCommission =
    deliveryFee * REVENUE_CONFIG.deliveryCommission.platformRate;

  const driverPayout =
    deliveryFee * REVENUE_CONFIG.deliveryCommission.driverRate;

  return {
    platformCommission,
    driverPayout
  };
};

export const calculateWithdrawalFee = (amount: number) => {
  const fee = amount * REVENUE_CONFIG.withdrawals.rate;

  return Math.max(fee, REVENUE_CONFIG.withdrawals.minimum);
};
