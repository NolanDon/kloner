// components/auth/RequireAuth.jsx
"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter, usePathname } from "next/navigation";

export default function RequireAuth({ children }) {
    const [ready, setReady] = useState(false);
    const router = useRouter();
    const path = usePathname();

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (!u) {
                const next = encodeURIComponent(path || "/");
                router.replace(`/login?next=${next}`);
            } else {
                setReady(true);
            }
        });
        return () => unsub();
    }, [router, path]);

    if (!ready) return null;
    return children;
}
