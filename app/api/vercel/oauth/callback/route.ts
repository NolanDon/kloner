// /app/api/vercel/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const stateCookie = req.cookies.get("vercel_oauth_state")?.value;
    const verifier = req.cookies.get("vercel_oauth_verifier")?.value;
    if (!code || !state || state !== stateCookie || !verifier) return NextResponse.json({ error: "invalid_oauth" }, { status: 400 });

    const redirectUri = `${url.origin}/api/vercel/oauth/callback`;

    const r = await fetch("https://api.vercel.com/v2/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            client_id: process.env.VERCEL_OAUTH_CLIENT_ID!,
            client_secret: process.env.VERCEL_OAUTH_CLIENT_SECRET!,
            code,
            redirect_uri: redirectUri,
            code_verifier: verifier,
        }),
    });
    const j = await r.json();
    if (!r.ok || !j?.access_token) return NextResponse.json({ error: j?.error || "token_exchange_failed" }, { status: 400 });

    // Optionally read team selection from query (?teamId=...) or default to the user’s personal scope.
    // Persist per-user: { accessToken, teamId?, connectedAt }
    // Replace with your auth; example uses a signed cookie for brevity.
    const res = NextResponse.redirect(`${url.origin}/dashboard/view?vercel=connected`, { status: 302 });
    res.cookies.set("vercel_access", j.access_token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 6 });
    // If you support teams, also store teamId chosen in your UI, then pass it to API calls.
    return res;
}
