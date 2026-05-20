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

interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;

  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<
  AuthContextType | undefined
>(undefined);

export const AuthProvider = ({
  children
}: {
  children: React.ReactNode;
}) => {
  const [user, setUser] =
    useState<User | null>(null);

  const [profile, setProfile] =
    useState<any | null>(null);

  const [loading, setLoading] =
    useState(true);

  const signInWithGoogle = async () => {
    try {
      const provider =
        new GoogleAuthProvider();

      const result =
        await signInWithPopup(
          auth,
          provider
        );

      const firebaseUser = result.user;

      const userRef = doc(
        db,
        'users',
        firebaseUser.uid
      );

      const userSnap =
        await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name:
            firebaseUser.displayName || '',
          photoURL:
            firebaseUser.photoURL || '',

          createdAt: serverTimestamp(),

          roles:
            firebaseUser.email ===
            'realmswebs@gmail.com'
              ? [
                  'buyer',
                  'seller',
                  'admin'
                ]
              : ['buyer']
        });
      }
    } catch (error) {
      console.error(
        'Google sign in failed:',
        error
      );
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(
        'Logout failed:',
        error
      );
    }
  };

  useEffect(() => {
    const unsubscribe =
      onAuthStateChanged(
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

              const userSnap =
                await getDoc(userRef);

              if (userSnap.exists()) {
                setProfile(
                  userSnap.data()
                );
              }
            } else {
              setProfile(null);
            }
          } catch (error) {
            console.error(
              'Auth listener failed:',
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

export const useAuth = () => {
  const context =
    useContext(AuthContext);

  if (context === undefined) {
    throw new Error(
      'useAuth must be used within an AuthProvider'
    );
  }

  return context;
};
```
