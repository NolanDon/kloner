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
    console.log("[vercel-oauth] incoming", req.url);

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const teamId = url.searchParams.get("teamId") || undefined;
    const configurationId = url.searchParams.get("configurationId") || undefined;

    const cookieState = req.cookies.get("vercel_oauth_state")?.value;

    console.log("[vercel-oauth] query", { hasCode: !!code, state, teamId, configurationId });
    console.log("[vercel-oauth] cookieState", cookieState);

    const redirectWithStatus = (status: "success" | "error", reason?: string) => {
        const base = process.env.OAUTH_REDIRECT_BASE_PROD || "https://kloner.app";
        const next = new URL("/integrations/vercel/callback", base);
        next.searchParams.set("status", status);
        if (reason) next.searchParams.set("reason", reason);

        console.log("[vercel-oauth] redirect", { status, reason, to: next.toString() });

        const res = NextResponse.redirect(next.toString(), { status: 302 });
        res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
        return res;
    };

    if (!code || !state || !cookieState || state !== cookieState) {
        console.warn("[vercel-oauth] state mismatch", { code: !!code, state, cookieState });
        return redirectWithStatus("error", "state");
    }

    let decoded;
    try {
        decoded = await verifySession(req);
        console.log("[vercel-oauth] verified session", { uid: decoded.uid });
    } catch (err) {
        console.warn("[vercel-oauth] verifySession failed", err);
        const base = process.env.OAUTH_REDIRECT_BASE_PROD || "https://kloner.app";
        const loginUrl = new URL("/login", base);
        loginUrl.searchParams.set("from", "vercel");

        const res = NextResponse.redirect(loginUrl.toString(), { status: 302 });
        res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
        return res;
    }

    const uid = decoded.uid as string;

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

    console.log("[vercel-oauth] exchanging code for token", { redirectUri });

    const tokenRes = await fetch("https://api.vercel.com/v2/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
    });

    if (!tokenRes.ok) {
        const text = await tokenRes.text();
        console.error("[vercel-oauth] token exchange failed", tokenRes.status, text);
        return redirectWithStatus("error", "token");
    }

    const json: any = await tokenRes.json();
    console.log("[vercel-oauth] token response", {
        hasToken: !!json.access_token,
        user_id: json.user_id,
        team_id: json.team_id,
        scope: json.scope,
    });

    const now = admin.firestore.FieldValue.serverTimestamp();

    const userRef = db.collection("kloner_users").doc(uid);
    const vercelRef = userRef.collection("integrations").doc("vercel");

    console.log("[vercel-oauth] writing Firestore", {
        path: `kloner_users/${uid}/integrations/vercel`,
    });

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
            connected: true,
        },
        { merge: true },
    );

    console.log("[vercel-oauth] Firestore write complete");

    return redirectWithStatus("success");
}
