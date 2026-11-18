import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { assertAppBuilderScope } from "../../_lib/appBuilderScope";
import { callBackend } from "@/src/lib/callBackend";
import { normalizeAgentImages } from "@/src/lib/agentAttachments";
import { normalizeAgentLanguage } from "@/src/lib/agentLanguage";
import { captureAuditEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asString = (value: unknown, max = 10_000) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? text.slice(0, max) : "";
};

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authedReq }) => {
        const body = await authedReq.json().catch(() => ({} as Record<string, unknown>));
        const appId = asString(body.appId, 200);
        const query = asString(body.query ?? body.requestText, 10_000);
        if (!appId || !query) return NextResponse.json({ error: "Missing appId or query" }, { status: 400 });
        assertAppBuilderScope(authedReq, uid, appId);

        const result = await callBackend(authedReq, {
            path: "/app-embeddings/agent-v3",
            method: "POST",
            timeoutMs: 15_000,
            userCtx: { uid },
            body: {
                appId,
                query,
                requestText: query,
                responseLanguage: normalizeAgentLanguage(body.responseLanguage) || "en",
                currentPath: asString(body.currentPath, 500) || null,
                selectedFiles: Array.isArray(body.selectedFiles) ? body.selectedFiles.slice(0, 20) : [],
                attachments: normalizeAgentImages(body.attachments),
                paletteChangeId: asString(body.paletteChangeId, 80) || null,
                repairContext: body.repairContext && typeof body.repairContext === "object" ? body.repairContext : null,
                conversationHistory: Array.isArray(body.conversationHistory)
                    ? body.conversationHistory
                        .slice(-12)
                        .map((entry: unknown) => {
                            const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
                            return {
                                role: item.role === "assistant" ? "assistant" : "user",
                                content: asString(item.content, 2_400),
                            };
                        })
                        .filter((entry: { content: string }) => entry.content.length > 0)
                    : [],
            },
        });

        // The backend owns the agent and workspace implementation. Persist its
        // no-change diagnostics here so an unsuccessful agent turn can be
        // investigated even when the backend only emits a Slack alert.
        const backendPayload = result.json && typeof result.json === "object"
            ? result.json as Record<string, unknown>
            : {};
        const backendCode = asString(backendPayload.code, 160);
        if (result.status === 422 && backendCode === "WORKSPACE_AUTONOMY_V3_NO_CHANGES") {
            void captureAuditEvent({
                source: "internal",
                severity: "warning",
                statusCode: result.status,
                route: "/api/app-embeddings/agent-v3",
                method: "POST",
                action: "app_embeddings_agent_v3_no_changes",
                userId: uid,
                requestId: result.reqId || undefined,
                message: "Workspace autonomy agent returned no file changes for a requested mutation.",
                service: "app-embeddings-agent-v3-proxy",
                tags: ["app-embeddings", "agent-v3", "no-changes"],
                extra: {
                    appId,
                    currentPath: asString(body.currentPath, 500) || null,
                    backendCode,
                    backendMessage: asString(backendPayload.message, 1000) || null,
                    backendError: asString(backendPayload.error, 1000) || null,
                    backendRequestId: asString(backendPayload.requestId, 200) || result.reqId || null,
                    jobId: asString(backendPayload.jobId, 200) || null,
                    userRequest: query.slice(0, 1000),
                    // Include the backend's diagnostics as supplied, excluding
                    // any auth/session material (none is forwarded to Slack).
                    debug: backendPayload.debug && typeof backendPayload.debug === "object"
                        ? backendPayload.debug
                        : null,
                },
            });
        }
        return NextResponse.json(result.json, { status: result.status });
    });
}
