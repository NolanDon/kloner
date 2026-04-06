// app/api/app-builder/[appId]/vercel/protection-bypass/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../../_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeVercelErrorMessage(json: any): string {
    const msg = (json as any)?.error?.message || (json as any)?.message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    return "Failed to enable protection bypass.";
}

function classifyBypassError(message: string): string {
    const m = (message || "").toLowerCase();
    if (m.includes("only native integrations can create automation bypass")) {
        return "vercel_bypass_not_supported";
    }
    return "vercel_bypass_create_failed";
}

function extractBypassSecret(json: any): string | null {
    if (!json || typeof json !== "object") return null;

    // Common shapes we’ve seen / expect:
    // - { bypasses: [{ secret: "..." }] }
    // - { protectionBypass: { bypasses: [{ secret: "..." }] } }
    // - { secret: "..." }
    const candidates: any[] = [];
    if (Array.isArray((json as any).bypasses)) candidates.push(...(json as any).bypasses);
    if (Array.isArray((json as any)?.protectionBypass?.bypasses)) candidates.push(...(json as any).protectionBypass.bypasses);

    for (const item of candidates) {
        const secret = (item?.secret || item?.value || "") as unknown;
        if (typeof secret === "string" && secret.trim().length >= 10) {
            return secret.trim();
        }
    }

    const top = (json as any).secret;
    if (typeof top === "string" && top.trim().length >= 10) return top.trim();

    return null;
}

export async function POST(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const db = getAdminDb();
            const appId = (await Promise.resolve(params))?.appId;

            assertAppBuilderScope(authedReq, uid, appId);

            const appRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
            const appSnap = await appRef.get();
            if (!appSnap.exists) {
                return NextResponse.json({ ok: false, error: "App not found" }, { status: 404 });
            }

            const app = appSnap.data() as any;
            const vercelProjectId = (app?.vercelProjectId || "").toString().trim();
            const vercelProjectName = (app?.vercelProjectName || "").toString().trim();

            const idOrName = vercelProjectId || vercelProjectName;
            if (!idOrName) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: "This app is not linked to a Vercel project yet. Build a preview once to create/link the project, then try again.",
                        code: "vercel_project_missing",
                    },
                    { status: 400 },
                );
            }

            const integrationRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations")
                .doc("vercel");

            const integrationSnap = await integrationRef.get();
            if (!integrationSnap.exists) {
                return NextResponse.json(
                    { ok: false, error: "Vercel is not connected for this account.", code: "vercel_not_connected" },
                    { status: 400 },
                );
            }

            const { accessToken, vercelTeamId } = integrationSnap.data() as {
                accessToken: string;
                vercelTeamId?: string;
            };

            const url = new URL(
                `https://api.vercel.com/v1/projects/${encodeURIComponent(idOrName)}/protection-bypass`,
            );
            if (vercelTeamId) {
                url.searchParams.set("teamId", vercelTeamId);
            }

            const vercelRes = await fetch(url.toString(), {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    generate: {
                        note: "Kloner preview embed",
                    },
                }),
                signal: AbortSignal.timeout(20_000),
            });

            const json = await vercelRes.json().catch(() => ({} as any));
            if (!vercelRes.ok) {
                const message = normalizeVercelErrorMessage(json);
                const code = classifyBypassError(message);
                return NextResponse.json(
                    {
                        ok: false,
                        error: message,
                        code,
                        status: vercelRes.status,
                    },
                    { status: vercelRes.status || 400 },
                );
            }

            const secret = extractBypassSecret(json);
            if (!secret) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: "Vercel enabled protection bypass, but did not return a secret value.",
                        code: "vercel_bypass_secret_missing",
                    },
                    { status: 502 },
                );
            }

            await appRef.update({
                vercelProtectionBypassSecret: secret,
                vercelProtectionBypassCreatedAt: new Date(),
                updatedAt: new Date(),
            });

            return NextResponse.json(
                {
                    ok: true,
                    vercelProtectionBypassSecret: secret,
                    hasVercelProtectionBypassSecret: true,
                },
                { status: 200 },
            );
        },
        { methods: ["POST"], csrf: true },
    );
}
