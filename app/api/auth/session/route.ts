// src/app/api/auth/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, CSRF_COOKIE, SESSION_COOKIE_NAME } from "../../_lib/auth";
import { captureCriticalEvent, captureException } from "@/lib/observability";
import { getClientIp } from "../../_lib/route-guard";
import { getSignupBlockDecision } from "@/src/lib/signupBlocklist";
import { sendBlockedSignupIpAlert } from "../../_lib/signupBlocklistAlert";

const COOKIE = SESSION_COOKIE_NAME;
const MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

export async function POST(req: NextRequest) {
    const { idToken } = await req.json().catch(() => ({}));
    if (!idToken) {
        await captureCriticalEvent({
            source: "vercel",
            severity: "error",
            statusCode: 400,
            route: req.nextUrl?.pathname,
            method: "POST",
            action: "auth.session.create",
            message: "idToken required",
            service: "next-auth",
            url: req.url,
        });
        return NextResponse.json({ error: "idToken required" }, { status: 400 });
    }

    try {
        const auth = getAdminAuth();
        const decoded = await auth.verifyIdToken(idToken, true);
        const decision = getSignupBlockDecision({
            email: typeof decoded.email === "string" ? decoded.email : null,
            ip: getClientIp(req),
        });

        if (decision.blocked) {
            const clientIp = getClientIp(req);
            if (decision.matchedBy === "ip" && clientIp) {
                await sendBlockedSignupIpAlert({
                    ip: clientIp,
                    email: typeof decoded.email === "string" ? decoded.email : null,
                    route: "/api/auth/session",
                    matchedBy: "ip",
                    userAgent: req.headers.get("user-agent"),
                });
            }

            return NextResponse.json(
                { error: decision.reason || "Unable to create an account right now." },
                {
                    status: 403,
                    headers: {
                        "x-observability-skip-status-alert": "1",
                    },
                },
            );
        }

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
    } catch (err) {
        await captureException({
            source: "vercel",
            error: err,
            route: req.nextUrl?.pathname,
            method: "POST",
            action: "auth.session.create",
            statusCode: 500,
            service: "next-auth",
            url: req.url,
        });
        return NextResponse.json({ error: "Session creation failed" }, { status: 500 });
    }
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
