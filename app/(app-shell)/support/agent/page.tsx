// app/(app-shell)/support/agent/page.tsx
"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { SupportAgentConsole } from "@/components/support/SupportAgentConsole";
// import your existing agent UI:

type GateState = "loading" | "allowed" | "denied";

export default function SupportAgentPage() {
    const [state, setState] = useState<GateState>("loading");

    useEffect(() => {
        const off = onAuthStateChanged(auth, async (u) => {
            if (!u) {
                setState("denied");
                return;
            }
            try {
                const tokenResult = await u.getIdTokenResult(true);
                const claims = tokenResult.claims as any;
                if (claims.supportAgent || claims.admin) {
                    setState("allowed");
                } else {
                    setState("denied");
                }
            } catch {
                setState("denied");
            }
        });
        return () => off();
    }, []);

    if (state === "loading") {
        return (
            <div className="p-6 text-sm text-neutral-600">
                Checking support access…
            </div>
        );
    }

    if (state === "denied") {
        return (
            <div className="p-6 text-sm text-red-600">
                You do not have access to the support console.
            </div>
        );
    }

    return <SupportAgentConsole />;
}
