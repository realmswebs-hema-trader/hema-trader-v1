import { useEffect, useMemo } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap
} from 'react-leaflet';
import {
  Clock,
  Navigation,
  Truck,
  WifiOff
} from 'lucide-react';

import {
  DEFAULT_MAP_CENTER,
  calculateDistance,
  calculateETA,
  formatDistance,
  formatETA,
  isLocationFresh,
  toGeoPoint,
  type GeoPoint
} from '../../utils/geoUtils';

interface DeliveryMapProps {
  delivery: any;
  tracking?: any;
  className?: string;
}

const mapStyles = `
.hema-map-popup .leaflet-popup-content-wrapper {
  background:#09090b;
  color:white;
  border:1px solid rgba(255,255,255,.12);
  border-radius:18px;
  box-shadow:0 25px 80px rgba(0,0,0,.55);
}
.hema-map-popup .leaflet-popup-tip {
  background:#09090b;
}
.hema-map-popup .leaflet-popup-content {
  margin:0;
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
        background:${color}22;
        border:1px solid ${color};
        box-shadow:0 0 28px ${color}66;
        font-size:20px;
      ">${label}</div>
    `
  });

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
        padding: [48, 48],
        maxZoom: 15
      }
    );
  }, [map, points]);

  return null;
}

export default function DeliveryMap({
  delivery,
  tracking,
  className = 'h-[540px]'
}: DeliveryMapProps) {
  const pickupLocation =
    toGeoPoint(delivery?.pickupLocation || delivery?.pickup) ||
    toGeoPoint({
      latitude: delivery?.pickupLatitude,
      longitude: delivery?.pickupLongitude
    });

  const destinationLocation =
    toGeoPoint(delivery?.destinationLocation || delivery?.dropoffLocation || delivery?.deliveryLocation) ||
    toGeoPoint({
      latitude: delivery?.destinationLatitude,
      longitude: delivery?.destinationLongitude
    });

  const driverLocation =
    toGeoPoint(tracking?.driverLocation || delivery?.driverLocation) ||
    toGeoPoint(delivery?.driverCurrentLocation);

  const center =
    driverLocation ||
    destinationLocation ||
    pickupLocation ||
    DEFAULT_MAP_CENTER;

  const points = [
    pickupLocation,
    destinationLocation,
    driverLocation
  ].filter(Boolean) as GeoPoint[];

  const eta = useMemo(
    () => calculateETA(driverLocation, destinationLocation, 28),
    [driverLocation, destinationLocation]
  );

  const distance = useMemo(
    () => calculateDistance(driverLocation, destinationLocation),
    [driverLocation, destinationLocation]
  );

  const gpsFresh = isLocationFresh(
    tracking?.lastUpdatedAt || delivery?.trackingLastUpdatedAt
  );

  return (
    <section className={`relative overflow-hidden rounded-[2rem] border border-white/5 bg-brand-card shadow-2xl ${className}`}>
      <style>{mapStyles}</style>

      <MapContainer
        center={[center.latitude, center.longitude]}
        zoom={13}
        className="h-full w-full bg-black"
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />

        <AutoFit points={points} />

        {pickupLocation && (
          <Marker
            position={[pickupLocation.latitude, pickupLocation.longitude]}
            icon={markerIcon('📦', '#22c55e')}
          >
            <Popup className="hema-map-popup">
              <div className="w-52 p-4">
                <p className="font-serif text-lg text-white">Pickup</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {delivery?.pickupAddress || 'Pickup location'}
                </p>
              </div>
            </Popup>
          </Marker>
        )}

        {destinationLocation && (
          <Marker
            position={[destinationLocation.latitude, destinationLocation.longitude]}
            icon={markerIcon('📍', '#f59e0b')}
          >
            <Popup className="hema-map-popup">
              <div className="w-52 p-4">
                <p className="font-serif text-lg text-white">Destination</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {delivery?.destinationAddress || delivery?.dropoffAddress || 'Delivery destination'}
                </p>
              </div>
            </Popup>
          </Marker>
        )}

        {driverLocation && (
          <Marker
            position={[driverLocation.latitude, driverLocation.longitude]}
            icon={markerIcon('🚚', '#22c55e')}
          >
            <Popup className="hema-map-popup">
              <div className="w-56 p-4">
                <p className="font-serif text-lg text-white">Driver Live Location</p>
                <p className="mt-1 text-xs text-slate-400">
                  {gpsFresh ? 'GPS active' : 'Location signal is weak'}
                </p>
                <p className="mt-3 text-[10px] uppercase tracking-widest text-amber-500">
                  {formatDistance(distance)} • {formatETA(eta)}
                </p>
              </div>
            </Popup>
          </Marker>
        )}

        {driverLocation && destinationLocation && (
          <Polyline
            positions={[
              [driverLocation.latitude, driverLocation.longitude],
              [destinationLocation.latitude, destinationLocation.longitude]
            ]}
            pathOptions={{
              color: '#f59e0b',
              weight: 4,
              opacity: 0.9,
              dashArray: '8 10'
            }}
          />
        )}

        {pickupLocation && destinationLocation && (
          <Polyline
            positions={[
              [pickupLocation.latitude, pickupLocation.longitude],
              [destinationLocation.latitude, destinationLocation.longitude]
            ]}
            pathOptions={{
              color: '#64748b',
              weight: 2,
              opacity: 0.5
            }}
          />
        )}
      </MapContainer>

      <div className="absolute left-4 right-4 top-4 z-[500] rounded-[2rem] border border-white/10 bg-black/70 p-4 backdrop-blur-xl">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <Clock className="mx-auto mb-1 h-4 w-4 text-amber-500" />
            <p className="font-serif text-sm text-white">{formatETA(eta)}</p>
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">ETA</p>
          </div>

          <div>
            <Navigation className="mx-auto mb-1 h-4 w-4 text-green-400" />
            <p className="font-serif text-sm text-white">{formatDistance(distance)}</p>
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Distance</p>
          </div>

          <div>
            <Truck className="mx-auto mb-1 h-4 w-4 text-amber-500" />
            <p className={`font-serif text-sm ${gpsFresh ? 'text-green-400' : 'text-red-400'}`}>
              {gpsFresh ? 'Live' : 'Weak'}
            </p>
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">GPS</p>
          </div>
        </div>
      </div>

      {!driverLocation && (
        <div className="absolute inset-0 z-[400] flex items-center justify-center bg-black/65">
          <div className="rounded-[2rem] border border-white/10 bg-black/80 p-8 text-center backdrop-blur-xl">
            <WifiOff className="mx-auto mb-4 h-10 w-10 text-amber-500" />
            <p className="font-serif text-xl text-white">Location temporarily unavailable</p>
            <p className="mt-2 text-sm text-slate-500">
              Waiting for driver GPS signal.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
