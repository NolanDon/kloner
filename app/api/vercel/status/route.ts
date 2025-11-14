// app/api/vercel/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { verifySession } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Initialize Firebase Admin once per cold start.
 * FIREBASE_SERVICE_ACCOUNT can be:
 * - raw JSON, or
 * - base64-encoded JSON
 */
if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env missing");

    let parsed: admin.ServiceAccount;
    try {
        if (raw.trim().startsWith("{")) {
            parsed = JSON.parse(raw);
        } else {
            parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
        }
    } catch (e) {
        console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT", e);
        throw e;
    }

    admin.initializeApp({
        credential: admin.credential.cert(parsed),
    });
}

type VercelIntegrationDoc = {
    accessToken?: string;
    teamId?: string | null;
    userId?: string | null;
    linkedAt?: admin.firestore.Timestamp;
};

export async function GET(req: NextRequest) {
    let decoded;
    try {
        decoded = await verifySession(req); // { uid, ... }
    } catch {
        return NextResponse.json(
            { connected: false, reason: "unauthenticated" },
            { status: 401 },
        );
    }

    const uid = decoded.uid as string;
    const db = admin.firestore();

    // Adjust if your structure differs
    const integRef = db
        .collection("kloner_users")
        .doc(uid)
        .collection("integrations")
        .doc("vercel");

    const integSnap = await integRef.get();
    if (!integSnap.exists) {
        return NextResponse.json({ connected: false }, { status: 200 });
    }

    const data = integSnap.data() as VercelIntegrationDoc;
    const accessToken = data?.accessToken;
    if (!accessToken) {
        await integRef.delete().catch(() => { });
        return NextResponse.json({ connected: false }, { status: 200 });
    }

    try {
        // Quick "ping" to Vercel to validate token and installation
        const res = await fetch("https://api.vercel.com/v2/user", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            cache: "no-store",
        });

        if (res.status === 401 || res.status === 403) {
            // Token revoked / integration removed on Vercel side
            await integRef.delete().catch(() => { });
            return NextResponse.json(
                { connected: false, reason: "vercel_revoked" },
                { status: 200 },
            );
        }

        if (!res.ok) {
            // Temporary issue, don't delete local integration
            return NextResponse.json(
                { connected: false, transientError: true },
                { status: 200 },
            );
        }

        const json = await res.json().catch(() => ({} as any));
        const vercelUser = json?.user || null;

        return NextResponse.json(
            {
                connected: true,
                user: vercelUser
                    ? {
                        id: vercelUser.id,
                        email: vercelUser.email,
                        name: vercelUser.name,
                    }
                    : null,
            },
            { status: 200 },
        );
    } catch (e) {
        console.error("Vercel status ping failed", e);
        return NextResponse.json(
            { connected: false, transientError: true },
            { status: 200 },
        );
    }
}
