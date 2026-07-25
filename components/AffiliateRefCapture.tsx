"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCookieConsent } from "@/components/CookieConsent";

const COOKIE_REF = "kl_aff_ref";
const COOKIE_CODE = "kl_aff_code";
const LS_REF = "kl_aff_ref";
const LS_CODE = "kl_aff_code";

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

function setLocalStorage(key: string, value: string) {
    try {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(key, value);
    } catch {
        // ignore
    }
}

function clean(value: string) {
    return value.trim().slice(0, 128);
}

export default function AffiliateRefCapture() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { status } = useCookieConsent();

    useEffect(() => {
        if (status !== "accepted") return;
        if (!searchParams) return;

        // Support a few common param names. Standardize on `ref` + `code` going forward.
        const ref =
            searchParams.get("ref") ||
            searchParams.get("aff") ||
            searchParams.get("affiliate") ||
            "";

        const code =
            searchParams.get("code") ||
            searchParams.get("promo") ||
            searchParams.get("coupon") ||
            "";

        const refClean = clean(ref);
        const codeClean = clean(code);

        // 60 days attribution window (adjust any time)
        const maxAge = 60 * 24 * 60 * 60;

        if (refClean) {
            setCookie(COOKIE_REF, refClean, maxAge);
            setLocalStorage(LS_REF, refClean);
        }

        if (codeClean) {
            setCookie(COOKIE_CODE, codeClean, maxAge);
            setLocalStorage(LS_CODE, codeClean);
        }
    }, [pathname, searchParams, status]);

    return null;
}
