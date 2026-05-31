export const FIRESTORE_COLLECTIONS = {
  users: 'users',
  listings: 'listings',
  trades: 'trades',
  wallets: 'wallets',
  transactions: 'transactions',
  subscriptions: 'subscriptions',
  boosts: 'boosts',
  verifications: 'verifications',
  deliveries: 'deliveries',
  payouts: 'payouts',
  platformRevenue: 'platformRevenue',
  adminLogs: 'adminLogs'
} as const;

export type FirestoreCollectionKey = keyof typeof FIRESTORE_COLLECTIONS;

export const getUserPath = (userId: string) =>
  `${FIRESTORE_COLLECTIONS.users}/${userId}`;

export const getWalletPath = (userId: string) =>
  `${FIRESTORE_COLLECTIONS.wallets}/${userId}`;

export const getListingPath = (listingId: string) =>
  `${FIRESTORE_COLLECTIONS.listings}/${listingId}`;

export const getTradePath = (tradeId: string) =>
  `${FIRESTORE_COLLECTIONS.trades}/${tradeId}`;

export const getDeliveryPath = (deliveryId: string) =>
  `${FIRESTORE_COLLECTIONS.deliveries}/${deliveryId}`;

export const getSubscriptionPath = (subscriptionId: string) =>
  `${FIRESTORE_COLLECTIONS.subscriptions}/${subscriptionId}`;

export const getBoostPath = (boostId: string) =>
  `${FIRESTORE_COLLECTIONS.boosts}/${boostId}`;

export const getVerificationPath = (verificationId: string) =>
  `${FIRESTORE_COLLECTIONS.verifications}/${verificationId}`;

export const getPayoutPath = (payoutId: string) =>
  `${FIRESTORE_COLLECTIONS.payouts}/${payoutId}`;

export const getTransactionPath = (transactionId: string) =>
  `${FIRESTORE_COLLECTIONS.transactions}/${transactionId}`;

export const getPlatformRevenuePath = (revenueId: string) =>
  `${FIRESTORE_COLLECTIONS.platformRevenue}/${revenueId}`;
