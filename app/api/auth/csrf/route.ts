// src/app/api/auth/csrf/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";

// must match CSRF_COOKIE in _lib/auth.ts ("csrf")
const CSRF_COOKIE = "csrf";

export async function POST() {
    const token = crypto.randomBytes(32).toString("hex");

    cookies().set(CSRF_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 60 * 60 * 24, // 1 day
    });

    return NextResponse.json({ csrf: token });
}
