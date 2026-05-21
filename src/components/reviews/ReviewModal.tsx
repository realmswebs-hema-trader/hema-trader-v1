import { useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Star,
  Tag,
  X
} from 'lucide-react';
import { motion } from 'motion/react';

import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationContext';
import {
  RatingBreakdown,
  REVIEW_CATEGORIES,
  REVIEW_TAGS,
  ReviewCategory,
  submitReview
} from '../../services/reputationService';

interface ReviewModalProps {
  tradeId: string;
  reviewedUserId: string;
  initialCategory?: ReviewCategory;
  onClose: () => void;
  onSuccess?: () => void;
}

const sellerDimensions: { key: keyof RatingBreakdown; label: string }[] = [
  { key: 'productQuality', label: 'Product Quality' },
  { key: 'communication', label: 'Communication' },
  { key: 'trustworthiness', label: 'Trustworthiness' },
  { key: 'packaging', label: 'Packaging' }
];

const driverDimensions: { key: keyof RatingBreakdown; label: string }[] = [
  { key: 'deliverySpeed', label: 'Delivery Speed' },
  { key: 'driverProfessionalism', label: 'Professionalism' },
  { key: 'communication', label: 'Communication' },
  { key: 'safety', label: 'Safety' },
  { key: 'packageCondition', label: 'Package Condition' }
];

const escrowDimensions: { key: keyof RatingBreakdown; label: string }[] = [
  { key: 'escrowExperience', label: 'Escrow Experience' },
  { key: 'communication', label: 'Communication' },
  { key: 'trustworthiness', label: 'Trustworthiness' }
];

export default function ReviewModal({
  tradeId,
  reviewedUserId,
  initialCategory = 'seller',
  onClose,
  onSuccess
}: ReviewModalProps) {
  const { user, profile } = useAuth();
  const { sendNotification } = useNotifications();

  const [rating, setRating] = useState(5);
  const [category, setCategory] = useState<ReviewCategory>(initialCategory);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [breakdown, setBreakdown] = useState<RatingBreakdown>({
    communication: 5,
    trustworthiness: 5
  });
  const [images, setImages] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dimensions = useMemo(() => {
    if (category === 'driver' || category === 'delivery') return driverDimensions;
    if (category === 'escrow') return escrowDimensions;
    return sellerDimensions;
  }, [category]);

  const toggleTag = (tag: string) => {
    setTags(current =>
      current.includes(tag)
        ? current.filter(item => item !== tag)
        : [...current, tag].slice(0, 6)
    );
  };

  const updateBreakdown = (key: keyof RatingBreakdown, value: number) => {
    setBreakdown(current => ({
      ...current,
      [key]: value
    }));
  };

  const handleImages = (files: FileList | null) => {
    if (!files) return;
    setImages(Array.from(files).slice(0, 5));
  };

  const handleSubmit = async () => {
    if (!user) return;

    setSaving(true);
    setError('');

    try {
      await submitReview({
        tradeId,
        reviewerId: user.uid,
        reviewerName:
          profile?.displayName ||
          profile?.name ||
          user.displayName ||
          'Hema Trader',
        reviewerPhoto: profile?.photoURL || user.photoURL || '',
        reviewedUserId,
        rating,
        title: title.trim() || 'Verified trade experience',
        comment: comment.trim(),
        category,
        tags,
        breakdown,
        images,
        sendNotification
      });

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit review.');
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = rating > 0 && comment.trim().length >= 8;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-white/10 bg-brand-card p-6 shadow-2xl"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-amber-500">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-[9px] font-black uppercase tracking-[0.25em]">
                Verified Trade Review
              </span>
            </div>
            <h2 className="font-serif text-3xl text-white">
              How was your experience?
            </h2>
            <p className="mt-2 text-[10px] uppercase leading-relaxed tracking-widest text-slate-500">
              Your review helps build the Hema Trader trust economy.
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 p-3 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
            <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Overall Rating
            </p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(value => (
                <button
                  key={value}
                  onClick={() => setRating(value)}
                  className="transition hover:scale-110"
                >
                  <Star
                    className={`h-9 w-9 ${
                      value <= rating
                        ? 'fill-amber-500 text-amber-500'
                        : 'text-slate-700'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {REVIEW_CATEGORIES.map(item => (
              <button
                key={item.value}
                onClick={() => setCategory(item.value)}
                className={`rounded-xl border px-3 py-3 text-[8px] font-black uppercase tracking-widest transition ${
                  category === item.value
                    ? 'border-amber-500 bg-amber-500 text-black'
                    : 'border-white/5 bg-white/5 text-slate-500 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {dimensions.map(item => (
              <div
                key={item.key}
                className="rounded-2xl border border-white/5 bg-black/30 p-4"
              >
                <p className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-500">
                  {item.label}
                </p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(value => (
                    <button
                      key={value}
                      onClick={() => updateBreakdown(item.key, value)}
                    >
                      <Star
                        className={`h-5 w-5 ${
                          value <= Number(breakdown[item.key] || 0)
                            ? 'fill-amber-500 text-amber-500'
                            : 'text-slate-700'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder="Review title"
            className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
          />

          <textarea
            value={comment}
            onChange={event => setComment(event.target.value)}
            placeholder="Tell the community what happened..."
            className="h-32 w-full resize-none rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
          />

          <div>
            <div className="mb-3 flex items-center gap-2 text-slate-500">
              <Tag className="h-4 w-4" />
              <p className="text-[10px] font-black uppercase tracking-widest">
                Trust Tags
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {REVIEW_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-3 py-2 text-[8px] font-black uppercase tracking-widest ${
                    tags.includes(tag)
                      ? 'border-amber-500 bg-amber-500 text-black'
                      : 'border-white/5 bg-white/5 text-slate-500 hover:text-white'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-black/30 p-6 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-amber-500/40 hover:text-white">
            <Camera className="h-5 w-5" />
            Upload Proof Photos
            <input
              hidden
              type="file"
              accept="image/*"
              multiple
              onChange={event => handleImages(event.target.files)}
            />
          </label>

          {images.length > 0 && (
            <div className="grid grid-cols-5 gap-2">
              {images.map(file => (
                <img
                  key={file.name}
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="aspect-square rounded-xl object-cover"
                />
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-[10px] font-bold uppercase tracking-wider text-red-400">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-widest text-black shadow-xl hover:bg-amber-500 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Publish Verified Review
          </button>
        </div>
      </motion.div>
    </div>
  );
}
