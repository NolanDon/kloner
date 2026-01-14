// app/api/app-builder/[appId]/preview/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sleep(ms: number) {
    await new Promise((r) => setTimeout(r, ms));
}

async function waitForVercelDeploymentReady(opts: {
    accessToken: string;
    vercelTeamId?: string;
    deploymentId: string;
    timeoutMs?: number;
}) {
    const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 150_000;
    const startedAt = Date.now();

    let attempt = 0;
    while (Date.now() - startedAt < timeoutMs) {
        attempt += 1;

        const url = new URL(`https://api.vercel.com/v13/deployments/${encodeURIComponent(opts.deploymentId)}`);
        if (opts.vercelTeamId) {
            url.searchParams.set("teamId", opts.vercelTeamId);
        }

        const res = await fetch(url.toString(), {
            method: "GET",
            headers: {
                Authorization: `Bearer ${opts.accessToken}`,
            },
            signal: AbortSignal.timeout(20_000),
        });

        const json = (await res.json().catch(() => ({} as any))) as any;
        const readyState = (json?.readyState as string | undefined) || "";

        if (res.ok && readyState === "READY") {
            return { ok: true as const, readyState, json };
        }

        if (res.ok && (readyState === "ERROR" || readyState === "CANCELED")) {
            const msg =
                json?.errorMessage ||
                json?.error?.message ||
                `Vercel deployment failed (readyState=${readyState}).`;
            return { ok: false as const, readyState, error: msg, json };
        }

        // Backoff: 1s → 2s → 3s → 4s → 5s max.
        const waitMs = Math.min(1000 + attempt * 1000, 5000);
        await sleep(waitMs);
    }

    return {
        ok: false as const,
        readyState: "TIMEOUT",
        error: "Vercel preview deployment is taking longer than expected to become ready.",
    };
}

async function getVercelOwnerSlug(opts: { accessToken: string; vercelTeamId?: string }) {
    // If deploying to a team, use team slug. Otherwise use the personal username.
    if (opts.vercelTeamId) {
        const teamUrl = `https://api.vercel.com/v2/teams/${encodeURIComponent(opts.vercelTeamId)}`;
        const teamRes = await fetch(teamUrl, {
            method: "GET",
            headers: { Authorization: `Bearer ${opts.accessToken}` },
            signal: AbortSignal.timeout(15_000),
        });
        const teamJson = (await teamRes.json().catch(() => ({} as any))) as any;
        const slug = typeof teamJson?.slug === "string" ? teamJson.slug : "";
        return slug || null;
    }

    const userRes = await fetch("https://api.vercel.com/v2/user", {
        method: "GET",
        headers: { Authorization: `Bearer ${opts.accessToken}` },
        signal: AbortSignal.timeout(15_000),
    });
    const userJson = (await userRes.json().catch(() => ({} as any))) as any;
    const username = typeof userJson?.user?.username === "string" ? userJson.user.username : "";
    return username || null;
}

function normalizeDeploymentUrl(v: unknown): string {
    const raw = typeof v === "string" ? v.trim() : "";
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return `https://${raw}`;
}

function addVercelProtectionBypass(url: string, secret: unknown): string {
    const s = typeof secret === "string" ? secret.trim() : "";
    if (!s) return url;
    try {
        const u = new URL(url);
        u.searchParams.set("x-vercel-protection-bypass", s);
        return u.toString();
    } catch {
        const suffix = url.includes("?") ? "&" : "?";
        return `${url}${suffix}x-vercel-protection-bypass=${encodeURIComponent(s)}`;
    }
}

function isInvalidTargetError(json: any): boolean {
    const msg =
        (typeof json?.error?.message === "string" && json.error.message) ||
        (typeof json?.message === "string" && json.message) ||
        "";
    return (
        /invalid request/i.test(msg) &&
        /`target`/i.test(msg) &&
        /(production|staging)/i.test(msg)
    );
}

async function createVercelDeploymentWithTargetFallback(opts: {
    accessToken: string;
    vercelTeamId?: string;
    body: any;
}) {
    const deployParams = new URLSearchParams();
    if (opts.vercelTeamId) {
        deployParams.set("teamId", opts.vercelTeamId);
    }
    deployParams.set("skipAutoDetectionConfirmation", "1");
    const deployUrl = `https://api.vercel.com/v13/deployments?${deployParams.toString()}`;

    // Vercel API has evolved: some accounts now accept "staging" instead of "preview".
    const targets: Array<"preview" | "staging" | null> = ["preview", "staging", null];
    let lastJson: any = null;
    let lastStatus = 0;

    for (const t of targets) {
        const body = { ...opts.body } as any;
        if (t) body.target = t;
        else delete body.target;

        const res = await fetch(deployUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${opts.accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(90_000),
        });

        const json = await res.json().catch(() => ({} as any));
        lastJson = json;
        lastStatus = res.status;

        if (res.ok) {
            return { ok: true as const, json };
        }

        // Only retry if this looks exactly like the target validation error.
        if (!isInvalidTargetError(json)) {
            break;
        }
    }

    return { ok: false as const, status: lastStatus || 400, json: lastJson || {} };
}

export async function POST(
    req: NextRequest,
    { params }: { params: { appId: string } },
) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const db = getAdminDb();
            const appId = params.appId;

            assertAppBuilderScope(authedReq, uid, appId);

            const docRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("kloner_apps")
                .doc(appId);

            const doc = await docRef.get();
            if (!doc.exists) {
                return NextResponse.json({ ok: false, error: "App not found" }, { status: 404 });
            }

            const data = doc.data() as any;
            if (!data || data.userId !== uid) {
                return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
            }

            const appName = (data.name as string) || `app-${appId}`;
            const files = (data.files as Record<string, { content: string; lastModified: number }>) || {};

            let vercelProjectId: string | null = data.vercelProjectId ?? null;
            let vercelProjectName: string | null = data.vercelProjectName ?? null;
            const vercelProtectionBypassSecret = (data.vercelProtectionBypassSecret as string | undefined) ?? "";

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
                        error: "Vercel is not connected for this account.",
                        code: "vercel_not_connected",
                    },
                    { status: 400 },
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
                        { status: 400 },
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
                        start: "next start",
                    },
                    dependencies: {
                        next: "^14.0.0",
                        react: "^18.0.0",
                        "react-dom": "^18.0.0",
                    },
                };

                deploymentFiles.push({
                    file: "package.json",
                    data: Buffer.from(
                        JSON.stringify(defaultPackageJson, null, 2),
                        "utf8",
                    ).toString("base64"),
                    encoding: "base64" as const,
                });
            }

            for (const [filePath, fileData] of Object.entries(files)) {
                const fileInfo = fileData as { content: string; lastModified: number };
                deploymentFiles.push({
                    file: filePath,
                    data: Buffer.from(fileInfo.content, "utf8").toString("base64"),
                    encoding: "base64" as const,
                });
            }

            // ───────────────── create preview deployment ─────────────────
            const deployBody: any = {
                name: vercelProjectName || resolvedName || "kloner-app",
                files: deploymentFiles,
                projectSettings: {
                    framework: "nextjs",
                    buildCommand: "npm run build",
                    devCommand: "npm run dev",
                    outputDirectory: ".next",
                },
                public: true,
            };

            if (vercelProjectId) {
                deployBody.project = vercelProjectId;
            }

            const created = await createVercelDeploymentWithTargetFallback({
                accessToken,
                vercelTeamId,
                body: deployBody,
            });

            if (!created.ok) {
                const deployJson = created.json as any;
                return NextResponse.json(
                    {
                        ok: false,
                        error:
                            (deployJson as any)?.error?.message ||
                            "Failed to create preview deployment",
                    },
                    { status: created.status || 400 },
                );
            }

            const deployJson = created.json as any;

            const deploymentId = (deployJson as any)?.id as string | undefined;
            if (deploymentId) {
                const ready = await waitForVercelDeploymentReady({
                    accessToken,
                    vercelTeamId,
                    deploymentId,
                });

                if (!ready.ok) {
                    return NextResponse.json(
                        {
                            ok: false,
                            error: ready.error || "Preview deployment failed to become ready.",
                            code: "vercel_preview_not_ready",
                            readyState: ready.readyState,
                        },
                        { status: 502 },
                    );
                }
            }

            const deploymentUrl = normalizeDeploymentUrl((deployJson as any)?.url);
            if (!deploymentUrl) {
                return NextResponse.json(
                    { ok: false, error: "Vercel deployment created, but no URL was returned." },
                    { status: 502 },
                );
            }

            let vercelSecuritySettingsUrl: string | null = null;
            let vercelDeploymentProtectionSettingsUrl: string | null = null;
            try {
                const ownerSlug = await getVercelOwnerSlug({ accessToken, vercelTeamId });
                const projectSlug = (vercelProjectName || resolvedName || "").trim();
                if (ownerSlug && projectSlug) {
                    vercelSecuritySettingsUrl = `https://vercel.com/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(projectSlug)}/settings/security`;
                    // Vercel’s UI often exposes the iframe-blocking setting under “Deployment Protection”, not the generic security page.
                    vercelDeploymentProtectionSettingsUrl = `https://vercel.com/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(projectSlug)}/settings/deployment-protection`;
                }
            } catch {
                vercelSecuritySettingsUrl = null;
                vercelDeploymentProtectionSettingsUrl = null;
            }

            // Sanity check: if the deployment is protected (401/403), it will refuse to load in an iframe.
            // This is common when a team enforces Vercel Authentication for preview deployments.
            try {
                const headUrl = addVercelProtectionBypass(deploymentUrl, vercelProtectionBypassSecret);
                const head = await fetch(headUrl, {
                    method: "HEAD",
                    redirect: "follow",
                    signal: AbortSignal.timeout(15_000),
                });
                if (head.status === 401 || head.status === 403) {
                    return NextResponse.json(
                        {
                            ok: false,
                            error:
                                "This Vercel deployment is protected (401/403) and cannot be embedded in an iframe. In Vercel, disable Deployment Protection / Vercel Authentication (for Preview/Pre-Production deployments) for this project, or configure a protection bypass token.",
                            code: "vercel_deployment_protected",
                            status: head.status,
                            url: deploymentUrl,
                            vercelSecuritySettingsUrl,
                            vercelDeploymentProtectionSettingsUrl,
                            vercelProjectName,
                        },
                        { status: 400 },
                    );
                }
            } catch {
                // Non-fatal; we'll still return the URL.
            }

            await docRef.update({
                previewUrl: deploymentUrl,
                lastPreviewUrl: deploymentUrl,
                lastPreviewedAt: new Date(),
                updatedAt: new Date(),
            });

            return NextResponse.json({
                ok: true,
                url: deploymentUrl,
                previewUrl: deploymentUrl,
                vercelProjectId,
                vercelProjectName,
                deploymentId: (deployJson as any)?.id ?? null,
                vercelSecuritySettingsUrl,
                vercelDeploymentProtectionSettingsUrl,
            });
        },
        { csrf: true, methods: ["POST"] },
    );
}
