import {
  FirebaseError,
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp
} from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch
} from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const requiredEnv = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const missingEnvKeys = Object.entries(requiredEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingEnvKeys.length > 0) {
  console.warn(
    `Firebase configuration is missing: ${missingEnvKeys.join(', ')}. ` +
      'Check your VITE_FIREBASE_* environment variables.'
  );
}

const firebaseConfig = {
  apiKey: requiredEnv.apiKey,
  authDomain: requiredEnv.authDomain,
  projectId: requiredEnv.projectId,
  storageBucket: requiredEnv.storageBucket,
  messagingSenderId: requiredEnv.messagingSenderId,
  appId: requiredEnv.appId
};

const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app);

export const COLLECTIONS = {
  USERS: 'users',
  LISTINGS: 'listings',
  TRADES: 'trades',
  DELIVERY_REQUESTS: 'deliveryRequests',
  WALLETS: 'wallets',
  WALLET_TRANSACTIONS: 'walletTransactions',
  NOTIFICATIONS: 'notifications',
  DRIVERS: 'drivers'
} as const;

export const OperationType = {
  READ: 'read',
  WRITE: 'write',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  TRANSACTION: 'transaction',
  SUBSCRIBE: 'subscribe'
} as const;

export type OperationType = (typeof OperationType)[keyof typeof OperationType];

export const handleFirestoreError = (
  error: unknown,
  operation: OperationType = OperationType.READ,
  path = 'firestore'
): string => {
  if (error instanceof FirebaseError) {
    console.error(`Firestore ${operation} error at ${path}:`, {
      code: error.code,
      message: error.message
    });

    switch (error.code) {
      case 'permission-denied':
        return 'You do not have permission to perform this action.';
      case 'unauthenticated':
        return 'Please sign in before continuing.';
      case 'not-found':
        return 'The requested record could not be found.';
      case 'already-exists':
        return 'This record already exists.';
      case 'failed-precondition':
        return 'This action cannot be completed in the current state.';
      case 'aborted':
        return 'This record was updated by another request. Please try again.';
      case 'unavailable':
        return 'The database is temporarily unavailable. Please try again.';
      case 'resource-exhausted':
        return 'Too many requests. Please wait and try again.';
      case 'deadline-exceeded':
        return 'The request took too long. Please try again.';
      case 'cancelled':
        return 'The request was cancelled. Please try again.';
      default:
        return error.message || 'A database error occurred.';
    }
  }

  if (error instanceof Error) {
    console.error(`Firestore ${operation} error at ${path}:`, error);
    return error.message;
  }

  console.error(`Firestore ${operation} error at ${path}:`, error);
  return 'Something went wrong. Please try again.';
};

export {
  app,
  auth,
  db,
  functions,
  runTransaction,
  serverTimestamp,
  storage,
  Timestamp,
  writeBatch
};
