// components/auth/RequireAuth.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter, usePathname } from "next/navigation";
import { auth } from "@/lib/firebase";

type Props = {
    children: ReactNode;
};

export default function RequireAuth({ children }: Props): JSX.Element | null {
    const [ready, setReady] = useState<boolean>(false);
    const router = useRouter();
    const pathname = usePathname() ?? "/";

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (!u) {
                const next = encodeURIComponent(pathname);
                router.replace(`/login?next=${next}`);
            } else {
                setReady(true);
            }
        });
        return () => unsub();
    }, [router, pathname]);

    if (!ready) return null;
    return <>{children}</>;
}
