// hooks/useVercelIntegration.ts
import { useCallback, useEffect, useState } from "react";

export type VercelStatus = "loading" | "connected" | "disconnected" | "error";

type VercelStatusResponse = {
    connected: boolean;
    reason?: string;
    transientError?: boolean;
    user?: { id?: string; email?: string; name?: string } | null;
};

export function useVercelIntegration() {
    const [status, setStatus] = useState<VercelStatus>("loading");
    const [meta, setMeta] = useState<VercelStatusResponse | null>(null);
    const [checking, setChecking] = useState(false);

    const refresh = useCallback(async () => {
        setChecking(true);
        try {
            const res = await fetch("/api/vercel/status", {
                method: "GET",
                cache: "no-store",
            });

            if (!res.ok) {
                setStatus("error");
                setMeta(null);
                return;
            }

            const json = (await res.json()) as VercelStatusResponse;
            setMeta(json);
            setStatus(json.connected ? "connected" : "disconnected");
        } catch {
            setStatus("error");
            setMeta(null);
        } finally {
            setChecking(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return {
        status,
        meta,
        checking,
        refresh,
    };
}
