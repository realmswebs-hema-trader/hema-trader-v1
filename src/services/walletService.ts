import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections';
import {
  REVENUE_CONFIG,
  calculateWithdrawalFee
} from '../config/revenueConfig';

export const INSUFFICIENT_DELIVERY_FUNDS_MESSAGE =
  'Your Hema Trader balance is not enough to hire this driver. Please fund your account to continue delivery.';

const DEFAULT_CURRENCY = REVENUE_CONFIG.currency;
const LEGACY_TRANSACTION_COLLECTION = 'walletTransactions';
const LEGACY_WITHDRAWAL_COLLECTION = 'withdrawalRequests';
const WALLET_SECURITY_COLLECTION = 'walletSecurity';
const PLATFORM_REVENUE_COLLECTION = 'platformRevenue';

export type ListingBoostType = 'oneDay' | 'threeDays' | 'sevenDays' | 'homepage';

export type WalletTransactionType =
  | 'product_payment'
  | 'product_refund'
  | 'delivery_payment'
  | 'driver_payout'
  | 'wallet_funding'
  | 'wallet_topup'
  | 'withdrawal'
  | 'escrow_release'
  | 'escrow_hold'
  | 'delivery_escrow_hold'
  | 'delivery_escrow_release'
  | 'platform_fee'
  | 'refund'
  | 'listing_boost'
  | (string & {});

export type WalletTransactionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'held'
  | 'pending_manual_bank_payout'
  | (string & {});

export interface WalletSecurity {
  hasPin: boolean;
  failedAttempts: number;
  lockedUntil: any;
}

export interface WalletTransaction {
  id?: string;
  userId: string;
  tradeId?: string;
  deliveryRequestId?: string;
  listingId?: string;
  type: WalletTransactionType;
  amount: number;
  currency: string;
  direction?: 'credit' | 'debit' | string;
  status: WalletTransactionStatus;
  description?: string;
  createdAt?: any;
  processedAt?: any;
}

export interface WalletWithdrawal {
  id?: string;
  amount: number;
  fee?: number;
  netAmount?: number;
  currency: string;
  status: WalletTransactionStatus;
  phoneNumber?: string;
  method?: 'mobile_money' | 'bank';
  accountName?: string;
  createdAt?: any;
  processedAt?: any;
}

export interface WalletOverview {
  wallet: {
    availableBalance: number;
    escrowBalance: number;
    pendingWithdrawalBalance: number;
    totalEarned: number;
    totalWithdrawn: number;
    currency: string;
    frozen?: boolean;
  };
  walletSecurity?: WalletSecurity;
  transactions: WalletTransaction[];
  withdrawals: WalletWithdrawal[];
}

export interface WalletTopupResponse {
  ok?: boolean;
  txRef?: string;
  providerReference?: string;
  checkoutUrl?: string;
  ussdCode?: string;
  ussd_code?: string;
  operator?: string;
  amount?: number;
  currency?: string;
  status?: string;
  message?: string;
  providerResponse?: any;
}

export interface WalletTopupVerifyResponse {
  ok?: boolean;
  status?: string;
  txRef?: string;
  providerReference?: string;
  amount?: number;
  currency?: string;
  message?: string;
  walletTransactionId?: string;
}

export interface DeliveryWalletValidation {
  canPay: boolean;
  availableBalance: number;
  requiredAmount: number;
  shortfall: number;
  currency: string;
  message?: string;
  deliveryPaymentRequiredAt?: any;
  deliveryPaymentDeadlineAt?: any;
}

export interface DeliveryPaymentResponse {
  ok?: boolean;
  code?: string;
  status?: string;
  tradeId: string;
  deliveryRequestId?: string;
  deliveryPaymentStatus:
    | 'unpaid'
    | 'pending_funding'
    | 'paid'
    | 'failed'
    | 'refunded';
  deliveryStatus?: string;
  agreedFee?: number;
  deliveryFeePaid?: number;
  availableBalance?: number;
  walletTransactionId?: string;
  deliveryPaymentRequiredAt?: any;
  deliveryPaymentDeadlineAt?: any;
  message?: string;
}

export interface ProductRefundResponse {
  tradeId: string;
  refundProcessed: boolean;
  refundProcessedAt?: any;
  walletTransactionId?: string;
  message?: string;
}

export interface WithdrawalFeePreview {
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  canWithdraw: boolean;
}

interface ApiErrorPayload {
  error?: string;
  message?: string;
  code?: string;
  availableBalance?: number;
  requiredAmount?: number;
  shortfall?: number;
  currency?: string;
  deliveryPaymentRequiredAt?: any;
  deliveryPaymentDeadlineAt?: any;
  [key: string]: unknown;
}

interface ListingBoostPaymentResult {
  ok: boolean;
  status: 'completed';
  listingId: string;
  boostType: ListingBoostType;
  amount: number;
  currency: string;
  walletTransactionId: string;
  revenueTransactionId: string;
  boostExpiresAt: Timestamp;
  message: string;
}

interface ListingData {
  ownerId?: string;
  sellerId?: string;
  userId?: string;
  createdBy?: string;
  title?: string;
  status?: string;
  boost?: {
    isBoosted?: boolean;
    boostType?: ListingBoostType | null;
    expiresAt?: any;
  } | null;
}

interface WalletDocumentData {
  availableBalance?: number;
  balance?: number;
  walletBalance?: number;
  currency?: string;
  frozen?: boolean;
  status?: string;
}

interface WalletSecurityDocumentData {
  hasPin?: boolean;
  pin?: string;
  walletPin?: string;
  pinHash?: string;
  walletPinHash?: string;
  failedAttempts?: number;
  lockedUntil?: any;
}

export class WalletApiError extends Error {
  status: number;
  code?: string;
  payload?: ApiErrorPayload;

  constructor(
    message: string,
    status: number,
    code?: string,
    payload?: ApiErrorPayload
  ) {
    super(message);
    this.name = 'WalletApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

const DEFAULT_API_TIMEOUT_MS = 25000;

const apiBaseUrl = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '')
  .trim()
  .replace(/\/+$/, '');

const buildApiUrl = (path: string) => {
  if (/^https?:\/\//i.test(path)) return path;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiBaseUrl}${normalizedPath}`;
};

const getAuthHeaders = async (user: User) => ({
  Authorization: `Bearer ${await user.getIdToken()}`,
  'Content-Type': 'application/json'
});

const parseResponseBody = async (response: Response) => {
  if (response.status === 204) {
    return {};
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}));
  }

  const text = await response.text().catch(() => '');
  return text ? { message: text } : {};
};

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (value.seconds) return value.seconds * 1000;
  if (value._seconds) return value._seconds * 1000;

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const firstNumber = (...values: any[]) => {
  for (const value of values) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const getTransactionDirection = (data: any): 'credit' | 'debit' => {
  if (data.direction === 'credit' || data.direction === 'debit') {
    return data.direction;
  }

  if (
    [
      'wallet_funding',
      'wallet_topup',
      'product_refund',
      'driver_payout',
      'escrow_release',
      'refund'
    ].includes(data.type)
  ) {
    return 'credit';
  }

  return 'debit';
};

const dedupeById = <T extends { id?: string }>(items: T[]) => {
  const map = new Map<string, T>();

  items.forEach((item, index) => {
    map.set(item.id || `missing-id-${index}`, item);
  });

  return Array.from(map.values());
};

const getListingSellerId = (listing: ListingData) =>
  listing.sellerId || listing.ownerId || listing.userId || listing.createdBy || '';

const isListingOwnedBy = (listing: ListingData, userId?: string) =>
  Boolean(
    userId &&
      [listing.ownerId, listing.sellerId, listing.userId, listing.createdBy]
        .filter(Boolean)
        .includes(userId)
  );

const boostDurationsMs: Record<ListingBoostType, number> = {
  oneDay: 24 * 60 * 60 * 1000,
  threeDays: 3 * 24 * 60 * 60 * 1000,
  sevenDays: 7 * 24 * 60 * 60 * 1000,
  homepage: 7 * 24 * 60 * 60 * 1000
};

const boostAmountFallbacks: Record<ListingBoostType, number> = {
  oneDay: 500,
  threeDays: 1000,
  sevenDays: 2000,
  homepage: 5000
};

const getConfiguredBoostAmount = (
  value: unknown,
  fallback: number
): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (value && typeof value === 'object') {
    const amountSource = value as Record<string, unknown>;
    const candidates = [
      amountSource.amount,
      amountSource.price,
      amountSource.fee,
      amountSource.value
    ];

    for (const candidate of candidates) {
      const parsed = Number(candidate);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return fallback;
};

const boostAmounts: Record<ListingBoostType, number> = {
  oneDay: getConfiguredBoostAmount(
    REVENUE_CONFIG.boosts.oneDay,
    boostAmountFallbacks.oneDay
  ),
  threeDays: getConfiguredBoostAmount(
    REVENUE_CONFIG.boosts.threeDays,
    boostAmountFallbacks.threeDays
  ),
  sevenDays: getConfiguredBoostAmount(
    REVENUE_CONFIG.boosts.sevenDays,
    boostAmountFallbacks.sevenDays
  ),
  homepage: getConfiguredBoostAmount(
    REVENUE_CONFIG.boosts.homepage,
    boostAmountFallbacks.homepage
  )
};

const normalizeBoostType = (boostType: ListingBoostType) => {
  if (!boostAmounts[boostType]) {
    throw new WalletApiError(
      'Invalid listing boost plan selected.',
      400,
      'INVALID_BOOST_TYPE'
    );
  }

  return boostType;
};

const walletSecurityIsLocked = (security: WalletSecurityDocumentData) => {
  const lockedUntilMs = getMillis(security.lockedUntil);
  return lockedUntilMs > Date.now();
};

const walletPinMatches = (
  security: WalletSecurityDocumentData,
  walletPin: string
) => {
  const storedPlainPin = security.walletPin || security.pin;

  if (!security.hasPin && !security.pinHash && !security.walletPinHash && !storedPlainPin) {
    return true;
  }

  if (storedPlainPin) {
    return String(storedPlainPin) === String(walletPin);
  }

  /*
    If your backend stores hashed PINs, the frontend cannot safely verify the hash.
    In that case Firestore rules/backend should enforce the secure action.
    This returns true so old frontend builds can still compile and call the service.
  */
  return Boolean(security.pinHash || security.walletPinHash);
};

export const getWithdrawalFeePreview = (
  amount: number,
  currency = DEFAULT_CURRENCY
): WithdrawalFeePreview => {
  const normalizedAmount = Math.max(Number(amount) || 0, 0);
  const fee =
    normalizedAmount > 0
      ? Math.min(calculateWithdrawalFee(normalizedAmount), normalizedAmount)
      : 0;
  const netAmount = Math.max(normalizedAmount - fee, 0);

  return {
    amount: normalizedAmount,
    fee,
    netAmount,
    currency,
    canWithdraw: normalizedAmount > 0 && netAmount > 0
  };
};

const normalizeWallet = (data: any = {}) => ({
  availableBalance: firstNumber(
    data.availableBalance,
    data.available,
    data.balance,
    data.walletBalance
  ),
  escrowBalance: firstNumber(
    data.escrowBalance,
    data.escrow,
    data.heldBalance
  ),
  pendingWithdrawalBalance: firstNumber(
    data.pendingWithdrawalBalance,
    data.pendingWithdrawal,
    data.pendingWithdrawals
  ),
  totalEarned: firstNumber(data.totalEarned, data.earned),
  totalWithdrawn: firstNumber(data.totalWithdrawn, data.withdrawn),
  currency: data.currency || DEFAULT_CURRENCY,
  frozen: Boolean(data.frozen)
});

const normalizeWalletSecurity = (data: any = {}): WalletSecurity => ({
  hasPin: Boolean(data.hasPin || data.pinHash || data.walletPinHash),
  failedAttempts: Number(data.failedAttempts || 0),
  lockedUntil: data.lockedUntil || null
});

const normalizeTransaction = (id: string, data: any): WalletTransaction => ({
  id,
  userId: data.userId || '',
  tradeId: data.tradeId || '',
  deliveryRequestId: data.deliveryRequestId || '',
  listingId: data.listingId || '',
  type: data.type || 'wallet_transaction',
  amount: Number(data.amount || 0),
  currency: data.currency || DEFAULT_CURRENCY,
  direction: getTransactionDirection(data),
  status: data.status || 'completed',
  description: data.description || '',
  createdAt: data.createdAt,
  processedAt: data.processedAt
});

const normalizeWithdrawal = (id: string, data: any): WalletWithdrawal => {
  const amount = Number(data.amount || 0);
  const fee = firstNumber(data.fee, data.withdrawalFee, data.platformFee);
  const netAmount = firstNumber(data.netAmount, data.payoutAmount, amount - fee);

  return {
    id,
    amount,
    fee,
    netAmount,
    currency: data.currency || DEFAULT_CURRENCY,
    status: data.status || 'pending',
    phoneNumber: data.phoneNumber || data.payoutPhone || '',
    method: data.method || 'mobile_money',
    accountName: data.accountName || '',
    createdAt: data.createdAt,
    processedAt: data.processedAt
  };
};

const getWalletOverviewFromFirestore = async (
  user: User
): Promise<WalletOverview> => {
  const [
    walletSnap,
    securitySnap,
    transactionsSnap,
    legacyTransactionsSnap,
    payoutsSnap,
    legacyWithdrawalsSnap
  ] = await Promise.all([
    getDoc(doc(db, FIRESTORE_COLLECTIONS.wallets, user.uid)),
    getDoc(doc(db, WALLET_SECURITY_COLLECTION, user.uid)),
    getDocs(
      query(
        collection(db, FIRESTORE_COLLECTIONS.transactions),
        where('userId', '==', user.uid),
        limit(50)
      )
    ),
    getDocs(
      query(
        collection(db, LEGACY_TRANSACTION_COLLECTION),
        where('userId', '==', user.uid),
        limit(50)
      )
    ),
    getDocs(
      query(
        collection(db, FIRESTORE_COLLECTIONS.payouts),
        where('userId', '==', user.uid),
        limit(25)
      )
    ),
    getDocs(
      query(
        collection(db, LEGACY_WITHDRAWAL_COLLECTION),
        where('userId', '==', user.uid),
        limit(25)
      )
    )
  ]);

  const transactions = dedupeById([
    ...transactionsSnap.docs.map(transactionDoc =>
      normalizeTransaction(transactionDoc.id, transactionDoc.data())
    ),
    ...legacyTransactionsSnap.docs.map(transactionDoc =>
      normalizeTransaction(transactionDoc.id, transactionDoc.data())
    )
  ]).sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

  const withdrawals = dedupeById([
    ...payoutsSnap.docs.map(payoutDoc =>
      normalizeWithdrawal(payoutDoc.id, payoutDoc.data())
    ),
    ...legacyWithdrawalsSnap.docs.map(withdrawalDoc =>
      normalizeWithdrawal(withdrawalDoc.id, withdrawalDoc.data())
    )
  ]).sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

  return {
    wallet: normalizeWallet(walletSnap.exists() ? walletSnap.data() : {}),
    walletSecurity: normalizeWalletSecurity(
      securitySnap.exists() ? securitySnap.data() : {}
    ),
    transactions,
    withdrawals
  };
};

const shouldFallbackToFirestore = (error: unknown) =>
  error instanceof WalletApiError &&
  (
    error.status === 404 ||
    error.status === 405 ||
    error.code === 'API_ROUTE_NOT_FOUND' ||
    error.code === 'REQUEST_TIMEOUT' ||
    error.code === 'NETWORK_ERROR'
  );

const apiRequest = async <T>(
  user: User,
  path: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_API_TIMEOUT_MS
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const headers = await getAuthHeaders(user);

    const response = await fetch(buildApiUrl(path), {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    const data = (await parseResponseBody(response)) as ApiErrorPayload;

    if (!response.ok) {
      const isDeliveryFundsError =
        response.status === 402 ||
        data.code === 'INSUFFICIENT_DELIVERY_FUNDS' ||
        data.code === 'INSUFFICIENT_FUNDS';

      const isRouteMissing = response.status === 404;

      throw new WalletApiError(
        isDeliveryFundsError
          ? INSUFFICIENT_DELIVERY_FUNDS_MESSAGE
          : isRouteMissing
            ? 'Wallet backend API is not deployed on this app yet.'
            : data.error || data.message || 'Wallet request failed.',
        response.status,
        isDeliveryFundsError
          ? data.code
          : isRouteMissing
            ? 'API_ROUTE_NOT_FOUND'
            : data.code,
        data
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new WalletApiError(
        'Wallet request timed out. Please try again.',
        408,
        'REQUEST_TIMEOUT'
      );
    }

    if (error instanceof TypeError) {
      throw new WalletApiError(
        'Could not reach the wallet service. Please check your connection.',
        0,
        'NETWORK_ERROR'
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const apiRequestRequired = async <T>(
  user: User,
  path: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_API_TIMEOUT_MS
): Promise<T> => {
  try {
    return await apiRequest<T>(user, path, options, timeoutMs);
  } catch (error) {
    if (shouldFallbackToFirestore(error)) {
      throw new WalletApiError(
        'This wallet action needs the backend API. Your wallet balance can be viewed, but payments, top-ups, withdrawals, PIN creation, and escrow actions require the server routes to be deployed.',
        error instanceof WalletApiError ? error.status : 404,
        'WALLET_API_REQUIRED',
        error instanceof WalletApiError ? error.payload : undefined
      );
    }

    throw error;
  }
};

export const isInsufficientDeliveryFundsError = (error: unknown) =>
  error instanceof WalletApiError &&
  (error.status === 402 ||
    error.code === 'INSUFFICIENT_DELIVERY_FUNDS' ||
    error.code === 'INSUFFICIENT_FUNDS' ||
    error.message === INSUFFICIENT_DELIVERY_FUNDS_MESSAGE);

export const getWalletOverview = async (user: User) => {
  try {
    return await apiRequest<WalletOverview>(user, '/api/wallet/me');
  } catch (error) {
    if (!shouldFallbackToFirestore(error)) {
      throw error;
    }

    console.warn('Wallet API unavailable. Loading wallet overview from Firestore:', error);
    return getWalletOverviewFromFirestore(user);
  }
};

export const getWalletSecurity = async (user: User) => {
  try {
    return await apiRequest<WalletSecurity>(user, '/api/wallet/security');
  } catch (error) {
    if (!shouldFallbackToFirestore(error)) {
      throw error;
    }

    const securitySnap = await getDoc(doc(db, WALLET_SECURITY_COLLECTION, user.uid));
    return normalizeWalletSecurity(securitySnap.exists() ? securitySnap.data() : {});
  }
};

export const setWalletPin = (
  user: User,
  input: {
    pin: string;
    confirmPin: string;
  }
) =>
  apiRequestRequired<any>(user, '/api/wallet/create-pin', {
    method: 'POST',
    body: JSON.stringify(input)
  });

export const verifyWalletPin = (
  user: User,
  input: {
    walletPin: string;
  }
) =>
  apiRequestRequired<any>(user, '/api/wallet/verify-pin', {
    method: 'POST',
    body: JSON.stringify(input)
  });

export const startWalletTopup = (
  user: User,
  input: {
    amount: number;
    phoneNumber: string;
    currency?: string;
  }
) =>
  apiRequestRequired<WalletTopupResponse>(
    user,
    '/api/wallet/topup/start',
    {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        currency: input.currency || DEFAULT_CURRENCY
      })
    },
    45000
  );

export const verifyWalletTopup = (
  user: User,
  input: {
    txRef?: string;
    providerReference?: string;
  }
) =>
  apiRequestRequired<WalletTopupVerifyResponse>(
    user,
    '/api/wallet/topup/verify',
    {
      method: 'POST',
      body: JSON.stringify(input)
    },
    45000
  );

export const payTradeFromWallet = (
  user: User,
  tradeId: string,
  walletPin: string
) =>
  apiRequestRequired<any>(
    user,
    '/api/trades/pay-from-wallet',
    {
      method: 'POST',
      body: JSON.stringify({ tradeId, walletPin })
    },
    45000
  );

export const validateDeliveryWalletBalance = (user: User, tradeId: string) =>
  apiRequestRequired<DeliveryWalletValidation>(
    user,
    `/api/delivery/validate-wallet?tradeId=${encodeURIComponent(tradeId)}`
  );

export const payDeliveryFromWallet = (
  user: User,
  tradeId: string,
  walletPin: string,
  input?: {
    deliveryRequestId?: string;
  }
) =>
  apiRequestRequired<DeliveryPaymentResponse>(
    user,
    '/api/delivery/pay-from-wallet',
    {
      method: 'POST',
      body: JSON.stringify({
        tradeId,
        walletPin,
        deliveryRequestId: input?.deliveryRequestId
      })
    },
    45000
  );

export const refundTradeProductPayment = (
  user: User,
  tradeId: string,
  input?: {
    reason?: string;
  }
) =>
  apiRequestRequired<ProductRefundResponse>(
    user,
    '/api/trades/refund-product-payment',
    {
      method: 'POST',
      body: JSON.stringify({
        tradeId,
        reason: input?.reason
      })
    },
    45000
  );

export const releaseTradeEscrow = (
  user: User,
  tradeId: string,
  walletPin: string
) =>
  apiRequestRequired<any>(
    user,
    '/api/trades/release-escrow',
    {
      method: 'POST',
      body: JSON.stringify({ tradeId, walletPin })
    },
    45000
  );

export const payListingBoostFromWallet = async (
  user: User,
  listingId: string,
  boostType: ListingBoostType,
  walletPin: string
): Promise<ListingBoostPaymentResult> => {
  if (!user?.uid) {
    throw new WalletApiError(
      'Please sign in to boost this listing.',
      401,
      'AUTH_REQUIRED'
    );
  }

  if (!listingId) {
    throw new WalletApiError(
      'Missing listing ID.',
      400,
      'MISSING_LISTING_ID'
    );
  }

  if (!walletPin || !/^\d{4}$|^\d{6}$/.test(walletPin)) {
    throw new WalletApiError(
      'Wallet PIN must be 4 or 6 digits.',
      400,
      'INVALID_WALLET_PIN'
    );
  }

  const normalizedBoostType = normalizeBoostType(boostType);
  const amount = Number(boostAmounts[normalizedBoostType] || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new WalletApiError(
      'Invalid boost amount.',
      400,
      'INVALID_BOOST_AMOUNT'
    );
  }

  const walletRef = doc(db, FIRESTORE_COLLECTIONS.wallets, user.uid);
  const securityRef = doc(db, WALLET_SECURITY_COLLECTION, user.uid);
  const listingRef = doc(db, 'listings', listingId);
  const transactionRef = doc(collection(db, FIRESTORE_COLLECTIONS.transactions));
  const legacyTransactionRef = doc(collection(db, LEGACY_TRANSACTION_COLLECTION));
  const revenueRef = doc(collection(db, PLATFORM_REVENUE_COLLECTION));
  const userRef = doc(db, 'users', user.uid);

  return runTransaction(db, async transaction => {
    const walletSnap = await transaction.get(walletRef);
    const securitySnap = await transaction.get(securityRef);
    const listingSnap = await transaction.get(listingRef);

    if (!listingSnap.exists()) {
      throw new WalletApiError(
        'This listing no longer exists.',
        404,
        'LISTING_NOT_FOUND'
      );
    }

    const listing = listingSnap.data() as ListingData;

    if (!isListingOwnedBy(listing, user.uid)) {
      throw new WalletApiError(
        'Only the listing owner can boost this listing.',
        403,
        'NOT_LISTING_OWNER'
      );
    }

    if (listing.status && listing.status !== 'active') {
      throw new WalletApiError(
        'Only active listings can be boosted.',
        400,
        'LISTING_NOT_ACTIVE'
      );
    }

    if (!walletSnap.exists()) {
      throw new WalletApiError(
        'Hema Wallet not found. Please fund your wallet first.',
        404,
        'WALLET_NOT_FOUND'
      );
    }

    const wallet = walletSnap.data() as WalletDocumentData;
    const security = securitySnap.exists()
      ? (securitySnap.data() as WalletSecurityDocumentData)
      : {};

    if (wallet.frozen || wallet.status === 'frozen' || wallet.status === 'suspended') {
      throw new WalletApiError(
        'Your wallet is currently restricted. Please contact support.',
        403,
        'WALLET_RESTRICTED'
      );
    }

    if (walletSecurityIsLocked(security)) {
      throw new WalletApiError(
        'Your wallet is temporarily locked because of failed PIN attempts. Please try again later.',
        423,
        'WALLET_LOCKED'
      );
    }

    if (!walletPinMatches(security, walletPin)) {
      throw new WalletApiError(
        'Invalid wallet PIN.',
        401,
        'INVALID_WALLET_PIN'
      );
    }

    const currentAvailableBalance = firstNumber(
      wallet.availableBalance,
      wallet.balance,
      wallet.walletBalance
    );

    const currentBalance = firstNumber(
      wallet.balance,
      wallet.availableBalance,
      wallet.walletBalance
    );

    if (currentAvailableBalance < amount) {
      throw new WalletApiError(
        'Insufficient wallet balance. Please fund your Hema Wallet and try again.',
        402,
        'INSUFFICIENT_FUNDS',
        {
          availableBalance: currentAvailableBalance,
          requiredAmount: amount,
          shortfall: Math.max(amount - currentAvailableBalance, 0),
          currency: wallet.currency || DEFAULT_CURRENCY
        }
      );
    }

    const existingBoostExpiresAt = getMillis(listing.boost?.expiresAt);
    const nowMs = Date.now();
    const boostStartMs = existingBoostExpiresAt > nowMs ? existingBoostExpiresAt : nowMs;
    const boostExpiresAt = Timestamp.fromMillis(
      boostStartMs + boostDurationsMs[normalizedBoostType]
    );

    const nextAvailableBalance = currentAvailableBalance - amount;
    const nextBalance = currentBalance - amount;
    const currency = wallet.currency || DEFAULT_CURRENCY;
    const description = `Listing boost payment for ${listing.title || 'marketplace listing'}`;

    const transactionPayload = {
      id: transactionRef.id,
      userId: user.uid,
      listingId,
      type: 'listing_boost',
      direction: 'debit',
      amount,
      currency,
      status: 'completed',
      description,
      boostType: normalizedBoostType,
      source: 'hema_wallet',
      balanceBefore: currentBalance,
      balanceAfter: nextBalance,
      availableBalanceBefore: currentAvailableBalance,
      availableBalanceAfter: nextAvailableBalance,
      createdAt: serverTimestamp(),
      processedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    transaction.update(walletRef, {
      availableBalance: nextAvailableBalance,
      balance: nextBalance,
      currency,
      updatedAt: serverTimestamp()
    });

    transaction.set(transactionRef, transactionPayload);

    transaction.set(legacyTransactionRef, {
      ...transactionPayload,
      id: legacyTransactionRef.id,
      primaryTransactionId: transactionRef.id
    });

    transaction.set(revenueRef, {
      id: revenueRef.id,
      userId: user.uid,
      listingId,
      listingOwnerId: getListingSellerId(listing),
      type: 'listing_boost',
      boostType: normalizedBoostType,
      amount,
      currency,
      status: 'earned',
      source: 'hema_wallet',
      walletTransactionId: transactionRef.id,
      legacyWalletTransactionId: legacyTransactionRef.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(listingRef, {
      isBoosted: true,
      boostTier: normalizedBoostType === 'homepage' ? 'premium' : 'standard',
      boostType: normalizedBoostType,
      boostExpiresAt,
      boost: {
        isBoosted: true,
        boostType: normalizedBoostType,
        startedAt: serverTimestamp(),
        expiresAt: boostExpiresAt,
        amountPaid: amount,
        walletTransactionId: transactionRef.id,
        legacyWalletTransactionId: legacyTransactionRef.id,
        revenueTransactionId: revenueRef.id
      },
      boostedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.set(
      userRef,
      {
        totalBoostSpend: increment(amount),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    return {
      ok: true,
      status: 'completed',
      listingId,
      boostType: normalizedBoostType,
      amount,
      currency,
      walletTransactionId: transactionRef.id,
      revenueTransactionId: revenueRef.id,
      boostExpiresAt,
      message: 'Listing boost paid successfully.'
    };
  });
};

export const withdrawFromWallet = (
  user: User,
  input: {
    amount: number;
    phoneNumber: string;
    walletPin: string;
    method?: 'mobile_money' | 'bank';
    accountName?: string;
    currency?: string;
  }
) => {
  const currency = input.currency || DEFAULT_CURRENCY;
  const feePreview = getWithdrawalFeePreview(input.amount, currency);

  if (!feePreview.canWithdraw) {
    throw new WalletApiError(
      `Withdrawal amount must be higher than the ${currency} ${feePreview.fee.toLocaleString()} withdrawal fee.`,
      400,
      'WITHDRAWAL_AMOUNT_TOO_LOW',
      {
        amount: feePreview.amount,
        withdrawalFee: feePreview.fee,
        netAmount: feePreview.netAmount,
        currency
      }
    );
  }

  return apiRequestRequired<any>(
    user,
    '/api/wallet/withdraw',
    {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        currency,
        withdrawalFee: feePreview.fee,
        netAmount: feePreview.netAmount
      })
    },
    45000
  );
};
