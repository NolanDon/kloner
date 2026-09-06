const INTERNAL_WORKSPACE_SUMMARY_LINES = [
    /^Changed\s+\d+\s+file(?:s)?(?:\s*\(s\))?\.\s*Health checks passed\.\s*Preview restart completed\.?$/i,
    /^Health checks passed\.\s*Preview restart completed\.?$/i,
    /^Restore point:\s*[^\n]+$/i,
];

/** Keep user-facing summaries friendly while leaving restore metadata on the message object. */
export function stripWorkspaceInternalSummaryMetadata(value: string): string {
    const text = String(value || "").trim();
    if (!text) return "";

    return text
        .split("\n")
        .filter((line) => !INTERNAL_WORKSPACE_SUMMARY_LINES.some((pattern) => pattern.test(line.trim())))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
