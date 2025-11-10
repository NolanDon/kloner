// src/app/api/_lib/auth.ts
import { NextRequest, NextResponse } from 'next/server';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'node:crypto';

export function bad(status: number, error: string) {
    return NextResponse.json({ error }, { status });
}

const CSRF_HEADER = 'x-csrf';
const CSRF_COOKIE = 'csrf';
const SESSION_COOKIE_NAME = '__session'; // <-- use Firebase-compatible cookie name

function safeEqual(a: string, b: string) {
    const A = Buffer.from(a, 'utf8');
    const B = Buffer.from(b, 'utf8');
    return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export function assertCsrf(req: NextRequest) {
    const m = req.method.toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
    const cookie = req.cookies.get(CSRF_COOKIE)?.value || '';
    const header = req.headers.get(CSRF_HEADER) || '';
    if (!cookie || !header || !safeEqual(cookie, header)) {
        throw Object.assign(new Error('Forbidden (csrf)'), { status: 403 });
    }
}

function initAdmin() {
    if (!getApps().length) {
        const base64 = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (!base64) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
        const svc = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
        initializeApp({ credential: cert(svc) });
    }
}

export async function verifySession(req: NextRequest) {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) throw Object.assign(new Error('Unauthorized (no session cookie)'), { status: 401 });
    initAdmin();
    try {
        return await getAuth().verifySessionCookie(token, true);
    } catch (err: any) {
        throw Object.assign(new Error('Unauthorized (invalid/expired session)'), { status: 401 });
    }
}
