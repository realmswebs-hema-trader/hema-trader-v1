import React, { useState } from 'react';
import { Star, MessageSquare, ShieldCheck, Loader2 } from 'lucide-react';
import { doc, addDoc, collection, serverTimestamp, runTransaction } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { motion, AnimatePresence } from 'motion/react';

interface RatingModalProps {
  tradeId: string;
  revieweeId: string;
  onSuccess: () => void;
  onClose: () => void;
}

export default function RatingModal({ tradeId, revieweeId, onSuccess, onClose }: RatingModalProps) {
  const { user } = useAuth();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || rating === 0) return;

    setLoading(true);
    try {
      await runTransaction(db, async (transaction) => {
        // 1. Create Review
        const reviewRef = collection(db, 'reviews');
        const reviewId = `${tradeId}_${user.uid}`;
        const newReviewDoc = doc(reviewRef, reviewId);
        
        transaction.set(newReviewDoc, {
          tradeId,
          reviewerId: user.uid,
          revieweeId,
          rating,
          comment,
          createdAt: serverTimestamp(),
        });

        // 2. Update User Reputation
        const userRef = doc(db, 'users', revieweeId);
        const userSnap = await transaction.get(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const currentTotal = userData.totalTrades || 0;
          const currentAvg = userData.averageRating || 0;
          
          const newAvg = ((currentAvg * currentTotal) + rating) / (currentTotal + 1);
          
          transaction.update(userRef, {
            averageRating: newAvg,
            totalTrades: currentTotal + 1,
            lastReviewId: reviewId,
            badge: (currentTotal + 1) > 10 && newAvg >= 4.5 ? 'Elite Producer' : userData.badge || null,
            updatedAt: serverTimestamp()
          });
        }
      });
      onSuccess();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'reviews');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="w-full max-w-sm rounded-[2.5rem] bg-brand-card p-8 shadow-2xl border border-white/10"
      >
        <div className="text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h3 className="font-serif text-2xl text-white">Share your Experience</h3>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">How would you rate this transaction?</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onMouseEnter={() => setHovered(s)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(s)}
                className="transition-transform active:scale-90"
              >
                <Star 
                  className={`h-8 w-8 ${
                    (hovered || rating) >= s ? 'fill-amber-500 text-amber-500' : 'text-slate-800 transition-colors'
                  }`} 
                />
              </button>
            ))}
          </div>

          <div className="relative">
            <MessageSquare className="absolute left-4 top-4 h-4 w-4 text-slate-600" />
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Describe your experience (optional)..."
              rows={3}
              className="w-full rounded-2xl border border-white/5 bg-black/40 p-4 pl-12 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none resize-none"
            />
          </div>

          <div className="flex flex-col gap-3">
            <button
              disabled={loading || rating === 0}
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-4 text-[10px] font-bold uppercase tracking-widest text-black shadow-xl hover:bg-amber-500 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit Review'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[9px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-400"
            >
              Skip for now
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
