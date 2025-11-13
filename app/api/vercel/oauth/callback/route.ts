// app/api/vercel/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { verifySession } from "../../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Initialize Firebase Admin using a *base64-encoded* service account JSON.
 *
 * FIREBASE_SERVICE_ACCOUNT should be the service-account JSON, base64-encoded:
 *   echo '<json here>' | base64
 * and set that string as the env var.
 */
if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT env var is missing");
    }

    // Decode base64 → string → JSON
    const decodedJson = Buffer.from(raw, "base64").toString("utf8");
    const serviceAccount = JSON.parse(decodedJson);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    });
}

const db = admin.firestore();

// Base for redirect_uri (must match what you configured in Vercel)
const REDIRECT_BASE =
    process.env.NODE_ENV === "production"
        ? process.env.OAUTH_REDIRECT_BASE_PROD || "https://kloner.app"
        : process.env.OAUTH_REDIRECT_BASE_DEV || "http://localhost:3000";

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const teamId = url.searchParams.get("teamId") || undefined;
    const configurationId = url.searchParams.get("configurationId") || undefined;

    const cookieState = req.cookies.get("vercel_oauth_state")?.value;

    // CSRF/state validation
    if (!code || !state || !cookieState || state !== cookieState) {
        return NextResponse.json({ error: "invalid_state" }, { status: 400 });
    }

    // Require a signed-in Kloner user to bind the integration to
    let decoded;
    try {
        decoded = await verifySession(req); // { uid, email, claims? }
    } catch {
        return NextResponse.redirect("/login?from=vercel");
    }
    const uid = decoded.uid;

    const redirectUri = `${REDIRECT_BASE}/api/vercel/oauth/callback`;

    // Code → token exchange with Vercel
    const body = new URLSearchParams({
        code,
        client_id: process.env.VERCEL_OAUTH_CLIENT_ID!,
        client_secret: process.env.VERCEL_OAUTH_CLIENT_SECRET!,
        redirect_uri: redirectUri,
    });

    const tokenRes = await fetch("https://api.vercel.com/v2/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
    });

    if (!tokenRes.ok) {
        const text = await tokenRes.text();
        console.error("Vercel token exchange failed", tokenRes.status, text);
        return NextResponse.json(
            { error: "token_exchange_failed" },
            { status: 500 },
        );
    }

    const json: any = await tokenRes.json();
    // json: { access_token, token_type, team_id?, user_id?, expires_at?, scope?, ... }

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Persist integration under kloner_users/{uid}/integrations/vercel
    const userRef = db.collection("kloner_users").doc(uid);
    const vercelRef = userRef.collection("integrations").doc("vercel");

    await vercelRef.set(
        {
            accessToken: json.access_token,
            tokenType: json.token_type,
            vercelUserId: json.user_id ?? null,
            vercelTeamId: teamId ?? json.team_id ?? null,
            configurationId: configurationId ?? null,
            scope: json.scope ?? null,
            updatedAt: now,
            createdAt: now,
        },
        { merge: true },
    );

    // Clear state cookie and return to dashboard
    const res = NextResponse.redirect("/dashboard?vercel=connected");
    res.cookies.set("vercel_oauth_state", "", {
        maxAge: 0,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
    });

    return res;
}
