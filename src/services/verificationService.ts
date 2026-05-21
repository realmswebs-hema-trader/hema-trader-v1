import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '../lib/firebase';

export type GovernmentIdType =
  | 'national_id'
  | 'voter_card'
  | 'passport'
  | 'driver_license';

export const calculateVerificationScore = (profile: any) => {
  let score = 0;

  if (profile?.emailVerified !== false) score += 15;
  if (profile?.phoneVerified) score += 30;
  if (profile?.identityVerified || profile?.verificationStatus === 'verified') score += 35;
  if (profile?.driverVerified) score += 15;

  const communityTrust =
    (profile?.successfulTrades || profile?.completedTrades || profile?.totalTrades || 0) > 0 ||
    (profile?.averageRating || 0) >= 4;

  if (communityTrust) score += 5;

  return Math.min(score, 100);
};

export const getVerificationBadges = (profile: any) => {
  const badges: string[] = [];

  if (profile?.emailVerified !== false) badges.push('Email Verified');
  if (profile?.phoneVerified) badges.push('Phone Verified');

  if (profile?.identityVerified || profile?.verificationStatus === 'verified') {
    badges.push('Verified Identity');
  }

  if (profile?.driverVerified) {
    badges.push('Verified Driver');
  }

  if (
    (profile?.trustScore || 0) >= 96 &&
    profile?.phoneVerified &&
    (profile?.identityVerified || profile?.verificationStatus === 'verified')
  ) {
    badges.push('Elite Verified');
  }

  return badges;
};

const uploadVerificationFile = async (
  userId: string,
  folder: string,
  file: File
) => {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileRef = ref(storage, `verifications/${userId}/${folder}/${Date.now()}_${safeName}`);
  const snapshot = await uploadBytes(fileRef, file);
  return getDownloadURL(snapshot.ref);
};

export const syncVerificationScore = async (userId: string) => {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return 0;

  const profile = userSnap.data();
  const verificationScore = calculateVerificationScore(profile);

  await updateDoc(userRef, {
    verificationScore,
    verificationBadges: getVerificationBadges(profile),
    updatedAt: serverTimestamp()
  });

  return verificationScore;
};

export const submitIdentityVerification = async ({
  userId,
  governmentIdType,
  governmentIdFile,
  selfieFile
}: {
  userId: string;
  governmentIdType: GovernmentIdType;
  governmentIdFile: File;
  selfieFile: File;
}) => {
  const [governmentIdUrl, selfieUrl] = await Promise.all([
    uploadVerificationFile(userId, 'identity', governmentIdFile),
    uploadVerificationFile(userId, 'selfie', selfieFile)
  ]);

  await updateDoc(doc(db, 'users', userId), {
    governmentIdType,
    governmentIdUrl,
    selfieUrl,
    identityVerificationStatus: 'pending',
    verificationStatus: 'pending',
    identityVerified: false,
    updatedAt: serverTimestamp()
  });

  return syncVerificationScore(userId);
};

export const submitDriverVerification = async ({
  userId,
  driverLicenseFile,
  vehiclePhotoFile,
  vehicleType,
  vehiclePlate,
  deliveryZones
}: {
  userId: string;
  driverLicenseFile: File;
  vehiclePhotoFile?: File;
  vehicleType: string;
  vehiclePlate?: string;
  deliveryZones?: string[];
}) => {
  const driverLicenseUrl = await uploadVerificationFile(
    userId,
    'driver',
    driverLicenseFile
  );

  const vehiclePhotoUrl = vehiclePhotoFile
    ? await uploadVerificationFile(userId, 'vehicle', vehiclePhotoFile)
    : '';

  await updateDoc(doc(db, 'users', userId), {
    driverLicenseUrl,
    vehiclePhotoUrl,
    vehicleType,
    vehiclePlate: vehiclePlate || '',
    deliveryZones: deliveryZones || [],
    driverVerificationStatus: 'pending',
    driverVerified: false,
    updatedAt: serverTimestamp()
  });

  return syncVerificationScore(userId);
};

export const requestPhoneOtp = async (phoneNumber: string) => {
  const response = await fetch('/api/verification/phone/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber })
  });

  if (!response.ok) {
    throw new Error('Could not send OTP. Please try again.');
  }

  return response.json();
};

export const confirmPhoneOtp = async ({
  userId,
  phoneNumber,
  otp
}: {
  userId: string;
  phoneNumber: string;
  otp: string;
}) => {
  const response = await fetch('/api/verification/phone/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, phoneNumber, otp })
  });

  if (!response.ok) {
    throw new Error('OTP verification failed.');
  }

  const result = await response.json();

  if (result.success) {
    await updateDoc(doc(db, 'users', userId), {
      phoneNumber,
      phoneVerified: true,
      phoneVerifiedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await syncVerificationScore(userId);
  }

  return result;
};
