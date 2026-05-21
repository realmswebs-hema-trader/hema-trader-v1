import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import type { SendNotificationInput } from '../components/notifications/NotificationContext';

type SendNotificationFn = (
  recipientId: string,
  data: SendNotificationInput
) => Promise<void>;

export type EscrowStatus =
  | 'pending_payment'
  | 'payment_started'
  | 'payment_verifying'
  | 'funded'
  | 'release_pending_buyer_confirmation'
  | 'release_pending_server_payout'
  | 'completed'
  | 'disputed'
  | 'cancelled'
  | 'failed';

interface MarkPaymentStartedInput {
  tradeId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  currency: string;
  txRef: string;
}

interface VerifyEscrowPaymentInput {
  tradeId: string;
  transactionId: string;
  userId: string;
}

interface ConfirmDeliveryInput {
  tradeId: string;
  buyerId: string;
  sellerId: string;
  driverId?: string;
  amount: number;
  deliveryFee?: number;
  driverCommission?: number;
  sendNotification: SendNotificationFn;
}

interface OpenDisputeInput {
  tradeId: string;
  userId: string;
  buyerId: string;
  sellerId: string;
  reason: string;
  sendNotification: SendNotificationFn;
}

export const markEscrowPaymentStarted = async ({
  tradeId,
  buyerId,
  sellerId,
  amount,
  currency,
  txRef
}: MarkPaymentStartedInput) => {
  await updateDoc(doc(db, 'trades', tradeId), {
    escrowStatus: 'payment_started',
    paymentStatus: 'started',
    paymentTxRef: txRef,
    paymentCurrency: currency,
    paymentAmount: amount,
    updatedAt: serverTimestamp()
  });

  await addDoc(collection(db, 'trades', tradeId, 'escrowEvents'), {
    type: 'payment_started',
    buyerId,
    sellerId,
    amount,
    currency,
    txRef,
    createdAt: serverTimestamp()
  });
};

export const verifyEscrowPayment = async ({
  tradeId,
  transactionId,
  userId
}: VerifyEscrowPaymentInput) => {
  await updateDoc(doc(db, 'trades', tradeId), {
    escrowStatus: 'payment_verifying',
    paymentStatus: 'verifying',
    paymentTransactionId: transactionId,
    updatedAt: serverTimestamp()
  });

  const response = await fetch('/api/payments/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tradeId,
      transactionId,
      userId
    })
  });

  if (!response.ok) {
    await updateDoc(doc(db, 'trades', tradeId), {
      escrowStatus: 'failed',
      paymentStatus: 'verification_failed',
      updatedAt: serverTimestamp()
    });

    throw new Error('Payment verification failed.');
  }

  const result = await response.json();

  if (!result.success) {
    await updateDoc(doc(db, 'trades', tradeId), {
      escrowStatus: 'failed',
      paymentStatus: 'verification_failed',
      paymentFailureReason: result.message || 'Verification failed',
      updatedAt: serverTimestamp()
    });

    throw new Error(result.message || 'Payment verification failed.');
  }

  await updateDoc(doc(db, 'trades', tradeId), {
    status: 'funded',
    escrowStatus: 'funded',
    paymentStatus: 'verified',
    fundedAt: serverTimestamp(),
    platformFee: result.platformFee,
    updatedAt: serverTimestamp()
  });

  await addDoc(collection(db, 'trades', tradeId, 'escrowEvents'), {
    type: 'payment_verified',
    transactionId,
    verifiedBy: userId,
    provider: 'flutterwave',
    createdAt: serverTimestamp()
  });

  return result;
};

export const confirmDeliveryAndRequestPayout = async ({
  tradeId,
  buyerId,
  sellerId,
  driverId,
  amount,
  deliveryFee = 0,
  driverCommission = 0,
  sendNotification
}: ConfirmDeliveryInput) => {
  const platformFee = amount * 0.02;
  const sellerPayout = Math.max(amount - platformFee, 0);

  await updateDoc(doc(db, 'trades', tradeId), {
    status: 'completed',
    escrowStatus: 'release_pending_server_payout',
    paymentStatus: 'release_pending_server_payout',
    buyerConfirmedAt: serverTimestamp(),
    platformFee,
    sellerPayout,
    deliveryFee,
    driverCommission,
    updatedAt: serverTimestamp()
  });

  await addDoc(collection(db, 'trades', tradeId, 'escrowEvents'), {
    type: 'buyer_confirmed_delivery',
    buyerId,
    sellerId,
    driverId: driverId || '',
    amount,
    platformFee,
    sellerPayout,
    deliveryFee,
    driverCommission,
    createdAt: serverTimestamp()
  });

  await sendNotification(sellerId, {
    title: 'Buyer Confirmed Delivery',
    body: 'Escrow is now queued for secure payout.',
    type: 'escrow',
    targetId: tradeId,
    targetType: 'trade',
    actionUrl: `/trade/${tradeId}`
  });

  if (driverId) {
    await sendNotification(driverId, {
      title: 'Delivery Confirmed',
      body: 'Your delivery commission is queued for payout.',
      type: 'delivery',
      targetId: tradeId,
      targetType: 'trade',
      actionUrl: `/trade/${tradeId}`
    });
  }
};

export const openEscrowDispute = async ({
  tradeId,
  userId,
  buyerId,
  sellerId,
  reason,
  sendNotification
}: OpenDisputeInput) => {
  await updateDoc(doc(db, 'trades', tradeId), {
    status: 'disputed',
    escrowStatus: 'disputed',
    disputeReason: reason,
    disputeOpenedBy: userId,
    disputedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await addDoc(collection(db, 'trades', tradeId, 'escrowEvents'), {
    type: 'dispute_opened',
    userId,
    reason,
    createdAt: serverTimestamp()
  });

  const recipientId = userId === buyerId ? sellerId : buyerId;

  await sendNotification(recipientId, {
    title: 'Escrow Dispute Opened',
    body: 'A dispute has been opened for this transaction.',
    type: 'dispute',
    targetId: tradeId,
    targetType: 'trade',
    actionUrl: `/trade/${tradeId}`
  });
};
