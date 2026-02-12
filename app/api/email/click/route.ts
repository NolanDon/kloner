// app/api/email/click/route.ts
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

function safeRedirectUrl(destUrl: string): string {
    try {
        const base = new URL(baseUrl());
        const u = new URL(destUrl);
        // only allow redirects back to our own origin
        if (u.origin !== base.origin) return base.toString();
        return u.toString();
    } catch {
        return baseUrl();
    }
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const t = searchParams.get("t") || "";
    const payload = verifySignedToken(t);

    const dest = safeRedirectUrl(typeof payload?.d === "string" ? payload.d : baseUrl());

    // best-effort logging
    try {
        if (payload && typeof payload.uid === "string" && typeof payload.c === "string") {
            const db = getAdminDb();
            const ua = req.headers.get("user-agent") || null;
            const ip =
                (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() ||
                req.headers.get("x-real-ip") ||
                null;
            await db.collection("email_clicks").add({
                uid: payload.uid,
                campaign: payload.c,
                step: typeof payload.s === "string" ? payload.s : null,
                dest,
                ts: Date.now(),
                userAgent: ua,
                ip,
            });
        }
    } catch (e) {
        console.error("[email-click] failed to record click", e);
    }

    return NextResponse.redirect(dest, 302);
}
