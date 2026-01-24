// app/api/app-builder/[appId]/deploy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";
import { upsertVercelProjectEnvVar } from "../../../_lib/vercel-env";
import { decryptString, type EncryptedBlobV1 } from "../../../_lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeDeploymentUrl(v: unknown): string {
    const raw = typeof v === "string" ? v.trim() : "";
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return `https://${raw}`;
}

export async function POST(
    req: NextRequest,
    { params }: { params: { appId: string } }
) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
        const db = getAdminDb();
        const appId = params.appId;

        assertAppBuilderScope(authedReq, uid, appId);

        const docRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return NextResponse.json({ error: "App not found" }, { status: 404 });
        }

        const data = doc.data();
        if (data?.userId !== uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        // Server-side tier guard (never trust client)
        const userSnap = await db.doc(`kloner_users/${uid}`).get();
        const userData = userSnap.exists ? (userSnap.data() as any) : {};
        const userTier = userData?.tier ?? "free";

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