import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { assertAppBuilderScope } from "../../_lib/appBuilderScope";
import { Resend } from "resend";
import { callBackend } from "@/src/lib/callBackend";
import { captureAuditEvent, captureCriticalEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDIT_PLAN_TIMEOUT_MS = 45_000;
const EDIT_PLAN_WORKER_READY_WAIT_MS = 15_000;
const EDIT_PLAN_WORKER_FLY_APP = "edit-plan-worker";
const EDIT_PLAN_WORKER_FLY_MACHINE_ID = "78124d2f950248";
const NEEDS_MORE_CONTEXT_EMAIL_TO =
    (process.env.EMBEDDINGS_NEEDS_MORE_CONTEXT_TO || process.env.SUPPORT_TO || "support@kloner.app").trim();

function getFlyApiToken(): string {
    const raw = (process.env.FLY_API_TOKEN || process.env.FLY_API_KEY || process.env.FLY_TOKEN || "").trim();
    if (!raw) return "";

    // FlyV1 tokens include a comma-separated discharge token.
    // Avoid splitting on commas so we do not truncate the token.
    if (raw.startsWith("FlyV1 ")) return raw;

    const parts = raw
        .split(/[\n\r,]+/)
        .map((part) => String(part || "").trim())
        .filter(Boolean);
    if (!parts.length) return "";

    return parts.find((part) => /^fm\d_/.test(part)) || parts.find((part) => /^fo\d_/.test(part)) || parts[0];
}

function getEditPlanWorkerTarget(): { app: string; machineId: string } {
    return {
        app: EDIT_PLAN_WORKER_FLY_APP,
        machineId: EDIT_PLAN_WORKER_FLY_MACHINE_ID,
    };
}

async function fetchFlyMachineState(app: string, machineId: string): Promise<{ ok: true; state: string | null } | { ok: false; status: number; error: string }> {
    const token = getFlyApiToken();
    if (!token) {
        return { ok: false, status: 500, error: "FLY_API_TOKEN not set" };
    }

    const res = await fetch(
        `https://api.machines.dev/v1/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(machineId)}`,
        {
            method: "GET",
            headers: {
                accept: "application/json",
                authorization: `Bearer ${token}`,
            },
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        },
    );

    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) {
        const msg = String((json as any)?.error || (json as any)?.message || `Fly error (HTTP ${res.status})`);
        return { ok: false, status: res.status, error: msg };
    }

    return {
        ok: true,
        state: typeof (json as any)?.state === "string" ? String((json as any).state) : null,
    };
}

async function startFlyMachine(app: string, machineId: string): Promise<{ ok: true; state: string | null } | { ok: false; status: number; error: string }> {
    const token = getFlyApiToken();
    if (!token) {
        return { ok: false, status: 500, error: "FLY_API_TOKEN not set" };
    }

    const res = await fetch(
        `https://api.machines.dev/v1/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(machineId)}/start`,
        {
            method: "POST",
            headers: {
                accept: "application/json",
                authorization: `Bearer ${token}`,
            },
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        },
    );

    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) {
        const msg = String((json as any)?.error || (json as any)?.message || `Fly error (HTTP ${res.status})`);
        return { ok: false, status: res.status, error: msg };
    }

    return {
        ok: true,
        state: typeof (json as any)?.state === "string" ? String((json as any).state) : null,
    };
}

async function waitForFlyMachineReady(app: string, machineId: string, timeoutMs = EDIT_PLAN_WORKER_READY_WAIT_MS): Promise<{ ok: true; state: string | null } | { ok: false; status: number; error: string }> {
    const startedAt = Date.now();
    let lastState: string | null = null;

    while (Date.now() - startedAt < timeoutMs) {
        const stateRes = await fetchFlyMachineState(app, machineId);
        if (!stateRes.ok) return stateRes;

        lastState = stateRes.state;
        const normalized = String(lastState || "").toLowerCase();
        if (!normalized || normalized === "started" || normalized === "running" || normalized === "healthy") {
            return { ok: true, state: lastState };
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return { ok: true, state: lastState };
}

async function ensureEditPlanWorkerRunning(uid: string, requestId: string | null) {
    const target = getEditPlanWorkerTarget();
    if (!target) {
        return { ok: true as const, skipped: true as const };
    }

    const stateRes = await fetchFlyMachineState(target.app, target.machineId);
    if (!stateRes.ok) {
        void captureCriticalEvent({
            source: "internal",
            severity: "error",
            alwaysNotifySlack: true,
            statusCode: stateRes.status,
            route: "/api/app-embeddings/edit-plan",
            method: "POST",
            action: "edit_plan_worker_status_failed",
            userId: uid,
            requestId: requestId || undefined,
            message: `Failed to read edit-plan worker machine state: ${stateRes.error}`,
            errorName: "EDIT_PLAN_WORKER_STATUS_FAILED",
            service: "app-embeddings",
            extra: {
                app: target.app,
                machineId: target.machineId,
            },
        }).catch(() => null);
        return { ok: false as const, status: 503, error: "Unable to read edit-plan worker state." };
    }

    const normalized = String(stateRes.state || "").toLowerCase();
    const isReady = !normalized || normalized === "started" || normalized === "running" || normalized === "healthy";
    if (isReady) {
        return { ok: true as const, skipped: false as const, state: stateRes.state };
    }

    if (normalized !== "stopped" && normalized !== "stopping" && normalized !== "failed" && normalized !== "destroyed" && normalized !== "dead") {
        return { ok: true as const, skipped: false as const, state: stateRes.state };
    }

    const startRes = await startFlyMachine(target.app, target.machineId);
    if (!startRes.ok) {
        void captureCriticalEvent({
            source: "internal",
            severity: "critical",
            alwaysNotifySlack: true,
            statusCode: startRes.status,
            route: "/api/app-embeddings/edit-plan",
            method: "POST",
            action: "edit_plan_worker_start_failed",
            userId: uid,
            requestId: requestId || undefined,
            message: `Failed to start edit-plan worker machine: ${startRes.error}`,
            errorName: "EDIT_PLAN_WORKER_START_FAILED",
            service: "app-embeddings",
            extra: {
                app: target.app,
                machineId: target.machineId,
                state: stateRes.state,
            },
        }).catch(() => null);
        return { ok: false as const, status: 503, error: "Edit-plan worker is offline and could not be started." };
    }

    const readyRes = await waitForFlyMachineReady(target.app, target.machineId);
    if (!readyRes.ok) return readyRes;

    return { ok: true as const, skipped: false as const, state: readyRes.state };
}

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

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

function toSafeArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function toBoolean(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
}

function buildNeedsMoreContextSnapshot(params: {
    uid: string;
    appId: string;
    query: string;
    currentPath: string | null;
    selectedFiles: string[];
    maxChunks: number;
    framework: string | null;
    frameworkLabel: string | null;
    frameworkConfidence: string | null;
    frameworkReason: string | null;
    requestId: string | null;
    resultReqId: string | null;
    payload: Record<string, unknown>;
    search: unknown[];
}) {
    const { payload } = params;
    const payloadJob = payload.job && typeof payload.job === "object" ? (payload.job as Record<string, unknown>) : null;
    const payloadResult = payload.result && typeof payload.result === "object" ? (payload.result as Record<string, unknown>) : null;
    const nestedResult = payloadJob?.result && typeof payloadJob.result === "object" ? (payloadJob.result as Record<string, unknown>) : null;

    const resolvedResult = payloadResult || nestedResult || null;
    const resolvedProposal = resolvedResult?.proposal && typeof resolvedResult.proposal === "object"
        ? (resolvedResult.proposal as Record<string, unknown>)
        : null;

    const needsMoreContext =
        toBoolean(resolvedProposal?.needsMoreContext) ??
        toBoolean(resolvedResult?.needsMoreContext) ??
        toBoolean(payload.needsMoreContext) ??
        false;

    const files = toSafeArray<Record<string, unknown>>(resolvedProposal?.files ?? payload.files);
    const summary = asString((resolvedProposal?.summary ?? resolvedResult?.summary ?? payload.summary) as unknown, 10_000) || null;
    const model = asString((resolvedProposal?.model ?? resolvedResult?.model ?? payload.model) as unknown, 120) || null;
    const status = asString((payload.status ?? payloadJob?.status) as unknown, 80) || null;
    const stage = asString((payload.stage ?? payloadJob?.stage) as unknown, 120) || null;
    const statusUrl = asString((payload.statusUrl ?? payloadJob?.statusUrl) as unknown, 2_000) || null;
    const jobId = asString((payload.jobId ?? payloadJob?.jobId) as unknown, 200) || null;
    const requestId = asString((payload.requestId ?? payloadJob?.requestId ?? params.resultReqId ?? params.requestId) as unknown, 200) || null;

    const compactSearchChunks = params.search
        .slice(0, 20)
        .map((chunk: any) => ({
            path: asString(chunk?.path, 500) || null,
            lineRange: chunk?.lineRange && typeof chunk.lineRange === "object"
                ? {
                    start: Number((chunk.lineRange as any).start ?? 0) || 0,
                    end: Number((chunk.lineRange as any).end ?? 0) || 0,
                }
                : null,
            similarity: typeof chunk?.similarity === "number" ? chunk.similarity : null,
            filePriority: typeof chunk?.filePriority === "number" ? chunk.filePriority : null,
            tokenCount: typeof chunk?.tokenCount === "number" ? chunk.tokenCount : null,
            chunkTextPreview: asString(chunk?.chunkText, 300) || null,
        }));

    const questions = toSafeArray<string>(resolvedResult?.questions ?? resolvedProposal?.questions ?? payload.questions)
        .map((q) => asString(q, 500))
        .filter(Boolean)
        .slice(0, 8);

    const copyPastePayload = {
        type: "app_embeddings_needs_more_context",
        createdAt: new Date().toISOString(),
        uid: params.uid,
        appId: params.appId,
        request: {
            query: params.query,
            currentPath: params.currentPath,
            selectedFiles: params.selectedFiles,
            maxChunks: params.maxChunks,
            framework: params.framework,
            frameworkLabel: params.frameworkLabel,
            frameworkConfidence: params.frameworkConfidence,
            frameworkReason: params.frameworkReason,
            requestId: params.requestId,
        },
        searchContext: {
            chunkCount: params.search.length,
            chunks: compactSearchChunks,
        },
        editPlan: {
            status,
            stage,
            statusUrl,
            requestId,
            jobId,
            model,
            needsMoreContext,
            needsRebuild: toBoolean(resolvedProposal?.needsRebuild ?? resolvedResult?.needsRebuild ?? payload.needsRebuild),
            fileCount: typeof resolvedProposal?.fileCount === "number" ? resolvedProposal.fileCount : files.length,
            estimatedLinesAdded: typeof resolvedProposal?.totalEstimatedLinesAdded === "number" ? resolvedProposal.totalEstimatedLinesAdded : null,
            estimatedLinesRemoved: typeof resolvedProposal?.totalEstimatedLinesRemoved === "number" ? resolvedProposal.totalEstimatedLinesRemoved : null,
            summary,
            questions,
        },
    };

    const copyPasteText = JSON.stringify(copyPastePayload, null, 2);

    return {
        needsMoreContext,
        copyPastePayload,
        copyPasteText,
    };
}

async function emailNeedsMoreContextCase(params: {
    uid: string;
    appId: string;
    query: string;
    currentPath: string | null;
    selectedFiles: string[];
    maxChunks: number;
    framework: string | null;
    frameworkLabel: string | null;
    frameworkConfidence: string | null;
    frameworkReason: string | null;
    requestId: string | null;
    resultReqId: string | null;
    payload: Record<string, unknown>;
    search: unknown[];
}) {
    const snapshot = buildNeedsMoreContextSnapshot(params);
    if (!snapshot.needsMoreContext) return;

    try {
        const resend = getResend();
        const from = (process.env.ALERT_EMAIL_FROM || "support@kloner.app").trim();
        const requestId = params.requestId || params.resultReqId || "unknown";

        const subject = `Kloner · Needs more context (${params.appId}) · ${requestId}`;
        const text = [
            "Embedding edit-plan returned needsMoreContext=true.",
            `UID: ${params.uid}`,
            `App ID: ${params.appId}`,
            `Request ID: ${params.requestId || "-"}`,
            `Backend Request ID: ${params.resultReqId || "-"}`,
            "",
            "Copy/paste payload:",
            snapshot.copyPasteText,
        ].join("\n");

        await resend.emails.send({
            from,
            to: NEEDS_MORE_CONTEXT_EMAIL_TO,
            subject,
            text,
        });
    } catch (error) {
        console.warn("[app-embeddings][edit-plan] failed to email needs-more-context snapshot", {
            appId: params.appId,
            uid: params.uid,
            requestId: params.requestId,
            error,
        });
    }
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const requestId = authedReq.headers.get("x-request-id") || authedReq.headers.get("x-client-request-id") || null;
            const body = await authedReq.json().catch(() => ({} as any));
            const appId = asString(body?.appId, 200);
            const query = asString(body?.query ?? body?.requestText, 10_000);
            const currentPath = asString(body?.currentPath, 500) || null;
            const selectedFiles = Array.isArray(body?.selectedFiles)
                ? body.selectedFiles.map((path: unknown) => asString(path, 500)).filter(Boolean).slice(0, 3)
                : [];
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

            const workerReady = await ensureEditPlanWorkerRunning(uid, requestId);
            if (!workerReady.ok) {
                const response = NextResponse.json(
                    {
                        ok: false,
                        error: workerReady.error,
                        code: "EDIT_PLAN_WORKER_OFFLINE",
                    },
                    { status: workerReady.status },
                );
                response.headers.set("x-observability-skip-status-alert", "1");
                return response;
            }

            const result = await callBackend(authedReq, {
                path: "/app-embeddings/edit-plan",
                method: "POST",
                timeoutMs: EDIT_PLAN_TIMEOUT_MS,
                userCtx: { uid },
                body: {
                    appId,
                    query,
                    requestText: query,
                    ...(currentPath ? { currentPath } : {}),
                    ...(selectedFiles.length ? { selectedFiles } : {}),
                    maxChunks,
                    ...(search ? { search } : {}),
                    ...(framework ? { framework } : {}),
                    ...(frameworkLabel ? { frameworkLabel } : {}),
                    ...(frameworkConfidence ? { frameworkConfidence } : {}),
                    ...(frameworkReason ? { frameworkReason } : {}),
                },
            });

            if (result.status === 504 && String((result.json as any)?.error || "").toLowerCase() === "backend timeout") {
                void captureCriticalEvent({
                    source: "internal",
                    severity: "critical",
                    alwaysNotifySlack: true,
                    statusCode: 504,
                    route: "/api/app-embeddings/edit-plan",
                    method: "POST",
                    action: "app_embeddings_edit_plan_timeout",
                    userId: uid,
                    message: `Edit-plan request timed out after ${Math.round(EDIT_PLAN_TIMEOUT_MS / 1000)}s`,
                    service: "app-embeddings",
                    tags: ["app-embeddings", "edit-plan", "timeout", "oom-suspected"],
                    extra: {
                        appId,
                        currentPath,
                        selectedFiles,
                        maxChunks,
                        timeoutMs: EDIT_PLAN_TIMEOUT_MS,
                        requestId: result.reqId || requestId || undefined,
                        backendStatus: result.status,
                        backendError: (result.json as any)?.error || null,
                        queryPreview: query.slice(0, 500),
                    },
                });
            }

            const payload = result.json as any;

            await emailNeedsMoreContextCase({
                uid,
                appId,
                query,
                currentPath,
                selectedFiles,
                maxChunks,
                framework,
                frameworkLabel,
                frameworkConfidence,
                frameworkReason,
                requestId,
                resultReqId: result.reqId || null,
                payload: (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>,
                search: Array.isArray(search) ? search : [],
            });

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
                        selectedFiles,
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
