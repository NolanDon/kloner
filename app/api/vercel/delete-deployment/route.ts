// app/api/vercel/delete-deployment/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import type { Bucket } from "@google-cloud/storage";
import { getFirestore } from "firebase-admin/firestore";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_NAME =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    "tracksitechanges-5743f.firebasestorage.app";

let cachedBucket: Bucket | null = null;

function initAdminIfNeeded() {
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
            storageBucket: BUCKET_NAME,
        });
    }
}

function getBucket(): Bucket {
    if (cachedBucket) return cachedBucket;
    initAdminIfNeeded();
    cachedBucket = admin.storage().bucket(BUCKET_NAME);
    return cachedBucket;
}

type DeleteBody = {
    deploymentId?: string;
    deploymentIds?: string[];
};

type IntegDoc = {
    accessToken?: string;
    vercelTeamId?: string | null;
    vercelUserId?: string | null;
};

type DeploymentDoc = {
    vercelDeploymentId?: string | null;
    vercelProjectId?: string | null;
    vercelProjectName?: string | null;
    vercelTeamId?: string | null;
    renderId?: string | null;
    url?: string | null;
    publicDomain?: string | null;
    publicUrl?: string | null;
};

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            try {
                initAdminIfNeeded();
                const db = getFirestore();
                const bucket = getBucket();

                const body = (await req.json().catch(() => ({}))) as DeleteBody;
                const singleId = body.deploymentId;
                const manyIds = Array.isArray(body.deploymentIds)
                    ? body.deploymentIds.filter(
                        (v) => typeof v === "string" && v.trim().length > 0,
                    )
                    : [];

                const targetIds: string[] =
                    manyIds.length > 0
                        ? manyIds
                        : singleId && singleId.trim().length > 0
                            ? [singleId.trim()]
                            : [];

                if (targetIds.length === 0) {
                    return NextResponse.json(
                        {
                            ok: false,
                            error: "No deploymentId or deploymentIds provided",
                        },
                        { status: 400 },
                    );
                }

                const integRef = db
                    .collection("kloner_users")
                    .doc(uid)
                    .collection("integrations")
                    .doc("vercel");
                const integSnap = await integRef.get();
                const integ =
                    (integSnap.exists ? (integSnap.data() as IntegDoc) : null) || {};
                const accessToken = integ.accessToken || null;
                const teamId = integ.vercelTeamId || null;

                const results: Array<{
                    deploymentId: string;
                    ok: boolean;
                    firestoreDeleted?: boolean;
                    renderDeleted?: boolean;
                    screenshotsDeleted?: number;
                    vercelDeleted?: boolean;
                    vercelStatus?: number | null;
                    error?: string;
                }> = [];

                for (const deploymentDocId of targetIds) {
                    const base = {
                        deploymentId: deploymentDocId,
                        ok: false,
                        firestoreDeleted: false,
                        renderDeleted: false,
                        screenshotsDeleted: 0,
                        vercelDeleted: false,
                        vercelStatus: null as number | null,
                        error: undefined as string | undefined,
                    };

                    try {
                        const depRef = db
                            .collection("kloner_users")
                            .doc(uid)
                            .collection("deployments")
                            .doc(deploymentDocId);

                        const depSnap = await depRef.get();
                        if (!depSnap.exists) {
                            results.push({
                                ...base,
                                ok: false,
                                error: "Deployment doc not found for this user",
                            });
                            continue;
                        }

                        const dep = depSnap.data() as DeploymentDoc;
                        const vercelDeploymentId = dep.vercelDeploymentId?.trim() || null;
                        const renderId = dep.renderId?.trim() || null;
                        const depVercelProjectId = dep.vercelProjectId?.trim() || null;
                        const depVercelProjectName = dep.vercelProjectName?.trim() || null;

                        // 1) Delete from Vercel (best effort)
                        let vercelDeleted = false;
                        let vercelStatus: number | null = null;

                        if (accessToken && vercelDeploymentId) {
                            const params = new URLSearchParams();
                            if (teamId) params.set("teamId", teamId);

                            const url = `https://api.vercel.com/v13/deployments/${vercelDeploymentId}${params.toString() ? `?${params.toString()}` : ""
                                }`;

                            const vercelRes = await fetch(url, {
                                method: "DELETE",
                                headers: {
                                    Authorization: `Bearer ${accessToken}`,
                                },
                            });

                            vercelStatus = vercelRes.status;
                            if (vercelRes.ok || vercelRes.status === 404) {
                                vercelDeleted = true;
                            } else {
                                const bodyJson = await vercelRes
                                    .json()
                                    .catch(() => ({} as any));
                                console.error("Vercel delete failed", {
                                    deploymentId: vercelDeploymentId,
                                    status: vercelRes.status,
                                    body: bodyJson,
                                });
                            }
                        }

                        // 2) Figure out ALL renderIds we should clean up
                        const renderIdsToDelete = new Set<string>();

                        if (renderId) renderIdsToDelete.add(renderId);

                        // Fallback by vercelProjectId (covers cases where renderId
                        // was never stored on the deployment doc but the initial
                        // render has the same Vercel project wired in).
                        try {
                            const rendersCol = db
                                .collection("kloner_users")
                                .doc(uid)
                                .collection("kloner_renders");

                            if (depVercelProjectId) {
                                const q = await rendersCol
                                    .where("vercelProjectId", "==", depVercelProjectId)
                                    .get();
                                for (const doc of q.docs) renderIdsToDelete.add(doc.id);
                            } else if (depVercelProjectName) {
                                const q = await rendersCol
                                    .where("vercelProjectName", "==", depVercelProjectName)
                                    .get();
                                for (const doc of q.docs) renderIdsToDelete.add(doc.id);
                            }
                        } catch (e) {
                            console.error(
                                "Error querying kloner_renders for cleanup",
                                { uid, deploymentDocId, depVercelProjectId, depVercelProjectName },
                                e,
                            );
                        }

                        // 3) Delete screenshots + render docs for each renderId
                        let screenshotsDeleted = 0;
                        let renderDeleted = false;

                        for (const rid of renderIdsToDelete) {
                            // screenshots under kloner-screenshots/{uid}/{renderId}/**
                            const prefix = `kloner-screenshots/${uid}/${rid}/`;
                            try {
                                const [files] = await bucket.getFiles({ prefix });
                                if (files && files.length > 0) {
                                    await Promise.all(
                                        files.map((file) =>
                                            file.delete().catch((e) => {
                                                console.error(
                                                    "storage delete (by renderId) failed",
                                                    file.name,
                                                    e,
                                                );
                                            }),
                                        ),
                                    );
                                    screenshotsDeleted += files.length;
                                }
                            } catch (e) {
                                console.error(
                                    "Error deleting screenshots for renderId",
                                    { uid, rid },
                                    e,
                                );
                            }

                            // render doc itself
                            try {
                                const renderRef = db
                                    .collection("kloner_users")
                                    .doc(uid)
                                    .collection("kloner_renders")
                                    .doc(rid);
                                await renderRef.delete();
                                renderDeleted = true;
                            } catch (e) {
                                console.error("Error deleting render doc", { uid, rid }, e);
                            }
                        }

                        // 4) Delete deployment doc
                        let firestoreDeleted = false;
                        try {
                            await depRef.delete();
                            firestoreDeleted = true;
                        } catch (e) {
                            console.error(
                                "Error deleting deployment doc",
                                { uid, deploymentDocId },
                                e,
                            );
                        }

                        results.push({
                            ...base,
                            ok: true,
                            vercelDeleted,
                            vercelStatus,
                            screenshotsDeleted,
                            renderDeleted,
                            firestoreDeleted,
                        });
                    } catch (e: any) {
                        console.error("delete-deployment bulk item error", { deploymentDocId }, e);
                        results.push({
                            ...base,
                            ok: false,
                            error: e?.message || "Internal error during delete",
                        });
                    }
                }

                return NextResponse.json(
                    {
                        ok: true,
                        results,
                    },
                    { status: 200 },
                );
            } catch (err: any) {
                console.error("vercel/delete-deployment POST error", err);
                return NextResponse.json(
                    {
                        ok: false,
                        error: err?.message || "Internal delete error",
                    },
                    { status: 500 },
                );
            }
        },
        { methods: ["POST"], csrf: true },
    );
}
