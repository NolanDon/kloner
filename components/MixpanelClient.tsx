"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { initMixpanel, identifyMixpanel, resetMixpanel, trackMixpanel } from "@/lib/mixpanel";
import { useAuth } from "@/src/hooks/useAuth";

function safeSearchParams(sp: ReturnType<typeof useSearchParams> | null): string {
    try {
        const s = sp?.toString();
        return typeof s === "string" ? s : "";
    } catch {
        return "";
    }
}

export default function MixpanelClient() {
    const { user, userTier, isAdmin } = useAuth();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const urlKey = useMemo(() => {
        const qs = safeSearchParams(searchParams);
        return qs ? `${pathname}?${qs}` : pathname;
    }, [pathname, searchParams]);

    const lastTrackedUrlRef = useRef<string | null>(null);
    const lastIdentifiedUidRef = useRef<string | null>(null);

    useEffect(() => {
        initMixpanel();
    }, []);

    useEffect(() => {
        const uid = user?.uid || null;

        if (!uid) {
            if (lastIdentifiedUidRef.current) {
                lastIdentifiedUidRef.current = null;
                resetMixpanel();
            }
            return;
        }

        if (uid !== lastIdentifiedUidRef.current) {
            lastIdentifiedUidRef.current = uid;
            identifyMixpanel(uid, {
                userTier: userTier || null,
                isAdmin: !!isAdmin,
            });
        }
    }, [user?.uid, userTier, isAdmin]);

    useEffect(() => {
        if (!urlKey) return;
        if (urlKey === lastTrackedUrlRef.current) return;
        lastTrackedUrlRef.current = urlKey;

        trackMixpanel("Page Viewed", {
            pathname,
            url: urlKey,
        });
    }, [urlKey, pathname]);

    return null;
}
