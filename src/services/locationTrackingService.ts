import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

import { db } from '../lib/firebase';

export type DeliveryStatus =
  | 'pending'
  | 'accepted'
  | 'assigned'
  | 'picked_up'
  | 'in_transit'
  | 'arriving'
  | 'delivered'
  | 'completed';

export interface GeoPointLike {
  latitude: number;
  longitude: number;
}

export interface DriverLocation extends GeoPointLike {
  driverId: string;
  heading?: number | null;
  speed?: number | null;
  deliveryId?: string | null;
  updatedAt?: any;
}

interface StartTrackingOptions {
  driverId: string;
  deliveryId?: string;
  driverStatus?: 'available' | 'on_trip';
  minDistanceMeters?: number;
  onError?: (error: GeolocationPositionError) => void;
}

const activeWatchers = new Map<string, number>();
const lastPositions = new Map<string, GeoPointLike>();

const toRadians = (value: number) => (value * Math.PI) / 180;

export const calculateDistance = (from?: GeoPointLike | null, to?: GeoPointLike | null) => {
  if (!from || !to) return 0;

  const earthRadiusKm = 6371;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const calculateETA = (
  from?: GeoPointLike | null,
  to?: GeoPointLike | null,
  speedMetersPerSecond?: number | null
) => {
  const distanceKm = calculateDistance(from, to);
  const speedKph = speedMetersPerSecond && speedMetersPerSecond > 1
    ? speedMetersPerSecond * 3.6
    : 28;

  if (!distanceKm) return 0;

  return Math.max(Math.round((distanceKm / speedKph) * 60), 1);
};

export const formatETA = (minutes: number) => {
  if (!minutes) return 'Calculating arrival';
  if (minutes < 2) return 'Driver arriving now';
  if (minutes < 60) return `Driver arriving in ${minutes} mins`;

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  return remaining ? `Driver arriving in ${hours}h ${remaining}m` : `Driver arriving in ${hours}h`;
};

export const isLocationStale = (updatedAt: any, staleMs = 120000) => {
  if (!updatedAt) return true;

  const millis =
    typeof updatedAt.toMillis === 'function'
      ? updatedAt.toMillis()
      : typeof updatedAt.toDate === 'function'
        ? updatedAt.toDate().getTime()
        : new Date(updatedAt).getTime();

  return !millis || Date.now() - millis > staleMs;
};

export const updateDriverLocation = async (location: DriverLocation) => {
  const payload = {
    driverId: location.driverId,
    latitude: location.latitude,
    longitude: location.longitude,
    heading: location.heading ?? null,
    speed: location.speed ?? null,
    deliveryId: location.deliveryId || null,
    currentLocation: {
      latitude: location.latitude,
      longitude: location.longitude
    },
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, 'driverLocations', location.driverId), payload, { merge: true });

  await setDoc(
    doc(db, 'users', location.driverId),
    {
      currentLocation: {
        latitude: location.latitude,
        longitude: location.longitude
      },
      heading: location.heading ?? null,
      speed: location.speed ?? null,
      lastLocationUpdateAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  if (location.deliveryId) {
    await setDoc(
      doc(db, 'deliveryTracking', location.deliveryId),
      {
        deliveryId: location.deliveryId,
        driverId: location.driverId,
        driverLocation: {
          latitude: location.latitude,
          longitude: location.longitude,
          heading: location.heading ?? null,
          speed: location.speed ?? null
        },
        lastUpdatedAt: serverTimestamp()
      },
      { merge: true }
    );

    await updateDoc(doc(db, 'deliveryRequests', location.deliveryId), {
      driverLocation: {
        latitude: location.latitude,
        longitude: location.longitude
      },
      trackingLastUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, 'deliveryHistory'), {
      deliveryId: location.deliveryId,
      driverId: location.driverId,
      type: 'location_ping',
      latitude: location.latitude,
      longitude: location.longitude,
      heading: location.heading ?? null,
      speed: location.speed ?? null,
      createdAt: serverTimestamp()
    });
  }
};

export const startTracking = ({
  driverId,
  deliveryId,
  driverStatus = deliveryId ? 'on_trip' : 'available',
  minDistanceMeters = 15,
  onError
}: StartTrackingOptions) => {
  if (!navigator.geolocation) {
    throw new Error('GPS is not supported on this device.');
  }

  const watcherKey = `${driverId}:${deliveryId || 'availability'}`;

  if (activeWatchers.has(watcherKey)) {
    return watcherKey;
  }

  const watchId = navigator.geolocation.watchPosition(
    position => {
      const next = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };

      const previous = lastPositions.get(watcherKey);
      const movedMeters = previous ? calculateDistance(previous, next) * 1000 : Infinity;

      if (movedMeters < minDistanceMeters) return;

      lastPositions.set(watcherKey, next);

      updateDriverLocation({
        driverId,
        deliveryId,
        latitude: next.latitude,
        longitude: next.longitude,
        heading: position.coords.heading,
        speed: position.coords.speed
      }).catch(error => console.error('Driver location update failed:', error));

      setDoc(
        doc(db, 'users', driverId),
        {
          driverStatus,
          gpsTrackingActive: true,
          gpsLastSeenAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ).catch(error => console.error('GPS heartbeat failed:', error));
    },
    error => {
      onError?.(error);
      console.error('GPS tracking error:', error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 20000
    }
  );

  activeWatchers.set(watcherKey, watchId);
  return watcherKey;
};

export const stopTracking = async (watcherKey?: string, driverId?: string) => {
  if (watcherKey) {
    const watchId = activeWatchers.get(watcherKey);
    if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    activeWatchers.delete(watcherKey);
    lastPositions.delete(watcherKey);
  } else {
    activeWatchers.forEach(watchId => navigator.geolocation.clearWatch(watchId));
    activeWatchers.clear();
    lastPositions.clear();
  }

  if (driverId) {
    await setDoc(
      doc(db, 'users', driverId),
      {
        gpsTrackingActive: false,
        gpsLastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }
};

export const updateDeliveryStatus = async (
  deliveryId: string,
  status: DeliveryStatus,
  actorId: string
) => {
  await updateDoc(doc(db, 'deliveryRequests', deliveryId), {
    status,
    updatedAt: serverTimestamp()
  });

  await addDoc(collection(db, 'deliveryHistory'), {
    deliveryId,
    actorId,
    type: 'status_changed',
    status,
    createdAt: serverTimestamp()
  });
};

export const subscribeToDelivery = (deliveryId: string, callback: (delivery: any) => void) =>
  onSnapshot(doc(db, 'deliveryRequests', deliveryId), snapshot => {
    if (snapshot.exists()) callback({ id: snapshot.id, ...snapshot.data() });
  });

export const subscribeToDeliveryTracking = (
  deliveryId: string,
  callback: (tracking: any) => void
) =>
  onSnapshot(doc(db, 'deliveryTracking', deliveryId), snapshot => {
    if (snapshot.exists()) callback({ id: snapshot.id, ...snapshot.data() });
  });

export const subscribeToDriverLocation = (
  driverId: string,
  callback: (location: any) => void
) =>
  onSnapshot(doc(db, 'driverLocations', driverId), snapshot => {
    if (snapshot.exists()) callback({ id: snapshot.id, ...snapshot.data() });
  });
