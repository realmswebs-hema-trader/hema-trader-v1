import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL
} from 'firebase/storage';

import { auth, db, storage } from '../../lib/firebase';

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
  logout: () => Promise<void>;
  updateRoles: (roles: string[]) => Promise<void>;
  updateLocation: () => Promise<void>;
  updateProfilePhoto: (file: File) => Promise<string>;
  updateDisplayName: (displayName: string) => Promise<void>;
  updateAccountPassword: (password: string) => Promise<void>;
  switchRole: (role: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeRoles = (roles: unknown): string[] => {
  if (!Array.isArray(roles)) return [];

  return roles.filter(role => typeof role === 'string');
};

const buildRoleDefaults = (roles: string[]) => {
  if (!roles.includes('driver')) return {};

  return {
    driverStatus: 'available',
    totalDeliveries: 0,
    completedDeliveries: 0,
    deliveriesCount: 0,
    totalEarnings: 0,
    averageRating: 0,
    avgDriverRating: 0,
    ratingCount: 0,
    reliabilityScore: 100,
    warningCount: 0
  };
};

const buildProfile = (firebaseUser: User, data: any = {}): AuthProfile => {
  const roles = normalizeRoles(data.roles);

  return {
    ...data,
    userId: firebaseUser.uid,
    uid: firebaseUser.uid,
    email: data.email ?? firebaseUser.email,
    displayName: data.displayName ?? data.name ?? firebaseUser.displayName ?? '',
    name: data.name ?? data.displayName ?? firebaseUser.displayName ?? '',
    photoURL: data.photoURL ?? firebaseUser.photoURL ?? '',
    roles,
    activeRole: data.activeRole ?? roles[0] ?? ''
  };
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState('');

  const saveUserProfile = async (firebaseUser: User) => {
    const userRef = doc(db, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      const roles =
        firebaseUser.email === 'realmswebs@gmail.com'
          ? ['buyer', 'seller', 'driver', 'admin']
          : [];

      const newProfile = {
        uid: firebaseUser.uid,
        userId: firebaseUser.uid,
        email: firebaseUser.email,
        displayName:
          firebaseUser.displayName ||
          firebaseUser.email?.split('@')[0] ||
          'Hema User',
        name:
          firebaseUser.displayName ||
          firebaseUser.email?.split('@')[0] ||
          'Hema User',
        photoURL: firebaseUser.photoURL || '',
        roles,
        activeRole: roles[0] || '',
        isOnline: true,
        online: true,
        lastActiveAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...buildRoleDefaults(roles)
      };

      await setDoc(userRef, newProfile);

      return buildProfile(firebaseUser, newProfile);
    }

    const existingData = userSnap.data();
    const existingProfile = buildProfile(firebaseUser, existingData);
    const existingRoles = normalizeRoles(existingData.roles);

    const onlineUpdate: Record<string, any> = {
      isOnline: true,
      online: true,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    if (existingRoles.includes('driver') && !existingData.driverStatus) {
      onlineUpdate.driverStatus = 'available';
    }

    await updateDoc(userRef, onlineUpdate);

    return {
      ...existingProfile,
      isOnline: true,
      online: true,
      ...(onlineUpdate.driverStatus ? { driverStatus: onlineUpdate.driverStatus } : {})
    };
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const nextProfile = await saveUserProfile(result.user);

    setUser(result.user);
    setProfile(nextProfile);
    setActiveRole(nextProfile.activeRole || nextProfile.roles[0] || '');
  };

  const markUserOffline = async (currentUser: User | null) => {
    if (!currentUser) return;

    try {
      const offlineUpdate: Record<string, any> = {
        isOnline: false,
        online: false,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      if (profile?.roles?.includes('driver')) {
        offlineUpdate.driverStatus = 'offline';
      }

      await updateDoc(doc(db, 'users', currentUser.uid), offlineUpdate);
    } catch (error) {
      console.error('Failed to mark user offline:', error);
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

    const safeRoles = normalizeRoles(roles);
    const nextActiveRole = safeRoles[0] || '';
    const roleDefaults = buildRoleDefaults(safeRoles);

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

    if (!profile.roles.includes(role)) {
      console.error('User does not have this role:', role);
      return;
    }

    const updates: Record<string, any> = {
      activeRole: role,
      updatedAt: serverTimestamp()
    };

    if (role === 'driver' && profile.driverStatus === 'offline') {
      updates.driverStatus = 'available';
    }

    await updateDoc(doc(db, 'users', user.uid), updates);

    setActiveRole(role);
    setProfile(prev =>
      prev
        ? {
            ...prev,
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

    await updateDoc(doc(db, 'users', user.uid), {
      latitude,
      longitude,
      locationUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    setProfile(prev =>
      prev
        ? {
            ...prev,
            latitude,
            longitude
          }
        : prev
    );
  };

  const updateProfilePhoto = async (file: File) => {
    if (!user) {
      throw new Error('You must be signed in to update your profile photo.');
    }

    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileRef = ref(
      storage,
      `profilePhotos/${user.uid}/${Date.now()}_${safeFileName}`
    );

    const uploadResult = await uploadBytes(fileRef, file);
    const photoURL = await getDownloadURL(uploadResult.ref);

    await updateProfile(user, {
      photoURL
    });

    await updateDoc(doc(db, 'users', user.uid), {
      photoURL,
      updatedAt: serverTimestamp()
    });

    setProfile(prev => (prev ? { ...prev, photoURL } : prev));

    return photoURL;
  };

  const updateDisplayName = async (displayName: string) => {
    if (!user) return;

    const cleanDisplayName = displayName.trim();

    if (!cleanDisplayName) return;

    await updateProfile(user, {
      displayName: cleanDisplayName
    });

    await updateDoc(doc(db, 'users', user.uid), {
      displayName: cleanDisplayName,
      name: cleanDisplayName,
      updatedAt: serverTimestamp()
    });

    setProfile(prev =>
      prev
        ? {
            ...prev,
            displayName: cleanDisplayName,
            name: cleanDisplayName
          }
        : prev
    );
  };

  const updateAccountPassword = async (password: string) => {
    if (!user) return;

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }

    await updatePassword(user, password);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async firebaseUser => {
      try {
        setUser(firebaseUser);

        if (!firebaseUser) {
          setProfile(null);
          setActiveRole('');
          return;
        }

        const nextProfile = await saveUserProfile(firebaseUser);

        setProfile(nextProfile);
        setActiveRole(nextProfile.activeRole || nextProfile.roles[0] || '');
      } catch (error) {
        console.error('Auth listener failed:', error);
        setProfile(null);
        setActiveRole('');
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
      try {
        const heartbeatUpdate: Record<string, any> = {
          isOnline: true,
          online: true,
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        await updateDoc(userRef, heartbeatUpdate);

        setProfile(prev =>
          prev
            ? {
                ...prev,
                isOnline: true,
                online: true
              }
            : prev
        );
      } catch (error) {
        console.error('Online heartbeat failed:', error);
      }
    };

    sendHeartbeat();

    const heartbeatId = window.setInterval(sendHeartbeat, 60000);

    const handleBeforeUnload = () => {
      markUserOffline(user);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.clearInterval(heartbeatId);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user, profile?.roles, profile?.driverStatus]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        activeRole,
        signInWithGoogle,
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
