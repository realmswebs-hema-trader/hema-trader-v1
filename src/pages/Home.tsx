import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
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
  MessageCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  Star,
  Tag,
  Truck,
  Radio,
  Lock,
  Flag
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
  createdAt?: any;
}

interface ListingWithDistance extends Listing {
  distance: number | null;
}

interface UserProfile {
  id: string;
  uid?: string;
  displayName?: string;
  name?: string;
  email?: string;
  photoURL?: string;
  roles: string[];
  averageRating?: number;
  avgDriverRating?: number;
  ratingCount?: number;
  totalTrades?: number;
  deliveriesCount?: number;
  followersCount?: number;
  verificationStatus?: string;
  driverStatus?: string;
  vehicleType?: string;
  vehicleSize?: string;
  location?: string;
  city?: string;
  country?: string;
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

const normalizeRoles = (roles: unknown): string[] => {
  if (!Array.isArray(roles) || roles.length === 0) return ['buyer'];
  return roles.filter(role => typeof role === 'string');
};

const normalizeUser = (user: any): UserProfile => ({
  ...user,
  roles: normalizeRoles(user.roles),
  verificationStatus: user.verificationStatus || 'unverified'
});

const isActive = (profile: UserProfile) => {
  if (profile.isOnline) return true;

  const lastActive = getMillis(profile.lastActiveAt);
  return lastActive > 0 && Date.now() - lastActive < 15 * 60 * 1000;
};

const displayName = (profile: UserProfile) =>
  profile.displayName || profile.name || profile.email || 'Marketplace User';

const displayLocation = (profile: UserProfile) =>
  profile.location ||
  [profile.city, profile.country].filter(Boolean).join(', ') ||
  'Cameroon';

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

const sortProfiles = (a: UserProfile, b: UserProfile) => {
  const activeDelta = Number(isActive(b)) - Number(isActive(a));
  if (activeDelta !== 0) return activeDelta;

  const ratingA = a.averageRating || a.avgDriverRating || 0;
  const ratingB = b.averageRating || b.avgDriverRating || 0;
  if (ratingB !== ratingA) return ratingB - ratingA;

  return getMillis(b.lastActiveAt) - getMillis(a.lastActiveAt);
};

const profileMatchesSearch = (profile: UserProfile, searchTerm: string) => {
  if (!searchTerm) return true;

  const searchable = [
    displayName(profile),
    profile.email,
    displayLocation(profile),
    ...profile.roles
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return searchable.includes(searchTerm);
};

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

function SectionHeader({
  icon,
  title,
  subtitle,
  action,
  tone = 'amber'
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  action: string;
  tone?: 'amber' | 'green' | 'red';
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-green-500/10 text-green-500'
      : tone === 'red'
        ? 'bg-red-500/10 text-red-500'
        : 'bg-amber-500/10 text-amber-500';

  return (
    <div className="flex items-end justify-between gap-4 px-2">
      <div className="flex items-start gap-3">
        <div className={`mt-1 rounded-full p-2 ${toneClass}`}>{icon}</div>
        <div>
          <h2 className="font-serif text-2xl text-white md:text-3xl">
            {title}
          </h2>
          <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="hidden items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-500 sm:flex">
        {action}
        <ArrowRight className="h-3 w-3" />
      </div>
    </div>
  );
}

function MerchantCard({
  merchant,
  verified
}: {
  merchant: UserProfile;
  verified: boolean;
}) {
  const active = isActive(merchant);
  const rating = merchant.averageRating || 0;
  const ratingCount = merchant.ratingCount || merchant.totalTrades || 0;
  const roleText = merchant.roles.map(titleCase).join(' • ');

  return (
    <motion.article
      whileHover={{ y: -4 }}
      className="relative flex w-60 shrink-0 flex-col rounded-lg border border-white/10 bg-brand-card/80 p-5 shadow-2xl"
    >
      <div className="flex flex-col items-center text-center">
        <div className="relative">
          <img
            src={
              merchant.photoURL ||
              `https://api.dicebear.com/7.x/avataaars/svg?seed=${merchant.id}`
            }
            alt={displayName(merchant)}
            referrerPolicy="no-referrer"
            className="h-24 w-24 rounded-full border border-white/10 object-cover"
          />
          <div className="absolute right-1 top-1">
            <OnlineDot active={active} />
          </div>
        </div>

        <h3 className="mt-4 max-w-full truncate font-serif text-xl text-white">
          {displayName(merchant)}
        </h3>

        <p className={`text-[10px] font-bold ${active ? 'text-green-500' : 'text-slate-500'}`}>
          {active ? 'Active' : 'Offline'}
        </p>

        <div className="mt-3 flex items-center gap-1 text-sm font-bold text-amber-500">
          <Star className="h-4 w-4 fill-amber-500" />
          {rating.toFixed(1)}
          <span className="font-normal text-slate-400">({ratingCount})</span>
        </div>

        <div
          className={`mt-3 rounded-md px-3 py-1 text-[10px] font-bold ${
            verified
              ? 'bg-green-500/15 text-green-400'
              : 'bg-white/10 text-slate-300'
          }`}
        >
          {verified ? 'Verified Member' : 'Unverified'}
        </div>

        <p className="mt-4 text-sm text-slate-400">
          {merchant.totalTrades || 0} Trades
          <span className="px-2 text-slate-600">•</span>
          {rating > 0 ? `${rating.toFixed(1)} Rating` : 'New'}
        </p>

        <p className="mt-3 text-sm text-slate-400">{roleText}</p>

        <div className="mt-5 flex items-center gap-2 text-xs text-slate-400">
          <MapPin className="h-4 w-4 text-slate-500" />
          {displayLocation(merchant)}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Link
          to={`/profile/${merchant.id}`}
          className="rounded-lg border border-white/10 px-3 py-3 text-center text-[10px] font-bold text-white transition hover:bg-white hover:text-black"
        >
          View Profile
        </Link>

        <Link
          to={`/profile/${merchant.id}`}
          className="flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-[10px] font-bold text-amber-500 transition hover:bg-amber-500 hover:text-black"
        >
          <MessageCircle className="h-3 w-3" />
          Message
        </Link>
      </div>
    </motion.article>
  );
}

function DriverCard({ driver }: { driver: UserProfile }) {
  const available = isActive(driver) || driver.driverStatus === 'available';
  const rating = driver.avgDriverRating || driver.averageRating || 0;
  const ratingCount = driver.ratingCount || driver.deliveriesCount || 0;

  return (
    <motion.article
      whileHover={{ y: -4 }}
      className="relative flex w-60 shrink-0 flex-col rounded-lg border border-white/10 bg-brand-card/80 p-5 shadow-2xl"
    >
      <div className="flex flex-col items-center text-center">
        <div className="relative">
          <img
            src={
              driver.photoURL ||
              `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.id}`
            }
            alt={displayName(driver)}
            referrerPolicy="no-referrer"
            className="h-24 w-24 rounded-full border border-white/10 object-cover"
          />
          <div className="absolute right-1 top-1">
            <OnlineDot active={available} />
          </div>
        </div>

        <h3 className="mt-4 max-w-full truncate font-serif text-xl text-white">
          {displayName(driver)}
        </h3>

        <p className={`text-[10px] font-bold ${available ? 'text-green-500' : 'text-slate-500'}`}>
          {available ? 'Available' : 'Offline'}
        </p>

        <div className="mt-3 flex items-center gap-1 text-sm font-bold text-amber-500">
          <Star className="h-4 w-4 fill-amber-500" />
          {rating.toFixed(1)}
          <span className="font-normal text-slate-400">({ratingCount})</span>
        </div>

        <p className="mt-3 text-sm text-slate-400">
          {driver.deliveriesCount || 0} Deliveries
        </p>

        <p className="mt-3 text-sm text-slate-400">
          {driver.vehicleType || 'Vehicle'}
          <span className="px-2 text-slate-600">•</span>
          {driver.vehicleSize || 'Medium'}
        </p>

        <div className="mt-5 flex items-center gap-2 text-xs text-slate-400">
          <MapPin className="h-4 w-4 text-slate-500" />
          {displayLocation(driver)}
        </div>
      </div>

      <Link
        to={`/profile/${driver.id}`}
        className="mt-6 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-3 text-center text-[10px] font-bold text-green-400 transition hover:bg-green-500 hover:text-black"
      >
        Hire Driver
      </Link>
    </motion.article>
  );
}

export default function Home() {
  const { user, profile } = useAuth();

  const [listings, setListings] = useState<Listing[]>([]);
  const [followedListings, setFollowedListings] = useState<Listing[]>([]);
  const [marketUsers, setMarketUsers] = useState<UserProfile[]>([]);
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
    let initial = true;

    const unsubscribe = onSnapshot(
      query(collection(db, 'listings'), limit(25)),
      snap => {
        if (initial) {
          initial = false;
          return;
        }

        const activeListings = snap.docs
          .map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
          })) as Listing[];

        const newest = activeListings
          .filter(item => item.status === 'active')
          .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt))[0];

        if (newest) {
          setRecentAlert(`Live: ${newest.title} just posted`);
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
    let usersReady = false;

    const finishLoading = () => {
      if (isMounted && listingsReady && usersReady) {
        setLoading(false);
      }
    };

    setLoading(true);
    setError(null);

    const unsubscribeUsers = onSnapshot(
      query(collection(db, 'users')),
      snap => {
        if (!isMounted) return;

        const allUsers = snap.docs
          .map(docSnap =>
            normalizeUser({
              id: docSnap.id,
              ...docSnap.data()
            })
          )
          .sort(sortProfiles);

        setMarketUsers(allUsers);

        setDrivers(
          allUsers
            .filter(item => item.roles.includes('driver') || Boolean(item.driverStatus))
            .sort(sortProfiles)
        );

        usersReady = true;
        finishLoading();
      },
      err => {
        if (!isMounted) return;
        setError(handleFirestoreError(err, OperationType.SUBSCRIBE, 'users'));
        usersReady = true;
        finishLoading();
      }
    );

    async function fetchListings() {
      try {
        const listingSnap = await getDocs(
          query(collection(db, 'listings'), limit(100))
        );

        if (!isMounted) return;

        const allListings = listingSnap.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data()
        })) as Listing[];

        const activeListings = allListings
          .filter(listing => listing.status === 'active')
          .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt))
          .slice(0, 20);

        setListings(activeListings);

        if (user) {
          const followSnap = await getDocs(
            query(
              collection(db, 'follows'),
              where('followerId', '==', user.uid),
              limit(100)
            )
          );

          const followingIds = followSnap.docs.map(docSnap => docSnap.data().followingId);

          if (followingIds.length > 0) {
            setFollowedListings(
              allListings
                .filter(
                  listing =>
                    listing.status === 'active' &&
                    followingIds.includes(listing.ownerId)
                )
                .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt))
                .slice(0, 10)
            );
          } else {
            setFollowedListings([]);
          }
        } else {
          setFollowedListings([]);
        }
      } catch (err) {
        if (isMounted) {
          setError(handleFirestoreError(err, OperationType.READ, 'home/listings'));
        }
      } finally {
        listingsReady = true;
        finishLoading();
      }
    }

    fetchListings();

    return () => {
      isMounted = false;
      unsubscribeUsers();
    };
  }, [user]);

  const searchTerm = searchQuery.trim().toLowerCase();

  const searchedUsers = marketUsers.filter(profileItem =>
    profileMatchesSearch(profileItem, searchTerm)
  );

  const verifiedMerchants = searchedUsers.filter(
    profileItem => profileItem.verificationStatus === 'verified'
  );

  const unverifiedMerchants = searchedUsers.filter(
    profileItem => profileItem.verificationStatus !== 'verified'
  );

  const availableDrivers = drivers
    .filter(driver => profileMatchesSearch(driver, searchTerm))
    .filter(driver => isActive(driver) || driver.driverStatus === 'available');

  const filteredListings: ListingWithDistance[] = listings
    .filter(listing => {
      if (!searchTerm) return true;

      return [listing.title, listing.category, listing.location]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(searchTerm);
    })
    .map(listing => {
      const hasDistance =
        typeof profile?.latitude === 'number' &&
        typeof profile?.longitude === 'number' &&
        typeof listing.latitude === 'number' &&
        typeof listing.longitude === 'number';

      return {
        ...listing,
        distance: hasDistance
          ? calculateDistance(
              profile.latitude,
              profile.longitude,
              listing.latitude,
              listing.longitude
            )
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
    <div className="space-y-12 pb-24">
      <section className="space-y-8 pt-8">
        <div className="mx-auto flex max-w-2xl flex-wrap justify-center gap-4">
          <Link
            to="/drivers"
            className="flex items-center gap-3 rounded-full border border-amber-500/30 bg-amber-500/10 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-amber-500 transition hover:bg-amber-500 hover:text-black"
          >
            <Truck className="h-4 w-4" />
            Find Drivers
          </Link>

          <button
            onClick={() => setNearbyOnly(!nearbyOnly)}
            className={`flex items-center gap-3 rounded-full border px-6 py-3 text-[10px] font-black uppercase tracking-widest transition ${
              nearbyOnly
                ? 'border-amber-500 bg-amber-500 text-black'
                : 'border-white/10 bg-white/5 text-slate-400 hover:border-amber-500/30'
            }`}
          >
            <Compass className="h-4 w-4" />
            Nearby Only
          </button>

          <button className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 transition hover:border-amber-500/30">
            <Filter className="h-4 w-4" />
            Advanced Filters
          </button>
        </div>

        <div className="mx-auto max-w-2xl px-4">
          <div className="group relative flex items-center">
            <Search className="absolute left-6 h-5 w-5 text-slate-600 group-focus-within:text-amber-500" />
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search merchants, products, or locations..."
              className="w-full rounded-2xl border border-white/10 bg-brand-card py-5 pl-16 pr-14 text-sm text-white shadow-2xl outline-none transition placeholder:text-slate-600 focus:border-amber-500/50"
            />
            <Search className="absolute right-6 h-4 w-4 text-slate-500" />
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-red-500/20 bg-red-500/5 p-8 text-center text-red-400">
          {error}
        </div>
      ) : (
        <>
          <section className="space-y-6">
            <SectionHeader
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Verified Merchants"
              subtitle="Verified users appear first for safer trading"
              action="View All Verified"
              tone="green"
            />

            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              {verifiedMerchants.length > 0 ? (
                verifiedMerchants.map(merchant => (
                  <MerchantCard key={merchant.id} merchant={merchant} verified />
                ))
              ) : (
                <div className="rounded-3xl border border-white/10 bg-brand-card p-8 text-sm text-slate-500">
                  No verified users yet.
                </div>
              )}
            </div>
          </section>

          <section className="space-y-6 border-t border-white/5 pt-8">
            <SectionHeader
              icon={<ShieldAlert className="h-5 w-5" />}
              title="Unverified Merchants"
              subtitle="All other registered users building their reputation"
              action="View All Unverified"
            />

            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              {unverifiedMerchants.length > 0 ? (
                unverifiedMerchants.map(merchant => (
                  <MerchantCard key={merchant.id} merchant={merchant} verified={false} />
                ))
              ) : (
                <div className="rounded-3xl border border-white/10 bg-brand-card p-8 text-sm text-slate-500">
                  No unverified users found.
                </div>
              )}
            </div>
          </section>

          <section className="space-y-6 border-t border-white/5 pt-8">
            <SectionHeader
              icon={<Truck className="h-5 w-5" />}
              title="Available Drivers"
              subtitle="Drivers online or marked available for delivery"
              action="View All Drivers"
              tone="green"
            />

            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              {availableDrivers.length > 0 ? (
                availableDrivers.map(driver => (
                  <DriverCard key={driver.id} driver={driver} />
                ))
              ) : (
                <div className="rounded-3xl border border-white/10 bg-brand-card p-8 text-sm text-slate-500">
                  No available drivers right now.
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {user && followedListings.length > 0 && (
        <section className="space-y-6">
          <SectionHeader
            icon={<Star className="h-5 w-5" />}
            title="Following"
            subtitle="Recent arrivals from sellers you follow"
            action="Refresh Feed"
          />

          <div className="flex gap-6 overflow-x-auto px-2 pb-6 scrollbar-hide">
            {followedListings.map(listing => (
              <Link
                key={listing.id}
                to={`/listing/${listing.id}`}
                className="group w-64 shrink-0 space-y-4"
              >
                <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] border border-white/5 bg-brand-card">
                  {listing.images?.[0] ? (
                    <img
                      src={listing.images[0]}
                      alt={listing.title}
                      className="h-full w-full object-cover grayscale-[0.2] transition group-hover:scale-105 group-hover:grayscale-0"
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
                  <h4 className="truncate font-serif text-lg leading-tight text-white group-hover:text-amber-500">
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

      <section className="grid grid-cols-1 gap-3 border-t border-white/5 pt-8 sm:grid-cols-2 lg:grid-cols-5">
        {[
          {
            icon: ShieldCheck,
            title: 'Verified & Trusted',
            text: 'Verified users appear first'
          },
          {
            icon: Radio,
            title: 'Live Status',
            text: 'See who is online in real time'
          },
          {
            icon: Lock,
            title: 'Safe Transactions',
            text: 'Escrow protects every trade'
          },
          {
            icon: Star,
            title: 'Rate & Review',
            text: 'Rate your experience and build trust'
          },
          {
            icon: Flag,
            title: 'Report Misconduct',
            text: 'Help keep the community safe'
          }
        ].map(item => (
          <div
            key={item.title}
            className="flex items-center gap-4 rounded-xl border border-white/5 bg-brand-card p-4"
          >
            <div className="rounded-full bg-white/5 p-3 text-amber-500">
              <item.icon className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">{item.title}</h4>
              <p className="mt-1 text-xs text-slate-500">{item.text}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-8">
        <div className="flex items-center gap-4 px-2">
          <h2 className="font-serif text-3xl text-white">Marketplace</h2>
          <div className="h-px flex-1 bg-white/5" />
          <div className="hidden items-center gap-1.5 rounded-full border border-amber-500/10 bg-amber-500/5 px-3 py-1 md:flex">
            <div className="h-1 w-1 animate-pulse rounded-full bg-amber-500" />
            <span className="text-[8px] font-bold uppercase tracking-widest text-amber-500/70">
              {activeUsersCount} active users
            </span>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
            {filteredListings.length} listings available
          </span>
        </div>

        {filteredListings.length === 0 ? (
          <div className="rounded-[3rem] border border-white/5 bg-brand-card py-24 text-center">
            <Search className="mx-auto h-10 w-10 text-slate-700" />
            <h3 className="mt-4 font-serif text-2xl text-white">
              No matches found
            </h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {filteredListings.map(listing => (
              <Link key={listing.id} to={`/listing/${listing.id}`}>
                <motion.article
                  whileHover={{ scale: 1.02 }}
                  className="group overflow-hidden rounded-[3rem] border border-white/5 bg-brand-card shadow-2xl"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-slate-900">
                    {listing.images?.[0] ? (
                      <img
                        src={listing.images[0]}
                        alt={listing.title}
                        className={`h-full w-full object-cover transition duration-700 group-hover:scale-105 group-hover:grayscale-0 ${
                          listing.isBoosted ? 'grayscale-0' : 'grayscale-[0.2]'
                        }`}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-800">
                        NO VISUAL
                      </div>
                    )}

                    {!listing.isBoosted && listing.distance !== null && (
                      <div className="absolute left-6 top-6 rounded-full border border-white/10 bg-black/60 px-4 py-2 backdrop-blur-md">
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">
                          {formatDistance(listing.distance)}
                        </p>
                      </div>
                    )}

                    <div className="absolute right-6 top-6 rounded-lg bg-amber-500 px-3 py-1.5 shadow-xl">
                      <p className="text-[10px] font-black uppercase tracking-widest text-black">
                        ${listing.price.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 p-8">
                    <span className="rounded-full border border-slate-800 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-slate-600">
                      {listing.category}
                    </span>
                    <h3 className="font-serif text-2xl leading-tight text-white group-hover:text-amber-500">
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
