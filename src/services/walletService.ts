import type { User } from 'firebase/auth';

const getAuthHeaders = async (user: User) => ({
  Authorization: `Bearer ${await user.getIdToken()}`,
  'Content-Type': 'application/json'
});

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

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Wallet request failed.');
  }

  return data as T;
};

export interface WalletSecurity {
  hasPin: boolean;
  failedAttempts: number;
  lockedUntil: any;
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
  transactions: any[];
  withdrawals: any[];
}

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
  apiRequest<any>(user, '/api/wallet/topup/start', {
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

export const payDeliveryFromWallet = (
  user: User,
  tradeId: string,
  walletPin: string
) =>
  apiRequest<any>(user, '/api/delivery/pay-from-wallet', {
    method: 'POST',
    body: JSON.stringify({ tradeId, walletPin })
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
