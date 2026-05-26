// src/app/api/_lib/auth.ts
import { NextRequest, NextResponse } from "next/server";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, initializeFirestore } from "firebase-admin/firestore";
import crypto from "node:crypto";
import admin from "firebase-admin";

/* ───────── Shared constants ───────── */

export const CSRF_HEADER = "x-csrf";
export const CSRF_COOKIE = "csrf";
export const SESSION_COOKIE_NAME = "__session";

/* ───────── Helpers ───────── */

export function bad(status: number, error: string) {
    return NextResponse.json({ error }, { status });
}

function safeEqual(a: string, b: string) {
    const A = Buffer.from(a, "utf8");
    const B = Buffer.from(b, "utf8");
    return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/**
 * Enforce CSRF for all non-idempotent methods.
 * Expects the CSRF token in:
 *   - cookie:  `csrf`
 *   - header:  `x-csrf`
 *
 * IMPORTANT:
 *  - Logs what the server actually sees so you can debug mismatches.
 */
export function assertCsrf(req: NextRequest) {
    const m = req.method.toUpperCase();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return;

    const cookieRaw = req.cookies.get(CSRF_COOKIE)?.value ?? "";
    const headerRaw = req.headers.get(CSRF_HEADER) ?? "";

    const cookie = cookieRaw.trim();
    const header = headerRaw.trim();

    if (!cookie || !header) {
        console.warn("[csrf] missing token", { cookie, header });
        throw Object.assign(new Error("CSRF check failed"), { status: 403 });
    }

    // First: strict string equality (cheap / clear)
    if (cookie === header) {
        return;
    }

    // Second: timing-safe comparison (in case of weird encodings)
    const equal = safeEqual(cookie, header);
    if (!equal) {
        console.warn("[csrf] mismatch", {
            cookie,
            header,
            cookieLen: cookie.length,
            headerLen: header.length,
        });
        throw Object.assign(new Error("CSRF check failed"), { status: 403 });
    }
}

/* ───────── firebase-admin bootstrap ───────── */

/**
 * Single source of truth for firebase-admin initialization.
 * FIREBASE_SERVICE_ACCOUNT can be:
 * - base64-encoded JSON, or
 * - raw JSON
 */
export function initAdmin() {
    if (!getApps().length) {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT not set");

        let svc: Record<string, any>;
        try {
            const decoded = Buffer.from(raw, "base64").toString("utf8");
            svc = JSON.parse(decoded);
        } catch {
            try {
                svc = JSON.parse(raw);
            } catch {
                throw new Error(
                    "FIREBASE_SERVICE_ACCOUNT is invalid: not valid base64-encoded JSON or raw JSON"
                );
            }
        }

        initializeApp({ credential: cert(svc as any) });
    }
}

export function getAdminAuth() {
    initAdmin();
    return getAuth();
}

/** Use in any server route that needs Firebase Auth. */
export async function verifySession(req: NextRequest) {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) {
        throw Object.assign(
            new Error("Unauthorized (no session cookie)"),
            { status: 401 }
        );
    }

    const auth = getAdminAuth();

    try {
        return await auth.verifySessionCookie(token, true);
    } catch {
        throw Object.assign(
            new Error("Unauthorized (invalid/expired session)"),
            { status: 401 }
        );
    }
}

/** Use in any server route that needs Firestore. */
export function getAdminDb() {
    initAdmin();

    // Firestore Admin SDK uses gRPC by default. In local dev, gRPC can be flaky
    // (VPN/proxy/IPv6/port exhaustion) and produce errors like:
    //   "Received RST_STREAM" / "read EADDRNOTAVAIL".
    // The REST fallback is slower but much more reliable.
    const raw = (process.env.FIRESTORE_PREFER_REST || "").toLowerCase().trim();
    const preferRestExplicit = raw === "1" || raw === "true" ? true : raw === "0" || raw === "false" ? false : null;
    const preferRest = preferRestExplicit ?? (process.env.NODE_ENV !== "production");

    if (preferRest) {
        try {
            return initializeFirestore(getApp(), { preferRest: true });
        } catch {
            // If Firestore was already initialized elsewhere, fall back.
            return getFirestore();
        }
    }

    return getFirestore();
}

export async function requireAdmin(req: NextRequest) {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return { ok: false as const };

    try {
        const decoded = await getAdminAuth().verifyIdToken(token);
        const claims = decoded as any;
        if (!claims?.admin) return { ok: false as const };
        return { ok: true as const, uid: decoded.uid };
    } catch {
        return { ok: false as const };
    }
}