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
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';

import { auth, db } from '../../lib/firebase';

// =====================================
// TYPES
// =====================================
interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;
  viewMode: 'buyer' | 'seller';

  setViewMode: (
    mode: 'buyer' | 'seller'
  ) => void;

  signInWithGoogle: () => Promise<void>;

  logout: () => Promise<void>;

  updateLocation: () => Promise<void>;

  updateRoles: (
    roles: string[]
  ) => Promise<void>;
}

// =====================================
// CONTEXT
// =====================================
const AuthContext = createContext<
  AuthContextType | undefined
>(undefined);

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
    useState<'buyer' | 'seller'>(
      'buyer'
    );

  // =====================================
  // AUTH LISTENER
  // =====================================
  useEffect(() => {
    let isMounted = true;

    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        console.log(
          'ℹ️ Safety timeout triggered'
        );

        setLoading(false);
      }
    }, 5000);

    const unsubscribe =
      onAuthStateChanged(
        auth,
        async (currentUser) => {
          if (!isMounted) return;

          console.log(
            '🔥 Auth state:',
            currentUser?.uid
          );

          setUser(currentUser);

          // USER LOGGED OUT
          if (!currentUser) {
            setProfile(null);
            setLoading(false);
            return;
          }

          const userRef = doc(
            db,
            'users',
            currentUser.uid
          );

          try {
            console.log(
              '🔥 Fetching user profile...'
            );

            let userSnap = null;

            // =====================================
            // SAFE FETCH
            // =====================================
            try {
              userSnap = await getDoc(
                userRef
              );
            } catch (fetchError) {
              console.log(
                'ℹ️ User document not available yet'
              );

              // CREATE FALLBACK USER
              const fallbackUser = {
                userId:
                  currentUser.uid,

                displayName:
                  currentUser.displayName ||
                  'User',

                email:
                  currentUser.email,

                photoURL:
                  currentUser.photoURL ||
                  null,

                verificationStatus:
                  'unverified',

                totalTrades: 0,

                averageRating: 0,

                badge: null,

                followersCount: 0,

                followingCount: 0,

                fcmToken: null,

                roles: ['buyer'],

                isAdmin: false,

                createdAt:
                  serverTimestamp()
              };

              try {
                await setDoc(
                  userRef,
                  fallbackUser,
                  { merge: true }
                );

                console.log(
                  '✅ Fallback user document created'
                );
              } catch (createError) {
                console.log(
                  'ℹ️ Could not create fallback document yet',
                  createError
                );
              }

              setProfile({
                ...fallbackUser,
                fallback: true
              });

              setLoading(false);

              return;
            }

            // =====================================
            // USER EXISTS
            // =====================================
            if (userSnap.exists()) {
              const data =
                userSnap.data();

              console.log(
                '✅ User exists'
              );

              // ADMIN AUTO SETUP
              if (
                currentUser.email ===
                  'realmswebs@gmail.com' &&
                (!data.isAdmin ||
                  data.badge !==
                    'Elite Producer')
              ) {
                const adminUpdate = {
                  verificationStatus:
                    'verified',

                  averageRating: 5.0,

                  totalTrades: 100,

                  badge:
                    'Elite Producer',

                  isAdmin: true,

                  roles: [
                    'buyer',
                    'seller',
                    'admin'
                  ],

                  updatedAt:
                    serverTimestamp()
                };

                await updateDoc(
                  userRef,
                  adminUpdate
                );

                setProfile({
                  ...data,
                  ...adminUpdate
                });
              } else {
                // ENSURE ROLES EXIST
                if (
                  !data.roles ||
                  data.roles.length === 0
                ) {
                  data.roles = [
                    'buyer'
                  ];
                }

                setProfile(data);

                if (
                  data.roles.includes(
                    'seller'
                  )
                ) {
                  setViewMode(
                    'seller'
                  );
                }
              }
            }

            // =====================================
            // CREATE NEW USER
            // =====================================
            else {
              console.log(
                '🆕 Creating new user profile...'
              );

              const isAdmin =
                currentUser.email ===
                'realmswebs@gmail.com';

              const newUser = {
                userId:
                  currentUser.uid,

                displayName:
                  currentUser.displayName ||
                  (isAdmin
                    ? 'Hema Trader'
                    : 'Farmer'),

                email:
                  currentUser.email,

                photoURL:
                  currentUser.photoURL,

                verificationStatus:
                  isAdmin
                    ? 'verified'
                    : 'unverified',

                totalTrades:
                  isAdmin
                    ? 100
                    : 0,

                averageRating:
                  isAdmin
                    ? 5.0
                    : 0,

                badge: isAdmin
                  ? 'Elite Producer'
                  : null,

                followersCount: 0,

                followingCount: 0,

                fcmToken: null,

                roles: isAdmin
                  ? [
                      'buyer',
                      'seller',
                      'admin'
                    ]
                  : ['buyer'],

                isAdmin,

                createdAt:
                  serverTimestamp()
              };

              await setDoc(
                userRef,
                newUser
              );

              setProfile(newUser);
            }
          } catch (error) {
            console.log(
              'ℹ️ Temporary Firestore sync delay',
              error
            );

            setProfile({
              userId:
                currentUser.uid,

              email:
                currentUser.email,

              displayName:
                currentUser.displayName ||
                'User',

              fallback: true,

              roles: ['buyer']
            });
          }

          setLoading(false);
        }
      );

    return () => {
      isMounted = false;

      clearTimeout(
        safetyTimeout
      );

      unsubscribe();
    };
  }, []);

  // =====================================
  // HEARTBEAT
  // =====================================
  useEffect(() => {
    if (!user) return;

    const updateHeartbeat =
      async () => {
        try {
          const userRef = doc(
            db,
            'users',
            user.uid
          );

          const token =
            localStorage.getItem(
              'fcm_token_sim'
            ) ||
            `token_${Math.random()
              .toString(36)
              .substring(7)}`;

          localStorage.setItem(
            'fcm_token_sim',
            token
          );

          await updateDoc(
            userRef,
            {
              lastActiveAt:
                serverTimestamp(),

              fcmToken: token
            }
          );
        } catch {
          console.log(
            'ℹ️ Heartbeat skipped'
          );
        }
      };

    updateHeartbeat();

    const interval =
      setInterval(
        updateHeartbeat,
        1000 * 60 * 5
      );

    return () =>
      clearInterval(interval);
  }, [user]);

  // =====================================
  // UPDATE LOCATION
  // =====================================
  const updateLocation =
    async () => {
      if (!user) return;

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const {
            latitude,
            longitude
          } = pos.coords;

          const userRef = doc(
            db,
            'users',
            user.uid
          );

          await setDoc(
            userRef,
            {
              latitude,
              longitude
            },
            { merge: true }
          );

          setProfile(
            (prev: any) => ({
              ...prev,
              latitude,
              longitude
            })
          );
        }
      );
    };

  // =====================================
  // UPDATE ROLES
  // =====================================
  const updateRoles =
    async (roles: string[]) => {
      if (!user) return;

      const userRef = doc(
        db,
        'users',
        user.uid
      );

      await updateDoc(userRef, {
        roles,

        updatedAt:
          serverTimestamp()
      });

      setProfile((prev: any) => ({
        ...prev,
        roles
      }));

      if (
        roles.includes('seller')
      ) {
        setViewMode('seller');
      }
    };

  // =====================================
  // GOOGLE LOGIN
  // =====================================
  const signInWithGoogle =
    async () => {
      try {
        const provider =
          new GoogleAuthProvider();

        provider.setCustomParameters(
          {
            prompt:
              'select_account'
          }
        );

        console.log(
          '🚀 Starting Google popup login...'
        );

        await signInWithPopup(
          auth,
          provider
        );

        console.log(
          '✅ Google login success'
        );
      } catch (error) {
        console.log(
          'ℹ️ Google sign in cancelled or blocked',
          error
        );
      }
    };

  // =====================================
  // LOGOUT
  // =====================================
  const logout = async () => {
    await signOut(auth);
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
