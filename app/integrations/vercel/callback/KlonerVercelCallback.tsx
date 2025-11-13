// app/api/vercel/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

const env = {
    clientId: process.env.VERCEL_OAUTH_CLIENT_ID,
    clientSecret: process.env.VERCEL_OAUTH_CLIENT_SECRET,
    redirectBase:
        process.env.NODE_ENV === "production"
            ? process.env.OAUTH_REDIRECT_BASE_PROD // e.g. "https://kloner.app"
            : process.env.OAUTH_REDIRECT_BASE_DEV, // e.g. "http://localhost:3000"
};

export async function GET(req: NextRequest) {
    if (!env.clientId || !env.clientSecret || !env.redirectBase) {
        return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");

    const cookieState = req.cookies.get("vercel_oauth_state")?.value ?? null;

    if (!code || !returnedState || !cookieState || returnedState !== cookieState) {
        return NextResponse.json({ error: "invalid_state_or_code" }, { status: 400 });
    }

    const redirectUri = `${env.redirectBase}/api/vercel/oauth/callback`;

    const body = new URLSearchParams({
        code,
        client_id: env.clientId,
        client_secret: env.clientSecret,
        redirect_uri: redirectUri,
    });

    const tokenRes = await fetch("https://api.vercel.com/v2/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });

    if (!tokenRes.ok) {
        const text = await tokenRes.text();
        return NextResponse.json(
            { error: "token_exchange_failed", details: text },
            { status: 502 },
        );
    }

    const tokenJson = (await tokenRes.json()) as {
        access_token: string;
        token_type: string;
        installation_id?: string;
        user_id?: string;
        team_id?: string;
        // refresh_token, expires_at, etc if enabled
    };

    // TODO: associate tokenJson.access_token with your logged-in user.
    // e.g. verify Firebase session and write to Firestore:
    //
    // const decoded = await verifySession(req);
    // await setDoc(doc(db, "users", decoded.uid, "integrations", "vercel"), {
    //   accessToken: tokenJson.access_token,
    //   teamId: tokenJson.team_id ?? null,
    //   userId: tokenJson.user_id ?? null,
    //   installationId: tokenJson.installation_id ?? null,
    //   updatedAt: Date.now(),
    // });

    // Final redirect back into your dashboard
    const redirectBack = new URL("/dashboard?vercel=linked", env.redirectBase);
    return NextResponse.redirect(redirectBack.toString(), { status: 302 });
}
