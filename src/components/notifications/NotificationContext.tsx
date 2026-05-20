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
  | 'dispute';

export interface Notification {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  targetId?: string;
  targetType?: 'trade' | 'listing' | 'driver' | 'delivery' | 'profile' | 'message';
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

const normalizeNotification = (id: string, data: any): Notification => {
  const isRead =
    typeof data.isRead === 'boolean'
      ? data.isRead
      : typeof data.read === 'boolean'
        ? data.read
        : false;

  return {
    id,
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

    setLoading(true);

    const notificationQuery = query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(75)
    );

    const unsubscribe = onSnapshot(
      notificationQuery,
      snapshot => {
        const nextNotifications = snapshot.docs.map(docSnap =>
          normalizeNotification(docSnap.id, docSnap.data())
        );

        setNotifications(nextNotifications);
        setLoading(false);
      },
      error => {
        console.error('Error fetching notifications:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const markAsRead = async (id: string) => {
    if (!user || !id) return;

    try {
      await updateDoc(doc(db, 'users', user.uid, 'notifications', id), {
        isRead: true,
        read: true,
        readAt: serverTimestamp()
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
          batch.update(
            doc(db, 'users', user.uid, 'notifications', notification.id),
            {
              isRead: true,
              read: true,
              readAt: serverTimestamp()
            }
          );
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
      await addDoc(collection(db, 'users', recipientId, 'notifications'), {
        title: data.title,
        body: data.body,
        type: data.type,
        targetId: data.targetId || '',
        targetType: data.targetType || 'trade',
        actionUrl:
          data.actionUrl ||
          (data.targetId ? `/trade/${data.targetId}` : ''),
        senderId: data.senderId || user?.uid || '',
        senderName:
          data.senderName ||
          profile?.displayName ||
          profile?.name ||
          user?.displayName ||
          'Hema Trader',
        metadata: data.metadata || {},
        isRead: false,
        read: false,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  };

  const sendManyNotifications = async (
    recipientIds: string[],
    data: SendNotificationInput
  ) => {
    const uniqueRecipientIds = Array.from(
      new Set(recipientIds.filter(Boolean))
    );

    if (uniqueRecipientIds.length === 0) return;

    try {
      const batch = writeBatch(db);

      uniqueRecipientIds.forEach(recipientId => {
        const notificationRef = doc(
          collection(db, 'users', recipientId, 'notifications')
        );

        batch.set(notificationRef, {
          title: data.title,
          body: data.body,
          type: data.type,
          targetId: data.targetId || '',
          targetType: data.targetType || 'trade',
          actionUrl:
            data.actionUrl ||
            (data.targetId ? `/trade/${data.targetId}` : ''),
          senderId: data.senderId || user?.uid || '',
          senderName:
            data.senderName ||
            profile?.displayName ||
            profile?.name ||
            user?.displayName ||
            'Hema Trader',
          metadata: data.metadata || {},
          isRead: false,
          read: false,
          createdAt: serverTimestamp()
        });
      });

      await batch.commit();
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
