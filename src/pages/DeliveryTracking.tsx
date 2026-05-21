import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { Link, useParams } from 'react-router-dom';
import {
  CheckCircle,
  Clock,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  ShieldCheck,
  Truck,
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

const statusSteps: Array<{ id: DeliveryStatus; label: string }> = [
  { id: 'accepted', label: 'Driver accepted' },
  { id: 'picked_up', label: 'Goods picked up' },
  { id: 'in_transit', label: 'In transit' },
  { id: 'arriving', label: 'Near destination' },
  { id: 'delivered', label: 'Delivered' }
];

const statusOrder: DeliveryStatus[] = [
  'pending',
  'accepted',
  'assigned',
  'picked_up',
  'in_transit',
  'arriving',
  'delivered',
  'completed'
];

const getLocation = (value: any) => {
  if (!value) return null;

  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return { latitude, longitude };
};

const vehicleMarkerHtml = `
  <div style="
    width: 46px;
    height: 46px;
    border-radius: 999px;
    background: rgba(245,158,11,.18);
    border: 1px solid rgba(245,158,11,.65);
    box-shadow: 0 0 30px rgba(245,158,11,.45);
    display:flex;
    align-items:center;
    justify-content:center;
  ">
    <div style="
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: #f59e0b;
      color: #050505;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:16px;
      font-weight:900;
    ">🚚</div>
  </div>
`;

const pinHtml = (color: string) => `
  <div style="
    width: 22px;
    height: 22px;
    border-radius:999px;
    background:${color};
    border:3px solid white;
    box-shadow:0 0 18px ${color};
  "></div>
`;

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

  const driverLocation = getLocation(
    tracking?.driverLocation || delivery?.driverLocation
  );
  const pickupLocation = getLocation(
    delivery?.pickupLocation || delivery?.pickup
  );
  const destinationLocation = getLocation(
    delivery?.destinationLocation ||
      delivery?.dropoffLocation ||
      delivery?.deliveryLocation
  );

  const etaMinutes = useMemo(
    () => calculateETA(driverLocation, destinationLocation, tracking?.driverLocation?.speed),
    [driverLocation, destinationLocation, tracking?.driverLocation?.speed]
  );

  const distanceKm = useMemo(
    () => calculateDistance(driverLocation, destinationLocation),
    [driverLocation, destinationLocation]
  );

  const locationUnavailable = isLocationStale(
    tracking?.lastUpdatedAt || delivery?.trackingLastUpdatedAt
  );

  useEffect(() => {
    if (!leaflet || !mapRef.current || leafletMapRef.current) return;

    leafletMapRef.current = leaflet.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false
    });

    leaflet
      .tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
      })
      .addTo(leafletMapRef.current);

    leaflet.control.zoom({ position: 'bottomright' }).addTo(leafletMapRef.current);
    setMapReady(true);
  }, [leaflet]);

  useEffect(() => {
    if (!leaflet || !leafletMapRef.current || !mapReady) return;

    const map = leafletMapRef.current;
    const points: any[] = [];

    if (pickupLocation) {
      const latLng = [pickupLocation.latitude, pickupLocation.longitude];

      if (!pickupMarkerRef.current) {
        pickupMarkerRef.current = leaflet
          .marker(latLng, {
            icon: leaflet.divIcon({
              html: pinHtml('#22c55e'),
              className: '',
              iconSize: [22, 22]
            })
          })
          .addTo(map);
      } else {
        pickupMarkerRef.current.setLatLng(latLng);
      }

      points.push(latLng);
    }

    if (destinationLocation) {
      const latLng = [destinationLocation.latitude, destinationLocation.longitude];

      if (!destinationMarkerRef.current) {
        destinationMarkerRef.current = leaflet
          .marker(latLng, {
            icon: leaflet.divIcon({
              html: pinHtml('#f59e0b'),
              className: '',
              iconSize: [22, 22]
            })
          })
          .addTo(map);
      } else {
        destinationMarkerRef.current.setLatLng(latLng);
      }

      points.push(latLng);
    }

    if (driverLocation) {
      const latLng = [driverLocation.latitude, driverLocation.longitude];

      if (!driverMarkerRef.current) {
        driverMarkerRef.current = leaflet
          .marker(latLng, {
            icon: leaflet.divIcon({
              html: vehicleMarkerHtml,
              className: '',
              iconSize: [46, 46],
              iconAnchor: [23, 23]
            })
          })
          .addTo(map);
      } else {
        driverMarkerRef.current.setLatLng(latLng);
      }

      points.push(latLng);
    }

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
    }

    if (points.length > 0) {
      map.fitBounds(points, {
        padding: [48, 48],
        maxZoom: 15
      });
    }
  }, [leaflet, mapReady, driverLocation, pickupLocation, destinationLocation]);

  const currentStatus = (delivery?.status || 'pending') as DeliveryStatus;
  const currentStatusIndex = statusOrder.indexOf(currentStatus);

  const isDriver = user?.uid && delivery?.driverId === user.uid;

  const nextDriverStatus = () => {
    if (currentStatus === 'accepted' || currentStatus === 'assigned') return 'picked_up';
    if (currentStatus === 'picked_up') return 'in_transit';
    if (currentStatus === 'in_transit') return 'arriving';
    if (currentStatus === 'arriving') return 'delivered';
    return null;
  };

  const advanceStatus = async () => {
    if (!id || !user?.uid) return;

    const next = nextDriverStatus();
    if (!next) return;

    await updateDeliveryStatus(id, next, user.uid);
  };

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

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-24">
      <section className="overflow-hidden rounded-[2.5rem] border border-white/5 bg-brand-card shadow-2xl">
        <div className="relative h-[70vh] min-h-[520px]">
          <div ref={mapRef} className="absolute inset-0 bg-black" />

          <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] bg-gradient-to-b from-black/90 to-transparent p-5">
            <div className="pointer-events-auto rounded-[2rem] border border-white/10 bg-black/60 p-5 shadow-2xl backdrop-blur-xl">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <Truck className="h-6 w-6 text-amber-500" />
                    <h1 className="font-serif text-2xl text-white">
                      Live Delivery Tracking
                    </h1>
                  </div>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {delivery.pickupAddress || 'Pickup'} to {delivery.destinationAddress || delivery.dropoffAddress || 'Destination'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-2xl bg-white/5 px-4 py-3">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                      ETA
                    </p>
                    <p className="font-serif text-sm text-white">{formatETA(etaMinutes)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                      Distance
                    </p>
                    <p className="font-serif text-sm text-white">{distanceKm.toFixed(1)} km</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                      Status
                    </p>
                    <p className="font-serif text-sm capitalize text-white">
                      {currentStatus.replace('_', ' ')}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/5 px-4 py-3">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                      GPS
                    </p>
                    <p className={`font-serif text-sm ${locationUnavailable ? 'text-red-400' : 'text-green-400'}`}>
                      {locationUnavailable ? 'Weak signal' : 'Live'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {locationUnavailable && (
            <div className="absolute inset-x-5 top-40 z-[500] rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <WifiOff className="h-5 w-5" />
                Location temporarily unavailable. Waiting for the driver GPS signal.
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] bg-gradient-to-t from-black via-black/80 to-transparent p-5">
            <div className="pointer-events-auto grid gap-4 lg:grid-cols-[1fr_auto]">
              <div className="rounded-[2rem] border border-white/10 bg-black/65 p-5 backdrop-blur-xl">
                <div className="grid gap-3 sm:grid-cols-5">
                  {statusSteps.map(step => {
                    const done = currentStatusIndex >= statusOrder.indexOf(step.id);

                    return (
                      <div key={step.id} className="flex items-center gap-3 sm:flex-col sm:items-start">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                            done
                              ? 'border-amber-500 bg-amber-500 text-black'
                              : 'border-white/10 bg-white/5 text-slate-600'
                          }`}
                        >
                          {done ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                        </div>
                        <p className={`text-[9px] font-black uppercase tracking-widest ${done ? 'text-white' : 'text-slate-600'}`}>
                          {step.label}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 rounded-[2rem] border border-white/10 bg-black/65 p-4 backdrop-blur-xl">
                {delivery.driverId && (
                  <Link
                    to={`/messages/${delivery.driverId}`}
                    className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Message
                  </Link>
                )}

                {delivery.driverPhone && (
                  <a
                    href={`tel:${delivery.driverPhone}`}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white"
                  >
                    <Phone className="h-4 w-4" />
                    Call
                  </a>
                )}

                {destinationLocation && (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${destinationLocation.latitude},${destinationLocation.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-green-400"
                  >
                    <Navigation className="h-4 w-4" />
                    Navigate
                  </a>
                )}

                {isDriver && nextDriverStatus() && (
                  <button
                    onClick={advanceStatus}
                    className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-amber-400"
                  >
                    <Zap className="h-4 w-4" />
                    Mark {nextDriverStatus()?.replace('_', ' ')}
                  </button>
                )}
              </div>
            </div>
          </div>

          {!driverLocation && (
            <div className="absolute inset-0 z-[400] flex items-center justify-center bg-black/60">
              <motion.div
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mx-5 max-w-sm rounded-[2rem] border border-white/10 bg-black/80 p-8 text-center backdrop-blur-xl"
              >
                <MapPin className="mx-auto mb-4 h-10 w-10 text-amber-500" />
                <h2 className="font-serif text-2xl text-white">Waiting for GPS</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">
                  Driver movement will appear here once live tracking starts.
                </p>
              </motion.div>
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          {
            label: 'Escrow Confidence',
            value: delivery.escrowProtected === false ? 'Standard' : 'Protected',
            icon: ShieldCheck
          },
          {
            label: 'Pickup',
            value: delivery.pickupAddress || 'Pickup location',
            icon: MapPin
          },
          {
            label: 'Destination',
            value: delivery.destinationAddress || delivery.dropoffAddress || 'Delivery location',
            icon: Navigation
          }
        ].map(item => (
          <div key={item.label} className="rounded-2xl border border-white/5 bg-brand-card p-5 shadow-xl">
            <item.icon className="mb-3 h-5 w-5 text-amber-500" />
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
              {item.label}
            </p>
            <p className="mt-1 font-serif text-sm leading-relaxed text-white">
              {item.value}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
