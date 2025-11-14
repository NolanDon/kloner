// app/api/vercel/disconnect/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { verifySession } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Initialize Firebase Admin once per cold start.
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
    installationId?: string | null; // add this if you store it
};

export async function POST(req: NextRequest) {
    let decoded;
    try {
        decoded = await verifySession(req); // { uid, ... }
    } catch {
        return NextResponse.json(
            { ok: false, error: "unauthenticated" },
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

    const snap = await integRef.get();
    if (!snap.exists) {
        // Already disconnected locally
        return NextResponse.json({ ok: true, disconnected: true }, { status: 200 });
    }

    const data = snap.data() as VercelIntegrationDoc;
    const accessToken = data?.accessToken;
    const installationId = data?.installationId || null;

    // Best-effort revoke on Vercel side
    if (accessToken) {
        try {
            // If you know the right uninstall endpoint, wire it here.
            // Example pattern for integration uninstall (adjust path to your real one):
            if (installationId) {
                await fetch(
                    `https://api.vercel.com/v1/integrations/installations/${installationId}`,
                    {
                        method: "DELETE",
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                        },
                    },
                ).catch(() => { });
            } else {
                // Fallback: revoke token directly if you’re using personal tokens
                await fetch("https://api.vercel.com/v2/user/tokens/current", {
                    method: "DELETE",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                }).catch(() => { });
            }
        } catch (e) {
            // Do not block disconnect if Vercel revoke fails
            console.error("Vercel revoke failed", e);
        }
    }

    // Local cleanup: make Kloner reflect "disconnected"
    await integRef.delete().catch((e) => {
        console.error("Failed to delete Vercel integration doc", e);
    });

    return NextResponse.json(
        {
            ok: true,
            disconnected: true,
        },
        { status: 200 },
    );
}
