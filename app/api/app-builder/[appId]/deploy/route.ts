// app/api/app-builder/[appId]/deploy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";
import { upsertVercelProjectEnvVar } from "../../../_lib/vercel-env";
import { decryptString, type EncryptedBlobV1 } from "../../../_lib/crypto";
import { loadVercelIntegration } from "../../../_lib/vercel-integration";
import { refreshTierFromStripeForUid } from "../../../_lib/billing";
import { hydrateAppBuilderFiles } from "../../../_lib/htmlStorage";
import { captureCriticalEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDotEnv(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    const lines = String(raw || "").split(/\r?\n/);

    for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line || line.startsWith("#")) continue;

        const cleaned = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
        const eq = cleaned.indexOf("=");
        if (eq <= 0) continue;

        const key = cleaned.slice(0, eq).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

        let value = cleaned.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        // Basic unescaping for common .env usage
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
        out[key] = value;
    }

    return out;
}

function normalizeDeploymentUrl(v: unknown): string {
    const raw = typeof v === "string" ? v.trim() : "";
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return `https://${raw}`;
}

function estimateUtf8Bytes(value: unknown): number {
    try {
        return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
    } catch {
        return 0;
    }
}

function sha1Hex(text: string): string {
    return createHash("sha1").update(text, "utf8").digest("hex");
}

function readPackageJsonFramework(files: Record<string, { content: string }>): "nextjs" | "vite" | null {
    const pkgEntry = files["package.json"];
    const raw = typeof pkgEntry?.content === "string" ? pkgEntry.content : "";
    if (!raw) return null;

    try {
        const pkg = JSON.parse(raw) as any;
        const dependencies = {
            ...(pkg?.dependencies || {}),
            ...(pkg?.devDependencies || {}),
        } as Record<string, unknown>;
        const scripts = (pkg?.scripts || {}) as Record<string, unknown>;
        const hasNextDependency = Boolean(dependencies.next || dependencies["next"]);
        const hasViteDependency = Boolean(dependencies.vite || dependencies["@vitejs/plugin-react"]);
        const buildScript = String(scripts.build || "").toLowerCase();

        if (hasNextDependency) return "nextjs";
        if (hasViteDependency || buildScript.includes("vite")) return "vite";
    } catch {
        // ignore parse errors; fall through to file-based detection
    }

    return null;
}

function detectDeploymentFramework(files: Record<string, { content: string }>): "nextjs" | "vite" | null {
    const packageFramework = readPackageJsonFramework(files);
    if (packageFramework) return packageFramework;

    const paths = Object.keys(files || {}).map((path) => path.toLowerCase());
    if (paths.some((path) => path === "next.config.js" || path === "next.config.mjs" || path === "next.config.ts")) {
        return "nextjs";
    }
    if (paths.some((path) => path.startsWith("app/") || path.startsWith("pages/") || path.startsWith("src/app/") || path.startsWith("src/pages/"))) {
        return "nextjs";
    }
    if (paths.some((path) => path === "vite.config.js" || path === "vite.config.ts" || path === "vite.config.mjs")) {
        return "vite";
    }

    return null;
}

async function uploadVercelFile(accessToken: string, filePath: string, content: string): Promise<{ file: string; sha: string; size: number }> {
    const sha = sha1Hex(content);
    const size = Buffer.byteLength(content, "utf8");

    const uploadRes = await fetch("https://api.vercel.com/v2/now/files", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "text/plain",
            "x-vercel-digest": sha,
        },
        body: content,
        signal: AbortSignal.timeout(90_000),
    });

    if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => "");
        throw new Error(`Failed to upload ${filePath} to Vercel (${uploadRes.status}): ${text || "unknown"}`);
    }

    return { file: filePath, sha, size };
}

async function uploadVercelFiles(accessToken: string, files: Array<{ file: string; content: string }>): Promise<Array<{ file: string; sha: string; size: number }>> {
    const results: Array<{ file: string; sha: string; size: number }> = [];
    const batchSize = 8;

    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const uploaded = await Promise.all(batch.map((item) => uploadVercelFile(accessToken, item.file, item.content)));
        results.push(...uploaded);
    }

    return results;
}

function reportDeployFailure(params: {
    uid: string;
    appId: string;
    appName: string;
    vercelProjectId: string | null;
    vercelProjectName: string | null;
    vercelTeamId: string | undefined;
    statusCode: number;
    code: string;
    message: string;
    extra?: Record<string, unknown>;
}) {
    void captureCriticalEvent({
        source: "internal",
        severity: params.statusCode >= 500 || params.code === "VERCEL_DEPLOY_BODY_TOO_LARGE" ? "critical" : "error",
        alwaysNotifySlack: true,
        statusCode: params.statusCode,
        route: "/api/app-builder/[appId]/deploy",
        method: "POST",
        action: params.code === "VERCEL_DEPLOY_BODY_TOO_LARGE" ? "app_builder_deploy_body_too_large" : "app_builder_deploy_failed",
        userId: params.uid,
        message: params.message,
        errorName: params.code,
        extra: {
            appId: params.appId,
            appName: params.appName,
            vercelProjectId: params.vercelProjectId,
            vercelProjectName: params.vercelProjectName,
            teamId: params.vercelTeamId || null,
            ...params.extra,
        },
    }).catch((err) => {
        console.warn("[app-builder/deploy] failed to report deploy failure to Slack", err);
    });
}

export async function POST(
    req: NextRequest,
    { params }: any
) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
        const db = getAdminDb();
        const appId = (await Promise.resolve(params))?.appId;

        assertAppBuilderScope(authedReq, uid, appId);

        const docRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return NextResponse.json({ ok: false, error: "App not found" }, { status: 404 });
        }

        const data = doc.data();
        if (!data) {
            return NextResponse.json({ ok: false, error: "App data not found" }, { status: 404 });
        }
        // Source of truth for ownership is the document path:
        // `kloner_users/{uid}/kloner_apps/{appId}` is already user-scoped.
        // Some legacy/cloned apps may have a stale `userId` field that doesn't match,
        // which should not block deploy.
        const storedUserId = typeof (data as any)?.userId === "string" ? String((data as any).userId).trim() : "";
        if (storedUserId && storedUserId !== uid) {
            const originalUserId = typeof (data as any)?.originalUserId === "string" ? String((data as any).originalUserId).trim() : "";
            console.warn("[app-builder/deploy] app doc userId mismatch; self-healing", {
                uid,
                appId,
                storedUserId,
            });
            try {
                await docRef.set(
                    {
                        userId: uid,
                        ...(originalUserId ? {} : { originalUserId: storedUserId }),
                        updatedAt: new Date(),
                    },
                    { merge: true },
                );
            } catch (e) {
                console.warn("[app-builder/deploy] failed to self-heal app doc userId", { uid, appId, e });
            }
        }

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

        const needsDowngradeReconcile =
            userTier !== "free" &&
            (!stripeSubId ||
                stripeStatus === "canceled" ||
                stripeStatus === "incomplete_expired" ||
                stripeStatus === "paused" ||
                stripeStatus === "past_due" ||
                stripeStatus === "unpaid" ||
                stripeStatus === "incomplete");

        if (looksPaidButTierFree || needsDowngradeReconcile || (tierSource && tierSource !== "stripe")) {
            try {
                const refreshed = await refreshTierFromStripeForUid(uid);
                userTier = refreshed === "pro" || refreshed === "agency" ? refreshed : "free";
            } catch {
                // ignore; fall back to stored tier
            }
        }

        if (userTier === "free") {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Please upgrade your account to deploy projects.",
                    code: "FREE_TIER_DEPLOY_BLOCKED",
                },
                { status: 400 }
            );
        }

        const appName = data.name || `app-${appId}`;
        const files = await hydrateAppBuilderFiles({
            db,
            uid,
            appId,
            files: (data.files || {}) as any,
            fileManifest: (data as any).fileManifest || null,
            fileStorageCollection: typeof (data as any).fileStorageCollection === "string" ? (data as any).fileStorageCollection : null,
            fileStorageMode: typeof (data as any).fileStorageMode === "string" ? (data as any).fileStorageMode : null,
            containerCode: typeof (data as any).containerCode === "string" ? (data as any).containerCode : null,
            htmlStoragePath: (data as any).htmlStoragePath || null,
            htmlEditIndex: (data as any).htmlEditIndex,
        });

        let vercelProjectId: string | null = data.vercelProjectId ?? null;
        let vercelProjectName: string | null = data.vercelProjectName ?? null;

        // Check Vercel integration
        const integrationRef = db
            .collection("kloner_users")
            .doc(uid)
            .collection("integrations")
            .doc("vercel");

        const integration = await loadVercelIntegration(integrationRef as any);
        if (!integration.exists) {
            return NextResponse.json(
                {
                    ok: false,
                    error:
                        "Vercel is not connected for this account. Visit settings to fix this.",
                },
                { status: 400 }
            );
        }

        const accessToken = integration.accessToken;
        const vercelTeamId = typeof integration.data?.vercelTeamId === "string" ? integration.data.vercelTeamId : undefined;

        if (!accessToken) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Missing Vercel access token for this account.",
                },
                { status: 400 }
            );
        }

        // ───────────────── project name handling ─────────────────
        const rawNameCandidate = appName;
        let projectBaseName = rawNameCandidate
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .replace(/-{2,}/g, "-")
            .replace(/^-+|-+$/g, "");

        if (!projectBaseName) {
            projectBaseName = "kloner-app";
        }

        const resolvedName = projectBaseName;

        const deploymentFramework = detectDeploymentFramework(files as Record<string, { content: string }>);

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
                    ...(deploymentFramework ? { framework: deploymentFramework } : {}),
                    ...(deploymentFramework === "nextjs"
                        ? {
                            buildCommand: "npm run build",
                            devCommand: "npm run dev",
                            outputDirectory: ".next",
                        }
                        : {}),
                    rootDirectory: null,
                }),
                signal: AbortSignal.timeout(30_000),
            });

            const projectJson = await projectRes.json().catch(() => ({} as any));

            if (!projectRes.ok) {
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
                (projectJson.name as string) || resolvedName || "kloner-app";

            // Update app with Vercel project info
            await docRef.update({
                vercelProjectId,
                vercelProjectName,
                updatedAt: new Date(),
            });
        }

        // ───────────────── .env.local -> Vercel env sync (best-effort) ─────────────────
        // Never deploy env files; instead, if the app includes a `.env.local`, push those
        // key/value pairs into the user's Vercel project environment variables.
        try {
            if (vercelProjectId) {
                let envLocalContent: string | null = null;
                for (const [filePath, fileData] of Object.entries(files)) {
                    const lower = String(filePath || "").toLowerCase();
                    const base = lower.split("/").pop() || lower;
                    if (base === ".env.local") {
                        const fileInfo = fileData as { content?: string };
                        envLocalContent = typeof fileInfo?.content === "string" ? fileInfo.content : null;
                        break;
                    }
                }

                if (envLocalContent) {
                    const envVars = parseDotEnv(envLocalContent);
                    for (const [key, value] of Object.entries(envVars)) {
                        // Avoid clobbering Vercel-managed environment variables.
                        if (key === "NODE_ENV") continue;
                        if (key.startsWith("VERCEL_")) continue;

                        await upsertVercelProjectEnvVar({
                            accessToken,
                            teamId: vercelTeamId,
                            projectId: vercelProjectId,
                            key,
                            value,
                            type: "encrypted",
                        });
                    }
                }
            }
        } catch (e) {
            // Do not block deploy on env sync.
            console.warn(".env.local env sync skipped:", e);
        }

        // ───────────────── Supabase env sync (best-effort) ─────────────────
        // If the user connected Supabase, ensure the deployed app has env vars.
        try {
            const supabaseSnap = await db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("supabase")
                .get();

            if (supabaseSnap.exists && vercelProjectId) {
                const supabase = supabaseSnap.data() as any;
                const supabaseUrl = typeof supabase?.supabaseUrl === "string" ? supabase.supabaseUrl : "";
                const anonKeyEnc = supabase?.anonKey as EncryptedBlobV1 | null | undefined;
                const serviceRoleEnc = supabase?.serviceRoleKey as EncryptedBlobV1 | null | undefined;

                if (supabaseUrl) {
                    await upsertVercelProjectEnvVar({
                        accessToken,
                        teamId: vercelTeamId,
                        projectId: vercelProjectId,
                        key: "NEXT_PUBLIC_SUPABASE_URL",
                        value: supabaseUrl,
                        type: "encrypted",
                    });
                    await upsertVercelProjectEnvVar({
                        accessToken,
                        teamId: vercelTeamId,
                        projectId: vercelProjectId,
                        key: "SUPABASE_URL",
                        value: supabaseUrl,
                        type: "encrypted",
                    });
                }

                if (anonKeyEnc) {
                    const anonKey = decryptString(anonKeyEnc);
                    await upsertVercelProjectEnvVar({
                        accessToken,
                        teamId: vercelTeamId,
                        projectId: vercelProjectId,
                        key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
                        value: anonKey,
                        type: "encrypted",
                    });
                }

                if (serviceRoleEnc) {
                    const serviceRoleKey = decryptString(serviceRoleEnc);
                    await upsertVercelProjectEnvVar({
                        accessToken,
                        teamId: vercelTeamId,
                        projectId: vercelProjectId,
                        key: "SUPABASE_SERVICE_ROLE_KEY",
                        value: serviceRoleKey,
                        type: "encrypted",
                    });
                }
            }
        } catch (e) {
            // Do not block deploy on env sync.
            console.warn("Supabase env sync skipped:", e);
        }

        // ───────────────── prepare files for deployment ─────────────────
        const deploymentSourceFiles: Array<{ file: string; content: string }> = [];

        // Add package.json if not present
        if (deploymentFramework === "nextjs" && !files["package.json"]) {
            const defaultPackageJson = {
                name: resolvedName,
                version: "1.0.0",
                scripts: {
                    dev: "next dev",
                    build: "next build",
                    start: "next start"
                },
                dependencies: {
                    "next": "^14.0.0",
                    "react": "^18.0.0",
                    "react-dom": "^18.0.0"
                }
            };

            deploymentSourceFiles.push({
                file: "package.json",
                content: JSON.stringify(defaultPackageJson, null, 2),
            });
        }

        // NOTE: Do not inject an SPA-style vercel.json rewrite for Next.js.
        // If the user has a vercel.json in their files, we'll deploy it as-is.

        // Convert app files to deployment format
        for (const [filePath, fileData] of Object.entries(files)) {
            // Security: never deploy env files.
            // These may exist locally for dev/preview, but must not be shipped.
            const lower = String(filePath || "").toLowerCase();
            const base = lower.split("/").pop() || lower;
            if (base === ".env" || base.startsWith(".env.")) {
                continue;
            }

            const fileInfo = fileData as { content: string; lastModified: number };
            deploymentSourceFiles.push({
                file: filePath,
                content: fileInfo.content,
            });
        }

        let deploymentFiles: Array<{ file: string; sha: string; size: number }> = [];
        try {
            deploymentFiles = await uploadVercelFiles(accessToken, deploymentSourceFiles);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reportDeployFailure({
                uid,
                appId,
                appName,
                vercelProjectId,
                vercelProjectName,
                vercelTeamId,
                statusCode: 502,
                code: "VERCEL_DEPLOY_FILE_UPLOAD_FAILED",
                message: `Failed to upload files to Vercel before deploying: ${message}`,
                extra: {
                    phase: "upload_files",
                    deploymentFileCount: deploymentSourceFiles.length,
                },
            });

            return NextResponse.json(
                {
                    ok: false,
                    error: `Failed to upload files to Vercel before deploying: ${message}`,
                    code: "VERCEL_DEPLOY_FILE_UPLOAD_FAILED",
                },
                { status: 502 },
            );
        }

        // ───────────────── create deployment ─────────────────
        const deployParams = new URLSearchParams();
        if (vercelTeamId) {
            deployParams.set("teamId", vercelTeamId);
        }
        deployParams.set("skipAutoDetectionConfirmation", "1");

        const deployUrl = `https://api.vercel.com/v13/deployments?${deployParams.toString()}`;

        const deployBody: any = {
            name: vercelProjectName || resolvedName || "kloner-app",
            files: deploymentFiles,
            target: "production",
        };

        if (deploymentFramework === "nextjs") {
            deployBody.projectSettings = {
                framework: "nextjs",
                buildCommand: "npm run build",
                devCommand: "npm run dev",
                outputDirectory: ".next",
            };
        }

        const deployBodyBytes = estimateUtf8Bytes(deployBody);
        const bodyLimitBytes = 10 * 1024 * 1024;

        if (deployBodyBytes > bodyLimitBytes) {
            const message = "This deployment is too large for Vercel's request-body limit. The hydrated file payload exceeds 10mb, so the app needs to be reduced or split before it can be deployed.";
            reportDeployFailure({
                uid,
                appId,
                appName,
                vercelProjectId,
                vercelProjectName,
                vercelTeamId,
                statusCode: 413,
                code: "VERCEL_DEPLOY_BODY_TOO_LARGE",
                message,
                extra: {
                    deployBodyBytes,
                    bodyLimitBytes,
                    fileCount: deploymentFiles.length,
                    phase: "create_deployment_preflight",
                },
            });

            return NextResponse.json(
                {
                    ok: false,
                    error: message,
                    code: "VERCEL_DEPLOY_BODY_TOO_LARGE",
                    deployBodyBytes,
                    bodyLimitBytes,
                },
                { status: 413 },
            );
        }

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
            signal: AbortSignal.timeout(90_000),
        });

        const deployJson = await deployRes.json().catch(() => ({} as any));

        if (!deployRes.ok) {
            const errorMessage =
                (deployJson as any)?.error?.message ||
                (deployJson as any)?.error ||
                "Failed to deploy to Vercel";

            if (deployRes.status === 413 || /body limit|request-body limit|too large/i.test(String(errorMessage))) {
                const message = "This deployment is too large for Vercel's request-body limit. The hydrated file payload exceeds 10mb, so the app needs to be reduced or split before it can be deployed.";
                reportDeployFailure({
                    uid,
                    appId,
                    appName,
                    vercelProjectId,
                    vercelProjectName,
                    vercelTeamId,
                    statusCode: 413,
                    code: "VERCEL_DEPLOY_BODY_TOO_LARGE",
                    message,
                    extra: {
                        deployBodyBytes,
                        bodyLimitBytes,
                        fileCount: deploymentFiles.length,
                        phase: "create_deployment_response",
                        vercelStatus: deployRes.status,
                        vercelError: errorMessage,
                    },
                });

                return NextResponse.json(
                    {
                        ok: false,
                        error: message,
                        code: "VERCEL_DEPLOY_BODY_TOO_LARGE",
                        deployBodyBytes,
                        bodyLimitBytes,
                    },
                    { status: 413 },
                );
            }

            reportDeployFailure({
                uid,
                appId,
                appName,
                vercelProjectId,
                vercelProjectName,
                vercelTeamId,
                statusCode: deployRes.status,
                code: "VERCEL_DEPLOY_FAILED",
                message: `Failed to deploy to Vercel: ${errorMessage}`,
                extra: {
                    deployBodyBytes,
                    bodyLimitBytes,
                    fileCount: deploymentFiles.length,
                    phase: "create_deployment_response",
                    vercelStatus: deployRes.status,
                    vercelError: errorMessage,
                },
            });

            return NextResponse.json(
                {
                    ok: false,
                    error: errorMessage,
                    code: "VERCEL_DEPLOY_FAILED",
                },
                { status: deployRes.status >= 400 ? deployRes.status : 400 }
            );
        }

        const deploymentUrl = normalizeDeploymentUrl((deployJson as any)?.url);
        if (!deploymentUrl) {
            return NextResponse.json(
                { ok: false, error: "Vercel deployment created, but no URL was returned." },
                { status: 502 }
            );
        }

        // Update app with deployment info
        await docRef.update({
            lastDeployUrl: deploymentUrl,
            productionUrl: deploymentUrl,
            lastDeploymentId: (deployJson as any)?.id || null,
            lastDeploymentState: (deployJson as any)?.readyState || (deployJson as any)?.state || "building",
            lastDeploymentErrorCode: null,
            lastDeploymentErrorMessage: null,
            lastDeploymentErrorAt: null,
            lastDeploymentUrl: deploymentUrl,
            lastExportedAt: new Date(),
            isDeployed: true,
            updatedAt: new Date(),
        });

        return NextResponse.json({
            ok: true,
            url: deploymentUrl,
            previewUrl: deploymentUrl,
            deploymentId: (deployJson as any)?.id || null,
            vercelProjectId,
            vercelProjectName
        });
        },
        { csrf: true, methods: ["POST"] }
    );
}
