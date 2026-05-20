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

interface SendTradeMessageInput {
  tradeId: string;
  senderId: string;
  senderName: string;
  senderPhotoURL?: string;
  text: string;
  recipientIds: string[];
  sendNotification: SendNotificationFn;
}

interface SendSystemMessageInput {
  tradeId: string;
  text: string;
  recipientIds?: string[];
  sendNotification?: SendNotificationFn;
  title?: string;
}

export const sendTradeMessage = async ({
  tradeId,
  senderId,
  senderName,
  senderPhotoURL,
  text,
  recipientIds,
  sendNotification
}: SendTradeMessageInput) => {
  const cleanText = text.trim();

  if (!cleanText) return;

  await addDoc(collection(db, 'trades', tradeId, 'messages'), {
    tradeId,
    senderId,
    senderName,
    senderPhotoURL: senderPhotoURL || '',
    text: cleanText,
    type: 'user',
    readBy: [senderId],
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'trades', tradeId), {
    lastMessage: cleanText,
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: senderId,
    [`typing.${senderId}`]: false,
    updatedAt: serverTimestamp()
  });

  const uniqueRecipients = Array.from(
    new Set(recipientIds.filter(id => id && id !== senderId))
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
  title = 'Trade Update'
}: SendSystemMessageInput) => {
  const cleanText = text.trim();

  if (!cleanText) return;

  await addDoc(collection(db, 'trades', tradeId, 'messages'), {
    tradeId,
    senderId: 'system',
    senderName: 'Hema Trader',
    senderPhotoURL: '',
    text: cleanText,
    type: 'system',
    readBy: [],
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'trades', tradeId), {
    lastMessage: cleanText,
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: 'system',
    updatedAt: serverTimestamp()
  });

  if (!sendNotification) return;

  const uniqueRecipients = Array.from(new Set(recipientIds.filter(Boolean)));

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
    [`typing.${userId}`]: isTyping
  });
};
