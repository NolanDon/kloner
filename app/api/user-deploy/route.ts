// src/app/api/user-deploy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { refreshTierFromStripeForUid } from "../_lib/billing";
import { captureCriticalEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reportUserDeployFailure(params: {
    uid: string;
    statusCode: number;
    code: string;
    message: string;
    renderId?: string | null;
    vercelProjectId?: string | null;
    vercelProjectName?: string | null;
    vercelTeamId?: string | null;
    extra?: Record<string, unknown>;
}) {
    void captureCriticalEvent({
        source: "internal",
        severity: params.statusCode >= 500 ? "critical" : "error",
        alwaysNotifySlack: true,
        statusCode: params.statusCode,
        route: "/api/user-deploy",
        method: "POST",
        action: "user_deploy_failed",
        userId: params.uid,
        message: params.message,
        errorName: params.code,
        service: "next-api",
        extra: {
            renderId: params.renderId || null,
            vercelProjectId: params.vercelProjectId || null,
            vercelProjectName: params.vercelProjectName || null,
            vercelTeamId: params.vercelTeamId || null,
            ...params.extra,
        },
    }).catch((err) => {
        console.warn("[user-deploy] failed to report deploy failure to Slack", err);
    });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req }) => {
            const {
                html,
                projectName,
                renderId,
                vercelProjectId: bodyProjectId,
                vercelProjectName: bodyProjectName,
            } = await req.json();

            if (!html || typeof html !== "string") {
                reportUserDeployFailure({
                    uid,
                    statusCode: 400,
                    code: "MISSING_HTML",
                    message: "Missing html",
                });
                return NextResponse.json(
                    { ok: false, error: "Missing html" },
                    { status: 400 }
                );
            }

            const db = getAdminDb();

            // Server-side tier guard (never trust client)
            const userSnap = await db.doc(`kloner_users/${uid}`).get();
            const userData = userSnap.exists ? (userSnap.data() as any) : {};

            const normalizeTier = (raw: unknown): "free" | "pro" | "agency" | "enterprise" => {
                const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
                if (t === "pro" || t === "agency" || t === "enterprise") return t;
                return "free";
            };

            let userTier = normalizeTier(userData?.tier);

            // Self-heal: if Stripe shows paid but tier is still free, force-refresh from Stripe.
            const stripeStatus = typeof userData?.stripeStatus === "string" ? userData.stripeStatus : null;
            const stripeSubId = typeof userData?.stripeSubscriptionId === "string" ? userData.stripeSubscriptionId.trim() : "";
            const tierSource = typeof userData?.tierSource === "string" ? userData.tierSource : "";

            const looksPaidButTierFree =
                userTier === "free" &&
                !!stripeSubId &&
                (stripeStatus === "active" || stripeStatus === "trialing");

            if (userTier === "free" && (looksPaidButTierFree || (tierSource && tierSource !== "stripe"))) {
                try {
                    const refreshed = await refreshTierFromStripeForUid(uid);
                    userTier = refreshed === "pro" || refreshed === "agency" ? refreshed : "free";
                } catch {
                    // ignore
                }
            }

            if (userTier === "free") {
                reportUserDeployFailure({
                    uid,
                    statusCode: 400,
                    code: "FREE_TIER_DEPLOY_BLOCKED",
                    message: "Please upgrade your account to deploy projects.",
                });
                return NextResponse.json(
                    {
                        ok: false,
                        error: "Please upgrade your account to deploy projects.",
                        code: "FREE_TIER_DEPLOY_BLOCKED",
                    },
                    { status: 400 }
                );
            }

            let renderDoc:
                | FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>
                | null = null;

            let vercelProjectId: string | null = bodyProjectId ?? null;
            let vercelProjectName: string | null = bodyProjectName ?? null;
            let renderStoredName: string | null = null;

            if (renderId) {
                const ref = db.doc(`kloner_users/${uid}/kloner_renders/${renderId}`);
                renderDoc = await ref.get();
                if (!renderDoc.exists) {
                    reportUserDeployFailure({
                        uid,
                        statusCode: 404,
                        code: "RENDER_NOT_FOUND",
                        message: "Render not found",
                        renderId: renderId || null,
                    });
                    return NextResponse.json(
                        { ok: false, error: "Render not found" },
                        { status: 404 }
                    );
                }
                const data = renderDoc.data() || {};

                vercelProjectId = (data.vercelProjectId as string) || vercelProjectId;
                vercelProjectName =
                    (data.vercelProjectName as string) || vercelProjectName;

                renderStoredName =
                    (data.projectVercelName as string) ||
                    (data.vercelProjectName as string) ||
                    null;
            }

            const integrationRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("vercel");

            const integrationSnap = await integrationRef.get();
            if (!integrationSnap.exists) {
                reportUserDeployFailure({
                    uid,
                    statusCode: 400,
                    code: "VERCEL_NOT_CONNECTED",
                    message: "Vercel is not connected for this account. Visit settings to fix this.",
                    renderId: renderId || null,
                    vercelProjectId,
                    vercelProjectName,
                });
                return NextResponse.json(
                    {
                        ok: false,
                        error:
                            "Vercel is not connected for this account. Visit settings to fix this.",
                    },
                    { status: 400 }
                );
            }

            const { accessToken, vercelTeamId } = integrationSnap.data() as {
                accessToken: string;
                vercelTeamId?: string;
            };

            // ───────────────── project name handling ─────────────────
            const rawNameCandidate =
                (typeof projectName === "string" && projectName.trim()) ||
                (typeof renderStoredName === "string" && renderStoredName.trim()) ||
                (typeof vercelProjectName === "string" && vercelProjectName.trim()) ||
                "kloner-site";

            let projectBaseName = rawNameCandidate
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, "-")
                .replace(/-{2,}/g, "-")
                .replace(/^-+|-+$/g, "");

            if (!projectBaseName) {
                projectBaseName = "kloner-site";
            }

            const resolvedName = projectBaseName;

            // pure static
            const FRAMEWORK: null = null;

            // ───────────────── create project if needed ─────────────────
            if (!vercelProjectId) {
                const projectUrl = vercelTeamId
                    ? `https://api.vercel.com/v10/projects?teamId=${encodeURIComponent(
                        vercelTeamId
                    )}`
                    : "https://api.vercel.com/v10/projects";

                const projectRes = await fetch(projectUrl, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        name: resolvedName,
                        framework: FRAMEWORK,
                        buildCommand: null,
                        devCommand: null,
                        outputDirectory: null,
                    }),
                });

                const projectJson = await projectRes.json().catch(() => ({} as any));

                if (!projectRes.ok) {
                    reportUserDeployFailure({
                        uid,
                        statusCode: 400,
                        code: "VERCEL_PROJECT_CREATE_FAILED",
                        message:
                            (projectJson as any)?.error?.message ||
                            "Failed to create Vercel project",
                        renderId: renderId || null,
                        vercelProjectId,
                        vercelProjectName,
                        vercelTeamId: vercelTeamId || null,
                    });
                    return NextResponse.json(
                        {
                            ok: false,
                            error:
                                (projectJson as any)?.error?.message ||
                                "Failed to create Vercel project",
                        },
                        { status: 400 }
                    );
                }

                vercelProjectId = projectJson.id as string;
                vercelProjectName =
                    (projectJson.name as string) || resolvedName || "kloner-site";

                if (renderDoc) {
                    await renderDoc.ref.set(
                        {
                            vercelProjectId,
                            vercelProjectName,
                        },
                        { merge: true }
                    );
                }
            } else {
                const patchUrl = vercelTeamId
                    ? `https://api.vercel.com/v10/projects/${vercelProjectId}?teamId=${encodeURIComponent(
                        vercelTeamId
                    )}`
                    : `https://api.vercel.com/v10/projects/${vercelProjectId}`;

                const patchRes = await fetch(patchUrl, {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        framework: FRAMEWORK,
                        buildCommand: null,
                        devCommand: null,
                        outputDirectory: null,
                        rootDirectory: null,
                    }),
                });

                await patchRes.text().catch(() => undefined);
            }

            // ───────────────── create deployment ─────────────────

            const indexFile = {
                file: "index.html",
                data: Buffer.from(html, "utf8").toString("base64"),
                encoding: "base64" as const,
            };

            const vercelJsonFile = {
                file: "vercel.json",
                data: Buffer.from(
                    JSON.stringify({
                        rewrites: [{ source: "/(.*)", destination: "/index.html" }],
                    }),
                    "utf8"
                ).toString("base64"),
                encoding: "base64" as const,
            };

            const files = [indexFile, vercelJsonFile];

            const deployParams = new URLSearchParams();
            if (vercelTeamId) {
                deployParams.set("teamId", vercelTeamId);
            }
            deployParams.set("skipAutoDetectionConfirmation", "1");

            const deployUrl = `https://api.vercel.com/v13/deployments?${deployParams.toString()}`;

            const deployBody: any = {
                name: vercelProjectName || resolvedName || "kloner-site",
                files,
                projectSettings: {
                    framework: FRAMEWORK,
                    buildCommand: null,
                    devCommand: null,
                    outputDirectory: null,
                },
                target: "production",
            };

            if (vercelProjectId) {
                deployBody.project = vercelProjectId;
            }

            const deployRes = await fetch(deployUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(deployBody),
            });

            const deployJson = await deployRes.json().catch(() => ({} as any));

            if (!deployRes.ok) {
                reportUserDeployFailure({
                    uid,
                    statusCode: deployRes.status,
                    code: "VERCEL_DEPLOY_FAILED",
                    message:
                        (deployJson as any)?.error?.message ||
                        "Deployment failed",
                    renderId: renderId || null,
                    vercelProjectId,
                    vercelProjectName,
                    vercelTeamId: vercelTeamId || null,
                    extra: {
                        vercelStatus: deployRes.status,
                    },
                });
                return NextResponse.json(
                    {
                        ok: false,
                        error:
                            (deployJson as any)?.error?.message ||
                            "Deployment failed",
                    },
                    { status: 400 }
                );
            }

            const vercelDeploymentId = deployJson.id as string | undefined;

            const vercelReadyStateRaw =
                (deployJson.readyState as string | undefined) || null;
            const vercelReadyState = vercelReadyStateRaw
                ? vercelReadyStateRaw.toLowerCase()
                : null;

            const vercelStateRaw =
                (deployJson.state as string | undefined) ||
                vercelReadyStateRaw ||
                "building";
            const vercelState = vercelStateRaw.toLowerCase();

            const deploymentUrl = deployJson.url ? `https://${deployJson.url}` : null;

            // ───────── resolve canonical public domain ─────────
            let publicDomain: string | null = null;

            if (vercelProjectId) {
                try {
                    const domainsUrl = vercelTeamId
                        ? `https://api.vercel.com/v10/projects/${vercelProjectId}/domains?teamId=${encodeURIComponent(
                            vercelTeamId
                        )}`
                        : `https://api.vercel.com/v10/projects/${vercelProjectId}/domains`;

                    const domainsRes = await fetch(domainsUrl, {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                        },
                    });

                    if (domainsRes.ok) {
                        const domainsJson = (await domainsRes.json().catch(
                            () => ({} as any)
                        )) as any;
                        const domains = (domainsJson?.domains || []) as any[];

                        const primary =
                            domains.find((d: any) => d?.primary) ||
                            domains.find((d: any) => d?.verified) ||
                            domains[0];

                        if (
                            primary &&
                            typeof primary.name === "string" &&
                            primary.name.trim().length > 0
                        ) {
                            publicDomain = primary.name.trim();
                        }
                    }
                } catch {
                    // ignore; deploymentUrl still usable
                }
            }

            // if domains API doesn't give anything, fall back to the project .vercel.app name
            if (!publicDomain && vercelProjectName) {
                publicDomain = `${vercelProjectName}.vercel.app`;
            }

            const publicUrl = publicDomain ? `https://${publicDomain}` : null;
            const url = publicUrl || deploymentUrl;

            let initialEvent: string | null = null;
            switch (vercelReadyState) {
                case "queued":
                    initialEvent = "deployment.queued";
                    break;
                case "building":
                    initialEvent = "deployment.building";
                    break;
                case "ready":
                    initialEvent = "deployment.ready";
                    break;
                case "error":
                    initialEvent = "deployment.error";
                    break;
                case "canceled":
                case "cancelled":
                    initialEvent = "deployment.canceled";
                    break;
                default:
                    initialEvent = "deployment.created";
            }

            if (renderDoc && url) {
                await renderDoc.ref.set(
                    {
                        lastDeployUrl: url,
                        lastExportedAt: new Date(),
                    },
                    { merge: true }
                );
            }

            if (vercelDeploymentId) {
                const now = Date.now();

                const deploymentRef = db
                    .collection("kloner_users")
                    .doc(uid)
                    .collection("deployments")
                    .doc(vercelDeploymentId);

                const vercelMeta: any = {};
                if (publicDomain) vercelMeta.publicDomain = publicDomain;
                if (deploymentUrl) vercelMeta.deploymentUrl = deploymentUrl;

                await deploymentRef.set(
                    {
                        vercelDeploymentId,
                        vercelProjectId: vercelProjectId ?? null,
                        vercelProjectName:
                            vercelProjectName || resolvedName || null,
                        vercelUrl: deploymentUrl,
                        vercelState,
                        vercelReadyState,
                        vercelTarget: "production",
                        vercelTeamId: vercelTeamId ?? null,
                        vercelUserId: null,
                        configurationId: null,
                        lastEventType: initialEvent,
                        lastEventId: vercelDeploymentId,
                        lastEventAt: now,
                        createdAt: now,
                        updatedAt: now,

                        // NEW: top-level canonical fields you can trust
                        publicDomain: publicDomain || null,
                        publicUrl: url || null,

                        vercelMeta:
                            Object.keys(vercelMeta).length > 0 ? vercelMeta : null,
                    },
                    { merge: true }
                );
            }

            return NextResponse.json({
                ok: true,
                url,
                projectId: vercelProjectId,
                projectName: vercelProjectName || resolvedName,
                publicDomain: publicDomain || null,
                deploymentUrl: deploymentUrl || null,
            });
        },
        { methods: ["POST"], csrf: true }
    );
}
