import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import type { SendNotificationInput } from '../components/notifications/NotificationContext';

type SendNotificationFn = (
  recipientId: string,
  data: SendNotificationInput
) => Promise<void>;

interface SendTradeMessageInput {
  tradeId: string;
  senderId: string;
  senderName: string;
  senderPhotoURL?: string;
  text: string;
  recipientIds: string[];
  sendNotification: SendNotificationFn;
  listingId?: string;
  status?: 'sent' | 'delivered' | 'read';
  mirrorToLegacyThread?: boolean;
}

interface SendSystemMessageInput {
  tradeId: string;
  text: string;
  recipientIds?: string[];
  sendNotification?: SendNotificationFn;
  title?: string;
  listingId?: string;
  status?: 'sent' | 'delivered' | 'read';
  mirrorToLegacyThread?: boolean;
}

const uniqueIds = (ids: string[] = []) =>
  Array.from(new Set(ids.filter(Boolean)));

const cleanMessageText = (text: string) => text.trim();

const createMessageDocument = ({
  tradeId,
  listingId = '',
  senderId,
  senderName,
  senderPhotoURL = '',
  recipientIds,
  text,
  type,
  status = 'sent'
}: {
  tradeId: string;
  listingId?: string;
  senderId: string;
  senderName: string;
  senderPhotoURL?: string;
  recipientIds: string[];
  text: string;
  type: 'user' | 'system';
  status?: 'sent' | 'delivered' | 'read';
}) => ({
  tradeId,
  listingId,
  userId: senderId,
  senderId,
  senderName,
  senderPhotoURL,
  recipientIds: uniqueIds(recipientIds),
  participants: uniqueIds([senderId, ...recipientIds]),
  text,
  type,
  status,
  readBy: senderId === 'system' ? [] : [senderId],
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
});

const updateTradeLastMessage = async ({
  tradeId,
  text,
  senderId
}: {
  tradeId: string;
  text: string;
  senderId: string;
}) => {
  await updateDoc(doc(db, 'trades', tradeId), {
    lastMessage: text,
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: senderId,
    [`typing.${senderId}`]: false,
    updatedAt: serverTimestamp()
  });
};

export const sendTradeMessage = async ({
  tradeId,
  senderId,
  senderName,
  senderPhotoURL,
  text,
  recipientIds,
  sendNotification,
  listingId = '',
  status = 'sent',
  mirrorToLegacyThread = true
}: SendTradeMessageInput) => {
  const cleanText = cleanMessageText(text);

  if (!cleanText) return;

  const messageData = createMessageDocument({
    tradeId,
    listingId,
    senderId,
    senderName,
    senderPhotoURL,
    recipientIds,
    text: cleanText,
    type: 'user',
    status
  });

  if (mirrorToLegacyThread) {
    const batch = writeBatch(db);

    const flatMessageRef = doc(collection(db, 'messages'));
    const legacyMessageRef = doc(collection(db, 'trades', tradeId, 'messages'));

    batch.set(flatMessageRef, messageData);
    batch.set(legacyMessageRef, messageData);

    await batch.commit();
  } else {
    await addDoc(collection(db, 'messages'), messageData);
  }

  await updateTradeLastMessage({
    tradeId,
    text: cleanText,
    senderId
  });

  const uniqueRecipients = uniqueIds(
    recipientIds.filter(id => id !== senderId)
  );

  await Promise.all(
    uniqueRecipients.map(recipientId =>
      sendNotification(recipientId, {
        title: `Message from ${senderName}`,
        body: cleanText,
        type: 'message',
        targetId: tradeId,
        targetType: 'message',
        actionUrl: `/messages/${tradeId}`,
        senderId,
        senderName
      })
    )
  );
};

export const sendSystemTradeMessage = async ({
  tradeId,
  text,
  recipientIds = [],
  sendNotification,
  title = 'Trade Update',
  listingId = '',
  status = 'sent',
  mirrorToLegacyThread = true
}: SendSystemMessageInput) => {
  const cleanText = cleanMessageText(text);

  if (!cleanText) return;

  const messageData = createMessageDocument({
    tradeId,
    listingId,
    senderId: 'system',
    senderName: 'Hema Trader',
    senderPhotoURL: '',
    recipientIds,
    text: cleanText,
    type: 'system',
    status
  });

  if (mirrorToLegacyThread) {
    const batch = writeBatch(db);

    const flatMessageRef = doc(collection(db, 'messages'));
    const legacyMessageRef = doc(collection(db, 'trades', tradeId, 'messages'));

    batch.set(flatMessageRef, messageData);
    batch.set(legacyMessageRef, messageData);

    await batch.commit();
  } else {
    await addDoc(collection(db, 'messages'), messageData);
  }

  await updateTradeLastMessage({
    tradeId,
    text: cleanText,
    senderId: 'system'
  });

  if (!sendNotification) return;

  const uniqueRecipients = uniqueIds(recipientIds);

  await Promise.all(
    uniqueRecipients.map(recipientId =>
      sendNotification(recipientId, {
        title,
        body: cleanText,
        type: 'trade_update',
        targetId: tradeId,
        targetType: 'trade',
        actionUrl: `/trade/${tradeId}`
      })
    )
  );
};

export const setTradeTyping = async (
  tradeId: string,
  userId: string,
  isTyping: boolean
) => {
  await updateDoc(doc(db, 'trades', tradeId), {
    [`typing.${userId}`]: isTyping,
    updatedAt: serverTimestamp()
  });
};
