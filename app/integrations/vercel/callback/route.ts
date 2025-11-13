// app/api/vercel/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { verifySession } from "@/app/api/_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

if (!admin.apps.length) {
    // FIREBASE_SERVICE_ACCOUNT should be a JSON string (or base64 of JSON)
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
    }

    let svcJson: admin.ServiceAccount;

    try {
        // try plain JSON first
        svcJson = JSON.parse(raw);
    } catch {
        // fall back to base64-encoded JSON (common on Vercel)
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        svcJson = JSON.parse(decoded);
    }

    admin.initializeApp({
        credential: admin.credential.cert(svcJson),
    });
}

const db = admin.firestore();

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

    // tie the integration to the logged-in Kloner user (via your session cookie)
    let uid: string | null = null;
    try {
        const decoded = await verifySession(req); // your helper: { uid, email, ... }
        uid = decoded.uid;
    } catch {
        uid = null;
    }

    if (uid) {
        const now = admin.firestore.FieldValue.serverTimestamp();

        const vercelRef = db
            .collection("kloner_users")
            .doc(uid)
            .collection("integrations")
            .doc("vercel");

        // NOTE: in a real system you’d encrypt access_token at rest
        await vercelRef.set(
            {
                connected: true,
                accessToken: tokenJson.access_token,
                tokenType: tokenJson.token_type,
                vercelUserId: tokenJson.user_id ?? null,
                vercelTeamId: tokenJson.team_id ?? null,
                installationId: tokenJson.installation_id ?? null,
                updatedAt: now,
                createdAt: now,
            },
            { merge: true },
        );
    } else {
        console.warn("Vercel OAuth callback with no authenticated Kloner user");
    }

    const successUrl = new URL("/integrations/vercel/callback", env.redirectBase);
    successUrl.searchParams.set("status", "success");

    const res = NextResponse.redirect(successUrl.toString(), { status: 302 });
    res.cookies.set("vercel_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
}
