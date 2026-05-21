import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

import { db } from '../lib/firebase';

export const getUserProfile = async (userId: string) => {
  const snap = await getDoc(doc(db, 'users', userId));

  if (!snap.exists()) return null;

  return {
    userId: snap.id,
    uid: snap.id,
    ...snap.data()
  };
};

export const followUser = async (followerId: string, followingId: string) => {
  if (followerId === followingId) return;

  const followId = `${followerId}_${followingId}`;

  await setDoc(doc(db, 'followers', followId), {
    followerId,
    followingId,
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'users', followerId), {
    followingCount: increment(1),
    updatedAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'users', followingId), {
    followersCount: increment(1),
    updatedAt: serverTimestamp()
  });
};

export const unfollowUser = async (followerId: string, followingId: string) => {
  if (followerId === followingId) return;

  const followId = `${followerId}_${followingId}`;

  await deleteDoc(doc(db, 'followers', followId));

  await updateDoc(doc(db, 'users', followerId), {
    followingCount: increment(-1),
    updatedAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'users', followingId), {
    followersCount: increment(-1),
    updatedAt: serverTimestamp()
  });
};

export const reportProfile = async ({
  reporterId,
  targetId,
  reason,
  description
}: {
  reporterId: string;
  targetId: string;
  reason: string;
  description: string;
}) => {
  await addDoc(collection(db, 'reports'), {
    type: 'profile',
    reporterId,
    targetId,
    reason,
    description,
    status: 'pending',
    createdAt: serverTimestamp()
  });
};

export const createProfileActivity = async ({
  userId,
  type,
  title,
  body,
  targetId
}: {
  userId: string;
  type:
    | 'listing'
    | 'delivery'
    | 'review'
    | 'follow'
    | 'trade'
    | 'system';
  title: string;
  body: string;
  targetId?: string;
}) => {
  await addDoc(collection(db, 'activities'), {
    userId,
    type,
    title,
    body,
    targetId: targetId || '',
    createdAt: serverTimestamp()
  });
};

export const updateProfileBasics = async ({
  userId,
  displayName,
  username,
  bio,
  location,
  bannerURL,
  languages,
  businessCategory,
  businessDescription,
  phoneNumber
}: {
  userId: string;
  displayName?: string;
  username?: string;
  bio?: string;
  location?: string;
  bannerURL?: string;
  languages?: string[];
  businessCategory?: string;
  businessDescription?: string;
  phoneNumber?: string;
}) => {
  const updates: Record<string, any> = {
    updatedAt: serverTimestamp()
  };

  if (displayName !== undefined) {
    updates.displayName = displayName;
    updates.name = displayName;
  }

  if (username !== undefined) updates.username = username;
  if (bio !== undefined) updates.bio = bio;
  if (location !== undefined) updates.location = location;
  if (bannerURL !== undefined) updates.bannerURL = bannerURL;
  if (languages !== undefined) updates.languages = languages;
  if (businessCategory !== undefined) updates.businessCategory = businessCategory;
  if (businessDescription !== undefined) updates.businessDescription = businessDescription;
  if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;

  await updateDoc(doc(db, 'users', userId), updates);
};

export const updateDriverProfile = async ({
  userId,
  vehicleType,
  vehicleSize,
  deliveryZones,
  driverStatus
}: {
  userId: string;
  vehicleType?: string;
  vehicleSize?: string;
  deliveryZones?: string[];
  driverStatus?: 'available' | 'on_trip' | 'offline';
}) => {
  const updates: Record<string, any> = {
    updatedAt: serverTimestamp()
  };

  if (vehicleType !== undefined) updates.vehicleType = vehicleType;
  if (vehicleSize !== undefined) updates.vehicleSize = vehicleSize;
  if (deliveryZones !== undefined) updates.deliveryZones = deliveryZones;
  if (driverStatus !== undefined) updates.driverStatus = driverStatus;

  await updateDoc(doc(db, 'users', userId), updates);
};
