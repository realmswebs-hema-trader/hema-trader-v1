import React, { useState } from 'react';
import { Bell, MessageSquare, Tag, ShieldCheck, Star, Circle, CheckCircle2, X } from 'lucide-react';
import { useNotifications, Notification } from './NotificationContext';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';

export default function NotificationTray() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'message': return <MessageSquare className="h-4 w-4 text-blue-500" />;
      case 'offer': return <Tag className="h-4 w-4 text-amber-500" />;
      case 'trade_update': return <ShieldCheck className="h-4 w-4 text-green-500" />;
      case 'rating': return <Star className="h-4 w-4 text-yellow-500" />;
      default: return <Bell className="h-4 w-4 text-slate-500" />;
    }
  };

  const handleNotificationClick = (n: Notification) => {
    markAsRead(n.id);
    setIsOpen(false);
    if (n.targetId) {
      if (n.type === 'message' || n.type === 'trade_update' || n.type === 'offer') {
        navigate(`/trade/${n.targetId}`);
      } else if (n.type === 'rating') {
        navigate('/profile');
      }
    }
  };

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
      >
        <Bell className={`h-4 w-4 ${unreadCount > 0 ? 'text-amber-500' : 'text-slate-400'}`} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white ring-2 ring-brand-bg">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 mt-2 z-50 w-80 max-h-[80vh] flex flex-col rounded-2xl border border-white/5 bg-brand-card shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-white/5 bg-white/5 p-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Notifications</h3>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button 
                      onClick={markAllAsRead}
                      className="text-[9px] font-bold uppercase tracking-wider text-amber-500 hover:underline"
                    >
                      Clear All
                    </button>
                  )}
                  <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-hide">
                {notifications.length > 0 ? (
                  <div className="divide-y divide-white/5">
                    {notifications.map((n) => (
                      <div 
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        className={`group relative flex cursor-pointer gap-4 p-4 transition-colors hover:bg-white/5 ${!n.isRead ? 'bg-amber-500/[0.03]' : ''}`}
                      >
                        <div className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/5 ${!n.isRead ? 'bg-white/5' : 'bg-black/20 text-slate-600'}`}>
                          {getIcon(n.type)}
                        </div>
                        <div className="flex-1 space-y-1">
                          <p className={`text-[11px] font-bold leading-tight ${!n.isRead ? 'text-white' : 'text-slate-400'}`}>
                            {n.title}
                          </p>
                          <p className="text-[10px] italic font-serif text-slate-500 line-clamp-2">
                            {n.body}
                          </p>
                          <p className="text-[8px] font-bold uppercase tracking-widest text-slate-600">
                            {n.createdAt && formatDistanceToNow(n.createdAt.toDate ? n.createdAt.toDate() : new Date(n.createdAt))} ago
                          </p>
                        </div>
                        {!n.isRead && (
                          <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center opacity-40">
                    <Bell className="h-10 w-10 mb-4 text-slate-700" />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Nothing to see yet</p>
                  </div>
                )}
              </div>

              <div className="border-t border-white/5 bg-white/5 p-3 text-center">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">Hema Trader Activity Hub</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
