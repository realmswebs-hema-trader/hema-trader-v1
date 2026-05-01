import React, { useEffect } from 'react';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from './NotificationContext';
import { subHours, isBefore } from 'date-fns';

export default function RetentionManager() {
  const { user } = useAuth();
  const { sendNotification, notifications } = useNotifications();

  useEffect(() => {
    if (!user) return;

    const runChecks = async () => {
      const lastCheck = localStorage.getItem(`reengage_check_${user.uid}`);
      const now = new Date();
      
      // Only run every 6 hours
      if (lastCheck && isBefore(now, subHours(new Date(parseInt(lastCheck)), -6))) {
        return;
      }

      await checkIncompleteTrades();
      await checkUnansweredMessages();
      
      localStorage.setItem(`reengage_check_${user.uid}`, now.getTime().toString());
    };

    const checkIncompleteTrades = async () => {
      // Check for pending trades where the user is buyer or seller and hasn't been updated in 24h
      const twentyFourHoursAgo = subHours(new Date(), 24);
      
      // Query for trade where current user is involved and status is pending
      const tradesBuyerQ = query(
        collection(db, 'trades'),
        where('buyerId', '==', user.uid),
        where('status', '==', 'pending'),
        limit(10)
      );

      const tradesSellerQ = query(
        collection(db, 'trades'),
        where('sellerId', '==', user.uid),
        where('status', '==', 'pending'),
        limit(10)
      );

      const [buyerSnaps, sellerSnaps] = await Promise.all([
        getDocs(tradesBuyerQ),
        getDocs(tradesSellerQ)
      ]);

      const processTrades = (snaps: any) => {
        snaps.forEach((doc: any) => {
          const data = doc.data();
          const updatedAt = data.updatedAt?.toDate() || data.createdAt?.toDate();
          if (updatedAt && isBefore(updatedAt, twentyFourHoursAgo)) {
            // Check if we already sent a reminder recently
            const hasReminder = notifications.some(n => 
              n.type === 'system' && 
              n.targetId === doc.id && 
              n.title.includes('Reminder')
            );

            if (!hasReminder) {
              sendNotification(user.uid, {
                title: 'Trade Reminder',
                body: 'You have a pending trade waiting for action. Continue the negotiation to close the deal.',
                type: 'system',
                targetId: doc.id
              });
            }
          }
        });
      };

      processTrades(buyerSnaps);
      processTrades(sellerSnaps);
    };

    const checkUnansweredMessages = async () => {
      // This is more complex without Cloud Functions or a better schema. 
      // Simplified: Just notify about unread notifications of type 'message'
      const unreadMessages = notifications.filter(n => !n.isRead && n.type === 'message');
      if (unreadMessages.length > 5) {
         sendNotification(user.uid, {
            title: 'Busy Day?',
            body: `You have ${unreadMessages.length} unread messages waiting in your inbox.`,
            type: 'system'
         });
      }
    };

    const delay = setTimeout(runChecks, 5000); // Wait 5s after mount to not block UI
    return () => clearTimeout(delay);
  }, [user, notifications]);

  return null;
}
