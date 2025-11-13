// app/api/vercel/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { verifySession } from "../../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Initialize Firebase Admin once per cold start.
 * FIREBASE_SERVICE_ACCOUNT should be either:
 * - raw JSON, or
 * - base64-encoded JSON (common in Vercel env setup).
 */
if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT env missing");
    }

    let parsed: admin.ServiceAccount;
    try {
        // Try base64 decode first; if that fails, assume plain JSON
        const maybeDecoded = Buffer.from(raw, "base64").toString("utf8");
        parsed = JSON.parse(maybeDecoded);
    } catch {
        parsed = JSON.parse(raw);
    }

    admin.initializeApp({
        credential: admin.credential.cert(parsed),
    });
}

const db = admin.firestore();

/**
 * OAuth callback from Vercel.
 *
 * Flow:
 * 1. Validate `state` from cookie vs query param (CSRF protection).
 * 2. Verify the user session (we must know which Kloner user to attach the token to).
 * 3. Exchange `code` for an access token with Vercel.
 * 4. Persist the token + metadata under kloner_users/{uid}/integrations/vercel.
 * 5. Redirect to a UI page with ?status=success|error so the UI can react accordingly.
 */
export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const teamId = url.searchParams.get("teamId") || undefined;
    const configurationId = url.searchParams.get("configurationId") || undefined;

    const cookieState = req.cookies.get("vercel_oauth_state")?.value;

    // helper to build redirect with status + reason and clear cookie
    const redirectWithStatus = (status: "success" | "error", reason?: string) => {
        const next = new URL("/integrations/vercel/callback", process.env.OAUTH_REDIRECT_BASE_PROD || "https://kloner.app");
        next.searchParams.set("status", status);
        if (reason) next.searchParams.set("reason", reason);

        const res = NextResponse.redirect(next.toString(), { status: 302 });
        res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
        return res;
    };

    // 1) CSRF / state validation
    if (!code || !state || !cookieState || state !== cookieState) {
        return redirectWithStatus("error", "state");
    }

    // 2) Tie install to the currently logged-in Kloner user
    let decoded;
    try {
        decoded = await verifySession(req); // { uid, email, claims? }
    } catch {
        // No Kloner session → redirect to login and explain we came from Vercel
        const loginUrl = new URL("/login", process.env.OAUTH_REDIRECT_BASE_PROD || "https://kloner.app");
        loginUrl.searchParams.set("from", "vercel");

        const res = NextResponse.redirect(loginUrl.toString(), { status: 302 });
        res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
        return res;
    }

    const uid = decoded.uid;

    // 3) Perform code → token exchange with Vercel
    const redirectUri =
        process.env.NODE_ENV === "production"
            ? "https://kloner.app/api/vercel/oauth/callback"
            : "http://localhost:3000/api/vercel/oauth/callback";

    const body = new URLSearchParams({
        code,
        client_id: process.env.VERCEL_OAUTH_CLIENT_ID || "",
        client_secret: process.env.VERCEL_OAUTH_CLIENT_SECRET || "",
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
        return redirectWithStatus("error", "token");
    }

    const json: any = await tokenRes.json();
    // shape: { access_token, token_type, team_id?, user_id?, expires_at?, scope?, ... }

    // 4) Persist token under kloner_users/{uid}/integrations/vercel
    const now = admin.firestore.FieldValue.serverTimestamp();

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

    // 5) Success → redirect with status=success
    return redirectWithStatus("success");
}
