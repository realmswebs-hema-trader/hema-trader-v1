import type { User } from 'firebase/auth';

export const INSUFFICIENT_DELIVERY_FUNDS_MESSAGE =
  'Your Hema Trader balance is not enough to hire this driver. Please fund your account to continue delivery.';

export type WalletTransactionType =
  | 'product_payment'
  | 'product_refund'
  | 'delivery_payment'
  | 'driver_payout'
  | 'wallet_funding'
  | 'withdrawal'
  | 'escrow_release';

export type WalletTransactionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'refunded';

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
  type: WalletTransactionType;
  amount: number;
  currency: string;
  status: WalletTransactionStatus;
  description?: string;
  createdAt?: any;
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
  txRef?: string;
  providerReference?: string;
  checkoutUrl?: string;
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
  }
}

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

const apiRequest = async <T>(
  user: User,
  path: string,
  options: RequestInit = {}
): Promise<T> => {
  const headers = await getAuthHeaders(user);

  const response = await fetch(path, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  });

  const data = (await parseResponseBody(response)) as ApiErrorPayload;

  if (!response.ok) {
    const isDeliveryFundsError =
      response.status === 402 ||
      data.code === 'INSUFFICIENT_DELIVERY_FUNDS' ||
      data.code === 'INSUFFICIENT_FUNDS';

    throw new WalletApiError(
      isDeliveryFundsError
        ? INSUFFICIENT_DELIVERY_FUNDS_MESSAGE
        : data.error || data.message || 'Wallet request failed.',
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
  apiRequest<WalletOverview>(user, '/api/wallet/me');

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
    body: JSON.stringify(input)
  });

export const verifyWalletTopup = (
  user: User,
  input: {
    txRef?: string;
    providerReference?: string;
  }
) =>
  apiRequest<any>(user, '/api/wallet/topup/verify', {
    method: 'POST',
    body: JSON.stringify(input)
  });

export const payTradeFromWallet = (
  user: User,
  tradeId: string,
  walletPin: string
) =>
  apiRequest<any>(user, '/api/trades/pay-from-wallet', {
    method: 'POST',
    body: JSON.stringify({ tradeId, walletPin })
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
    })
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
    })
  });

export const releaseTradeEscrow = (
  user: User,
  tradeId: string,
  walletPin: string
) =>
  apiRequest<any>(user, '/api/trades/release-escrow', {
    method: 'POST',
    body: JSON.stringify({ tradeId, walletPin })
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
    body: JSON.stringify(input)
  });
