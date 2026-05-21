// app/api/vercel/disconnect/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { loadVercelIntegration } from "../../_lib/vercel-integration";

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
    installationId?: string | null;
};

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            const db = admin.firestore();

            const integRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("vercel");

            const result = await loadVercelIntegration(integRef as any);
            if (!result.exists) {
                // Already disconnected locally
                return NextResponse.json(
                    { ok: true, disconnected: true },
                    { status: 200 }
                );
            }

            const data = result.data as VercelIntegrationDoc | null;
            const accessToken = result.accessToken;
            const installationId = data?.installationId || null;

            // Best-effort revoke on Vercel side
            if (accessToken) {
                try {
                    if (installationId) {
                        await fetch(
                            `https://api.vercel.com/v1/integrations/installations/${installationId}`,
                            {
                                method: "DELETE",
                                headers: {
                                    Authorization: `Bearer ${accessToken}`,
                                },
                            }
                        ).catch(() => { });
                    } else {
                        // Fallback: revoke token directly
                        await fetch(
                            "https://api.vercel.com/v2/user/tokens/current",
                            {
                                method: "DELETE",
                                headers: {
                                    Authorization: `Bearer ${accessToken}`,
                                },
                            }
                        ).catch(() => { });
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
                { status: 200 }
            );
        },
        { methods: ["POST"], csrf: true }
    );
}
