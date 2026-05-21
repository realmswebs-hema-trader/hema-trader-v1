import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Camera,
  CheckCircle2,
  Flag,
  Loader2,
  MessageCircle,
  ShieldCheck,
  Star,
  ThumbsUp,
  Truck,
  X
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import {
  ReputationReview,
  getReviewSummary,
  markReviewHelpful,
  reportReview,
  respondToReview,
  subscribeToUserReviews
} from '../../services/reputationService';

type ReviewFilter =
  | 'recent'
  | 'highest'
  | 'lowest'
  | 'verified'
  | 'photos'
  | 'drivers'
  | 'sellers'
  | 'buyers';

interface ProfileReviewsTabProps {
  targetUserId: string;
  profile: any;
  authUser: any;
  isOwnProfile: boolean;
}

const filters: Array<{ id: ReviewFilter; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'highest', label: 'Highest Rated' },
  { id: 'lowest', label: 'Lowest Rated' },
  { id: 'verified', label: 'Verified Only' },
  { id: 'photos', label: 'With Photos' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'sellers', label: 'Sellers' },
  { id: 'buyers', label: 'Buyers' }
];

const categoryLabel: Record<string, string> = {
  seller: 'Seller Review',
  buyer: 'Buyer Review',
  driver: 'Driver Review',
  delivery: 'Delivery Review',
  escrow: 'Escrow Review'
};

const breakdownLabels: Record<string, string> = {
  productQuality: 'Product Quality',
  communication: 'Communication',
  deliverySpeed: 'Delivery Speed',
  trustworthiness: 'Trustworthiness',
  packaging: 'Packaging',
  driverProfessionalism: 'Professionalism',
  safety: 'Safety',
  packageCondition: 'Package Condition',
  escrowExperience: 'Escrow'
};

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const formatDate = (value: any) => {
  const millis = getMillis(value);
  if (!millis) return 'Recently';

  return new Date(millis).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

const renderStars = (rating = 0, size = 'h-4 w-4') => (
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map(value => (
      <Star
        key={value}
        className={`${size} ${
          value <= Math.round(rating)
            ? 'fill-amber-500 text-amber-500'
            : 'text-slate-700'
        }`}
      />
    ))}
  </div>
);

const averageRating = (reviews: ReputationReview[]) => {
  if (!reviews.length) return 0;
  return reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length;
};

export default function ProfileReviewsTab({
  targetUserId,
  profile,
  authUser,
  isOwnProfile
}: ProfileReviewsTabProps) {
  const [reviews, setReviews] = useState<ReputationReview[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [filter, setFilter] = useState<ReviewFilter>('recent');
  const [loading, setLoading] = useState(true);
  const [responseText, setResponseText] = useState<Record<string, string>>({});
  const [respondingId, setRespondingId] = useState('');
  const [reportTarget, setReportTarget] = useState<ReputationReview | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    if (!targetUserId) return;

    setLoading(true);

    const unsubscribe = subscribeToUserReviews(targetUserId, nextReviews => {
      setReviews(nextReviews);
      getReviewSummary(targetUserId).then(setSummary).catch(console.error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [targetUserId]);

  const filteredReviews = useMemo(() => {
    let next = [...reviews];

    if (filter === 'highest') next.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
    if (filter === 'lowest') next.sort((a, b) => Number(a.rating || 0) - Number(b.rating || 0));
    if (filter === 'verified') next = next.filter(review => review.isVerifiedTrade);
    if (filter === 'photos') next = next.filter(review => review.images?.length);
    if (filter === 'drivers') next = next.filter(review => review.category === 'driver' || review.category === 'delivery');
    if (filter === 'sellers') next = next.filter(review => review.category === 'seller');
    if (filter === 'buyers') next = next.filter(review => review.category === 'buyer');

    return next;
  }, [reviews, filter]);

  const overallRating = summary?.averageRating ?? averageRating(reviews);
  const trustScore = summary?.trustScore ?? profile?.trustScore ?? 0;

  const handleHelpful = async (reviewId: string) => {
    if (!authUser) return;
    await markReviewHelpful(reviewId, authUser.uid);
  };

  const handleResponse = async (reviewId: string) => {
    if (!authUser || !responseText[reviewId]?.trim()) return;

    setRespondingId(reviewId);

    try {
      await respondToReview(reviewId, authUser.uid, responseText[reviewId]);
      setResponseText(current => ({ ...current, [reviewId]: '' }));
    } finally {
      setRespondingId('');
    }
  };

  const handleReportReview = async () => {
    if (!authUser || !reportTarget || !reportReason) return;

    setReporting(true);

    try {
      await reportReview({
        reviewId: reportTarget.id,
        reporterId: authUser.uid,
        reason: reportReason as any,
        description: reportDescription
      });

      setReportTarget(null);
      setReportReason('');
      setReportDescription('');
    } finally {
      setReporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 rounded-2xl border border-white/5 bg-black/30 p-10">
        <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Loading reputation...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/5 bg-black/30 p-5">
        <div className="grid gap-4 md:grid-cols-[1.2fr_2fr]">
          <div className="flex flex-col justify-center rounded-2xl border border-amber-500/10 bg-amber-500/5 p-6">
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-amber-500">
              Overall Rating
            </p>
            <div className="mt-3 flex items-end gap-3">
              <span className="font-serif text-5xl text-white">
                {Number(overallRating || 0).toFixed(1)}
              </span>
              <div className="pb-2">
                {renderStars(overallRating, 'h-5 w-5')}
                <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                  {summary?.totalReviews || reviews.length} reviews
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Trust Score', value: `${trustScore}%`, icon: ShieldCheck },
              { label: 'Verified', value: summary?.verifiedReviews || 0, icon: BadgeCheck },
              { label: 'Response', value: `${summary?.responseRate ?? profile?.responseRate ?? 0}%`, icon: MessageCircle },
              { label: 'Escrow', value: `${summary?.escrowSuccessRate ?? profile?.escrowSuccessRate ?? 0}%`, icon: ShieldCheck },
              { label: 'Delivery', value: `${summary?.deliveryCompletionRate ?? profile?.deliverySuccessRate ?? 0}%`, icon: Truck },
              { label: 'Repeat Buyers', value: `${summary?.repeatCustomerRate ?? profile?.repeatCustomerRate ?? 0}%`, icon: CheckCircle2 },
              { label: 'Photo Reviews', value: summary?.withPhotos || 0, icon: Camera },
              { label: 'Trust Tier', value: summary?.trustTier || profile?.trustTier || 'Community', icon: Star }
            ].map(item => (
              <div key={item.label} className="rounded-xl border border-white/5 bg-black/40 p-4">
                <item.icon className="mb-3 h-4 w-4 text-amber-500" />
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                  {item.label}
                </p>
                <p className="mt-1 truncate font-serif text-lg text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="scrollbar-hide flex gap-2 overflow-x-auto">
        {filters.map(item => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`shrink-0 rounded-xl px-4 py-3 text-[9px] font-black uppercase tracking-widest ${
              filter === item.id
                ? 'bg-amber-500 text-black'
                : 'border border-white/5 bg-white/5 text-slate-500 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {filteredReviews.length > 0 ? (
        <div className="space-y-4">
          {filteredReviews.map(review => {
            const hasMarkedHelpful = Boolean(review.helpfulBy?.includes(authUser?.uid));
            const reviewerPhoto =
              review.reviewerPhoto ||
              (review as any).reviewerPhotoURL ||
              `https://api.dicebear.com/7.x/avataaars/svg?seed=${review.reviewerId || review.id}`;

            return (
              <article
                key={review.id}
                className="rounded-2xl border border-white/5 bg-black/30 p-5 shadow-xl"
              >
                <div className="flex items-start gap-4">
                  <img
                    src={reviewerPhoto}
                    alt={review.reviewerName || 'Reviewer'}
                    className="h-12 w-12 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-serif text-lg text-white">
                          {review.reviewerName || 'Marketplace User'}
                        </p>

                        <div className="mt-1 flex flex-wrap gap-2">
                          {review.isVerifiedTrade && (
                            <span className="rounded-full bg-green-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-green-500">
                              Verified Trade
                            </span>
                          )}
                          {review.escrowProtected && (
                            <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-amber-500">
                              Escrow Protected
                            </span>
                          )}
                          <span className="rounded-full bg-white/5 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-slate-400">
                            {categoryLabel[review.category] || 'Review'}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        {renderStars(review.rating || 0)}
                        <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-600">
                          {formatDate(review.createdAt)}
                        </p>
                      </div>
                    </div>

                    <h3 className="mt-4 font-serif text-xl text-white">
                      {review.title || 'Verified marketplace experience'}
                    </h3>

                    <p className="mt-2 font-serif text-sm italic leading-relaxed text-slate-400">
                      {review.comment || 'No comment left.'}
                    </p>

                    {review.tags?.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {review.tags.map(tag => (
                          <span
                            key={tag}
                            className="rounded-full border border-white/5 bg-white/5 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-slate-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {review.breakdown && Object.keys(review.breakdown).length > 0 && (
                      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {Object.entries(review.breakdown).map(([key, value]) => (
                          <div key={key} className="rounded-xl border border-white/5 bg-black/40 p-3">
                            <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                              {breakdownLabels[key] || key}
                            </p>
                            <div className="mt-2">{renderStars(Number(value || 0), 'h-3 w-3')}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {review.images?.length > 0 && (
                      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {review.images.map(image => (
                          <img
                            key={image}
                            src={image}
                            alt="Review proof"
                            className="aspect-square rounded-xl object-cover"
                          />
                        ))}
                      </div>
                    )}

                    {review.response && (
                      <div className="mt-5 rounded-2xl border border-amber-500/10 bg-amber-500/5 p-4">
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">
                          Seller Response
                        </p>
                        <p className="mt-2 font-serif text-sm italic leading-relaxed text-slate-300">
                          {review.response}
                        </p>
                      </div>
                    )}

                    {isOwnProfile && !review.response && (
                      <div className="mt-5 space-y-3 rounded-2xl border border-white/5 bg-black/40 p-4">
                        <textarea
                          value={responseText[review.id] || ''}
                          onChange={event =>
                            setResponseText(current => ({
                              ...current,
                              [review.id]: event.target.value
                            }))
                          }
                          placeholder="Write a public response..."
                          className="h-20 w-full resize-none rounded-xl border border-white/5 bg-black/40 px-4 py-3 text-sm text-white focus:border-amber-500 focus:outline-none"
                        />
                        <button
                          onClick={() => handleResponse(review.id)}
                          disabled={!responseText[review.id]?.trim() || respondingId === review.id}
                          className="rounded-xl bg-white px-5 py-3 text-[9px] font-black uppercase tracking-widest text-black hover:bg-amber-500 disabled:opacity-40"
                        >
                          {respondingId === review.id ? 'Posting...' : 'Post Response'}
                        </button>
                      </div>
                    )}

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
                      <button
                        onClick={() => handleHelpful(review.id)}
                        disabled={!authUser}
                        className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-[9px] font-black uppercase tracking-widest ${
                          hasMarkedHelpful
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                            : 'border-white/5 bg-white/5 text-slate-500 hover:text-white'
                        }`}
                      >
                        <ThumbsUp className="h-4 w-4" />
                        Helpful {review.helpfulCount || 0}
                      </button>

                      {authUser && !isOwnProfile && (
                        <button
                          onClick={() => setReportTarget(review)}
                          className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-600 hover:text-red-500"
                        >
                          <Flag className="h-4 w-4" />
                          Report Review
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/5 bg-black/30 p-10 text-center">
          <AlertCircle className="mx-auto mb-4 h-10 w-10 text-slate-700" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            No reviews match this filter yet.
          </p>
        </div>
      )}

      <AnimatePresence>
        {reportTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              className="w-full max-w-lg space-y-6 rounded-[2rem] border border-white/5 bg-brand-card p-8 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-serif text-2xl text-white">Report Review</h2>
                  <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-500">
                    Help protect the reputation economy.
                  </p>
                </div>
                <button onClick={() => setReportTarget(null)} className="text-slate-500 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <select
                value={reportReason}
                onChange={event => setReportReason(event.target.value)}
                className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-red-500 focus:outline-none"
              >
                <option value="">Select reason...</option>
                <option value="fake_review">Fake review</option>
                <option value="abuse">Abuse</option>
                <option value="spam">Spam</option>
                <option value="harassment">Harassment</option>
              </select>

              <textarea
                value={reportDescription}
                onChange={event => setReportDescription(event.target.value)}
                placeholder="Add details..."
                className="h-28 w-full resize-none rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-red-500 focus:outline-none"
              />

              <button
                onClick={handleReportReview}
                disabled={!reportReason || reporting}
                className="flex w-full items-center justify-center gap-3 rounded-xl bg-red-500 py-4 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
              >
                {reporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
                Submit Review Report
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
