import { useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Compass,
  Filter,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tag,
  Truck,
  Radio,
  Lock,
  Flag
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import MarketplaceMap from '../components/maps/MarketplaceMap';
import {
  calculateDistance,
  formatDistance,
  requestBrowserLocation,
  toGeoPoint,
  type GeoPoint
} from '../utils/geoUtils';
import {
  getListingBoostLabel,
  getListingBoostPriority,
  isListingBoostActive,
  type ListingBoost
} from '../utils/boostUtils';

interface Listing {
  id: string;
  title: string;
  price: number;
  priceDisplay?: string;
  currency?: string;
  currencyCode?: string;
  currencyLocale?: string;
  currencyLabel?: string;
  country?: string;
  category: string;
  location: string;
  locationName?: string;
  images: string[];
  ownerId: string;
  latitude?: number;
  longitude?: number;
  status: string;
  listingStatus?: string;
  stockStatus?: string;
  isBoosted?: boolean;
  boost?: ListingBoost | null;
  hasTradeHistory?: boolean;
  activeTradeId?: string | null;
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
  trustScore?: number;
  verificationStatus?: string;
  driverStatus?: string;
  vehicleType?: string;
  vehicleSize?: string;
  location?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  currentLocation?: {
    latitude?: number;
    longitude?: number;
  };
  isOnline?: boolean;
  online?: boolean;
  lastActiveAt?: any;
}

const UNVERIFIED_TRADER_WARNING =
  'Warning: this trader is unverified. You can continue, but keep communication inside Hema Trader, use escrow, and confirm delivery before releasing funds.';

const UNVERIFIED_ACCOUNT_WARNING =
  'Your account is not verified yet. You can still use Hema Trader, but other users will see you as an unverified trader until you complete verification.';

const zeroDecimalCurrencies = new Set(['XAF', 'XOF', 'UGX', 'RWF']);

const formatMoney = (
  amount: number,
  currencyCode = 'XAF',
  locale = 'fr-CM'
) => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: zeroDecimalCurrencies.has(currencyCode) ? 0 : 2
    }).format(amount || 0);
  } catch {
    return `${currencyCode} ${(amount || 0).toLocaleString()}`;
  }
};

const formatListingPrice = (listing: Listing) => {
  if (listing.priceDisplay) return listing.priceDisplay;

  return formatMoney(
    Number(listing.price || 0),
    listing.currencyCode || listing.currency || 'XAF',
    listing.currencyLocale || 'fr-CM'
  );
};

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (value.seconds) return value.seconds * 1000;
  if (value._seconds) return value._seconds * 1000;

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
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
  if (profile.isOnline || profile.online) return true;
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

  const trustA = a.trustScore || 0;
  const trustB = b.trustScore || 0;
  if (trustB !== trustA) return trustB - trustA;

  const ratingA = a.averageRating || a.avgDriverRating || 0;
  const ratingB = b.averageRating || b.avgDriverRating || 0;
  if (ratingB !== ratingA) return ratingB - ratingA;

  return getMillis(b.lastActiveAt) - getMillis(a.lastActiveAt);
};

const sortListingsForMarketplace = <T extends Listing>(items: T[]) =>
  [...items].sort((a, b) => {
    const boostDelta = getListingBoostPriority(b) - getListingBoostPriority(a);
    if (boostDelta !== 0) return boostDelta;

    return getMillis(b.createdAt) - getMillis(a.createdAt);
  });

const isListingSold = (listing: Pick<Listing, 'status' | 'listingStatus' | 'stockStatus'>) =>
  listing.status === 'sold' ||
  listing.listingStatus === 'sold' ||
  listing.stockStatus === 'sold';

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
    <span className="relative flex h-3 w-3">
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex h-3 w-3 rounded-full border-2 border-brand-card ${
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
  const roleText = merchant.roles.map(titleCase).join(' • ');

  return (
    <motion.article
      whileHover={{ y: -3 }}
      className="relative flex aspect-square w-44 shrink-0 flex-col justify-between rounded-2xl border border-white/10 bg-brand-card/80 p-4 shadow-2xl sm:w-48"
    >
      <div className="absolute right-4 top-4">
        <OnlineDot active={active} />
      </div>

      <div className="flex flex-col items-center text-center">
        <img
          src={
            merchant.photoURL ||
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${merchant.id}`
          }
          alt={displayName(merchant)}
          referrerPolicy="no-referrer"
          className="h-14 w-14 rounded-full border border-white/10 object-cover sm:h-16 sm:w-16"
        />

        <h3 className="mt-3 max-w-full truncate font-serif text-base text-white sm:text-lg">
          {displayName(merchant)}
        </h3>

        <p className={`text-[9px] font-bold ${active ? 'text-green-500' : 'text-slate-500'}`}>
          {active ? 'Active' : 'Offline'}
        </p>

        <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-amber-500">
          <Star className="h-3 w-3 fill-amber-500" />
          {rating.toFixed(1)}
          <span className="font-normal text-slate-500">
            ({merchant.ratingCount || merchant.totalTrades || 0})
          </span>
        </div>

        <div
          className={`mt-2 rounded-md px-2 py-1 text-[8px] font-bold ${
            verified
              ? 'bg-green-500/15 text-green-400'
              : 'bg-amber-500/10 text-amber-300'
          }`}
        >
          {verified ? 'Verified' : 'Unverified'}
        </div>

        <p className="mt-2 w-full truncate text-[10px] text-slate-400">
          {merchant.totalTrades || 0} Trades • {roleText}
        </p>

        <div className="mt-2 flex max-w-full items-center gap-1 text-[9px] text-slate-500">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{displayLocation(merchant)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Link
          to={`/profile/${merchant.id}`}
          className="rounded-lg border border-white/10 px-2 py-2 text-center text-[9px] font-bold text-white transition hover:bg-white hover:text-black"
        >
          Profile
        </Link>

        <Link
          to={`/messages/${merchant.id}`}
          onClick={event => {
            if (!verified && !window.confirm(UNVERIFIED_TRADER_WARNING)) {
              event.preventDefault();
            }
          }}
          className="flex items-center justify-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-[9px] font-bold text-amber-500 transition hover:bg-amber-500 hover:text-black"
        >
          <MessageCircle className="h-3 w-3" />
          Msg
        </Link>
      </div>
    </motion.article>
  );
}

function DriverCard({ driver }: { driver: UserProfile }) {
  const available = isActive(driver) || driver.driverStatus === 'available';
  const rating = driver.avgDriverRating || driver.averageRating || 0;

  return (
    <motion.article
      whileHover={{ y: -3 }}
      className="relative flex aspect-square w-44 shrink-0 flex-col justify-between rounded-2xl border border-white/10 bg-brand-card/80 p-4 shadow-2xl sm:w-48"
    >
      <div className="absolute right-4 top-4">
        <OnlineDot active={available} />
      </div>

      <div className="flex flex-col items-center text-center">
        <img
          src={
            driver.photoURL ||
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.id}`
          }
          alt={displayName(driver)}
          referrerPolicy="no-referrer"
          className="h-14 w-14 rounded-full border border-white/10 object-cover sm:h-16 sm:w-16"
        />

        <h3 className="mt-3 max-w-full truncate font-serif text-base text-white sm:text-lg">
          {displayName(driver)}
        </h3>

        <p className={`text-[9px] font-bold ${available ? 'text-green-500' : 'text-slate-500'}`}>
          {available ? 'Available' : 'Offline'}
        </p>

        <div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-amber-500">
          <Star className="h-3 w-3 fill-amber-500" />
          {rating.toFixed(1)}
          <span className="font-normal text-slate-500">
            ({driver.ratingCount || driver.deliveriesCount || 0})
          </span>
        </div>

        <p className="mt-2 text-[10px] text-slate-400">
          {driver.deliveriesCount || 0} Deliveries
        </p>

        <p className="mt-2 w-full truncate text-[10px] text-slate-400">
          {driver.vehicleType || 'Vehicle'} • {driver.vehicleSize || 'Medium'}
        </p>

        <div className="mt-2 flex max-w-full items-center gap-1 text-[9px] text-slate-500">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{displayLocation(driver)}</span>
        </div>
      </div>

      <Link
        to={`/drivers/${driver.id}`}
        className="rounded-lg border border-green-500/30 bg-green-500/10 px-2 py-2 text-center text-[9px] font-bold text-green-400 transition hover:bg-green-500 hover:text-black"
      >
        Hire Driver
      </Link>
    </motion.article>
  );
}

export default function Home() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [listings, setListings] = useState<Listing[]>([]);
  const [followedListings, setFollowedListings] = useState<Listing[]>([]);
  const [marketUsers, setMarketUsers] = useState<UserProfile[]>([]);
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [mapLocation, setMapLocation] = useState<GeoPoint | null>(null);
  const [distanceFilter, setDistanceFilter] = useState<'all' | '5' | '10' | '50' | 'city'>('50');
  const [error, setError] = useState<string | null>(null);
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeUsersCount, setActiveUsersCount] = useState(0);
  const [recentAlert, setRecentAlert] = useState<string | null>(null);
  const [startingTradeId, setStartingTradeId] = useState<string | null>(null);

  const getCachedSeller = (ownerId: string) =>
    marketUsers.find(item => item.id === ownerId || item.uid === ownerId);

  const getSellerVerificationStatus = async (ownerId: string) => {
    const cachedSeller = getCachedSeller(ownerId);

    if (cachedSeller?.verificationStatus) {
      return cachedSeller.verificationStatus;
    }

    try {
      const sellerSnap = await getDoc(doc(db, 'users', ownerId));

      if (sellerSnap.exists()) {
        const sellerData = sellerSnap.data() as { verificationStatus?: string };
        return sellerData.verificationStatus || 'unverified';
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.READ, `users/${ownerId}`);
    }

    return 'unverified';
  };

  useEffect(() => {
    const nextLocation = toGeoPoint(profile);

    if (nextLocation) {
      setMapLocation(nextLocation);
    }
  }, [
    profile?.latitude,
    profile?.longitude,
    profile?.currentLocation?.latitude,
    profile?.currentLocation?.longitude
  ]);

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

        const activeListings = sortListingsForMarketplace(
          allListings.filter(listing => listing.status === 'active')
        ).slice(0, 20);

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
              sortListingsForMarketplace(
                allListings.filter(
                  listing =>
                    listing.status === 'active' &&
                    followingIds.includes(listing.ownerId)
                )
              ).slice(0, 10)
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

  const handleRequestLocation = async () => {
    setLocating(true);
    setLocationError(null);

    try {
      const nextLocation = await requestBrowserLocation();
      setMapLocation(nextLocation);

      if (user?.uid) {
        await updateDoc(doc(db, 'users', user.uid), {
          latitude: nextLocation.latitude,
          longitude: nextLocation.longitude,
          currentLocation: nextLocation,
          locationUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error('Location permission failed:', err);
      setLocationError('Location unavailable. You can still search by city, village, or region.');
    } finally {
      setLocating(false);
    }
  };

  const startTradeFromListing = async (
    event: MouseEvent<HTMLButtonElement>,
    listing: ListingWithDistance
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (!user) {
      navigate(`/listing/${listing.id}`);
      return;
    }

    if (listing.ownerId === user.uid) {
      alert('This is your own listing. Buyers will be able to start trades with you.');
      return;
    }

    if (isListingSold(listing)) {
      alert('Product sold.');
      return;
    }

    if (listing.status !== 'active') {
      alert('This product is not available for trade.');
      return;
    }

    const buyerVerificationStatus = profile?.verificationStatus || 'unverified';
    const sellerVerificationStatus = await getSellerVerificationStatus(listing.ownerId);

    const warnings: string[] = [];

    if (buyerVerificationStatus !== 'verified') {
      warnings.push(UNVERIFIED_ACCOUNT_WARNING);
    }

    if (sellerVerificationStatus !== 'verified') {
      warnings.push(UNVERIFIED_TRADER_WARNING);
    }

    if (warnings.length > 0) {
      const proceed = window.confirm(`${warnings.join('\n\n')}\n\nContinue to secure trade?`);
      if (!proceed) return;
    }

    setStartingTradeId(listing.id);

    try {
      const tradeRef = doc(collection(db, 'trades'));
      const participantIds = [user.uid, listing.ownerId];
      const systemMessage =
        sellerVerificationStatus === 'verified'
          ? `Trade initiated for ${listing.title}. You can now discuss price, pickup, and delivery details.`
          : `Trade initiated for ${listing.title}. This seller is unverified, so keep communication in this chat and use escrow before exchanging goods or money.`;

      await setDoc(tradeRef, {
        tradeId: tradeRef.id,
        listingId: listing.id,
        listingTitle: listing.title,
        userId: user.uid,
        buyerId: user.uid,
        sellerId: listing.ownerId,
        participants: participantIds,
        amount: Number(listing.price || 0),
        priceDisplay: formatListingPrice(listing),
        currency: listing.currency || listing.currencyCode || 'XAF',
        currencyCode: listing.currencyCode || listing.currency || 'XAF',
        currencyLocale: listing.currencyLocale || 'fr-CM',
        currencyLabel: listing.currencyLabel || 'CFA',
        status: 'pending',
        buyerVerificationStatus,
        sellerVerificationStatus,
        riskFlags: [
          ...(buyerVerificationStatus !== 'verified' ? ['buyer_unverified'] : []),
          ...(sellerVerificationStatus !== 'verified' ? ['seller_unverified'] : [])
        ],
        riskAcknowledgement: {
          buyerId: user.uid,
          buyerVerificationStatus,
          sellerVerificationStatus,
          acknowledgedAt: serverTimestamp()
        },
        listingSnapshot: {
          title: listing.title,
          category: listing.category,
          quantity: (listing as any).quantity || '',
          image: listing.images?.[0] || '',
          location: listing.locationName || listing.location || ''
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await Promise.all([
        addDoc(collection(db, 'messages'), {
          tradeId: tradeRef.id,
          listingId: listing.id,
          userId: user.uid,
          senderId: 'system',
          senderName: 'Hema Trader',
          senderPhotoURL: '',
          recipientIds: participantIds,
          participants: participantIds,
          text: systemMessage,
          type: 'system',
          status: 'delivered',
          readBy: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }),
        addDoc(collection(db, 'trades', tradeRef.id, 'messages'), {
          tradeId: tradeRef.id,
          listingId: listing.id,
          userId: user.uid,
          senderId: 'system',
          senderName: 'Hema Trader',
          type: 'system',
          status: 'delivered',
          text: systemMessage,
          readBy: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      ]);

      navigate(`/trade/${tradeRef.id}`);
    } catch (err) {
      console.error('Start trade failed:', err);
      alert('Could not start trade. Please try again.');
    } finally {
      setStartingTradeId(null);
    }
  };

  const searchTerm = searchQuery.trim().toLowerCase();
  const userLocation = mapLocation || toGeoPoint(profile);

  const activeRadiusKm =
    distanceFilter === '5'
      ? 5
      : distanceFilter === '10'
        ? 10
        : 50;

  const sameCitySearch = [
    profile?.city,
    profile?.location
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const matchesSameCity = (item: any) => {
    if (distanceFilter !== 'city') return true;
    if (!sameCitySearch) return true;

    const searchable = [
      item.location,
      item.locationName,
      item.city,
      item.country
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return searchable.includes(sameCitySearch) || sameCitySearch.includes(searchable);
  };

  const searchedUsers = marketUsers.filter(profileItem =>
    profileMatchesSearch(profileItem, searchTerm)
  );

  const mapUsers = searchedUsers
    .filter(profileItem => profileItem.id !== user?.uid)
    .filter(profileItem => matchesSameCity(profileItem))
    .filter(profileItem => {
      if (distanceFilter === 'all' || distanceFilter === 'city') return true;
      if (!userLocation) return true;

      const point = toGeoPoint(profileItem);
      return point ? calculateDistance(userLocation, point) <= activeRadiusKm : false;
    })
    .slice(0, 120);

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

      return [listing.title, listing.category, listing.location, listing.locationName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(searchTerm);
    })
    .map(listing => {
      const listingPoint = toGeoPoint(listing);

      return {
        ...listing,
        distance:
          userLocation && listingPoint
            ? calculateDistance(userLocation, listingPoint)
            : null
      };
    })
    .filter(listing => {
      if (!nearbyOnly && distanceFilter === 'all') return true;
      if (distanceFilter === 'city') return matchesSameCity(listing);
      if (!userLocation) return true;
      if (listing.distance === null) return false;

      return listing.distance <= activeRadiusKm;
    })
    .sort((a, b) => {
      const boostDelta = getListingBoostPriority(b) - getListingBoostPriority(a);
      if (boostDelta !== 0) return boostDelta;

      if ((nearbyOnly || distanceFilter !== 'all') && a.distance !== null && b.distance !== null) {
        return a.distance - b.distance;
      }

      return getMillis(b.createdAt) - getMillis(a.createdAt);
    });

  const mapListings = filteredListings
    .filter(listing => toGeoPoint(listing))
    .slice(0, 80);

  return (
    <div className="space-y-12 pb-24">
      <section className="space-y-6 pt-8">
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

        <div className="mx-auto max-w-3xl px-2">
          <div className="group relative flex items-center">
            <Search className="absolute left-6 h-5 w-5 text-slate-600 group-focus-within:text-amber-500" />
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search products, sellers, cities, villages, or regions..."
              className="w-full rounded-2xl border border-white/10 bg-brand-card py-5 pl-16 pr-14 text-sm text-white shadow-2xl outline-none transition placeholder:text-slate-600 focus:border-amber-500/50"
            />
            <Search className="absolute right-6 h-4 w-4 text-slate-500" />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center rounded-[3rem] border border-white/5 bg-brand-card py-24">
            <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-500/20 bg-red-500/5 p-8 text-center text-red-400">
            {error}
          </div>
        ) : filteredListings.length === 0 ? (
          <div className="rounded-[3rem] border border-white/5 bg-brand-card py-24 text-center">
            <Search className="mx-auto h-10 w-10 text-slate-700" />
            <h3 className="mt-4 font-serif text-2xl text-white">
              No matches found
            </h3>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredListings.map(listing => {
              const isOwnListing = listing.ownerId === user?.uid;
              const listingSold = isListingSold(listing);
              const seller = getCachedSeller(listing.ownerId);
              const sellerVerified = seller?.verificationStatus === 'verified';
              const listingBoosted = isListingBoostActive(listing);
              const boostLabel = getListingBoostLabel(listing);

              return (
                <motion.article
                  key={listing.id}
                  whileHover={{ y: -3 }}
                  className={`group overflow-hidden rounded-2xl border bg-brand-card shadow-xl ${
                    listingBoosted
                      ? 'border-amber-500/40 shadow-amber-500/10'
                      : 'border-white/5'
                  }`}
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-slate-900">
                    <Link to={`/listing/${listing.id}`} className="block h-full w-full">
                      {listing.images?.[0] ? (
                        <img
                          src={listing.images[0]}
                          alt={listing.title}
                          className={`h-full w-full object-cover transition duration-500 group-hover:scale-105 group-hover:grayscale-0 ${
                            listingBoosted ? 'grayscale-0' : 'grayscale-[0.15]'
                          }`}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-slate-950 text-[9px] font-black uppercase tracking-widest text-slate-800">
                          No Visual
                        </div>
                      )}
                    </Link>

                    {listingBoosted ? (
                      <div className="absolute left-3 top-3 rounded-full border border-amber-500/40 bg-amber-500 px-3 py-1.5 shadow-xl">
                        <p className="text-[8px] font-black uppercase tracking-widest text-black">
                          {boostLabel}
                        </p>
                      </div>
                    ) : listing.distance !== null ? (
                      <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 backdrop-blur-md">
                        <p className="text-[8px] font-black uppercase tracking-widest text-amber-500">
                          {formatDistance(listing.distance)}
                        </p>
                      </div>
                    ) : null}

                    <div className="absolute right-3 top-3 max-w-[70%] rounded-lg bg-amber-500 px-2.5 py-1.5 shadow-xl">
                      <p className="truncate text-[8px] font-black uppercase tracking-widest text-black">
                        {formatListingPrice(listing)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate rounded-full border border-slate-800 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                        {listing.category}
                      </span>

                      {isOwnListing ? (
                        <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-1 text-[7px] font-black uppercase tracking-widest text-green-400">
                          Yours
                        </span>
                      ) : (
                        <span
                          className={`rounded-full border px-2 py-1 text-[7px] font-black uppercase tracking-widest ${
                            sellerVerified
                              ? 'border-green-500/20 bg-green-500/10 text-green-400'
                              : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          {sellerVerified ? 'Verified' : 'Unverified'}
                        </span>
                      )}
                    </div>

                    <Link to={`/listing/${listing.id}`} className="block">
                      <h3 className="line-clamp-2 min-h-[2.5rem] font-serif text-base leading-tight text-white group-hover:text-amber-500 md:text-lg">
                        {listing.title}
                      </h3>
                    </Link>

                    <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-slate-500">
                      <MapPin className="h-3 w-3 shrink-0 text-amber-500/50" />
                      <span className="truncate">{listing.locationName || listing.location}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Link
                        to={`/listing/${listing.id}`}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center text-[8px] font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black"
                      >
                        View
                      </Link>

                      <button
                        type="button"
                        onClick={event => startTradeFromListing(event, listing)}
                        disabled={startingTradeId === listing.id || isOwnListing || listingSold}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-3 text-[8px] font-black uppercase tracking-widest text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {startingTradeId === listing.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : listingSold ? (
                          <Lock className="h-3.5 w-3.5" />
                        ) : (
                          <ShoppingBag className="h-3.5 w-3.5" />
                        )}
                        {listingSold ? 'Product Sold' : isOwnListing ? 'Listed' : 'Trade'}
                      </button>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>
        )}
      </section>

      {user && followedListings.length > 0 && (
        <section className="space-y-6">
          <SectionHeader
            icon={<Star className="h-5 w-5" />}
            title="Following"
            subtitle="Recent arrivals from sellers you follow"
            action="Refresh Feed"
          />

          <div className="flex gap-5 overflow-x-auto px-2 pb-6 scrollbar-hide">
            {followedListings.map(listing => (
              <Link
                key={listing.id}
                to={`/listing/${listing.id}`}
                className="group w-52 shrink-0 space-y-3"
              >
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/5 bg-brand-card">
                  {listing.images?.[0] ? (
                    <img
                      src={listing.images[0]}
                      alt={listing.title}
                      className="h-full w-full object-cover grayscale-[0.2] transition group-hover:scale-105 group-hover:grayscale-0"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] font-black uppercase tracking-widest text-slate-800">
                      No Visual
                    </div>
                  )}

                  <div className="absolute right-3 top-3 rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 backdrop-blur-md">
                    <p className="max-w-28 truncate text-[8px] font-black uppercase tracking-widest text-amber-500">
                      {formatListingPrice(listing)}
                    </p>
                  </div>
                </div>

                <div className="px-1">
                  <h4 className="truncate font-serif text-base leading-tight text-white group-hover:text-amber-500">
                    {listing.title}
                  </h4>
                  <div className="mt-1 flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-slate-500">
                    <MapPin className="h-3 w-3 text-amber-500/50" />
                    <span className="truncate">{listing.locationName || listing.location}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && (
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

      <section className="space-y-5">
        <SectionHeader
          icon={<MapPin className="h-5 w-5" />}
          title="Marketplace Map"
          subtitle="Discover nearby sellers, buyers, drivers, crops, livestock, and delivery zones"
          action="Live Nearby"
          tone="amber"
        />

        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-3 px-2">
          <Link
            to="/drivers"
            className="flex items-center gap-3 rounded-full border border-amber-500/30 bg-amber-500/10 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-amber-500 transition hover:bg-amber-500 hover:text-black"
          >
            <Truck className="h-4 w-4" />
            Find Drivers
          </Link>

          <button
            onClick={() => {
              const nextNearby = !nearbyOnly;
              setNearbyOnly(nextNearby);
              setDistanceFilter(nextNearby ? '10' : 'all');
            }}
            className={`flex items-center gap-3 rounded-full border px-6 py-3 text-[10px] font-black uppercase tracking-widest transition ${
              nearbyOnly
                ? 'border-amber-500 bg-amber-500 text-black'
                : 'border-white/10 bg-white/5 text-slate-400 hover:border-amber-500/30'
            }`}
          >
            <Compass className="h-4 w-4" />
            Nearby Only
          </button>

          <button
            onClick={handleRequestLocation}
            disabled={locating}
            className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 transition hover:border-amber-500/30 disabled:opacity-60"
          >
            {locating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Navigation className="h-4 w-4" />
            )}
            Use GPS
          </button>

          <button className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 transition hover:border-amber-500/30">
            <Filter className="h-4 w-4" />
            Advanced Filters
          </button>
        </div>

        <div className="flex flex-wrap gap-2 px-2">
          {[
            { id: 'all', label: 'All' },
            { id: '5', label: 'Within 5km' },
            { id: '10', label: 'Within 10km' },
            { id: '50', label: 'Within 50km' },
            { id: 'city', label: 'Same City' }
          ].map(item => (
            <button
              key={item.id}
              onClick={() => {
                setDistanceFilter(item.id as 'all' | '5' | '10' | '50' | 'city');
                setNearbyOnly(item.id !== 'all');
              }}
              className={`rounded-full border px-4 py-2 text-[9px] font-black uppercase tracking-widest transition ${
                distanceFilter === item.id
                  ? 'border-amber-500 bg-amber-500 text-black'
                  : 'border-white/10 bg-white/5 text-slate-500 hover:border-amber-500/30 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {locationError && (
          <div className="mx-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
            {locationError}
          </div>
        )}

        <MarketplaceMap
          listings={mapListings}
          users={mapUsers}
          currentLocation={userLocation}
          radiusKm={activeRadiusKm}
          className="h-[520px]"
          onRequestLocation={handleRequestLocation}
        />
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
