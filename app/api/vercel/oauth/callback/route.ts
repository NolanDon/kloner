// app/api/vercel/oauth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { verifySession } from "../../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

if (!admin.apps.length) {
    // expects FIREBASE_SERVICE_ACCOUNT JSON in env, or use your existing admin init
    admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT as string)
        ),
    });
}

const db = admin.firestore();

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const teamId = url.searchParams.get("teamId") || undefined;
    const configurationId = url.searchParams.get("configurationId") || undefined;

    const cookieState = req.cookies.get("vercel_oauth_state")?.value;

    if (!code || !state || !cookieState || state !== cookieState) {
        return NextResponse.json({ error: "invalid_state" }, { status: 400 });
    }

    // tie install to the currently logged-in Kloner user
    let decoded;
    try {
        decoded = await verifySession(req); // { uid, email, claims? }
    } catch {
        // no Kloner session → nowhere to store integration
        return NextResponse.redirect("/login?from=vercel");
    }
    const uid = decoded.uid;

    const body = new URLSearchParams({
        code,
        client_id: process.env.VERCEL_OAUTH_CLIENT_ID!,
        client_secret: process.env.VERCEL_OAUTH_CLIENT_SECRET!,
        redirect_uri:
            process.env.NODE_ENV === "production"
                ? "https://kloner.app/api/vercel/oauth/callback"
                : "http://localhost:3000/api/vercel/oauth/callback",
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
    // json: { access_token, token_type, team_id?, user_id?, expires_at?, ... }

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Basic persistence: kloner_users/{uid}/integrations/vercel
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

    // clear state cookies
    const res = NextResponse.redirect("/dashboard?vercel=connected");
    res.cookies.set("vercel_oauth_state", "", {
        maxAge: 0,
        path: "/",
    });

    return res;
}
