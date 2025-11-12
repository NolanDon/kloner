// /app/api/vercel/oauth/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const env = {
    cid: process.env.VERCEL_OAUTH_CLIENT_ID,
    redirectBase:
        process.env.NODE_ENV === "production"
            ? process.env.OAUTH_REDIRECT_BASE_PROD
            : process.env.OAUTH_REDIRECT_BASE_DEV,
};

export async function GET(req: NextRequest) {
    if (!env.cid || !env.redirectBase) {
        return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const state = crypto.randomBytes(16).toString("hex");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const redirectUri = `${env.redirectBase}/api/vercel/oauth/callback`;

    const authorize = new URL("https://vercel.com/oauth/authorize");
    authorize.searchParams.set("client_id", env.cid);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set(
        "scope",
        ["read:projects", "write:blobs", "read:blobs", "write:deployments", "read:deployments"].join(" "),
    );
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");

    const res = NextResponse.redirect(authorize.toString(), { status: 302 });
    const cookieBase = {
        httpOnly: true,
        sameSite: "lax" as const,
        maxAge: 600,
        secure: process.env.NODE_ENV === "production", // avoid Secure on http://localhost
        path: "/",
    };
    res.cookies.set("vercel_oauth_state", state, cookieBase);
    res.cookies.set("vercel_oauth_verifier", verifier, cookieBase);
    return res;
}
