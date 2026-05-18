import React, {
  createContext,
  useContext,
  useEffect,
  useState
} from 'react';

import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from 'firebase/auth';

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from 'firebase/firestore';

import { auth, db } from '../../lib/firebase';

// ============================
// TYPES
// ============================

interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;

  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

// ============================
// CONTEXT
// ============================

const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);

// ============================
// PROVIDER
// ============================

export const AuthProvider = ({
  children
}: {
  children: React.ReactNode;
}) => {
  const [user, setUser] = useState<User | null>(null);

  const [profile, setProfile] = useState<any | null>(null);

  const [loading, setLoading] = useState(true);

  // ============================
  // GOOGLE LOGIN
  // ============================

  const signInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();

      const result = await signInWithPopup(
        auth,
        provider
      );

      const firebaseUser = result.user;

      const userRef = doc(db, 'users', firebaseUser.uid);

      const userSnap = await getDoc(userRef);

      // Create profile if new user
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name: firebaseUser.displayName || '',
          photoURL: firebaseUser.photoURL || '',

          createdAt: serverTimestamp(),

          roles:
            firebaseUser.email ===
            'realmswebs@gmail.com'
              ? ['buyer', 'seller', 'admin']
              : ['buyer'],

          verificationStatus:
            firebaseUser.email ===
            'realmswebs@gmail.com'
              ? 'verified'
              : 'unverified',

          averageRating:
            firebaseUser.email ===
            'realmswebs@gmail.com'
              ? 5
              : 0,

          totalTrades:
            firebaseUser.email ===
            'realmswebs@gmail.com'
              ? 100
              : 0,

          badge:
            firebaseUser.email ===
            'realmswebs@gmail.com'
              ? 'Elite Producer'
              : ''
        });
      }
    } catch (error) {
      console.error(
        'Google sign in error:',
        error
      );
    }
  };

  // ============================
  // LOGOUT
  // ============================

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // ============================
  // AUTH STATE
  // ============================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async firebaseUser => {
        try {
          setUser(firebaseUser);

          if (firebaseUser) {
            const userRef = doc(
              db,
              'users',
              firebaseUser.uid
            );

            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
              setProfile(userSnap.data());
            }
          } else {
            setProfile(null);
          }
        } catch (error) {
          console.error(
            'Auth state error:',
            error
          );
        } finally {
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signInWithGoogle,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ============================
// CUSTOM HOOK
// ============================

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      'useAuth must be used within AuthProvider'
    );
  }

  return context;
};
