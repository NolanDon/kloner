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

export async function GET(req: NextRequest) {
    const base = process.env.OAUTH_REDIRECT_BASE_PROD || "https://kloner.app";

    const redirectWithStatus = (status: "success" | "error", reason?: string) => {
        const next = new URL("/integrations/vercel/callback", base);
        next.searchParams.set("status", status);
        if (reason) next.searchParams.set("reason", reason);

        const res = NextResponse.redirect(next.toString(), { status: 302 });
        res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
        return res;
    };

    try {
        const url = new URL(req.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const teamId = url.searchParams.get("teamId") || undefined;
        const configurationId = url.searchParams.get("configurationId") || undefined;

        const cookieState = req.cookies.get("vercel_oauth_state")?.value;

        // 1) CSRF / state validation
        if (!code || !state || !cookieState || state !== cookieState) {
            console.warn("[vercel-oauth] state mismatch", { code: !!code, state, cookieState });
            return redirectWithStatus("error", "state");
        }

        // 2) Verify Kloner session (must be logged in)
        let decoded;
        try {
            decoded = await verifySession(req); // { uid, email, claims? }
        } catch (err) {
            console.error("[vercel-oauth] verifySession failed", err);
            // Explicitly mark as auth failure instead of silently “success”
            return redirectWithStatus("error", "auth");
        }

        const uid = decoded.uid as string;

        // 3) Exchange code → access token with Vercel
        const redirectUri =
            process.env.NODE_ENV === "production"
                ? `${base}/api/vercel/oauth/callback`
                : "http://localhost:3000/api/vercel/oauth/callback";

        const body = new URLSearchParams({
            code,
            client_id: process.env.VERCEL_OAUTH_CLIENT_ID || "",
            client_secret: process.env.VERCEL_OAUTH_CLIENT_SECRET || "",
            redirect_uri: redirectUri,
        });

        let json: any;
        try {
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

            json = await tokenRes.json();
        } catch (err) {
            console.error("[vercel-oauth] token exchange threw", err);
            return redirectWithStatus("error", "token");
        }

        // 4) Persist token under kloner_users/{uid}/integrations/vercel
        const now = admin.firestore.FieldValue.serverTimestamp();

        try {
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
                    connected: true,
                },
                { merge: true },
            );
        } catch (err) {
            console.error("[vercel-oauth] Firestore write failed", err, { uid });
            // Critical: do NOT claim success if Firestore failed
            return redirectWithStatus("error", "db");
        }

        // 5) Only here is it actually successful
        return redirectWithStatus("success");
    } catch (err) {
        console.error("[vercel-oauth] unexpected error", err);
        return redirectWithStatus("error", "internal");
    }
}
