// app/api/auth/csrf/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { CSRF_COOKIE } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    // Require a valid session to fetch CSRF token
    return requireSessionAndMaybeCsrf(
        req,
        async () => {
            // Important: do not rotate CSRF token on every call.
            // Multiple concurrent requests that each fetch a "fresh" CSRF token can race,
            // causing the cookie and header values to differ and fail the CSRF check.
            const existing = req.cookies.get(CSRF_COOKIE)?.value || "";
            const looksValid = /^[a-f0-9]{64}$/i.test(existing);
            const token = looksValid ? existing : crypto.randomBytes(32).toString("hex");

            const res = NextResponse.json({ csrf: token }, { status: 200 });
            res.cookies.set(CSRF_COOKIE, token, {
                httpOnly: false, // must be JS-readable
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 60 * 60 * 24, // 1 day
            });

            return res;
        },
        { csrf: false, methods: ["POST"] } // Don't require CSRF to fetch CSRF token
    );
}
