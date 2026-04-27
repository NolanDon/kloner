export type AppEmbeddingSearchRequest = {
    appId: string;
    query: string;
    currentPath?: string | null;
    maxChunks?: number;
    requestText?: string;
    framework?: string | null;
    frameworkLabel?: string | null;
    frameworkConfidence?: string | null;
    frameworkReason?: string | null;
};

export type AppEmbeddingSearchChunk = {
    path: string;
    chunkIndex: number;
    lineRange: { start: number; end: number };
    sourceHash: string;
    embeddingModel: string;
    embeddingModelVersion: string | null;
    updatedAt: string | number | null;
    tokenCount: number;
    similarity: number;
    filePriority: number;
    chunkText: string;
};

export type AppEmbeddingSearchResponse = {
    chunks: AppEmbeddingSearchChunk[];
    refreshQueued?: boolean;
};

export type AppEmbeddingEditPlanTarget = {
    chunkId?: string | null;
    chunkHash?: string | null;
    fileHash?: string | null;
    lineStart?: number | null;
    lineEnd?: number | null;
    anchorText?: string | null;
    beforeText?: string | null;
    afterText?: string | null;
};

export type AppEmbeddingEditPlanOp = {
    path: string;
    op: "replace" | "insert_before" | "insert_after" | "delete" | (string & {});
    target?: AppEmbeddingEditPlanTarget | null;
    content?: string | null;
    encoding?: "utf8" | "base64" | (string & {}) | null;
    baseFileHash?: string | null;
    reason?: string | null;
    [key: string]: unknown;
};

export type AppEmbeddingEditPlanResponse = {
    formatVersion: string | null;
    summary: string;
    needsRebuild: boolean;
    ops: AppEmbeddingEditPlanOp[];
    notes: string[];
    search: AppEmbeddingSearchChunk[];
    response?: string;
    refreshServer?: boolean;
    setupDatabase?: boolean;
    dbMigrations?: Array<{ sql?: string; message?: string; destructive?: boolean }>;
    needsMoreContext?: boolean;
    questions?: string[];
    clarifyingQuestions?: string[];
    requestId?: string | null;
    code?: string | null;
    error?: string | null;
    queued?: boolean;
    jobId?: string | null;
    statusUrl?: string | null;
    status?: "queued" | "picked_up" | "working" | "completed" | "failed" | "expired" | string | null;
    stage?: string | null;
    progress?: number | null;
    queueAgeSeconds?: number | null;
    queuedForSeconds?: number | null;
    runningForSeconds?: number | null;
    leaseRemainingSeconds?: number | null;
    workerId?: string | null;
    attemptCount?: number | null;
    job?: AppEmbeddingEditPlanJobStatus | null;
    result?: AppEmbeddingEditPlanPlan | null;
    [key: string]: unknown;
};

export type AppEmbeddingEditPlanPlan = {
    formatVersion: string | null;
    summary: string;
    needsRebuild: boolean;
    ops: AppEmbeddingEditPlanOp[];
    notes: string[];
    search: AppEmbeddingSearchChunk[];
    response?: string;
    refreshServer?: boolean;
    setupDatabase?: boolean;
    dbMigrations?: Array<{ sql?: string; message?: string; destructive?: boolean }>;
    needsMoreContext?: boolean;
    questions?: string[];
    clarifyingQuestions?: string[];
    requestId?: string | null;
    code?: string | null;
    error?: string | null;
    [key: string]: unknown;
};

export type AppEmbeddingEditPlanJobStatus = {
    status: "queued" | "picked_up" | "working" | "completed" | "failed" | "expired" | string;
    stage?: string | null;
    progress?: number | null;
    queueAgeSeconds?: number | null;
    queuedForSeconds?: number | null;
    runningForSeconds?: number | null;
    leaseRemainingSeconds?: number | null;
    workerId?: string | null;
    attemptCount?: number | null;
    requestId?: string | null;
    jobId?: string | null;
    statusUrl?: string | null;
    error?: string | { code?: string; message?: string; retryAfterSeconds?: number | null; [key: string]: unknown } | null;
    result?: AppEmbeddingEditPlanPlan | null;
    queued?: boolean;
    job?: AppEmbeddingEditPlanJobStatus | null;
    [key: string]: unknown;
};

export type AppEmbeddingRequestResult<T> = {
    ok: boolean;
    status: number;
    data: T | null;
    error: string | null;
    retryAfter: string | null;
    code: string | null;
    requestId?: string | null;
};

const EMBEDDING_REQUEST_TIMEOUT_MS = 42_000;

function getTextEncoderByteLength(text: string): number {
    if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(text).length;
    }

    return text.length;
}

function summarizeEmbeddingResponseShape(value: unknown): {
    ok: boolean | null;
    code: string | null;
    statusCode: number | null;
    returned: number | null;
    candidates: number | null;
    refreshQueued: boolean;
    chunks: number | null;
} {
    const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const returned = typeof raw.returned === "number" ? raw.returned : Number.isFinite(Number(raw.returned)) ? Number(raw.returned) : null;
    const candidates = Array.isArray(raw.candidates) ? raw.candidates.length : Number.isFinite(Number(raw.candidates)) ? Number(raw.candidates) : null;
    const chunks = Array.isArray(raw.chunks) ? raw.chunks.length : null;

    return {
        ok: typeof raw.ok === "boolean" ? raw.ok : null,
        code: asString(raw.code, 120) || null,
        statusCode: typeof raw.statusCode === "number" ? raw.statusCode : typeof raw.status === "number" ? raw.status : null,
        returned,
        candidates,
        refreshQueued: asBoolean(raw.refreshQueued ?? raw.refresh_queued),
        chunks,
    };
}

function logEmbeddingTransport(stage: string, details: Record<string, unknown>) {
    if (process.env.NODE_ENV === "test") return;
    const logger = stage === "timeout" || stage === "abort" || stage === "error" ? console.warn : console.info;
    logger.call(console, "[app-embeddings][transport]", stage, details);
}

function asString(value: unknown, max = 10_000): string {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    return text.length <= max ? text : text.slice(0, max);
}

function asNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown): boolean {
    return value === true || value === "true";
}

function normalizeLineRange(value: unknown): { start: number; end: number } {
    if (!value || typeof value !== "object") {
        return { start: 1, end: 1 };
    }

    const raw = value as Record<string, unknown>;
    const start = asNumber(raw.start ?? raw.from ?? raw.begin ?? raw.lineStart, 1);
    const end = asNumber(raw.end ?? raw.to ?? raw.finish ?? raw.lineEnd, start);
    return {
        start: Math.max(1, Math.floor(start)),
        end: Math.max(1, Math.floor(end)),
    };
}

function asNullableNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeEmbeddingSearchChunk(raw: unknown): AppEmbeddingSearchChunk | null {
    if (!raw || typeof raw !== "object") return null;
    const chunk = raw as Record<string, unknown>;
    const path = asString(chunk.path, 500);
    const chunkText = asString(chunk.chunkText ?? chunk.text ?? chunk.excerpt, 30_000);
    if (!path || !chunkText) return null;

    const lineRange = normalizeLineRange(chunk.lineRange ?? {
        start: chunk.startLine,
        end: chunk.endLine,
    });

    return {
        path,
        chunkIndex: Math.max(0, Math.floor(asNumber(chunk.chunkIndex ?? chunk.chunk_index, 0))),
        lineRange,
        sourceHash: asString(chunk.sourceHash ?? chunk.source_hash ?? "", 200),
        embeddingModel: asString(chunk.embeddingModel ?? chunk.embedding_model ?? "", 200),
        embeddingModelVersion: asString(chunk.embeddingModelVersion ?? chunk.embedding_model_version ?? "", 200) || null,
        updatedAt: (chunk.updatedAt ?? chunk.updated_at ?? null) as string | number | null,
        tokenCount: Math.max(0, Math.floor(asNumber(chunk.tokenCount ?? chunk.token_count, 0))),
        similarity: asNumber(chunk.similarity, 0),
        filePriority: Math.max(0, Math.floor(asNumber(chunk.filePriority ?? chunk.file_priority, 0))),
        chunkText,
    };
}

export function normalizeEmbeddingSearchResponse(raw: unknown): AppEmbeddingSearchResponse {
    const chunks = Array.isArray((raw as any)?.chunks)
        ? (raw as any).chunks.map(normalizeEmbeddingSearchChunk).filter(Boolean)
        : [];

    return {
        chunks: chunks as AppEmbeddingSearchChunk[],
        refreshQueued: asBoolean((raw as any)?.refreshQueued ?? (raw as any)?.refresh_queued),
    };
}

export function getEmbeddingSearchErrorMessage(status: number, code: string | null | undefined, error: string | null | undefined): string {
    const normalizedCode = typeof code === "string" ? code.trim() : "";
    const normalizedError = typeof error === "string" ? error.trim() : "";

    if (status === 409 || normalizedCode === "EMBEDDING_INDEX_STALE") {
        return normalizedError || "The file search is refreshing right now. Please try again in a moment.";
    }

    if (status === 503 || normalizedCode === "EMBEDDING_MEMORY_PRESSURE") {
        return normalizedError || "The file search is busy right now. Please try again in a moment.";
    }

    if (status === 504 || normalizedCode === "EMBEDDING_SEARCH_TIMEOUT") {
        return normalizedError || "The file search took too long. Please try again in a moment.";
    }

    if (status === 0) {
        return normalizedError || "The service could not be reached. Check your connection and try again.";
    }

    if (status === 429) {
        return normalizedError || "Requests are temporarily limited. Please wait a moment and try again.";
    }

    return normalizedError || "Couldn’t get results right now.";
}

export function getEmbeddingSearchRefreshQueuedNotice(result: AppEmbeddingSearchResponse | null | undefined): string | null {
    if (!result?.refreshQueued) return null;
    return "The file search is still updating in the background. I used the matches that are ready so you can keep going.";
}

export async function withLoadingState<T>(setLoading: (value: boolean) => void, task: () => Promise<T>): Promise<T> {
    setLoading(true);
    try {
        return await task();
    } finally {
        setLoading(false);
    }
}

export function normalizeEmbeddingEditPlanFile(raw: unknown): AppEmbeddingEditPlanOp | null {
    if (!raw || typeof raw !== "object") return null;
    const op = raw as Record<string, unknown>;
    const path = asString(op.path, 500);
    if (!path) return null;

    const target = op.target && typeof op.target === "object"
        ? {
            chunkId: asString((op.target as Record<string, unknown>).chunkId, 200) || null,
            chunkHash: asString((op.target as Record<string, unknown>).chunkHash, 200) || null,
            fileHash: asString((op.target as Record<string, unknown>).fileHash, 200) || null,
            lineStart: Number.isFinite(Number((op.target as Record<string, unknown>).lineStart)) ? Math.floor(Number((op.target as Record<string, unknown>).lineStart)) : null,
            lineEnd: Number.isFinite(Number((op.target as Record<string, unknown>).lineEnd)) ? Math.floor(Number((op.target as Record<string, unknown>).lineEnd)) : null,
            anchorText: asString((op.target as Record<string, unknown>).anchorText, 4000) || null,
            beforeText: asString((op.target as Record<string, unknown>).beforeText, 4000) || null,
            afterText: asString((op.target as Record<string, unknown>).afterText, 4000) || null,
        }
        : null;

    return {
        path,
        op: asString(op.op, 80) || "replace",
        target,
        content: typeof op.content === "string" ? op.content : null,
        encoding: asString(op.encoding, 20) || null,
        baseFileHash: asString(op.baseFileHash, 200) || null,
        reason: asString(op.reason, 2000) || null,
    };
}

export function normalizeEmbeddingEditPlanPlan(raw: unknown): AppEmbeddingEditPlanPlan {
    const normalizedSearch = normalizeEmbeddingSearchResponse((raw as any)?.search);
    const ops = Array.isArray((raw as any)?.ops)
        ? (raw as any).ops.map(normalizeEmbeddingEditPlanFile).filter(Boolean)
        : [];
    const notes = Array.isArray((raw as any)?.notes)
        ? (raw as any).notes.map((note: unknown) => asString(note, 4000)).filter(Boolean)
        : [];

    return {
        formatVersion: asString((raw as any)?.formatVersion ?? (raw as any)?.format_version ?? "", 80) || null,
        summary: asString((raw as any)?.summary ?? (raw as any)?.response ?? "", 20_000),
        needsRebuild: Boolean((raw as any)?.needsRebuild ?? (raw as any)?.needs_rebuild ?? (raw as any)?.refreshServer),
        ops: ops as AppEmbeddingEditPlanOp[],
        notes,
        search: normalizedSearch.chunks,
        response: typeof (raw as any)?.response === "string" ? (raw as any).response : undefined,
        refreshServer: typeof (raw as any)?.refreshServer === "boolean" ? (raw as any).refreshServer : undefined,
        setupDatabase: typeof (raw as any)?.setupDatabase === "boolean" ? (raw as any).setupDatabase : undefined,
        dbMigrations: Array.isArray((raw as any)?.dbMigrations) ? (raw as any).dbMigrations : undefined,
        needsMoreContext: typeof (raw as any)?.needsMoreContext === "boolean" ? (raw as any).needsMoreContext : undefined,
        questions: Array.isArray((raw as any)?.questions) ? (raw as any).questions : undefined,
        clarifyingQuestions: Array.isArray((raw as any)?.clarifyingQuestions) ? (raw as any).clarifyingQuestions : undefined,
        requestId: typeof (raw as any)?.requestId === "string" ? (raw as any).requestId : null,
        code: typeof (raw as any)?.code === "string" ? (raw as any).code : null,
        error: typeof (raw as any)?.error === "string" ? (raw as any).error : null,
    };
}

export function normalizeEmbeddingEditPlanJobStatus(raw: unknown): AppEmbeddingEditPlanJobStatus {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const nestedJob = source.job && typeof source.job === "object" ? (source.job as Record<string, unknown>) : null;
    const active = nestedJob || source;
    const result = active.result && typeof active.result === "object"
        ? normalizeEmbeddingEditPlanPlan(active.result)
        : source.result && typeof source.result === "object"
            ? normalizeEmbeddingEditPlanPlan(source.result)
            : null;

    return {
        ...source,
        status: asString(active.status, 80) || "queued",
        stage: asString(active.stage, 120) || null,
        progress: asNullableNumber(active.progress),
        queueAgeSeconds: asNullableNumber(active.queueAgeSeconds ?? active.queue_age_seconds),
        queuedForSeconds: asNullableNumber(active.queuedForSeconds ?? active.queued_for_seconds),
        runningForSeconds: asNullableNumber(active.runningForSeconds ?? active.running_for_seconds),
        leaseRemainingSeconds: asNullableNumber(active.leaseRemainingSeconds ?? active.lease_remaining_seconds),
        workerId: asString(active.workerId, 200) || null,
        attemptCount: asNullableNumber(active.attemptCount ?? active.attempt_count),
        requestId: asString(active.requestId ?? source.requestId, 120) || null,
        jobId: asString(active.jobId ?? source.jobId, 120) || null,
        statusUrl: asString(active.statusUrl ?? source.statusUrl, 500) || null,
        error: typeof active.error === "string"
            ? active.error
            : active.error && typeof active.error === "object"
                ? {
                    ...active.error,
                    code: asString((active.error as any).code, 120) || undefined,
                    message: asString((active.error as any).message, 20_000) || undefined,
                    retryAfterSeconds: asNullableNumber((active.error as any).retryAfterSeconds ?? (active.error as any).retry_after_seconds),
                }
                : null,
        result,
        queued: asBoolean(active.queued ?? source.queued),
        job: nestedJob ? normalizeEmbeddingEditPlanJobStatus(nestedJob) : null,
    } as AppEmbeddingEditPlanJobStatus;
}

export function normalizeEmbeddingEditPlanResponse(raw: unknown): AppEmbeddingEditPlanResponse {
    const normalizedPlan = normalizeEmbeddingEditPlanPlan(raw);
    const normalizedJob = normalizeEmbeddingEditPlanJobStatus(raw);

    return {
        ...normalizedPlan,
        queued: asBoolean((raw as any)?.queued),
        jobId: asString((raw as any)?.jobId, 120) || null,
        statusUrl: asString((raw as any)?.statusUrl ?? (raw as any)?.status_url, 500) || null,
        status: asString((raw as any)?.status, 80) || null,
        stage: asString((raw as any)?.stage, 120) || null,
        progress: asNullableNumber((raw as any)?.progress),
        queueAgeSeconds: asNullableNumber((raw as any)?.queueAgeSeconds ?? (raw as any)?.queue_age_seconds),
        queuedForSeconds: asNullableNumber((raw as any)?.queuedForSeconds ?? (raw as any)?.queued_for_seconds),
        runningForSeconds: asNullableNumber((raw as any)?.runningForSeconds ?? (raw as any)?.running_for_seconds),
        leaseRemainingSeconds: asNullableNumber((raw as any)?.leaseRemainingSeconds ?? (raw as any)?.lease_remaining_seconds),
        workerId: asString((raw as any)?.workerId, 200) || null,
        attemptCount: asNullableNumber((raw as any)?.attemptCount ?? (raw as any)?.attempt_count),
        job: normalizedJob,
        result: (raw as any)?.result && typeof (raw as any).result === "object" ? normalizeEmbeddingEditPlanPlan((raw as any).result) : undefined,
    };
}

export async function fetchEmbeddingEditPlanJobStatus(
    statusUrl: string,
    headers: HeadersInit,
): Promise<AppEmbeddingRequestResult<AppEmbeddingEditPlanJobStatus>> {
    const response = await fetch(statusUrl, {
        method: "GET",
        headers,
        credentials: "include",
        cache: "no-store",
    });

    const data = await response.json().catch(() => null);
    return {
        ok: response.ok,
        status: response.status,
        data: data ? normalizeEmbeddingEditPlanJobStatus(data) : null,
        error: response.ok ? null : asString((data as any)?.error, 10_000) || response.statusText || "Request failed",
        retryAfter: response.headers.get("retry-after"),
        code: asString((data as any)?.code, 120) || null,
        requestId: asString((data as any)?.requestId, 120) || null,
    };
}

export async function applyEditPlanOps(
    request: { appId: string; ops: AppEmbeddingEditPlanOp[]; code?: string | null },
    headers: HeadersInit,
): Promise<AppEmbeddingRequestResult<unknown>> {
    const response = await fetch("/api/v1/webcontainer/apply", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...headers,
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
            appId: request.appId,
            ...(typeof request.code === "string" && request.code.trim() ? { code: request.code.trim() } : {}),
            ops: request.ops,
        }),
    });

    const data = await response.json().catch(() => null);
    return {
        ok: response.ok,
        status: response.status,
        data,
        error: response.ok ? null : asString((data as any)?.error, 10_000) || response.statusText || "Apply failed",
        retryAfter: response.headers.get("retry-after"),
        code: asString((data as any)?.code, 120) || null,
        requestId: asString((data as any)?.requestId, 120) || null,
    };
}

async function postJson<T>(path: string, body: unknown, headers: HeadersInit): Promise<AppEmbeddingRequestResult<T>> {
    const timeoutMs = EMBEDDING_REQUEST_TIMEOUT_MS;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const requestBodyText = JSON.stringify(body ?? {});
    const requestSizeBytes = getTextEncoderByteLength(requestBodyText);
    const startedAt = Date.now();

    logEmbeddingTransport("request_started", {
        path,
        requestSizeBytes,
        timeoutMs,
    });

    try {
        if (controller && timeoutMs > 0) {
            timeoutId = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
        }

        logEmbeddingTransport("request_sent", {
            path,
            requestSizeBytes,
            timeoutMs,
        });

        const response = await fetch(path, {
            method: "POST",
            headers,
            credentials: "include",
            cache: "no-store",
            body: requestBodyText,
            signal: controller?.signal,
        });

        const data = await response.json().catch(() => null);
        const retryAfter = response.headers.get("retry-after");
        const code = typeof (data as any)?.code === "string" ? (data as any).code : null;
        const elapsedMs = Date.now() - startedAt;

        logEmbeddingTransport("response_received", {
            path,
            elapsedMs,
            status: response.status,
            ok: response.ok,
            shape: summarizeEmbeddingResponseShape(data),
        });

        return {
            ok: response.ok,
            status: response.status,
            data: data as T | null,
            error: response.ok ? null : (typeof (data as any)?.error === "string" ? (data as any).error : "Request failed"),
            retryAfter,
            code,
            requestId: typeof (data as any)?.reqId === "string" ? (data as any).reqId : typeof (data as any)?.requestId === "string" ? (data as any).requestId : null,
        };
    } catch (err: any) {
        if (timedOut) {
            logEmbeddingTransport("timeout", {
                path,
                elapsedMs: Date.now() - startedAt,
                timeoutMs,
                requestSizeBytes,
            });
            return {
                ok: false,
                status: 504,
                data: null,
                error: `The embedding request timed out after ${Math.round(timeoutMs / 1000)} seconds. Please try again in a moment.`,
                retryAfter: null,
                code: "EMBEDDING_SEARCH_TIMEOUT",
                requestId: null,
            };
        }

        if (controller?.signal.aborted) {
            logEmbeddingTransport("abort", {
                path,
                elapsedMs: Date.now() - startedAt,
                requestSizeBytes,
            });
            return {
                ok: false,
                status: 0,
                data: null,
                error: String(err?.message || "The embedding request was aborted."),
                retryAfter: null,
                code: "REQUEST_ABORTED",
                requestId: null,
            };
        }

        logEmbeddingTransport("error", {
            path,
            elapsedMs: Date.now() - startedAt,
            requestSizeBytes,
            error: String(err?.message || err || "Request failed"),
        });

        return {
            ok: false,
            status: 0,
            data: null,
            error: String(err?.message || err || "Request failed"),
            retryAfter: null,
            code: null,
            requestId: null,
        };
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

export async function fetchEmbeddingSearch(
    request: AppEmbeddingSearchRequest,
    headers: HeadersInit,
): Promise<AppEmbeddingRequestResult<AppEmbeddingSearchResponse>> {
    const maxChunks = Math.min(10, Math.max(1, Math.floor(Number(request.maxChunks ?? 10) || 10)));
    return postJson<AppEmbeddingSearchResponse>(
        "/api/app-embeddings/search",
        {
            appId: request.appId,
            query: request.query,
            requestText: request.requestText ?? request.query,
            currentPath: request.currentPath || null,
            maxChunks,
            ...(request.framework ? { framework: request.framework } : {}),
            ...(request.frameworkLabel ? { frameworkLabel: request.frameworkLabel } : {}),
            ...(request.frameworkConfidence ? { frameworkConfidence: request.frameworkConfidence } : {}),
            ...(request.frameworkReason ? { frameworkReason: request.frameworkReason } : {}),
        },
        headers,
    );
}

export async function fetchEmbeddingEditPlan(
    request: AppEmbeddingSearchRequest & { search?: AppEmbeddingSearchChunk[] },
    headers: HeadersInit,
): Promise<AppEmbeddingRequestResult<AppEmbeddingEditPlanResponse>> {
    const maxChunks = Math.min(10, Math.max(1, Math.floor(Number(request.maxChunks ?? 10) || 10)));
    return postJson<AppEmbeddingEditPlanResponse>(
        "/api/app-embeddings/edit-plan",
        {
            appId: request.appId,
            query: request.query,
            requestText: request.requestText ?? request.query,
            currentPath: request.currentPath || null,
            maxChunks,
        },
        headers,
    );
}

export function applyEmbeddingEditPlanToFiles(
    currentFiles: { [path: string]: { content: string; lastModified: number } },
    ops: AppEmbeddingEditPlanOp[],
): { [path: string]: { content: string; lastModified: number } } {
    const nextFiles = { ...(currentFiles || {}) };
    const now = Date.now();

    for (const op of ops || []) {
        const path = asString(op?.path, 500);
        if (!path) continue;

        const action = asString(op?.op, 80).toLowerCase();
        if (action === "delete") {
            delete nextFiles[path];
            continue;
        }

        if (typeof op?.content === "string") {
            nextFiles[path] = { content: op.content, lastModified: now };
        }
    }

    return nextFiles;
}

export function editPlanHasDeleteOps(ops: AppEmbeddingEditPlanOp[]): boolean {
    return Array.isArray(ops) && ops.some((op) => asString(op?.op, 80).toLowerCase() === "delete");
}
