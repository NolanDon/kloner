// app/api/app-builder/[appId]/deploy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";
import { upsertVercelProjectEnvVar } from "../../../_lib/vercel-env";
import { decryptString, type EncryptedBlobV1 } from "../../../_lib/crypto";
import { refreshTierFromStripeForUid } from "../../../_lib/billing";

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
                },
                { status: 400 }
            );
        }

        const appName = data.name || `app-${appId}`;
        const files = data.files || {};

        let vercelProjectId: string | null = data.vercelProjectId ?? null;
        let vercelProjectName: string | null = data.vercelProjectName ?? null;

        // Check Vercel integration
        const integrationRef = db
            .collection("kloner_users")
            .doc(uid)
            .collection("integrations")
            .doc("vercel");

        const integrationSnap = await integrationRef.get();
        if (!integrationSnap.exists) {
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
                    framework: "nextjs", // Assume Next.js for apps
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
        const deploymentFiles: any[] = [];

        // Add package.json if not present
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
            deploymentFiles.push({
                file: filePath,
                data: Buffer.from(fileInfo.content, "utf8").toString("base64"),
                encoding: "base64" as const,
            });
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
            projectSettings: {
                framework: "nextjs",
                buildCommand: "npm run build",
                devCommand: "npm run dev",
                outputDirectory: ".next",
            },
            target: "production",
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
                        "Failed to deploy to Vercel",
                },
                { status: 400 }
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
            lastExportedAt: new Date(),
            isDeployed: true,
            updatedAt: new Date(),
        });

        return NextResponse.json({
            ok: true,
            url: deploymentUrl,
            previewUrl: deploymentUrl,
            vercelProjectId,
            vercelProjectName
        });
        },
        { csrf: true, methods: ["POST"] }
    );
}