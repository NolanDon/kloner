const PREVIEW_CONNECTION_FAILURES = new Set([
    "NO_ACTIVE_PREVIEW", "MACHINE_NOT_READY", "MACHINE_NOT_FOUND", "MACHINE_UNREACHABLE",
    "HEALTH_CHECK_EXEC_FAILED", "HEALTH_CHECK_START_FAILED", "HEALTH_CHECK_TIMEOUT", "HEALTH_CHECK_ERROR",
    "HEALTH_CHECK_RUNTIME_FAILED", "HEALTH_CHECK_FAST_RUNTIME_FAILED", "HEALTH_CHECK_BUSY",
    "HEALTH_CHECK_SKIPPED_PREVIEW_APPLY_FAILED", "HEALTH_CHECK_SKIPPED_RESTART_FAILED",
    "PREVIEW_FILE_VERIFICATION_FAILED", "RESTART_FAILED", "RESTART_TIMEOUT", "RESTART_STATUS_UNAVAILABLE",
]);
export function isWorkspacePreviewConnectionFailure(code: unknown): boolean {
    return PREVIEW_CONNECTION_FAILURES.has(String(code || ""));
}
export function workspacePreviewConnectionMessage(hasChanges = true): string {
    return hasChanges
        ? "Your changes are saved, but I couldn’t reconnect the preview after trying to recover it. Retry the preview connection or undo this edit."
        : "I couldn’t reconnect the preview after trying to recover it. Retry the preview connection.";
}
