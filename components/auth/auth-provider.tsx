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
    const syncingRef = useRef<{ startedAt: number } | null>(null);

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const fetchWithTimeout = async (url: string, init: RequestInit & { timeoutMs?: number }) => {
        const timeoutMs = typeof init.timeoutMs === "number" ? init.timeoutMs : 12_000;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const { timeoutMs: _omit, ...rest } = init;
            return await fetch(url, { ...rest, signal: ctrl.signal });
        } finally {
            clearTimeout(t);
        }
    };

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

                        const now = Date.now();
                        const inFlight = syncingRef.current;
                        const stale = inFlight && now - inFlight.startedAt > 20_000;
                        if (!inFlight || stale) {
                            syncingRef.current = { startedAt: now };

                            void (async () => {
                                // Establish session (best-effort, with timeout).
                                try {
                                    await fetchWithTimeout(
                                        "/api/auth/session",
                                        {
                                            method: "POST",
                                            credentials: "include",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ idToken }),
                                            cache: "no-store",
                                            timeoutMs: 20_000,
                                        }
                                    );
                                } catch (e) {
                                    console.warn("Session bootstrap failed (timed out or errored)", e);
                                }

                                // Fetch CSRF token to ensure it's available for POST routes.
                                // If the session cookie isn't ready yet, this may 401; retry once shortly after.
                                for (let attempt = 0; attempt < 2; attempt++) {
                                    try {
                                        const res = await fetchWithTimeout(
                                            "/api/auth/csrf",
                                            {
                                                method: "POST",
                                                credentials: "include",
                                                headers: { "Content-Type": "application/json" },
                                                cache: "no-store",
                                                timeoutMs: 12_000,
                                            }
                                        );
                                        if (res.ok) break;
                                    } catch (error) {
                                        // ignore and retry once
                                    }
                                    await sleep(500);
                                }
                            })().finally(() => {
                                // Always clear so we can retry later if needed.
                                syncingRef.current = null;
                            });
                        }
                    }
                } else {
                    setUser(null);
                    setIsAdmin(false);
                    setUserTier(null);
                    lastTokenRef.current = null;
                    syncingRef.current = null;
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
