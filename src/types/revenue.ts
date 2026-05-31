import type { Timestamp } from 'firebase/firestore';
import type { BoostType, SubscriptionPlan, UserRole } from '../config/revenueConfig';

export type RevenueCategory =
  | 'trade_fee'
  | 'delivery_commission'
  | 'subscription'
  | 'listing_boost'
  | 'verification'
  | 'withdrawal_fee';

export interface UserSubscription {
  plan: SubscriptionPlan;
  role: Exclude<UserRole, 'admin'>;
  status: 'active' | 'expired' | 'cancelled';
  startedAt: Timestamp;
  expiresAt: Timestamp;
  paymentStatus: 'paid' | 'unpaid' | 'trial';
}

export interface ListingBoost {
  isBoosted: boolean;
  boostType: BoostType | null;
  startedAt: Timestamp | null;
  expiresAt: Timestamp | null;
  amountPaid: number;
}

export interface PlatformRevenueRecord {
  id?: string;
  category: RevenueCategory;
  amount: number;
  currency: 'XAF';
  source: 'trade' | 'delivery' | 'subscription' | 'boost' | 'verification' | 'withdrawal';
  userId?: string;
  sellerId?: string;
  buyerId?: string;
  driverId?: string;
  tradeId?: string;
  listingId?: string;
  deliveryId?: string;
  subscriptionId?: string;
  boostId?: string;
  verificationId?: string;
  payoutId?: string;
  monthKey: string;
  createdAt: Timestamp;
  createdBy: 'server' | 'admin';
  metadata?: Record<string, any>;
}
