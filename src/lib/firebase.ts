import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
} from 'firebase/firestore';

import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/*
  STABLE FIRESTORE INITIALIZATION
  Prevents transport loops and aggressive reconnect spam
*/
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({}),
  experimentalForceLongPolling: true,
});

const auth = getAuth(app);
const storage = getStorage(app);

export { app, db, auth, storage };
