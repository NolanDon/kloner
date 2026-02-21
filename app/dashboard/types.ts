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
    attemptCount?: number;
    lastError?: string | null;
    retry?: boolean;
    id?: string;
}
