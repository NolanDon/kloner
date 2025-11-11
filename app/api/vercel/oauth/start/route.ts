// /app/api/vercel/oauth/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(req: NextRequest) {
    const state = crypto.randomBytes(16).toString("hex");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    // stash in a short-lived, httpOnly cookie
    const url = new URL(req.url);
    const redirectUri = `${url.origin}/api/vercel/oauth/callback`;

    const authorize = new URL("https://vercel.com/oauth/authorize");
    authorize.searchParams.set("client_id", process.env.VERCEL_OAUTH_CLIENT_ID!);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", [
        // keep tight; extend only if needed
        "read:projects",
        "write:blobs",
        "read:blobs",
        "write:deployments",
        "read:deployments",
    ].join(" "));
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");

    const res = NextResponse.redirect(authorize.toString(), { status: 302 });
    res.cookies.set("vercel_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600 });
    res.cookies.set("vercel_oauth_verifier", verifier, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600 });
    return res;
}
