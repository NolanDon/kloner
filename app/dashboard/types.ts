export type UrlStatusRaw =
    | "queued"
    | "uploaded"
    | "done"
    | "ready"
    | "in_progress"
    | "error"
    | "stale"
    | "unknown";

export type UrlStatusUi =
    | "queued"
    | "processing"
    | "ready"
    | "stale"
    | "error"
    | "unknown";

export interface UrlDoc {
    url: string;
    urlHash?: string;
    createdAt?: any;
    updatedAt?: any;
    lastAttemptAt?: any;
    status?: UrlStatusRaw | UrlStatusUi | string;
    screenshotsPrefix?: string;
    screenshotPaths?: string[];
    screenshots?: any[];
    archiveMode?: string | boolean | null;
    zipPath?: string | null;
    zipUrl?: string | null;
    zipBytes?: number | null;
    zipPageCount?: number | null;
    attemptCount?: number;
    lastError?: string | null;
    retry?: boolean;
    id?: string;
    archiveHealth?: {
        needsRescan?: boolean;
        warning?: any;
        warningCode?: string | null;
        warningMessage?: string | null;
        warningAction?: string | null;
        errorCode?: string | null;
        errorReason?: string | null;
        userMessage?: string | null;
        retryable?: boolean | null;
        details?: any;
    } | null;
    warning?: any;
    warningCode?: string | null;
    warningMessage?: string | null;
    warningAction?: string | null;
    errorCode?: string | null;
    errorReason?: string | null;
    userMessage?: string | null;
    retryable?: boolean | null;
    details?: any;
    lastErrorCode?: string | null;
    lastErrorRequestId?: string | null;
    lastErrorJobId?: string | null;
    lastErrorBlockedHost?: string | null;
    lastErrorRetryable?: boolean | null;
}
