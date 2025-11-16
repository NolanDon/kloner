// app/api/auth/csrf/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { CSRF_COOKIE } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const token = crypto.randomBytes(32).toString("hex");

    const res = NextResponse.json({ csrf: token }, { status: 200 });
    res.cookies.set(CSRF_COOKIE, token, {
        httpOnly: false, // must be JS-readable
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24, // 1 day
    });

    return res;
}
