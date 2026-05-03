export type AppEmbeddingSearchRequest = {
    appId: string;
    query: string;
    currentPath?: string | null;
    debugCurrentPath?: {
        selectedFile: string | null;
        derivedCurrentPath: string | null;
        intentClassification: "ui" | "backend" | "unknown";
        reason: string;
    } | null;
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

export type AppEmbeddingEditPlanProposalFile = {
    path: string;
    op: string;
    delete?: boolean | null;
    content?: string | null;
    beforeLineCount?: number | null;
    afterLineCount?: number | null;
    estimatedLinesAdded?: number | null;
    estimatedLinesRemoved?: number | null;
    beforePreview?: string | null;
    afterPreview?: string | null;
    target?: AppEmbeddingEditPlanTarget | null;
    [key: string]: unknown;
};

export type AppEmbeddingEditPlanProposal = {
    autoApplyAllowed?: boolean;
    files: AppEmbeddingEditPlanProposalFile[];
    fileCount?: number | null;
    totalEstimatedLinesAdded?: number | null;
    totalEstimatedLinesRemoved?: number | null;
    summary?: string | null;
    model?: string | null;
    needsRebuild?: boolean | null;
    needsMoreContext?: boolean | null;
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
    retryAfterSeconds?: number | null;
    reason?: string | null;
    queueMetrics?: Record<string, unknown> | null;
    thresholds?: Record<string, unknown> | null;
    [key: string]: unknown;
};

export type AppEmbeddingJobApplyResult = {
    ok: boolean;
    patchedFileCount?: number | null;
    wrote?: number | null;
    deleted?: number | null;
    requiresRestart?: boolean | null;
    requiresRebuild?: boolean | null;
    hmrLikely?: boolean | null;
    machineStatus?: string | null;
    machineError?: string | null;
    patchErrors?: Array<{ path?: string | null; op?: string | null; code?: string | null; message?: string | null; [key: string]: unknown }> | null;
    restorePoint?: {
        restorePointId?: string | null;
        fileCount?: number | null;
        touchedPaths?: string[] | null;
        skippedPaths?: string[] | null;
        restorable?: boolean | null;
        [key: string]: unknown;
    } | null;
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
    proposal?: AppEmbeddingEditPlanProposal | null;
    apply?: AppEmbeddingJobApplyResult | null;
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

export type AppPreviewApplyOutcome = "saved" | "restart_pending" | "failed" | "timeout" | (string & {});

export type AppPreviewApplyResponse = {
    ok: boolean;
    outcome?: AppPreviewApplyOutcome | null;
    saved?: boolean | null;
    replayed?: boolean | null;
    contradictoryStatus?: boolean | null;
    restartPending?: boolean | null;
    restartConfirmed?: boolean | null;
    retryable?: boolean | null;
    retryAfterSeconds?: number | null;
    phase?: string | null;
    step?: string | null;
    requestId?: string | null;
    idempotencyKey?: string | null;
    machineId?: string | null;
    code?: string | null;
    resolvedFrom?: string | null;
    needsRebuild?: boolean | null;
    requiresRestart?: boolean | null;
    requiresRebuild?: boolean | null;
    hmrLikely?: boolean | null;
    touchesPublicAssets?: boolean | null;
    queued?: boolean | null;
    restartStatus?: string | null;
    restartMessage?: string | null;
    restartWorkflow?: { queued?: boolean | null; restartJobId?: string | null; [key: string]: unknown } | null;
    machine?: { wrote?: number | null; deleted?: number | null; [key: string]: unknown } | null;
    expectedWrites?: number | null;
    expectedDeletes?: number | null;
    expectedOps?: number | null;
    error?: string | { code?: string; message?: string; retryAfterSeconds?: number | null; [key: string]: unknown } | null;
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

export type AppEmbeddingEditPlanBackpressureInfo = {
    retryAfterSeconds: number | null;
    requestId: string | null;
    reason: string | null;
    queuedCount: number | null;
    oldestQueuedAgeSeconds: number | null;
    queueMetrics: Record<string, unknown> | null;
    thresholds: Record<string, unknown> | null;
};

const EDIT_PLAN_MAX_QUEUED_AGE_SECONDS = 30 * 60;

const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000;

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

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function unwrapResponseEnvelope(value: unknown): Record<string, unknown> {
    const source = asRecord(value) || {};
    const nested = asRecord(source.data) || asRecord(source.payload);
    return nested || source;
}

function parseRetryAfterSeconds(value: unknown): number | null {
    const parsed = asNullableNumber(value);
    if (parsed !== null && parsed >= 0) {
        return Math.max(0, Math.ceil(parsed));
    }

    if (typeof value === "string") {
        const header = value.trim();
        if (!header) return null;

        const headerSeconds = Number(header);
        if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
            return Math.max(0, Math.ceil(headerSeconds));
        }

        const dateMs = Date.parse(header);
        if (Number.isFinite(dateMs)) {
            return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
        }
    }

    return null;
}

function readNumericField(record: Record<string, unknown> | null, keys: string[]): number | null {
    if (!record) return null;

    for (const key of keys) {
        const parsed = asNullableNumber(record[key]);
        if (parsed !== null && parsed >= 0) {
            return Math.max(0, Math.ceil(parsed));
        }
    }

    return null;
}

function readStringField(record: Record<string, unknown> | null, keys: string[]): string | null {
    if (!record) return null;

    for (const key of keys) {
        const text = asString(record[key], 20_000);
        if (text) return text;
    }

    return null;
}

function formatSecondsLabel(seconds: number | null): string {
    if (seconds === null) {
        return "a moment";
    }

    return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

function formatQueueMetrics(info: AppEmbeddingEditPlanBackpressureInfo): string | null {
    const queueBits: string[] = [];

    if (info.queuedCount !== null) {
        queueBits.push(`${info.queuedCount} waiting`);
    }

    if (info.oldestQueuedAgeSeconds !== null) {
        queueBits.push(`oldest ${formatSecondsLabel(info.oldestQueuedAgeSeconds)}`);
    }

    if (!queueBits.length) return null;
    return `Queue metrics: ${queueBits.join(", ")}`;
}

function normalizeEmbeddingEditPlanProposalFile(raw: unknown): AppEmbeddingEditPlanProposalFile | null {
    if (!raw || typeof raw !== "object") return null;
    const file = raw as Record<string, unknown>;
    const path = asString(file.path, 500);
    const op = asString(file.op, 80);
    if (!path || !op) return null;

    const target = file.target && typeof file.target === "object"
        ? {
            chunkId: asString((file.target as Record<string, unknown>).chunkId, 200) || null,
            chunkHash: asString((file.target as Record<string, unknown>).chunkHash, 200) || null,
            fileHash: asString((file.target as Record<string, unknown>).fileHash, 200) || null,
            lineStart: Number.isFinite(Number((file.target as Record<string, unknown>).lineStart)) ? Math.floor(Number((file.target as Record<string, unknown>).lineStart)) : null,
            lineEnd: Number.isFinite(Number((file.target as Record<string, unknown>).lineEnd)) ? Math.floor(Number((file.target as Record<string, unknown>).lineEnd)) : null,
            anchorText: asString((file.target as Record<string, unknown>).anchorText, 4000) || null,
            beforeText: asString((file.target as Record<string, unknown>).beforeText, 20_000) || null,
            afterText: asString((file.target as Record<string, unknown>).afterText, 20_000) || null,
        }
        : null;

    return {
        path,
        op,
        delete: typeof file.delete === "boolean" ? file.delete : undefined,
        content: typeof file.content === "string" ? file.content : null,
        beforeLineCount: asNullableNumber(file.beforeLineCount ?? file.before_line_count),
        afterLineCount: asNullableNumber(file.afterLineCount ?? file.after_line_count),
        estimatedLinesAdded: asNullableNumber(file.estimatedLinesAdded ?? file.estimated_lines_added),
        estimatedLinesRemoved: asNullableNumber(file.estimatedLinesRemoved ?? file.estimated_lines_removed),
        beforePreview: asString(file.beforePreview ?? file.before_preview, 20_000) || null,
        afterPreview: asString(file.afterPreview ?? file.after_preview, 20_000) || null,
        target,
    };
}

function normalizeEmbeddingEditPlanProposal(raw: unknown): AppEmbeddingEditPlanProposal {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const files = Array.isArray(source.files)
        ? source.files.map(normalizeEmbeddingEditPlanProposalFile).filter(Boolean)
        : [];

    return {
        autoApplyAllowed: asBoolean(source.autoApplyAllowed ?? source.auto_apply_allowed),
        files: files as AppEmbeddingEditPlanProposalFile[],
        fileCount: asNullableNumber(source.fileCount ?? source.file_count),
        totalEstimatedLinesAdded: asNullableNumber(source.totalEstimatedLinesAdded ?? source.total_estimated_lines_added),
        totalEstimatedLinesRemoved: asNullableNumber(source.totalEstimatedLinesRemoved ?? source.total_estimated_lines_removed),
        summary: asString(source.summary, 20_000) || null,
        model: asString(source.model, 200) || null,
        needsRebuild: typeof source.needsRebuild === "boolean" ? source.needsRebuild : typeof source.needs_rebuild === "boolean" ? source.needs_rebuild : undefined,
        needsMoreContext: typeof source.needsMoreContext === "boolean" ? source.needsMoreContext : typeof source.needs_more_context === "boolean" ? source.needs_more_context : undefined,
    };
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
        proposal: (raw as any)?.proposal && typeof (raw as any).proposal === "object" ? normalizeEmbeddingEditPlanProposal((raw as any).proposal) : undefined,
        requestId: typeof (raw as any)?.requestId === "string" ? (raw as any).requestId : null,
        code: typeof (raw as any)?.code === "string" ? (raw as any).code : null,
        error: typeof (raw as any)?.error === "string" ? (raw as any).error : null,
    };
}

export function normalizeEmbeddingEditPlanJobStatus(raw: unknown): AppEmbeddingEditPlanJobStatus {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const envelope = unwrapResponseEnvelope(raw);
    const nestedJob = asRecord(envelope.job) || asRecord(source.job);
    const active = nestedJob || envelope;
    const result = active.result && typeof active.result === "object"
        ? normalizeEmbeddingEditPlanPlan(active.result)
        : envelope.result && typeof envelope.result === "object"
            ? normalizeEmbeddingEditPlanPlan(envelope.result)
            : null;

    return {
        ...envelope,
        status: asString(active.status, 80) || "queued",
        stage: asString(active.stage, 120) || null,
        progress: asNullableNumber(active.progress),
        queueAgeSeconds: asNullableNumber(active.queueAgeSeconds ?? active.queue_age_seconds),
        queuedForSeconds: asNullableNumber(active.queuedForSeconds ?? active.queued_for_seconds),
        runningForSeconds: asNullableNumber(active.runningForSeconds ?? active.running_for_seconds),
        leaseRemainingSeconds: asNullableNumber(active.leaseRemainingSeconds ?? active.lease_remaining_seconds),
        workerId: asString(active.workerId, 200) || null,
        attemptCount: asNullableNumber(active.attemptCount ?? active.attempt_count),
        requestId: asString(active.requestId ?? envelope.requestId ?? source.requestId, 120) || null,
        jobId: asString(active.jobId ?? envelope.jobId ?? source.jobId, 120) || null,
        statusUrl: asString(active.statusUrl ?? envelope.statusUrl ?? source.statusUrl, 500) || null,
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
        queued: asBoolean(active.queued ?? envelope.queued ?? source.queued),
        job: nestedJob ? normalizeEmbeddingEditPlanJobStatus(nestedJob) : null,
    } as AppEmbeddingEditPlanJobStatus;
}

export function normalizeEmbeddingEditPlanResponse(raw: unknown): AppEmbeddingEditPlanResponse {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const envelope = unwrapResponseEnvelope(raw);
    const normalizedPlan = normalizeEmbeddingEditPlanPlan(envelope);
    const normalizedJob = normalizeEmbeddingEditPlanJobStatus(envelope);

    return {
        ...normalizedPlan,
        queued: asBoolean(envelope.queued ?? source.queued),
        jobId: asString(envelope.jobId ?? source.jobId, 120) || null,
        statusUrl: asString(envelope.statusUrl ?? envelope.status_url ?? source.statusUrl ?? source.status_url, 500) || null,
        status: asString(envelope.status ?? source.status, 80) || null,
        stage: asString(envelope.stage ?? source.stage, 120) || null,
        progress: asNullableNumber(envelope.progress ?? source.progress),
        queueAgeSeconds: asNullableNumber(envelope.queueAgeSeconds ?? envelope.queue_age_seconds ?? source.queueAgeSeconds ?? source.queue_age_seconds),
        queuedForSeconds: asNullableNumber(envelope.queuedForSeconds ?? envelope.queued_for_seconds ?? source.queuedForSeconds ?? source.queued_for_seconds),
        runningForSeconds: asNullableNumber(envelope.runningForSeconds ?? envelope.running_for_seconds ?? source.runningForSeconds ?? source.running_for_seconds),
        leaseRemainingSeconds: asNullableNumber(envelope.leaseRemainingSeconds ?? envelope.lease_remaining_seconds ?? source.leaseRemainingSeconds ?? source.lease_remaining_seconds),
        workerId: asString(envelope.workerId ?? source.workerId, 200) || null,
        attemptCount: asNullableNumber(envelope.attemptCount ?? envelope.attempt_count ?? source.attemptCount ?? source.attempt_count),
        job: normalizedJob,
        result: envelope.result && typeof envelope.result === "object" ? normalizeEmbeddingEditPlanPlan(envelope.result) : source.result && typeof source.result === "object" ? normalizeEmbeddingEditPlanPlan(source.result) : undefined,
    };
}

const EDIT_PLAN_JOB_ACTIVE_STATUSES = new Set(["queued", "picked_up", "working", "processing", "running", "applying"]);
const EDIT_PLAN_JOB_TERMINAL_STATUSES = new Set(["completed", "failed", "expired"]);

export function isEditPlanJobActiveStatus(status: string | null | undefined): boolean {
    const normalized = String(status || "").toLowerCase();
    if (!normalized) return true;
    if (EDIT_PLAN_JOB_TERMINAL_STATUSES.has(normalized)) return false;
    return true;
}

export function isEditPlanJobTerminalStatus(status: string | null | undefined): boolean {
    return EDIT_PLAN_JOB_TERMINAL_STATUSES.has(String(status || "").toLowerCase());
}

export function getEditPlanJobDisplayStatus(status: string | null | undefined): string {
    switch (String(status || "").toLowerCase()) {
        case "queued":
            return "Waiting in queue";
        case "picked_up":
            return "Picked up by worker";
        case "working":
            return "Generating edit plan";
        case "processing":
            return "Generating edit plan";
        case "completed":
            return "Edit plan ready";
        case "failed":
            return "Edit plan failed";
        case "expired":
            return "Job expired, re-queued";
        default:
            return String(status || "Working").replace(/_/g, " ");
    }
}

export function getEditPlanJobPollDelayMs(status: string | null | undefined, stableReads = 0): number {
    const normalizedStatus = String(status || "").toLowerCase();
    const stable = Math.max(0, Math.floor(Number(stableReads) || 0));

    if (normalizedStatus === "queued") {
        return stable >= 3 ? 2_500 : 1_400;
    }

    return stable >= 3 ? 2_000 : 1_600;
}

export function extractCompletedEditPlanResult(job: AppEmbeddingEditPlanJobStatus | null | undefined): AppEmbeddingEditPlanPlan | null {
    if (!job || typeof job !== "object") return null;
    if (!isEditPlanJobTerminalStatus(job.status) || String(job.status || "").toLowerCase() !== "completed") return null;
    if (job.result && typeof job.result === "object") return normalizeEmbeddingEditPlanPlan(job.result);
    if (job.job?.result && typeof job.job.result === "object") return normalizeEmbeddingEditPlanPlan(job.job.result);
    return null;
}

export function extractCompletedEditPlanProposal(job: AppEmbeddingEditPlanJobStatus | null | undefined): AppEmbeddingEditPlanProposal | null {
    if (!job || typeof job !== "object") return null;
    if (!isEditPlanJobTerminalStatus(job.status) || String(job.status || "").toLowerCase() !== "completed") return null;

    const completedResult = job.result && typeof job.result === "object"
        ? job.result
        : job.job?.result && typeof job.job.result === "object"
            ? job.job.result
            : null;
    const proposal = completedResult && typeof completedResult === "object" ? (completedResult as any).proposal : null;
    if (!proposal || typeof proposal !== "object") return null;

    return normalizeEmbeddingEditPlanProposal(proposal);
}

export function getEditPlanRetryAfterSeconds(result: { retryAfter?: string | null; data?: unknown }): number | null {
    const data = asRecord(result.data);
    const bodyRetryAfterSeconds = parseRetryAfterSeconds(data?.retryAfterSeconds ?? data?.retry_after_seconds);
    if (bodyRetryAfterSeconds !== null) {
        return bodyRetryAfterSeconds;
    }

    return parseRetryAfterSeconds(result.retryAfter);
}

export function isEditPlanBackpressureResult(result: Pick<AppEmbeddingRequestResult<unknown>, "status" | "code">): boolean {
    const code = String(result.code || "").trim().toUpperCase();
    return result.status === 429 || code === "EMBEDDING_EDIT_PLAN_BACKPRESSURE";
}

export function getEditPlanBackpressureInfo(result: AppEmbeddingRequestResult<AppEmbeddingEditPlanResponse>): AppEmbeddingEditPlanBackpressureInfo {
    const data = asRecord(result.data);
    const queueMetrics = asRecord(data?.queueMetrics ?? data?.queue_metrics);
    const thresholds = asRecord(data?.thresholds ?? data?.queueThresholds ?? data?.queue_thresholds);

    return {
        retryAfterSeconds: getEditPlanRetryAfterSeconds(result),
        requestId: asString(data?.requestId ?? result.requestId, 120) || null,
        reason: readStringField(data, ["reason", "message", "error"]),
        queuedCount: readNumericField(queueMetrics, ["queuedCount", "queued_count", "queueDepth", "queue_depth"]),
        oldestQueuedAgeSeconds: readNumericField(queueMetrics, ["oldestQueuedAgeSeconds", "oldest_queued_age_seconds", "oldestQueuedAge", "oldest_queued_age"]),
        queueMetrics,
        thresholds,
    };
}

export function formatEditPlanBackpressureMessage(result: AppEmbeddingRequestResult<AppEmbeddingEditPlanResponse>): string {
    const info = getEditPlanBackpressureInfo(result);
    const lines = [
        `The edit-plan queue is busy. Try again in ${formatSecondsLabel(info.retryAfterSeconds)}.`,
        "No changes were made yet.",
    ];

    if (info.reason) {
        lines.push(`Reason: ${info.reason}`);
    }

    const queueMetricsLine = formatQueueMetrics(info);
    if (queueMetricsLine) {
        lines.push(queueMetricsLine);
    }

    if (info.requestId) {
        lines.push(`Request ID: ${info.requestId}`);
    }

    return lines.join("\n");
}

export function getEditPlanJobQueueAgeSeconds(job: Pick<AppEmbeddingEditPlanJobStatus, "queueAgeSeconds" | "queuedForSeconds"> | null | undefined): number | null {
    if (!job || typeof job !== "object") return null;
    const age = asNullableNumber(job.queueAgeSeconds ?? job.queuedForSeconds);
    return age !== null && age >= 0 ? Math.max(0, Math.floor(age)) : null;
}

export function isEditPlanJobExpiredByQueueAge(job: Pick<AppEmbeddingEditPlanJobStatus, "status" | "queueAgeSeconds" | "queuedForSeconds"> | null | undefined): boolean {
    if (!job || String(job.status || "").toLowerCase() !== "queued") return false;
    const ageSeconds = getEditPlanJobQueueAgeSeconds(job);
    return typeof ageSeconds === "number" && ageSeconds >= EDIT_PLAN_MAX_QUEUED_AGE_SECONDS;
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

export function normalizePreviewApplyResponse(raw: unknown, status: number, retryAfterHeader: string | null): AppPreviewApplyResponse {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const normalizedRetryAfterSeconds = parseRetryAfterSeconds(source.retryAfterSeconds ?? source.retry_after_seconds ?? retryAfterHeader);
    const normalizedOutcome = asString(source.outcome, 80) || null;
    const restartPending = Boolean(source.restartPending ?? source.restart_pending ?? source.queued);
    const restartConfirmed = Boolean(source.restartConfirmed ?? source.restart_confirmed);
    const explicitRetryable = typeof source.retryable === "boolean" ? source.retryable : false;
    const saved = typeof source.saved === "boolean" ? source.saved : normalizedOutcome === "saved";
    const backendRetryableFailure = Boolean(
        normalizedOutcome === "timeout" ||
        (status >= 500 && status < 600 && !saved && !restartPending && !restartConfirmed)
    );
    const retryable = Boolean(
        explicitRetryable ||
        backendRetryableFailure
    );

    return {
        ...source,
        ok: typeof source.ok === "boolean" ? source.ok : status >= 200 && status < 300,
        outcome: normalizedOutcome,
        saved,
        replayed: typeof source.replayed === "boolean" ? source.replayed : undefined,
        contradictoryStatus: typeof source.contradictoryStatus === "boolean" ? source.contradictoryStatus : typeof source.contradictory_status === "boolean" ? source.contradictory_status : undefined,
        restartPending,
        restartConfirmed,
        retryable,
        retryAfterSeconds: normalizedRetryAfterSeconds,
        phase: asString(source.phase, 80) || null,
        step: asString(source.step, 120) || null,
        requestId: asString(source.requestId, 120) || null,
        idempotencyKey: asString(source.idempotencyKey ?? source.idempotency_key, 200) || null,
        machineId: asString(source.machineId ?? source.machine_id, 200) || null,
        code: asString(source.code, 120) || null,
        resolvedFrom: asString(source.resolvedFrom ?? source.resolved_from, 120) || null,
        needsRebuild: typeof source.needsRebuild === "boolean" ? source.needsRebuild : typeof source.needs_rebuild === "boolean" ? source.needs_rebuild : undefined,
        requiresRestart: typeof source.requiresRestart === "boolean" ? source.requiresRestart : typeof source.requires_restart === "boolean" ? source.requires_restart : undefined,
        requiresRebuild: typeof source.requiresRebuild === "boolean" ? source.requiresRebuild : typeof source.requires_rebuild === "boolean" ? source.requires_rebuild : undefined,
        hmrLikely: typeof source.hmrLikely === "boolean" ? source.hmrLikely : typeof source.hmr_likely === "boolean" ? source.hmr_likely : undefined,
        touchesPublicAssets: typeof source.touchesPublicAssets === "boolean" ? source.touchesPublicAssets : typeof source.touches_public_assets === "boolean" ? source.touches_public_assets : undefined,
        queued: typeof source.queued === "boolean" ? source.queued : undefined,
        restartStatus: asString(source.restartStatus ?? source.restart_status, 80) || null,
        restartMessage: asString(source.restartMessage ?? source.restart_message, 20_000) || null,
        restartWorkflow: asRecord(source.restartWorkflow ?? source.restart_workflow),
        machine: asRecord(source.machine),
        expectedWrites: asNullableNumber(source.expectedWrites ?? source.expected_writes),
        expectedDeletes: asNullableNumber(source.expectedDeletes ?? source.expected_deletes),
        expectedOps: asNullableNumber(source.expectedOps ?? source.expected_ops),
    };
}

export async function applyEditPlanOps(
    request: { appId: string; ops?: AppEmbeddingEditPlanOp[]; files?: Array<{ path: string; content?: string | null; delete?: boolean | null; [key: string]: unknown }>; code?: string | null; idempotencyKey?: string | null },
    headers: HeadersInit,
): Promise<AppEmbeddingRequestResult<AppPreviewApplyResponse>> {
    const response = await fetch("/api/v1/webcontainer/apply", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(typeof request.idempotencyKey === "string" && request.idempotencyKey.trim() ? { "idempotency-key": request.idempotencyKey.trim() } : {}),
            ...headers,
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
            appId: request.appId,
            ...(typeof request.idempotencyKey === "string" && request.idempotencyKey.trim() ? { idempotencyKey: request.idempotencyKey.trim() } : {}),
            ...(typeof request.code === "string" && request.code.trim() ? { code: request.code.trim() } : {}),
            ...(Array.isArray(request.files) && request.files.length > 0 ? { files: request.files } : { ops: request.ops }),
        }),
    });

    const data = await response.json().catch(() => null);
    return {
        ok: response.ok,
        status: response.status,
        data: data ? normalizePreviewApplyResponse(data, response.status, response.headers.get("retry-after")) : null,
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
            ...(request.debugCurrentPath ? { debugCurrentPath: request.debugCurrentPath } : {}),
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
    const search = Array.isArray(request.search) ? request.search : undefined;
    return postJson<AppEmbeddingEditPlanResponse>(
        "/api/app-embeddings/edit-plan",
        {
            appId: request.appId,
            query: request.query,
            requestText: request.requestText ?? request.query,
            currentPath: request.currentPath || null,
            ...(request.debugCurrentPath ? { debugCurrentPath: request.debugCurrentPath } : {}),
            maxChunks,
            ...(search ? { search } : {}),
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
