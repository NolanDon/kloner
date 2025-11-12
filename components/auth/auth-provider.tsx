"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onIdTokenChanged, getIdTokenResult, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

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

    const lastTokenRef = useRef<string | null>(null);
    const syncingRef = useRef<Promise<any> | null>(null);

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

                    const idToken = await authUser.getIdToken(); // no-force
                    if (idToken && idToken !== lastTokenRef.current) {
                        lastTokenRef.current = idToken;
                        if (!syncingRef.current) {
                            syncingRef.current = fetch("/api/auth/session", {
                                method: "POST",
                                credentials: "include",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ idToken }),
                            }).finally(() => setTimeout(() => (syncingRef.current = null), 0));
                        }
                    }
                } else {
                    setUser(null);
                    setIsAdmin(false);
                    setUserTier(null);
                    lastTokenRef.current = null;
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
