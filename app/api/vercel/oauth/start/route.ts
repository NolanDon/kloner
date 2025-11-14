// app/api/vercel/oauth/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const env = {
    clientId: process.env.VERCEL_OAUTH_CLIENT_ID,
    redirectUri: process.env.VERCEL_OAUTH_REDIRECT_URI,
    scopes:
        process.env.VERCEL_OAUTH_SCOPES ??
        "read:projects read:deployments write:deployments read:env write:env read:user",
};

export async function GET(_req: NextRequest) {
    if (!env.clientId || !env.redirectUri) {
        return NextResponse.json(
            { error: "vercel_oauth_misconfigured" },
            { status: 500 },
        );
    }

    const state = crypto.randomBytes(16).toString("hex");

    const authorizeUrl = new URL("https://vercel.com/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", env.clientId);
    authorizeUrl.searchParams.set("redirect_uri", env.redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", env.scopes);
    authorizeUrl.searchParams.set("state", state);

    const res = NextResponse.redirect(authorizeUrl.toString(), { status: 302 });

    res.cookies.set("vercel_oauth_state", state, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 600,
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });

    return res;
}
