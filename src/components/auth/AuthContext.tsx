import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPhoneNumber as firebaseSignInWithPhoneNumber,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  type ConfirmationResult,
  type User
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

import { auth, db } from '../../lib/firebase';
import {
  FOUNDER_NAME,
  getFounderUserFields,
  isFounderEmail,
  isReservedFounderName,
  normalizeNameKey,
  syncUserAndFounderOnAuth
} from '../../services/trustScoreService';
import { ensureFounderFollowForUser } from '../../services/followService';

interface AuthProfile {
  userId: string;
  uid: string;
  email: string | null;
  displayName: string;
  name: string;
  photoURL: string;
  roles: string[];
  activeRole?: string;
  latitude?: number;
  longitude?: number;
  currentLocation?: {
    latitude?: number;
    longitude?: number;
  };
  isOnline?: boolean;
  online?: boolean;
  driverStatus?: 'online' | 'offline' | 'available' | 'on_trip';
  totalDeliveries?: number;
  completedDeliveries?: number;
  deliveriesCount?: number;
  totalEarnings?: number;
  averageRating?: number;
  avgDriverRating?: number;
  ratingCount?: number;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  profile: AuthProfile | null;
  loading: boolean;
  activeRole: string;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  registerWithEmail: (
    first: string,
    second: string,
    third?: string
  ) => Promise<void>;
  signUpWithEmail: (
    first: string,
    second: string,
    third?: string
  ) => Promise<void>;
  register: (first: string, second: string, third?: string) => Promise<void>;
  signUp: (first: string, second: string, third?: string) => Promise<void>;
  sendPhoneVerificationCode: (phoneNumber: string) => Promise<string>;
  sendPhoneCode: (phoneNumber: string) => Promise<string>;
  signInWithPhone: (phoneNumber: string) => Promise<string>;
  signInWithPhoneNumber: (phoneNumber: string) => Promise<string>;
  confirmPhoneVerificationCode: (code: string) => Promise<void>;
  confirmPhoneCode: (code: string) => Promise<void>;
  verifyPhoneCode: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  updateRoles: (roles: string[]) => Promise<void>;
  updateLocation: () => Promise<void>;
  updateProfilePhoto: (file: File) => Promise<string>;
  updateDisplayName: (displayName: string) => Promise<void>;
  updateAccountPassword: (password: string) => Promise<void>;
  switchRole: (role: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const FOUNDER_ROLES = ['buyer', 'seller', 'driver', 'admin'];
const FIRESTORE_TIMEOUT_MS = 8000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const CLOUDINARY_UPLOAD_TIMEOUT_MS = 30000;

const withTimeout = async <T,>(
  promise: Promise<T>,
  ms = FIRESTORE_TIMEOUT_MS,
  label = 'Firestore operation'
): Promise<T> => {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

const profileCacheKey = (uid: string) => `hema_profile_${uid}`;

const readCachedProfile = (uid: string) => {
  try {
    const cached = window.localStorage.getItem(profileCacheKey(uid));
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
};

const cacheProfile = (uid: string, data: any) => {
  try {
    window.localStorage.setItem(profileCacheKey(uid), JSON.stringify(data));
  } catch {
    // Local storage can fail in private mode. Ignore safely.
  }
};

const normalizeRoles = (roles: unknown): string[] => {
  if (!Array.isArray(roles)) return [];
  return roles.filter(role => typeof role === 'string');
};

const getFounderActiveRole = (data: any = {}) =>
  FOUNDER_ROLES.includes(data.activeRole) ? data.activeRole : 'admin';

const getSafeDisplayName = (firebaseUser: User, data: any = {}) => {
  if (isFounderEmail(firebaseUser.email)) return FOUNDER_NAME;

  const fallback =
    firebaseUser.displayName ||
    data.displayName ||
    data.name ||
    firebaseUser.email?.split('@')[0] ||
    firebaseUser.phoneNumber ||
    'Hema User';

  return isReservedFounderName(fallback, firebaseUser.email)
    ? firebaseUser.email?.split('@')[0] || 'Hema User'
    : fallback;
};

const buildRoleDefaults = (roles: string[], existingData: any = {}) => {
  if (!roles.includes('driver')) return {};

  return {
    driverStatus: existingData.driverStatus || 'available',
    totalDeliveries: existingData.totalDeliveries ?? 0,
    completedDeliveries: existingData.completedDeliveries ?? 0,
    deliveriesCount: existingData.deliveriesCount ?? 0,
    totalEarnings: existingData.totalEarnings ?? 0,
    averageRating: existingData.averageRating ?? 0,
    avgDriverRating: existingData.avgDriverRating ?? 0,
    ratingCount: existingData.ratingCount ?? 0,
    reliabilityScore: existingData.reliabilityScore ?? 100,
    warningCount: existingData.warningCount ?? 0
  };
};

const buildProfile = (firebaseUser: User, data: any = {}): AuthProfile => {
  const founder = isFounderEmail(firebaseUser.email);
  const founderFields = founder ? getFounderUserFields(data) : {};

  const mergedData = founder
    ? {
        ...data,
        ...founderFields,
        activeRole: getFounderActiveRole(data)
      }
    : data;

  const roles = normalizeRoles(mergedData.roles);

  return {
    ...mergedData,
    userId: firebaseUser.uid,
    uid: firebaseUser.uid,
    email: mergedData.email ?? firebaseUser.email,
    phoneNumber: mergedData.phoneNumber ?? firebaseUser.phoneNumber ?? '',
    displayName:
      mergedData.displayName ??
      mergedData.name ??
      firebaseUser.displayName ??
      '',
    name:
      mergedData.name ??
      mergedData.displayName ??
      firebaseUser.displayName ??
      '',
    photoURL: mergedData.photoURL ?? firebaseUser.photoURL ?? '',
    roles,
    activeRole: mergedData.activeRole ?? roles[0] ?? ''
  };
};

const getCloudinaryConfig = () => {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;

  if (!cloudName || !uploadPreset) {
    throw new Error(
      'Cloudinary is not configured. Add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET, then redeploy.'
    );
  }

  return { cloudName, uploadPreset };
};

const uploadProfilePhotoToCloudinary = async (file: File, userId: string) => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  if (file.size > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error('Profile photo must be 5MB or smaller.');
  }

  const { cloudName, uploadPreset } = getCloudinaryConfig();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, CLOUDINARY_UPLOAD_TIMEOUT_MS);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);
  formData.append('folder', `hema-trader/profile-photos/${userId}`);

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      {
        method: 'POST',
        body: formData,
        signal: controller.signal
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.secure_url) {
      throw new Error(
        data?.error?.message || 'Profile photo upload failed. Please try again.'
      );
    }

    return data.secure_url as string;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Profile photo upload timed out. Please try again.');
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const getAuthErrorMessage = (error: unknown) => {
  const code = (error as any)?.code;

  switch (code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Please log in instead.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled yet in Firebase Authentication.';
    case 'auth/invalid-phone-number':
      return 'Enter a valid phone number with country code, for example +237...';
    case 'auth/missing-verification-code':
    case 'auth/invalid-verification-code':
      return 'The verification code is invalid.';
    case 'auth/code-expired':
      return 'The verification code expired. Please request a new one.';
    case 'auth/captcha-check-failed':
      return 'Phone verification failed. Refresh the page and try again.';
    default:
      return error instanceof Error ? error.message : 'Authentication failed.';
  }
};

const parseRegisterArgs = (first: string, second: string, third = '') => {
  const firstValue = first.trim();
  const secondValue = second.trim();
  const thirdValue = third.trim();
  const firstLooksLikeEmail = firstValue.includes('@');
  const secondLooksLikeEmail = secondValue.includes('@');

  if (thirdValue && !firstLooksLikeEmail && secondLooksLikeEmail) {
    return {
      displayName: firstValue,
      email: secondValue,
      password: thirdValue
    };
  }

  return {
    displayName: thirdValue,
    email: firstValue,
    password: second
  };
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState('');
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const phoneConfirmationRef = useRef<ConfirmationResult | null>(null);

  const runFounderSyncInBackground = (firebaseUser: User) => {
    const sessionKey = `hema_founder_sync_${firebaseUser.uid}`;

    if (window.sessionStorage.getItem(sessionKey)) return;

    window.sessionStorage.setItem(sessionKey, '1');

    syncUserAndFounderOnAuth(firebaseUser).catch(error => {
      console.error('Founder sync failed:', error);
      window.sessionStorage.removeItem(sessionKey);
    });
  };

  const runFounderFollowSyncInBackground = (firebaseUser: User) => {
    const sessionKey = `hema_founder_follow_${firebaseUser.uid}`;

    if (window.sessionStorage.getItem(sessionKey)) return;

    window.sessionStorage.setItem(sessionKey, '1');

    ensureFounderFollowForUser(firebaseUser).catch(error => {
      console.error('Founder auto-follow failed:', error);
      window.sessionStorage.removeItem(sessionKey);
    });
  };

  const saveUserProfile = async (firebaseUser: User) => {
    const userRef = doc(db, 'users', firebaseUser.uid);
    const cachedData = readCachedProfile(firebaseUser.uid);

    let userSnap: any = null;
    let existingData: any = cachedData;

    try {
      userSnap = await withTimeout(getDoc(userRef), FIRESTORE_TIMEOUT_MS, 'Load user profile');
      existingData = userSnap.exists() ? userSnap.data() : cachedData;
    } catch (error) {
      console.error('Profile read failed, using cached/auth fallback:', error);
    }

    const founder = isFounderEmail(firebaseUser.email);
    const existingRoles = normalizeRoles(existingData.roles);
    const roles = founder
      ? FOUNDER_ROLES
      : existingRoles.length > 0
        ? existingRoles
        : ['buyer'];
    const nextActiveRole = founder
      ? getFounderActiveRole(existingData)
      : existingData.activeRole ?? roles[0] ?? 'buyer';

    const displayName = getSafeDisplayName(firebaseUser, existingData);

    const profileUpdate: Record<string, any> = {
      uid: firebaseUser.uid,
      userId: firebaseUser.uid,
      email: firebaseUser.email,
      emailVerified: firebaseUser.emailVerified,
      phoneNumber: firebaseUser.phoneNumber || existingData.phoneNumber || '',
      displayName,
      name: displayName,
      displayNameKey: normalizeNameKey(displayName),
      photoURL: firebaseUser.photoURL || existingData.photoURL || '',
      roles,
      activeRole: nextActiveRole,
      isOnline: true,
      online: true,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(!userSnap?.exists?.() && !existingData.createdAt ? { createdAt: serverTimestamp() } : {}),
      ...buildRoleDefaults(roles, existingData),
      ...(founder
        ? {
            ...getFounderUserFields(existingData),
            activeRole: nextActiveRole
          }
        : {})
    };

    try {
      await withTimeout(
        setDoc(userRef, profileUpdate, { merge: true }),
        FIRESTORE_TIMEOUT_MS,
        'Save user profile'
      );
    } catch (error) {
      console.error('Profile write failed, continuing without blocking app:', error);
    }

    runFounderSyncInBackground(firebaseUser);
    runFounderFollowSyncInBackground(firebaseUser);

    let freshData = {
      ...existingData,
      ...profileUpdate,
      lastActiveAt: existingData.lastActiveAt,
      updatedAt: existingData.updatedAt
    };

    try {
      const freshSnap = await withTimeout(getDoc(userRef), FIRESTORE_TIMEOUT_MS, 'Refresh profile');
      freshData = freshSnap.exists() ? freshSnap.data() : freshData;
    } catch (error) {
      console.error('Profile refresh failed, using fallback:', error);
    }

    const nextProfile = buildProfile(firebaseUser, freshData);
    cacheProfile(firebaseUser.uid, nextProfile);

    return nextProfile;
  };

  const signInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error) {
      throw new Error(getAuthErrorMessage(error));
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      throw new Error(getAuthErrorMessage(error));
    }
  };

  const registerWithEmail = async (
    first: string,
    second: string,
    third = ''
  ) => {
    const { displayName, email, password } = parseRegisterArgs(first, second, third);
    const cleanName = displayName.trim();

    if (cleanName && isReservedFounderName(cleanName, email)) {
      throw new Error(`${FOUNDER_NAME} is reserved for the platform founder.`);
    }

    try {
      const result = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      if (cleanName) {
        await updateProfile(result.user, {
          displayName: cleanName
        });
      }

      await saveUserProfile(result.user);
    } catch (error) {
      throw new Error(getAuthErrorMessage(error));
    }
  };

  const resetRecaptcha = () => {
    try {
      recaptchaVerifierRef.current?.clear();
    } catch {
      // Ignore cleanup errors from expired reCAPTCHA widgets.
    }

    recaptchaVerifierRef.current = null;

    const container = document.getElementById('hema-phone-recaptcha');

    if (container) {
      container.innerHTML = '';
    }
  };

  const getRecaptchaVerifier = () => {
    let container = document.getElementById('hema-phone-recaptcha');

    if (!container) {
      container = document.createElement('div');
      container.id = 'hema-phone-recaptcha';
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '1px';
      container.style.height = '1px';
      document.body.appendChild(container);
    }

    if (!recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current = new RecaptchaVerifier(
        auth,
        container,
        {
          size: 'invisible'
        }
      );
    }

    return recaptchaVerifierRef.current;
  };

  const sendPhoneVerificationCode = async (phoneNumber: string) => {
    const cleanPhone = phoneNumber.trim().replace(/\s/g, '');

    if (!cleanPhone.startsWith('+')) {
      throw new Error('Enter phone number with country code, for example +237...');
    }

    try {
      const verifier = getRecaptchaVerifier();
      await verifier.render();

      const confirmation = await firebaseSignInWithPhoneNumber(
        auth,
        cleanPhone,
        verifier
      );

      phoneConfirmationRef.current = confirmation;
      return confirmation.verificationId;
    } catch (error) {
      resetRecaptcha();
      throw new Error(getAuthErrorMessage(error));
    }
  };

  const confirmPhoneVerificationCode = async (code: string) => {
    if (!phoneConfirmationRef.current) {
      throw new Error('Request a verification code first.');
    }

    try {
      const result = await phoneConfirmationRef.current.confirm(code.trim());
      phoneConfirmationRef.current = null;
      resetRecaptcha();
      await saveUserProfile(result.user);
    } catch (error) {
      throw new Error(getAuthErrorMessage(error));
    }
  };

  const markUserOffline = async (currentUser: User | null) => {
    if (!currentUser) return;

    try {
      if (isFounderEmail(currentUser.email)) {
        await withTimeout(
          setDoc(
            doc(db, 'users', currentUser.uid),
            {
              isOnline: true,
              online: true,
              lastActiveAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            },
            { merge: true }
          ),
          5000,
          'Founder heartbeat'
        );
        return;
      }

      const offlineUpdate: Record<string, any> = {
        isOnline: false,
        online: false,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      if (profile?.roles?.includes('driver')) {
        offlineUpdate.driverStatus = 'offline';
      }

      await withTimeout(
        updateDoc(doc(db, 'users', currentUser.uid), offlineUpdate),
        5000,
        'Mark offline'
      );
    } catch (error) {
      console.warn('Failed to mark user offline:', error);
    }
  };

  const logout = async () => {
    await markUserOffline(user);
    await signOut(auth);

    setUser(null);
    setProfile(null);
    setActiveRole('');
  };

  const updateRoles = async (roles: string[]) => {
    if (!user) return;

    if (isFounderEmail(user.email)) {
      const founderActiveRole = getFounderActiveRole(profile || {});

      await setDoc(
        doc(db, 'users', user.uid),
        {
          ...getFounderUserFields(profile || {}),
          activeRole: founderActiveRole,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      setProfile(prev =>
        prev
          ? {
              ...prev,
              ...getFounderUserFields(prev),
              activeRole: founderActiveRole
            }
          : prev
      );

      setActiveRole(founderActiveRole);
      return;
    }

    const safeRoles = normalizeRoles(roles);
    const nextActiveRole = safeRoles[0] || '';
    const roleDefaults = buildRoleDefaults(safeRoles, profile || {});

    const updates: Record<string, any> = {
      roles: safeRoles,
      activeRole: nextActiveRole,
      updatedAt: serverTimestamp(),
      ...roleDefaults
    };

    if (!safeRoles.includes('driver')) {
      updates.driverStatus = 'offline';
    }

    await updateDoc(doc(db, 'users', user.uid), updates);

    setProfile(prev =>
      prev
        ? {
            ...prev,
            roles: safeRoles,
            activeRole: nextActiveRole,
            ...roleDefaults,
            ...(!safeRoles.includes('driver') ? { driverStatus: 'offline' } : {})
          }
        : prev
    );

    setActiveRole(nextActiveRole);
  };

  const switchRole = async (role: string) => {
    if (!user || !profile) return;

    const roles = isFounderEmail(user.email) ? FOUNDER_ROLES : profile.roles;

    if (!roles.includes(role)) {
      console.error('User does not have this role:', role);
      return;
    }

    const updates: Record<string, any> = {
      activeRole: role,
      updatedAt: serverTimestamp()
    };

    if (!isFounderEmail(user.email) && role === 'driver' && profile.driverStatus === 'offline') {
      updates.driverStatus = 'available';
    }

    await updateDoc(doc(db, 'users', user.uid), updates);

    setActiveRole(role);
    setProfile(prev =>
      prev
        ? {
            ...prev,
            roles,
            activeRole: role,
            ...(updates.driverStatus ? { driverStatus: updates.driverStatus } : {})
          }
        : prev
    );
  };

  const updateLocation = async () => {
    if (!user) return;

    if (!navigator.geolocation) {
      throw new Error('Geolocation is not supported by this browser.');
    }

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000
      });
    });

    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const currentLocation = { latitude, longitude };

    await updateDoc(doc(db, 'users', user.uid), {
      latitude,
      longitude,
      currentLocation,
      locationUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    setProfile(prev =>
      prev
        ? {
            ...prev,
            latitude,
            longitude,
            currentLocation
          }
        : prev
    );
  };

  const updateProfilePhoto = async (file: File) => {
    if (!user) {
      throw new Error('You must be signed in to update your profile photo.');
    }

    const photoURL = await uploadProfilePhotoToCloudinary(file, user.uid);

    await updateProfile(user, {
      photoURL
    });

    await updateDoc(doc(db, 'users', user.uid), {
      photoURL,
      updatedAt: serverTimestamp()
    });

    setProfile(prev => {
      const nextProfile = prev ? { ...prev, photoURL } : prev;

      if (nextProfile) {
        cacheProfile(user.uid, nextProfile);
      }

      return nextProfile;
    });

    return photoURL;
  };

  const updateDisplayName = async (displayName: string) => {
    if (!user) return;

    const cleanDisplayName = isFounderEmail(user.email)
      ? FOUNDER_NAME
      : displayName.trim();

    if (!cleanDisplayName) return;

    if (isReservedFounderName(cleanDisplayName, user.email)) {
      throw new Error(`${FOUNDER_NAME} is reserved for the founder.`);
    }

    await updateProfile(user, {
      displayName: cleanDisplayName
    });

    await setDoc(
      doc(db, 'users', user.uid),
      {
        ...(isFounderEmail(user.email) ? getFounderUserFields(profile || {}) : {}),
        displayName: cleanDisplayName,
        name: cleanDisplayName,
        displayNameKey: normalizeNameKey(cleanDisplayName),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    setProfile(prev => {
      const nextProfile = prev
        ? {
            ...prev,
            ...(isFounderEmail(user.email) ? getFounderUserFields(prev) : {}),
            displayName: cleanDisplayName,
            name: cleanDisplayName,
            displayNameKey: normalizeNameKey(cleanDisplayName)
          }
        : prev;

      if (nextProfile) {
        cacheProfile(user.uid, nextProfile);
      }

      return nextProfile;
    });
  };

  const updateAccountPassword = async (password: string) => {
    if (!user) return;

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }

    await updatePassword(user, password);
  };

  useEffect(() => {
    return () => {
      resetRecaptcha();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async firebaseUser => {
      try {
        setUser(firebaseUser);

        if (!firebaseUser) {
          setProfile(null);
          setActiveRole('');
          return;
        }

        const cachedProfile = readCachedProfile(firebaseUser.uid);

        if (cachedProfile?.uid) {
          const nextCachedProfile = buildProfile(firebaseUser, cachedProfile);
          setProfile(nextCachedProfile);
          setActiveRole(nextCachedProfile.activeRole || nextCachedProfile.roles[0] || '');
        }

        const nextProfile = await saveUserProfile(firebaseUser);

        setProfile(nextProfile);
        setActiveRole(nextProfile.activeRole || nextProfile.roles[0] || '');
      } catch (error) {
        console.error('Auth listener failed:', error);

        if (firebaseUser) {
          const fallbackProfile = buildProfile(firebaseUser, readCachedProfile(firebaseUser.uid));
          setProfile(fallbackProfile);
          setActiveRole(fallbackProfile.activeRole || fallbackProfile.roles[0] || '');
        } else {
          setProfile(null);
          setActiveRole('');
        }
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);

    const sendHeartbeat = async () => {
      if (document.visibilityState !== 'visible') return;

      try {
        await withTimeout(
          setDoc(
            userRef,
            {
              isOnline: true,
              online: true,
              lastActiveAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            },
            { merge: true }
          ),
          5000,
          'Online heartbeat'
        );

        setProfile(prev =>
          prev
            ? {
                ...prev,
                ...(isFounderEmail(user.email) ? getFounderUserFields(prev) : {}),
                isOnline: true,
                online: true
              }
            : prev
        );
      } catch (error) {
        console.warn('Online heartbeat failed:', error);
      }
    };

    const heartbeatId = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void sendHeartbeat();
      }
    };

    const handleBeforeUnload = () => {
      void markUserOffline(user);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.clearInterval(heartbeatId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user?.uid, user?.email]);

  const loginWithEmail = signInWithEmail;
  const login = signInWithEmail;
  const signIn = signInWithEmail;
  const register = registerWithEmail;
  const signUpWithEmail = registerWithEmail;
  const signUp = registerWithEmail;
  const sendPhoneCode = sendPhoneVerificationCode;
  const signInWithPhone = sendPhoneVerificationCode;
  const signInWithPhoneNumber = sendPhoneVerificationCode;
  const confirmPhoneCode = confirmPhoneVerificationCode;
  const verifyPhoneCode = confirmPhoneVerificationCode;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        activeRole,
        signInWithGoogle,
        signInWithEmail,
        loginWithEmail,
        login,
        signIn,
        registerWithEmail,
        signUpWithEmail,
        register,
        signUp,
        sendPhoneVerificationCode,
        sendPhoneCode,
        signInWithPhone,
        signInWithPhoneNumber,
        confirmPhoneVerificationCode,
        confirmPhoneCode,
        verifyPhoneCode,
        logout,
        updateRoles,
        updateLocation,
        updateProfilePhoto,
        updateDisplayName,
        updateAccountPassword,
        switchRole
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};
