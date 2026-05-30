import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';

import { db } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';

export type NotificationType =
  | 'message'
  | 'trade_update'
  | 'offer'
  | 'rating'
  | 'system'
  | 'payment'
  | 'escrow'
  | 'delivery'
  | 'dispute'
  | 'wallet'
  | 'new_listing';

export interface Notification {
  id: string;
  userId?: string;
  recipientId?: string;
  title: string;
  body: string;
  type: NotificationType;
  targetId?: string;
  targetType?:
    | 'trade'
    | 'listing'
    | 'driver'
    | 'delivery'
    | 'profile'
    | 'message'
    | 'wallet'
    | 'user';
  actionUrl?: string;
  senderId?: string;
  senderName?: string;
  isRead: boolean;
  read?: boolean;
  createdAt: any;
  readAt?: any;
  metadata?: Record<string, any>;
}

export interface SendNotificationInput {
  title: string;
  body: string;
  type: NotificationType;
  targetId?: string;
  targetType?: Notification['targetType'];
  actionUrl?: string;
  senderId?: string;
  senderName?: string;
  metadata?: Record<string, any>;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  sendNotification: (
    recipientId: string,
    data: SendNotificationInput
  ) => Promise<void>;
  sendManyNotifications: (
    recipientIds: string[],
    data: SendNotificationInput
  ) => Promise<void>;
}

const NotificationContext =
  createContext<NotificationContextType | undefined>(undefined);

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (value.seconds) return value.seconds * 1000;
  if (value._seconds) return value._seconds * 1000;

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const uniqueIds = (ids: string[] = []) =>
  Array.from(new Set(ids.filter(Boolean)));

const normalizeNotification = (id: string, data: any): Notification => {
  const isRead =
    typeof data.isRead === 'boolean'
      ? data.isRead
      : typeof data.read === 'boolean'
        ? data.read
        : false;

  return {
    id,
    userId: data.userId,
    recipientId: data.recipientId,
    title: data.title || 'Notification',
    body: data.body || '',
    type: data.type || 'system',
    targetId: data.targetId,
    targetType: data.targetType,
    actionUrl: data.actionUrl,
    senderId: data.senderId,
    senderName: data.senderName,
    isRead,
    read: isRead,
    createdAt: data.createdAt,
    readAt: data.readAt,
    metadata: data.metadata || {}
  };
};

const sortNotifications = (items: Notification[]) =>
  [...items]
    .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt))
    .slice(0, 75);

const buildActionUrl = (data: SendNotificationInput) => {
  if (data.actionUrl) return data.actionUrl;
  if (!data.targetId) return '';

  if (data.targetType === 'listing') return `/listing/${data.targetId}`;
  if (data.targetType === 'delivery') return `/delivery/${data.targetId}`;
  if (data.targetType === 'wallet') return '/wallet';
  if (data.targetType === 'user' || data.targetType === 'profile') return '/profile';

  return `/trade/${data.targetId}`;
};

const buildNotificationPayload = (
  recipientId: string,
  data: SendNotificationInput,
  sender: {
    id?: string;
    name?: string;
  }
) => ({
  userId: recipientId,
  recipientId,
  recipientIds: [recipientId],
  title: data.title || 'Notification',
  body: data.body || '',
  type: data.type || 'system',
  targetId: data.targetId || '',
  targetType: data.targetType || 'trade',
  actionUrl: buildActionUrl(data),
  senderId: data.senderId || sender.id || '',
  senderName: data.senderName || sender.name || 'Hema Trader',
  metadata: data.metadata || {},
  isRead: false,
  read: false,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
});

export const NotificationProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { user, profile } = useAuth();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const unreadCount = useMemo(
    () => notifications.filter(notification => !notification.isRead).length,
    [notifications]
  );

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    let isMounted = true;
    let fallbackUnsubscribe: (() => void) | null = null;

    setLoading(true);

    const notificationsRef = collection(db, 'notifications');

    const orderedQuery = query(
      notificationsRef,
      where('recipientId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(75)
    );

    const fallbackQuery = query(
      notificationsRef,
      where('recipientId', '==', user.uid),
      limit(150)
    );

    const handleSnapshot = (snapshot: any) => {
      if (!isMounted) return;

      const nextNotifications = snapshot.docs.map((docSnap: any) =>
        normalizeNotification(docSnap.id, docSnap.data())
      );

      setNotifications(sortNotifications(nextNotifications));
      setLoading(false);
    };

    const subscribeFallback = () => {
      if (fallbackUnsubscribe) return;

      fallbackUnsubscribe = onSnapshot(
        fallbackQuery,
        handleSnapshot,
        error => {
          console.error('Fallback notification listener failed:', error);

          if (isMounted) {
            setNotifications([]);
            setLoading(false);
          }
        }
      );
    };

    const unsubscribe = onSnapshot(
      orderedQuery,
      handleSnapshot,
      error => {
        console.error('Notification listener failed. Retrying without ordering:', error);
        subscribeFallback();
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
      fallbackUnsubscribe?.();
    };
  }, [user?.uid]);

  const markAsRead = async (id: string) => {
    if (!user || !id) return;

    try {
      await updateDoc(doc(db, 'notifications', id), {
        isRead: true,
        read: true,
        readAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    if (!user || unreadCount === 0) return;

    try {
      const batch = writeBatch(db);

      notifications
        .filter(notification => !notification.isRead)
        .forEach(notification => {
          batch.update(doc(db, 'notifications', notification.id), {
            isRead: true,
            read: true,
            readAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });

      await batch.commit();
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  };

  const sendNotification = async (
    recipientId: string,
    data: SendNotificationInput
  ) => {
    if (!recipientId) return;

    try {
      await addDoc(
        collection(db, 'notifications'),
        buildNotificationPayload(recipientId, data, {
          id: user?.uid,
          name:
            profile?.displayName ||
            profile?.name ||
            user?.displayName ||
            'Hema Trader'
        })
      );
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  };

  const sendManyNotifications = async (
    recipientIds: string[],
    data: SendNotificationInput
  ) => {
    const uniqueRecipientIds = uniqueIds(recipientIds);

    if (uniqueRecipientIds.length === 0) return;

    try {
      const sender = {
        id: user?.uid,
        name:
          profile?.displayName ||
          profile?.name ||
          user?.displayName ||
          'Hema Trader'
      };

      for (let index = 0; index < uniqueRecipientIds.length; index += 450) {
        const batch = writeBatch(db);
        const chunk = uniqueRecipientIds.slice(index, index + 450);

        chunk.forEach(recipientId => {
          const notificationRef = doc(collection(db, 'notifications'));

          batch.set(
            notificationRef,
            buildNotificationPayload(recipientId, data, sender)
          );
        });

        await batch.commit();
      }
    } catch (error) {
      console.error('Failed to send notifications:', error);
    }
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        sendNotification,
        sendManyNotifications
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);

  if (context === undefined) {
    throw new Error(
      'useNotifications must be used within a NotificationProvider'
    );
  }

  return context;
};
