import type { User } from 'firebase/auth';

export const INSUFFICIENT_DELIVERY_FUNDS_MESSAGE =
  'Your Hema Trader balance is not enough to hire this driver. Please fund your account to continue delivery.';

const DEFAULT_API_TIMEOUT_MS = 25000;

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export type WalletTransactionType =
  | 'product_payment'
  | 'product_refund'
  | 'delivery_payment'
  | 'driver_payout'
  | 'wallet_funding'
  | 'wallet_topup'
  | 'escrow_hold'
  | 'escrow_release'
  | 'delivery_escrow_hold'
  | 'delivery_escrow_release'
  | 'platform_fee'
  | 'refund'
  | 'withdrawal'
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
  listingId?: string;
  deliveryRequestId?: string;
  withdrawalId?: string;
  txRef?: string;
  provider?: string;
  providerReference?: string;
  counterpartyId?: string;
  type: WalletTransactionType;
  amount: number;
  currency: string;
  direction?: 'credit' | 'debit' | string;
  status: WalletTransactionStatus;
  description?: string;
  reason?: string;
  createdAt?: any;
  updatedAt?: any;
  processedAt?: any;
}

export interface WalletWithdrawal {
  id?: string;
  amount: number;
  currency: string;
  status: WalletTransactionStatus;
  phoneNumber?: string;
  method?: 'mobile_money' | 'bank';
  accountName?: string;
  provider?: string;
  providerReference?: string;
  providerStatus?: string;
  createdAt?: any;
  updatedAt?: any;
  processedAt?: any;
  completedAt?: any;
}

export interface WalletOverview {
  wallet: {
    userId?: string;
    availableBalance: number;
    escrowBalance: number;
    pendingWithdrawalBalance: number;
    totalEarned: number;
    totalWithdrawn: number;
    currency: string;
    frozen?: boolean;
    riskScore?: number;
  };
  walletSecurity?: WalletSecurity;
  transactions: WalletTransaction[];
  withdrawals: WalletWithdrawal[];
}

export interface WalletTopupResponse {
  ok?: boolean;
  txRef?: string;
  amount?: number;
  currency?: string;
  providerReference?: string;
  checkoutUrl?: string;
  ussdCode?: string;
  ussd_code?: string;
  operator?: string;
  status?: string;
  message?: string;
  providerResponse?: any;
}

export interface WalletTopupVerifyResponse {
  ok?: boolean;
  status: string;
  credited?: boolean;
  message?: string;
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
  tradeId: string;
  deliveryRequestId?: string;
  status?: 'paid' | 'unpaid' | 'pending_funding' | 'failed' | 'refunded' | string;
  deliveryPaymentStatus?:
    | 'unpaid'
    | 'pending_funding'
    | 'paid'
    | 'failed'
    | 'refunded';
  deliveryStatus?: string;
  agreedFee?: number;
  deliveryFeePaid?: number;
  availableBalance?: number;
  requiredAmount?: number;
  shortfall?: number;
  currency?: string;
  walletTransactionId?: string;
  deliveryPaymentRequiredAt?: any;
  deliveryPaymentDeadlineAt?: any;
  message?: string;
}

export interface ProductRefundResponse {
  ok?: boolean;
  tradeId: string;
  refundProcessed: boolean;
  refundProcessedAt?: any;
  walletTransactionId?: string;
  message?: string;
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

type ApiRequestOptions = RequestInit & {
  timeoutMs?: number;
};

export class WalletApiError extends Error {
  status: number;
  code?: string;
  payload?: ApiErrorPayload;

  constructor(message: string, status: number, code?: string, payload?: ApiErrorPayload) {
    super(message);
    this.name = 'WalletApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;

    Object.setPrototypeOf(this, WalletApiError.prototype);
  }
}

const buildApiUrl = (path: string) => {
  if (/^https?:\/\//i.test(path)) return path;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
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

const getErrorMessage = (
  response: Response,
  data: ApiErrorPayload,
  fallback = 'Wallet request failed.'
) => {
  const isDeliveryFundsError =
    response.status === 402 ||
    data.code === 'INSUFFICIENT_DELIVERY_FUNDS' ||
    data.code === 'INSUFFICIENT_FUNDS';

  if (isDeliveryFundsError) return INSUFFICIENT_DELIVERY_FUNDS_MESSAGE;

  return data.error || data.message || fallback;
};

const apiRequest = async <T>(
  user: User,
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> => {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, headers: optionHeaders, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    const headers = await getAuthHeaders(user);

    response = await fetch(buildApiUrl(path), {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...headers,
        ...(optionHeaders || {})
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new WalletApiError(
        'Wallet request timed out. Please check your connection and try again.',
        408,
        'REQUEST_TIMEOUT'
      );
    }

    throw new WalletApiError(
      error instanceof Error
        ? error.message
        : 'Network error while contacting the wallet service.',
      0,
      'NETWORK_ERROR'
    );
  } finally {
    window.clearTimeout(timeoutId);
  }

  const data = (await parseResponseBody(response)) as ApiErrorPayload;

  if (!response.ok) {
    throw new WalletApiError(
      getErrorMessage(response, data),
      response.status,
      data.code,
      data
    );
  }

  return data as T;
};

export const isInsufficientDeliveryFundsError = (error: unknown) =>
  error instanceof WalletApiError &&
  (error.status === 402 ||
    error.code === 'INSUFFICIENT_DELIVERY_FUNDS' ||
    error.code === 'INSUFFICIENT_FUNDS' ||
    error.message === INSUFFICIENT_DELIVERY_FUNDS_MESSAGE);

export const getWalletOverview = (user: User) =>
  apiRequest<WalletOverview>(user, '/api/wallet/me', {
    timeoutMs: 20000
  });

export const getWalletSecurity = (user: User) =>
  apiRequest<WalletSecurity>(user, '/api/wallet/security');

export const setWalletPin = (
  user: User,
  input: {
    pin: string;
    confirmPin: string;
  }
) =>
  apiRequest<any>(user, '/api/wallet/create-pin', {
    method: 'POST',
    body: JSON.stringify(input)
  });

export const verifyWalletPin = (
  user: User,
  input: {
    walletPin: string;
  }
) =>
  apiRequest<any>(user, '/api/wallet/verify-pin', {
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
  apiRequest<WalletTopupResponse>(user, '/api/wallet/topup/start', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: 45000
  });

export const verifyWalletTopup = (
  user: User,
  input: {
    txRef?: string;
    providerReference?: string;
  }
) =>
  apiRequest<WalletTopupVerifyResponse>(user, '/api/wallet/topup/verify', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: 45000
  });

export const payTradeFromWallet = (
  user: User,
  tradeId: string,
  walletPin: string
) =>
  apiRequest<any>(user, '/api/trades/pay-from-wallet', {
    method: 'POST',
    body: JSON.stringify({ tradeId, walletPin }),
    timeoutMs: 45000
  });

export const validateDeliveryWalletBalance = (user: User, tradeId: string) =>
  apiRequest<DeliveryWalletValidation>(
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
  apiRequest<DeliveryPaymentResponse>(user, '/api/delivery/pay-from-wallet', {
    method: 'POST',
    body: JSON.stringify({
      tradeId,
      walletPin,
      deliveryRequestId: input?.deliveryRequestId
    }),
    timeoutMs: 45000
  });

export const refundTradeProductPayment = (
  user: User,
  tradeId: string,
  input?: {
    reason?: string;
  }
) =>
  apiRequest<ProductRefundResponse>(user, '/api/trades/refund-product-payment', {
    method: 'POST',
    body: JSON.stringify({
      tradeId,
      reason: input?.reason
    }),
    timeoutMs: 45000
  });

export const releaseTradeEscrow = (
  user: User,
  tradeId: string,
  walletPin: string
) =>
  apiRequest<any>(user, '/api/trades/release-escrow', {
    method: 'POST',
    body: JSON.stringify({ tradeId, walletPin }),
    timeoutMs: 45000
  });

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
) =>
  apiRequest<any>(user, '/api/wallet/withdraw', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: 45000
  });
