// app/api/vercel/deployments/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// widen type – createdAt can be Timestamp | number | string | Date | null
type KlonerDeployment = {
    url?: string | null;
    vercelDeploymentId?: string | null;
    vercelProjectId?: string | null;
    vercelProjectName?: string | null;
    renderId?: string | null;
    createdAt?: any;
    vercelReadyState?: string | null;
    vercelState?: string | null;
    lastEventType?: string | null;
    publicDomain?: string | null;
    publicUrl?: string | null;
    vercelUrl?: string | null;
    archived?: boolean | null;
};

function normalizeCreatedAt(raw: any): number | null {
    if (!raw) return null;

    // Firestore admin Timestamp
    if (raw instanceof admin.firestore.Timestamp) {
        return raw.toMillis();
    }
    // Other Timestamp-like objects
    if (typeof raw.toMillis === "function") {
        try {
            return raw.toMillis();
        } catch {
            // fall through
        }
    }
    if (raw._seconds != null && typeof raw._seconds === "number") {
        return raw._seconds * 1000;
    }
    if (raw instanceof Date) {
        return raw.getTime();
    }
    if (typeof raw === "number") {
        return raw;
    }
    if (typeof raw === "string") {
        const t = Date.parse(raw);
        return Number.isNaN(t) ? null : t;
    }
    return null;
}

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        try {
            const db = getFirestore();
            const depCol = db
                .collection("kloner_users")
                .doc(uid)
                .collection("deployments");

            const snap = await depCol.orderBy("createdAt", "desc").get();

            const deployments: any[] = [];
            const seenIds = new Set<string>();

            for (const d of snap.docs) {
                const data = d.data() as KlonerDeployment;

                // explicit true only
                if (data.archived === true) continue;

                seenIds.add(d.id);

                const createdAtMs = normalizeCreatedAt(data.createdAt);

                deployments.push({
                    id: d.id,
                    url: data.url ?? null,
                    vercelDeploymentId: data.vercelDeploymentId ?? null,
                    vercelProjectId: data.vercelProjectId ?? null,
                    vercelProjectName: data.vercelProjectName ?? null,
                    renderId: data.renderId ?? null,
                    createdAt: createdAtMs,
                    vercelReadyState: data.vercelReadyState ?? null,
                    vercelState: data.vercelState ?? null,
                    lastEventType: data.lastEventType ?? null,
                    publicDomain: data.publicDomain ?? null,
                    publicUrl: data.publicUrl ?? null,
                    vercelUrl: data.vercelUrl ?? null,
                });
            }

            const docRefs = await depCol.listDocuments();
            for (const ref of docRefs) {
                if (seenIds.has(ref.id)) continue;

                deployments.push({
                    id: ref.id,
                    url: null,
                    vercelDeploymentId: null,
                    vercelProjectId: null,
                    vercelProjectName: null,
                    renderId: null,
                    createdAt: null,
                    vercelReadyState: null,
                    vercelState: null,
                    lastEventType: null,
                    publicDomain: null,
                    publicUrl: null,
                    vercelUrl: null,
                });
            }

            deployments.sort((a, b) => {
                const aTs = typeof a.createdAt === "number" ? a.createdAt : 0;
                const bTs = typeof b.createdAt === "number" ? b.createdAt : 0;
                if (aTs !== bTs) return bTs - aTs;
                return a.id.localeCompare(b.id);
            });

            return NextResponse.json(
                {
                    ok: true,
                    deployments,
                },
                { status: 200 },
            );
        } catch (err: any) {
            console.error("vercel/deployments GET error", err);
            return NextResponse.json(
                {
                    ok: false,
                    error: err?.message || "Internal deployments error",
                },
                { status: 500 },
            );
        }
    });
}
