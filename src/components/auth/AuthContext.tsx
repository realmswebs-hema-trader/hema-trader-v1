```tsx
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
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  ConfirmationResult
} from 'firebase/auth';

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';

import {
  auth,
  db
} from '../../lib/firebase';

// =====================================
// TYPES
// =====================================

interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;

  viewMode: 'buyer' | 'seller' | 'driver';

  setViewMode: (
    mode: 'buyer' | 'seller' | 'driver'
  ) => void;

  signInWithGoogle: () => Promise<void>;

  signUpWithEmail: (
    email: string,
    password: string,
    name: string
  ) => Promise<void>;

  signInWithEmail: (
    email: string,
    password: string
  ) => Promise<void>;

  setupRecaptcha: (
    containerId: string
  ) => Promise<RecaptchaVerifier>;

  signInWithPhone: (
    phoneNumber: string,
    verifier: RecaptchaVerifier
  ) => Promise<ConfirmationResult>;

  logout: () => Promise<void>;

  updateLocation: () => Promise<void>;

  updateRoles: (
    roles: string[]
  ) => Promise<void>;
}

// =====================================
// CONTEXT
// =====================================

const AuthContext =
  createContext<AuthContextType | undefined>(
    undefined
  );

// =====================================
// PROVIDER
// =====================================

export const AuthProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {

  const [user, setUser] =
    useState<User | null>(null);

  const [profile, setProfile] =
    useState<any | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [viewMode, setViewMode] =
    useState<'buyer' | 'seller' | 'driver'>(
      'buyer'
    );

  // =====================================
  // AUTH STATE
  // =====================================

  useEffect(() => {

    const unsubscribe =
      onAuthStateChanged(
        auth,
        async (currentUser) => {

          try {

            setLoading(true);

            if (!currentUser) {

              setUser(null);
              setProfile(null);
              setLoading(false);

              return;
            }

            setUser(currentUser);

            const normalizedEmail =
              currentUser.email
                ?.toLowerCase()
                .trim() || '';

            const userRef = doc(
              db,
              'users',
              currentUser.uid
            );

            const userSnap =
              await getDoc(userRef);

            // =====================================
            // CREATE PROFILE
            // =====================================

            if (!userSnap.exists()) {

              const isAdmin =
                normalizedEmail ===
                'realmswebs@gmail.com';

              const newProfile = {

                uid:
                  currentUser.uid,

                displayName:
                  currentUser.displayName ||
                  'Hema User',

                email:
                  normalizedEmail,

                photoURL:
                  currentUser.photoURL || '',

                phoneNumber:
                  currentUser.phoneNumber || '',

                roles:
                  isAdmin
                    ? [
                        'buyer',
                        'seller',
                        'driver',
                        'admin'
                      ]
                    : [
                        'buyer'
                      ],

                isAdmin,

                verificationStatus:
                  isAdmin
                    ? 'verified'
                    : 'unverified',

                totalTrades:
                  isAdmin
                    ? 127
                    : 0,

                averageRating:
                  isAdmin
                    ? 4.9
                    : 0,

                badge:
                  isAdmin
                    ? 'Verified Seller'
                    : 'Unverified Trader',

                followersCount: 0,

                followingCount: 0,

                completedTrades:
                  isAdmin
                    ? 127
                    : 0,

                memberSince:
                  new Date().getFullYear(),

                createdAt:
                  serverTimestamp(),

                updatedAt:
                  serverTimestamp(),

                lastActiveAt:
                  serverTimestamp()
              };

              await setDoc(
                userRef,
                newProfile
              );

              setProfile(
                newProfile
              );

            } else {

              const existingProfile =
                userSnap.data();

              // Normalize email
              if (
                existingProfile.email !==
                normalizedEmail
              ) {

                await updateDoc(
                  userRef,
                  {
                    email:
                      normalizedEmail
                  }
                );
              }

              setProfile({
                ...existingProfile,
                email:
                  normalizedEmail
              });

              // Auto mode
              if (
                existingProfile.roles?.includes(
                  'seller'
                )
              ) {

                setViewMode(
                  'seller'
                );

              } else if (
                existingProfile.roles?.includes(
                  'driver'
                )
              ) {

                setViewMode(
                  'driver'
                );
              }
            }

          } catch (error) {

            console.error(
              'AUTH STATE ERROR:',
              error
            );

          } finally {

            setLoading(false);
          }
        }
      );

    return () =>
      unsubscribe();

  }, []);

  // =====================================
  // HEARTBEAT
  // =====================================

  useEffect(() => {

    if (!user) return;

    const interval =
      setInterval(
        async () => {

          try {

            const userRef = doc(
              db,
              'users',
              user.uid
            );

            await updateDoc(
              userRef,
              {
                lastActiveAt:
                  serverTimestamp()
              }
            );

          } catch (error) {

            console.log(
              'Heartbeat skipped',
              error
            );
          }

        },
        1000 * 60 * 5
      );

    return () =>
      clearInterval(interval);

  }, [user]);

  // =====================================
  // GOOGLE SIGN IN
  // =====================================

  const signInWithGoogle =
    async () => {

      try {

        setLoading(true);

        const provider =
          new GoogleAuthProvider();

        provider.setCustomParameters({
          prompt:
            'select_account'
        });

        await signInWithPopup(
          auth,
          provider
        );

        console.log(
          'Google Sign In Successful'
        );

      } catch (error) {

        console.error(
          'Google Sign In Error:',
          error
        );

        throw error;

      } finally {

        setLoading(false);
      }
    };

  // =====================================
  // EMAIL SIGN UP
  // =====================================

  const signUpWithEmail =
    async (
      email: string,
      password: string,
      name: string
    ) => {

      try {

        const normalizedEmail =
          email
            .toLowerCase()
            .trim();

        const credential =
          await createUserWithEmailAndPassword(
            auth,
            normalizedEmail,
            password
          );

        await updateProfile(
          credential.user,
          {
            displayName:
              name
          }
        );

      } catch (error) {

        console.error(
          'Email Sign Up Error:',
          error
        );

        throw error;
      }
    };

  // =====================================
  // EMAIL SIGN IN
  // =====================================

  const signInWithEmail =
    async (
      email: string,
      password: string
    ) => {

      try {

        const normalizedEmail =
          email
            .toLowerCase()
            .trim();

        await signInWithEmailAndPassword(
          auth,
          normalizedEmail,
          password
        );

      } catch (error) {

        console.error(
          'Email Sign In Error:',
          error
        );

        throw error;
      }
    };

  // =====================================
  // RECAPTCHA
  // =====================================

  const setupRecaptcha =
    async (
      containerId: string
    ) => {

      return new RecaptchaVerifier(
        auth,
        containerId,
        {
          size:
            'invisible'
        }
      );
    };

  // =====================================
  // PHONE SIGN IN
  // =====================================

  const signInWithPhone =
    async (
      phoneNumber: string,
      verifier: RecaptchaVerifier
    ) => {

      try {

        return await signInWithPhoneNumber(
          auth,
          phoneNumber,
          verifier
        );

      } catch (error) {

        console.error(
          'Phone Sign In Error:',
          error
        );

        throw error;
      }
    };

  // =====================================
  // UPDATE LOCATION
  // =====================================

  const updateLocation =
    async () => {

      if (!user) return;

      if (
        'geolocation' in navigator
      ) {

        navigator.geolocation.getCurrentPosition(
          async (
            position
          ) => {

            try {

              const {
                latitude,
                longitude
              } =
                position.coords;

              const userRef =
                doc(
                  db,
                  'users',
                  user.uid
                );

              await updateDoc(
                userRef,
                {
                  latitude,
                  longitude,
                  updatedAt:
                    serverTimestamp()
                }
              );

              setProfile(
                (
                  prev: any
                ) => ({
                  ...prev,
                  latitude,
                  longitude
                })
              );

            } catch (error) {

              console.error(
                'Location Update Error:',
                error
              );
            }
          }
        );
      }
    };

  // =====================================
  // UPDATE ROLES
  // =====================================

  const updateRoles =
    async (
      roles: string[]
    ) => {

      if (!user) return;

      try {

        const userRef = doc(
          db,
          'users',
          user.uid
        );

        await updateDoc(
          userRef,
          {
            roles,
            updatedAt:
              serverTimestamp()
          }
        );

        setProfile(
          (
            prev: any
          ) => ({
            ...prev,
            roles
          })
        );

      } catch (error) {

        console.error(
          'Role Update Error:',
          error
        );
      }
    };

  // =====================================
  // LOGOUT
  // =====================================

  const logout =
    async () => {

      try {

        await signOut(auth);

      } catch (error) {

        console.error(
          'Logout Error:',
          error
        );
      }
    };

  // =====================================
  // PROVIDER
  // =====================================

  return (

    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        viewMode,
        setViewMode,
        signInWithGoogle,
        signUpWithEmail,
        signInWithEmail,
        setupRecaptcha,
        signInWithPhone,
        logout,
        updateLocation,
        updateRoles
      }}
    >

      {children}

    </AuthContext.Provider>
  );
};

// =====================================
// HOOK
// =====================================

export const useAuth = () => {

  const context =
    useContext(AuthContext);

  if (!context) {

    throw new Error(
      'useAuth must be used within AuthProvider'
    );
  }

  return context;
};
```
