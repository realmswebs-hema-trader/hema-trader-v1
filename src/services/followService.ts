import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  deleteDoc,
  getDoc,
  onSnapshot
} from 'firebase/firestore';

import { db } from '../lib/firebase';

export const FOUNDER_EMAIL = 'realmswebs@gmail.com';
export const FOLLOWS_COLLECTION = 'follows';

export interface FollowRecord {
  id: string;
  followerId: string;
  followingId: string;
  participantIds?: string[];
  participants?: string[];
  autoFollowedFounder?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

const uniqueIds = (ids: Array<string | undefined | null>) =>
  Array.from(new Set(ids.filter(Boolean) as string[]));

export const buildFollowId = (followerId: string, followingId: string) =>
  `${followerId}_${followingId}`;

export const findFounderUserId = async () => {
  const founderSnap = await getDocs(
    query(
      collection(db, 'users'),
      where('email', '==', FOUNDER_EMAIL),
      limit(1)
    )
  );

  return founderSnap.docs[0]?.id || '';
};

const updateCounterSafely = async (
  userId: string,
  field: 'followersCount' | 'followingCount',
  amount: number
) => {
  if (!userId) return;

  try {
    await updateDoc(doc(db, 'users', userId), {
      [field]: increment(amount),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.warn(`Could not update ${field}:`, error);
  }
};

export const followUser = async ({
  followerId,
  followingId,
  autoFollowedFounder = false
}: {
  followerId: string;
  followingId: string;
  autoFollowedFounder?: boolean;
}) => {
  if (!followerId || !followingId || followerId === followingId) return false;

  const followId = buildFollowId(followerId, followingId);
  const followRef = doc(db, FOLLOWS_COLLECTION, followId);
  const existingSnap = await getDoc(followRef);

  if (existingSnap.exists()) return false;

  const participantIds = uniqueIds([followerId, followingId]);

  await setDoc(followRef, {
    followerId,
    followingId,
    participantIds,
    participants: participantIds,
    autoFollowedFounder,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  void updateCounterSafely(followerId, 'followingCount', 1);
  void updateCounterSafely(followingId, 'followersCount', 1);

  return true;
};

export const unfollowUser = async ({
  followerId,
  followingId
}: {
  followerId: string;
  followingId: string;
}) => {
  if (!followerId || !followingId || followerId === followingId) return false;

  const followId = buildFollowId(followerId, followingId);
  const followRef = doc(db, FOLLOWS_COLLECTION, followId);
  const existingSnap = await getDoc(followRef);

  if (!existingSnap.exists()) return false;

  await deleteDoc(followRef);

  void updateCounterSafely(followerId, 'followingCount', -1);
  void updateCounterSafely(followingId, 'followersCount', -1);

  return true;
};

export const ensureFounderFollowForUser = async (user: User) => {
  if (!user.uid || user.email?.toLowerCase() === FOUNDER_EMAIL) return false;

  const founderUserId = await findFounderUserId();

  if (!founderUserId || founderUserId === user.uid) return false;

  return followUser({
    followerId: user.uid,
    followingId: founderUserId,
    autoFollowedFounder: true
  });
};

export const subscribeToFollowState = ({
  followerId,
  followingId,
  onChange
}: {
  followerId: string;
  followingId: string;
  onChange: (isFollowing: boolean) => void;
}) => {
  if (!followerId || !followingId || followerId === followingId) {
    onChange(false);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, FOLLOWS_COLLECTION, buildFollowId(followerId, followingId)),
    followSnap => onChange(followSnap.exists()),
    error => {
      console.warn('Follow state listener failed:', error);
      onChange(false);
    }
  );
};

