// app/api/vercel/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const env = {
    clientId: process.env.VERCEL_OAUTH_CLIENT_ID,
    clientSecret: process.env.VERCEL_OAUTH_CLIENT_SECRET,
    redirectBase:
        process.env.NODE_ENV === "production"
            ? process.env.OAUTH_REDIRECT_BASE_PROD // e.g. "https://kloner.app"
            : process.env.OAUTH_REDIRECT_BASE_DEV, // e.g. "http://localhost:3000"
};

export async function GET(req: NextRequest) {
    // Sanity check env so you fail hard if misconfigured
    if (!env.clientId || !env.clientSecret || !env.redirectBase) {
        return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");

    const cookieState = req.cookies.get("vercel_oauth_state")?.value ?? null;

    if (!code || !returnedState || !cookieState || returnedState !== cookieState) {
        // Redirect to UI with explicit error reason
        const failUrl = new URL("/integrations/vercel/callback", env.redirectBase);
        failUrl.searchParams.set("status", "error");
        failUrl.searchParams.set("reason", "state");

        const res = NextResponse.redirect(failUrl.toString(), { status: 302 });
        res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
        return res;
    }

    const redirectUri = `${env.redirectBase}/api/vercel/oauth/callback`;

    const body = new URLSearchParams({
        code,
        client_id: env.clientId,
        client_secret: env.clientSecret,
        redirect_uri: redirectUri,
    });

    let tokenJson: {
        access_token: string;
        token_type: string;
        installation_id?: string;
        user_id?: string;
        team_id?: string;
        // refresh_token, expires_at, etc if enabled
    };

    try {
        const tokenRes = await fetch("https://api.vercel.com/v2/oauth/access_token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });

        if (!tokenRes.ok) {
            const text = await tokenRes.text();
            console.error("Vercel token exchange failed:", tokenRes.status, text);

            const failUrl = new URL("/integrations/vercel/callback", env.redirectBase);
            failUrl.searchParams.set("status", "error");
            failUrl.searchParams.set("reason", "token");

            const res = NextResponse.redirect(failUrl.toString(), { status: 302 });
            res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
            return res;
        }

        tokenJson = (await tokenRes.json()) as typeof tokenJson;
    } catch (err) {
        console.error("Vercel token exchange threw:", err);

        const failUrl = new URL("/integrations/vercel/callback", env.redirectBase);
        failUrl.searchParams.set("status", "error");
        failUrl.searchParams.set("reason", "network");

        const res = NextResponse.redirect(failUrl.toString(), { status: 302 });
        res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
        return res;
    }

    // TODO: persist tokenJson.access_token etc. somewhere secure, server-side only.
    //
    // Security notes:
    // - Never expose access_token to the browser.
    // - Store it against your user/server identity (e.g. in a DB or secret store).
    // - If you add refresh tokens later, keep them encrypted-at-rest.

    const successUrl = new URL("/integrations/vercel/callback", env.redirectBase);
    successUrl.searchParams.set("status", "success");

    const res = NextResponse.redirect(successUrl.toString(), { status: 302 });
    res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
}
