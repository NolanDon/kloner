// src/app/api/auth/csrf/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";

const CSRF_COOKIE = "csrf";

export async function POST() {
    const jar = cookies();
    let token = jar.get(CSRF_COOKIE)?.value;

    // Only generate if no cookie exists yet
    if (!token) {
        token = crypto.randomBytes(32).toString("hex");
    }

    jar.set(CSRF_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24, // 1 day
    });

    return NextResponse.json({ csrf: token });
}
