import {
  addDoc,
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';

import { db } from '../lib/firebase';

export type DeliveryStatus =
  | 'pending'
  | 'accepted'
  | 'assigned'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export interface CreateDeliveryRequestInput {
  tradeId: string;
  buyerId: string;
  sellerId: string;
  driverId: string;
  pickupLocation: string;
  deliveryLocation: string;
  deliveryNotes: string;
  urgency: 'normal' | 'urgent' | 'same_day';
  estimatedFee: number;
}

export const createDeliveryRequest = async (input: CreateDeliveryRequestInput) => {
  const deliveryRef = await addDoc(collection(db, 'deliveryRequests'), {
    ...input,
    status: 'pending',
    deliveryStatus: 'pending',
    driverCommission: Math.round(input.estimatedFee * 0.8),
    platformDeliveryFee: Math.round(input.estimatedFee * 0.2),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'trades', input.tradeId), {
    deliveryRequestId: deliveryRef.id,
    driverId: input.driverId,
    deliveryStatus: 'pending',
    deliveryFee: input.estimatedFee,
    driverCommission: Math.round(input.estimatedFee * 0.8),
    updatedAt: serverTimestamp()
  });

  await addDoc(collection(db, 'notifications'), {
    userId: input.driverId,
    recipientId: input.driverId,
    title: 'New Delivery Request',
    body: 'You have a new delivery request waiting for response.',
    type: 'delivery',
    targetId: deliveryRef.id,
    read: false,
    createdAt: serverTimestamp()
  });

  return deliveryRef.id;
};

export const acceptDeliveryRequest = async (requestId: string, driverId: string) => {
  await runTransaction(db, async transaction => {
    const requestRef = doc(db, 'deliveryRequests', requestId);
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) {
      throw new Error('Delivery request not found.');
    }

    const request = requestSnap.data();

    if (request.driverId !== driverId) {
      throw new Error('This delivery request belongs to another driver.');
    }

    if (request.status !== 'pending') {
      throw new Error('This delivery request is no longer pending.');
    }

    const tradeRef = doc(db, 'trades', request.tradeId);
    const driverRef = doc(db, 'users', driverId);

    transaction.update(requestRef, {
      status: 'accepted',
      deliveryStatus: 'accepted',
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(tradeRef, {
      driverId,
      deliveryStatus: 'accepted',
      deliveryRequestId: requestId,
      updatedAt: serverTimestamp()
    });

    transaction.update(driverRef, {
      driverStatus: 'on_trip',
      availability: 'on_trip',
      updatedAt: serverTimestamp()
    });
  });
};

export const declineDeliveryRequest = async (requestId: string, driverId: string) => {
  await updateDoc(doc(db, 'deliveryRequests', requestId), {
    status: 'cancelled',
    deliveryStatus: 'cancelled',
    declinedBy: driverId,
    declinedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
};

export const updateDeliveryRequestStatus = async (
  requestId: string,
  tradeId: string,
  status: DeliveryStatus
) => {
  await updateDoc(doc(db, 'deliveryRequests', requestId), {
    status,
    deliveryStatus: status,
    updatedAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'trades', tradeId), {
    deliveryStatus: status,
    updatedAt: serverTimestamp()
  });
};

export const confirmDeliveryAndReleaseEscrow = async (
  requestId: string,
  buyerId: string
) => {
  await runTransaction(db, async transaction => {
    const requestRef = doc(db, 'deliveryRequests', requestId);
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) {
      throw new Error('Delivery request not found.');
    }

    const request = requestSnap.data();

    if (request.buyerId !== buyerId) {
      throw new Error('Only the buyer can confirm delivery.');
    }

    const tradeRef = doc(db, 'trades', request.tradeId);
    const driverRef = doc(db, 'users', request.driverId);

    transaction.update(requestRef, {
      status: 'completed',
      deliveryStatus: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(tradeRef, {
      status: 'completed',
      deliveryStatus: 'completed',
      escrowStatus: 'release_pending_server_payout',
      sellerPayoutStatus: 'pending',
      driverPayoutStatus: 'pending',
      platformFeeStatus: 'pending',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(driverRef, {
      driverStatus: 'available',
      availability: 'available',
      totalDeliveries: increment(1),
      completedDeliveries: increment(1),
      deliveriesCount: increment(1),
      totalEarnings: increment(request.driverCommission || 0),
      updatedAt: serverTimestamp()
    });
  });
};

export const submitDriverReview = async ({
  tradeId,
  deliveryRequestId,
  driverId,
  reviewerId,
  rating,
  comment
}: {
  tradeId: string;
  deliveryRequestId: string;
  driverId: string;
  reviewerId: string;
  rating: number;
  comment: string;
}) => {
  await runTransaction(db, async transaction => {
    const driverRef = doc(db, 'users', driverId);
    const driverSnap = await transaction.get(driverRef);

    if (!driverSnap.exists()) {
      throw new Error('Driver profile not found.');
    }

    const driver = driverSnap.data();
    const currentAverage = driver.avgDriverRating || driver.averageRating || 0;
    const currentCount = driver.driverReviewCount || 0;
    const nextCount = currentCount + 1;
    const nextAverage = (currentAverage * currentCount + rating) / nextCount;

    const reviewRef = doc(collection(db, 'driverReviews'));

    transaction.set(reviewRef, {
      tradeId,
      deliveryRequestId,
      driverId,
      reviewerId,
      rating,
      comment: comment.trim(),
      createdAt: serverTimestamp()
    });

    transaction.update(driverRef, {
      avgDriverRating: nextAverage,
      averageRating: nextAverage,
      driverReviewCount: nextCount,
      updatedAt: serverTimestamp()
    });
  });
};
