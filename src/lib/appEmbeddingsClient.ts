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
};

export type AppEmbeddingEditPlanFile = {
    path: string;
    action: string;
    content?: string | null;
    reason?: string | null;
};

export type AppEmbeddingEditPlanResponse = {
    formatVersion: string | null;
    summary: string;
    needsRebuild: boolean;
    files: AppEmbeddingEditPlanFile[];
    notes: string[];
    search: AppEmbeddingSearchChunk[];
    response?: string;
    refreshServer?: boolean;
    fileEdits?: Array<{ path: string; content: string }>;
    setupDatabase?: boolean;
    dbMigrations?: Array<{ sql?: string; message?: string; destructive?: boolean }>;
};

export type AppEmbeddingRequestResult<T> = {
    ok: boolean;
    status: number;
    data: T | null;
    error: string | null;
    retryAfter: string | null;
};

function asString(value: unknown, max = 10_000): string {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    return text.length <= max ? text : text.slice(0, max);
}

function asNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
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

function isObjectObjectSentinel(value: string): boolean {
    return value.trim().toLowerCase() === "[object object]";
}

export function normalizeEmbeddingSearchChunk(raw: unknown): AppEmbeddingSearchChunk | null {
    if (!raw || typeof raw !== "object") return null;
    const chunk = raw as Record<string, unknown>;
    const path = asString(chunk.path, 500);
    const chunkText = asString(chunk.chunkText ?? chunk.text ?? chunk.excerpt, 30_000);
    if (!path || !chunkText || isObjectObjectSentinel(chunkText)) return null;

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
    };
}

export function normalizeEmbeddingEditPlanFile(raw: unknown): AppEmbeddingEditPlanFile | null {
    if (!raw || typeof raw !== "object") return null;
    const file = raw as Record<string, unknown>;
    const path = asString(file.path, 500);
    if (!path) return null;

    const action = asString(file.action, 80) || "update";
    const content = typeof file.content === "string" ? file.content : null;
    const reason = asString(file.reason, 2000) || null;

    return {
        path,
        action,
        content,
        reason,
    };
}

export function normalizeEmbeddingEditPlanResponse(raw: unknown): AppEmbeddingEditPlanResponse {
    const normalizedSearch = normalizeEmbeddingSearchResponse((raw as any)?.search);
    const files = Array.isArray((raw as any)?.files)
        ? (raw as any).files.map(normalizeEmbeddingEditPlanFile).filter(Boolean)
        : [];
    const notes = Array.isArray((raw as any)?.notes)
        ? (raw as any).notes.map((note: unknown) => asString(note, 4000)).filter(Boolean)
        : [];

    return {
        formatVersion: asString((raw as any)?.formatVersion ?? (raw as any)?.format_version ?? "", 80) || null,
        summary: asString((raw as any)?.summary ?? (raw as any)?.response ?? "", 20_000),
        needsRebuild: Boolean((raw as any)?.needsRebuild ?? (raw as any)?.needs_rebuild ?? (raw as any)?.refreshServer),
        files: files as AppEmbeddingEditPlanFile[],
        notes,
        search: normalizedSearch.chunks,
        response: typeof (raw as any)?.response === "string" ? (raw as any).response : undefined,
        refreshServer: typeof (raw as any)?.refreshServer === "boolean" ? (raw as any).refreshServer : undefined,
        fileEdits: Array.isArray((raw as any)?.fileEdits) ? (raw as any).fileEdits : undefined,
        setupDatabase: typeof (raw as any)?.setupDatabase === "boolean" ? (raw as any).setupDatabase : undefined,
        dbMigrations: Array.isArray((raw as any)?.dbMigrations) ? (raw as any).dbMigrations : undefined,
    };
}

async function postJson<T>(path: string, body: unknown, headers: HeadersInit): Promise<AppEmbeddingRequestResult<T>> {
    try {
        const response = await fetch(path, {
            method: "POST",
            headers,
            credentials: "include",
            cache: "no-store",
            body: JSON.stringify(body ?? {}),
        });

        const data = await response.json().catch(() => null);
        const retryAfter = response.headers.get("retry-after");

        return {
            ok: response.ok,
            status: response.status,
            data: data as T | null,
            error: response.ok ? null : (typeof (data as any)?.error === "string" ? (data as any).error : "Request failed"),
            retryAfter,
        };
    } catch (err: any) {
        return {
            ok: false,
            status: 0,
            data: null,
            error: String(err?.message || err || "Request failed"),
            retryAfter: null,
        };
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
            search: Array.isArray(request.search) ? request.search : undefined,
            ...(request.framework ? { framework: request.framework } : {}),
            ...(request.frameworkLabel ? { frameworkLabel: request.frameworkLabel } : {}),
            ...(request.frameworkConfidence ? { frameworkConfidence: request.frameworkConfidence } : {}),
            ...(request.frameworkReason ? { frameworkReason: request.frameworkReason } : {}),
        },
        headers,
    );
}

export function applyEmbeddingEditPlanToFiles(
    currentFiles: { [path: string]: { content: string; lastModified: number } },
    files: AppEmbeddingEditPlanFile[],
): { [path: string]: { content: string; lastModified: number } } {
    const nextFiles = { ...(currentFiles || {}) };
    const now = Date.now();

    for (const file of files || []) {
        const path = asString(file?.path, 500);
        if (!path) continue;

        const action = asString(file?.action, 80).toLowerCase();
        if (action === "delete") {
            delete nextFiles[path];
            continue;
        }

        if (typeof file?.content === "string") {
            nextFiles[path] = { content: file.content, lastModified: now };
        }
    }

    return nextFiles;
}

export function editPlanHasDeleteOps(files: AppEmbeddingEditPlanFile[]): boolean {
    return Array.isArray(files) && files.some((file) => asString(file?.action, 80).toLowerCase() === "delete");
}
