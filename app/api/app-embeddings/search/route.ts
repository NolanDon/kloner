import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { assertAppBuilderScope } from "../../_lib/appBuilderScope";
import { callBackend } from "@/src/lib/callBackend";
import { captureAuditEvent, captureCriticalEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: unknown, max = 10_000): string {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    return text.length <= max ? text : text.slice(0, max);
}

function toMaxChunks(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(10, Math.max(1, Math.floor(parsed)));
}

function parseRetryAfterSeconds(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.ceil(parsed);

    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) {
        return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
    }

    return null;
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const startedAt = Date.now();
            const requestId = authedReq.headers.get("x-request-id") || authedReq.headers.get("x-client-request-id") || null;
            const body = await authedReq.json().catch(() => ({} as any));
            const appId = asString(body?.appId, 200);
            const query = asString(body?.query ?? body?.requestText, 10_000);
            const currentPath = asString(body?.currentPath, 500) || null;
            const maxChunks = toMaxChunks(body?.maxChunks);
            const framework = asString(body?.framework, 80) || null;
            const frameworkLabel = asString(body?.frameworkLabel, 120) || null;
            const frameworkConfidence = asString(body?.frameworkConfidence, 20) || null;
            const frameworkReason = asString(body?.frameworkReason, 500) || null;

            if (!appId || !query) {
                return NextResponse.json({ error: "Missing appId or query" }, { status: 400 });
            }

            assertAppBuilderScope(authedReq, uid, appId);

            const requestBodyText = JSON.stringify({
                appId,
                query,
                requestText: query,
                ...(currentPath ? { currentPath } : {}),
                maxChunks,
                ...(framework ? { framework } : {}),
                ...(frameworkLabel ? { frameworkLabel } : {}),
                ...(frameworkConfidence ? { frameworkConfidence } : {}),
                ...(frameworkReason ? { frameworkReason } : {}),
            });

            console.info("[app-embeddings][route] search_start", {
                requestId,
                appId,
                uid,
                bodySizeBytes: new TextEncoder().encode(requestBodyText).length,
                queryLength: query.length,
                currentPath,
                maxChunks,
            });

            const result = await callBackend(authedReq, {
                path: "/app-embeddings/search",
                method: "POST",
                timeoutMs: 30_000,
                userCtx: { uid },
                body: {
                    appId,
                    query,
                    requestText: query,
                    ...(currentPath ? { currentPath } : {}),
                    maxChunks,
                    ...(framework ? { framework } : {}),
                    ...(frameworkLabel ? { frameworkLabel } : {}),
                    ...(frameworkConfidence ? { frameworkConfidence } : {}),
                    ...(frameworkReason ? { frameworkReason } : {}),
                },
            });

            const backendErrorCode = String((result.json as any)?.code || "").trim().toUpperCase();
            if (result.status === 504 || backendErrorCode === "EMBEDDING_SEARCH_TIMEOUT") {
                void captureCriticalEvent({
                    source: "internal",
                    severity: "critical",
                    alwaysNotifySlack: true,
                    statusCode: 504,
                    route: "/api/app-embeddings/search",
                    method: "POST",
                    action: "app_embeddings_search_timeout",
                    userId: uid,
                    requestId: result.reqId || requestId || undefined,
                    message: `The request timed out after ${Math.round(30_000 / 1000)} seconds. Please try again in a moment.`,
                    service: "app-embeddings",
                    tags: ["app-embeddings", "search", "timeout"],
                    extra: {
                        appId,
                        currentPath,
                        maxChunks,
                        framework,
                        frameworkLabel,
                        frameworkConfidence,
                        frameworkReason,
                        requestId: result.reqId || requestId || null,
                        backendStatus: result.status,
                        backendCode: (result.json as any)?.code || null,
                        backendError: (result.json as any)?.error || null,
                        elapsedMs: Date.now() - startedAt,
                        queryPreview: query.slice(0, 500),
                    },
                });
            }

            const chunks = Array.isArray((result.json as any)?.chunks) ? (result.json as any).chunks : [];
            const elapsedMs = Date.now() - startedAt;
            console.info("[app-embeddings][route] search_end", {
                requestId,
                appId,
                uid,
                status: result.status,
                elapsedMs,
                chunkCount: chunks.length,
                code: (result.json as any)?.code || null,
                returned: typeof (result.json as any)?.returned === "number" ? (result.json as any).returned : null,
                candidates: Array.isArray((result.json as any)?.candidates) ? (result.json as any).candidates.length : null,
                refreshQueued: Boolean((result.json as any)?.refreshQueued || (result.json as any)?.refresh_queued),
            });

            if (elapsedMs >= 5_000 || result.status >= 500 || result.status === 409 || result.status === 503 || result.status === 504) {
                void captureAuditEvent({
                    source: "internal",
                    severity: "info",
                    route: "/api/app-embeddings/search",
                    method: "POST",
                    action: elapsedMs >= 5_000 ? "app_embeddings_search_slow" : "app_embeddings_search_transport_issue",
                    userId: uid,
                    message: "Embedding search transport telemetry",
                    service: "app-embeddings",
                    tags: ["app-embeddings", "search", elapsedMs >= 5_000 ? "slow" : "transport"],
                    extra: {
                        requestId,
                        appId,
                        currentPath,
                        maxChunks,
                        status: result.status,
                        elapsedMs,
                        chunkCount: chunks.length,
                        code: (result.json as any)?.code || null,
                        returned: typeof (result.json as any)?.returned === "number" ? (result.json as any).returned : null,
                        candidates: Array.isArray((result.json as any)?.candidates) ? (result.json as any).candidates.length : null,
                        refreshQueued: Boolean((result.json as any)?.refreshQueued || (result.json as any)?.refresh_queued),
                    },
                });
            }

            if (chunks.length === 0) {
                void captureAuditEvent({
                    source: "internal",
                    severity: "info",
                    route: "/api/app-embeddings/search",
                    method: "POST",
                    action: "app_embeddings_search_no_results",
                    userId: uid,
                    message: "Embedding search returned no chunks",
                    service: "app-embeddings",
                    tags: ["app-embeddings", "search", "no-results"],
                    extra: {
                        appId,
                        currentPath,
                        query,
                        maxChunks,
                        chunkCount: 0,
                    },
                });
            }

            const retryAfter = result.upstream.headers.get("retry-after");
            const response = NextResponse.json(
                {
                    ...(result.json as any),
                    reqId: result.reqId,
                    retryAfterSeconds: parseRetryAfterSeconds(retryAfter),
                },
                { status: result.status },
            );
            if (retryAfter) {
                response.headers.set("Retry-After", retryAfter);
            }
            return response;
        },
        { csrf: true, methods: ["POST"] },
    );
}
