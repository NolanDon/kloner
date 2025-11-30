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

            // 1) Normal docs with fields (what you already had)
            const snap = await depCol
                .where("archived", "==", false)
                .orderBy("createdAt", "desc")
                .get();

            const deployments: any[] = [];
            const seenIds = new Set<string>();

            for (const d of snap.docs) {
                const data = d.data() as KlonerDeployment;
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
                });
            }

            // 2) Orphan / empty docs (show as deletable “unknown” entries)
            const docRefs = await depCol.listDocuments();

            for (const ref of docRefs) {
                if (seenIds.has(ref.id)) continue; // already in list above

                // These are the ones like in your screenshot: no fields.
                // Firestore shows them as "document does not exist" and they never
                // appear in queries, but listDocuments() still returns the refs.
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
                });
            }

            // 3) Optional: sort by createdAt desc, then by id so the UI is stable
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
