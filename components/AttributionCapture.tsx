"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCookieConsent } from "@/components/CookieConsent";
import {
    FIRST_TOUCH_COOKIE,
    FIRST_TOUCH_LS_KEY,
    parseFirstTouch,
    type FirstTouchAttribution,
} from "@/lib/attribution";

// In-memory snapshot of the very first page view in this tab. Held only in
// JS memory (never persisted) so the true landing page and document.referrer
// survive until the visitor makes a cookie choice. If consent is granted it
// becomes the stored first touch; if the tab closes first, it is gone.
let pendingSnapshot: FirstTouchAttribution | null = null;

function setCookie(name: string, value: string, maxAgeSeconds: number) {
    try {
        if (typeof document === "undefined") return;
        const secure =
            typeof window !== "undefined" && window.location.protocol === "https:"
                ? "; Secure"
                : "";
        document.cookie = `${name}=${encodeURIComponent(
            value,
        )}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
    } catch {
        // ignore
    }
}

function readStoredFirstTouch(): FirstTouchAttribution | null {
    try {
        const raw = window.localStorage.getItem(FIRST_TOUCH_LS_KEY);
        if (raw) {
            const parsed = parseFirstTouch(JSON.parse(raw));
            if (parsed) return parsed;
        }
    } catch {
        // ignore
    }
    return null;
}

export default function AttributionCapture() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { status } = useCookieConsent();

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (readStoredFirstTouch()) return; // first touch already recorded

        if (!pendingSnapshot) {
            const get = (key: string) =>
                (searchParams?.get(key) || "").trim().slice(0, 256);
            pendingSnapshot = {
                landingPath: (pathname || window.location.pathname || "").slice(0, 256),
                referrer: (document.referrer || "").slice(0, 512),
                utmSource: get("utm_source"),
                utmMedium: get("utm_medium"),
                utmCampaign: get("utm_campaign"),
                utmTerm: get("utm_term"),
                utmContent: get("utm_content"),
                gclid: get("gclid"),
                capturedAt: new Date().toISOString(),
            };
        }

        // Persist only after the visitor accepts optional cookies.
        if (status !== "accepted") return;

        try {
            const json = JSON.stringify(pendingSnapshot);
            window.localStorage.setItem(FIRST_TOUCH_LS_KEY, json);
            // 60 days, matching the affiliate attribution window.
            setCookie(FIRST_TOUCH_COOKIE, json, 60 * 24 * 60 * 60);
        } catch {
            // ignore storage failures
        }
    }, [pathname, searchParams, status]);

    return null;
}
