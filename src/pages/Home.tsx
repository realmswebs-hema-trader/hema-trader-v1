import { useEffect, useState } from 'react';
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Compass,
  Filter,
  Loader2,
  MapPin,
  Search,
  ShieldCheck,
  Star,
  Tag,
  Truck
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { calculateDistance, formatDistance } from '../lib/geoUtils';
import { useAuth } from '../components/auth/AuthContext';

interface Listing {
  id: string;
  title: string;
  price: number;
  category: string;
  location: string;
  images: string[];
  ownerId: string;
  latitude?: number;
  longitude?: number;
  status: string;
  isBoosted?: boolean;
}

interface UserProfile {
  id: string;
  uid?: string;
  displayName?: string;
  name?: string;
  email?: string;
  photoURL?: string;
  roles?: string[];
  averageRating?: number;
  avgDriverRating?: number;
  totalTrades?: number;
  deliveriesCount?: number;
  followersCount?: number;
  verificationStatus?: string;
  driverStatus?: string;
  isOnline?: boolean;
  lastActiveAt?: any;
}

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
};

const isActive = (profile: UserProfile) => {
  if (profile.isOnline) return true;

  const lastActive = getMillis(profile.lastActiveAt);
  return lastActive > 0 && Date.now() - lastActive < 15 * 60 * 1000;
};

const getDisplayName = (profile: UserProfile) =>
  profile.displayName || profile.name || profile.email || 'Marketplace User';

const sortProfiles = (a: UserProfile, b: UserProfile) => {
  const activeDelta = Number(isActive(b)) - Number(isActive(a));
  if (activeDelta !== 0) return activeDelta;

  const ratingDelta = (b.averageRating || b.avgDriverRating || 0) - (a.averageRating || a.avgDriverRating || 0);
  if (ratingDelta !== 0) return ratingDelta;

  return getMillis(b.lastActiveAt) - getMillis(a.lastActiveAt);
};

function StatusDot({ active }: { active: boolean }) {
  if (!active) {
    return <span className="h-3 w-3 rounded-full border-2 border-brand-bg bg-slate-700" />;
  }

  return (
    <span className="relative flex h-3 w-3">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-brand-bg bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.75)]" />
    </span>
  );
}

function UserCard({
  profile,
  type
}: {
  profile: UserProfile;
  type: 'merchant' | 'driver';
}) {
  const active = isActive(profile);
  const verified = profile.verificationStatus === 'verified';
  const rating = type === 'driver'
    ? profile.avgDriverRating || profile.averageRating || 0
    : profile.averageRating || 0;

  return (
    <Link to={`/profile/${profile.id}`} className="group block">
      <motion.article
        whileHover={{ y: -5 }}
        className="relative flex w-40 shrink-0 flex-col items-center gap-3 rounded-3xl border border-white/5 bg-brand-card p-4 text-center shadow-2xl transition-all hover:border-amber-500/30"
      >
        <div className="absolute right-4 top-4">
          <StatusDot active={active} />
        </div>

        <div className="relative">
          <img
            src={profile.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`}
            className="h-20 w-20 rounded-full border-2 border-amber-500/20 object-cover"
            alt={getDisplayName(profile)}
            referrerPolicy="no-referrer"
          />

          {verified && (
            <div className="absolute -bottom-1 -right-1 rounded-full bg-amber-500 p-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-black" />
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <p className="w-32 truncate text-[12px] font-semibold text-white group-hover:text-amber-500">
            {getDisplayName(profile)}
          </p>

          <div className="flex items-center justify-center gap-1 text-[8px] font-black uppercase tracking-widest">
            <span className={active ? 'text-green-500' : 'text-slate-600'}>
              {active ? 'Active' : 'Offline'}
            </span>
          </div>

          <div className="flex items-center justify-center gap-1 text-[9px] font-black text-amber-500">
            <Star className="h-3 w-3 fill-amber-500" />
            {rating.toFixed(1)}
          </div>

          <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
            {type === 'driver'
              ? `${profile.deliveriesCount || 0} deliveries`
              : `${profile.totalTrades || 0} trades`}
          </p>
        </div>

        <div className="mt-1 rounded-full border border-white/5 bg-white/5 px-4 py-2 text-[8px] font-black uppercase tracking-widest text-slate-400 transition-all group-hover:bg-white group-hover:text-black">
          View Profile
        </div>
      </motion.article>
    </Link>
  );
}

export default function Home() {
  const { user, profile } = useAuth();

  const [listings, setListings] = useState<Listing[]>([]);
  const [followedListings, setFollowedListings] = useState<Listing[]>([]);
  const [sellers, setSellers] = useState<UserProfile[]>([]);
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeUsersCount, setActiveUsersCount] = useState(0);
  const [recentAlert, setRecentAlert] = useState<string | null>(null);

  useEffect(() => {
    const qActiveUsers = query(
      collection(db, 'users'),
      where('isOnline', '==', true)
    );

    const unsubscribe = onSnapshot(
      qActiveUsers,
      snap => setActiveUsersCount(snap.size),
      err => handleFirestoreError(err, OperationType.SUBSCRIBE, 'users/active')
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const qLatestListing = query(
      collection(db, 'listings'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    let initial = true;

    const unsubscribe = onSnapshot(
      qLatestListing,
      snap => {
        if (initial) {
          initial = false;
          return;
        }

        if (!snap.empty) {
          const item = snap.docs[0].data();
          setRecentAlert(`Live: ${item.title} just posted`);
          window.setTimeout(() => setRecentAlert(null), 5000);
        }
      },
      err => handleFirestoreError(err, OperationType.SUBSCRIBE, 'listings/latest')
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let isMounted = true;
    let listingsReady = false;
    let sellersReady = false;

    const finishLoading = () => {
      if (isMounted && listingsReady && sellersReady) {
        setLoading(false);
      }
    };

    setLoading(true);
    setError(null);

    const qSellers = query(
      collection(db, 'users'),
      where('roles', 'array-contains', 'seller'),
      limit(100)
    );

    const unsubscribeSellers = onSnapshot(
      qSellers,
      snap => {
        const sellerData = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as UserProfile))
          .sort(sortProfiles);

        setSellers(sellerData);
        sellersReady = true;
        finishLoading();
      },
      err => {
        const message = handleFirestoreError(err, OperationType.SUBSCRIBE, 'users/sellers');
        setError(message);
        sellersReady = true;
        finishLoading();
      }
    );

    const qDrivers = query(
      collection(db, 'users'),
      where('roles', 'array-contains', 'driver'),
      limit(100)
    );

    const unsubscribeDrivers = onSnapshot(
      qDrivers,
      snap => {
        const driverData = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as UserProfile))
          .sort(sortProfiles);

        setDrivers(driverData);
      },
      err => handleFirestoreError(err, OperationType.SUBSCRIBE, 'users/drivers')
    );

    async function fetchListings() {
      try {
        const qListings = query(
          collection(db, 'listings'),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc'),
          limit(20)
        );

        const listingSnap = await getDocs(qListings);

        if (!isMounted) return;

        setListings(
          listingSnap.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
          })) as Listing[]
        );

        if (user) {
          const followQuery = query(
            collection(db, 'follows'),
            where('followerId', '==', user.uid),
            limit(100)
          );

          const followSnap = await getDocs(followQuery);
          const followingIds = followSnap.docs.map(docSnap => docSnap.data().followingId);

          if (followingIds.length > 0) {
            const followedListingsQ = query(
              collection(db, 'listings'),
              where('ownerId', 'in', followingIds.slice(0, 10)),
              where('status', '==', 'active'),
              orderBy('createdAt', 'desc'),
              limit(10)
            );

            const followedListingsSnap = await getDocs(followedListingsQ);

            if (isMounted) {
              setFollowedListings(
                followedListingsSnap.docs.map(docSnap => ({
                  id: docSnap.id,
                  ...docSnap.data()
                })) as Listing[]
              );
            }
          } else {
            setFollowedListings([]);
          }
        } else {
          setFollowedListings([]);
        }
      } catch (err) {
        const message = handleFirestoreError(err, OperationType.READ, 'home/listings');
        setError(message);
      } finally {
        listingsReady = true;
        finishLoading();
      }
    }

    fetchListings();

    return () => {
      isMounted = false;
      unsubscribeSellers();
      unsubscribeDrivers();
    };
  }, [user]);

  const verifiedMerchants = sellers
    .filter(seller => seller.verificationStatus === 'verified')
    .sort(sortProfiles);

  const unverifiedMerchants = sellers
    .filter(seller => seller.verificationStatus !== 'verified')
    .sort(sortProfiles);

  const availableDrivers = drivers
    .filter(driver => isActive(driver) || driver.driverStatus === 'available')
    .sort(sortProfiles);

  const filteredListings = listings
    .filter(listing => listing.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .map(listing => {
      const hasDistance =
        typeof profile?.latitude === 'number' &&
        typeof profile?.longitude === 'number' &&
        typeof listing.latitude === 'number' &&
        typeof listing.longitude === 'number';

      return {
        ...listing,
        distance: hasDistance
          ? calculateDistance(profile.latitude, profile.longitude, listing.latitude, listing.longitude)
          : null
      };
    })
    .sort((a, b) => {
      if (a.isBoosted && !b.isBoosted) return -1;
      if (!a.isBoosted && b.isBoosted) return 1;

      if (nearbyOnly && a.distance !== null && b.distance !== null) {
        return a.distance - b.distance;
      }

      return 0;
    });

  return (
    <div className="space-y-12 pb-20">
      <section className="relative space-y-8 py-10 md:py-20">
        <div className="flex flex-col items-center space-y-6 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-6xl font-serif leading-[0.9] tracking-tighter text-white md:text-8xl"
          >
            Trade <span className="italic text-amber-500">local</span>. <br />
            Trade <span className="italic text-amber-500">safe</span>.
          </motion.h1>

          <p className="max-w-md text-[10px] font-bold uppercase leading-relaxed tracking-wider text-slate-500">
            The community marketplace for authenticated goods, secured by protected escrow.
          </p>
        </div>

        <div className="mx-auto max-w-2xl px-4">
          <div className="group relative flex items-center">
            <Search className="absolute left-6 h-5 w-5 text-slate-600 transition-colors group-focus-within:text-amber-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="What are you looking for today?"
              className="w-full rounded-[2.5rem] border border-white/5 bg-brand-card py-6 pl-16 pr-8 text-sm text-white shadow-2xl transition-all placeholder:italic focus:border-amber-500/50 focus:outline-none"
            />
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <Link
              to="/drivers"
              className="flex items-center gap-3 rounded-full border border-amber-500/30 bg-amber-500/10 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-amber-500 transition-all hover:bg-amber-500 hover:text-black"
            >
              <Truck className="h-4 w-4" />
              Find Drivers
            </Link>

            <button
              onClick={() => setNearbyOnly(!nearbyOnly)}
              className={`flex items-center gap-3 rounded-full border px-6 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${
                nearbyOnly
                  ? 'border-amber-500 bg-amber-500 text-black'
                  : 'border-white/5 bg-white/5 text-slate-400 hover:border-amber-500/30'
              }`}
            >
              <Compass className={`h-4 w-4 ${nearbyOnly ? 'animate-spin-slow' : ''}`} />
              Nearby Only
            </button>

            <button className="flex items-center gap-3 rounded-full border border-white/5 bg-white/5 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 transition-all hover:border-amber-500/30">
              <Filter className="h-4 w-4" />
              Advanced Filters
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <div>
            <h2 className="font-serif text-2xl text-white">Verified Merchants</h2>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500 italic">
              Background-checked sellers with proven history
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-500">
            Trusted Sellers <ArrowRight className="h-3 w-3" />
          </div>
        </div>

        {loading ? (
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {[1, 2, 3, 4].map(item => (
              <div key={item} className="h-52 w-40 shrink-0 animate-pulse rounded-3xl bg-white/5" />
            ))}
          </div>
        ) : verifiedMerchants.length === 0 ? (
          <div className="rounded-3xl border border-white/5 bg-black/20 p-6 text-center text-[10px] font-bold uppercase tracking-wider text-slate-600">
            No verified merchants yet
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {verifiedMerchants.map(seller => (
              <UserCard key={seller.id} profile={seller} type="merchant" />
            ))}
          </div>
        )}
      </section>

      {!loading && unverifiedMerchants.length > 0 && (
        <section className="space-y-6">
          <div className="px-2">
            <h2 className="font-serif text-2xl text-white">Unverified Merchants</h2>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500 italic">
              Sellers who have not completed verification yet
            </p>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {unverifiedMerchants.map(seller => (
              <UserCard key={seller.id} profile={seller} type="merchant" />
            ))}
          </div>
        </section>
      )}

      {!loading && availableDrivers.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <div>
              <h2 className="font-serif text-2xl text-white">Available Drivers</h2>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500 italic">
                Online or available delivery partners
              </p>
            </div>
            <Link
              to="/drivers"
              className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-500"
            >
              View Drivers <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {availableDrivers.map(driver => (
              <UserCard key={driver.id} profile={driver} type="driver" />
            ))}
          </div>
        </section>
      )}

      {user && followedListings.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <div>
              <h2 className="font-serif text-2xl text-white">Following</h2>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500 italic">
                Recent arrivals from sellers you follow
              </p>
            </div>
          </div>

          <div className="flex gap-6 overflow-x-auto px-2 pb-6 scrollbar-hide">
            {followedListings.map(listing => (
              <Link key={listing.id} to={`/listing/${listing.id}`} className="group w-64 shrink-0 space-y-4">
                <div className="relative aspect-[4/3] overflow-hidden rounded-[2.5rem] border border-white/5 bg-brand-card">
                  {listing.images?.[0] ? (
                    <img
                      src={listing.images[0]}
                      alt={listing.title}
                      className="h-full w-full object-cover grayscale-[0.2] transition-all group-hover:scale-105 group-hover:grayscale-0"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-800">
                      NO VISUAL
                    </div>
                  )}

                  <div className="absolute right-4 top-4 rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 backdrop-blur-md">
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">
                      ${listing.price.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="px-2">
                  <h4 className="truncate font-serif text-lg leading-tight text-white transition-colors group-hover:text-amber-500">
                    {listing.title}
                  </h4>
                  <div className="mt-1 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
                    <MapPin className="h-3 w-3 text-amber-500/50" />
                    <span>{listing.location}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-8">
        <div className="flex items-center gap-4 px-2">
          <h2 className="font-serif text-3xl text-white">Marketplace</h2>
          <div className="h-[1px] flex-1 bg-white/5" />

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 rounded-full border border-amber-500/10 bg-amber-500/5 px-3 py-1 md:flex">
              <div className="h-1 w-1 animate-pulse rounded-full bg-amber-500" />
              <span className="text-[8px] font-bold uppercase tracking-widest text-amber-500/70">
                {activeUsersCount} active users
              </span>
            </div>

            <div className="flex items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              <span className="text-[8px] font-bold uppercase tracking-widest text-green-500">
                Live Marketplace
              </span>
            </div>

            {!loading && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                {filteredListings.length} listings available
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map(item => (
              <div key={item} className="aspect-[4/3] animate-pulse rounded-[3rem] bg-white/5" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-[3rem] border border-red-500/20 bg-red-500/5 py-32 text-center">
            <p className="font-serif text-xl italic text-red-500">
              We could not connect to the marketplace.
            </p>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {error}
            </p>
          </div>
        ) : filteredListings.length === 0 ? (
          <div className="flex flex-col items-center justify-center space-y-6 rounded-[3rem] border border-white/5 bg-brand-card py-40 text-center shadow-2xl">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/5 text-slate-800">
              <Search className="h-10 w-10" />
            </div>

            <div className="space-y-2">
              <h3 className="font-serif text-2xl text-white">No matches found</h3>
              <p className="mx-auto max-w-xs font-serif italic text-slate-500">
                We could not find any listings for your current search or category.
              </p>
            </div>

            <button
              onClick={() => setSearchQuery('')}
              className="rounded-xl bg-white px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black shadow-xl transition-all hover:bg-amber-500 active:scale-[0.98]"
            >
              Clear Search & Explore All
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {filteredListings.map(listing => (
              <Link key={listing.id} to={`/listing/${listing.id}`}>
                <motion.article
                  whileHover={{ scale: 1.02 }}
                  className="group relative overflow-hidden rounded-[3rem] border border-white/5 bg-brand-card shadow-2xl"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-slate-900">
                    {listing.images?.[0] ? (
                      <img
                        src={listing.images[0]}
                        alt={listing.title}
                        className={`h-full w-full object-cover transition-all duration-700 group-hover:scale-105 group-hover:grayscale-0 ${
                          listing.isBoosted ? 'grayscale-0' : 'grayscale-[0.2]'
                        }`}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-800">
                        NO VISUAL
                      </div>
                    )}

                    {listing.isBoosted && (
                      <div className="absolute left-6 top-6 z-10 flex items-center gap-1.5 rounded-full border border-black/10 bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 shadow-xl">
                        <Star className="h-3 w-3 animate-pulse fill-black text-black" />
                        <p className="text-[9px] font-black uppercase tracking-widest text-black">
                          Promoted
                        </p>
                      </div>
                    )}

                    {!listing.isBoosted && listing.distance !== null && (
                      <div className="absolute left-6 top-6 rounded-full border border-white/10 bg-black/60 px-4 py-2 backdrop-blur-md">
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">
                          {formatDistance(listing.distance)}
                        </p>
                      </div>
                    )}

                    <div className="absolute right-6 top-6 rounded-lg bg-amber-500 px-3 py-1.5 shadow-xl transition-transform group-hover:scale-110">
                      <p className="text-[10px] font-black uppercase tracking-widest text-black">
                        ${listing.price.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 p-8">
                    <span className="rounded-full border border-slate-800 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-slate-600">
                      {listing.category}
                    </span>

                    <h3 className="font-serif text-2xl leading-tight tracking-tight text-white transition-colors group-hover:text-amber-500">
                      {listing.title}
                    </h3>

                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      <MapPin className="h-3 w-3 text-amber-500/50" />
                      <span>{listing.location}</span>
                    </div>
                  </div>
                </motion.article>
              </Link>
            ))}
          </div>
        )}
      </section>

      <AnimatePresence>
        {recentAlert && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-24 left-1/2 z-50 rounded-full border border-white/20 bg-amber-500 px-6 py-3 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
                <Tag className="h-3 w-3 text-black" />
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-black">
                {recentAlert}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
