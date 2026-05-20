import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
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
  switchRole: (role: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeRoles = (roles: unknown): string[] => {
  if (!Array.isArray(roles)) return ['buyer'];

  const cleanRoles = roles.filter(role => typeof role === 'string');

  return cleanRoles.length > 0 ? cleanRoles : ['buyer'];
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
    activeRole: data.activeRole ?? roles[0] ?? 'buyer'
  };
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState('buyer');

  const saveUserProfile = async (firebaseUser: User) => {
    const userRef = doc(db, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      const roles =
        firebaseUser.email === 'realmswebs@gmail.com'
          ? ['buyer', 'seller', 'driver', 'admin']
          : ['buyer'];

      const newProfile = {
        uid: firebaseUser.uid,
        userId: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName || '',
        name: firebaseUser.displayName || '',
        photoURL: firebaseUser.photoURL || '',
        roles,
        activeRole: roles[0],
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

    const existingProfile = buildProfile(firebaseUser, userSnap.data());

    await updateDoc(userRef, {
      isOnline: true,
      online: true,
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return existingProfile;
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const nextProfile = await saveUserProfile(result.user);

    setUser(result.user);
    setProfile(nextProfile);
    setActiveRole(nextProfile.activeRole || nextProfile.roles[0] || 'buyer');
  };

  const markUserOffline = async (currentUser: User | null) => {
    if (!currentUser) return;

    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        isOnline: false,
        online: false,
        driverStatus: profile?.roles?.includes('driver') ? 'offline' : profile?.driverStatus,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Failed to mark user offline:', error);
    }
  };

  const logout = async () => {
    await markUserOffline(user);
    await signOut(auth);

    setUser(null);
    setProfile(null);
    setActiveRole('buyer');
  };

  const updateRoles = async (roles: string[]) => {
    if (!user) return;

    const safeRoles = normalizeRoles(roles);
    const nextActiveRole = safeRoles[0] || 'buyer';
    const roleDefaults = buildRoleDefaults(safeRoles);

    await updateDoc(doc(db, 'users', user.uid), {
      roles: safeRoles,
      activeRole: nextActiveRole,
      updatedAt: serverTimestamp(),
      ...roleDefaults
    });

    setProfile(prev =>
      prev
        ? {
            ...prev,
            roles: safeRoles,
            activeRole: nextActiveRole,
            ...roleDefaults
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

    await updateDoc(doc(db, 'users', user.uid), {
      activeRole: role,
      updatedAt: serverTimestamp()
    });

    setActiveRole(role);
    setProfile(prev => (prev ? { ...prev, activeRole: role } : prev));
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

    const fileRef = ref(storage, `profilePhotos/${user.uid}/${Date.now()}_${file.name}`);
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async firebaseUser => {
      try {
        setUser(firebaseUser);

        if (!firebaseUser) {
          setProfile(null);
          setActiveRole('buyer');
          return;
        }

        const nextProfile = await saveUserProfile(firebaseUser);

        setProfile(nextProfile);
        setActiveRole(nextProfile.activeRole || nextProfile.roles[0] || 'buyer');
      } catch (error) {
        console.error('Auth listener failed:', error);
        setProfile(null);
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
        await updateDoc(userRef, {
          isOnline: true,
          online: true,
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

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
  }, [user]);

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
