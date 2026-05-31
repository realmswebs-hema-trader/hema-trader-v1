import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPhoneNumber as firebaseSignInWithPhoneNumber,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  type ConfirmationResult,
  type User
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';

import { auth, db } from '../../lib/firebase';
import {
  FOUNDER_NAME,
  getFounderUserFields,
  isFounderEmail,
  isReservedFounderName,
  normalizeNameKey,
  syncUserAndFounderOnAuth
} from '../../services/trustScoreService';

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
  currentLocation?: {
    latitude?: number;
    longitude?: number;
  };
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
  signInWithEmail: (email: string, password: string) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  registerWithEmail: (
    first: string,
    second: string,
    third?: string
  ) => Promise<void>;
  signUpWithEmail: (
    first: string,
    second: string,
    third?: string
  ) => Promise<void>;
  register: (first: string, second: string, third?: string) => Promise<void>;
  signUp: (first: string, second: string, third?: string) => Promise<void>;
  sendPhoneVerificationCode: (phoneNumber: string) => Promise<string>;
  sendPhoneCode: (phoneNumber: string) => Promise<string>;
  signInWithPhone: (phoneNumber: string) => Promise<string>;
  signInWithPhoneNumber: (phoneNumber: string) => Promise<string>;
  confirmPhoneVerificationCode: (code: string) => Promise<void>;
  confirmPhoneCode: (code: string) => Promise<void>;
  verifyPhoneCode: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  updateRoles: (roles: string[]) => Promise<void>;
  updateLocation: () => Promise<void>;
  updateProfilePhoto: (file: File) => Promise<string>;
  updateDisplayName: (displayName: string) => Promise<void>;
  updateAccountPassword: (password: string) => Promise<void>;
  switchRole: (role: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
