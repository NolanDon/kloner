export type ChatEmbeddingRestorePoint = {
    restorePointId: string;
    requestId: string;
    reason: string;
    createdAt: string | null;
    updatedAt: string | null;
    fileCount: number;
    touchedPaths: string[];
    skippedPaths: string[];
    restorable: boolean;
};

function asString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function asIsoTimestamp(value: unknown): string | null {
    if (typeof value === "string") {
        const text = value.trim();
        if (!text) return null;
        const ms = Date.parse(text);
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }

    if (value && typeof value === "object") {
        const row = value as Record<string, unknown>;
        const seconds = Number(row._seconds);
        const nanos = Number(row._nanoseconds);
        if (Number.isFinite(seconds)) {
            const ms = seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
            return new Date(ms).toISOString();
        }
    }

    return null;
}

function asPathList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => asString(item)).filter(Boolean);
}

function asSafeFileCount(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.floor(parsed));
}

function asEpochMs(iso: string | null): number {
    if (!iso) return 0;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : 0;
}

export function normalizeChatRestorePoints(payload: unknown): ChatEmbeddingRestorePoint[] {
    const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const list = Array.isArray(source.restorePoints) ? source.restorePoints : [];

    return list
        .map((item) => {
            const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            const restorePointId = asString(row.restorePointId) || asString(row.id);
            if (!restorePointId) return null;

            const touchedPaths = (() => {
                const direct = asPathList(row.touchedPaths);
                if (direct.length > 0) return direct;
                return asPathList(row.paths);
            })();
            const skippedPaths = asPathList(row.skippedPaths);
            const fileCountRaw = asSafeFileCount(row.fileCount);
            const fileCount = fileCountRaw > 0 ? fileCountRaw : touchedPaths.length;

            return {
                restorePointId,
                requestId: asString(row.requestId),
                reason: asString(row.reason) || asString(row.label),
                createdAt: asIsoTimestamp(row.createdAt),
                updatedAt: asIsoTimestamp(row.updatedAt),
                fileCount,
                touchedPaths,
                skippedPaths,
                restorable: row.restorable !== false,
            } as ChatEmbeddingRestorePoint;
        })
        .filter((item): item is ChatEmbeddingRestorePoint => Boolean(item))
        .sort((a, b) => {
            const aCreated = asEpochMs(a.createdAt);
            const bCreated = asEpochMs(b.createdAt);
            if (aCreated !== bCreated) return bCreated - aCreated;
            const aUpdated = asEpochMs(a.updatedAt);
            const bUpdated = asEpochMs(b.updatedAt);
            return bUpdated - aUpdated;
        });
}

export function buildChatRestorePointsErrorMessage(args: {
    status: number;
    code?: string | null;
    error?: string | null;
    requestId?: string | null;
}): string {
    const status = Number(args.status) || 0;
    const code = asString(args.code).toUpperCase();
    const error = asString(args.error) || "Could not process restore points right now.";
    const requestId = asString(args.requestId);

    if (status === 401) {
        return "Session expired. Please sign in again.";
    }

    if (status === 404 || code === "RESTORE_POINT_NOT_FOUND") {
        return "Restore point is no longer available. Please refresh the list.";
    }

    if (status === 409 || code === "RESTORE_POINT_NOT_RESTORABLE") {
        return "That restore point cannot be reverted due to snapshot limits.";
    }

    if (status >= 500) {
        return requestId
            ? `Restore point request failed. Please retry. Request ID: ${requestId}`
            : "Restore point request failed. Please retry.";
    }

    return requestId ? `${error} Request ID: ${requestId}` : error;
}

export function buildChatRestorePointRevertSuccessMessage(args: {
    applied: number;
    requiresRestart?: boolean;
    requiresRebuild?: boolean;
    requestId?: string | null;
}): string {
    const applied = Math.max(0, Math.floor(Number(args.applied) || 0));
    const fileLabel = applied === 1 ? "1 file" : applied > 1 ? `${applied} files` : null;
    const base = fileLabel
        ? `Restore point fulfilled — ${fileLabel} restored.`
        : "Restore point fulfilled.";
    const lines = [
        base,
        asString(args.requestId) ? `Request ID: ${asString(args.requestId)}` : null,
    ].filter(Boolean);

    return lines.join("\n");
}

export function getLatestChatRestorePoint(points: ChatEmbeddingRestorePoint[] | null | undefined): ChatEmbeddingRestorePoint | null {
    if (!Array.isArray(points) || points.length === 0) return null;
    return points[0] || null;
}

export function getPreferredOrLatestChatRestorePoint(
    points: ChatEmbeddingRestorePoint[] | null | undefined,
    preferredRestorePointId: string | null | undefined,
): ChatEmbeddingRestorePoint | null {
    if (!Array.isArray(points) || points.length === 0) return null;
    const preferredId = asString(preferredRestorePointId);
    if (!preferredId) return points[0] || null;
    const preferred = points.find((point) => point.restorePointId === preferredId) || null;
    return preferred || points[0] || null;
}

export function isRestorePointListEndpointMissing(args: { status: number; code?: string | null }): boolean {
    const status = Number(args.status) || 0;
    if (status !== 404) return false;
    const code = asString(args.code).toUpperCase();
    if (!code) return true;
    return code !== "RESTORE_POINT_NOT_FOUND";
}

export function buildRestorePointEndpointAuditPrompt(args: {
    endpoint: string;
    appId?: string | null;
    status: number;
    requestId?: string | null;
    expectedResponseShape: Record<string, unknown>;
}): string {
    const payload = {
        endpoint: asString(args.endpoint),
        appId: asString(args.appId) || null,
        status: Number(args.status) || 0,
        requestId: asString(args.requestId) || null,
        required: {
            exists: true,
            auth: "session + app-scope aware",
            responseShape: args.expectedResponseShape,
        },
        ask: "Audit this endpoint route wiring and backend proxy mapping. Ensure it exists and returns the required shape for the frontend restore-point card.",
    };

    return [
        "Backend audit request (restore point endpoint):",
        JSON.stringify(payload, null, 2),
    ].join("\n");
}

export function buildMissingApplyContractUserMessage(args: {
    restorePointCardVisible: boolean;
    hasLatestRestorePoint: boolean;
}): string {
    if (args.restorePointCardVisible && args.hasLatestRestorePoint) {
        return "I created you a restore point above, so you can undo this change if needed.";
    }

    return "Done. I couldn’t load the latest restore point yet. Please tap Refresh once, or use Edit history.";
}
