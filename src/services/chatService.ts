import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import type { SendNotificationInput } from '../components/notifications/NotificationContext';

export const CONTACT_BLOCK_ERROR = 'CONTACT_BLOCKED';

const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const urlPattern = /(https?:\/\/|www\.|\.com\b|\.net\b|\.org\b|\.io\b)/i;
const phoneLikePattern = /(?:\+?\d[\s().-]*){7,}/;
const contactIntentPattern =
  /\b(phone|number|whatsapp|telegram|call me|text me|sms|contact me|mobile|momo number|orange money number|mtn number)\b/i;

const emailReplacePattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const urlReplacePattern = /(https?:\/\/\S+|www\.\S+|\S+\.com\b|\S+\.net\b|\S+\.org\b|\S+\.io\b)/gi;
const phoneLikeReplacePattern = /(?:\+?\d[\s().-]*){7,}/g;

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
  allowContactInfo?: boolean;
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

export class ContactInfoBlockedError extends Error {
  constructor() {
    super(
      'For safety, do not share phone numbers, WhatsApp, email, links, or outside contact details. Please keep the trade inside Hema Trader.'
    );
    this.name = CONTACT_BLOCK_ERROR;
    Object.setPrototypeOf(this, ContactInfoBlockedError.prototype);
  }
}

export const containsContactInfo = (value: string) => {
  const text = value.trim();

  if (!text) return false;
  if (emailPattern.test(text)) return true;
  if (urlPattern.test(text)) return true;
  if (phoneLikePattern.test(text)) return true;

  const digitCount = text.replace(/\D/g, '').length;
  return contactIntentPattern.test(text) && digitCount >= 5;
};

export const sanitizeContactText = (value: string) =>
  value
    .replace(emailReplacePattern, '[contact hidden]')
    .replace(urlReplacePattern, '[link hidden]')
    .replace(phoneLikeReplacePattern, '[number hidden]');

const assertNoContactInfo = (value: string) => {
  if (containsContactInfo(value)) {
    throw new ContactInfoBlockedError();
  }
};

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
  status = 'sent',
  contactVisibleAfterPayment = false
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
  contactVisibleAfterPayment?: boolean;
}) => {
  const cleanRecipientIds = uniqueIds(recipientIds);
  const participantIds = uniqueIds([senderId, ...cleanRecipientIds]);

  return {
    tradeId,
    listingId,
    userId: senderId,
    senderId,
    senderName,
    senderPhotoURL,
    recipientIds: cleanRecipientIds,
    participantIds,
    participants: participantIds,
    userIds: participantIds,
    text,
    type,
    status,
    contactVisibleAfterPayment,
    readBy: senderId === 'system' ? [] : [senderId],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
};

const updateTradeLastMessage = async ({
  tradeId,
  text,
  senderId,
  allowContactInfo
}: {
  tradeId: string;
  text: string;
  senderId: string;
  allowContactInfo?: boolean;
}) => {
  await updateDoc(doc(db, 'trades', tradeId), {
    lastMessage: allowContactInfo
      ? 'Driver shared delivery contact.'
      : sanitizeContactText(text),
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: senderId,
    [`typing.${senderId}`]: false,
    updatedAt: serverTimestamp()
  });
};

const safelyUpdateTradeLastMessage = async (input: {
  tradeId: string;
  text: string;
  senderId: string;
  allowContactInfo?: boolean;
}) => {
  try {
    await updateTradeLastMessage(input);
  } catch (error) {
    console.warn('Trade last message update failed:', error);
  }
};

const safelyMirrorToLegacyThread = async (
  tradeId: string,
  messageData: Record<string, unknown>
) => {
  try {
    await addDoc(collection(db, 'trades', tradeId, 'messages'), messageData);
  } catch (error) {
    console.warn('Legacy trade message mirror failed:', error);
  }
};

const safelySendNotifications = async (
  jobs: Array<() => Promise<void>>,
  context: string
) => {
  const results = await Promise.allSettled(jobs.map(job => job()));

  const failedCount = results.filter(result => result.status === 'rejected').length;

  if (failedCount > 0) {
    console.warn(`${context}: ${failedCount} notification(s) failed.`);
  }
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
  mirrorToLegacyThread = true,
  allowContactInfo = false
}: SendTradeMessageInput) => {
  const cleanText = cleanMessageText(text);

  if (!cleanText) return;

  if (!allowContactInfo) {
    assertNoContactInfo(cleanText);
  }

  const messageData = createMessageDocument({
    tradeId,
    listingId,
    senderId,
    senderName,
    senderPhotoURL,
    recipientIds,
    text: cleanText,
    type: 'user',
    status,
    contactVisibleAfterPayment: allowContactInfo
  });

  await addDoc(collection(db, 'messages'), messageData);

  if (mirrorToLegacyThread && !allowContactInfo) {
    await safelyMirrorToLegacyThread(tradeId, messageData);
  }

  await safelyUpdateTradeLastMessage({
    tradeId,
    text: cleanText,
    senderId,
    allowContactInfo
  });

  const uniqueRecipients = uniqueIds(
    recipientIds.filter(id => id !== senderId)
  );

  await safelySendNotifications(
    uniqueRecipients.map(recipientId => () =>
      sendNotification(recipientId, {
        title: `Message from ${senderName}`,
        body: allowContactInfo
          ? 'Driver shared delivery contact inside Hema Trader.'
          : sanitizeContactText(cleanText),
        type: 'message',
        targetId: tradeId,
        targetType: 'trade',
        actionUrl: `/trade/${tradeId}`,
        senderId,
        senderName
      })
    ),
    'Trade message notifications'
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

  await addDoc(collection(db, 'messages'), messageData);

  if (mirrorToLegacyThread) {
    await safelyMirrorToLegacyThread(tradeId, messageData);
  }

  await safelyUpdateTradeLastMessage({
    tradeId,
    text: cleanText,
    senderId: 'system'
  });

  if (!sendNotification) return;

  const uniqueRecipients = uniqueIds(recipientIds);

  await safelySendNotifications(
    uniqueRecipients.map(recipientId => () =>
      sendNotification(recipientId, {
        title,
        body: sanitizeContactText(cleanText),
        type: 'trade_update',
        targetId: tradeId,
        targetType: 'trade',
        actionUrl: `/trade/${tradeId}`
      })
    ),
    'System trade notifications'
  );
};

export const setTradeTyping = async (
  tradeId: string,
  userId: string,
  isTyping: boolean
) => {
  try {
    await updateDoc(doc(db, 'trades', tradeId), {
      [`typing.${userId}`]: isTyping,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.warn('Typing status update failed:', error);
  }
};
