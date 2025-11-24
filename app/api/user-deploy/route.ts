// src/app/api/user-deploy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
                return NextResponse.json(
                    { ok: false, error: "Missing html" },
                    { status: 400 }
                );
            }

            const db = getAdminDb();

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
                    return NextResponse.json(
                        { ok: false, error: "Render not found" },
                        { status: 404 }
                    );
                }
                const data = renderDoc.data() || {};

                vercelProjectId = (data.vercelProjectId as string) || vercelProjectId;
                vercelProjectName =
                    (data.vercelProjectName as string) || vercelProjectName;

                // support your client-side save `{ projectVercelName: trimmed }`
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
                return NextResponse.json(
                    { ok: false, error: "Vercel is not connected for this account." },
                    { status: 400 }
                );
            }

            const { accessToken, vercelTeamId } = integrationSnap.data() as {
                accessToken: string;
                vercelTeamId?: string;
            };

            // ───────────────── project name handling ─────────────────
            // Prefer explicit projectName from client, then stored names, then default.
            const rawNameCandidate =
                (typeof projectName === "string" && projectName.trim()) ||
                (typeof renderStoredName === "string" && renderStoredName.trim()) ||
                (typeof vercelProjectName === "string" && vercelProjectName.trim()) ||
                "kloner-site";

            // Slugify: lowercase, alnum + hyphen only, no leading/trailing hyphens
            let projectBaseName = rawNameCandidate
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, "-")
                .replace(/-{2,}/g, "-")
                .replace(/^-+|-+$/g, "");

            if (!projectBaseName) {
                projectBaseName = "kloner-site";
            }

            // Keep a human-readable name around too (before slug) if you want
            const resolvedName = projectBaseName;

            // We want a pure static site
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
                        name: resolvedName, // required `name`
                        framework: FRAMEWORK,
                        buildCommand: null,
                        devCommand: null,
                        outputDirectory: null,
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
                // Project already exists
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

                // Ignore patch failure here; deployment will still attempt
                await patchRes.text().catch(() => undefined);
            }

            // ───────────────── create deployment to project ─────────────────

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

            // Always include `name`; include `project` if we have an id.
            const deployBody: any = {
                name: vercelProjectName || resolvedName || "kloner-site",
                files,
                projectSettings: {
                    framework: FRAMEWORK,
                    buildCommand: null,
                    devCommand: null,
                    outputDirectory: null,
                },
            };

            if (vercelProjectId) {
                // Some APIs still accept `project`; harmless to include alongside `name`.
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
                            "Deployment failed",
                    },
                    { status: 400 }
                );
            }

            const vercelDeploymentId = deployJson.id as string | undefined;
            const vercelStateRaw =
                (deployJson.state as string | undefined) || "building";
            const vercelState = vercelStateRaw.toLowerCase();
            const url = deployJson.url ? `https://${deployJson.url}` : null;

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

                await deploymentRef.set(
                    {
                        vercelDeploymentId,
                        vercelProjectId: vercelProjectId ?? null,
                        vercelProjectName:
                            vercelProjectName || resolvedName || null,
                        vercelUrl: url,
                        vercelState,
                        vercelTeamId: vercelTeamId ?? null,
                        vercelUserId: null,
                        configurationId: null,
                        lastEventType: "created",
                        lastEventId: vercelDeploymentId,
                        lastEventAt: now,
                        createdAt: now,
                        updatedAt: now,
                    },
                    { merge: true }
                );
            }

            return NextResponse.json({
                ok: true,
                url,
                projectId: vercelProjectId,
                projectName: vercelProjectName || resolvedName,
            });
        },
        { methods: ["POST"], csrf: true }
    );
}
