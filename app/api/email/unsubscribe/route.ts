// app/api/email/unsubscribe/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getAdminDb } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function baseUrl() {
    const v = (process.env.FRONTEND_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
    if (v) return v.replace(/\/$/, "");
    return "https://kloner.app";
}

function getEmailLinkSecret(): string {
    const s = (process.env.EMAIL_LINK_SECRET || "").trim();
    if (!s) throw new Error("EMAIL_LINK_SECRET env not set");
    return s;
}

function safeEqual(a: string, b: string): boolean {
    const A = Buffer.from(a, "utf8");
    const B = Buffer.from(b, "utf8");
    return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function verifySignedToken(t: string): any | null {
    const token = (t || "").trim();
    const m = token.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    const body = m[1]!;
    const sig = m[2]!;
    const expected = crypto.createHmac("sha256", getEmailLinkSecret()).update(body).digest("base64url");
    if (!safeEqual(sig, expected)) return null;
    try {
        const json = Buffer.from(body, "base64url").toString("utf8");
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function redirectTo(status: "ok" | "invalid" | "missing", kind?: "journey" | "product" | "all") {
    const u = new URL(`${baseUrl()}/settings`);
    u.searchParams.set("tab", "notifications");
    u.searchParams.set("unsub", status);
    if (status === "ok" && kind) u.searchParams.set("k", kind);
    return u.toString();
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const t = (searchParams.get("t") || "").trim();
    if (!t) return NextResponse.redirect(redirectTo("missing"), 302);

    const payload = verifySignedToken(t);
    const uid = typeof payload?.uid === "string" ? payload.uid : "";
    const kind = (typeof payload?.k === "string" ? payload.k : "") as "journey" | "product" | "all" | "";

    if (!uid || !(kind === "journey" || kind === "product" || kind === "all")) {
        return NextResponse.redirect(redirectTo("invalid"), 302);
    }

    try {
        const db = getAdminDb();
        const ref = db.collection("kloner_users").doc(uid);
        const snap = await ref.get();
        const data = snap.exists ? (snap.data() as any) : {};
        const existing = (data?.notificationPrefs || {}) as any;

        const nextPrefs = {
            ...existing,
            ...(kind === "journey" || kind === "all" ? { journeyEmails: false } : null),
            ...(kind === "product" || kind === "all" ? { productEmails: false } : null),
        };

        await ref.set(
            {
                notificationPrefs: nextPrefs,
                notificationPrefsUpdatedAt: Date.now(),
                notificationUnsubbedAt: Date.now(),
                notificationUnsubbedKind: kind,
            },
            { merge: true },
        );

        return NextResponse.redirect(redirectTo("ok", kind), 302);
    } catch (e) {
        console.error("[email-unsubscribe] failed", e);
        return NextResponse.redirect(redirectTo("invalid"), 302);
    }
}
