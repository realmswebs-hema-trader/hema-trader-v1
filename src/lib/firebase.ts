import { initializeApp } from 'firebase/app';

import { getAuth } from 'firebase/auth';

import {
  getFirestore,
  doc,
  getDocFromServer
} from 'firebase/firestore';

import { getStorage } from 'firebase/storage';

// ========================================
// FIREBASE CONFIG
// ========================================

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,

  authDomain:
    import.meta.env
      .VITE_FIREBASE_AUTH_DOMAIN,

  projectId:
    import.meta.env
      .VITE_FIREBASE_PROJECT_ID,

  storageBucket:
    import.meta.env
      .VITE_FIREBASE_STORAGE_BUCKET,

  messagingSenderId:
    import.meta.env
      .VITE_FIREBASE_MESSAGING_SENDER_ID,

  appId:
    import.meta.env
      .VITE_FIREBASE_APP_ID
};

// ========================================
// INITIALIZE FIREBASE
// ========================================

const app = initializeApp(
  firebaseConfig
);

export const auth = getAuth(app);

export const db =
  getFirestore(app);

export const storage =
  getStorage(app);

// ========================================
// CONNECTION TEST
// ========================================

async function testConnection() {
  try {
    await getDocFromServer(
      doc(db, 'test', 'connection')
    );

    console.log(
      '✅ Firebase connected'
    );
  } catch (error) {
    console.error(
      '❌ Firebase connection error:',
      error
    );
  }
}

testConnection();

// ========================================
// ERROR TYPES
// ========================================

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export interface FirestoreErrorInfo {
  error: string;

  operationType: OperationType;

  path: string | null;

  authInfo: {
    userId?: string | null;

    email?: string | null;

    emailVerified?: boolean | null;

    isAnonymous?: boolean | null;
  };
}

// ========================================
// ERROR HANDLER
// ========================================

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo =
    {
      error:
        error instanceof Error
          ? error.message
          : String(error),

      authInfo: {
        userId:
          auth.currentUser?.uid,

        email:
          auth.currentUser?.email,

        emailVerified:
          auth.currentUser
            ?.emailVerified,

        isAnonymous:
          auth.currentUser
            ?.isAnonymous
      },

      operationType,

      path
    };

  console.error(
    'Firestore Error:',
    JSON.stringify(errInfo)
  );

  throw new Error(
    JSON.stringify(errInfo)
  );
}
