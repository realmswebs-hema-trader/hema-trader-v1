import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

import { auth, db } from '../../lib/firebase';

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
  switchRole: (role: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const buildProfile = (firebaseUser: User, data: any = {}): AuthProfile => {
  const roles = Array.isArray(data.roles) ? data.roles : ['buyer'];

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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await setDoc(userRef, newProfile);
      return buildProfile(firebaseUser, newProfile);
    }

    return buildProfile(firebaseUser, userSnap.data());
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const nextProfile = await saveUserProfile(result.user);

    setUser(result.user);
    setProfile(nextProfile);
    setActiveRole(nextProfile.activeRole || nextProfile.roles[0] || 'buyer');
  };

  const logout = async () => {
    await signOut(auth);
  };

  const updateRoles = async (roles: string[]) => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);
    const nextActiveRole = roles[0] || '';

    await updateDoc(userRef, {
      roles,
      activeRole: nextActiveRole,
      updatedAt: serverTimestamp()
    });

    setProfile(prev =>
      prev
        ? {
            ...prev,
            roles,
            activeRole: nextActiveRole
          }
        : prev
    );

    setActiveRole(nextActiveRole || 'buyer');
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
