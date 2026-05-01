import { collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface Driver {
  id: string;
  displayName: string;
  driverStatus: string;
  vehicleType: string;
  avgDriverRating: number;
  reliabilityScore: number;
  latitude?: number;
  longitude?: number;
  isBanned?: boolean;
}

export const findOptimalDrivers = async (
  buyerLat: number,
  buyerLng: number,
  limitCount: number = 5
): Promise<Driver[]> => {
  const usersRef = collection(db, 'users');
  const q = query(
    usersRef, 
    where('roles', 'array-contains', 'driver'),
    where('driverStatus', '==', 'available'),
    where('isBanned', '!=', true)
  );

  const snapshot = await getDocs(q);
  const drivers: Driver[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Driver));

  // Calculate scores for each driver
  const scoredDrivers = drivers.map(driver => {
    let score = 0;

    // 1. Distance Score (0-40 points)
    if (driver.latitude && driver.longitude) {
      const distance = calculateDistance(buyerLat, buyerLng, driver.latitude, driver.longitude);
      // Max points for < 5km, decreases up to 50km
      const distanceScore = Math.max(0, 40 * (1 - distance / 50));
      score += distanceScore;
    }

    // 2. Rating Score (0-30 points)
    const ratingScore = (driver.avgDriverRating || 0) * 6; // 5 stars = 30 points
    score += ratingScore;

    // 3. Reliability Score (0-30 points)
    const reliabilityScore = (driver.reliabilityScore || 70) * 0.3; // 100 score = 30 points
    score += reliabilityScore;

    return { ...driver, matchScore: score };
  });

  // Sort by match score descending
  return scoredDrivers
    .sort((a, b) => (b as any).matchScore - (a as any).matchScore)
    .slice(0, limitCount);
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const estimateDeliveryTime = (distance: number, vehicleType: string): string => {
  // Base speed in km/h
  let speed = 20; // default for bike
  if (vehicleType === 'car') speed = 35;
  if (vehicleType === 'truck') speed = 25;

  const hours = distance / speed;
  const minutes = Math.round(hours * 60 + 15); // +15 mins buffer for pickup/dropoff

  if (minutes < 60) return `${minutes} mins`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
};

export const updateReliability = async (driverId: string, success: boolean) => {
  const driverRef = doc(db, 'users', driverId);
  // Simple moving calculation: +5 for success, -15 for cancellation
  const change = success ? 2 : -10;
  await updateDoc(driverRef, {
    reliabilityScore: increment(change),
    updatedAt: serverTimestamp()
  });
};
