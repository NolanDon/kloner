import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminDb } from "../../_lib/auth";
import { decryptString, type EncryptedBlobV1 } from "../../_lib/crypto";
import { getSupabaseAccessToken, getSupabaseIntegration } from "../migrations/_lib";

export const runtime = "nodejs";

function normalizeString(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

async function runManagementApiQuery(params: {
    accessToken: string;
    projectId: string;
    sql: string;
    timeoutMs: number;
}): Promise<{ ok: boolean; status: number; json?: any; error?: string; latencyMs: number }> {
    const startedAt = Date.now();
    try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${params.projectId}/database/query`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${params.accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: params.sql }),
            signal: AbortSignal.timeout(params.timeoutMs),
        });

        const latencyMs = Date.now() - startedAt;
        const json = await res.json().catch(() => ({} as any));
        if (!res.ok) {
            const message =
                (json as any)?.message ||
                (json as any)?.error ||
                (typeof (json as any)?.details === "string" ? (json as any).details : "") ||
                `Supabase query failed (${res.status})`;
            return { ok: false, status: res.status, json, error: message, latencyMs };
        }
        return { ok: true, status: res.status, json, latencyMs };
    } catch (e: any) {
        const latencyMs = Date.now() - startedAt;
        const msg = typeof e?.message === "string" ? e.message : "Query failed";
        return { ok: false, status: 0, error: msg, latencyMs };
    }
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const cleanupIfDeleted = Boolean(body?.cleanupIfDeleted);
            const requestAppId = typeof body?.appId === "string" ? body.appId.trim() : "";

            const integration = await getSupabaseIntegration(uid);
            if (!integration) {
                return NextResponse.json({ ok: true, connected: false, reachable: false, reason: "no_integration" });
            }

            // Enforce 1:1 binding: if the stored integration belongs to a different app, report disconnected.
            const storedBoundAppId = typeof (integration as any)?.boundAppId === "string" && (integration as any).boundAppId.trim()
                ? (integration as any).boundAppId.trim()
                : null;
            if (storedBoundAppId && requestAppId && storedBoundAppId !== requestAppId) {
                return NextResponse.json({ ok: true, connected: false, reachable: false, reason: "app_mismatch" });
            }

            const mode = normalizeString((integration as any)?.mode) || ((integration as any)?.accessToken ? "oauth" : "manual");
            const projectId = normalizeString((integration as any)?.projectId) || normalizeString((integration as any)?.projectRef);

            // OAuth/managed project: run a real SQL ping through the Supabase management API.
            if ((integration as any)?.accessToken && projectId) {
                let accessToken = "";
                try {
                    accessToken = getSupabaseAccessToken(integration);
                } catch {
                    accessToken = "";
                }

                if (!accessToken) {
                    return NextResponse.json({ ok: true, connected: true, reachable: false, reason: "missing_access_token", mode: "oauth" });
                }

                const result = await runManagementApiQuery({
                    accessToken,
                    projectId,
                    sql: "select 1 as ok;",
                    timeoutMs: 20_000,
                });

                if (result.ok) {
                    return NextResponse.json({
                        ok: true,
                        connected: true,
                        reachable: true,
                        reason: "query_ok",
                        mode: "oauth",
                        latencyMs: result.latencyMs,
                    });
                }

                const status = result.status;
                if (status === 404) {
                    if (cleanupIfDeleted) {
                        const db = getAdminDb();
                        const integrations = db.collection("kloner_users").doc(uid).collection("integrations");
                        await Promise.all([
                            integrations.doc("supabase").delete().catch(() => undefined),
                            integrations.doc("supabase_setup").delete().catch(() => undefined),
                        ]);
                    }
                    return NextResponse.json({
                        ok: true,
                        connected: false,
                        reachable: false,
                        reason: "project_deleted",
                        mode: "oauth",
                        error: result.error || "Project not found",
                        cleanedUp: cleanupIfDeleted,
                    });
                }

                if (status === 401 || status === 403) {
                    return NextResponse.json({
                        ok: true,
                        connected: true,
                        reachable: false,
                        reason: "unauthorized",
                        mode: "oauth",
                        error: result.error || "Unauthorized",
                    });
                }

                // Timeouts / transient errors: stay "connected" but mark unreachable.
                return NextResponse.json({
                    ok: true,
                    connected: true,
                    reachable: false,
                    reason: status === 0 ? "timeout_or_network" : "query_failed",
                    mode: "oauth",
                    httpStatus: status || null,
                    error: result.error || "Query failed",
                    latencyMs: result.latencyMs,
                });
            }

            // Manual connection: best-effort health via auth service (does not guarantee DB queries will work).
            const supabaseUrl = normalizeString((integration as any)?.supabaseUrl);
            const encryptedAnonKey = (integration as any)?.anonKey as EncryptedBlobV1 | undefined;
            if (mode === "manual" && supabaseUrl && encryptedAnonKey) {
                let anonKey = "";
                try {
                    anonKey = decryptString(encryptedAnonKey);
                } catch {
                    anonKey = "";
                }

                const healthUrl = supabaseUrl.replace(/\/$/, "") + "/auth/v1/health";
                const startedAt = Date.now();
                const r = await fetch(healthUrl, {
                    headers: anonKey
                        ? {
                              apikey: anonKey,
                              Authorization: `Bearer ${anonKey}`,
                          }
                        : undefined,
                    signal: AbortSignal.timeout(15_000),
                }).catch((e) => ({ ok: false, status: 0, _error: e } as any));

                const latencyMs = Date.now() - startedAt;
                if ((r as any)?.ok) {
                    return NextResponse.json({ ok: true, connected: true, reachable: true, reason: "auth_health_ok", mode: "manual", latencyMs });
                }

                const status = typeof (r as any)?.status === "number" ? (r as any).status : 0;
                if (status === 404) {
                    if (cleanupIfDeleted) {
                        const db = getAdminDb();
                        const integrations = db.collection("kloner_users").doc(uid).collection("integrations");
                        await Promise.all([
                            integrations.doc("supabase").delete().catch(() => undefined),
                            integrations.doc("supabase_setup").delete().catch(() => undefined),
                        ]);
                    }
                    return NextResponse.json({ ok: true, connected: false, reachable: false, reason: "project_deleted", mode: "manual", cleanedUp: cleanupIfDeleted });
                }

                if (status === 401 || status === 403) {
                    return NextResponse.json({ ok: true, connected: true, reachable: false, reason: "unauthorized", mode: "manual" });
                }

                return NextResponse.json({ ok: true, connected: true, reachable: false, reason: status === 0 ? "timeout_or_network" : "auth_health_failed", mode: "manual", httpStatus: status || null, latencyMs });
            }

            return NextResponse.json({ ok: true, connected: true, reachable: false, reason: "unknown_integration_shape" });
        },
        { csrf: true, methods: ["POST"] },
    );
}
