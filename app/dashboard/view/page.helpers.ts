// app/dashboard/view/page.helpers.ts
import { useCallback, useEffect, useState } from "react";
import type { Timestamp } from "firebase/firestore";

export type UserTier = "free" | "pro" | "agency" | "enterprise" | "unknown";

export const CREDIT_LIMITS: Record<UserTier, { screenshotDaily: number; previewDaily: number }> = {
    free: { screenshotDaily: 3, previewDaily: 5 },
    pro: { screenshotDaily: 100, previewDaily: 200 },
    agency: { screenshotDaily: 400, previewDaily: 800 },
    enterprise: { screenshotDaily: 0, previewDaily: 0 }, // 0 = unlimited
    unknown: { screenshotDaily: 0, previewDaily: 0 },
};

export function isHttpUrl(s?: string): s is string {
    if (!s) return false;
    try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

export function normUrl(s: string): string {
    try {
        const u = new URL(s);
        u.hash = "";
        return u.toString();
    } catch {
        return s.trim();
    }
}

export function hash64(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(36);
}

export function ensureHttp(u: string): string {
    if (!u) return "";
    const s = u.trim();
    if (!s) return "";
    return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
}


export function tsToMs(v: any): number {
    if (!v) return 0;
    if (v instanceof Date) return v.getTime();
    if (typeof (v as Timestamp)?.toDate === "function") return (v as Timestamp).toDate().getTime();
    if (typeof v === "number") return v;
    return 0;
}

export function extractHashFromKey(key?: string | null): string | null {
    if (!key) return null;
    const file = (key.split("?")[0] || "").split("/").pop() || "";
    const stem = file.replace(/\.(jpe?g|png|webp|gif|bmp|tiff)$/i, "");
    const m = stem.match(/(\d+)$/) || stem.match(/([A-Za-z0-9]+)$/);
    return m ? m[1] || m[0] : null;
}

export function shortVersionFromShotPath(
    path: string,
    fallbackHash?: string | null,
    minChars = 4
): string {
    const base = extractHashFromKey(path) || fallbackHash || "";
    if (!base) return "v";

    const cleaned = base.replace(/[^A-Za-z0-9]/g, "");

    // If there is a trailing digit run:
    const digitTailMatch = cleaned.match(/(\d+)$/);
    const digitTail = digitTailMatch ? digitTailMatch[1] : "";

    // If the trailing digit run is long enough, use its last minChars digits, e.g. timestamps.
    if (digitTail && digitTail.length >= minChars) {
        return digitTail.slice(-minChars);
    }

    // Otherwise, drop the short trailing digit run and take last minChars from the rest.
    let token = cleaned;
    if (digitTail && digitTail.length < minChars) {
        token = cleaned.slice(0, -digitTail.length) || cleaned;
    }

    if (token.length >= minChars) return token.slice(-minChars);
    return token || "v";
}


export function rendersEqual(
    a: Array<{ id: string; status: string; html?: string | null; key?: string | null; nameHint?: string | null }>,
    b: Array<{ id: string; status: string; html?: string | null; key?: string | null; nameHint?: string | null }>,
): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        if (x.id !== y.id) return false;
        if (x.status !== y.status) return false;
        if ((x.html || "") !== (y.html || "")) return false;
        if ((x.key || "") !== (y.key || "")) return false;
        if ((x.nameHint || "") !== (y.nameHint || "")) return false;
    }
    return true;
}

export function useCooldown(initialUntil = 0) {
    const [until, setUntil] = useState<number>(initialUntil);
    const [now, setNow] = useState<number>(Date.now());

    useEffect(() => {
        if (until <= Date.now()) return;
        const t = setInterval(() => {
            setNow(Date.now());
            if (Date.now() >= until) clearInterval(t);
        }, 500);
        return () => clearInterval(t);
    }, [until]);

    const remaining = Math.max(0, Math.ceil((until - now) / 1000));
    const start = useCallback((ms: number) => setUntil(Date.now() + ms), []);
    const clear = useCallback(() => setUntil(0), []);

    return { remaining, active: remaining > 0, start, clear };
}
