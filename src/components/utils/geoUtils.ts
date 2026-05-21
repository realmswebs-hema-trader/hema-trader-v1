export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export const DEFAULT_MAP_CENTER: GeoPoint = {
  latitude: 5.9631,
  longitude: 10.1591
};

const toRadians = (value: number) => (value * Math.PI) / 180;

export const toGeoPoint = (value: any): GeoPoint | null => {
  if (!value) return null;

  const source = value.currentLocation || value.locationPoint || value;

  const latitude = Number(source.latitude ?? source.lat);
  const longitude = Number(source.longitude ?? source.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return { latitude, longitude };
};

export const calculateDistance = (
  from?: GeoPoint | null,
  to?: GeoPoint | null
) => {
  if (!from || !to) return 0;

  const earthRadiusKm = 6371;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const formatDistance = (distanceKm: number) => {
  if (!distanceKm) return 'Nearby';
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)}m away`;
  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)}km away`;
};

export const calculateETA = (
  from?: GeoPoint | null,
  to?: GeoPoint | null,
  speedKph = 28
) => {
  const distanceKm = calculateDistance(from, to);
  if (!distanceKm) return 0;

  return Math.max(Math.round((distanceKm / speedKph) * 60), 1);
};

export const formatETA = (minutes: number) => {
  if (!minutes) return 'Calculating ETA';
  if (minutes < 2) return 'Arriving now';
  if (minutes < 60) return `${minutes} mins`;

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
};

export const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export const isLocationFresh = (value: any, staleMs = 120000) => {
  const millis = getMillis(value);
  return Boolean(millis && Date.now() - millis < staleMs);
};

export const filterWithinDistance = <T extends Record<string, any>>(
  items: T[],
  origin?: GeoPoint | null,
  maxDistanceKm = 50
) => {
  if (!origin) return items;

  return items.filter(item => {
    const point = toGeoPoint(item);
    return point ? calculateDistance(origin, point) <= maxDistanceKm : false;
  });
};

export const sortByDistance = <T extends Record<string, any>>(
  items: T[],
  origin?: GeoPoint | null
) => {
  if (!origin) return items;

  return [...items].sort((a, b) => {
    const aDistance = calculateDistance(origin, toGeoPoint(a));
    const bDistance = calculateDistance(origin, toGeoPoint(b));

    return aDistance - bDistance;
  });
};

export const requestBrowserLocation = () =>
  new Promise<GeoPoint>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported on this device.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      reject,
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000
      }
    );
  });
