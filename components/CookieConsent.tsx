"use client";

import Script from "next/script";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import MixpanelClient from "@/components/MixpanelClient";
import MixpanelAutocapture from "@/components/MixpanelAutocapture";

const CONSENT_STORAGE_KEY = "kloner.cookieConsent.v1";
const GA_ID = "G-FVKJJK0379";
const NON_ESSENTIAL_COOKIE_NAMES = ["_ga", "_gid", "_gat", "_gcl_au", "kl_aff_ref", "kl_aff_code"];

export type CookieConsentStatus = "unknown" | "accepted" | "necessary";

type CookieConsentContextValue = {
    status: CookieConsentStatus;
    acceptNecessaryCookies: () => void;
    acceptNecessaryOnlyCookies: () => void;
    openCookieSettings: () => void;
};

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

function readStoredConsent(): CookieConsentStatus {
    if (typeof window === "undefined") return "unknown";
    try {
        const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
        if (raw === "accepted") return "accepted";
        if (raw === "necessary" || raw === "rejected") return "necessary";
    } catch {
        // ignore storage failures
    }
    return "unknown";
}

function persistConsent(status: Exclude<CookieConsentStatus, "unknown">) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(CONSENT_STORAGE_KEY, status);
    } catch {
        // ignore storage failures
    }
}

function setGoogleAnalyticsDisabled(disabled: boolean) {
    if (typeof window === "undefined") return;
    try {
        (window as any)[`ga-disable-${GA_ID}`] = disabled;
    } catch {
        // ignore
    }
}

function clearCookie(name: string) {
    if (typeof document === "undefined") return;
    const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function clearNonEssentialTrackingState() {
    if (typeof window === "undefined") return;

    setGoogleAnalyticsDisabled(true);

    try {
        for (const name of NON_ESSENTIAL_COOKIE_NAMES) {
            clearCookie(name);
        }
    } catch {
        // ignore cookie cleanup failures
    }

    try {
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (!key) continue;
            if (key.startsWith("mp_") || key.startsWith("mixpanel")) keys.push(key);
        }
        for (const key of keys) {
            window.localStorage.removeItem(key);
        }
    } catch {
        // ignore storage cleanup failures
    }
}

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
    const [status, setStatus] = useState<CookieConsentStatus>(() => readStoredConsent());

    const acceptNecessaryCookies = () => {
        persistConsent("accepted");
        setGoogleAnalyticsDisabled(false);
        setStatus("accepted");
    };

    const acceptNecessaryOnlyCookies = () => {
        persistConsent("necessary");
        clearNonEssentialTrackingState();
        setStatus("necessary");
    };

    const openCookieSettings = () => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.removeItem(CONSENT_STORAGE_KEY);
        } catch {
            // ignore storage failures
        }
        clearNonEssentialTrackingState();
        setStatus("unknown");
    };

    const value = useMemo(
        () => ({ status, acceptNecessaryCookies, acceptNecessaryOnlyCookies, openCookieSettings }),
        [status],
    );

    return <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>;
}

export function useCookieConsent() {
    const ctx = useContext(CookieConsentContext);
    if (!ctx) {
        throw new Error("useCookieConsent must be used within a CookieConsentProvider");
    }
    return ctx;
}

export function CookieConsentBanner() {
    const { status, acceptNecessaryCookies, acceptNecessaryOnlyCookies } = useCookieConsent();
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) return null;
    if (status !== "unknown") return null;

    return (
        <div className="fixed inset-x-0 bottom-0 z-[22000] px-3 pb-3 sm:px-4 sm:pb-4">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)] sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                        Cookie check
                    </div>
                    <div className="mt-1 text-sm font-semibold text-neutral-900">
                        Essential cookies keep login, previews, routing, and app scope working.
                    </div>
                    <div className="mt-1 text-sm text-neutral-600">
                        Analytics and affiliate cookies stay off unless you allow them. You can continue with essential cookies only.
                    </div>
                </div>

                <div className="flex items-center gap-4 sm:justify-end">
                    <button
                        type="button"
                        onClick={acceptNecessaryCookies}
                        className="rounded-full bg-[#FF8D21] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95"
                    >
                        Accept all cookies
                    </button>
                    <button
                        type="button"
                        onClick={acceptNecessaryOnlyCookies}
                        className="text-sm font-medium text-neutral-600 underline decoration-neutral-400 underline-offset-4 transition hover:text-neutral-900"
                    >
                        No, just essential
                    </button>
                </div>
            </div>
        </div>
    );
}

export function AnalyticsScripts() {
    const { status } = useCookieConsent();

    if (status !== "accepted") return null;

    return (
        <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script src="/ga-init.js" strategy="afterInteractive" />
        </>
    );
}

export function ConsentAwareTracking() {
    const { status } = useCookieConsent();

    if (status !== "accepted") return null;

    return (
        <>
            <MixpanelClient />
            <MixpanelAutocapture />
        </>
    );
}
