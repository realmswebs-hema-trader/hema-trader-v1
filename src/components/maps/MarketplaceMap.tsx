import { useEffect, useMemo } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap
} from 'react-leaflet';
import { Link } from 'react-router-dom';
import {
  MapPin,
  MessageCircle,
  Navigation,
  ShoppingBag,
  Truck,
  User
} from 'lucide-react';

import {
  DEFAULT_MAP_CENTER,
  calculateDistance,
  formatDistance,
  toGeoPoint,
  type GeoPoint
} from '../../utils/geoUtils';

interface MarketplaceMapProps {
  listings?: any[];
  users?: any[];
  currentLocation?: GeoPoint | null;
  radiusKm?: number;
  className?: string;
  onRequestLocation?: () => void;
}

const mapStyles = `
.hema-map-popup .leaflet-popup-content-wrapper {
  background: #09090b;
  color: white;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 18px;
  box-shadow: 0 25px 80px rgba(0,0,0,.55);
}
.hema-map-popup .leaflet-popup-tip {
  background: #09090b;
}
.hema-map-popup .leaflet-popup-content {
  margin: 0;
}
.leaflet-container {
  font-family: inherit;
}
`;

const markerIcon = (label: string, color = '#f59e0b') =>
  L.divIcon({
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `
      <div style="
        height:44px;
        width:44px;
        border-radius:999px;
        display:flex;
        align-items:center;
        justify-content:center;
        background:${color}26;
        border:1px solid ${color};
        box-shadow:0 0 30px ${color}66;
        font-size:20px;
      ">${label}</div>
    `
  });

const listingIcon = (listing: any) => {
  const text = `${listing.category || ''} ${listing.title || ''}`.toLowerCase();

  if (text.includes('livestock') || text.includes('cow') || text.includes('goat')) {
    return { label: '🐄', color: '#22c55e' };
  }

  if (text.includes('crop') || text.includes('corn') || text.includes('maize')) {
    return { label: '🌽', color: '#f59e0b' };
  }

  return { label: '📦', color: '#38bdf8' };
};

function AutoFit({ points }: { points: GeoPoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;

    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 13);
      return;
    }

    map.fitBounds(
      points.map(point => [point.latitude, point.longitude] as LatLngExpression),
      {
        padding: [44, 44],
        maxZoom: 14
      }
    );
  }, [map, points]);

  return null;
}

export default function MarketplaceMap({
  listings = [],
  users = [],
  currentLocation,
  radiusKm = 50,
  className = 'h-[460px]',
  onRequestLocation
}: MarketplaceMapProps) {
  const listingPoints = useMemo(
    () =>
      listings
        .map(listing => ({ listing, point: toGeoPoint(listing) }))
        .filter(item => item.point),
    [listings]
  );

  const userPoints = useMemo(
    () =>
      users
        .map(user => ({ user, point: toGeoPoint(user) }))
        .filter(item => item.point),
    [users]
  );

  const center =
    currentLocation ||
    listingPoints[0]?.point ||
    userPoints[0]?.point ||
    DEFAULT_MAP_CENTER;

  const allPoints = [
    ...(currentLocation ? [currentLocation] : []),
    ...listingPoints.map(item => item.point as GeoPoint),
    ...userPoints.map(item => item.point as GeoPoint)
  ];

  return (
    <section className={`relative overflow-hidden rounded-[2rem] border border-white/5 bg-brand-card shadow-2xl ${className}`}>
      <style>{mapStyles}</style>

      <MapContainer
        center={[center.latitude, center.longitude]}
        zoom={currentLocation ? 12 : 7}
        className="h-full w-full bg-black"
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />

        <AutoFit points={allPoints} />

        {currentLocation && (
          <>
            <Circle
              center={[currentLocation.latitude, currentLocation.longitude]}
              radius={radiusKm * 1000}
              pathOptions={{
                color: '#f59e0b',
                fillColor: '#f59e0b',
                fillOpacity: 0.06,
                weight: 1
              }}
            />

            <Marker
              position={[currentLocation.latitude, currentLocation.longitude]}
              icon={markerIcon('📍', '#f59e0b')}
            >
              <Popup className="hema-map-popup">
                <div className="w-52 p-4">
                  <p className="font-serif text-lg text-white">Your Location</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    Nearby sellers, buyers, drivers, crops, and livestock appear around you.
                  </p>
                </div>
              </Popup>
            </Marker>
          </>
        )}

        {listingPoints.map(({ listing, point }: any) => {
          const icon = listingIcon(listing);

          return (
            <Marker
              key={listing.id}
              position={[point.latitude, point.longitude]}
              icon={markerIcon(icon.label, icon.color)}
            >
              <Popup className="hema-map-popup">
                <div className="w-64 p-4">
                  <p className="font-serif text-lg text-white">
                    {listing.title || 'Marketplace Listing'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {listing.locationName || listing.location || 'Local marketplace location'}
                  </p>
                  <p className="mt-2 text-sm font-bold text-amber-500">
                    ${(listing.price || 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
                    {formatDistance(calculateDistance(currentLocation, point))}
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Link
                      to={`/listing/${listing.id}`}
                      className="flex items-center justify-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-black"
                    >
                      <ShoppingBag className="h-3 w-3" />
                      View
                    </Link>

                    {listing.ownerId && (
                      <Link
                        to={`/profile/${listing.ownerId}`}
                        className="flex items-center justify-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white"
                      >
                        <User className="h-3 w-3" />
                        Seller
                      </Link>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {userPoints.map(({ user, point }: any) => {
          const isDriver = user.roles?.includes?.('driver');
          const isSeller = user.roles?.includes?.('seller');
          const label = isDriver ? '🚚' : isSeller ? '🟢' : '👤';
          const color = isDriver ? '#22c55e' : isSeller ? '#f59e0b' : '#38bdf8';

          return (
            <Marker
              key={user.id || user.uid}
              position={[point.latitude, point.longitude]}
              icon={markerIcon(label, color)}
            >
              <Popup className="hema-map-popup">
                <div className="w-64 p-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={
                        user.photoURL ||
                        `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id || user.uid}`
                      }
                      alt={user.displayName || user.name || 'Trader'}
                      className="h-11 w-11 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div>
                      <p className="font-serif text-base text-white">
                        {user.displayName || user.name || 'Trader'}
                      </p>
                      <p className="text-[9px] uppercase tracking-widest text-slate-500">
                        Trust {user.trustScore || 50}%
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-slate-400">
                    {formatDistance(calculateDistance(currentLocation, point))}
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Link
                      to={`/profile/${user.id || user.uid}`}
                      className="flex items-center justify-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-black"
                    >
                      <User className="h-3 w-3" />
                      Profile
                    </Link>

                    <Link
                      to={`/messages/${user.id || user.uid}`}
                      className="flex items-center justify-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white"
                    >
                      <MessageCircle className="h-3 w-3" />
                      Message
                    </Link>

                    {isDriver ? (
                      <Link
                        to={`/drivers/${user.id || user.uid}`}
                        className="col-span-2 flex items-center justify-center gap-1 rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-green-400"
                      >
                        <Truck className="h-3 w-3" />
                        Hire Driver
                      </Link>
                    ) : (
                      <Link
                        to={`/?seller=${user.id || user.uid}`}
                        className="col-span-2 flex items-center justify-center gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-amber-400"
                      >
                        <ShoppingBag className="h-3 w-3" />
                        Start Trade
                      </Link>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {!currentLocation && (
        <button
          onClick={onRequestLocation}
          className="absolute left-4 top-4 z-[500] flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white backdrop-blur-xl hover:border-amber-500/40"
        >
          <Navigation className="h-3.5 w-3.5 text-amber-500" />
          Use My Location
        </button>
      )}

      <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-[500] rounded-2xl border border-white/10 bg-black/65 p-4 backdrop-blur-xl">
        <div className="grid grid-cols-3 gap-2 text-center text-[9px] font-black uppercase tracking-widest text-slate-400">
          <span>
            <MapPin className="mr-1 inline h-3 w-3 text-amber-500" />
            Nearby
          </span>
          <span>
            <Truck className="mr-1 inline h-3 w-3 text-green-500" />
            Drivers
          </span>
          <span>
            <ShoppingBag className="mr-1 inline h-3 w-3 text-blue-400" />
            Listings
          </span>
        </div>
      </div>
    </section>
  );
}
