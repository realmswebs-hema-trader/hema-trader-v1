import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Phone,
  Radio,
  Route,
  ShieldCheck,
  Truck,
  User,
  Wallet,
  WifiOff,
  Zap
} from 'lucide-react';
import { motion } from 'motion/react';

import { useAuth } from '../components/auth/AuthContext';
import {
  calculateDistance,
  calculateETA,
  formatETA,
  isLocationStale,
  subscribeToDelivery,
  subscribeToDeliveryTracking,
  updateDeliveryStatus,
  type DeliveryStatus
} from '../services/locationTrackingService';

interface GeoPoint {
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
}

const CAMEROON_CENTER: [number, number] = [3.848, 11.502];

const statusOrder: DeliveryStatus[] = [
  'pending',
  'assigned',
  'accepted',
  'picked_up',
  'in_transit',
  'arriving',
  'delivered',
  'completed'
];

const statusSteps: Array<{
  id: DeliveryStatus;
  label: string;
  description: string;
  icon: any;
}> = [
  {
    id: 'pending',
    label: 'Requested',
    description: 'Delivery order created',
    icon: Package
  },
  {
    id: 'accepted',
    label: 'Accepted',
    description: 'Driver confirmed the job',
    icon: Truck
  },
  {
    id: 'picked_up',
    label: 'Picked Up',
    description: 'Goods collected from seller',
    icon: MapPin
  },
  {
    id: 'in_transit',
    label: 'In Transit',
    description: 'Delivery is moving',
    icon: Navigation
  },
  {
    id: 'arriving',
    label: 'Arriving',
    description: 'Driver is near destination',
    icon: Radio
  },
  {
    id: 'delivered',
    label: 'Delivered',
    description: 'Goods delivered to buyer',
    icon: CheckCircle
  }
];

const zeroDecimalCurrencies = new Set(['XAF', 'XOF', 'UGX', 'RWF']);

const normalizeCurrencyCode = (value?: string) => {
  const upper = String(value || '').toUpperCase();

  if (!upper || upper === 'CFA') return 'XAF';

  return upper;
};

const formatMoney = (
  amount: number,
  currencyCode = 'XAF',
  locale = 'fr-CM'
) => {
  const normalizedCurrency = normalizeCurrencyCode(currencyCode);

  try {
    return new Intl.NumberFormat(locale || 'fr-CM', {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: zeroDecimalCurrencies.has(normalizedCurrency) ? 0 : 2
    }).format(Number(amount || 0));
  } catch {
    return `${normalizedCurrency} ${Number(amount || 0).toLocaleString()}`;
  }
};

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const formatTime = (value: any) => {
  const millis = getMillis(value);
  if (!millis) return '';

  return new Date(millis).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatAge = (value: any) => {
  const millis = getMillis(value);
  if (!millis) return 'No signal yet';

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - millis) / 1000));

  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;

  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;

  return `${Math.floor(deltaMinutes / 60)}h ago`;
};

const titleStatus = (value?: string) =>
  String(value || 'pending')
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getLocation = (value: any): GeoPoint | null => {
  if (!value) return null;

  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng);
  const speed = Number(value.speed);
  const heading = Number(value.heading);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    speed: Number.isFinite(speed) ? speed : undefined,
    heading: Number.isFinite(heading) ? heading : undefined
  };
};

const markerHtml = (label: string, color: string) => `
  <div style="
    width: 34px;
    height: 34px;
    border-radius: 999px;
    background: ${color};
    border: 3px solid #ffffff;
    box-shadow: 0 0 28px ${color};
    display: grid;
    place-items: center;
    color: #050505;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: .08em;
  ">
    ${label}
  </div>
`;

const driverMarkerHtml = `
  <div style="
    position: relative;
    width: 48px;
    height: 48px;
    border-radius: 999px;
    background: rgba(245,158,11,.18);
    border: 1px solid rgba(245,158,11,.7);
    box-shadow: 0 0 30px rgba(245,158,11,.45);
    display: grid;
    place-items: center;
  ">
    <span style="
      position: absolute;
      inset: -8px;
      border-radius: 999px;
      border: 1px solid rgba(245,158,11,.45);
      animation: pulse 1.6s infinite;
    "></span>
    <div style="
      width: 30px;
      height: 30px;
      border-radius: 999px;
      background: #f59e0b;
      color: #050505;
      display: grid;
      place-items: center;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .08em;
    ">DR</div>
  </div>
`;

const buildDirectionsUrl = (destination: GeoPoint | null, origin?: GeoPoint | null) => {
  if (!destination) return '';

  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.latitude},${destination.longitude}`
  });

  if (origin) {
    params.set('origin', `${origin.latitude},${origin.longitude}`);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

export default function DeliveryTracking() {
  const { id } = useParams();
  const { user } = useAuth();

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const pickupMarkerRef = useRef<any>(null);
  const destinationMarkerRef = useRef<any>(null);
  const routeLineRef = useRef<any>(null);

  const [leaflet, setLeaflet] = useState<any>(null);
  const [delivery, setDelivery] = useState<any>(null);
  const [tracking, setTracking] = useState<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    import('leaflet').then(module => setLeaflet(module.default || module));
  }, []);

  useEffect(() => {
    if (!id) return undefined;

    const unsubDelivery = subscribeToDelivery(id, setDelivery);
    const unsubTracking = subscribeToDeliveryTracking(id, setTracking);

    return () => {
      unsubDelivery();
      unsubTracking();
    };
  }, [id]);

  useEffect(() => {
    if (!leaflet || !mapRef.current || leafletMapRef.current) return undefined;

    leafletMapRef.current = leaflet.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false
    });

    leafletMapRef.current.setView(CAMEROON_CENTER, 7);

    leaflet
      .tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
      })
      .addTo(leafletMapRef.current);

    leaflet.control.zoom({ position: 'bottomright' }).addTo(leafletMapRef.current);

    window.setTimeout(() => {
      leafletMapRef.current?.invalidateSize();
    }, 150);

    setMapReady(true);

    return () => {
      leafletMapRef.current?.remove();
      leafletMapRef.current = null;
      driverMarkerRef.current = null;
      pickupMarkerRef.current = null;
      destinationMarkerRef.current = null;
      routeLineRef.current = null;
      setMapReady(false);
    };
  }, [leaflet]);

  const driverLocation = getLocation(
    tracking?.driverLocation ||
      tracking?.location ||
      delivery?.driverLocation
  );

  const pickupLocation = getLocation(
    delivery?.pickupLocation ||
      delivery?.pickup ||
      delivery?.originLocation
  );

  const destinationLocation = getLocation(
    delivery?.destinationLocation ||
      delivery?.dropoffLocation ||
      delivery?.deliveryLocation
  );

  const lastSignalAt =
    tracking?.lastUpdatedAt ||
    tracking?.updatedAt ||
    tracking?.driverLocation?.updatedAt ||
    delivery?.trackingLastUpdatedAt ||
    delivery?.updatedAt;

  const driverSpeed = Number(
    tracking?.driverLocation?.speed ??
      tracking?.speed ??
      delivery?.driverLocation?.speed ??
      0
  );

  const etaMinutes = useMemo(
    () =>
      driverLocation && destinationLocation
        ? calculateETA(driverLocation, destinationLocation, driverSpeed)
        : null,
    [driverLocation, destinationLocation, driverSpeed]
  );

  const distanceKm = useMemo(
    () =>
      driverLocation && destinationLocation
        ? calculateDistance(driverLocation, destinationLocation)
        : null,
    [driverLocation, destinationLocation]
  );

  const pickupDistanceKm = useMemo(
    () =>
      driverLocation && pickupLocation
        ? calculateDistance(driverLocation, pickupLocation)
        : null,
    [driverLocation, pickupLocation]
  );

  const driverSignalStale = Boolean(
    driverLocation && isLocationStale(lastSignalAt)
  );

  const signalState = !driverLocation
    ? 'pending'
    : driverSignalStale
      ? 'weak'
      : 'live';

  useEffect(() => {
    if (!leaflet || !leafletMapRef.current || !mapReady) return;

    const map = leafletMapRef.current;
    const points: [number, number][] = [];

    const upsertMarker = (
      markerRef: React.MutableRefObject<any>,
      location: GeoPoint | null,
      html: string,
      size: [number, number],
      anchor: [number, number]
    ) => {
      if (!location) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }

      const latLng: [number, number] = [location.latitude, location.longitude];

      if (!markerRef.current) {
        markerRef.current = leaflet
          .marker(latLng, {
            icon: leaflet.divIcon({
              html,
              className: '',
              iconSize: size,
              iconAnchor: anchor
            })
          })
          .addTo(map);
      } else {
        markerRef.current.setLatLng(latLng);
      }

      points.push(latLng);
    };

    upsertMarker(
      pickupMarkerRef,
      pickupLocation,
      markerHtml('PU', '#22c55e'),
      [34, 34],
      [17, 17]
    );

    upsertMarker(
      destinationMarkerRef,
      destinationLocation,
      markerHtml('DO', '#f59e0b'),
      [34, 34],
      [17, 17]
    );

    upsertMarker(
      driverMarkerRef,
      driverLocation,
      driverMarkerHtml,
      [48, 48],
      [24, 24]
    );

    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }

    if (driverLocation && destinationLocation) {
      routeLineRef.current = leaflet
        .polyline(
          [
            [driverLocation.latitude, driverLocation.longitude],
            [destinationLocation.latitude, destinationLocation.longitude]
          ],
          {
            color: '#f59e0b',
            weight: 4,
            opacity: 0.85,
            dashArray: '8 10'
          }
        )
        .addTo(map);
    } else if (pickupLocation && destinationLocation) {
      routeLineRef.current = leaflet
        .polyline(
          [
            [pickupLocation.latitude, pickupLocation.longitude],
            [destinationLocation.latitude, destinationLocation.longitude]
          ],
          {
            color: '#22c55e',
            weight: 3,
            opacity: 0.45,
            dashArray: '6 12'
          }
        )
        .addTo(map);
    }

    if (points.length > 1) {
      map.fitBounds(points, {
        padding: [56, 56],
        maxZoom: 15
      });
    } else if (points.length === 1) {
      map.setView(points[0], 13);
    } else {
      map.setView(CAMEROON_CENTER, 7);
    }

    window.setTimeout(() => {
      map.invalidateSize();
    }, 50);
  }, [leaflet, mapReady, driverLocation, pickupLocation, destinationLocation]);

  if (!delivery) {
    return (
      <div className="flex flex-col items-center justify-center gap-5 py-40">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Loading live delivery...
        </p>
      </div>
    );
  }

  const currentStatus = (
    delivery.status ||
    delivery.deliveryStatus ||
    'pending'
  ) as DeliveryStatus;

  const currentStatusIndex = Math.max(0, statusOrder.indexOf(currentStatus));
  const isDriver = Boolean(user?.uid && delivery.driverId === user.uid);
  const isBuyer = Boolean(user?.uid && delivery.buyerId === user.uid);
  const isSeller = Boolean(user?.uid && delivery.sellerId === user.uid);

  const currencyCode = normalizeCurrencyCode(
    delivery.currencyCode ||
      delivery.currency ||
      delivery.paymentCurrency ||
      'XAF'
  );

  const currencyLocale = delivery.currencyLocale || 'fr-CM';
  const deliveryFee = Number(
    delivery.estimatedFee ??
      delivery.deliveryFee ??
      delivery.fee ??
      0
  );

  const packageValue = Number(delivery.packageValue || 0);
  const hasAnyMapPoint = Boolean(driverLocation || pickupLocation || destinationLocation);

  const nextDriverStatus = (): DeliveryStatus | null => {
    if (currentStatus === 'pending' || currentStatus === 'assigned') return 'accepted';
    if (currentStatus === 'accepted') return 'picked_up';
    if (currentStatus === 'picked_up') return 'in_transit';
    if (currentStatus === 'in_transit') return 'arriving';
    if (currentStatus === 'arriving') return 'delivered';

    return null;
  };

  const nextStatus = nextDriverStatus();

  const nextStatusLabel =
    nextStatus === 'accepted'
      ? 'Accept Delivery'
      : nextStatus === 'picked_up'
        ? 'Mark Picked Up'
        : nextStatus === 'in_transit'
          ? 'Start Transit'
          : nextStatus === 'arriving'
            ? 'Near Destination'
            : nextStatus === 'delivered'
              ? 'Mark Delivered'
              : '';

  const driverTarget =
    currentStatusIndex < statusOrder.indexOf('picked_up')
      ? pickupLocation
      : destinationLocation;

  const driverDirectionsUrl = buildDirectionsUrl(driverTarget, driverLocation);
  const destinationDirectionsUrl = buildDirectionsUrl(destinationLocation, driverLocation);
  const tradeUrl = delivery.tradeId ? `/trade/${delivery.tradeId}` : '';
  const driverUrl = delivery.driverId ? `/drivers/${delivery.driverId}` : '';

  const advanceStatus = async () => {
    if (!id || !user?.uid || !nextStatus) return;

    setActionLoading(true);
    setActionMessage('');
    setActionError('');

    try {
      await updateDeliveryStatus(id, nextStatus, user.uid);
      setActionMessage(`Delivery updated to ${titleStatus(nextStatus)}.`);
    } catch (error) {
      console.error('Delivery status update failed:', error);
      setActionError('Could not update delivery status. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const summaryCards = [
    {
      label: 'Delivery Fee',
      value: deliveryFee > 0 ? formatMoney(deliveryFee, currencyCode, currencyLocale) : 'Pending',
      icon: Wallet
    },
    {
      label: 'ETA',
      value: etaMinutes !== null ? formatETA(etaMinutes) : 'Waiting',
      icon: Clock
    },
    {
      label: 'Distance',
      value: distanceKm !== null ? `${distanceKm.toFixed(1)} km` : 'Waiting',
      icon: Route
    },
    {
      label: 'GPS Signal',
      value:
        signalState === 'live'
          ? 'Live'
          : signalState === 'weak'
            ? 'Weak'
            : 'Pending',
      icon: Radio
    }
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-24">
      <section className="overflow-hidden rounded-[2.5rem] border border-white/5 bg-brand-card shadow-2xl">
        <div className="relative h-[72vh] min-h-[560px]">
          <div ref={mapRef} className="absolute inset-0 bg-black" />

          <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] bg-gradient-to-b from-black/95 to-transparent p-4 md:p-5">
            <div className="pointer-events-auto rounded-[2rem] border border-white/10 bg-black/65 p-5 shadow-2xl backdrop-blur-xl">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <Truck className="h-6 w-6 text-amber-500" />
                    <div className="min-w-0">
                      <h1 className="truncate font-serif text-2xl text-white">
                        Live Delivery Tracking
                      </h1>
                      <p className="mt-1 truncate text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {delivery.pickupAddress || 'Pickup'} to{' '}
                        {delivery.destinationAddress || delivery.dropoffAddress || 'Destination'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-amber-500">
                      {titleStatus(currentStatus)}
                    </span>

                    {delivery.escrowProtected !== false && (
                      <span className="flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-green-400">
                        <ShieldCheck className="h-3 w-3" />
                        Escrow Protected
                      </span>
                    )}

                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-slate-400">
                      Signal {formatAge(lastSignalAt)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {summaryCards.map(item => {
                    const Icon = item.icon;

                    return (
                      <div key={item.label} className="rounded-2xl bg-white/5 px-4 py-3">
                        <Icon className="mb-2 h-4 w-4 text-amber-500" />
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                          {item.label}
                        </p>
                        <p className="mt-1 font-serif text-sm text-white">
                          {item.value}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {(signalState === 'weak' || signalState === 'pending') && hasAnyMapPoint && (
            <div className="absolute inset-x-5 top-44 z-[500] rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                {signalState === 'weak' ? (
                  <WifiOff className="h-5 w-5" />
                ) : (
                  <Radio className="h-5 w-5" />
                )}
                {signalState === 'weak'
                  ? 'Driver GPS signal is stale. Waiting for the next live location update.'
                  : 'Driver GPS has not started yet. Pickup and destination pins remain visible.'}
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] bg-gradient-to-t from-black via-black/85 to-transparent p-4 md:p-5">
            <div className="pointer-events-auto grid gap-4 xl:grid-cols-[1fr_360px]">
              <div className="rounded-[2rem] border border-white/10 bg-black/70 p-5 backdrop-blur-xl">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  {statusSteps.map(step => {
                    const stepIndex = statusOrder.indexOf(step.id);
                    const done =
                      currentStatus === 'completed' ||
                      currentStatusIndex >= stepIndex;
                    const current = currentStatus === step.id;
                    const Icon = step.icon;

                    return (
                      <div key={step.id} className="flex items-start gap-3 lg:block">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${
                            done
                              ? 'border-amber-500 bg-amber-500 text-black'
                              : current
                                ? 'border-amber-500/60 bg-amber-500/10 text-amber-500'
                                : 'border-white/10 bg-white/5 text-slate-600'
                          }`}
                        >
                          {done ? <CheckCircle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                        </div>

                        <div className="mt-0 lg:mt-3">
                          <p className={`text-[9px] font-black uppercase tracking-widest ${done || current ? 'text-white' : 'text-slate-600'}`}>
                            {step.label}
                          </p>
                          <p className="mt-1 text-[9px] leading-relaxed text-slate-600">
                            {step.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-black/70 p-4 backdrop-blur-xl">
                <div className="grid grid-cols-2 gap-2">
                  {tradeUrl && (
                    <Link
                      to={tradeUrl}
                      className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Trade Chat
                    </Link>
                  )}

                  {driverUrl && (
                    <Link
                      to={driverUrl}
                      className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white"
                    >
                      <User className="h-4 w-4" />
                      Driver
                    </Link>
                  )}

                  {delivery.driverPhone && (
                    <a
                      href={`tel:${delivery.driverPhone}`}
                      className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white"
                    >
                      <Phone className="h-4 w-4" />
                      Call
                    </a>
                  )}

                  {destinationDirectionsUrl && (
                    <a
                      href={destinationDirectionsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-green-400"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Map
                    </a>
                  )}
                </div>

                {isDriver && nextStatus && (
                  <button
                    onClick={advanceStatus}
                    disabled={actionLoading}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-[10px] font-black uppercase tracking-widest text-amber-400 disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                    {nextStatusLabel}
                  </button>
                )}

                {isDriver && driverDirectionsUrl && (
                  <a
                    href={driverDirectionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 py-4 text-[10px] font-black uppercase tracking-widest text-black"
                  >
                    <Navigation className="h-4 w-4" />
                    Navigate to Next Stop
                  </a>
                )}

                {(isBuyer || isSeller) && currentStatus === 'delivered' && tradeUrl && (
                  <Link
                    to={tradeUrl}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-widest text-black"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Confirm in Trade
                  </Link>
                )}
              </div>
            </div>
          </div>

          {!hasAnyMapPoint && (
            <div className="absolute inset-0 z-[400] flex items-center justify-center bg-black/65">
              <motion.div
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mx-5 max-w-sm rounded-[2rem] border border-white/10 bg-black/85 p-8 text-center backdrop-blur-xl"
              >
                <MapPin className="mx-auto mb-4 h-10 w-10 text-amber-500" />
                <h2 className="font-serif text-2xl text-white">Waiting for GPS</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">
                  Pickup, dropoff, and driver movement will appear here once delivery tracking starts.
                </p>
              </motion.div>
            </div>
          )}
        </div>
      </section>

      {(actionMessage || actionError) && (
        <div
          className={`flex items-center gap-3 rounded-2xl border p-4 text-sm ${
            actionError
              ? 'border-red-500/20 bg-red-500/10 text-red-300'
              : 'border-green-500/20 bg-green-500/10 text-green-300'
          }`}
        >
          {actionError ? (
            <AlertTriangle className="h-5 w-5 shrink-0" />
          ) : (
            <CheckCircle className="h-5 w-5 shrink-0" />
          )}
          {actionError || actionMessage}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <motion.div
          whileHover={{ y: -2 }}
          className="rounded-2xl border border-white/5 bg-brand-card p-5 shadow-xl"
        >
          <ShieldCheck className="mb-3 h-5 w-5 text-amber-500" />
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
            Escrow Confidence
          </p>
          <p className="mt-1 font-serif text-sm leading-relaxed text-white">
            {delivery.escrowProtected === false ? 'Standard delivery' : 'Protected shipment'}
          </p>
          {packageValue > 0 && (
            <p className="mt-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
              Goods value {formatMoney(packageValue, currencyCode, currencyLocale)}
            </p>
          )}
        </motion.div>

        <motion.div
          whileHover={{ y: -2 }}
          className="rounded-2xl border border-white/5 bg-brand-card p-5 shadow-xl"
        >
          <MapPin className="mb-3 h-5 w-5 text-green-400" />
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
            Pickup
          </p>
          <p className="mt-1 font-serif text-sm leading-relaxed text-white">
            {delivery.pickupAddress || 'Pickup location'}
          </p>
          {pickupDistanceKm !== null && (
            <p className="mt-2 text-[9px] font-black uppercase tracking-widest text-green-400">
              Driver {pickupDistanceKm.toFixed(1)} km from pickup
            </p>
          )}
        </motion.div>

        <motion.div
          whileHover={{ y: -2 }}
          className="rounded-2xl border border-white/5 bg-brand-card p-5 shadow-xl"
        >
          <Navigation className="mb-3 h-5 w-5 text-amber-500" />
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
            Destination
          </p>
          <p className="mt-1 font-serif text-sm leading-relaxed text-white">
            {delivery.destinationAddress || delivery.dropoffAddress || 'Delivery location'}
          </p>
          {formatTime(delivery.deliveredAt) && (
            <p className="mt-2 text-[9px] font-black uppercase tracking-widest text-amber-500">
              Delivered at {formatTime(delivery.deliveredAt)}
            </p>
          )}
        </motion.div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          {
            label: 'Package',
            value: delivery.packageType || 'General goods',
            icon: Package
          },
          {
            label: 'Weight',
            value: delivery.packageWeight ? `${delivery.packageWeight} kg` : 'Not specified',
            icon: Truck
          },
          {
            label: 'Urgency',
            value: titleStatus(delivery.urgency || 'normal'),
            icon: Zap
          },
          {
            label: 'Tracking ID',
            value: String(id || '').slice(-8).toUpperCase(),
            icon: Radio
          }
        ].map(item => {
          const Icon = item.icon;

          return (
            <div key={item.label} className="rounded-2xl border border-white/5 bg-brand-card p-5">
              <Icon className="mb-3 h-5 w-5 text-amber-500" />
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                {item.label}
              </p>
              <p className="mt-1 truncate font-serif text-sm capitalize text-white">
                {item.value}
              </p>
            </div>
          );
        })}
      </section>
    </div>
  );
}
