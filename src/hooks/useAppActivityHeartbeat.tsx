"use client";

import { useEffect, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const HEARTBEAT_MIN_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

function isVisible(): boolean {
    if (typeof document === "undefined") return false;
    return document.visibilityState === "visible";
}

export function useAppActivityHeartbeat(source: string, enabled = true): void {
    const lastWriteAtRef = useRef(0);
    const uidRef = useRef<string | null>(null);

    useEffect(() => {
        if (!enabled) return;

        let disposed = false;

        const writeHeartbeat = async (reason: string) => {
            const uid = uidRef.current;
            if (!uid || disposed) return;

            const now = Date.now();
            if (now - lastWriteAtRef.current < HEARTBEAT_MIN_WRITE_INTERVAL_MS) return;

            lastWriteAtRef.current = now;

            try {
                await setDoc(
                    doc(db, "kloner_users", uid),
                    {
                        lastAppActivityAt: serverTimestamp(),
                        lastAppActivitySource: source,
                        lastAppActivityReason: reason,
                        lastAppActivityClientAt: now,
                    },
                    { merge: true },
                );
            } catch {
                // Best-effort only.
            }
        };

        const stopAuth = onAuthStateChanged(auth, (user) => {
            uidRef.current = user?.uid ?? null;
            if (user) {
                void writeHeartbeat("auth");
            }
        });

        const handleActivity = () => {
            void writeHeartbeat("activity");
        };

        const handleVisibility = () => {
            if (isVisible()) {
                void writeHeartbeat("visible");
            }
        };

        if (typeof window !== "undefined") {
            window.addEventListener("pointerdown", handleActivity, { passive: true });
            window.addEventListener("keydown", handleActivity);
            window.addEventListener("click", handleActivity, { passive: true });
            window.addEventListener("focus", handleActivity);
            document.addEventListener("visibilitychange", handleVisibility);

            const intervalId = window.setInterval(() => {
                if (isVisible()) void writeHeartbeat("interval");
            }, HEARTBEAT_INTERVAL_MS);

            void writeHeartbeat("mount");

            return () => {
                disposed = true;
                stopAuth();
                window.removeEventListener("pointerdown", handleActivity);
                window.removeEventListener("keydown", handleActivity);
                window.removeEventListener("click", handleActivity);
                window.removeEventListener("focus", handleActivity);
                document.removeEventListener("visibilitychange", handleVisibility);
                window.clearInterval(intervalId);
            };
        }

        return () => {
            disposed = true;
            stopAuth();
        };
    }, [enabled, source]);
}
