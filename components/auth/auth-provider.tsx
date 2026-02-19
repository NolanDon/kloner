"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onIdTokenChanged, getIdTokenResult, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { bootstrapServerSession } from "@/lib/auth-client";

export type UserTier = "free" | "pro" | "agency" | "enterprise" | null;

type AuthContextType = {
    user: (User & Record<string, any>) | null;
    loading: boolean;
    isAdmin: boolean;
    userTier: UserTier;
};

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<(User & Record<string, any>) | null>(null);
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [userTier, setUserTier] = useState<UserTier>(null);

    const bootstrappedOnceRef = useRef(false);

    useEffect(() => {
        if (!auth) {
            setLoading(false);
            return;
        }
        const unsub = onIdTokenChanged(auth, async (authUser) => {
            try {
                if (authUser) {
                    // no forced refresh here
                    const tokenResult = await getIdTokenResult(authUser);

                    let firestoreData: Record<string, any> = {};
                    try {
                        const snap = await getDoc(doc(db, "users", authUser.uid));
                        if (snap.exists()) firestoreData = snap.data() || {};
                    } catch { }

                    setUser(Object.assign(authUser, firestoreData));
                    setIsAdmin(!!tokenResult.claims?.admin);
                    setUserTier((tokenResult.claims?.userTier as UserTier) || "free");

                    // Establish the server session cookie at most once per page load
                    // (and then rely on the global de-dupe + throttle in bootstrapServerSession).
                    if (!bootstrappedOnceRef.current) {
                        bootstrappedOnceRef.current = true;
                        void bootstrapServerSession({
                            forceRefresh: false,
                            minIntervalMs: 30 * 60 * 1000,
                            timeoutMs: 12_000,
                            reason: "auth_provider_init",
                        });
                    }
                } else {
                    setUser(null);
                    setIsAdmin(false);
                    setUserTier(null);
                    bootstrappedOnceRef.current = false;
                }
            } finally {
                setLoading(false);
            }
        });
        return () => unsub();
    }, []);

    const value = useMemo(() => ({ user, loading, isAdmin, userTier }), [user, loading, isAdmin, userTier]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Optional: convenient re-export so both imports work
export function useAuthFromProvider() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
    return ctx;
}
