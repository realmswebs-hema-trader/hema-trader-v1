import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import {
  AlertCircle,
  ArrowRight,
  CreditCard,
  Eye,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Scale,
  ShieldCheck,
  Star,
  Truck,
  UserMinus,
  UserPlus
} from 'lucide-react';

import { useAuth } from '../components/auth/AuthContext';
import { useNotifications } from '../components/notifications/NotificationContext';
import { db } from '../lib/firebase';
import {
  calculateDistance,
  formatDistance,
  toGeoPoint
} from '../utils/geoUtils';

const UNVERIFIED_TRADER_WARNING =
  'Warning: this trader is unverified. You can continue, but keep communication inside Hema Trader, use escrow, and confirm delivery before releasing funds.';

const UNVERIFIED_ACCOUNT_WARNING =
  'Your account is not verified yet. You can still use Hema Trader, but other users will see you as an unverified trader until you complete verification.';

const SINGLE_PRODUCT_UNAVAILABLE_MESSAGE =
  'This item is currently in a trade and is not available.';

interface Listing {
  id: string;
  title: string;
  description: string;
  price: number | string;
  priceDisplay?: string;
  currency?: string;
  currencyCode?: string;
  currencyLocale?: string;
  currencyLabel?: string;
  country?: string;
  category: string;
  location: string;
  locationName?: string;
  images?: string[];
  imageUrls?: string[];
  ownerId: string;
  sellerId?: string;
  userId?: string;
  createdBy?: string;
  status: string;
  quantity: string;
  inventoryType?: 'single' | 'stock';
  listingStatus?: 'available' | 'reserved' | 'in_trade' | 'sold' | 'cancelled';
  activeTradeId?: string | null;
  reservedAt?: any;
  soldAt?: any;
  latitude?: number;
  longitude?: number;
  currentLocation?: {
    latitude?: number;
    longitude?: number;
  };
  isGeoTagged?: boolean;
  imageUploadStatus?: string;
  metadata?: Record<string, string>;
  isBoosted?: boolean;
  boostTier?: string;
  boostExpiresAt?: any;
}

interface SellerProfile {
  displayName?: string;
  name?: string;
  photoURL?: string;
  averageRating?: number;
  totalTrades?: number;
  verificationStatus?: string;
  lastActiveAt?: any;
  followersCount?: number;
  followingCount?: number;
  city?: string;
  country?: string;
  location?: string;
}

const zeroDecimalCurrencies = new Set(['XAF', 'XOF', 'UGX', 'RWF']);

const uniqueIds = (ids: Array<string | undefined | null>) =>
  Array.from(new Set(ids.filter(Boolean) as string[]));

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const formatMoney = (
  amount: number,
  currencyCode = 'XAF',
  locale = 'fr-CM'
) => {
  const normalizedCurrency = currencyCode === 'CFA' ? 'XAF' : currencyCode;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: zeroDecimalCurrencies.has(normalizedCurrency) ? 0 : 2
    }).format(amount || 0);
  } catch {
    return `${normalizedCurrency} ${(amount || 0).toLocaleString()}`;
  }
};

const getListingImages = (listing: Listing) => {
  if (Array.isArray(listing.images) && listing.images.length > 0) {
    return listing.images;
  }

  if (Array.isArray(listing.imageUrls) && listing.imageUrls.length > 0) {
    return listing.imageUrls;
  }

  return [];
};

const formatListingPrice = (listing: Listing) => {
  if (listing.priceDisplay) return listing.priceDisplay;

  return formatMoney(
    Number(listing.price || 0),
    listing.currencyCode || listing.currency || 'XAF',
    listing.currencyLocale || 'fr-CM'
  );
};

const displaySellerName = (seller: SellerProfile | null) =>
  seller?.displayName || seller?.name || 'Marketplace Seller';

const displayListingLocation = (listing: Listing) =>
  listing.locationName || listing.location || 'Cameroon';

const getListingSellerId = (
  listing: Pick<Listing, 'ownerId' | 'sellerId' | 'userId' | 'createdBy'>
) => listing.sellerId || listing.ownerId || listing.userId || listing.createdBy || '';

const isListingOwnedBy = (
  listing: Pick<Listing, 'ownerId' | 'sellerId' | 'userId' | 'createdBy'>,
  userId?: string
) =>
  Boolean(
    userId &&
      [listing.ownerId, listing.sellerId, listing.userId, listing.createdBy]
        .filter(Boolean)
        .includes(userId)
  );

const getInventoryType = (listing: Listing) => listing.inventoryType || 'stock';

const getListingStatus = (listing: Listing) => {
  if (listing.listingStatus) return listing.listingStatus;
  if (listing.status === 'sold') return 'sold';
  if (listing.status === 'cancelled') return 'cancelled';
  if (listing.status !== 'active') return 'sold';
  return 'available';
};

const isSingleProductBlocked = (listing: Listing) => {
  if (getInventoryType(listing) !== 'single') return false;

  const listingStatus = getListingStatus(listing);

  return (
    listingStatus === 'reserved' ||
    listingStatus === 'in_trade' ||
    listingStatus === 'sold' ||
    Boolean(listing.activeTradeId)
  );
};

const listingAvailabilityLabel = (listing: Listing) => {
  if (getInventoryType(listing) === 'stock') {
    return listing.status === 'active' ? 'In Stock' : 'Unavailable';
  }

  const status = getListingStatus(listing);

  if (status === 'sold') return 'Sold';
  if (status === 'reserved' || status === 'in_trade') return 'Currently in trade';
  if (status === 'cancelled') return 'Unavailable';

  return listing.status === 'active' ? 'Available' : 'Unavailable';
};

const listingAvailabilityClass = (listing: Listing) => {
  const status = getListingStatus(listing);

  if (
    getInventoryType(listing) === 'single' &&
    (status === 'reserved' || status === 'in_trade')
  ) {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-400';
  }

  if (listing.status === 'active' && status === 'available') {
    return 'border-green-500/20 bg-green-500/10 text-green-400';
  }

  return 'border-red-500/20 bg-red-500/10 text-red-400';
};

export default function ListingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { sendNotification } = useNotifications();

  const [listing, setListing] = useState<Listing | null>(null);
  const [seller, setSeller] = useState<SellerProfile | null>(null);
  const [nearby, setNearby] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trading, setTrading] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(false);

  useEffect(() => {
    if (!user || !listing) return;

    const checkFollow = async () => {
      try {
        const sellerId = getListingSellerId(listing);

        if (!sellerId || sellerId === user.uid) {
          setIsFollowing(false);
          return;
        }

        const followId = `${user.uid}_${sellerId}`;
        const followSnap = await getDoc(doc(db, 'follows', followId));

        setIsFollowing(followSnap.exists());
      } catch (err) {
        console.warn('Could not check follow state:', err);
        setIsFollowing(false);
      }
    };

    checkFollow();
  }, [user, listing]);

  const updateUserCounterSafely = async (
    userId: string,
    field: 'followersCount' | 'followingCount',
    amount: number
  ) => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        [field]: increment(amount)
      });
    } catch (err) {
      console.warn(`Could not update ${field}:`, err);
    }
  };

  const toggleFollow = async () => {
    if (!user || !listing || !seller) return;

    const sellerId = getListingSellerId(listing);

    if (!sellerId || sellerId === user.uid) return;

    setFollowingLoading(true);

    const followId = `${user.uid}_${sellerId}`;
    const followRef = doc(db, 'follows', followId);

    try {
      if (isFollowing) {
        await deleteDoc(followRef);

        setIsFollowing(false);
        setSeller(prev =>
          prev
            ? {
                ...prev,
                followersCount: Math.max((prev.followersCount || 1) - 1, 0)
              }
            : null
        );

        void updateUserCounterSafely(user.uid, 'followingCount', -1);
        void updateUserCounterSafely(sellerId, 'followersCount', -1);
      } else {
        await setDoc(followRef, {
          followerId: user.uid,
          followingId: sellerId,
          participantIds: [user.uid, sellerId],
          participants: [user.uid, sellerId],
          createdAt: serverTimestamp()
        });

        setIsFollowing(true);
        setSeller(prev =>
          prev
            ? {
                ...prev,
                followersCount: (prev.followersCount || 0) + 1
              }
            : null
        );

        void updateUserCounterSafely(user.uid, 'followingCount', 1);
        void updateUserCounterSafely(sellerId, 'followersCount', 1);

        void sendNotification(sellerId, {
          title: 'New Follower',
          body: `${profile?.displayName || profile?.name || 'Someone'} started following you.`,
          type: 'system',
          targetId: user.uid,
          targetType: 'user',
          actionUrl: '/profile',
          senderId: user.uid,
          senderName: profile?.displayName || profile?.name || user.displayName || 'Marketplace User'
        }).catch(err => {
          console.warn('Follow notification failed:', err);
        });
      }
    } catch (err) {
      console.error('Follow error:', err);
      alert('Could not update follow status. Please try again.');
    } finally {
      setFollowingLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchListing() {
      if (!id) return;

      try {
        setLoading(true);
        setError(null);

        const docSnap = await getDoc(doc(db, 'listings', id));

        if (!isMounted) return;

        if (!docSnap.exists()) {
          setError('We could not find this item in our marketplace.');
          return;
        }

        const listingData = {
          id: docSnap.id,
          ...docSnap.data()
        } as Listing;

        setListing(listingData);

        const sellerId = getListingSellerId(listingData);

        if (sellerId) {
          const sellerSnap = await getDoc(doc(db, 'users', sellerId));

          if (isMounted && sellerSnap.exists()) {
            setSeller(sellerSnap.data() as SellerProfile);
          }
        }

        const nearbyQuery = query(
          collection(db, 'listings'),
          where('category', '==', listingData.category),
          where('status', '==', 'active'),
          limit(5)
        );

        const nearbySnap = await getDocs(nearbyQuery);

        if (isMounted) {
          setNearby(
            nearbySnap.docs
              .filter(item => item.id !== id)
              .map(item => ({ id: item.id, ...item.data() } as Listing))
              .filter(item => !isSingleProductBlocked(item))
              .slice(0, 4)
          );
        }
      } catch (err) {
        console.error('Fetch Listing Error:', err);
        setError('There was a problem loading the details for this item.');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchListing();

    return () => {
      isMounted = false;
    };
  }, [id]);

  const startTrade = async () => {
    if (!listing || trading) return;

    if (!user || !profile) {
      alert('Please sign in to start a trade.');
      navigate('/');
      return;
    }

    const sellerId = getListingSellerId(listing);

    if (!sellerId) {
      alert('This listing is missing seller information.');
      return;
    }

    if (isListingOwnedBy(listing, user.uid)) {
      alert(
        'This is your own listing. Buyers can start trades with you, but you cannot trade with or message yourself.'
      );
      return;
    }

    if (listing.status !== 'active') {
      alert('This listing is not available for a new trade.');
      return;
    }

    if (isSingleProductBlocked(listing)) {
      alert(
        getListingStatus(listing) === 'sold'
          ? 'This single product has already been sold.'
          : SINGLE_PRODUCT_UNAVAILABLE_MESSAGE
      );
      return;
    }

    const listingAmount = Number(listing.price || 0);

    if (!Number.isFinite(listingAmount) || listingAmount <= 0) {
      alert('This listing does not have a valid price.');
      return;
    }

    const buyerVerificationStatus = profile.verificationStatus || 'unverified';
    const sellerVerificationStatus = seller?.verificationStatus || 'unverified';
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

    setTrading(true);

    try {
      const tradeRef = doc(collection(db, 'trades'));
      const participantIds = uniqueIds([user.uid, sellerId]);
      const sellerName = displaySellerName(seller);
      const buyerName =
        profile.displayName || profile.name || user.displayName || 'Marketplace Buyer';

      const systemMessage =
        sellerVerificationStatus === 'verified'
          ? `Trade initiated for ${listing.title}. You can now discuss terms and delivery with the other party.`
          : `Trade initiated for ${listing.title}. This seller is unverified, so keep communication in this chat and use escrow before exchanging goods or money.`;

      await runTransaction(db, async transaction => {
        const listingRef = doc(db, 'listings', listing.id);
        const listingSnap = await transaction.get(listingRef);

        if (!listingSnap.exists()) {
          throw new Error('This listing no longer exists.');
        }

        const freshListing = {
          id: listingSnap.id,
          ...listingSnap.data()
        } as Listing;

        const freshSellerId = getListingSellerId(freshListing);

        if (!freshSellerId) {
          throw new Error('This listing is missing seller information.');
        }

        if (isListingOwnedBy(freshListing, user.uid)) {
          throw new Error('You cannot start a trade with your own listing.');
        }

        const freshInventoryType = getInventoryType(freshListing);
        const freshListingStatus = getListingStatus(freshListing);
        const freshAmount = Number(freshListing.price || 0);
        const freshImages = getListingImages(freshListing);
        const freshParticipantIds = uniqueIds([user.uid, freshSellerId]);

        if (!Number.isFinite(freshAmount) || freshAmount <= 0) {
          throw new Error('This listing does not have a valid price.');
        }

        if (freshListing.status !== 'active') {
          throw new Error('This listing is not available for a new trade.');
        }

        if (
          freshInventoryType === 'single' &&
          (freshListingStatus !== 'available' || Boolean(freshListing.activeTradeId))
        ) {
          throw new Error(
            freshListingStatus === 'sold'
              ? 'This single product has already been sold.'
              : SINGLE_PRODUCT_UNAVAILABLE_MESSAGE
          );
        }

        transaction.set(tradeRef, {
          tradeId: tradeRef.id,
          listingId: freshListing.id,
          listingTitle: freshListing.title,
          userId: user.uid,
          buyerId: user.uid,
          sellerId: freshSellerId,
          participantIds: freshParticipantIds,
          participants: freshParticipantIds,
          memberIds: freshParticipantIds,
          userIds: freshParticipantIds,
          amount: freshAmount,
          agreedAmount: null,
          priceAgreementStatus: 'open',
          priceDisplay: formatListingPrice(freshListing),
          currency: freshListing.currencyCode || freshListing.currency || 'XAF',
          currencyCode: freshListing.currencyCode || freshListing.currency || 'XAF',
          currencyLocale: freshListing.currencyLocale || 'fr-CM',
          currencyLabel: freshListing.currencyLabel || 'XAF / FCFA',
          deliveryPickupLocation: toGeoPoint(freshListing),
          deliveryPickupAddress: displayListingLocation(freshListing),
          status: 'pending',
          productPaymentStatus: 'unpaid',
          paymentStatus: 'unpaid',
          escrowStatus: 'unfunded',
          platformFee: 0,
          sellerPayout: 0,
          deliveryPaymentStatus: 'unpaid',
          deliveryFee: 0,
          agreedDeliveryFee: 0,
          deliveryFeeAgreed: false,
          deliveryFeePaid: 0,
          driverCommission: 0,
          driverId: '',
          assignedDriverId: '',
          deliveryNegotiationStatus: null,
          deliveryRequestId: null,
          deliveryRequestStatus: null,
          deliveryStatus: null,
          deliveryPaymentRequiredAt: null,
          deliveryPaymentDeadlineAt: null,
          autoCancelReason: null,
          refundProcessed: false,
          refundProcessedAt: null,
          listingInventoryType: freshInventoryType,
          listingStatusAtTradeStart: freshListingStatus,
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
            title: freshListing.title,
            category: freshListing.category,
            quantity: freshListing.quantity || '',
            image: freshImages[0] || '',
            location: displayListingLocation(freshListing),
            inventoryType: freshInventoryType
          },
          lastMessage: systemMessage,
          lastMessageAt: serverTimestamp(),
          lastMessageSenderId: 'system',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        if (freshInventoryType === 'single') {
          transaction.update(listingRef, {
            listingStatus: 'in_trade',
            activeTradeId: tradeRef.id,
            reservedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }
      });

      const messageData = {
        tradeId: tradeRef.id,
        listingId: listing.id,
        userId: 'system',
        senderId: 'system',
        senderName: 'Hema Trader',
        senderPhotoURL: '',
        recipientIds: participantIds,
        participantIds,
        participants: participantIds,
        memberIds: participantIds,
        userIds: participantIds,
        buyerId: user.uid,
        sellerId,
        text: systemMessage,
        type: 'system',
        status: 'delivered',
        readBy: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const messageResults = await Promise.allSettled([
        addDoc(collection(db, 'messages'), messageData),
        addDoc(collection(db, 'trades', tradeRef.id, 'messages'), messageData)
      ]);

      messageResults.forEach(result => {
        if (result.status === 'rejected') {
          console.warn('Trade system message failed:', result.reason);
        }
      });

      void sendNotification(sellerId, {
        title: 'New Trade Started',
        body: `${buyerName} opened a trade for ${listing.title}.`,
        type: 'trade_update',
        targetId: tradeRef.id,
        targetType: 'trade',
        actionUrl: `/trade/${tradeRef.id}`,
        senderId: user.uid,
        senderName: buyerName
      }).catch(err => {
        console.warn('Trade notification failed:', err);
      });

      setListing(prev =>
        prev && getInventoryType(prev) === 'single'
          ? {
              ...prev,
              listingStatus: 'in_trade',
              activeTradeId: tradeRef.id
            }
          : prev
      );

      navigate(`/trade/${tradeRef.id}`);
    } catch (err: any) {
      console.error('Start Trade Error:', err);
      alert(err?.message || 'Failed to initiate trade registry.');
    } finally {
      setTrading(false);
    }
  };

  const handleBoostListing = async (tier: 'standard' | 'premium', amount: number) => {
    if (!user || !listing) return;

    if (!isListingOwnedBy(listing, user.uid)) {
      alert('Only the listing owner can boost this listing.');
      return;
    }

    const confirmBoost = window.confirm(
      `Confirm payment of ${formatMoney(amount, 'XAF', 'fr-CM')} for ${tier} boost? (Demo logic)`
    );

    if (!confirmBoost) return;

    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (tier === 'premium' ? 30 : 7));

      await updateDoc(doc(db, 'listings', listing.id), {
        isBoosted: true,
        boostTier: tier,
        boostExpiresAt: expiresAt,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'boosts'), {
        listingId: listing.id,
        userId: user.uid,
        amount,
        currency: 'XAF',
        tier,
        createdAt: serverTimestamp(),
        expiresAt
      });

      setListing(prev =>
        prev
          ? {
              ...prev,
              isBoosted: true,
              boostTier: tier,
              boostExpiresAt: expiresAt
            }
          : null
      );

      alert('Listing boosted successfully! It will now appear with priority in search results.');
    } catch (err) {
      console.error('Boost error:', err);
      alert('Failed to process boost registry.');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl animate-pulse space-y-8 pb-20">
        <div className="h-[460px] rounded-[2rem] bg-white/5" />
        <div className="h-32 rounded-[2rem] bg-white/5" />
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="mx-auto max-w-2xl py-32 text-center">
        <div className="mb-8 flex justify-center">
          <AlertCircle className="h-16 w-16 text-amber-500/40" />
        </div>
        <h2 className="mb-4 font-serif text-3xl text-white">
          Mismatched Details
        </h2>
        <p className="mb-8 font-serif italic text-slate-500">
          {error || 'This item is no longer available or was moved.'}
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-8 py-4 text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-white"
        >
          Return to Marketplace
        </Link>
      </div>
    );
  }

  const listingImages = getListingImages(listing);
  const userPoint = toGeoPoint(profile);
  const listingPoint = toGeoPoint(listing);
  const distance =
    userPoint && listingPoint ? calculateDistance(userPoint, listingPoint) : null;

  const listingPrice = formatListingPrice(listing);
  const sellerActive =
    seller?.lastActiveAt &&
    Date.now() - getMillis(seller.lastActiveAt) < 1000 * 60 * 15;
  const sellerId = getListingSellerId(listing);
  const isOwnListing = isListingOwnedBy(listing, user?.uid);
  const inventoryType = getInventoryType(listing);
  const listingStatus = getListingStatus(listing);
  const singleProductBlocked = isSingleProductBlocked(listing);
  const tradeDisabled =
    trading || isOwnListing || listing.status !== 'active' || singleProductBlocked;

  const tradeButtonLabel = isOwnListing
    ? 'Your Listing'
    : listingStatus === 'sold'
      ? 'Sold'
      : singleProductBlocked
        ? 'Currently in Trade'
        : 'Buy / Open Trade';

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-20">
      <div className="overflow-hidden rounded-[2rem] border border-white/5 bg-brand-card shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="relative min-h-[280px] border-b border-white/5 bg-slate-900 lg:border-b-0 lg:border-r">
            <div className="aspect-[4/3] h-full max-h-[520px] w-full">
              {listingImages[0] ? (
                <img
                  src={listingImages[0]}
                  alt={listing.title}
                  className="h-full w-full object-cover grayscale-[0.15] transition-all duration-700 hover:grayscale-0"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950/20 text-center">
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                    <Package className="h-10 w-10 text-amber-500/50" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-600">
                      No product photo yet
                    </p>
                    <p className="mt-2 max-w-xs text-xs text-slate-500">
                      Ask the seller for photos before paying into escrow.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="absolute left-4 top-4 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 backdrop-blur-md">
              <p className="text-[8px] font-black uppercase tracking-widest text-amber-500">
                {listing.category}
              </p>
            </div>

            <div
              className={`absolute right-4 top-4 rounded-full border px-3 py-1.5 backdrop-blur-md ${listingAvailabilityClass(listing)}`}
            >
              <p className="text-[8px] font-black uppercase tracking-widest">
                {listingAvailabilityLabel(listing)}
              </p>
            </div>
          </div>

          <div className="flex flex-col p-6 md:p-8">
            {listing.isBoosted && (
              <div className="mb-4 flex w-max items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                <span className="text-[9px] font-black uppercase tracking-widest text-amber-500">
                  {listing.boostTier} Priority Listing
                </span>
              </div>
            )}

            <div className="mb-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-slate-400">
                {inventoryType === 'single' ? 'Single Product' : 'In Stock'}
              </span>

              {singleProductBlocked && (
                <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-amber-400">
                  Trade Locked
                </span>
              )}
            </div>

            <h1 className="font-serif text-3xl leading-tight tracking-tight text-white md:text-4xl">
              {listing.title}
            </h1>

            <div className="mt-5 grid gap-4 border-b border-white/5 pb-5 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                  Price
                </p>
                <p className="mt-1 text-4xl font-black tracking-tight text-amber-500 md:text-5xl">
                  {listingPrice}
                </p>
              </div>

              <div className="sm:text-right">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                  Availability
                </p>
                <p className="mt-1 font-serif text-xl italic text-white">
                  {inventoryType === 'single'
                    ? listingAvailabilityLabel(listing)
                    : listing.quantity}
                </p>
              </div>
            </div>

            {singleProductBlocked && listingStatus !== 'sold' && (
              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <Lock className="h-5 w-5 shrink-0 text-amber-400" />
                <p className="text-[10px] font-black uppercase leading-relaxed tracking-widest text-amber-300">
                  {SINGLE_PRODUCT_UNAVAILABLE_MESSAGE}
                </p>
              </div>
            )}

            {listingStatus === 'sold' && (
              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <Lock className="h-5 w-5 shrink-0 text-red-400" />
                <p className="text-[10px] font-black uppercase leading-relaxed tracking-widest text-red-300">
                  This single product has been sold and is closed for new trades.
                </p>
              </div>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                onClick={startTrade}
                disabled={tradeDisabled}
                className="flex items-center justify-center gap-2 rounded-2xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black shadow-xl transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {trading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : singleProductBlocked ? (
                  <Lock className="h-5 w-5" />
                ) : (
                  <CreditCard className="h-5 w-5" />
                )}
                {tradeButtonLabel}
              </button>

              <button
                onClick={startTrade}
                disabled={tradeDisabled}
                className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MessageCircle className="h-5 w-5" />
                {singleProductBlocked ? 'Not Available' : 'Ask Seller'}
              </button>
            </div>

            {isOwnListing && (
              <p className="mt-3 rounded-xl border border-green-500/20 bg-green-500/10 p-3 text-center text-[9px] font-black uppercase tracking-widest text-green-400">
                Buyers will see the trade button on this listing.
              </p>
            )}

            {!isOwnListing && !singleProductBlocked && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-green-500/20 bg-green-500/10 p-3">
                <ShieldCheck className="h-4 w-4 text-green-400" />
                <span className="text-[9px] font-black uppercase tracking-widest text-green-400">
                  Escrow protected. Delivery can be requested after trade starts.
                </span>
              </div>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
                <MapPin className="h-4 w-4 text-amber-500" />
                <p className="mt-3 text-[8px] font-black uppercase tracking-widest text-slate-600">
                  Location
                </p>
                <p className="mt-1 truncate text-xs font-bold text-white">
                  {displayListingLocation(listing)}
                </p>
                {distance !== null && (
                  <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-amber-500">
                    {formatDistance(distance)}
                  </p>
                )}
              </div>

              <Link
                to="/map"
                className="rounded-2xl border border-white/5 bg-black/30 p-4 transition hover:border-amber-500/30"
              >
                <Navigation className="h-4 w-4 text-amber-500" />
                <p className="mt-3 text-[8px] font-black uppercase tracking-widest text-slate-600">
                  Map
                </p>
                <p className="mt-1 text-xs font-bold text-white">
                  Open nearby
                </p>
              </Link>

              <Link
                to="/drivers"
                className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4 transition hover:bg-green-500 hover:text-black"
              >
                <Truck className="h-4 w-4 text-green-400" />
                <p className="mt-3 text-[8px] font-black uppercase tracking-widest text-green-400">
                  Delivery
                </p>
                <p className="mt-1 text-xs font-bold text-white">
                  Find driver
                </p>
              </Link>
            </div>

            {listing.metadata && Object.keys(listing.metadata).length > 0 && (
              <div className="mt-5 grid grid-cols-2 gap-3">
                {Object.entries(listing.metadata).map(([key, value]) => (
                  <div key={key} className="rounded-xl border border-white/5 bg-black/20 p-3">
                    <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-600">
                      {key}
                    </p>
                    <p className="font-serif text-sm text-white">{value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6">
              <h3 className="mb-3 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
                <Scale className="h-3 w-3" />
                Product Description
              </h3>
              <p className="line-clamp-5 whitespace-pre-wrap border-l-2 border-amber-500/10 pl-4 font-serif text-sm italic leading-relaxed text-slate-400">
                "{listing.description}"
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-3xl border border-white/5 bg-brand-card p-6 shadow-xl">
          <div className="flex items-center gap-5">
            <div className="relative">
              <img
                src={
                  seller?.photoURL ||
                  `https://api.dicebear.com/7.x/avataaars/svg?seed=${sellerId}`
                }
                className="h-14 w-14 rounded-full border-2 border-white/10 object-cover grayscale-[0.3]"
                alt={displaySellerName(seller)}
              />
              {sellerActive && (
                <div className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-brand-card bg-green-500 shadow-lg" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-serif text-xl text-white">
                  {displaySellerName(seller)}
                </p>

                {seller?.verificationStatus === 'verified' && (
                  <div className="flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5">
                    <ShieldCheck className="h-3 w-3 text-amber-500" />
                    <span className="text-[8px] font-bold uppercase tracking-wider text-amber-500">
                      Verified
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                  {seller?.totalTrades || 0} Trades
                </p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                  {seller?.followersCount || 0} Followers
                </p>
                <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-amber-500">
                  <Star className="h-3 w-3 fill-amber-500" />
                  {seller?.averageRating?.toFixed(1) || '0.0'}
                </div>
              </div>
            </div>

            {user && user.uid !== sellerId && (
              <button
                onClick={toggleFollow}
                disabled={followingLoading}
                className={`flex items-center gap-2 rounded-xl px-4 py-3 text-[8px] font-black uppercase tracking-widest transition-all ${
                  isFollowing
                    ? 'border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
                    : 'bg-white text-black hover:bg-amber-500'
                }`}
              >
                {followingLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : isFollowing ? (
                  <>
                    <UserMinus className="h-3 w-3" />
                    Unfollow
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3 w-3" />
                    Follow
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {isOwnListing && (
          <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-6">
            <h3 className="font-serif text-xl text-white">Boost Visibility</h3>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">
              Reach more traders in your region
            </p>

            <div className="mt-5 grid gap-3">
              <button
                onClick={() => handleBoostListing('standard', 2000)}
                className="rounded-2xl border border-white/5 bg-black/40 p-4 text-left transition hover:border-amber-500/50"
              >
                <h4 className="font-serif text-base text-white">Standard Boost</h4>
                <p className="mt-1 text-[8px] uppercase tracking-widest text-slate-500">
                  7 Days Priority
                </p>
                <p className="mt-3 text-lg font-bold text-white">
                  {formatMoney(2000, 'XAF', 'fr-CM')}
                </p>
              </button>

              <button
                onClick={() => handleBoostListing('premium', 5000)}
                className="rounded-2xl border border-l-4 border-white/5 border-l-amber-500 bg-black/40 p-4 text-left transition hover:border-amber-500/50"
              >
                <h4 className="font-serif text-base text-white">Premium Boost</h4>
                <p className="mt-1 text-[8px] uppercase tracking-widest text-slate-500">
                  30 Days Top Placement
                </p>
                <p className="mt-3 text-lg font-bold text-white">
                  {formatMoney(5000, 'XAF', 'fr-CM')}
                </p>
              </button>
            </div>
          </div>
        )}
      </section>

      {nearby.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <h2 className="font-serif text-2xl text-white">
              Similar Listings Nearby
            </h2>
            <Link
              to="/"
              className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500"
            >
              View All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {nearby.map(item => {
              const itemImages = getListingImages(item);

              return (
                <Link
                  key={item.id}
                  to={`/listing/${item.id}`}
                  className="group overflow-hidden rounded-2xl border border-white/5 bg-brand-card"
                >
                  <div className="aspect-[4/3] bg-slate-900">
                    {itemImages[0] ? (
                      <img
                        src={itemImages[0]}
                        className="h-full w-full object-cover grayscale-[0.4] transition-all group-hover:scale-105 group-hover:grayscale-0"
                        alt={item.title}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-800">
                        <Package className="h-8 w-8" />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 p-4">
                    <p className="truncate text-[9px] font-black uppercase tracking-widest text-amber-500">
                      {formatListingPrice(item)}
                    </p>
                    <h4 className="line-clamp-2 font-serif text-sm text-white">
                      {item.title}
                    </h4>
                    <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-slate-500">
                      <Eye className="h-3 w-3" />
                      Open listing
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
