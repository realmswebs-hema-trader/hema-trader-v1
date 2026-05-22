import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  calculateDistance,
  calculateETA,
  formatETA,
  isLocationFresh,
  toGeoPoint,
  type GeoPoint
} from '../utils/geoUtils';

export type DeliveryPackageType =
  | 'produce'
  | 'livestock'
  | 'equipment'
  | 'cold_chain'
  | 'documents'
  | 'general';

export interface DeliveryMatchInput {
  pickupLocation?: GeoPoint | null;
  dropoffLocation?: GeoPoint | null;
  packageType?: DeliveryPackageType | string;
  packageWeight?: number;
  packageValue?: number;
  urgency?: 'normal' | 'same_day' | 'urgent' | string;
}

export interface MatchedDriver {
  id: string;
  driverId: string;
  displayName?: string;
  name?: string;
  photoURL?: string;
  vehicleType?: string;
  driverStatus?: string;
  averageRating?: number;
  avgDriverRating?: number;
  trustScore?: number;
  reliabilityScore?: number;
  completedDeliveries?: number;
  deliveriesCount?: number;
  currentLocation?: GeoPoint;
  matchScore: number;
  distanceToPickupKm: number | null;
  pickupEtaMinutes: number | null;
  pickupEtaLabel: string;
  recommendedVehicle: string;
  driverLevel: string;
  riskLevel: 'low' | 'medium' | 'high';
  reasons: string[];
}

const numberValue = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getVehicleRecommendation = (input: DeliveryMatchInput) => {
  const type = String(input.packageType || 'general').toLowerCase();
  const weight = numberValue(input.packageWeight);

  if (type === 'livestock') return 'truck';
  if (type === 'cold_chain') return 'van';
  if (weight >= 700) return 'truck';
  if (weight >= 120) return 'van';
  if (weight >= 35) return 'car';

  return 'motorbike';
};

export const calculateDeliveryFee = (
  pickup?: GeoPoint | null,
  dropoff?: GeoPoint | null,
  input: DeliveryMatchInput = {}
) => {
  const distanceKm = calculateDistance(pickup, dropoff);
  const weight = numberValue(input.packageWeight);
  const urgency = String(input.urgency || 'normal');
  const special =
    input.packageType === 'livestock' || input.packageType === 'cold_chain';

  return Math.max(
    900 +
      Math.ceil(distanceKm * 230) +
      Math.ceil(Math.max(weight - 5, 0) * 25) +
      (urgency === 'urgent' ? 1500 : urgency === 'same_day' ? 700 : 0) +
      (special ? 1200 : 350),
    1200
  );
};

export const getDriverLevel = (driver: any) => {
  const done = numberValue(driver.completedDeliveries || driver.deliveriesCount);
  const rating = numberValue(driver.avgDriverRating || driver.averageRating);
  const trust = numberValue(driver.trustScore || driver.reliabilityScore, 70);

  if (done >= 250 && rating >= 4.8 && trust >= 95) return 'Elite Driver';
  if (done >= 100 && rating >= 4.6 && trust >= 88) return 'Pro Driver';
  if (done >= 25 && rating >= 4.2) return 'Trusted Driver';
  return 'Verified Driver';
};

export const analyzeDeliveryRisk = (input: DeliveryMatchInput) => {
  const distanceKm = calculateDistance(input.pickupLocation, input.dropoffLocation);
  const flags: string[] = [];

  if (!input.pickupLocation || !input.dropoffLocation) flags.push('Missing GPS');
  if (distanceKm > 80) flags.push('Long rural route');
  if (numberValue(input.packageValue) > 500000) flags.push('High value');
  if (input.packageType === 'livestock' || input.packageType === 'cold_chain') {
    flags.push('Special handling');
  }

  return {
    riskLevel: flags.length >= 3 ? 'high' : flags.length ? 'medium' : 'low',
    flags,
    distanceKm
  } as const;
};

export const rankDriversForDelivery = (drivers: any[], input: DeliveryMatchInput) => {
  const recommendedVehicle = getVehicleRecommendation(input);

  return drivers
    .filter(driver => {
      const status = String(driver.driverStatus || driver.availability || '').toLowerCase();
      return (
        driver.roles?.includes?.('driver') &&
        !driver.isBanned &&
        status !== 'offline' &&
        (status === 'available' || driver.isOnline || driver.online)
      );
    })
    .map(driver => {
      const point = toGeoPoint(driver);
      const distanceToPickupKm =
        point && input.pickupLocation
          ? calculateDistance(point, input.pickupLocation)
          : null;

      const pickupEtaMinutes =
        distanceToPickupKm !== null
          ? Math.max(Math.round((distanceToPickupKm / 28) * 60), 1)
          : null;

      const rating = numberValue(driver.avgDriverRating || driver.averageRating);
      const trust = numberValue(driver.trustScore || driver.reliabilityScore, 70);
      const deliveries = numberValue(driver.completedDeliveries || driver.deliveriesCount);
      const gpsLive = isLocationFresh(driver.lastLocationUpdateAt || driver.gpsLastSeenAt);

      let score = 0;
      const reasons: string[] = [];

      if (gpsLive) {
        score += 25;
        reasons.push('Live GPS');
      }

      if (distanceToPickupKm !== null) {
        score += Math.max(0, 30 - distanceToPickupKm);
        if (distanceToPickupKm <= 5) reasons.push('Nearby pickup');
      }

      score += Math.min(rating * 6, 30);
      score += Math.min(trust / 4, 25);
      score += Math.min(deliveries / 8, 20);

      return {
        ...driver,
        driverId: driver.id,
        matchScore: Math.round(score),
        distanceToPickupKm,
        pickupEtaMinutes,
        pickupEtaLabel: pickupEtaMinutes ? formatETA(pickupEtaMinutes) : 'ETA pending',
        recommendedVehicle,
        driverLevel: getDriverLevel(driver),
        riskLevel: trust < 60 ? 'high' : gpsLive ? 'low' : 'medium',
        reasons
      } as MatchedDriver;
    })
    .sort((a, b) => b.matchScore - a.matchScore);
};

export const findBestDriversForDelivery = async (
  input: DeliveryMatchInput,
  count = 6
) => {
  const snap = await getDocs(
    query(collection(db, 'users'), where('roles', 'array-contains', 'driver'), limit(150))
  );

  return rankDriversForDelivery(
    snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })),
    input
  ).slice(0, count);
};

export const calculateSmartETA = (
  pickup?: GeoPoint | null,
  dropoff?: GeoPoint | null
) => calculateETA(pickup, dropoff, 28) + 12;
