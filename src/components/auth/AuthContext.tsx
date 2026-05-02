import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../../lib/firebase';

interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;
  viewMode: 'buyer' | 'seller';
  setViewMode: (mode: 'buyer' | 'seller') => void;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  updateLocation: () => Promise<void>;
  updateRoles: (roles: string[]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'buyer' | 'seller'>('buyer');

  useEffect(() => {
    // 🔥 HANDLE REDIRECT FIRST (VERY IMPORTANT)
    const handleRedirect = async () => {
      try {
        const result = await getRedirectResult(auth);

        if (result?.user) {
          console.log("✅ Redirect login success:", result.user);

          // 🔥 FORCE USER STATE IMMEDIATELY
          setUser(result.user);
        }
      } catch (error) {
        console.error("❌ Redirect login error:", error);
      }
    };

    handleRedirect();

    // 🔥 AUTH STATE LISTENER
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid);

        try {
          const userDoc = await getDoc(userDocRef);

          if (userDoc.exists()) {
            const userData = userDoc.data();

            // ADMIN AUTO-SETUP
            if (
              currentUser.email === 'realmswebs@gmail.com' &&
              (userData.verificationStatus !== 'verified' ||
                userData.badge !== 'Elite Producer')
            ) {
              const adminUpdates = {
                verificationStatus: 'verified',
                averageRating: 5.0,
                totalTrades: 100,
                badge: 'Elite Producer',
                isAdmin: true,
                roles: ['buyer', 'seller', 'admin'],
                updatedAt: serverTimestamp()
              };

              await updateDoc(userDocRef, adminUpdates);
              setProfile({ ...userData, ...adminUpdates });
            } else {
              setProfile(userData);
              if (userData.roles?.includes('seller')) {
                setViewMode('seller');
              }
            }
          } else {
            // FIRST TIME USER (AUTO SIGNUP)
            const isAdminEmail = currentUser.email === 'realmswebs@gmail.com';

            const newProfile = {
              userId: currentUser.uid,
              displayName: currentUser.displayName || (isAdminEmail ? 'Admin Farmer' : 'Farmer'),
              email: currentUser.email,
              photoURL: currentUser.photoURL,
              verificationStatus: isAdminEmail ? 'verified' : 'unverified',
              totalTrades: isAdminEmail ? 100 : 0,
              averageRating: isAdminEmail ? 5.0 : 0,
              badge: isAdminEmail ? 'Elite Producer' : null,
              followersCount: 0,
              followingCount: 0,
              fcmToken: null,
              roles: isAdminEmail ? ['buyer', 'seller', 'admin'] : [],
              isAdmin: isAdminEmail,
              createdAt: serverTimestamp(),
            };

            await setDoc(userDocRef, newProfile);
            setProfile(newProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
        }
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // HEARTBEAT
  useEffect(() => {
    if (!user) return;

    const updateHeartbeat = async () => {
      try {
        const userDocRef = doc(db, 'users', user.uid);

        const mockToken =
          localStorage.getItem('fcm_token_sim') ||
          `token_${Math.random().toString(36).substring(7)}`;

        localStorage.setItem('fcm_token_sim', mockToken);

        await updateDoc(userDocRef, {
          lastActiveAt: serverTimestamp(),
          fcmToken: mockToken
        });
      } catch {}
    };

    updateHeartbeat();
    const interval = setInterval(updateHeartbeat, 1000 * 60 * 5);
    return () => clearInterval(interval);
  }, [user]);

  const updateLocation = async () => {
    if (!user) return;

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        const userDocRef = doc(db, 'users', user.uid);

        try {
          await setDoc(userDocRef, { latitude, longitude }, { merge: true });
          setProfile((prev: any) => ({ ...prev, latitude, longitude }));
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
        }
      });
    }
  };

  const updateRoles = async (roles: string[]) => {
    if (!user) return;

    const userDocRef = doc(db, 'users', user.uid);

    try {
      await updateDoc(userDocRef, {
        roles,
        updatedAt: serverTimestamp()
      });

      setProfile((prev: any) => ({ ...prev, roles }));

      if (roles.includes('seller')) setViewMode('seller');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  // 🔥 FINAL LOGIN FUNCTION
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();

    console.log("🚀 Starting Google login...");

    await signInWithRedirect(auth, provider);
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout Error', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        viewMode,
        setViewMode,
        signInWithGoogle,
        logout,
        updateLocation,
        updateRoles
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};
