import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, query } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import {
  Loader2,
  MapPin,
  Navigation,
  Search,
  ShieldCheck,
  Star,
  Truck,
  WifiOff
} from 'lucide-react';
import { motion } from 'motion/react';

import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import DriverMap from '../components/maps/DriverMap';
import { toGeoPoint } from '../utils/geoUtils';

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

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const displayName = (driver: Driver) =>
  driver.displayName || driver.name || driver.email || 'Driver';

const displayLocation = (driver: Driver) =>
  driver.location ||
  [driver.city, driver.country].filter(Boolean).join(', ') ||
  (driver.currentLocation?.latitude && driver.currentLocation?.longitude
    ? 'Live GPS location'
    : 'Cameroon');

const isDriver = (driver: Driver) =>
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

export default function Drivers() {
  const { profile } = useAuth();

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const currentLocation = useMemo(() => toGeoPoint(profile), [profile]);

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

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pb-24 pt-8">
      <div className="text-center">
        <h1 className="font-serif text-4xl text-white">Available Drivers</h1>
        <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-500">
          Live GPS delivery agents in the Hema Trader network
        </p>
      </div>

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
    </div>
  );
}
