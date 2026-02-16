// lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";
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
export const db: Firestore = (() => {
    // Firestore's default WebChannel transport can behave badly behind some VPNs/proxies.
    // Long polling is slower but far more reliable in those environments.
    //
    // Opt in via env so you can toggle without code changes:
    // - NEXT_PUBLIC_FIRESTORE_FORCE_LONG_POLLING=1
    // - NEXT_PUBLIC_FIRESTORE_AUTO_DETECT_LONG_POLLING=1
    const isBrowser = typeof window !== "undefined";
    const forceLongPolling = process.env.NEXT_PUBLIC_FIRESTORE_FORCE_LONG_POLLING === "1";
    const autoDetectLongPollingEnv = process.env.NEXT_PUBLIC_FIRESTORE_AUTO_DETECT_LONG_POLLING;
    const autoDetectLongPollingExplicit = autoDetectLongPollingEnv === "1" ? true : autoDetectLongPollingEnv === "0" ? false : null;
    // Default to auto-detect in dev to avoid flaky WebChannel behavior (VPNs/proxies/IPv6).
    const autoDetectLongPolling = autoDetectLongPollingExplicit ?? (process.env.NODE_ENV !== "production");

    if (isBrowser && (forceLongPolling || autoDetectLongPolling)) {
        try {
            const settings: any = {
                // Recommended by Firebase for environments with restrictive proxies.
                // Keep fetch streams off to avoid odd proxy interactions.
                useFetchStreams: false,
            };
            if (forceLongPolling) settings.experimentalForceLongPolling = true;
            if (autoDetectLongPolling) settings.experimentalAutoDetectLongPolling = true;
            return initializeFirestore(app, settings);
        } catch (err) {
            // If Firestore was already initialized elsewhere, fall back to the default instance.
            console.warn("Failed to initialize Firestore with long-polling settings; falling back to getFirestore()", err);
        }
    }

    return getFirestore(app);
})();
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
