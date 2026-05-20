import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Flag,
  Loader2,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Star,
  Truck,
  UserMinus,
  UserPlus,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import { createDeliveryRequest } from '../services/deliveryService';

interface DriverProfileData {
  id: string;
  displayName?: string;
  name?: string;
  email?: string;
  photoURL?: string;
  verificationStatus?: string;
  isOnline?: boolean;
  lastActiveAt?: any;
  driverStatus?: string;
  availability?: string;
  vehicleType?: string;
  vehicleSize?: string;
  deliveriesCount?: number;
  completedDeliveries?: number;
  avgDriverRating?: number;
  averageRating?: number;
  location?: string;
  city?: string;
  country?: string;
  responseSpeed?: string;
}

interface TradeOption {
  id: string;
  buyerId: string;
  sellerId: string;
  amount?: number;
  status?: string;
  listingTitle?: string;
}

interface DriverReview {
  id: string;
  rating: number;
  comment?: string;
  createdAt?: any;
}

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
};

const isActive = (driver: DriverProfileData) => {
  if (driver.isOnline) return true;
  const lastActive = getMillis(driver.lastActiveAt);
  return lastActive > 0 && Date.now() - lastActive < 15 * 60 * 1000;
};

const lastActiveText = (driver: DriverProfileData) => {
  if (isActive(driver)) return 'Active Now';

  const lastActive = getMillis(driver.lastActiveAt);
  if (!lastActive) return 'Offline';

  const minutes = Math.max(1, Math.floor((Date.now() - lastActive) / 60000));
  if (minutes < 60) return `Last active ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  return `Last active ${hours}h ago`;
};

const displayName = (driver: DriverProfileData) =>
  driver.displayName || driver.name || driver.email || 'Driver';

const displayLocation = (driver: DriverProfileData) =>
  driver.location ||
  [driver.city, driver.country].filter(Boolean).join(', ') ||
  'Cameroon';

function OnlineDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-4 w-4">
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex h-4 w-4 rounded-full border-2 border-brand-card ${
          active ? 'bg-green-500' : 'bg-slate-500'
        }`}
      />
    </span>
  );
}

export default function DriverProfile() {
  const { id } = useParams();
  const { user, profile } = useAuth();

  const [driver, setDriver] = useState<DriverProfileData | null>(null);
  const [reviews, setReviews] = useState<DriverReview[]>([]);
  const [trades, setTrades] = useState<TradeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tradeId, setTradeId] = useState('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [urgency, setUrgency] = useState<'normal' | 'urgent' | 'same_day'>('normal');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [estimatedFee, setEstimatedFee] = useState(2500);

  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');

  useEffect(() => {
    if (!id) return;

    const unsubscribe = onSnapshot(doc(db, 'users', id), snap => {
      if (snap.exists()) {
        setDriver({ id: snap.id, ...snap.data() } as DriverProfileData);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const unsubscribe = onSnapshot(
      query(collection(db, 'driverReviews'), where('driverId', '==', id), limit(30)),
      snap => {
        setReviews(
          snap.docs
            .map(item => ({ id: item.id, ...item.data() } as DriverReview))
            .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt))
        );
      }
    );

    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!user || !id) return;

    const loadTradesAndFollow = async () => {
      const tradeSnap = await getDocs(query(collection(db, 'trades'), limit(100)));

      setTrades(
        tradeSnap.docs
          .map(item => ({ id: item.id, ...item.data() } as TradeOption))
          .filter(
            trade =>
              (trade.buyerId === user.uid || trade.sellerId === user.uid) &&
              trade.status !== 'completed' &&
              trade.status !== 'cancelled'
          )
      );

      const followId = `${user.uid}_${id}`;
      const followSnap = await getDoc(doc(db, 'follows', followId));
      setIsFollowing(followSnap.exists());
    };

    loadTradesAndFollow();
  }, [user, id]);

  const toggleFollow = async () => {
    if (!user || !id) return;

    const followId = `${user.uid}_${id}`;
    const followRef = doc(db, 'follows', followId);

    if (isFollowing) {
      await deleteDoc(followRef);
      await updateDoc(doc(db, 'users', id), {
        followersCount: increment(-1)
      });
      setIsFollowing(false);
    } else {
      await setDoc(followRef, {
        followerId: user.uid,
        followingId: id,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'users', id), {
        followersCount: increment(1)
      });
      setIsFollowing(true);
    }
  };

  const handleAssign = async () => {
    if (!user || !id || !tradeId || !pickupLocation || !deliveryLocation) return;

    const selectedTrade = trades.find(trade => trade.id === tradeId);
    if (!selectedTrade) return;

    setSaving(true);

    try {
      await createDeliveryRequest({
        tradeId,
        buyerId: selectedTrade.buyerId,
        sellerId: selectedTrade.sellerId,
        driverId: id,
        pickupLocation,
        deliveryLocation,
        deliveryNotes,
        urgency,
        estimatedFee
      });

      setAssignOpen(false);
      setTradeId('');
      setPickupLocation('');
      setDeliveryLocation('');
      setDeliveryNotes('');
      alert('Delivery request sent to driver.');
    } finally {
      setSaving(false);
    }
  };

  const handleReport = async () => {
    if (!user || !id || !reportReason) return;

    setSaving(true);

    try {
      await addDoc(collection(db, 'reports'), {
        reporterId: user.uid,
        targetId: id,
        targetType: 'driver',
        reason: reportReason,
        description: reportDescription,
        status: 'pending',
        createdAt: serverTimestamp()
      });

      setReportOpen(false);
      setReportReason('');
      setReportDescription('');
      alert('Report submitted.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="mx-auto max-w-xl py-24 text-center">
        <h1 className="font-serif text-3xl text-white">Driver not found</h1>
      </div>
    );
  }

  const active = isActive(driver);
  const rating = driver.avgDriverRating || driver.averageRating || 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 pb-24 pt-8">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" />
        Back to marketplace
      </Link>

      <section className="grid gap-6 rounded-[2rem] border border-white/5 bg-brand-card p-6 shadow-2xl md:grid-cols-[260px_1fr]">
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <img
              src={driver.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.id}`}
              alt={displayName(driver)}
              className="h-32 w-32 rounded-full border border-white/10 object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="absolute right-2 top-2">
              <OnlineDot active={active} />
            </div>
          </div>

          <h1 className="mt-5 font-serif text-3xl text-white">{displayName(driver)}</h1>

          <p className={`mt-1 text-[10px] font-black uppercase tracking-widest ${active ? 'text-green-500' : 'text-slate-500'}`}>
            {lastActiveText(driver)}
          </p>

          {driver.verificationStatus === 'verified' && (
            <div className="mt-4 flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-green-400">
              <ShieldCheck className="h-4 w-4" />
              Verified Driver
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-black/30 p-4">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Rating</p>
              <p className="mt-2 flex items-center gap-1 font-serif text-2xl text-white">
                <Star className="h-5 w-5 fill-amber-500 text-amber-500" />
                {rating.toFixed(1)}
              </p>
            </div>

            <div className="rounded-2xl bg-black/30 p-4">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Deliveries</p>
              <p className="mt-2 font-serif text-2xl text-white">
                {driver.deliveriesCount || driver.completedDeliveries || 0}
              </p>
            </div>

            <div className="rounded-2xl bg-black/30 p-4">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Vehicle</p>
              <p className="mt-2 text-sm font-bold text-white">
                {driver.vehicleType || 'Vehicle'} • {driver.vehicleSize || 'Medium'}
              </p>
            </div>

            <div className="rounded-2xl bg-black/30 p-4">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Response</p>
              <p className="mt-2 text-sm font-bold text-white">
                {driver.responseSpeed || 'Usually fast'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-slate-400">
            <MapPin className="h-4 w-4 text-amber-500" />
            {displayLocation(driver)}
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              to={`/messages/${driver.id}`}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white hover:text-black"
            >
              <MessageCircle className="h-4 w-4" />
              Message Driver
            </Link>

            <button
              onClick={() => setAssignOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-400"
            >
              <Truck className="h-4 w-4" />
              Assign Driver
            </button>

            <button
              onClick={toggleFollow}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:bg-white/10"
            >
              {isFollowing ? <UserMinus className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {isFollowing ? 'Following' : 'Follow'}
            </button>

            <button
              onClick={() => setReportOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/20"
            >
              <Flag className="h-4 w-4" />
              Report Driver
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/5 bg-brand-card p-6">
        <h2 className="font-serif text-2xl text-white">Driver Reviews</h2>

        {reviews.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No reviews yet.</p>
        ) : (
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {reviews.map(review => (
              <div key={review.id} className="rounded-2xl border border-white/5 bg-black/30 p-4">
                <div className="flex items-center gap-1 text-amber-500">
                  {[1, 2, 3, 4, 5].map(star => (
                    <Star
                      key={star}
                      className={`h-4 w-4 ${review.rating >= star ? 'fill-amber-500' : ''}`}
                    />
                  ))}
                </div>
                <p className="mt-3 text-sm text-slate-300">{review.comment || 'No comment.'}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <AnimatePresence>
        {assignOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              className="w-full max-w-lg space-y-5 rounded-[2rem] border border-white/10 bg-brand-card p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-2xl text-white">Select Trade To Deliver</h2>
                <button onClick={() => setAssignOpen(false)} className="text-slate-400 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <select
                value={tradeId}
                onChange={event => setTradeId(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">Choose trade/order</option>
                {trades.map(trade => (
                  <option key={trade.id} value={trade.id}>
                    {trade.listingTitle || `Trade ${trade.id.slice(-6)}`} • {trade.status || 'open'}
                  </option>
                ))}
              </select>

              <input
                value={pickupLocation}
                onChange={event => setPickupLocation(event.target.value)}
                placeholder="Pickup location"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
              />

              <input
                value={deliveryLocation}
                onChange={event => setDeliveryLocation(event.target.value)}
                placeholder="Delivery location"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
              />

              <select
                value={urgency}
                onChange={event => setUrgency(event.target.value as 'normal' | 'urgent' | 'same_day')}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="same_day">Same day</option>
              </select>

              <input
                type="number"
                value={estimatedFee}
                onChange={event => setEstimatedFee(Number(event.target.value))}
                placeholder="Estimated delivery fee"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
              />

              <textarea
                value={deliveryNotes}
                onChange={event => setDeliveryNotes(event.target.value)}
                placeholder="Delivery notes"
                className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
              />

              <button
                onClick={handleAssign}
                disabled={saving || !tradeId || !pickupLocation || !deliveryLocation}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Delivery Request'}
              </button>
            </motion.div>
          </div>
        )}

        {reportOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              className="w-full max-w-lg space-y-5 rounded-[2rem] border border-white/10 bg-brand-card p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-2xl text-white">Report Driver</h2>
                <button onClick={() => setReportOpen(false)} className="text-slate-400 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <select
                value={reportReason}
                onChange={event => setReportReason(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">Select reason</option>
                <option value="fraud">Fraud</option>
                <option value="abuse">Abuse</option>
                <option value="fake_delivery">Fake delivery</option>
                <option value="late_delivery">Late delivery</option>
                <option value="damaged_goods">Damaged goods</option>
                <option value="harassment">Harassment</option>
              </select>

              <textarea
                value={reportDescription}
                onChange={event => setReportDescription(event.target.value)}
                placeholder="Describe what happened"
                className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
              />

              <button
                onClick={handleReport}
                disabled={saving || !reportReason}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 py-4 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit Report'}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
