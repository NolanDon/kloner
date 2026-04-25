import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { assertAppBuilderScope } from "../../_lib/appBuilderScope";
import { callBackend } from "@/src/lib/callBackend";
import { captureAuditEvent } from "@/lib/observability";

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

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
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

            const chunks = Array.isArray((result.json as any)?.chunks) ? (result.json as any).chunks : [];
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

            return NextResponse.json(result.json, { status: result.status });
        },
        { csrf: true, methods: ["POST"] },
    );
}
