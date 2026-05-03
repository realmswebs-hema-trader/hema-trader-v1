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
import { auth, db } from '../../lib/firebase';

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
    let isMounted = true;

    // 🔥 HARD TIMEOUT — NEVER ALLOW INFINITE LOADING
    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        console.warn("⚠️ Safety timeout triggered — forcing UI load");
        setLoading(false);
      }
    }, 5000);

    const initAuth = async () => {
      try {
        // 🔥 HANDLE REDIRECT RESULT
        const result = await getRedirectResult(auth);
        if (result?.user) {
          console.log("✅ Redirect login:", result.user.uid);
        }
      } catch (error) {
        console.error("❌ Redirect error:", error);
      }

      // 🔥 AUTH LISTENER
      const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        if (!isMounted) return;

        console.log("🔥 Auth state:", currentUser?.uid);

        setUser(currentUser);

        if (!currentUser) {
          setProfile(null);
          setLoading(false);
          return;
        }

        const userRef = doc(db, 'users', currentUser.uid);

        try {
          console.log("🔥 Fetching user profile...");

          const userSnap = await getDoc(userRef);

          if (userSnap.exists()) {
            const data = userSnap.data();
            console.log("✅ User exists");

            // ADMIN AUTO SET
            if (
              currentUser.email === 'realmswebs@gmail.com' &&
              (!data.isAdmin || data.badge !== 'Elite Producer')
            ) {
              const adminUpdate = {
                verificationStatus: 'verified',
                averageRating: 5.0,
                totalTrades: 100,
                badge: 'Elite Producer',
                isAdmin: true,
                roles: ['buyer', 'seller', 'admin'],
                updatedAt: serverTimestamp()
              };

              await updateDoc(userRef, adminUpdate);
              setProfile({ ...data, ...adminUpdate });
            } else {
              setProfile(data);
              if (data.roles?.includes('seller')) {
                setViewMode('seller');
              }
            }
          } else {
            console.log("🆕 Creating new user profile...");

            const isAdmin = currentUser.email === 'realmswebs@gmail.com';

            const newUser = {
              userId: currentUser.uid,
              displayName: currentUser.displayName || (isAdmin ? 'Admin Farmer' : 'Farmer'),
              email: currentUser.email,
              photoURL: currentUser.photoURL,
              verificationStatus: isAdmin ? 'verified' : 'unverified',
              totalTrades: isAdmin ? 100 : 0,
              averageRating: isAdmin ? 5.0 : 0,
              badge: isAdmin ? 'Elite Producer' : null,
              followersCount: 0,
              followingCount: 0,
              fcmToken: null,
              roles: isAdmin ? ['buyer', 'seller', 'admin'] : [],
              isAdmin,
              createdAt: serverTimestamp(),
            };

            await setDoc(userRef, newUser);
            setProfile(newUser);
          }

        } catch (error) {
          console.error("❌ Firestore error:", error);

          // 🔥 FAIL SAFE — DO NOT BLOCK USER
          setProfile({
            userId: currentUser.uid,
            email: currentUser.email,
            fallback: true
          });
        }

        // 🔥 ALWAYS STOP LOADING
        setLoading(false);
      });

      return unsubscribe;
    };

    let unsubscribe: any;
    initAuth().then((unsub) => (unsubscribe = unsub));

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // 🔥 HEARTBEAT (SAFE)
  useEffect(() => {
    if (!user) return;

    const updateHeartbeat = async () => {
      try {
        const userRef = doc(db, 'users', user.uid);

        const token =
          localStorage.getItem('fcm_token_sim') ||
          `token_${Math.random().toString(36).substring(7)}`;

        localStorage.setItem('fcm_token_sim', token);

        await updateDoc(userRef, {
          lastActiveAt: serverTimestamp(),
          fcmToken: token
        });
      } catch {
        console.warn("⚠️ Heartbeat skipped");
      }
    };

    updateHeartbeat();
    const interval = setInterval(updateHeartbeat, 1000 * 60 * 5);
    return () => clearInterval(interval);
  }, [user]);

  const updateLocation = async () => {
    if (!user) return;

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const userRef = doc(db, 'users', user.uid);

      await setDoc(userRef, { latitude, longitude }, { merge: true });
      setProfile((prev: any) => ({ ...prev, latitude, longitude }));
    });
  };

  const updateRoles = async (roles: string[]) => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);

    await updateDoc(userRef, {
      roles,
      updatedAt: serverTimestamp()
    });

    setProfile((prev: any) => ({ ...prev, roles }));

    if (roles.includes('seller')) setViewMode('seller');
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    console.log("🚀 Starting Google login...");
    await signInWithRedirect(auth, provider);
  };

  const logout = async () => {
    await signOut(auth);
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
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
