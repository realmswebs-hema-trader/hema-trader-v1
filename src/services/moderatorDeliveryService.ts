import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';

import { REVENUE_CONFIG } from '../config/revenueConfig';
import { db } from '../lib/firebase';
import type {
  ModeratorApplicationInput,
  ModeratorAvailability,
  ModeratorDeliveryRequestInput,
  ModeratorDeliveryStatus,
  ModeratorProfile
} from '../types/moderatorDelivery';
import type {
  SendNotificationInput
} from '../components/notifications/NotificationContext';

type SendNotificationFn = (
  recipientId: string,
  data: SendNotificationInput
) => Promise<void>;

type SendManyNotificationsFn = (
  recipientIds: string[],
  data: SendNotificationInput
) => Promise<void>;

export const TEMPORARY_DEFAULT_MODERATOR_EMAIL = 'realmscity@gmail.com';

export const TEMPORARY_DEFAULT_MODERATOR_PATCH = {
  roles: ['buyer', 'seller', 'moderator'],
  isModerator: true,
  moderatorVerified: true,
  moderatorStatus: 'approved',
  moderatorApplicationStatus: 'approved',
  moderatorAvailability: 'available',
  moderatorRegions: ['Douala', 'Bamenda', 'Bafoussam'],
  moderatorRoutes: [
    'Douala-Bamenda',
    'Douala-Bafoussam',
    'Bamenda-Bafoussam'
  ],
  moderatorCanWithdrawImmediately: true
};

const MODERATOR_PLATFORM_COMMISSION_RATE = 0.1;

const uniqueIds = (ids: Array<string | undefined | null>) =>
  Array.from(new Set(ids.filter(Boolean) as string[]));

const normalizeRoute = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-');

const formatMoney = (
  amount: number,
  currencyCode = REVENUE_CONFIG.currency,
  locale = 'fr-CM'
) => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: ['XAF', 'XOF', 'UGX', 'RWF'].includes(currencyCode)
        ? 0
        : 2
    }).format(amount || 0);
  } catch {
    return `${currencyCode} ${(amount || 0).toLocaleString()}`;
  }
};

const getModeratorCommission = (moderatorFee: number) => {
  const platformRate =
    REVENUE_CONFIG.deliveryCommission?.platformRate ??
    MODERATOR_PLATFORM_COMMISSION_RATE;
  const platformFee = Math.round(moderatorFee * platformRate);
  const netEarning = Math.max(moderatorFee - platformFee, 0);

  return {
    platformFee,
    netEarning
  };
};

const assertSignedIn = (user: User | null | undefined) => {
  if (!user) {
    throw new Error('Please sign in before continuing.');
  }
};

const assertPositiveAmount = (amount: number) => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Enter a valid moderator delivery fee.');
  }
};

export const applyTemporaryModeratorDefaultsForSignedInUser = async (
  user: User
) => {
  if (user.email?.toLowerCase() !== TEMPORARY_DEFAULT_MODERATOR_EMAIL) {
    throw new Error('This temporary moderator setup is only for realmscity@gmail.com.');
  }

  await setDoc(
    doc(db, 'users', user.uid),
    {
      ...TEMPORARY_DEFAULT_MODERATOR_PATCH,
      email: user.email,
      updatedAt: serverTimestamp(),
      moderatorApprovedAt: serverTimestamp(),
      moderatorApprovedBy: 'temporary_seed'
    },
    { merge: true }
  );
};

export const submitModeratorApplication = async (
  user: User,
  input: ModeratorApplicationInput
) => {
  assertSignedIn(user);

  if (!input.acceptedTerms) {
    throw new Error('Accept the Hema Moderator terms before submitting.');
  }

  if (!input.fullName.trim()) {
    throw new Error('Enter your full name or business name.');
  }

  if (!input.phoneNumber.trim()) {
    throw new Error('Enter your verified phone number.');
  }

  if (!input.cityOrRegion.trim()) {
    throw new Error('Enter your city or service region.');
  }

  const routes = uniqueIds(input.routes.map(route => route.trim())).filter(
    route => route.length > 0
  );

  if (routes.length === 0) {
    throw new Error('Add at least one route you can cover.');
  }

  if (!input.transportCapacity.trim()) {
    throw new Error('Describe your delivery or transportation capacity.');
  }

  const applicationRef = doc(db, 'moderatorApplications', user.uid);

  await setDoc(
    applicationRef,
    {
      userId: user.uid,
      email: user.email || '',
      displayName: input.fullName.trim(),
      phoneNumber: input.phoneNumber.trim(),
      cityOrRegion: input.cityOrRegion.trim(),
      routes,
      routeKeys: routes.map(normalizeRoute),
      transportCapacity: input.transportCapacity.trim(),
      identityDocumentUrl: input.identityDocumentUrl || '',
      acceptedTerms: true,
      status: 'pending_review',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  await setDoc(
    doc(db, 'users', user.uid),
    {
      moderatorApplicationStatus: 'pending_review',
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  return applicationRef.id;
};

export const getApprovedModeratorsForRoute = async (
  routeLabel?: string,
  maxResults = 25
): Promise<ModeratorProfile[]> => {
  const routeKey = routeLabel ? normalizeRoute(routeLabel) : '';
  const moderatorQuery = query(
    collection(db, 'users'),
    where('roles', 'array-contains', 'moderator'),
    where('moderatorStatus', '==', 'approved'),
    limit(maxResults)
  );

  const snapshot = await getDocs(moderatorQuery);
  const moderators = snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data()
  })) as ModeratorProfile[];

  const filteredModerators = routeKey
    ? moderators.filter(moderator =>
        (moderator.moderatorRoutes || []).some(route =>
          normalizeRoute(route).includes(routeKey)
        )
      )
    : moderators;

  return filteredModerators.sort((a, b) => {
    const availabilityRank: Record<ModeratorAvailability, number> = {
      available: 3,
      busy: 2,
      offline: 1
    };

    const availabilityDelta =
      (availabilityRank[b.moderatorAvailability || 'offline'] || 0) -
      (availabilityRank[a.moderatorAvailability || 'offline'] || 0);

    if (availabilityDelta !== 0) return availabilityDelta;

    const trustDelta = (b.trustScore || 0) - (a.trustScore || 0);
    if (trustDelta !== 0) return trustDelta;

    return (b.moderatorRating || 0) - (a.moderatorRating || 0);
  });
};

export const requestModeratorDelivery = async ({
  input,
  sendNotification,
  sendManyNotifications
}: {
  input: ModeratorDeliveryRequestInput;
  sendNotification: SendNotificationFn;
  sendManyNotifications?: SendManyNotificationsFn;
}) => {
  assertPositiveAmount(input.moderatorFee);

  const currencyCode = input.currencyCode || REVENUE_CONFIG.currency;
  const currencyLocale = input.currencyLocale || 'fr-CM';
  const { platformFee, netEarning } = getModeratorCommission(input.moderatorFee);
  const requestRef = doc(collection(db, 'moderatorDeliveries'));
  const participantIds = uniqueIds([
    input.buyerId,
    input.sellerId,
    input.moderatorId
  ]);

  await runTransaction(db, async transaction => {
    const moderatorRef = doc(db, 'users', input.moderatorId);
    const moderatorSnap = await transaction.get(moderatorRef);

    if (!moderatorSnap.exists()) {
      throw new Error('Selected moderator was not found.');
    }

    const moderatorData = moderatorSnap.data() as ModeratorProfile;

    if (
      !moderatorData.isModerator ||
      !moderatorData.moderatorVerified ||
      moderatorData.moderatorStatus !== 'approved'
    ) {
      throw new Error('Selected moderator is not approved.');
    }

    transaction.set(requestRef, {
      tradeId: input.tradeId,
      listingId: input.listingId || '',
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      moderatorId: input.moderatorId,
      moderatorName:
        input.moderatorName ||
        moderatorData.displayName ||
        moderatorData.name ||
        'Hema Moderator',
      participantIds,
      status: 'moderator_requested',
      pickupAddress: input.pickupAddress,
      dropoffAddress: input.dropoffAddress,
      routeLabel: input.routeLabel || '',
      moderatorFee: input.moderatorFee,
      moderatorPlatformFee: platformFee,
      moderatorNetEarning: netEarning,
      currencyCode,
      currencyLocale,
      moderatorPaymentStatus: 'unpaid',
      moderatorCanWithdrawImmediately: true,
      moderatorCanSeeBuyerPhone: true,
      moderatorCanSeeSellerPhone: true,
      buyerPhone: input.buyerPhone || '',
      sellerPhone: input.sellerPhone || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      moderatorAssignedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'trades', input.tradeId), {
      deliveryMode: 'moderator_assisted',
      moderatorDeliveryRequestId: requestRef.id,
      moderatorId: input.moderatorId,
      moderatorName:
        input.moderatorName ||
        moderatorData.displayName ||
        moderatorData.name ||
        'Hema Moderator',
      moderatorStatus: 'moderator_requested',
      moderatorAssignedAt: serverTimestamp(),
      moderatorFee: input.moderatorFee,
      moderatorPlatformFee: platformFee,
      moderatorNetEarning: netEarning,
      moderatorPaymentStatus: 'unpaid',
      moderatorCanWithdrawImmediately: true,
      moderatorCanSeeBuyerPhone: true,
      moderatorCanSeeSellerPhone: true,
      updatedAt: serverTimestamp()
    });
  });

  await sendNotification(input.moderatorId, {
    title: 'Long-Distance Delivery Request',
    body: `You have received a moderator delivery request: ${input.pickupAddress} to ${input.dropoffAddress}. Fee: ${formatMoney(input.moderatorFee, currencyCode, currencyLocale)}.`,
    type: 'delivery',
    targetId: requestRef.id,
    targetType: 'delivery',
    actionUrl: `/moderator`,
    senderId: input.buyerId,
    senderName: 'Hema Trader',
    metadata: {
      sound: true,
      tradeId: input.tradeId,
      deliveryRequestId: requestRef.id,
      notificationKind: 'moderator_delivery_request'
    }
  });

  if (sendManyNotifications) {
    await sendManyNotifications([input.buyerId, input.sellerId], {
      title: 'Moderator Requested',
      body: 'A verified Hema Moderator has been requested for this long-distance delivery.',
      type: 'delivery',
      targetId: input.tradeId,
      targetType: 'trade',
      actionUrl: `/trade/${input.tradeId}`,
      senderId: input.buyerId,
      senderName: 'Hema Trader',
      metadata: {
        sound: true,
        tradeId: input.tradeId,
        deliveryRequestId: requestRef.id,
        notificationKind: 'moderator_requested'
      }
    });
  }

  return requestRef.id;
};

export const respondToModeratorDeliveryRequest = async ({
  moderatorId,
  requestId,
  accepted,
  sendManyNotifications
}: {
  moderatorId: string;
  requestId: string;
  accepted: boolean;
  sendManyNotifications: SendManyNotificationsFn;
}) => {
  const nextStatus: ModeratorDeliveryStatus = accepted
    ? 'moderator_accepted'
    : 'moderator_declined';

  let buyerId = '';
  let sellerId = '';
  let tradeId = '';

  await runTransaction(db, async transaction => {
    const requestRef = doc(db, 'moderatorDeliveries', requestId);
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) {
      throw new Error('Moderator delivery request was not found.');
    }

    const requestData = requestSnap.data() as {
      moderatorId: string;
      buyerId: string;
      sellerId: string;
      tradeId: string;
      status: ModeratorDeliveryStatus;
    };

    if (requestData.moderatorId !== moderatorId) {
      throw new Error('Only the assigned moderator can respond.');
    }

    if (requestData.status !== 'moderator_requested') {
      throw new Error('This request has already been answered.');
    }

    buyerId = requestData.buyerId;
    sellerId = requestData.sellerId;
    tradeId = requestData.tradeId;

    transaction.update(requestRef, {
      status: nextStatus,
      moderatorAcceptedAt: accepted ? serverTimestamp() : null,
      updatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'trades', tradeId), {
      moderatorStatus: nextStatus,
      moderatorAcceptedAt: accepted ? serverTimestamp() : null,
      updatedAt: serverTimestamp()
    });
  });

  await sendManyNotifications([buyerId, sellerId], {
    title: accepted ? 'Moderator Accepted' : 'Moderator Declined',
    body: accepted
      ? 'The verified Hema Moderator accepted this delivery request.'
      : 'The moderator declined this delivery request. Please select another moderator.',
    type: 'delivery',
    targetId: tradeId,
    targetType: 'trade',
    actionUrl: `/trade/${tradeId}`,
    senderId: moderatorId,
    senderName: 'Hema Moderator',
    metadata: {
      sound: true,
      tradeId,
      deliveryRequestId: requestId,
      notificationKind: accepted
        ? 'moderator_request_accepted'
        : 'moderator_request_declined'
    }
  });
};

export const updateModeratorDeliveryStatus = async ({
  moderatorId,
  requestId,
  status,
  sendManyNotifications
}: {
  moderatorId: string;
  requestId: string;
  status: Extract<
    ModeratorDeliveryStatus,
    | 'picked_up_by_moderator'
    | 'in_transit_by_moderator'
    | 'delivered_by_moderator'
  >;
  sendManyNotifications: SendManyNotificationsFn;
}) => {
  let buyerId = '';
  let sellerId = '';
  let tradeId = '';
  const timestampField =
    status === 'picked_up_by_moderator'
      ? 'moderatorPickedUpAt'
      : status === 'delivered_by_moderator'
        ? 'moderatorDeliveredAt'
        : 'moderatorInTransitAt';

  await runTransaction(db, async transaction => {
    const requestRef = doc(db, 'moderatorDeliveries', requestId);
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) {
      throw new Error('Moderator delivery request was not found.');
    }

    const requestData = requestSnap.data() as {
      moderatorId: string;
      buyerId: string;
      sellerId: string;
      tradeId: string;
      status: ModeratorDeliveryStatus;
    };

    if (requestData.moderatorId !== moderatorId) {
      throw new Error('Only the assigned moderator can update this delivery.');
    }

    if (requestData.status === 'frozen_by_admin') {
      throw new Error('This delivery is frozen by admin.');
    }

    buyerId = requestData.buyerId;
    sellerId = requestData.sellerId;
    tradeId = requestData.tradeId;

    transaction.update(requestRef, {
      status,
      [timestampField]: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'trades', tradeId), {
      moderatorStatus: status,
      [timestampField]: serverTimestamp(),
      ...(status === 'delivered_by_moderator'
        ? {
            moderatorDeliveredAt: serverTimestamp(),
            escrowReleaseTriggeredBy: 'moderator'
          }
        : {}),
      updatedAt: serverTimestamp()
    });
  });

  const label =
    status === 'picked_up_by_moderator'
      ? 'Moderator Confirmed Pickup'
      : status === 'in_transit_by_moderator'
        ? 'Moderator Delivery In Transit'
        : 'Moderator Marked Delivered';

  await sendManyNotifications([buyerId, sellerId], {
    title: label,
    body:
      status === 'delivered_by_moderator'
        ? 'The verified moderator marked this delivery as delivered. Escrow can now be reviewed for release.'
        : 'Your moderator-assisted delivery has a new status update.',
    type: 'delivery',
    targetId: tradeId,
    targetType: 'trade',
    actionUrl: `/trade/${tradeId}`,
    senderId: moderatorId,
    senderName: 'Hema Moderator',
    metadata: {
      sound: true,
      tradeId,
      deliveryRequestId: requestId,
      notificationKind: status
    }
  });
};

export const createModeratorPaymentRequest = async ({
  requestId,
  buyerId
}: {
  requestId: string;
  buyerId: string;
}) => {
  await runTransaction(db, async transaction => {
    const requestRef = doc(db, 'moderatorDeliveries', requestId);
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) {
      throw new Error('Moderator delivery request was not found.');
    }

    const requestData = requestSnap.data() as {
      buyerId: string;
      tradeId: string;
      moderatorFee: number;
      moderatorPaymentStatus: string;
    };

    if (requestData.buyerId !== buyerId) {
      throw new Error('Only the buyer can pay this moderator delivery fee.');
    }

    if (requestData.moderatorPaymentStatus === 'paid') {
      throw new Error('Moderator delivery fee is already paid.');
    }

    transaction.update(requestRef, {
      moderatorPaymentStatus: 'payment_requested',
      updatedAt: serverTimestamp()
    });

    transaction.update(doc(db, 'trades', requestData.tradeId), {
      moderatorPaymentStatus: 'payment_requested',
      updatedAt: serverTimestamp()
    });
  });
};

export const setModeratorAvailability = async (
  user: User,
  availability: ModeratorAvailability
) => {
  assertSignedIn(user);

  await updateDoc(doc(db, 'users', user.uid), {
    moderatorAvailability: availability,
    updatedAt: serverTimestamp()
  });
};

