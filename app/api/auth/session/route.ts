// src/app/api/auth/session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const COOKIE = '__session';
const MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

function initAdmin() {
    if (!getApps().length) {
        const svc = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT!, 'base64').toString('utf8'));
        initializeApp({ credential: cert(svc) });
    }
}

export async function POST(req: NextRequest) {
    const { idToken } = await req.json().catch(() => ({}));
    if (!idToken) return NextResponse.json({ error: 'idToken required' }, { status: 400 });
    initAdmin();

    // Validate ID token first (revocation check)
    await getAuth().verifyIdToken(idToken, true);

    const cookie = await getAuth().createSessionCookie(idToken, { expiresIn: MAX_AGE_MS });
    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.cookies.set(COOKIE, cookie, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(MAX_AGE_MS / 1000),
    });
    return res;
}

export async function DELETE() {
    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.cookies.set(COOKIE, '', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    });
    return res;
}
