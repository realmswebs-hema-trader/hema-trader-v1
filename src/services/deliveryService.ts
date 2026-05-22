import {
  addDoc,
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import {
  analyzeDeliveryRisk,
  calculateDeliveryFee,
  calculateSmartETA,
  findBestDriversForDelivery,
  getVehicleRecommendation,
  type DeliveryMatchInput
} from './logisticsMatching';
import { toGeoPoint, type GeoPoint } from '../utils/geoUtils';

export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'accepted'
  | 'driver_arriving'
  | 'picked_up'
  | 'in_transit'
  | 'near_destination'
  | 'arriving'
  | 'delivered'
  | 'buyer_confirmation'
  | 'completed'
  | 'disputed'
  | 'cancelled';

export interface CreateDeliveryRequestInput extends DeliveryMatchInput {
  tradeId: string;
  buyerId: string;
  sellerId: string;
  driverId?: string;
  pickupLocation?: string | GeoPoint;
  dropoffLocation?: string | GeoPoint;
  deliveryLocation?: string | GeoPoint;
  pickupAddress?: string;
  destinationAddress?: string;
  dropoffAddress?: string;
  deliveryNotes?: string;
  instructions?: string;
  urgency?: 'normal' | 'same_day' | 'urgent' | string;
  packageType?: string;
  packageWeight?: number;
  packageValue?: number;
  estimatedFee?: number;
}

const statusMessage: Record<string, string> = {
  pending: 'Delivery request created.',
  assigned: 'A driver has been assigned.',
  accepted: 'Driver accepted the delivery.',
  driver_arriving: 'Driver is arriving at pickup.',
  picked_up: 'Package picked up.',
  in_transit: 'Package is moving.',
  near_destination: 'Driver is near destination.',
  arriving: 'Driver is near destination.',
  delivered: 'Package delivered. Buyer confirmation required.',
  buyer_confirmation: 'Waiting for buyer confirmation.',
  completed: 'Delivery completed and escrow release started.',
  disputed: 'Delivery dispute opened. Funds remain locked.',
  cancelled: 'Delivery cancelled.'
};

const getDeliveryPoint = (value: any): GeoPoint | null => {
  if (typeof value === 'string') return null;
  return toGeoPoint(value);
};

const getAddress = (value: any, fallback = '') =>
  typeof value === 'string' ? value : fallback;

const deliveryRecipients = (delivery: any) =>
  [delivery.buyerId, delivery.sellerId, delivery.driverId].filter(Boolean);

const addNotificationWrites = (
  batch: ReturnType<typeof writeBatch>,
  recipientIds: string[],
  data: {
    title: string;
    body: string;
    targetId: string;
    actionUrl: string;
  }
) => {
  recipientIds.forEach(recipientId => {
    const notificationRef = doc(
      collection(db, 'users', recipientId, 'notifications')
    );

    batch.set(notificationRef, {
      recipientId,
      title: data.title,
      body: data.body,
      type: 'delivery',
      targetId: data.targetId,
      targetType: 'delivery',
      actionUrl: data.actionUrl,
      read: false,
      createdAt: serverTimestamp()
    });
  });
};

const writeDeliveryHistory = async (
  deliveryId: string,
  event: Record<string, any>
) => {
  await addDoc(collection(db, 'deliveryHistory'), {
    deliveryId,
    ...event,
    createdAt: serverTimestamp()
  });
};

export const createDeliveryRequest = async (
  input: CreateDeliveryRequestInput
) => {
  const pickupPoint =
    input.pickupLocation && typeof input.pickupLocation !== 'string'
      ? getDeliveryPoint(input.pickupLocation)
      : input.pickupLocation || input.pickupAddress
        ? input.pickupLocationObject || input.pickupLocationPoint || input.pickupPoint || null
        : input.pickupLocation || null;

  const dropoffPoint =
    input.dropoffLocation && typeof input.dropoffLocation !== 'string'
      ? getDeliveryPoint(input.dropoffLocation)
      : input.deliveryLocation && typeof input.deliveryLocation !== 'string'
        ? getDeliveryPoint(input.deliveryLocation)
        : input.dropoffLocationObject || input.destinationLocation || input.deliveryPoint || null;

  const normalizedPickup = toGeoPoint(pickupPoint);
  const normalizedDropoff = toGeoPoint(dropoffPoint);

  const estimatedFee =
    input.estimatedFee ||
    calculateDeliveryFee(normalizedPickup, normalizedDropoff, input);

  const estimatedEtaMinutes = calculateSmartETA(
    normalizedPickup,
    normalizedDropoff
  );

  const recommendedVehicle = getVehicleRecommendation(input);
  const risk = analyzeDeliveryRisk({
    ...input,
    pickupLocation: normalizedPickup,
    dropoffLocation: normalizedDropoff
  });

  const matchedDrivers = input.driverId
    ? []
    : await findBestDriversForDelivery(
        {
          ...input,
          pickupLocation: normalizedPickup,
          dropoffLocation: normalizedDropoff
        },
        5
      );

  const selectedDriverId = input.driverId || matchedDrivers[0]?.driverId || '';

  const deliveryRef = doc(collection(db, 'deliveryRequests'));
  const deliveryId = deliveryRef.id;

  const driverCommission = Math.round(estimatedFee * 0.8);
  const platformDeliveryFee = Math.max(estimatedFee - driverCommission, 0);

  const deliveryPayload = {
    id: deliveryId,
    tradeId: input.tradeId,
    buyerId: input.buyerId,
    sellerId: input.sellerId,
    driverId: selectedDriverId || null,

    pickupLocation: normalizedPickup,
    dropoffLocation: normalizedDropoff,
    deliveryLocation: normalizedDropoff,

    pickupAddress:
      input.pickupAddress ||
      getAddress(input.pickupLocation, 'Pickup location'),
    destinationAddress:
      input.destinationAddress ||
      input.dropoffAddress ||
      getAddress(input.dropoffLocation, getAddress(input.deliveryLocation, 'Destination')),

    packageType: input.packageType || 'general',
    packageWeight: Number(input.packageWeight || 0),
    packageValue: Number(input.packageValue || 0),
    deliveryNotes: input.deliveryNotes || input.instructions || '',
    urgency: input.urgency || 'normal',

    recommendedVehicle,
    estimatedFee,
    deliveryFee: estimatedFee,
    driverCommission,
    platformDeliveryFee,
    estimatedEtaMinutes,
    estimatedEtaLabel: `${estimatedEtaMinutes} mins`,

    riskLevel: risk.riskLevel,
    riskFlags: risk.flags,
    matchedDrivers,

    status: selectedDriverId ? 'assigned' : 'pending',
    deliveryStatus: selectedDriverId ? 'assigned' : 'pending',
    escrowStatus: 'delivery_linked',
    escrowProtected: true,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const batch = writeBatch(db);

  batch.set(deliveryRef, deliveryPayload);

  batch.set(doc(db, 'deliveryTracking', deliveryId), {
    deliveryId,
    tradeId: input.tradeId,
    driverId: selectedDriverId || null,
    buyerId: input.buyerId,
    sellerId: input.sellerId,
    pickupLocation: normalizedPickup,
    destinationLocation: normalizedDropoff,
    status: deliveryPayload.status,
    routeProgress: 0,
    lastUpdatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  });

  batch.set(doc(db, 'logisticsOrders', deliveryId), {
    deliveryId,
    tradeId: input.tradeId,
    buyerId: input.buyerId,
    sellerId: input.sellerId,
    driverId: selectedDriverId || null,
    status: deliveryPayload.status,
    packageType: deliveryPayload.packageType,
    packageWeight: deliveryPayload.packageWeight,
    deliveryFee: estimatedFee,
    driverCommission,
    riskLevel: risk.riskLevel,
    escrowLinked: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  batch.set(doc(db, 'deliveryShipments', deliveryId), {
    deliveryId,
    tradeId: input.tradeId,
    escrowStatus: 'locked_pending_delivery',
    fundsReleaseStatus: 'blocked_until_buyer_confirmation',
    status: deliveryPayload.status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  batch.set(
    doc(db, 'trades', input.tradeId),
    {
      deliveryRequestId: deliveryId,
      driverId: selectedDriverId || null,
      deliveryStatus: deliveryPayload.status,
      deliveryRequestStatus: selectedDriverId ? 'assigned' : 'open',
      deliveryFee: estimatedFee,
      driverCommission,
      escrowDeliveryLinked: true,
      logisticsOrderId: deliveryId,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  if (selectedDriverId) {
    batch.set(
      doc(db, 'users', selectedDriverId),
      {
        driverStatus: 'on_trip',
        availability: 'on_trip',
        activeDeliveryId: deliveryId,
        pendingDeliveryCount: increment(1),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  addNotificationWrites(
    batch,
    [input.buyerId, input.sellerId, selectedDriverId].filter(Boolean),
    {
      title: selectedDriverId ? 'Driver Assigned' : 'Delivery Requested',
      body: selectedDriverId
        ? 'A driver has been assigned to this delivery.'
        : 'Delivery request created. Matching nearby drivers now.',
      targetId: deliveryId,
      actionUrl: `/delivery/${deliveryId}`
    }
  );

  await batch.commit();

  await writeDeliveryHistory(deliveryId, {
    tradeId: input.tradeId,
    actorId: input.buyerId,
    type: 'delivery_created',
    status: deliveryPayload.status,
    note: 'Delivery request, logistics order, and escrow-linked shipment created.'
  });

  return deliveryId;
};

export const assignDriverToDelivery = async (
  requestId: string,
  driverId: string
) => {
  await runTransaction(db, async transaction => {
    const requestRef = doc(db, 'deliveryRequests', requestId);
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) throw new Error('Delivery request not found.');

    const request = requestSnap.data();

    transaction.update(requestRef, {
      driverId,
      status: 'assigned',
      deliveryStatus: 'assigned',
      assignedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'deliveryTracking', requestId), {
      driverId,
      status: 'assigned',
      lastUpdatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'logisticsOrders', requestId), {
      driverId,
      status: 'assigned',
      updatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'deliveryShipments', requestId), {
      status: 'assigned',
      updatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'trades', request.tradeId), {
      driverId,
      deliveryRequestId: requestId,
      deliveryStatus: 'assigned',
      deliveryRequestStatus: 'assigned',
      updatedAt: serverTimestamp()
    });

    transaction.set(
      doc(db, 'users', driverId),
      {
        driverStatus: 'on_trip',
        availability: 'on_trip',
        activeDeliveryId: requestId,
        pendingDeliveryCount: increment(1),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });

  await writeDeliveryHistory(requestId, {
    actorId: driverId,
    type: 'driver_assigned',
    status: 'assigned'
  });
};

export const acceptDeliveryRequest = async (
  requestId: string,
  driverId: string
) => {
  await runTransaction(db, async transaction => {
    const requestRef = doc(db, 'deliveryRequests', requestId);
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) throw new Error('Delivery request not found.');

    const request = requestSnap.data();

    if (request.driverId && request.driverId !== driverId) {
      throw new Error('This delivery request belongs to another driver.');
    }

    transaction.update(requestRef, {
      driverId,
      status: 'driver_arriving',
      deliveryStatus: 'driver_arriving',
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'deliveryTracking', requestId), {
      driverId,
      status: 'driver_arriving',
      lastUpdatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'trades', request.tradeId), {
      driverId,
      deliveryStatus: 'driver_arriving',
      deliveryRequestStatus: 'claimed',
      updatedAt: serverTimestamp()
    });

    transaction.set(
      doc(db, 'users', driverId),
      {
        driverStatus: 'on_trip',
        availability: 'on_trip',
        activeDeliveryId: requestId,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });

  await writeDeliveryHistory(requestId, {
    actorId: driverId,
    type: 'driver_accepted',
    status: 'driver_arriving'
  });
};

export const declineDeliveryRequest = async (
  requestId: string,
  driverId: string
) => {
  await updateDoc(doc(db, 'deliveryRequests', requestId), {
    driverId: null,
    status: 'pending',
    deliveryStatus: 'pending',
    declinedBy: driverId,
    declinedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await writeDeliveryHistory(requestId, {
    actorId: driverId,
    type: 'driver_declined',
    status: 'pending'
  });
};

export const updateDeliveryRequestStatus = async (
  requestId: string,
  tradeId: string,
  status: DeliveryStatus,
  actorId?: string
) => {
  const normalizedStatus =
    status === 'accepted' ? 'driver_arriving' :
    status === 'arriving' ? 'near_destination' :
    status;

  const batch = writeBatch(db);

  batch.set(
    doc(db, 'deliveryRequests', requestId),
    {
      status: normalizedStatus,
      deliveryStatus: normalizedStatus,
      updatedAt: serverTimestamp(),
      ...(normalizedStatus === 'picked_up' ? { pickedUpAt: serverTimestamp() } : {}),
      ...(normalizedStatus === 'delivered' ? { deliveredAt: serverTimestamp() } : {}),
      ...(normalizedStatus === 'completed' ? { completedAt: serverTimestamp() } : {})
    },
    { merge: true }
  );

  batch.set(
    doc(db, 'deliveryTracking', requestId),
    {
      status: normalizedStatus,
      lastUpdatedAt: serverTimestamp()
    },
    { merge: true }
  );

  batch.set(
    doc(db, 'logisticsOrders', requestId),
    {
      status: normalizedStatus,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  batch.set(
    doc(db, 'deliveryShipments', requestId),
    {
      status: normalizedStatus,
      updatedAt: serverTimestamp(),
      ...(normalizedStatus === 'delivered'
        ? { fundsReleaseStatus: 'buyer_confirmation_required' }
        : {})
    },
    { merge: true }
  );

  batch.set(
    doc(db, 'trades', tradeId),
    {
      deliveryStatus: normalizedStatus,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  await batch.commit();

  await writeDeliveryHistory(requestId, {
    tradeId,
    actorId: actorId || null,
    type: 'status_changed',
    status: normalizedStatus,
    note: statusMessage[normalizedStatus] || 'Delivery status updated.'
  });
};

export const confirmDeliveryAndReleaseEscrow = async (
  requestId: string,
  buyerId: string
) => {
  await runTransaction(db, async transaction => {
    const requestRef = doc(db, 'deliveryRequests', requestId);
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) throw new Error('Delivery request not found.');

    const request = requestSnap.data();

    if (request.buyerId !== buyerId) {
      throw new Error('Only the buyer can confirm delivery.');
    }

    const tradeRef = doc(db, 'trades', request.tradeId);
    const driverRef = doc(db, 'users', request.driverId);

    transaction.update(requestRef, {
      status: 'completed',
      deliveryStatus: 'completed',
      buyerConfirmedAt: serverTimestamp(),
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'deliveryTracking', requestId), {
      status: 'completed',
      routeProgress: 100,
      lastUpdatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'logisticsOrders', requestId), {
      status: 'completed',
      updatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'deliveryShipments', requestId), {
      status: 'completed',
      escrowStatus: 'release_pending_server_payout',
      fundsReleaseStatus: 'release_pending_server_payout',
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

    if (request.driverId) {
      transaction.update(driverRef, {
        driverStatus: 'available',
        availability: 'available',
        activeDeliveryId: null,
        totalDeliveries: increment(1),
        completedDeliveries: increment(1),
        deliveriesCount: increment(1),
        pendingDeliveryCount: increment(-1),
        totalEarnings: increment(request.driverCommission || 0),
        pendingPayouts: increment(request.driverCommission || 0),
        updatedAt: serverTimestamp()
      });
    }
  });

  await writeDeliveryHistory(requestId, {
    actorId: buyerId,
    type: 'buyer_confirmed_delivery',
    status: 'completed',
    note: 'Buyer confirmed delivery. Escrow release queued.'
  });
};

export const openDeliveryDispute = async (
  requestId: string,
  actorId: string,
  reason: string
) => {
  await updateDoc(doc(db, 'deliveryRequests', requestId), {
    status: 'disputed',
    deliveryStatus: 'disputed',
    disputeReason: reason,
    disputedBy: actorId,
    disputedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await setDoc(
    doc(db, 'deliveryShipments', requestId),
    {
      status: 'disputed',
      escrowStatus: 'locked_admin_review',
      fundsReleaseStatus: 'blocked_admin_review',
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  await writeDeliveryHistory(requestId, {
    actorId,
    type: 'delivery_disputed',
    status: 'disputed',
    note: reason
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

    if (!driverSnap.exists()) throw new Error('Driver profile not found.');

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
