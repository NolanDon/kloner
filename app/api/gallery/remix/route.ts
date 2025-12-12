// app/api/gallery/remix/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";

function initAdmin() {
    if (!admin.apps.length) {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");

        let credJson: admin.ServiceAccount;
        try {
            credJson = JSON.parse(raw);
        } catch {
            credJson = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
        }

        admin.initializeApp({
            credential: admin.credential.cert(credJson),
        });
    }
    return admin.firestore();
}

function pickHtml(data: any, body: any): string {
    const v = data?.html ?? data?.sourceHtml ?? data?.renderHtml ?? body?.html ?? "";
    return typeof v === "string" ? v : "";
}

function pickSourceRenderId(data: any, body: any): string | null {
    const v =
        body?.sourceRenderId ??
        body?.renderId ??
        data?.renderId ??
        data?.sourceRenderId ??
        null;
    return v ? String(v) : null;
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }: { req: NextRequest; uid: string }) => {
            if (!uid) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }

            const body = await req.json().catch(() => ({} as any));
            const buildId = String(body?.buildId || "").trim();
            if (!buildId) {
                return NextResponse.json({ error: "Missing buildId" }, { status: 400 });
            }

            const db = initAdmin();

            const buildRef = db.collection("gallery").doc(buildId);

            // Use a transaction so:
            // - we read the build safely
            // - we increment remixes atomically
            // - we can return the updated remixes value
            const result = await db.runTransaction(async (tx) => {
                const snap = await tx.get(buildRef);
                if (!snap.exists) {
                    throw Object.assign(new Error("Build not found"), { status: 404 });
                }

                const data = snap.data() || {};
                const html = pickHtml(data, body);
                if (!html) {
                    throw Object.assign(new Error("Build has no html"), { status: 400 });
                }

                const sourceRenderId = pickSourceRenderId(data, body);
                const now = Date.now();

                const newRenderRef = db
                    .collection("kloner_users")
                    .doc(uid)
                    .collection("kloner_renders")
                    .doc();

                tx.set(
                    newRenderRef,
                    {
                        uid,
                        source: "community_remix",
                        sourceBuildId: buildId,
                        sourceRenderId: sourceRenderId ?? null,

                        html,

                        status: "ready",
                        archived: false,
                        reason: null,

                        createdAt: now,
                        updatedAt: now,
                        lastExportedAt: null,

                        url: null,
                        urlHash: null,
                        key: null,

                        progress: 100,

                        siteConfigId: null,
                        vercelProjectId: null,
                        vercelProjectName: null,
                        lastDeployUrl: null,

                        nameHint: data?.name ?? "Community remix",
                        referenceImage: data?.screenshotKey ?? null,
                        controllerVersion: data?.controllerVersion ?? null,
                        model: data?.model ?? null,
                        version: data?.version ?? 1,
                        mode: "remix",

                        seoMetaByPage: null,
                    },
                    { merge: true },
                );

                tx.update(buildRef, {
                    remixes: admin.firestore.FieldValue.increment(1),
                    updatedAt: now,
                });

                const prev = typeof data?.remixes === "number" ? data.remixes : Number(data?.remixes) || 0;
                const nextRemixes = prev + 1;

                return { renderId: newRenderRef.id, remixes: nextRemixes };
            });

            return NextResponse.json(result);
        },
    ).catch((err: any) => {
        const status = typeof err?.status === "number" ? err.status : 500;
        const msg = err?.message || "Remix failed";
        return NextResponse.json({ error: msg }, { status });
    });
}
