// lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

/* ------------------------- config (env must be set) ------------------------- */
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID!,
};

/* ------------------------------- singletons -------------------------------- */
export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db: Firestore = getFirestore(app);
export const auth: Auth = getAuth(app);
export const storage: FirebaseStorage = getStorage(app);

/* ---------------------------- analytics (client) ---------------------------- */
/** Lazily init Analytics only in the browser. Returns null on SSR or if unsupported. */
let _analytics: Analytics | null = null;

export async function initAnalytics(): Promise<Analytics | null> {
    if (typeof window === "undefined") return null;
    if (_analytics) return _analytics;
    const supported = await isSupported().catch(() => false);
    if (!supported) return null;
    _analytics = getAnalytics(app);
    return _analytics;
}

// If you insist on a value export, you can use this promise:
// export const analyticsPromise = initAnalytics();
