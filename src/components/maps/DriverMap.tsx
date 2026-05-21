import { useEffect, useMemo } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap
} from 'react-leaflet';
import { Link } from 'react-router-dom';
import {
  MessageCircle,
  Navigation,
  Star,
  Truck,
  User,
  WifiOff
} from 'lucide-react';

import {
  DEFAULT_MAP_CENTER,
  calculateDistance,
  formatDistance,
  isLocationFresh,
  toGeoPoint,
  type GeoPoint
} from '../../utils/geoUtils';

interface DriverMapProps {
  drivers: any[];
  currentLocation?: GeoPoint | null;
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

const driverIcon = (active: boolean) =>
  L.divIcon({
    className: '',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    html: `
      <div style="
        height:48px;
        width:48px;
        border-radius:999px;
        display:flex;
        align-items:center;
        justify-content:center;
        background:${active ? 'rgba(34,197,94,.18)' : 'rgba(245,158,11,.16)'};
        border:1px solid ${active ? 'rgba(34,197,94,.75)' : 'rgba(245,158,11,.65)'};
        box-shadow:0 0 30px ${active ? 'rgba(34,197,94,.4)' : 'rgba(245,158,11,.35)'};
        font-size:22px;
      ">🚚</div>
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
        maxZoom: 14
      }
    );
  }, [map, points]);

  return null;
}

export default function DriverMap({
  drivers,
  currentLocation,
  className = 'h-[420px]'
}: DriverMapProps) {
  const driverPoints = useMemo(
    () =>
      drivers
        .map(driver => ({ driver, point: toGeoPoint(driver) }))
        .filter(item => item.point),
    [drivers]
  );

  const center = currentLocation || driverPoints[0]?.point || DEFAULT_MAP_CENTER;

  const points = [
    ...(currentLocation ? [currentLocation] : []),
    ...driverPoints.map(item => item.point as GeoPoint)
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

        <AutoFit points={points} />

        {driverPoints.map(({ driver, point }: any) => {
          const fresh = isLocationFresh(driver.lastLocationUpdateAt || driver.gpsLastSeenAt);
          const rating = Number(driver.avgDriverRating || driver.averageRating || 0);

          return (
            <Marker
              key={driver.id || driver.uid}
              position={[point.latitude, point.longitude]}
              icon={driverIcon(fresh)}
            >
              <Popup className="hema-map-popup">
                <div className="w-64 p-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={
                        driver.photoURL ||
                        `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.id || driver.uid}`
                      }
                      alt={driver.displayName || driver.name || 'Driver'}
                      className="h-11 w-11 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div>
                      <p className="font-serif text-lg text-white">
                        {driver.displayName || driver.name || 'Driver'}
                      </p>
                      <p className={`text-[9px] font-black uppercase tracking-widest ${fresh ? 'text-green-400' : 'text-amber-400'}`}>
                        {fresh ? 'Live GPS' : 'GPS pending'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-xl bg-white/5 p-2">
                      <Star className="mx-auto h-4 w-4 fill-amber-500 text-amber-500" />
                      <p className="mt-1 text-xs text-white">{rating.toFixed(1)}</p>
                    </div>

                    <div className="rounded-xl bg-white/5 p-2">
                      <Navigation className="mx-auto h-4 w-4 text-green-400" />
                      <p className="mt-1 text-xs text-white">
                        {formatDistance(calculateDistance(currentLocation, point))}
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-slate-400">
                    {driver.vehicleType || 'Vehicle'} • {driver.completedDeliveries || driver.deliveriesCount || 0} deliveries
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Link
                      to={`/drivers/${driver.id || driver.uid}`}
                      className="flex items-center justify-center gap-1 rounded-xl bg-green-500 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-black"
                    >
                      <Truck className="h-3 w-3" />
                      Hire
                    </Link>

                    <Link
                      to={`/profile/${driver.id || driver.uid}`}
                      className="flex items-center justify-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white"
                    >
                      <User className="h-3 w-3" />
                      Profile
                    </Link>

                    <Link
                      to={`/messages/${driver.id || driver.uid}`}
                      className="col-span-2 flex items-center justify-center gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-amber-400"
                    >
                      <MessageCircle className="h-3 w-3" />
                      Message Driver
                    </Link>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <div className="absolute left-4 top-4 z-[500] rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white backdrop-blur-xl">
        <Truck className="mr-1 inline h-3.5 w-3.5 text-green-400" />
        Live Driver Map
      </div>

      {driverPoints.length === 0 && (
        <div className="absolute inset-0 z-[400] flex items-center justify-center bg-black/70">
          <div className="rounded-[2rem] border border-white/10 bg-black/80 p-8 text-center backdrop-blur-xl">
            <WifiOff className="mx-auto mb-4 h-10 w-10 text-amber-500" />
            <p className="font-serif text-xl text-white">No GPS drivers nearby</p>
            <p className="mt-2 text-sm text-slate-500">
              Available drivers will appear once their GPS is active.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
