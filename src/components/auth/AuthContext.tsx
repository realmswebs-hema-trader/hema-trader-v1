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
  db,
  handleFirestoreError,
  OperationType
} from '../../lib/firebase';

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
  createContext<
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
    const unsubscribe =
      onAuthStateChanged(
        auth,
        async (currentUser) => {
          try {
            if (currentUser) {
              setLoading(true);

              const userDocRef = doc(
                db,
                'users',
                currentUser.uid
              );

              const userDoc =
                await getDoc(
                  userDocRef
                );

              // =====================================
              // USER EXISTS
              // =====================================

              if (userDoc.exists()) {
                const userData =
                  userDoc.data();

                // ADMIN AUTO SYNC
                if (
                  currentUser.email ===
                  'realmswebs@gmail.com'
                ) {
                  const isAdminData =
                    userData.roles?.includes(
                      'admin'
                    ) &&
                    userData.isAdmin ===
                      true;

                  const isFullyVerified =
                    userData.verificationStatus ===
                      'verified' &&
                    userData.badge ===
                      'Elite Producer';

                  if (
                    !isAdminData ||
                    !isFullyVerified
                  ) {
                    const adminUpdates =
                      {
                        verificationStatus:
                          'verified',

                        averageRating:
                          5.0,

                        totalTrades:
                          100,

                        badge:
                          'Elite Producer',

                        isAdmin: true,

                        roles: [
                          'buyer',
                          'seller',
                          'admin'
                        ],

                        updatedAt:
                          serverTimestamp(),

                        lastActiveAt:
                          serverTimestamp()
                      };

                    await updateDoc(
                      userDocRef,
                      adminUpdates
                    );

                    setProfile({
                      ...userData,
                      ...adminUpdates
                    });
                  } else {
                    setProfile(
                      userData
                    );
                  }
                } else {
                  setProfile(
                    userData
                  );

                  if (
                    userData.roles?.includes(
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
              // CREATE USER
              // =====================================

              else {
                const isAdminEmail =
                  currentUser.email ===
                  'realmswebs@gmail.com';

                const newProfile = {
                  userId:
                    currentUser.uid,

                  displayName:
                    currentUser.displayName ||
                    (isAdminEmail
                      ? 'Admin Farmer'
                      : 'Hema User'),

                  email:
                    currentUser.email,

                  phoneNumber:
                    currentUser.phoneNumber,

                  photoURL:
                    currentUser.photoURL,

                  verificationStatus:
                    isAdminEmail
                      ? 'verified'
                      : 'unverified',

                  totalTrades:
                    isAdminEmail
                      ? 100
                      : 0,

                  averageRating:
                    isAdminEmail
                      ? 5.0
                      : 0,

                  badge:
                    isAdminEmail
                      ? 'Elite Producer'
                      : null,

                  followersCount: 0,

                  followingCount: 0,

                  fcmToken: null,

                  roles:
                    isAdminEmail
                      ? [
                          'buyer',
                          'seller',
                          'admin'
                        ]
                      : [],

                  isAdmin:
                    isAdminEmail,

                  createdAt:
                    serverTimestamp(),

                  lastActiveAt:
                    serverTimestamp()
                };

                await setDoc(
                  userDocRef,
                  newProfile
                );

                setProfile(
                  newProfile
                );
              }

              setUser(currentUser);
            }

            // =====================================
            // LOGGED OUT
            // =====================================

            else {
              setUser(null);

              setProfile(null);
            }
          } catch (error) {
            console.error(
              'Auth State Change Error:',
              error
            );
          } finally {
            setLoading(false);
          }
        }
      );

    return () => unsubscribe();
  }, []);

  // =====================================
  // HEARTBEAT
  // =====================================

  useEffect(() => {
    if (!user) return;

    const updateHeartbeat =
      async () => {
        try {
          const userDocRef = doc(
            db,
            'users',
            user.uid
          );

          const mockToken =
            localStorage.getItem(
              'fcm_token_sim'
            ) ||
            `token_${Math.random()
              .toString(36)
              .substring(7)}`;

          localStorage.setItem(
            'fcm_token_sim',
            mockToken
          );

          await updateDoc(
            userDocRef,
            {
              lastActiveAt:
                serverTimestamp(),

              fcmToken:
                mockToken
            }
          );
        } catch {
          console.log(
            'Heartbeat skipped'
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

      if (
        'geolocation' in navigator
      ) {
        navigator.geolocation.getCurrentPosition(
          async (
            position
          ) => {
            const {
              latitude,
              longitude
            } = position.coords;

            const userDocRef =
              doc(
                db,
                'users',
                user.uid
              );

            try {
              await setDoc(
                userDocRef,
                {
                  latitude,
                  longitude
                },
                {
                  merge: true
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
              handleFirestoreError(
                error,
                OperationType.UPDATE,
                `users/${user.uid}`
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

      const userDocRef = doc(
        db,
        'users',
        user.uid
      );

      try {
        await updateDoc(
          userDocRef,
          {
            roles,

            updatedAt:
              serverTimestamp()
          }
        );

        setProfile(
          (prev: any) => ({
            ...prev,
            roles
          })
        );

        if (
          roles.includes(
            'seller'
          )
        ) {
          setViewMode(
            'seller'
          );
        }
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.UPDATE,
          `users/${user.uid}`
        );
      }
    };

  // =====================================
  // GOOGLE SIGN IN
  // =====================================

  const signInWithGoogle =
    async () => {
      const provider =
        new GoogleAuthProvider();

      try {
        provider.setCustomParameters(
          {
            prompt:
              'select_account'
          }
        );

        await signInWithPopup(
          auth,
          provider
        );

        console.log(
          '✅ Google Sign In Success'
        );
      } catch (error) {
        console.error(
          'Google Sign In Error',
          error
        );

        throw error;
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
        const userCredential =
          await createUserWithEmailAndPassword(
            auth,
            email,
            password
          );

        await updateProfile(
          userCredential.user,
          {
            displayName:
              name
          }
        );
      } catch (error) {
        console.error(
          'Email Sign Up Error',
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
        await signInWithEmailAndPassword(
          auth,
          email,
          password
        );
      } catch (error) {
        console.error(
          'Email Sign In Error',
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
      const verifier =
        new RecaptchaVerifier(
          auth,
          containerId,
          {
            size:
              'invisible'
          }
        );

      return verifier;
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
          'Phone Sign In Error',
          error
        );

        throw error;
      }
    };

  // =====================================
  // LOGOUT
  // =====================================

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(
        'Logout Error',
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

  if (
    context === undefined
  ) {
    throw new Error(
      'useAuth must be used within an AuthProvider'
    );
  }

  return context;
};
