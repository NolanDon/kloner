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
            const body = await authedReq.json().catch(() => ({} as any));
            const appId = asString(body?.appId, 200);
            const query = asString(body?.query ?? body?.requestText, 10_000);
            const currentPath = asString(body?.currentPath, 500) || null;
            const maxChunks = toMaxChunks(body?.maxChunks);
            const search = Array.isArray(body?.search) ? body.search : undefined;
            const framework = asString(body?.framework, 80) || null;
            const frameworkLabel = asString(body?.frameworkLabel, 120) || null;
            const frameworkConfidence = asString(body?.frameworkConfidence, 20) || null;
            const frameworkReason = asString(body?.frameworkReason, 500) || null;

            if (!appId || !query) {
                return NextResponse.json({ error: "Missing appId or query" }, { status: 400 });
            }

            assertAppBuilderScope(authedReq, uid, appId);

            const result = await callBackend(authedReq, {
                path: "/app-embeddings/edit-plan",
                method: "POST",
                timeoutMs: 45_000,
                userCtx: { uid },
                body: {
                    appId,
                    query,
                    requestText: query,
                    ...(currentPath ? { currentPath } : {}),
                    maxChunks,
                    ...(search ? { search } : {}),
                    ...(framework ? { framework } : {}),
                    ...(frameworkLabel ? { frameworkLabel } : {}),
                    ...(frameworkConfidence ? { frameworkConfidence } : {}),
                    ...(frameworkReason ? { frameworkReason } : {}),
                },
            });

            const payload = result.json as any;
            const files = Array.isArray(payload?.files) ? payload.files : [];
            const dbMigrations = Array.isArray(payload?.dbMigrations) ? payload.dbMigrations : [];
            if (files.length === 0 && dbMigrations.length === 0) {
                void captureAuditEvent({
                    source: "internal",
                    severity: "info",
                    route: "/api/app-embeddings/edit-plan",
                    method: "POST",
                    action: "app_embeddings_edit_plan_no_changes",
                    userId: uid,
                    message: "Embedding edit plan returned no actionable changes",
                    service: "app-embeddings",
                    tags: ["app-embeddings", "edit-plan", "no-changes"],
                    extra: {
                        appId,
                        currentPath,
                        query,
                        maxChunks,
                        searchChunkCount: Array.isArray(payload?.search) ? payload.search.length : Array.isArray(search) ? search.length : 0,
                        summary: typeof payload?.summary === "string" ? payload.summary.slice(0, 300) : null,
                        notes: Array.isArray(payload?.notes) ? payload.notes.slice(0, 5) : [],
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
