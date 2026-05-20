import React, { useState } from 'react';
import { Star, MessageSquare, ShieldCheck, Loader2 } from 'lucide-react';
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp
} from 'firebase/firestore';
import { motion } from 'motion/react';

import { db } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';

interface RatingModalProps {
  tradeId: string;
  revieweeId: string;
  onSuccess: () => void;
  onClose: () => void;
}

export default function RatingModal({
  tradeId,
  revieweeId,
  onSuccess,
  onClose
}: RatingModalProps) {
  const { user } = useAuth();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user || rating === 0 || loading) {
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      await runTransaction(db, async transaction => {
        const reviewId = `${tradeId}_${user.uid}`;
        const reviewRef = doc(collection(db, 'reviews'), reviewId);

        const existingReview = await transaction.get(reviewRef);

        if (existingReview.exists()) {
          throw new Error('You have already reviewed this transaction.');
        }

        transaction.set(reviewRef, {
          tradeId,
          reviewerId: user.uid,
          revieweeId,
          rating,
          comment: comment.trim(),
          createdAt: serverTimestamp()
        });

        const userRef = doc(db, 'users', revieweeId);
        const userSnap = await transaction.get(userRef);

        if (!userSnap.exists()) {
          return;
        }

        const userData = userSnap.data();

        const currentTotal =
          typeof userData.totalTrades === 'number' ? userData.totalTrades : 0;

        const currentAverage =
          typeof userData.averageRating === 'number'
            ? userData.averageRating
            : 0;

        const nextTotal = currentTotal + 1;
        const nextAverage = (currentAverage * currentTotal + rating) / nextTotal;

        transaction.update(userRef, {
          averageRating: nextAverage,
          totalTrades: nextTotal,
          lastReviewId: reviewId,
          badge:
            nextTotal > 10 && nextAverage >= 4.5
              ? 'Elite Producer'
              : userData.badge || null,
          updatedAt: serverTimestamp()
        });
      });

      onSuccess();
    } catch (error) {
      console.error('Failed to submit review:', error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to submit review. Please try again.'
      );
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
        className="w-full max-w-sm rounded-[2.5rem] border border-white/10 bg-brand-card p-8 shadow-2xl"
      >
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            <ShieldCheck className="h-8 w-8" />
          </div>

          <h3 className="font-serif text-2xl text-white">
            Share your Experience
          </h3>

          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            How would you rate this transaction?
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                type="button"
                aria-label={`Rate ${star} star${star === 1 ? '' : 's'}`}
                onMouseEnter={() => setHovered(star)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(star)}
                className="transition-transform active:scale-90"
              >
                <Star
                  className={`h-8 w-8 ${
                    (hovered || rating) >= star
                      ? 'fill-amber-500 text-amber-500'
                      : 'text-slate-800 transition-colors'
                  }`}
                />
              </button>
            ))}
          </div>

          <div className="relative">
            <MessageSquare className="absolute left-4 top-4 h-4 w-4 text-slate-600" />

            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Describe your experience (optional)..."
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-2xl border border-white/5 bg-black/40 p-4 pl-12 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
            />
          </div>

          {errorMessage && (
            <p className="text-center text-xs font-semibold text-red-400">
              {errorMessage}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <button
              disabled={loading || rating === 0}
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-4 text-[10px] font-bold uppercase tracking-widest text-black shadow-xl transition-all hover:bg-amber-500 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Submit Review'
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="text-[9px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-400 disabled:opacity-50"
            >
              Skip for now
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
