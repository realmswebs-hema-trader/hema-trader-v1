import React, { useState } from 'react';
import { collection, addDoc, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { Star, Loader2, Truck } from 'lucide-react';
import { motion } from 'motion/react';

interface DriverRatingModalProps {
  tradeId: string;
  driverId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DriverRatingModal({ tradeId, driverId, onClose, onSuccess }: DriverRatingModalProps) {
  const { user } = useAuth();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user || rating === 0) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'driver_ratings'), {
        tradeId,
        driverId,
        raterId: user.uid,
        rating,
        comment,
        createdAt: serverTimestamp(),
      });

      // Update driver trust metrics
      const driverRef = doc(db, 'users', driverId);
      await updateDoc(driverRef, {
        deliveriesCount: increment(1),
        // Simplistic avg calculation for demo - in production use a cloud function for accuracy
        avgDriverRating: rating 
      });

      onSuccess();
    } catch (err) {
      console.error('Rating error:', err);
      alert('Failed to submit rating.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg rounded-[2.5rem] bg-brand-card p-10 border border-white/5 shadow-2xl space-y-8"
      >
        <div className="text-center space-y-3">
          <Truck className="h-10 w-10 text-amber-500 mx-auto" />
          <h2 className="font-serif text-3xl text-white">Rate your Driver</h2>
          <p className="text-[10px] uppercase tracking-widest text-slate-500">How was your delivery experience?</p>
        </div>

        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(star)}
              className="p-2 transition-transform hover:scale-110 active:scale-95"
            >
              <Star
                className={`h-8 w-8 transition-colors ${
                  star <= (hover || rating) ? 'fill-amber-500 text-amber-500' : 'text-slate-700'
                }`}
              />
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional: Tell others about the delivery quality..."
          className="w-full h-32 rounded-2xl bg-black/40 border border-white/5 p-6 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500 transition-all resize-none"
        />

        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={rating === 0 || submitting}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black shadow-xl hover:bg-amber-400 disabled:opacity-50 transition-all"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit Rating'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
