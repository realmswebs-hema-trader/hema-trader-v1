import React, { createContext, useContext, useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, where, getDocs, writeBatch } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';

export interface Notification {
  id: string;
  title: string;
  body: string;
  type: 'message' | 'trade_update' | 'offer' | 'rating' | 'system';
  targetId?: string;
  isRead: boolean;
  createdAt: any;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  sendNotification: (userId: string, data: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => Promise<void>;
  loading: boolean;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const unreadCount = notifications.filter(n => !n.isRead).length;

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Notification[];
      setNotifications(docs);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching notifications:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // Update heartbeats/lastActiveAt
  useEffect(() => {
    if (!user) return;
    
    const updateActivity = async () => {
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          lastActiveAt: serverTimestamp()
        });
      } catch (e) {
        console.error("Failed to update activity heartbeat", e);
      }
    };

    updateActivity();
    const interval = setInterval(updateActivity, 1000 * 60 * 5); // Every 5 mins
    return () => clearInterval(interval);
  }, [user]);

  const markAsRead = async (id: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'notifications', id), {
        isRead: true
      });
    } catch (e) {
      console.error("Read mark failed", e);
    }
  };

  const markAllAsRead = async () => {
    if (!user || unreadCount === 0) return;
    try {
      const batch = writeBatch(db);
      notifications.filter(n => !n.isRead).forEach(n => {
        batch.update(doc(db, 'users', user.uid, 'notifications', n.id), { isRead: true });
      });
      await batch.commit();
    } catch (e) {
      console.error("Mark all as read failed", e);
    }
  };

  const sendNotification = async (recipientId: string, data: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => {
    try {
      await addDoc(collection(db, 'users', recipientId, 'notifications'), {
        ...data,
        isRead: false,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.error("Failed to send notification:", e);
    }
  };

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead, sendNotification, loading }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
