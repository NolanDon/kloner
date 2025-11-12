// /app/api/vercel/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

const env = {
    cid: process.env.VERCEL_OAUTH_CLIENT_ID,
    csec: process.env.VERCEL_OAUTH_CLIENT_SECRET,
    redirectBase:
        process.env.NODE_ENV === "production"
            ? process.env.OAUTH_REDIRECT_BASE_PROD
            : process.env.OAUTH_REDIRECT_BASE_DEV,
};

export async function GET(req: NextRequest) {
    if (!env.cid || !env.csec || !env.redirectBase) {
        return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const stateCookie = req.cookies.get("vercel_oauth_state")?.value;
    const verifier = req.cookies.get("vercel_oauth_verifier")?.value;

    if (!code || !state || state !== stateCookie || !verifier) {
        return NextResponse.json({ error: "invalid_oauth" }, { status: 400 });
    }

    const redirectUri = `${env.redirectBase}/api/vercel/oauth/callback`;

    const r = await fetch("https://api.vercel.com/v2/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            client_id: env.cid,
            client_secret: env.csec,
            code,
            redirect_uri: redirectUri,
            code_verifier: verifier,
        }),
    });

    const j = await r.json().catch(() => ({} as any));
    if (!r.ok || !j?.access_token) {
        return NextResponse.json({ error: j?.error || "token_exchange_failed" }, { status: 400 });
    }

    // Store per signed-in app user; replace with your auth persistence.
    const res = NextResponse.redirect(`${env.redirectBase}/dashboard/view?vercel=connected`, { status: 302 });
    const cookieBase = {
        httpOnly: true,
        sameSite: "lax" as const,
        maxAge: 60 * 60 * 6,
        secure: process.env.NODE_ENV === "production",
        path: "/",
    };
    res.cookies.set("vercel_access", j.access_token, cookieBase);
    // Optional: res.cookies.set("vercel_team", chosenTeamId, cookieBase)
    return res;
}
