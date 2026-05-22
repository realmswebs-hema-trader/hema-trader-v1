import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap
} from 'react-leaflet';
import { Link } from 'react-router-dom';
import {
  Compass,
  Loader2,
  MapPin,
  Navigation,
  Package,
  Radio,
  Search,
  ShieldCheck,
  Truck,
  Users,
  WifiOff,
  Zap
} from 'lucide-react';
import { motion } from 'motion/react';
import 'leaflet/dist/leaflet.css';

import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';

interface GeoPoint {
  latitude: number;
  longitude: number;
}

interface UserProfile {
  id: string;
  uid?: string;
  displayName?: string;
  name?: string;
  email?: string;
  photoURL?: string;
  roles?: string[];
  isOnline?: boolean;
  online?: boolean;
  driverStatus?: string;
  availability?: string;
  currentLocation?: Partial<GeoPoint>;
  locationCoordinates?: Partial<GeoPoint>;
  locationPoint?: Partial<GeoPoint>;
  latitude?: number;
  longitude?: number;
  location?: string;
  city?: string;
  country?: string;
  vehicleType?: string;
  vehicleSize?: string;
  averageRating?: number;
  avgDriverRating?: number;
  trustScore?: number;
  verificationStatus?: string;
  deliveriesCount?: number;
  totalTrades?: number;
  lastActiveAt?: any;
}

interface Listing {
  id: string;
  title?: string;
  category?: string;
  price?: number;
  location?: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  currentLocation?: Partial<GeoPoint>;
  locationCoordinates?: Partial<GeoPoint>;
  locationPoint?: Partial<GeoPoint>;
  pickupLocation?: Partial<GeoPoint>;
  images?: string[];
  ownerId?: string;
  sellerId?: string;
  userId?: string;
  status?: string;
  isBoosted?: boolean;
}

interface DriverLocation {
  id: string;
  driverId?: string;
  userId?: string;
  uid?: string;
  latitude?: number;
  longitude?: number;
  currentLocation?: Partial<GeoPoint>;
  heading?: number;
  speed?: number;
  deliveryId?: string;
  updatedAt?: any;
}

interface MapPoint {
  id: string;
  type: 'driver' | 'listing' | 'trader' | 'me';
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  avatar?: string;
  actionUrl?: string;
  rating?: number;
  trustScore?: number;
  active?: boolean;
  meta?: string;
}

const CAMEROON_CENTER: [number, number] = [3.848, 11.502];

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPoint = (value: any): GeoPoint | null => {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return { latitude, longitude };
};

const getUserPoint = (profile: UserProfile | null | undefined) => {
  if (!profile) return null;

  return (
    toPoint(profile.currentLocation) ||
    toPoint(profile.locationCoordinates) ||
    toPoint(profile.locationPoint) ||
    toPoint(profile)
  );
};

const getListingPoint = (
  listing: Listing,
  owner?: UserProfile
): GeoPoint | null =>
  toPoint(listing) ||
  toPoint(listing.currentLocation) ||
  toPoint(listing.locationCoordinates) ||
  toPoint(listing.locationPoint) ||
  toPoint(listing.pickupLocation) ||
  getUserPoint(owner);

const calculateDistance = (from: GeoPoint, to: GeoPoint) => {
  const earthRadiusKm = 6371;
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
      Math.sin(dLon / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatDistance = (distanceKm: number) =>
  distanceKm < 1
    ? `${Math.round(distanceKm * 1000)} m`
    : `${distanceKm.toFixed(1)} km`;

const displayName = (profile: UserProfile) =>
  profile.displayName || profile.name || profile.email || 'Hema Trader';

const displayLocation = (profile: UserProfile) =>
  profile.location ||
  [profile.city, profile.country].filter(Boolean).join(', ') ||
  'Cameroon';

const normalizeRoles = (roles: unknown): string[] =>
  Array.isArray(roles) ? roles.filter(role => typeof role === 'string') : [];

const isActive = (profile: UserProfile) => {
  if (profile.isOnline || profile.online) return true;

  const lastActive = getMillis(profile.lastActiveAt);
  return lastActive > 0 && Date.now() - lastActive < 15 * 60 * 1000;
};

const isDriverProfile = (profile: UserProfile) => {
  const roles = normalizeRoles(profile.roles);

  return (
    roles.includes('driver') ||
    Boolean(profile.driverStatus || profile.availability)
  );
};

const isTraderProfile = (profile: UserProfile) => {
  const roles = normalizeRoles(profile.roles);

  return roles.includes('seller') || roles.includes('buyer');
};

const createMarkerIcon = (type: MapPoint['type'], active = false) => {
  const palette = {
    me: ['#f59e0b', '#111827', 'ME'],
    driver: ['#22c55e', '#052e16', 'DR'],
    listing: ['#f59e0b', '#451a03', 'PK'],
    trader: ['#38bdf8', '#082f49', 'TR']
  }[type];

  return L.divIcon({
    className: '',
    html: `
      <div style="
        position: relative;
        width: 42px;
        height: 42px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        color: white;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: 0.08em;
        background: ${palette[1]};
        border: 2px solid ${palette[0]};
        box-shadow: 0 0 0 6px ${palette[0]}22, 0 0 28px ${palette[0]}66;
      ">
        ${
          active
            ? `<span style="position:absolute; inset:-8px; border-radius:999px; border:1px solid ${palette[0]}; animation:pulse 1.6s infinite;"></span>`
            : ''
        }
        ${palette[2]}
      </div>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -18]
  });
};

function MapFlyTo({ center }: { center: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(center, 12, { duration: 0.8 });
  }, [center, map]);

  return null;
}

export default function MapView() {
  const { user, profile } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [driverLocations, setDriverLocations] = useState<DriverLocation[]>([]);
  const [browserLocation, setBrowserLocation] = useState<GeoPoint | null>(null);
  const [locationError, setLocationError] = useState('');
  const [search, setSearch] = useState('');
  const [activeLayer, setActiveLayer] = useState<
    'all' | 'drivers' | 'listings' | 'traders'
  >('all');
  const [radiusKm, setRadiusKm] = useState<number | null>(50);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let usersReady = false;
    let listingsReady = false;
    let locationsReady = false;

    const finishLoading = () => {
      if (usersReady && listingsReady && locationsReady) {
        setLoading(false);
      }
    };

    const unsubscribeUsers = onSnapshot(
      query(collection(db, 'users'), limit(300)),
      snap => {
        setUsers(
          snap.docs.map(
            item => ({ id: item.id, ...item.data() }) as UserProfile
          )
        );
        usersReady = true;
        finishLoading();
      },
      error => {
        console.error('Users map sync failed:', error);
        usersReady = true;
        finishLoading();
      }
    );

    const unsubscribeListings = onSnapshot(
      query(collection(db, 'listings'), limit(300)),
      snap => {
        setListings(
          snap.docs.map(item => ({ id: item.id, ...item.data() }) as Listing)
        );
        listingsReady = true;
        finishLoading();
      },
      error => {
        console.error('Listings map sync failed:', error);
        listingsReady = true;
        finishLoading();
      }
    );

    const unsubscribeDriverLocations = onSnapshot(
      query(collection(db, 'driverLocations'), limit(300)),
      snap => {
        setDriverLocations(
          snap.docs.map(
            item => ({ id: item.id, ...item.data() }) as DriverLocation
          )
        );
        locationsReady = true;
        finishLoading();
      },
      error => {
        console.error('Driver location map sync failed:', error);
        locationsReady = true;
        finishLoading();
      }
    );

    return () => {
      unsubscribeUsers();
      unsubscribeListings();
      unsubscribeDriverLocations();
    };
  }, []);

  const userMap = useMemo(() => {
    const next = new Map<string, UserProfile>();

    users.forEach(profileItem => {
      next.set(profileItem.id, profileItem);

      if (profileItem.uid) {
        next.set(profileItem.uid, profileItem);
      }
    });

    return next;
  }, [users]);

  const driverLocationMap = useMemo(() => {
    const next = new Map<string, DriverLocation>();

    driverLocations.forEach(location => {
      const point = toPoint(location) || toPoint(location.currentLocation);
      const ids = [location.driverId, location.userId, location.uid, location.id]
        .filter(Boolean) as string[];

      if (!point) return;

      ids.forEach(id => next.set(id, location));
    });

    return next;
  }, [driverLocations]);

  const currentUserPoint = useMemo(() => {
    if (browserLocation) return browserLocation;

    return getUserPoint(profile as UserProfile | null);
  }, [browserLocation, profile]);

  const requestLocation = async () => {
    if (!navigator.geolocation) {
      setLocationError('Location is unavailable on this device.');
      return;
    }

    setLocationError('');

    navigator.geolocation.getCurrentPosition(
      async position => {
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };

        setBrowserLocation(nextLocation);

        if (user) {
          await setDoc(
            doc(db, 'users', user.uid),
            {
              latitude: nextLocation.latitude,
              longitude: nextLocation.longitude,
              currentLocation: nextLocation,
              locationUpdatedAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            },
            { merge: true }
          );
        }
      },
      error => {
        console.error('Map location permission failed:', error);
        setLocationError(
          'Location unavailable. Allow GPS from your browser address bar.'
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000
      }
    );
  };

  const mapPoints = useMemo(() => {
    const points: MapPoint[] = [];

    users.forEach(profileItem => {
      const roles = normalizeRoles(profileItem.roles);
      const driverLocation =
        driverLocationMap.get(profileItem.id) ||
        driverLocationMap.get(profileItem.uid || '');

      const liveDriverPoint =
        toPoint(driverLocation) || toPoint(driverLocation?.currentLocation);

      const profilePoint = liveDriverPoint || getUserPoint(profileItem);

      if (!profilePoint) return;

      if (isDriverProfile(profileItem)) {
        points.push({
          id: profileItem.id,
          type: 'driver',
          title: displayName(profileItem),
          subtitle: `${profileItem.vehicleType || 'Vehicle'} - ${displayLocation(profileItem)}`,
          latitude: profilePoint.latitude,
          longitude: profilePoint.longitude,
          avatar: profileItem.photoURL,
          actionUrl: `/drivers/${profileItem.id}`,
          rating: safeNumber(
            profileItem.avgDriverRating || profileItem.averageRating
          ),
          trustScore: safeNumber(profileItem.trustScore, 100),
          active: isActive(profileItem) || profileItem.driverStatus === 'available',
          meta: profileItem.driverStatus || profileItem.availability || 'available'
        });

        return;
      }

      if (isTraderProfile(profileItem)) {
        points.push({
          id: profileItem.id,
          type: 'trader',
          title: displayName(profileItem),
          subtitle: `${roles.join(', ') || 'trader'} - ${displayLocation(profileItem)}`,
          latitude: profilePoint.latitude,
          longitude: profilePoint.longitude,
          avatar: profileItem.photoURL,
          actionUrl: `/profile/${profileItem.id}`,
          rating: safeNumber(profileItem.averageRating),
          trustScore: safeNumber(profileItem.trustScore, 100),
          active: isActive(profileItem),
          meta: profileItem.verificationStatus || 'community trader'
        });
      }
    });

    listings
      .filter(listing => !listing.status || listing.status === 'active')
      .forEach(listing => {
        const owner =
          userMap.get(listing.ownerId || '') ||
          userMap.get(listing.sellerId || '') ||
          userMap.get(listing.userId || '');

        const listingPoint = getListingPoint(listing, owner);

        if (!listingPoint) return;

        points.push({
          id: listing.id,
          type: 'listing',
          title: listing.title || 'Marketplace Listing',
          subtitle: `${listing.category || 'Listing'} - ${
            listing.locationName ||
            listing.location ||
            (owner ? displayLocation(owner) : 'Cameroon')
          }`,
          latitude: listingPoint.latitude,
          longitude: listingPoint.longitude,
          avatar: listing.images?.[0],
          actionUrl: `/listing/${listing.id}`,
          active: Boolean(listing.isBoosted),
          meta: `${safeNumber(listing.price).toLocaleString()} CFA`
        });
      });

    if (currentUserPoint) {
      points.push({
        id: 'me',
        type: 'me',
        title: 'Your Location',
        subtitle: 'Current marketplace position',
        latitude: currentUserPoint.latitude,
        longitude: currentUserPoint.longitude,
        active: true,
        meta: 'GPS active'
      });
    }

    return points;
  }, [users, listings, currentUserPoint, driverLocationMap, userMap]);

  const filteredPoints = useMemo(() => {
    const term = search.trim().toLowerCase();

    const layerType =
      activeLayer === 'drivers'
        ? 'driver'
        : activeLayer === 'listings'
          ? 'listing'
          : activeLayer === 'traders'
            ? 'trader'
            : 'all';

    return mapPoints
      .filter(point => layerType === 'all' || point.type === layerType)
      .filter(point => {
        if (!term) return true;

        return [point.title, point.subtitle, point.meta]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(term);
      })
      .filter(point => {
        if (!currentUserPoint || !radiusKm || point.type === 'me') return true;

        return calculateDistance(currentUserPoint, point) <= radiusKm;
      });
  }, [mapPoints, activeLayer, search, currentUserPoint, radiusKm]);

  const emptyMessage =
    activeLayer === 'drivers'
      ? 'No GPS drivers found. Ask drivers to turn on Available mode.'
      : activeLayer === 'listings'
        ? 'No geotagged listings found yet. Listings need GPS or seller location.'
        : activeLayer === 'traders'
          ? 'No nearby trader GPS signals found yet.'
          : 'Try allowing GPS, changing the radius, or clearing your search.';

  const center: [number, number] = currentUserPoint
    ? [currentUserPoint.latitude, currentUserPoint.longitude]
    : CAMEROON_CENTER;

  const stats = {
    drivers: mapPoints.filter(point => point.type === 'driver').length,
    listings: mapPoints.filter(point => point.type === 'listing').length,
    traders: mapPoints.filter(point => point.type === 'trader').length,
    live: mapPoints.filter(point => point.active).length
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 pb-24 pt-8">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-brand-card shadow-2xl">
        <div className="relative overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/40 p-6 md:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.2),transparent_35%)]" />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-black">
                <Compass className="h-6 w-6" />
              </div>
              <h1 className="font-serif text-4xl text-white md:text-5xl">
                Hema Geo Network
              </h1>
              <p className="mt-3 max-w-2xl text-[10px] font-black uppercase tracking-widest text-slate-500">
                Live sellers, buyers, drivers, listings, and delivery intelligence on one marketplace map
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={requestLocation}
                className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black shadow-xl"
              >
                <Navigation className="h-4 w-4" />
                Use My GPS
              </button>

              <Link
                to="/drivers"
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10"
              >
                <Truck className="h-4 w-4" />
                Driver Network
              </Link>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Truck, label: 'Live Drivers', value: stats.drivers },
            { icon: Package, label: 'Geo Listings', value: stats.listings },
            { icon: Users, label: 'Nearby Traders', value: stats.traders },
            { icon: Radio, label: 'Active Signals', value: stats.live }
          ].map(item => (
            <div key={item.label} className="rounded-2xl border border-white/5 bg-black/30 p-5">
              <item.icon className="h-5 w-5 text-amber-500" />
              <p className="mt-4 text-[9px] font-black uppercase tracking-widest text-slate-500">
                {item.label}
              </p>
              <p className="mt-2 font-serif text-3xl text-white">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-brand-card p-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search city, village, product, driver, or trader"
                className="w-full rounded-xl border border-white/10 bg-black/40 py-3 pl-11 pr-4 text-sm text-white outline-none focus:border-amber-500/50"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto">
              {[
                { key: 'all', label: 'All' },
                { key: 'drivers', label: 'Drivers' },
                { key: 'listings', label: 'Listings' },
                { key: 'traders', label: 'Traders' }
              ].map(layer => (
                <button
                  key={layer.key}
                  onClick={() => setActiveLayer(layer.key as any)}
                  className={`rounded-xl px-4 py-3 text-[9px] font-black uppercase tracking-widest ${
                    activeLayer === layer.key
                      ? 'bg-amber-500 text-black'
                      : 'border border-white/10 bg-white/5 text-slate-400'
                  }`}
                >
                  {layer.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-2xl">
            {loading && (
              <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/70">
                <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
              </div>
            )}

            <MapContainer
              center={center}
              zoom={currentUserPoint ? 12 : 7}
              scrollWheelZoom
              className="h-[68vh] min-h-[520px] w-full"
            >
              <MapFlyTo center={center} />

              <TileLayer
                attribution="OpenStreetMap contributors, CARTO"
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />

              {filteredPoints.map(point => {
                const distance =
                  currentUserPoint && point.type !== 'me'
                    ? calculateDistance(currentUserPoint, point)
                    : null;

                return (
                  <Marker
                    key={`${point.type}-${point.id}`}
                    position={[point.latitude, point.longitude]}
                    icon={createMarkerIcon(point.type, point.active)}
                  >
                    <Popup>
                      <div className="w-56 space-y-3 text-slate-900">
                        <div className="flex items-center gap-3">
                          {point.avatar ? (
                            <img
                              src={point.avatar}
                              alt={point.title}
                              className="h-12 w-12 rounded-xl object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-xs font-black text-amber-500">
                              {point.type.toUpperCase().slice(0, 2)}
                            </div>
                          )}

                          <div className="min-w-0">
                            <p className="truncate text-sm font-black">{point.title}</p>
                            <p className="truncate text-[10px] uppercase tracking-wider text-slate-500">
                              {point.subtitle}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-wider">
                          <div className="rounded-lg bg-slate-100 p-2">
                            Rating
                            <span className="mt-1 block text-sm text-slate-950">
                              {point.rating ? point.rating.toFixed(1) : '-'}
                            </span>
                          </div>
                          <div className="rounded-lg bg-slate-100 p-2">
                            Distance
                            <span className="mt-1 block text-sm text-slate-950">
                              {distance !== null ? formatDistance(distance) : '-'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 rounded-lg bg-amber-100 p-2 text-[10px] font-black uppercase tracking-wider text-amber-800">
                          <ShieldCheck className="h-3 w-3" />
                          {point.meta || 'verified network point'}
                        </div>

                        {point.actionUrl && (
                          <Link
                            to={point.actionUrl}
                            className="block rounded-lg bg-slate-950 py-2 text-center text-[10px] font-black uppercase tracking-widest text-white"
                          >
                            Open
                          </Link>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>

            {filteredPoints.length === 0 && !loading && (
              <div className="absolute left-1/2 top-1/2 z-[900] w-[90%] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/10 bg-black/80 p-8 text-center backdrop-blur-xl">
                <WifiOff className="mx-auto h-10 w-10 text-amber-500" />
                <h3 className="mt-4 font-serif text-2xl text-white">No map signals found</h3>
                <p className="mt-2 text-sm text-slate-500">
                  {emptyMessage}
                </p>
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-brand-card p-5">
            <h2 className="font-serif text-2xl text-white">Location Filters</h2>
            <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
              Discover commerce around you
            </p>

            <div className="mt-5 grid gap-2">
              {[
                { label: 'Within 5 km', value: 5 },
                { label: 'Within 10 km', value: 10 },
                { label: 'Within 50 km', value: 50 },
                { label: 'All Cameroon', value: null }
              ].map(option => (
                <button
                  key={option.label}
                  onClick={() => setRadiusKm(option.value)}
                  className={`rounded-xl px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest ${
                    radiusKm === option.value
                      ? 'bg-amber-500 text-black'
                      : 'border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <motion.div
            whileHover={{ y: -3 }}
            className="rounded-2xl border border-green-500/20 bg-green-500/10 p-5"
          >
            <Zap className="h-6 w-6 text-green-400" />
            <h3 className="mt-4 font-serif text-xl text-white">Live Logistics Layer</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Driver GPS, marketplace listings, and trader locations update in real time as Firestore changes.
            </p>
          </motion.div>

          {locationError && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 text-sm text-amber-300">
              <MapPin className="mb-3 h-5 w-5" />
              {locationError}
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
