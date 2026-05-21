import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";
import { upsertVercelProjectEnvVar } from "../../../_lib/vercel-env";
import { decryptString, type EncryptedBlobV1 } from "../../../_lib/crypto";
import { loadVercelIntegration } from "../../../_lib/vercel-integration";
import { refreshTierFromStripeForUid } from "../../../_lib/billing";
import { hydrateAppBuilderFiles } from "../../../_lib/htmlStorage";

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

export async function POST(req: NextRequest, { params }: any) {
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

            const storedUserId = typeof (data as any)?.userId === "string" ? String((data as any).userId).trim() : "";
            if (storedUserId && storedUserId !== uid) {
                const originalUserId = typeof (data as any)?.originalUserId === "string" ? String((data as any).originalUserId).trim() : "";
                console.warn("[app-builder/preview] app doc userId mismatch; self-healing", {
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
                    console.warn("[app-builder/preview] failed to self-heal app doc userId", { uid, appId, e });
                }
            }

            const userSnap = await db.doc(`kloner_users/${uid}`).get();
            const userData = userSnap.exists ? (userSnap.data() as any) : {};

            const normalizeTier = (raw: unknown): "free" | "pro" | "agency" | "enterprise" => {
                const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
                if (t === "pro" || t === "agency" || t === "enterprise") return t;
                return "free";
            };

            let userTier = normalizeTier(userData?.tier);
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
                        error: "Please upgrade your account to create shareable preview links.",
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
                        error: "Vercel is not connected for this account. Visit settings to fix this.",
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

            if (!vercelProjectId) {
                const projectUrl = vercelTeamId
                    ? `https://api.vercel.com/v10/projects?teamId=${encodeURIComponent(vercelTeamId)}`
                    : "https://api.vercel.com/v10/projects";

                const projectRes = await fetch(projectUrl, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        name: resolvedName,
                        framework: "nextjs",
                        buildCommand: "npm run build",
                        devCommand: "npm run dev",
                        outputDirectory: ".next",
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

                await docRef.update({
                    vercelProjectId,
                    vercelProjectName,
                    updatedAt: new Date(),
                });
            }

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
                console.warn(".env.local env sync skipped:", e);
            }

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
                console.warn("Supabase env sync skipped:", e);
            }

            const deploymentFiles: any[] = [];

            if (!files["package.json"]) {
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

                deploymentFiles.push({
                    file: "package.json",
                    data: Buffer.from(
                        JSON.stringify(defaultPackageJson, null, 2),
                        "utf8"
                    ).toString("base64"),
                    encoding: "base64" as const,
                });
            }

            for (const [filePath, fileData] of Object.entries(files)) {
                const lower = String(filePath || "").toLowerCase();
                const base = lower.split("/").pop() || lower;
                if (base === ".env" || base.startsWith(".env.")) {
                    continue;
                }

                const fileInfo = fileData as { content: string; lastModified: number };
                deploymentFiles.push({
                    file: filePath,
                    data: Buffer.from(fileInfo.content, "utf8").toString("base64"),
                    encoding: "base64" as const,
                });
            }

            const deployParams = new URLSearchParams();
            if (vercelTeamId) {
                deployParams.set("teamId", vercelTeamId);
            }
            deployParams.set("skipAutoDetectionConfirmation", "1");

            const deployUrl = `https://api.vercel.com/v13/deployments?${deployParams.toString()}`;

            const deployBody: any = {
                name: vercelProjectName || resolvedName || "kloner-app",
                files: deploymentFiles,
                projectSettings: {
                    framework: "nextjs",
                    buildCommand: "npm run build",
                    devCommand: "npm run dev",
                    outputDirectory: ".next",
                },
                target: "preview",
                public: true,
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
                signal: AbortSignal.timeout(90_000),
            });

            const deployJson = await deployRes.json().catch(() => ({} as any));

            if (!deployRes.ok) {
                return NextResponse.json(
                    {
                        ok: false,
                        error:
                            (deployJson as any)?.error?.message ||
                            "Failed to create preview deployment",
                    },
                    { status: 400 }
                );
            }

            const deploymentUrl = normalizeDeploymentUrl((deployJson as any)?.url);
            if (!deploymentUrl) {
                return NextResponse.json(
                    { ok: false, error: "Vercel preview deployment created, but no URL was returned." },
                    { status: 502 }
                );
            }

            await docRef.update({
                previewUrl: deploymentUrl,
                lastSharePreviewAt: new Date(),
                updatedAt: new Date(),
            });

            return NextResponse.json({
                ok: true,
                url: deploymentUrl,
                previewUrl: deploymentUrl,
                vercelProjectId,
                vercelProjectName,
            });
        },
        { csrf: true, methods: ["POST"] }
    );
}
