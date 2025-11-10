// components/auth/UserMenu.jsx
"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut, type User as FirebaseUser } from "firebase/auth";
import { useRouter } from "next/navigation";

export type User = FirebaseUser;

export default function UserMenu() {
    const [user, setUser] = useState<User | null>(null);
    const router = useRouter();
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, setUser);
        return () => unsub();
    }, []);
    if (!user) return null;

    return (
        <div className="inline-flex items-center gap-3">
            <span className="text-sm text-white/70">{user.displayName || user.email}</span>
            <button
                onClick={async () => {
                    await signOut(auth);
                    router.refresh();
                }}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
            >
                Sign out
            </button>
        </div>
    );
}
