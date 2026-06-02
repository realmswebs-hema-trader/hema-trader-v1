export type ModeratorApplicationStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type ModeratorAvailability = 'available' | 'busy' | 'offline';

export type ModeratorDeliveryStatus =
  | 'moderator_requested'
  | 'moderator_assigned'
  | 'moderator_accepted'
  | 'moderator_declined'
  | 'picked_up_by_moderator'
  | 'in_transit_by_moderator'
  | 'delivered_by_moderator'
  | 'completed'
  | 'cancelled'
  | 'frozen_by_admin';

export type ModeratorPaymentStatus =
  | 'unpaid'
  | 'payment_requested'
  | 'paid'
  | 'released_to_moderator'
  | 'refunded';

export interface ModeratorProfile {
  id: string;
  uid?: string;
  email?: string;
  displayName?: string;
  name?: string;
  photoURL?: string;
  phoneNumber?: string;
  phoneVerified?: boolean;
  identityVerified?: boolean;
  roles?: string[];
  isModerator?: boolean;
  moderatorVerified?: boolean;
  moderatorStatus?: ModeratorApplicationStatus;
  moderatorApplicationStatus?: ModeratorApplicationStatus;
  moderatorAvailability?: ModeratorAvailability;
  moderatorCity?: string;
  moderatorRegions?: string[];
  moderatorRoutes?: string[];
  moderatorTransportCapacity?: string;
  moderatorRating?: number;
  completedModeratorDeliveries?: number;
  trustScore?: number;
  moderatorWalletBalance?: number;
  moderatorCanWithdrawImmediately?: boolean;
}

export interface ModeratorApplicationInput {
  fullName: string;
  phoneNumber: string;
  cityOrRegion: string;
  routes: string[];
  transportCapacity: string;
  identityDocumentUrl?: string;
  acceptedTerms: boolean;
}

export interface ModeratorApplication {
  id: string;
  userId: string;
  email?: string;
  displayName?: string;
  phoneNumber: string;
  cityOrRegion: string;
  routes: string[];
  transportCapacity: string;
  identityDocumentUrl?: string;
  acceptedTerms: boolean;
  status: ModeratorApplicationStatus;
  reviewedBy?: string;
  reviewedAt?: any;
  rejectionReason?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface ModeratorDeliveryRequestInput {
  tradeId: string;
  listingId?: string;
  buyerId: string;
  sellerId: string;
  moderatorId: string;
  moderatorName?: string;
  pickupAddress: string;
  dropoffAddress: string;
  routeLabel?: string;
  moderatorFee: number;
  currencyCode?: string;
  currencyLocale?: string;
  buyerPhone?: string;
  sellerPhone?: string;
}

export interface ModeratorDeliveryRequest {
  id: string;
  tradeId: string;
  listingId?: string;
  buyerId: string;
  sellerId: string;
  moderatorId: string;
  moderatorName?: string;
  status: ModeratorDeliveryStatus;
  pickupAddress: string;
  dropoffAddress: string;
  routeLabel?: string;
  moderatorFee: number;
  moderatorPlatformFee: number;
  moderatorNetEarning: number;
  currencyCode: string;
  currencyLocale: string;
  moderatorPaymentStatus: ModeratorPaymentStatus;
  moderatorCanWithdrawImmediately: boolean;
  moderatorCanSeeBuyerPhone: boolean;
  moderatorCanSeeSellerPhone: boolean;
  buyerPhone?: string;
  sellerPhone?: string;
  createdAt?: any;
  updatedAt?: any;
  moderatorAssignedAt?: any;
  moderatorAcceptedAt?: any;
  moderatorPickedUpAt?: any;
  moderatorDeliveredAt?: any;
  moderatorPaidAt?: any;
  moderatorWalletId?: string;
}

export const moderatorApplicationStatusLabels: Record<
  ModeratorApplicationStatus,
  string
> = {
  pending_review: 'Pending Admin Review',
  approved: 'Approved Moderator',
  rejected: 'Application Rejected',
  suspended: 'Moderator Suspended'
};

export const moderatorDeliveryStatusLabels: Record<
  ModeratorDeliveryStatus,
  string
> = {
  moderator_requested: 'Waiting for Moderator',
  moderator_assigned: 'Moderator Assigned',
  moderator_accepted: 'Moderator Accepted',
  moderator_declined: 'Moderator Declined',
  picked_up_by_moderator: 'Product Picked Up',
  in_transit_by_moderator: 'In Transit',
  delivered_by_moderator: 'Delivered by Moderator',
  completed: 'Completed',
  cancelled: 'Cancelled',
  frozen_by_admin: 'Frozen by Admin'
};

