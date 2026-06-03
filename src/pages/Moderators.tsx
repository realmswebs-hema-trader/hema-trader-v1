import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  BriefcaseBusiness,
  Clock,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Search,
  ShieldCheck,
  Star,
  Truck,
  Users
} from 'lucide-react';
import {
  collection,
  limit,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';

import { useAuth } from '../components/auth/AuthContext';
import { db } from '../lib/firebase';

type ModeratorAvailability = 'available' | 'busy' | 'offline';

interface ModeratorProfile {
  id: string;
  uid?: string;
  email?: string;
  displayName?: string;
  name?: string;
  photoURL?: string;
  location?: string;
  city?: string;
  roles?: string[];
  isModerator?: boolean;
  moderatorVerified?: boolean;
  moderatorStatus?: 'pending_review' | 'approved' | 'rejected' | 'suspended';
  moderatorApplicationStatus?: string;
  moderatorAvailability?: ModeratorAvailability;
  moderatorCity?: string;
  moderatorRegions?: string[];
  moderatorRoutes?: string[];
  moderatorTransportCapacity?: string;
  moderatorRating?: number;
  averageRating?: number;
  completedModeratorDeliveries?: number;
  trustScore?: number;
}

const availabilityClass = (availability?: ModeratorAvailability) => {
  if (availability === 'available') {
    return 'border-green-500/20 bg-green-500/10 text-green-400';
  }

  if (availability === 'busy') {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-400';
  }

  return 'border-slate-500/20 bg-white/5 text-slate-400';
};

const displayName = (moderator: ModeratorProfile) =>
  moderator.displayName || moderator.name || moderator.email || 'Hema Moderator';

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default function Moderators() {
  const { user } = useAuth();
  const [moderators, setModerators] = useState<ModeratorProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');

    const moderatorQuery = query(
      collection(db, 'users'),
      where('roles', 'array-contains', 'moderator'),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      moderatorQuery,
      snapshot => {
        const nextModerators = snapshot.docs
          .map(docSnap => ({
            id: docSnap.id,
            uid: docSnap.id,
            ...docSnap.data()
          })) as ModeratorProfile[];

        setModerators(
          nextModerators
            .filter(
              moderator =>
                moderator.isModerator === true &&
                moderator.moderatorVerified === true &&
                moderator.moderatorStatus === 'approved'
            )
            .sort((a, b) => {
              const availabilityRank: Record<ModeratorAvailability, number> = {
                available: 3,
                busy: 2,
                offline: 1
              };

              const availabilityDelta =
                (availabilityRank[b.moderatorAvailability || 'offline'] || 0) -
                (availabilityRank[a.moderatorAvailability || 'offline'] || 0);

              if (availabilityDelta !== 0) return availabilityDelta;

              const trustDelta = safeNumber(b.trustScore) - safeNumber(a.trustScore);
              if (trustDelta !== 0) return trustDelta;

              return safeNumber(b.moderatorRating || b.averageRating) -
                safeNumber(a.moderatorRating || a.averageRating);
            })
        );
        setLoading(false);
      },
      err => {
        console.error('Moderator directory failed:', err);
        setError('Could not load verified moderators. Please try again.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const filteredModerators = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return moderators;

    return moderators.filter(moderator => {
      const searchable = [
        displayName(moderator),
        moderator.email,
        moderator.location,
        moderator.city,
        moderator.moderatorCity,
        moderator.moderatorTransportCapacity,
        ...(moderator.moderatorRegions || []),
        ...(moderator.moderatorRoutes || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(term);
    });
  }, [moderators, search]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-24">
      <section className="overflow-hidden rounded-[2.5rem] border border-white/5 bg-brand-card shadow-2xl">
        <div className="border-b border-white/5 bg-black/30 p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-black">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500">
                    Hema Verified Network
                  </p>
                  <h1 className="font-serif text-4xl text-white">
                    Moderators
                  </h1>
                </div>
              </div>
              <p className="max-w-3xl text-sm leading-relaxed text-slate-500">
                Verified moderators help coordinate long-distance deliveries, confirm pickup, protect escrow trust, and support buyers and sellers when a driver alone is not enough.
              </p>
            </div>

            <Link
              to="/moderator"
              className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-6 py-4 text-[10px] font-black uppercase tracking-widest text-amber-500 transition hover:bg-amber-500 hover:text-black"
            >
              <BriefcaseBusiness className="h-4 w-4" />
              Moderator Dashboard
            </Link>
          </div>
        </div>

        <div className="grid gap-px bg-white/5 md:grid-cols-3">
          {[
            {
              label: 'Available Moderators',
              value: moderators.filter(item => item.moderatorAvailability === 'available').length,
              icon: Users
            },
            {
              label: 'Coverage Routes',
              value: new Set(moderators.flatMap(item => item.moderatorRoutes || [])).size,
              icon: Navigation
            },
            {
              label: 'Protected Deliveries',
              value: moderators.reduce(
                (sum, item) => sum + safeNumber(item.completedModeratorDeliveries),
                0
              ),
              icon: Truck
            }
          ].map(metric => (
            <div key={metric.label} className="bg-brand-card p-6">
              <div className="flex items-center gap-3 text-amber-500">
                <metric.icon className="h-5 w-5" />
                <p className="text-[10px] font-black uppercase tracking-widest">
                  {metric.label}
                </p>
              </div>
              <p className="mt-4 font-serif text-3xl text-white">{metric.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/5 bg-brand-card p-4 shadow-2xl">
        <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-black/40 px-4 py-3">
          <Search className="h-5 w-5 text-slate-600" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search moderators by city, route, region, or service..."
            className="w-full bg-transparent text-sm text-white placeholder:text-slate-600 focus:outline-none"
          />
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-72 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        </div>
      ) : filteredModerators.length > 0 ? (
        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredModerators.map(moderator => {
            const name = displayName(moderator);
            const ownModeratorProfile = user?.uid === moderator.id;

            return (
              <article
                key={moderator.id}
                className="flex min-h-[28rem] flex-col rounded-[2rem] border border-white/5 bg-brand-card p-5 shadow-2xl"
              >
                <div className="flex items-start gap-4">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-amber-500/20 bg-black">
                    {moderator.photoURL ? (
                      <img
                        src={moderator.photoURL}
                        alt={name}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-amber-500 text-black">
                        <ShieldCheck className="h-7 w-7" />
                      </div>
                    )}
                    <span className="absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-black bg-green-500" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-serif text-xl text-white">
                        {name}
                      </h2>
                      <span className="flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-green-400">
                        <BadgeCheck className="h-3 w-3" />
                        Verified
                      </span>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                      <MapPin className="h-3 w-3 text-amber-500" />
                      {moderator.moderatorCity ||
                        moderator.location ||
                        moderator.city ||
                        'Cameroon'}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest ${availabilityClass(
                      moderator.moderatorAvailability
                    )}`}
                  >
                    {moderator.moderatorAvailability || 'offline'}
                  </span>
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-amber-500">
                    Escrow Support
                  </span>
                </div>

                <p className="mt-5 min-h-[4.5rem] text-sm leading-relaxed text-slate-400">
                  {moderator.moderatorTransportCapacity ||
                    'Verified long-distance marketplace delivery coordination for buyers and sellers.'}
                </p>

                <div className="mt-5 space-y-3">
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                      Areas Covered
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(moderator.moderatorRegions || []).length > 0 ? (
                        (moderator.moderatorRegions || []).slice(0, 5).map(region => (
                          <span
                            key={region}
                            className="rounded-full bg-white/5 px-2.5 py-1 text-[8px] font-bold uppercase text-slate-400"
                          >
                            {region}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-600">Coverage pending</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                      Routes
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(moderator.moderatorRoutes || []).length > 0 ? (
                        (moderator.moderatorRoutes || []).slice(0, 5).map(route => (
                          <span
                            key={route}
                            className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[8px] font-bold uppercase text-amber-400"
                          >
                            {route}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-600">Routes pending</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-auto grid grid-cols-3 gap-2 pt-6">
                  <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                    <Star className="h-4 w-4 text-amber-500" />
                    <p className="mt-2 text-[8px] font-black uppercase text-slate-600">
                      Rating
                    </p>
                    <p className="font-serif text-lg text-white">
                      {safeNumber(moderator.moderatorRating || moderator.averageRating).toFixed(1)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                    <Truck className="h-4 w-4 text-green-400" />
                    <p className="mt-2 text-[8px] font-black uppercase text-slate-600">
                      Trips
                    </p>
                    <p className="font-serif text-lg text-white">
                      {moderator.completedModeratorDeliveries || 0}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                    <Clock className="h-4 w-4 text-blue-400" />
                    <p className="mt-2 text-[8px] font-black uppercase text-slate-600">
                      Trust
                    </p>
                    <p className="font-serif text-lg text-white">
                      {safeNumber(moderator.trustScore, 100)}%
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Link
                    to={`/profile/${moderator.id}`}
                    className="flex items-center justify-center gap-2 rounded-xl bg-white py-3 text-[9px] font-black uppercase tracking-widest text-black transition hover:bg-amber-500"
                  >
                    Profile
                  </Link>
                  <Link
                    to={ownModeratorProfile ? '/moderator' : `/messages/${moderator.id}`}
                    className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-[9px] font-black uppercase tracking-widest text-slate-300 transition hover:bg-white/10"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    {ownModeratorProfile ? 'Dashboard' : 'Message'}
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="rounded-[2rem] border border-white/5 bg-brand-card p-10 text-center shadow-2xl">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-700" />
          <h2 className="mt-5 font-serif text-2xl text-white">
            No moderators found
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Try another city, route, or region. Admin can approve moderators from the admin dashboard.
          </p>
        </div>
      )}
    </div>
  );
}
