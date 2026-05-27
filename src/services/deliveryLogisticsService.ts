import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch
} from 'firebase/firestore';

import { db } from '../lib/firebase';

export const DELIVERY_PAYMENT_TIMEOUT_MS = 30 * 60 * 1000;

export const DELIVERY_PAYMENT_REQUIRED_MESSAGE =
  'Your Hema Trader balance is not enough to hire this driver. Please fund your account to continue delivery.';

export const DELIVERY_AUTO_CANCEL_MESSAGE =
  'Delivery payment was not completed within 30 minutes. The trade has been cancelled and the buyer has been refunded.';

export type DeliveryNegotiationStatus =
  | 'delivery_requested'
  | 'driver_countered'
  | 'buyer_countered'
  | 'delivery_price_agreed'
  | 'delivery_fee_paid'
  | 'driver_en_route_to_pickup'
  | 'product_picked_up'
  | 'delivery_in_progress'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export type DeliveryRequestStatus =
  | 'delivery_requested'
  | 'accepted'
  | 'declined'
  | 'driver_countered'
  | 'buyer_countered'
  | 'price_agreed'
  | 'delivery_fee_paid'
  | 'driver_en_route_to_pickup'
  | 'product_picked_up'
  | 'delivery_in_progress'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export type DeliveryPaymentStatus =
  | 'unpaid'
  | 'pending_funding'
  | 'paid'
  | 'failed'
  | 'refunded';

export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  delivery_requested: 'Delivery requested',
  accepted: 'Driver accepted',
  declined: 'Driver declined',
  driver_countered: 'Driver countered',
  buyer_countered: 'Buyer countered',
  price_agreed: 'Delivery price agreed',
  delivery_price_agreed: 'Delivery price agreed',
  delivery_fee_paid: 'Delivery fee paid',
  driver_en_route_to_pickup: 'Driver going to pickup',
  product_picked_up: 'Product picked up',
  delivery_in_progress: 'Delivery in progress',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  assigned: 'Driver selected',
  rejected: 'Driver declined',
  picked_up: 'Product picked up'
};

export const deliveryStatusLabel = (status?: string) =>
  status ? DELIVERY_STATUS_LABELS[status] || status.replaceAll('_', ' ') : 'Not started';

export interface DeliveryRequestInput {
  tradeId: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
  listingTitle: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  proposedFee: number;
  currency?: string;
  distanceKm?: number | null;
  buyerInfo?: Record<string, any>;
  sellerInfo?: Record<string, any>;
  sendNotification?: (
    userId: string,
    notification: {
      title: string;
      body: string;
      type?: string;
      targetId?: string;
      targetType?: string;
      actionUrl?: string;
    }
  ) => Promise<any>;
}

export interface DeliveryOfferInput {
  tradeId: string;
  deliveryRequestId?: string;
  senderId: string;
  buyerId: string;
  driverId: string;
  amount: number;
}

const toDateMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const getDeliveryDeadlineMillis = (trade: any) =>
  toDateMillis(trade?.deliveryPaymentDeadlineAt);

export const getDeliveryCountdown = (trade: any) => {
  const deadline = getDeliveryDeadlineMillis(trade);

  if (!deadline || trade?.deliveryPaymentStatus === 'paid') {
    return {
      active: false,
      expired: false,
      remainingMs: 0,
      label: ''
    };
  }

  const remainingMs = Math.max(deadline - Date.now(), 0);

  return {
    active: remainingMs > 0,
    expired: remainingMs <= 0,
    remainingMs,
    label: formatDeliveryCountdown(remainingMs)
  };
};

export const formatDeliveryCountdown = (remainingMs: number) => {
  const totalSeconds = Math.max(Math.floor(remainingMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const isDeliveryPaymentPendingFunding = (trade: any) =>
  trade?.deliveryPaymentStatus === 'pending_funding' &&
  trade?.deliveryPaymentDeadlineAt &&
  trade?.status !== 'cancelled';

export const requestDeliveryFromAvailableDrivers = async (input: DeliveryRequestInput) => {
  if (!Number.isFinite(input.proposedFee) || input.proposedFee <= 0) {
    throw new Error('Enter a valid proposed delivery fee.');
  }

  const driverSnap = await getDocs(
    query(collection(db, 'users'), where('roles', 'array-contains', 'driver'))
  );

  const availableDrivers = driverSnap.docs
    .map(driverDoc => ({ id: driverDoc.id, ...driverDoc.data() }))
    .filter((driver: any) => {
      const available =
        driver.driverStatus === 'available' ||
        driver.availabilityStatus === 'available' ||
        driver.available === true;

      const online =
        driver.isOnline === true ||
        driver.online === true ||
        driver.presence === 'online';

      return available && online;
    });

  if (availableDrivers.length === 0) {
    throw new Error('No online available drivers were found right now.');
  }

  const batch = writeBatch(db);
  const tradeRef = doc(db, 'trades', input.tradeId);
  const requestRefs = availableDrivers.map(driver =>
    doc(collection(db, 'deliveryRequests'))
  );

  requestRefs.forEach((requestRef, index) => {
    const driver = availableDrivers[index];

    batch.set(requestRef, {
      tradeId: input.tradeId,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      driverId: driver.id,
      listingId: input.listingId,
      listingTitle: input.listingTitle,
      pickupLocation: input.pickupLocation || 'Seller pickup location',
      dropoffLocation: input.dropoffLocation || 'Buyer delivery location',
      proposedFee: input.proposedFee,
      counterFee: null,
      agreedFee: null,
      currency: input.currency || 'XAF',
      distanceKm: input.distanceKm || null,
      buyerInfo: input.buyerInfo || {},
      sellerInfo: input.sellerInfo || {},
      status: 'delivery_requested',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      acceptedAt: null,
      declinedAt: null,
      deliveryFeePaidAt: null,
      pickupStartedAt: null,
      pickedUpAt: null,
      deliveryStartedAt: null,
      deliveredAt: null
    });
  });

  batch.update(tradeRef, {
    deliveryRequestStatus: 'open',
    deliveryNegotiationStatus: 'delivery_requested',
    deliveryBargainStatus: 'delivery_requested',
    deliveryStatus: 'delivery_requested',
    deliveryFee: input.proposedFee,
    deliveryFeeAgreed: false,
    deliveryPaymentStatus: 'unpaid',
    deliveryPaymentRequiredAt: null,
    deliveryPaymentDeadlineAt: null,
    deliveryBroadcastDriverIds: availableDrivers.map(driver => driver.id),
    deliveryRequestIds: requestRefs.map(requestRef => requestRef.id),
    updatedAt: serverTimestamp()
  });

  await batch.commit();

  if (input.sendNotification) {
    await Promise.all(
      availableDrivers.map(driver =>
        input.sendNotification!(driver.id, {
          title: 'New Delivery Request',
          body: `${input.listingTitle} needs delivery. Proposed fee: ${input.currency || 'XAF'} ${input.proposedFee.toLocaleString()}.`,
          type: 'delivery',
          targetId: input.tradeId,
          targetType: 'trade',
          actionUrl: `/trade/${input.tradeId}`
        })
      )
    );
  }

  return {
    driverCount: availableDrivers.length,
    driverIds: availableDrivers.map(driver => driver.id),
    deliveryRequestIds: requestRefs.map(requestRef => requestRef.id)
  };
};

export const acceptDeliveryRequest = async (input: {
  tradeId: string;
  deliveryRequestId: string;
  driverId: string;
}) => {
  await runTransaction(db, async transaction => {
    const tradeRef = doc(db, 'trades', input.tradeId);
    const requestRef = doc(db, 'deliveryRequests', input.deliveryRequestId);

    const tradeSnap = await transaction.get(tradeRef);
    const requestSnap = await transaction.get(requestRef);

    if (!tradeSnap.exists()) throw new Error('Trade not found.');
    if (!requestSnap.exists()) throw new Error('Delivery request not found.');

    const trade = tradeSnap.data();
    const request = requestSnap.data();

    if (request.driverId !== input.driverId) {
      throw new Error('Only the requested driver can accept this delivery.');
    }

    if (trade.driverId && trade.driverId !== input.driverId) {
      throw new Error('Another driver has already accepted this delivery.');
    }

    transaction.update(requestRef, {
      status: 'accepted',
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(tradeRef, {
      driverId: input.driverId,
      assignedDriverId: input.driverId,
      deliveryRequestId: input.deliveryRequestId,
      deliveryRequestStatus: 'accepted',
      deliveryStatus: 'accepted',
      deliveryNegotiationStatus: 'delivery_requested',
      deliveryBargainStatus: 'negotiating_delivery_fee',
      deliveryPaymentStatus: 'unpaid',
      updatedAt: serverTimestamp()
    });
  });
};

export const declineDeliveryRequest = async (input: {
  tradeId: string;
  deliveryRequestId: string;
  driverId: string;
}) => {
  await runTransaction(db, async transaction => {
    const requestRef = doc(db, 'deliveryRequests', input.deliveryRequestId);
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) throw new Error('Delivery request not found.');

    const request = requestSnap.data();

    if (request.driverId !== input.driverId) {
      throw new Error('Only the requested driver can decline this delivery.');
    }

    transaction.update(requestRef, {
      status: 'declined',
      declinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
};

export const sendDeliveryCounterOffer = async (input: DeliveryOfferInput) => {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Enter a valid delivery fee.');
  }

  const recipientId = input.senderId === input.buyerId ? input.driverId : input.buyerId;
  const negotiationStatus: DeliveryNegotiationStatus =
    input.senderId === input.buyerId ? 'buyer_countered' : 'driver_countered';

  await runTransaction(db, async transaction => {
    const tradeRef = doc(db, 'trades', input.tradeId);
    const offerRef = doc(collection(db, 'trades', input.tradeId, 'offers'));

    const tradeSnap = await transaction.get(tradeRef);
    if (!tradeSnap.exists()) throw new Error('Trade not found.');

    transaction.set(offerRef, {
      type: 'delivery',
      senderId: input.senderId,
      recipientId,
      amount: input.amount,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(tradeRef, {
      deliveryFee: input.amount,
      deliveryFeeAgreed: false,
      deliveryNegotiationStatus: negotiationStatus,
      deliveryBargainStatus: negotiationStatus,
      updatedAt: serverTimestamp()
    });

    if (input.deliveryRequestId) {
      transaction.update(doc(db, 'deliveryRequests', input.deliveryRequestId), {
        status: negotiationStatus,
        counterFee: input.amount,
        updatedAt: serverTimestamp()
      });
    }
  });
};

export const lockAgreedDeliveryFee = async (input: {
  tradeId: string;
  deliveryRequestId?: string;
  amount: number;
}) => {
  const now = Date.now();
  const deadline = Timestamp.fromDate(new Date(now + DELIVERY_PAYMENT_TIMEOUT_MS));

  await runTransaction(db, async transaction => {
    const tradeRef = doc(db, 'trades', input.tradeId);
    const tradeSnap = await transaction.get(tradeRef);

    if (!tradeSnap.exists()) throw new Error('Trade not found.');

    const trade = tradeSnap.data();

    if (trade.deliveryPaymentStatus === 'paid') {
      throw new Error('Delivery fee has already been paid.');
    }

    transaction.update(tradeRef, {
      deliveryFee: input.amount,
      agreedDeliveryFee: input.amount,
      driverCommission: input.amount * 0.8,
      deliveryFeeAgreed: true,
      deliveryNegotiationStatus: 'delivery_price_agreed',
      deliveryBargainStatus: 'accepted',
      deliveryPaymentStatus: 'unpaid',
      deliveryPaymentRequiredAt: trade.deliveryPaymentRequiredAt || serverTimestamp(),
      deliveryPaymentDeadlineAt: trade.deliveryPaymentDeadlineAt || deadline,
      updatedAt: serverTimestamp()
    });

    if (input.deliveryRequestId) {
      transaction.update(doc(db, 'deliveryRequests', input.deliveryRequestId), {
        status: 'price_agreed',
        agreedFee: input.amount,
        deliveryPaymentRequiredAt: trade.deliveryPaymentRequiredAt || serverTimestamp(),
        deliveryPaymentDeadlineAt: trade.deliveryPaymentDeadlineAt || deadline,
        updatedAt: serverTimestamp()
      });
    }
  });
};

export const markDeliveryFundingRequired = async (tradeId: string) => {
  const deadline = Timestamp.fromDate(new Date(Date.now() + DELIVERY_PAYMENT_TIMEOUT_MS));

  await runTransaction(db, async transaction => {
    const tradeRef = doc(db, 'trades', tradeId);
    const tradeSnap = await transaction.get(tradeRef);

    if (!tradeSnap.exists()) throw new Error('Trade not found.');

    const trade = tradeSnap.data();

    if (trade.deliveryPaymentStatus === 'paid' || trade.status === 'cancelled') {
      return;
    }

    transaction.update(tradeRef, {
      deliveryPaymentStatus: 'pending_funding',
      deliveryPaymentRequiredAt: trade.deliveryPaymentRequiredAt || serverTimestamp(),
      deliveryPaymentDeadlineAt: trade.deliveryPaymentDeadlineAt || deadline,
      autoCancelReason: 'delivery_payment_not_funded',
      updatedAt: serverTimestamp()
    });
  });
};

export const updateDriverTripStatus = async (input: {
  tradeId: string;
  deliveryRequestId?: string;
  driverId: string;
  status:
    | 'driver_en_route_to_pickup'
    | 'product_picked_up'
    | 'delivery_in_progress'
    | 'delivered';
}) => {
  await runTransaction(db, async transaction => {
    const tradeRef = doc(db, 'trades', input.tradeId);
    const tradeSnap = await transaction.get(tradeRef);

    if (!tradeSnap.exists()) throw new Error('Trade not found.');

    const trade = tradeSnap.data();

    if (trade.driverId !== input.driverId && trade.assignedDriverId !== input.driverId) {
      throw new Error('Only the assigned driver can update this delivery.');
    }

    if (trade.deliveryPaymentStatus !== 'paid') {
      throw new Error('Delivery fee must be paid before the driver can start pickup.');
    }

    const updates: Record<string, any> = {
      deliveryStatus: input.status,
      deliveryNegotiationStatus: input.status,
      deliveryBargainStatus: input.status,
      updatedAt: serverTimestamp()
    };

    if (input.status === 'driver_en_route_to_pickup') {
      updates.pickupStartedAt = serverTimestamp();
    }

    if (input.status === 'product_picked_up') {
      updates.pickedUpAt = serverTimestamp();
    }

    if (input.status === 'delivery_in_progress') {
      updates.deliveryStartedAt = serverTimestamp();
    }

    if (input.status === 'delivered') {
      updates.deliveredAt = serverTimestamp();
      updates.status = 'shipped';
    }

    transaction.update(tradeRef, updates);

    if (input.deliveryRequestId) {
      transaction.update(doc(db, 'deliveryRequests', input.deliveryRequestId), {
        status: input.status,
        ...updates
      });
    }
  });
};

export const requestServerAutoCancelUnfundedDelivery = async (
  user: User,
  tradeId: string
) => {
  const response = await fetch('/api/trades/auto-cancel-unfunded-delivery', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ tradeId })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Could not auto-cancel unpaid delivery.');
  }

  return data as {
    tradeId: string;
    cancelled: boolean;
    refundProcessed: boolean;
    message?: string;
  };
};
