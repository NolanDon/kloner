// app/api/app-builder/[appId]/deploy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
    req: NextRequest,
    { params }: { params: { appId: string } }
) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();
        const appId = params.appId;

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

        // Add vercel.json for SPA routing
        deploymentFiles.push({
            file: "vercel.json",
            data: Buffer.from(
                JSON.stringify({
                    rewrites: [{ source: "/(.*)", destination: "/index.html" }],
                }),
                "utf8"
            ).toString("base64"),
            encoding: "base64" as const,
        });

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

        const deploymentUrl = deployJson.url as string;

        // Update app with deployment info
        await docRef.update({
            previewUrl: deploymentUrl,
            lastDeployUrl: deploymentUrl,
            lastExportedAt: new Date(),
            isDeployed: true,
            updatedAt: new Date(),
        });

        return NextResponse.json({
            ok: true,
            url: deploymentUrl,
            vercelProjectId,
            vercelProjectName
        });
    });
}