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

type KlonerDeployment = {
    url?: string | null;
    vercelDeploymentId?: string | null;
    vercelProjectId?: string | null;
    vercelProjectName?: string | null;
    renderId?: string | null;
    createdAt?: FirebaseFirestore.Timestamp | null;
    vercelReadyState?: string | null;
    vercelState?: string | null;
    lastEventType?: string | null;
    publicDomain?: string | null;
    publicUrl?: string | null;
    vercelUrl?: string | null;
    archived?: boolean | null;
};

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        try {
            const db = getFirestore();
            const depCol = db
                .collection("kloner_users")
                .doc(uid)
                .collection("deployments");

            // 1) Load all deployment docs, then filter archived in code
            //    This matches the dashboard behaviour (which does NOT filter on "archived").
            const snap = await depCol
                .orderBy("createdAt", "desc")
                .get();

            const deployments: any[] = [];
            const seenIds = new Set<string>();

            for (const d of snap.docs) {
                const data = d.data() as KlonerDeployment;

                // Treat only explicit "true" as archived. Missing field = NOT archived.
                if (data.archived === true) continue;

                seenIds.add(d.id);

                deployments.push({
                    id: d.id,
                    url: data.url ?? null,
                    vercelDeploymentId: data.vercelDeploymentId ?? null,
                    vercelProjectId: data.vercelProjectId ?? null,
                    vercelProjectName: data.vercelProjectName ?? null,
                    renderId: data.renderId ?? null,
                    createdAt: data.createdAt?.toMillis() ?? null,
                    vercelReadyState: data.vercelReadyState ?? null,
                    vercelState: data.vercelState ?? null,
                    lastEventType: data.lastEventType ?? null,
                    publicDomain: data.publicDomain ?? null,
                    publicUrl: data.publicUrl ?? null,
                    // optional extra field used on the deployments dashboard
                    vercelUrl: data.vercelUrl ?? null,
                });
            }

            // 2) Orphan / empty docs (show as deletable “unknown” entries)
            const docRefs = await depCol.listDocuments();
            for (const ref of docRefs) {
                if (seenIds.has(ref.id)) continue;

                // These are the ones with no fields (never appear in queries).
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

            // 3) Stable sort: newest createdAt first, then id
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
