// src/app/api/auth/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, CSRF_COOKIE, SESSION_COOKIE_NAME } from "../../_lib/auth";

const COOKIE = SESSION_COOKIE_NAME;
const MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

export async function POST(req: NextRequest) {
    const { idToken } = await req.json().catch(() => ({}));
    if (!idToken) {
        return NextResponse.json({ error: "idToken required" }, { status: 400 });
    }

    const auth = getAdminAuth();
    await auth.verifyIdToken(idToken, true);

    const cookie = await auth.createSessionCookie(idToken, {
        expiresIn: MAX_AGE_MS,
    });

    const res = NextResponse.json({ ok: true }, { status: 200 });

    res.cookies.set(COOKIE, cookie, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: Math.floor(MAX_AGE_MS / 1000),
    });

    return res;
}

export async function DELETE() {
    const res = NextResponse.json({ ok: true }, { status: 200 });

    // kill Firebase session
    res.cookies.set(COOKIE, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
    });

    // kill CSRF token
    res.cookies.set(CSRF_COOKIE, "", {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
    });

    return res;
}
