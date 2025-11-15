// src/app/api/_lib/auth.ts
import { NextRequest, NextResponse } from "next/server";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import crypto from "node:crypto";

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
 * The `/api/auth/csrf` route must NOT call this (it issues the token).
 */
export function assertCsrf(req: NextRequest) {
    const m = req.method.toUpperCase();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return;

    const cookie = req.cookies.get(CSRF_COOKIE)?.value || "";
    const header = req.headers.get(CSRF_HEADER) || "";

    if (!cookie || !header || !safeEqual(cookie, header)) {
        throw Object.assign(new Error("Forbidden (csrf)"), { status: 403 });
    }
}

/* ───────── firebase-admin bootstrap ───────── */

/**
 * Single source of truth for firebase-admin initialization.
 * FIREBASE_SERVICE_ACCOUNT can be:
 * - base64-encoded JSON, or
 * - raw JSON
 */
function initAdmin() {
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
    return getFirestore();
}
