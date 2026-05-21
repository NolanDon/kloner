import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import type { Bucket } from "@google-cloud/storage";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { loadVercelIntegration } from "@/app/api/_lib/vercel-integration";

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

type DeleteResult = {
    deploymentId: string;
    ok: boolean;
    firestoreDeleted?: boolean;
    renderDeleted?: boolean; // kept for compatibility (always false now)
    renderFieldsCleared?: boolean;
    screenshotsDeleted?: number;
    vercelDeleted?: boolean;
    vercelStatus?: number | null;
    vercelProjectDeleted?: boolean;
    vercelProjectStatus?: number | null;
    error?: string;
};

function projectKeyFromDoc(dep: DeploymentDoc): string | null {
    const id = dep.vercelProjectId?.trim();
    if (id) return `id:${id}`;
    return null;
}

function projectIdOrNameFromKey(key: string): string | null {
    const idx = key.indexOf(":");
    if (idx === -1) return null;
    return key.slice(idx + 1) || null;
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            try {
                initAdminIfNeeded();
                const db = getAdminDb();
                const bucket = getBucket(); // kept in case screenshot cleanup is re-enabled

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
                const integ = await loadVercelIntegration(integRef as any);
                const integData = (integ.data || {}) as IntegDoc;
                const accessToken = integ.accessToken || null;
                const teamId = integData.vercelTeamId || null;

                // ------------------------------------------------------
                // 1) Pre-scan deployment docs to know which Vercel
                //    projects are fully selected for deletion.
                // ------------------------------------------------------
                const depCol = db
                    .collection("kloner_users")
                    .doc(uid)
                    .collection("deployments");
                const allDepSnap = await depCol.get();

                const projectToDocIds = new Map<string, string[]>();

                allDepSnap.docs.forEach((d) => {
                    const data = d.data() as DeploymentDoc;
                    const key = projectKeyFromDoc(data);
                    if (!key) return;
                    const list = projectToDocIds.get(key) || [];
                    list.push(d.id);
                    projectToDocIds.set(key, list);
                });

                const targetSet = new Set(targetIds);
                const projectsToDeleteFully = new Set<string>();

                for (const [key, docIds] of projectToDocIds.entries()) {
                    const allSelected = docIds.every((id) => targetSet.has(id));
                    if (allSelected) {
                        projectsToDeleteFully.add(key);
                    }
                }

                // Track which projects we've already attempted to delete
                const projectDeletedOnce = new Set<string>();

                const results: DeleteResult[] = [];

                // ------------------------------------------------------
                // 2) Process each deployment
                // ------------------------------------------------------
                for (const deploymentDocId of targetIds) {
                    const base: DeleteResult = {
                        deploymentId: deploymentDocId,
                        ok: false,
                        firestoreDeleted: false,
                        renderDeleted: false,
                        renderFieldsCleared: false,
                        screenshotsDeleted: 0,
                        vercelDeleted: false,
                        vercelStatus: null,
                        vercelProjectDeleted: false,
                        vercelProjectStatus: null,
                    };

                    try {
                        const depRef = depCol.doc(deploymentDocId);
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

                        // 2.1) Delete deployment from Vercel (best effort)
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
                                console.error("Vercel deployment delete failed", {
                                    deploymentId: vercelDeploymentId,
                                    status: vercelRes.status,
                                    body: bodyJson,
                                });
                            }
                        }

                        // 2.2) Scrub Vercel-related fields from any matching renders
                        //     (handles both new docs with renderId and old ones without)
                        let renderFieldsCleared = false;
                        try {
                            const rendersCol = db
                                .collection("kloner_users")
                                .doc(uid)
                                .collection("kloner_renders");

                            const candidateIds = new Set<string>();

                            if (renderId) {
                                candidateIds.add(renderId);
                            }

                            const projectId = dep.vercelProjectId?.trim() || null;
                            const projectName = dep.vercelProjectName?.trim() || null;
                            const lastUrl =
                                dep.publicUrl || dep.publicDomain || dep.url || null;

                            // match by vercelProjectId
                            if (projectId) {
                                const snapByPid = await rendersCol
                                    .where("vercelProjectId", "==", projectId)
                                    .get();
                                snapByPid.forEach((doc) => candidateIds.add(doc.id));
                            }

                            // match by vercelProjectName
                            if (projectName) {
                                const snapByName = await rendersCol
                                    .where("vercelProjectName", "==", projectName)
                                    .get();
                                snapByName.forEach((doc) => candidateIds.add(doc.id));
                            }

                            // match by lastDeployUrl as a fallback
                            if (lastUrl) {
                                const snapByUrl = await rendersCol
                                    .where("lastDeployUrl", "==", lastUrl)
                                    .get();
                                snapByUrl.forEach((doc) => candidateIds.add(doc.id));
                            }

                            if (candidateIds.size > 0) {
                                const updates = Array.from(candidateIds).map((rid) =>
                                    rendersCol.doc(rid).update({
                                        lastDeployUrl:
                                            admin.firestore.FieldValue.delete(),
                                        lastExportedAt:
                                            admin.firestore.FieldValue.delete(),
                                        vercelProjectId:
                                            admin.firestore.FieldValue.delete(),
                                        vercelProjectName:
                                            admin.firestore.FieldValue.delete(),
                                    }),
                                );
                                await Promise.allSettled(updates);
                                renderFieldsCleared = true;
                            }
                        } catch (e) {
                            console.error(
                                "Error clearing Vercel fields on original render(s)",
                                { uid, deploymentDocId, dep },
                                e,
                            );
                        }

                        // 2.3) We do NOT delete any renders or their screenshots here.
                        const screenshotsDeleted = 0;
                        const renderDeleted = false;

                        // 2.4) Delete deployment doc itself
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

                        // 2.5) If this project is fully selected, delete the Vercel project
                        let vercelProjectDeleted = false;
                        let vercelProjectStatus: number | null = null;
                        const projKey = projectKeyFromDoc(dep);

                        if (
                            accessToken &&
                            projKey &&
                            projectsToDeleteFully.has(projKey) &&
                            !projectDeletedOnce.has(projKey)
                        ) {
                            const idOrName = projectIdOrNameFromKey(projKey);
                            if (idOrName) {
                                const params = new URLSearchParams();
                                if (teamId) params.set("teamId", teamId);

                                const projUrl = `https://api.vercel.com/v9/projects/${encodeURIComponent(
                                    idOrName,
                                )}${params.toString() ? `?${params.toString()}` : ""
                                    }`;

                                try {
                                    const projRes = await fetch(projUrl, {
                                        method: "DELETE",
                                        headers: {
                                            Authorization: `Bearer ${accessToken}`,
                                        },
                                    });

                                    vercelProjectStatus = projRes.status;
                                    if (projRes.ok || projRes.status === 404) {
                                        vercelProjectDeleted = true;
                                        projectDeletedOnce.add(projKey);
                                    } else {
                                        const projBody = await projRes
                                            .json()
                                            .catch(() => ({} as any));
                                        console.error("Vercel project delete failed", {
                                            projectKey: projKey,
                                            idOrName,
                                            status: projRes.status,
                                            body: projBody,
                                        });
                                    }
                                } catch (e) {
                                    console.error("Error deleting Vercel project", {
                                        projectKey: projKey,
                                        idOrName,
                                        uid,
                                        e,
                                    });
                                }
                            }
                        }

                        results.push({
                            ...base,
                            ok: true,
                            vercelDeleted,
                            vercelStatus,
                            screenshotsDeleted,
                            renderDeleted,
                            renderFieldsCleared,
                            firestoreDeleted,
                            vercelProjectDeleted,
                            vercelProjectStatus,
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
