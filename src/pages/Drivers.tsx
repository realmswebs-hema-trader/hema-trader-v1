import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  Package,
  Search,
  ShieldCheck,
  Star,
  Truck,
  WifiOff,
  XCircle
} from 'lucide-react';
import { motion } from 'motion/react';

import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import { useNotifications } from '../components/notifications/NotificationContext';
import DriverMap from '../components/maps/DriverMap';
import { toGeoPoint } from '../utils/geoUtils';
import { sendSystemTradeMessage } from '../services/chatService';
import {
  acceptDeliveryRequest,
  declineDeliveryRequest,
  deliveryStatusLabel,
  lockAgreedDeliveryFee,
  sendDeliveryCounterOffer,
  updateDriverTripStatus
} from '../services/deliveryLogisticsService';

interface Driver {
  id: string;
  displayName?: string;
  name?: string;
  email?: string;
  photoURL?: string;
  roles?: string[];
  isOnline?: boolean;
  online?: boolean;
  gpsTrackingActive?: boolean;
  gpsLastSeenAt?: any;
  lastLocationUpdateAt?: any;
  driverStatus?: string;
  availability?: string;
  avgDriverRating?: number;
  averageRating?: number;
  deliveriesCount?: number;
  completedDeliveries?: number;
  vehicleType?: string;
  vehicleSize?: string;
  location?: string;
  city?: string;
  country?: string;
  currentLocation?: {
    latitude?: number;
    longitude?: number;
  };
  trustScore?: number;
  driverVerified?: boolean;
  deliverySuccessRate?: number;
  reliabilityScore?: number;
}

interface DeliveryRequest {
  id: string;
  tradeId: string;
  buyerId: string;
  sellerId: string;
  driverId: string;
  listingId: string;
  listingTitle?: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  proposedFee?: number;
  counterFee?: number | null;
  agreedFee?: number | null;
  currency?: string;
  distanceKm?: number | null;
  status?: string;
  buyerInfo?: {
    name?: string;
    location?: string;
  };
  sellerInfo?: {
    name?: string;
    location?: string;
  };
  createdAt?: any;
  updatedAt?: any;
  acceptedAt?: any;
  declinedAt?: any;
  deliveryFeePaidAt?: any;
  pickupStartedAt?: any;
  pickedUpAt?: any;
  deliveryStartedAt?: any;
  deliveredAt?: any;
}

interface DriverTrade {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  driverId?: string;
  assignedDriverId?: string;
  deliveryRequestId?: string;
  deliveryStatus?: string;
  deliveryNegotiationStatus?: string;
  deliveryPaymentStatus?: string;
  deliveryFee?: number;
  agreedDeliveryFee?: number;
  deliveryFeeAgreed?: boolean;
  deliveryPaymentDeadlineAt?: any;
  status?: string;
  createdAt?: any;
  updatedAt?: any;
}

const zeroDecimalCurrencies = new Set(['XAF', 'XOF', 'UGX', 'RWF']);

const formatMoney = (amount = 0, currencyCode = 'XAF', locale = 'fr-CM') => {
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

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const formatShortTime = (value: any) => {
  const millis = getMillis(value);
  if (!millis) return 'Just now';

  return new Date(millis).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const displayName = (driver: Driver) =>
  driver.displayName || driver.name || driver.email || 'Driver';

const displayLocation = (driver: Driver) =>
  driver.location ||
  [driver.city, driver.country].filter(Boolean).join(', ') ||
  (driver.currentLocation?.latitude && driver.currentLocation?.longitude
    ? 'Live GPS location'
    : 'Cameroon');

const isDriver = (driver: Partial<Driver>) =>
  Array.isArray(driver.roles) && driver.roles.includes('driver');

const isGpsFresh = (driver: Driver) => {
  const millis = getMillis(driver.lastLocationUpdateAt || driver.gpsLastSeenAt);
  if (!millis) return false;

  return Date.now() - millis < 2 * 60 * 1000;
};

const hasLiveLocation = (driver: Driver) =>
  Number.isFinite(Number(driver.currentLocation?.latitude)) &&
  Number.isFinite(Number(driver.currentLocation?.longitude));

const isAvailable = (driver: Driver) => {
  const status = (driver.driverStatus || driver.availability || '').toLowerCase();

  return (
    isDriver(driver) &&
    status !== 'offline' &&
    status !== 'on_trip' &&
    status !== 'busy' &&
    status !== 'unavailable' &&
    (
      status === 'available' ||
      status === 'online' ||
      driver.availability === 'available' ||
      Boolean(driver.isOnline || driver.online)
    )
  );
};

const driverRank = (driver: Driver) => {
  const gpsBoost = isGpsFresh(driver) && hasLiveLocation(driver) ? 100 : 0;
  const verifiedBoost = driver.driverVerified ? 50 : 0;
  const trustBoost = safeNumber(driver.trustScore);
  const ratingBoost = safeNumber(driver.avgDriverRating || driver.averageRating) * 10;
  const deliveryBoost = Math.min(
    safeNumber(driver.completedDeliveries || driver.deliveriesCount),
    100
  );

  return gpsBoost + verifiedBoost + trustBoost + ratingBoost + deliveryBoost;
};

const isClosedDeliveryRequest = (request: DeliveryRequest) =>
  ['declined', 'cancelled', 'completed'].includes(request.status || '');

const requestFee = (request: DeliveryRequest) =>
  Number(request.agreedFee || request.counterFee || request.proposedFee || 0);

export default function Drivers() {
  const { user, profile } = useAuth();
  const { sendNotification } = useNotifications();

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [deliveryRequests, setDeliveryRequests] = useState<DeliveryRequest[]>([]);
  const [assignedTrips, setAssignedTrips] = useState<DriverTrade[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const currentLocation = useMemo(() => toGeoPoint(profile), [profile]);
  const currentProfile = profile as Partial<Driver> | null;
  const currentUserIsDriver = Boolean(user?.uid && currentProfile && isDriver(currentProfile));

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'users'), limit(300)),
      snap => {
        const nextDrivers = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Driver))
          .filter(driver => isDriver(driver))
          .filter(driver => isAvailable(driver))
          .sort((a, b) => driverRank(b) - driverRank(a));

        setDrivers(nextDrivers);
        setLoading(false);
      },
      error => {
        console.error('Drivers sync failed:', error);
        setDrivers([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.uid || !currentUserIsDriver) {
      setDeliveryRequests([]);
      setAssignedTrips([]);
      setRequestsLoading(false);
      return;
    }

    setRequestsLoading(true);

    const unsubscribeRequests = onSnapshot(
      query(
        collection(db, 'deliveryRequests'),
        where('driverId', '==', user.uid),
        limit(50)
      ),
      snap => {
        const nextRequests = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as DeliveryRequest))
          .filter(request => !isClosedDeliveryRequest(request))
          .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

        setDeliveryRequests(nextRequests);
        setRequestsLoading(false);
      },
      error => {
        console.error('Delivery request sync failed:', error);
        setDeliveryRequests([]);
        setRequestsLoading(false);
      }
    );

    const unsubscribeTrips = onSnapshot(
      query(
        collection(db, 'trades'),
        where('driverId', '==', user.uid),
        limit(50)
      ),
      snap => {
        const nextTrips = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as DriverTrade))
          .filter(trade => trade.status !== 'cancelled' && trade.status !== 'completed')
          .sort((a, b) => getMillis(b.updatedAt || b.createdAt) - getMillis(a.updatedAt || a.createdAt));

        setAssignedTrips(nextTrips);
      },
      error => {
        console.error('Assigned trip sync failed:', error);
        setAssignedTrips([]);
      }
    );

    return () => {
      unsubscribeRequests();
      unsubscribeTrips();
    };
  }, [user?.uid, currentUserIsDriver]);

  const filteredDrivers = useMemo(
    () =>
      drivers.filter(driver =>
        [
          displayName(driver),
          displayLocation(driver),
          driver.vehicleType,
          driver.vehicleSize
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [drivers, search]
  );

  const incomingRequests = deliveryRequests.filter(request =>
    request.status === 'delivery_requested'
  );

  const activeRequests = deliveryRequests.filter(request =>
    request.status !== 'delivery_requested'
  );

  const notifyDeliveryUpdate = async (
    request: DeliveryRequest,
    title: string,
    body: string
  ) => {
    await Promise.all([
      sendNotification(request.buyerId, {
        title,
        body,
        type: 'delivery',
        targetId: request.tradeId,
        targetType: 'trade',
        actionUrl: `/trade/${request.tradeId}`
      }),
      sendNotification(request.sellerId, {
        title,
        body,
        type: 'delivery',
        targetId: request.tradeId,
        targetType: 'trade',
        actionUrl: `/trade/${request.tradeId}`
      })
    ]);

    await sendSystemTradeMessage({
      tradeId: request.tradeId,
      listingId: request.listingId,
      text: body,
      recipientIds: [request.buyerId, request.sellerId, request.driverId],
      sendNotification,
      title
    });
  };

  const handleAcceptFee = async (request: DeliveryRequest) => {
    if (!user?.uid) return;

    const fee = Number(request.proposedFee || 0);

    if (!Number.isFinite(fee) || fee <= 0) {
      alert('This delivery request does not have a valid proposed fee.');
      return;
    }

    setActionId(request.id);

    try {
      await acceptDeliveryRequest({
        tradeId: request.tradeId,
        deliveryRequestId: request.id,
        driverId: user.uid
      });

      await lockAgreedDeliveryFee({
        tradeId: request.tradeId,
        deliveryRequestId: request.id,
        amount: fee
      });

      await notifyDeliveryUpdate(
        request,
        'Driver Accepted Delivery Fee',
        `Driver accepted the proposed delivery fee of ${formatMoney(fee, request.currency || 'XAF')}. Buyer can now pay the delivery fee from Hema Wallet.`
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not accept this delivery request.');
    } finally {
      setActionId(null);
    }
  };

  const handleDeclineRequest = async (request: DeliveryRequest) => {
    if (!user?.uid) return;

    setActionId(request.id);

    try {
      await declineDeliveryRequest({
        tradeId: request.tradeId,
        deliveryRequestId: request.id,
        driverId: user.uid
      });

      await notifyDeliveryUpdate(
        request,
        'Driver Declined Delivery',
        'A driver declined this delivery request. The buyer may choose another available driver.'
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not decline this delivery request.');
    } finally {
      setActionId(null);
    }
  };

  const handleCounterOffer = async (request: DeliveryRequest) => {
    if (!user?.uid) return;

    const input = window.prompt('Enter your counter delivery fee.');
    const amount = Number(input);

    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid delivery fee.');
      return;
    }

    setActionId(request.id);

    try {
      if (request.status === 'delivery_requested') {
        await acceptDeliveryRequest({
          tradeId: request.tradeId,
          deliveryRequestId: request.id,
          driverId: user.uid
        });
      }

      await sendDeliveryCounterOffer({
        tradeId: request.tradeId,
        deliveryRequestId: request.id,
        senderId: user.uid,
        buyerId: request.buyerId,
        driverId: user.uid,
        amount
      });

      await notifyDeliveryUpdate(
        request,
        'Driver Sent Counter Offer',
        `Driver countered the delivery fee at ${formatMoney(amount, request.currency || 'XAF')}. Buyer can accept, decline, or counter from the trade page.`
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not send counter offer.');
    } finally {
      setActionId(null);
    }
  };

  const handleTripStatus = async (
    trade: DriverTrade,
    status:
      | 'driver_en_route_to_pickup'
      | 'product_picked_up'
      | 'delivery_in_progress'
      | 'delivered'
  ) => {
    if (!user?.uid) return;

    const messages: Record<typeof status, string> = {
      driver_en_route_to_pickup:
        'Driver is on the way to pick up the product from the seller.',
      product_picked_up:
        'Driver confirmed product pickup. Buyer and seller have been notified.',
      delivery_in_progress:
        'Driver has started final delivery to the buyer.',
      delivered:
        'Driver marked the delivery as delivered. Buyer should inspect and confirm receipt.'
    };

    setActionId(`${trade.id}:${status}`);

    try {
      await updateDriverTripStatus({
        tradeId: trade.id,
        deliveryRequestId: trade.deliveryRequestId,
        driverId: user.uid,
        status
      });

      await sendSystemTradeMessage({
        tradeId: trade.id,
        listingId: trade.listingId,
        text: messages[status],
        recipientIds: [trade.buyerId, trade.sellerId, user.uid],
        sendNotification,
        title: 'Delivery Update'
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not update delivery status.');
    } finally {
      setActionId(null);
    }
  };

  const renderTripAction = (trade: DriverTrade) => {
    if (trade.deliveryPaymentStatus !== 'paid') {
      return (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-center text-[9px] font-black uppercase leading-relaxed tracking-widest text-amber-400">
          Waiting for buyer to pay the agreed delivery fee.
        </div>
      );
    }

    if (
      trade.deliveryStatus === 'accepted' ||
      trade.deliveryStatus === 'delivery_fee_paid' ||
      trade.deliveryNegotiationStatus === 'delivery_fee_paid'
    ) {
      return (
        <button
          onClick={() => handleTripStatus(trade, 'driver_en_route_to_pickup')}
          disabled={actionId === `${trade.id}:driver_en_route_to_pickup`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
        >
          <Navigation className="h-4 w-4" />
          Go to Pickup
        </button>
      );
    }

    if (trade.deliveryStatus === 'driver_en_route_to_pickup') {
      return (
        <button
          onClick={() => handleTripStatus(trade, 'product_picked_up')}
          disabled={actionId === `${trade.id}:product_picked_up`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
        >
          <Package className="h-4 w-4" />
          Product Picked Up
        </button>
      );
    }

    if (trade.deliveryStatus === 'product_picked_up') {
      return (
        <button
          onClick={() => handleTripStatus(trade, 'delivery_in_progress')}
          disabled={actionId === `${trade.id}:delivery_in_progress`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 py-3 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
        >
          <Truck className="h-4 w-4" />
          Start Delivery
        </button>
      );
    }

    if (trade.deliveryStatus === 'delivery_in_progress') {
      return (
        <button
          onClick={() => handleTripStatus(trade, 'delivered')}
          disabled={actionId === `${trade.id}:delivered`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 py-3 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          Mark Delivered
        </button>
      );
    }

    return (
      <Link
        to={`/trade/${trade.id}`}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-white hover:text-black"
      >
        Open Trade
      </Link>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pb-24 pt-8">
      <div className="text-center">
        <h1 className="font-serif text-4xl text-white">Available Drivers</h1>
        <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-500">
          Live GPS delivery agents in the Hema Trader network
        </p>
      </div>

      {currentUserIsDriver && (
        <section className="space-y-5 rounded-[2rem] border border-white/10 bg-brand-card p-5 shadow-2xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-serif text-2xl text-white">Driver Dashboard</h2>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
                Incoming requests, delivery bargaining, and active trip controls
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1.5 text-[8px] font-black uppercase tracking-widest text-green-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
              Driver Mode
            </div>
          </div>

          {requestsLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            </div>
          ) : incomingRequests.length === 0 && assignedTrips.length === 0 && activeRequests.length === 0 ? (
            <div className="rounded-2xl border border-white/5 bg-black/30 p-8 text-center">
              <Truck className="mx-auto mb-3 h-10 w-10 text-slate-700" />
              <p className="font-serif text-xl text-white">No delivery requests yet</p>
              <p className="mt-2 text-sm text-slate-500">
                New buyer delivery requests will appear here when you are online and available.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {incomingRequests.map(request => {
                const fee = requestFee(request);

                return (
                  <article
                    key={request.id}
                    className="space-y-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-widest text-amber-500">
                          Incoming Request
                        </p>
                        <h3 className="mt-1 font-serif text-xl text-white">
                          {request.listingTitle || 'Product Delivery'}
                        </h3>
                        <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">
                          Trade #{request.tradeId.slice(-6).toUpperCase()}
                        </p>
                      </div>

                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-amber-400">
                        {deliveryStatusLabel(request.status)}
                      </span>
                    </div>

                    <div className="grid gap-3 text-sm text-slate-400">
                      <p>
                        <MapPin className="mr-2 inline h-4 w-4 text-amber-500" />
                        Pickup: {request.pickupLocation || 'Seller pickup location'}
                      </p>
                      <p>
                        <Navigation className="mr-2 inline h-4 w-4 text-green-500" />
                        Dropoff: {request.dropoffLocation || 'Buyer delivery location'}
                      </p>
                      {request.distanceKm ? (
                        <p>
                          <Truck className="mr-2 inline h-4 w-4 text-slate-500" />
                          Distance: {Number(request.distanceKm).toFixed(1)} km
                        </p>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                          Proposed Fee
                        </p>
                        <p className="mt-1 text-lg font-bold text-white">
                          {formatMoney(fee, request.currency || 'XAF')}
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                          Requested
                        </p>
                        <p className="mt-1 text-sm font-bold text-white">
                          {formatShortTime(request.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      <button
                        onClick={() => handleAcceptFee(request)}
                        disabled={actionId === request.id}
                        className="flex items-center justify-center gap-2 rounded-xl bg-green-500 py-3 text-[9px] font-black uppercase tracking-widest text-black disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Accept Fee
                      </button>

                      <button
                        onClick={() => handleCounterOffer(request)}
                        disabled={actionId === request.id}
                        className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[9px] font-black uppercase tracking-widest text-black disabled:opacity-50"
                      >
                        <Clock className="h-4 w-4" />
                        Counter
                      </button>

                      <button
                        onClick={() => handleDeclineRequest(request)}
                        disabled={actionId === request.id}
                        className="flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 py-3 text-[9px] font-black uppercase tracking-widest text-red-400 disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" />
                        Decline
                      </button>
                    </div>
                  </article>
                );
              })}

              {assignedTrips.map(trade => {
                const fee = Number(trade.agreedDeliveryFee || trade.deliveryFee || 0);

                return (
                  <article
                    key={trade.id}
                    className="space-y-4 rounded-2xl border border-green-500/20 bg-green-500/5 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-widest text-green-400">
                          Active Delivery
                        </p>
                        <h3 className="mt-1 font-serif text-xl text-white">
                          Trade #{trade.id.slice(-6).toUpperCase()}
                        </h3>
                        <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">
                          {deliveryStatusLabel(trade.deliveryStatus || trade.deliveryNegotiationStatus)}
                        </p>
                      </div>

                      <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-green-400">
                        {trade.deliveryPaymentStatus === 'paid' ? 'Paid' : 'Awaiting Payment'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                          Agreed Fee
                        </p>
                        <p className="mt-1 text-lg font-bold text-white">
                          {formatMoney(fee)}
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                          Payment
                        </p>
                        <p className="mt-1 text-sm font-bold text-white">
                          {deliveryStatusLabel(trade.deliveryPaymentStatus || 'unpaid')}
                        </p>
                      </div>
                    </div>

                    {renderTripAction(trade)}

                    <Link
                      to={`/trade/${trade.id}`}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-white hover:text-black"
                    >
                      Open Trade Chat
                    </Link>
                  </article>
                );
              })}

              {activeRequests.map(request => (
                <article
                  key={request.id}
                  className="space-y-3 rounded-2xl border border-white/5 bg-black/30 p-5"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                        Delivery Request
                      </p>
                      <h3 className="mt-1 font-serif text-lg text-white">
                        {request.listingTitle || 'Product Delivery'}
                      </h3>
                    </div>

                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-slate-400">
                      {deliveryStatusLabel(request.status)}
                    </span>
                  </div>

                  <p className="text-sm text-slate-500">
                    Fee: {formatMoney(requestFee(request), request.currency || 'XAF')}
                  </p>

                  <Link
                    to={`/trade/${request.tradeId}`}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-white hover:text-black"
                  >
                    Open Trade
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="relative mx-auto max-w-xl">
        <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search drivers, vehicles, or locations"
          className="w-full rounded-2xl border border-white/10 bg-brand-card py-4 pl-12 pr-5 text-sm text-white outline-none focus:border-amber-500/50"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        </div>
      ) : filteredDrivers.length > 0 ? (
        <>
          <DriverMap
            drivers={filteredDrivers}
            currentLocation={currentLocation}
            className="h-[460px]"
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {filteredDrivers.map(driver => {
              const rating = safeNumber(driver.avgDriverRating || driver.averageRating);
              const deliveries = safeNumber(driver.completedDeliveries || driver.deliveriesCount);
              const gpsFresh = isGpsFresh(driver);
              const liveLocation = hasLiveLocation(driver);
              const successRate = safeNumber(
                driver.deliverySuccessRate || driver.reliabilityScore,
                deliveries ? 96 : 100
              );

              return (
                <motion.article
                  key={driver.id}
                  whileHover={{ y: -4 }}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-brand-card shadow-2xl"
                >
                  <div className="relative h-20 bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/40">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.2),transparent_35%)]" />

                    <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-green-400">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                      Available
                    </div>
                  </div>

                  <div className="-mt-10 flex flex-col items-center px-5 pb-5 text-center">
                    <div className="relative">
                      <img
                        src={
                          driver.photoURL ||
                          `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.id}`
                        }
                        alt={displayName(driver)}
                        className="h-24 w-24 rounded-full border-4 border-brand-card bg-slate-900 object-cover"
                        referrerPolicy="no-referrer"
                      />

                      <span
                        className={`absolute right-2 top-2 h-4 w-4 rounded-full border-2 border-brand-card ${
                          gpsFresh ? 'animate-pulse bg-green-500' : 'bg-amber-500'
                        }`}
                      />
                    </div>

                    <h2 className="mt-4 font-serif text-xl text-white">
                      {displayName(driver)}
                    </h2>

                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-green-400">
                        Available
                      </span>

                      {driver.driverVerified && (
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-amber-400">
                          Verified
                        </span>
                      )}

                      <span
                        className={`rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-widest ${
                          gpsFresh && liveLocation
                            ? 'border-green-500/20 bg-green-500/10 text-green-400'
                            : 'border-amber-500/20 bg-amber-500/10 text-amber-400'
                        }`}
                      >
                        {gpsFresh && liveLocation ? 'Live GPS' : 'GPS Pending'}
                      </span>
                    </div>

                    <div className="mt-4 grid w-full grid-cols-2 gap-2">
                      <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                        <div className="flex items-center justify-center gap-1 text-amber-500">
                          <Star className="h-4 w-4 fill-amber-500" />
                          <span className="text-sm font-bold">{rating.toFixed(1)}</span>
                        </div>
                        <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-600">
                          Rating
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                        <div className="flex items-center justify-center gap-1 text-green-400">
                          <ShieldCheck className="h-4 w-4" />
                          <span className="text-sm font-bold">{successRate}%</span>
                        </div>
                        <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-600">
                          Success
                        </p>
                      </div>
                    </div>

                    <p className="mt-4 text-sm text-slate-400">
                      {deliveries} completed deliveries
                    </p>

                    <p className="mt-2 text-xs text-slate-500">
                      <Truck className="mr-1 inline h-3 w-3" />
                      {driver.vehicleType || 'Vehicle'} • {driver.vehicleSize || 'Medium'}
                    </p>

                    <p className="mt-2 text-xs text-slate-500">
                      <MapPin className="mr-1 inline h-3 w-3" />
                      {displayLocation(driver)}
                    </p>

                    {liveLocation ? (
                      <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-green-500">
                        <Navigation className="mr-1 inline h-3 w-3" />
                        Location ready
                      </p>
                    ) : (
                      <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-amber-500">
                        <WifiOff className="mr-1 inline h-3 w-3" />
                        Waiting for GPS
                      </p>
                    )}

                    <Link
                      to={`/drivers/${driver.id}`}
                      className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-green-500/10 py-3 text-[10px] font-black uppercase tracking-widest text-green-400 hover:bg-green-500 hover:text-black"
                    >
                      <Truck className="h-4 w-4" />
                      Hire Driver
                    </Link>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </>
      ) : (
        <div className="rounded-[2rem] border border-white/5 bg-brand-card p-10 text-center shadow-2xl">
          <Truck className="mx-auto mb-4 h-12 w-12 text-slate-700" />
          <h2 className="font-serif text-2xl text-white">No drivers available right now</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-500">
            Available drivers will appear here when they turn on GPS and set their status to available.
          </p>
        </div>
      )}

      {!currentUserIsDriver && user && (
        <div className="rounded-2xl border border-white/5 bg-brand-card p-5 text-center text-sm text-slate-500">
          <AlertCircle className="mx-auto mb-3 h-6 w-6 text-slate-600" />
          Driver request controls appear here after your account is approved as a Hema Trader driver.
        </div>
      )}
    </div>
  );
}
