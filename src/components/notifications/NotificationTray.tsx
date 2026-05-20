import React, { useState } from 'react';
import {
  Bell,
  MessageSquare,
  Tag,
  ShieldCheck,
  Star,
  X,
  CreditCard,
  Truck,
  AlertTriangle,
  Info,
  PackageCheck
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';

import {
  useNotifications,
  Notification,
  NotificationType
} from './NotificationContext';

const getDateFromFirestore = (value: any) => {
  if (!value) return null;

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getFallbackRoute = (notification: Notification) => {
  if (notification.actionUrl) return notification.actionUrl;

  if (!notification.targetId) {
    if (notification.type === 'rating') return '/profile';
    return '';
  }

  switch (notification.type) {
    case 'message':
      return `/messages/${notification.targetId}`;
    case 'trade_update':
    case 'offer':
    case 'payment':
    case 'escrow':
    case 'dispute':
      return `/trade/${notification.targetId}`;
    case 'delivery':
      return `/delivery/${notification.targetId}`;
    case 'rating':
      return '/profile';
    default:
      return notification.targetType === 'profile'
        ? `/profile/${notification.targetId}`
        : '';
  }
};

const getIcon = (type: NotificationType) => {
  switch (type) {
    case 'message':
      return <MessageSquare className="h-4 w-4 text-blue-500" />;
    case 'offer':
      return <Tag className="h-4 w-4 text-amber-500" />;
    case 'trade_update':
      return <ShieldCheck className="h-4 w-4 text-green-500" />;
    case 'rating':
      return <Star className="h-4 w-4 text-yellow-500" />;
    case 'payment':
      return <CreditCard className="h-4 w-4 text-emerald-500" />;
    case 'escrow':
      return <PackageCheck className="h-4 w-4 text-amber-500" />;
    case 'delivery':
      return <Truck className="h-4 w-4 text-green-500" />;
    case 'dispute':
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case 'system':
      return <Info className="h-4 w-4 text-slate-400" />;
    default:
      return <Bell className="h-4 w-4 text-slate-500" />;
  }
};

export default function NotificationTray() {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    loading
  } = useNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const handleNotificationClick = async (notification: Notification) => {
    await markAsRead(notification.id);
    setIsOpen(false);

    const route = getFallbackRoute(notification);

    if (route) {
      navigate(route);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(value => !value)}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 transition-colors hover:bg-white/10"
        aria-label="Notifications"
      >
        <Bell
          className={`h-4 w-4 ${
            unreadCount > 0 ? 'text-amber-500' : 'text-slate-400'
          }`}
        />

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white ring-2 ring-brand-bg">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />

            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              className="absolute right-0 z-50 mt-2 flex max-h-[80vh] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-white/5 bg-brand-card shadow-2xl sm:w-80"
            >
              <div className="flex items-center justify-between border-b border-white/5 bg-white/5 p-4">
                <div>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-white">
                    Notifications
                  </h3>
                  <p className="mt-1 text-[8px] font-bold uppercase tracking-widest text-slate-600">
                    {unreadCount} unread
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      className="text-[9px] font-bold uppercase tracking-wider text-amber-500 hover:underline"
                    >
                      Mark All
                    </button>
                  )}

                  <button
                    onClick={() => setIsOpen(false)}
                    className="text-slate-500 hover:text-white"
                    aria-label="Close notifications"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="scrollbar-hide flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center opacity-60">
                    <Bell className="mb-4 h-10 w-10 animate-pulse text-slate-700" />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Loading activity...
                    </p>
                  </div>
                ) : notifications.length > 0 ? (
                  <div className="divide-y divide-white/5">
                    {notifications.map(notification => {
                      const createdAt = getDateFromFirestore(notification.createdAt);

                      return (
                        <button
                          key={notification.id}
                          onClick={() => handleNotificationClick(notification)}
                          className={`group relative flex w-full cursor-pointer gap-4 p-4 text-left transition-colors hover:bg-white/5 ${
                            !notification.isRead ? 'bg-amber-500/[0.03]' : ''
                          }`}
                        >
                          <div
                            className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/5 ${
                              !notification.isRead
                                ? 'bg-white/5'
                                : 'bg-black/20 text-slate-600'
                            }`}
                          >
                            {getIcon(notification.type)}
                          </div>

                          <div className="min-w-0 flex-1 space-y-1">
                            <p
                              className={`text-[11px] font-bold leading-tight ${
                                !notification.isRead
                                  ? 'text-white'
                                  : 'text-slate-400'
                              }`}
                            >
                              {notification.title}
                            </p>

                            <p className="line-clamp-2 font-serif text-[10px] italic text-slate-500">
                              {notification.body}
                            </p>

                            <div className="flex items-center gap-2">
                              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-600">
                                {createdAt
                                  ? `${formatDistanceToNow(createdAt)} ago`
                                  : 'Just now'}
                              </p>

                              {notification.targetType && (
                                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[7px] font-black uppercase tracking-widest text-slate-600">
                                  {notification.targetType}
                                </span>
                              )}
                            </div>
                          </div>

                          {!notification.isRead && (
                            <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center opacity-40">
                    <Bell className="mb-4 h-10 w-10 text-slate-700" />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Nothing to see yet
                    </p>
                  </div>
                )}
              </div>

              <div className="border-t border-white/5 bg-white/5 p-3 text-center">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                  Hema Trader Activity Hub
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
