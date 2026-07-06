export type EditPlanFeedbackDiagnosticContext = {
    appId?: string | null;
    messageId?: string | null;
    feedback?: "up" | "down" | string | null;
    reportCode?: string | null;
    jobId?: string | null;
    requestId?: string | null;
    statusUrl?: string | null;
    responseSchemaVersion?: string | null;
    summaryText?: string | null;
    reportPrompt?: string | null;
    query?: string | null;
    currentPath?: string | null;
    selectedFiles?: string[] | null;
    framework?: string | null;
    frameworkLabel?: string | null;
    frameworkConfidence?: string | null;
    frameworkReason?: string | null;
    reportRequest?: unknown;
    reportResponse?: unknown;
    traceSummary?: unknown;
    reportOutcome?: unknown;
    summary?: string | null;
    userId?: string | null;
    requestedAt?: number | null;
};

function normalizeString(value: unknown): string {
    return String(value ?? "").trim();
}

function normalizeList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map((item) => normalizeString(item)).filter(Boolean)
        : [];
}

function truncateText(value: unknown, maxLength = 1200): string {
    const text = normalizeString(value);
    if (!text) return "(empty)";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trimEnd()}\n... [truncated ${text.length - maxLength} chars]`;
}

function extractUniqueFailureDetail(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === "string") {
        const text = value.trim();
        if (!text) return null;
        if (["ok", "okay", "success", "successful", "valid", "passed"].includes(text.toLowerCase())) return null;
        return text;
    }
    if (typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const candidate = normalizeString(record.errorCode || record.code || record.failureCode || record.reason || record.message);
    if (!candidate) return null;
    const lower = candidate.toLowerCase();
    if (["ok", "okay", "success", "successful", "valid", "passed", "none", "null"].includes(lower)) return null;
    return candidate;
}

function extractNamedText(value: unknown, keys: string[] = ["summaryText", "summary", "text", "message"]): string | null {
    if (typeof value === "string") {
        const text = value.trim();
        return text || null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    for (const key of keys) {
        const text = normalizeString(record[key]);
        if (text) return text;
    }
    return null;
}

export function extractTraceSummaryText(traceSummary: unknown): string | null {
    return extractNamedText(traceSummary);
}

export function formatCompactJson(value: unknown, maxLength = 2200): string {
    try {
        const json = JSON.stringify(value ?? null, null, 2);
        if (json.length <= maxLength) return json;
        return `${json.slice(0, maxLength).trimEnd()}\n... [truncated ${json.length - maxLength} chars]`;
    } catch {
        return "[unserializable]";
    }
}

export function buildEditPlanGenericImprovementPrompt(): string {
    return [
        "This is a coding task, not just an analysis task.",
        "",
        "The following information came from an edit-plan request and the resulting response. Analyze the report code and attached debug data, then decide one of two outcomes:",
        "",
        "1. The edit-plan result was accurate and the issue is likely outside the backend edit-plan logic, such as the UI not refreshing or the frontend not rendering the latest state.",
        "2. The edit-plan result was not accurate or was under-specified, and the backend needs a concrete code fix.",
        "",
        "If the result was accurate, say so clearly and write it off as a valid result.",
        "If the result was not accurate, do not just recommend a fix. Actually implement the code fix in the backend, add or update tests, run the relevant tests, and then summarize exactly what changed.",
        "",
        "Your analysis should focus on:",
        "- whether the request was actually clear enough to fulfill",
        "- whether the response incorrectly asked for more context",
        "- whether the model or prompt flow was too conservative",
        "- whether retrieval, anchoring, patching, or validation caused the bad result",
        "- whether the bug is in the backend logic, prompt template, or post-processing",
        "",
        "If a fix is needed, output:",
        "- the exact function, file, or prompt section to change",
        "- the concrete behavior change needed",
        "- any test cases that should be added or updated",
        "- verify the fix by running the relevant tests",
        "- report the final behavior change",
        "",
        "Do not end with a recommendation only. If the backend is wrong, fix the backend.",
    ].join("\n");
}

export function buildEditPlanMissingTargetGuidance(): string {
    return [
        "Missing-element / creation fallback guidance:",
        "- If the request clearly implies an element or target that does not exist anywhere in the project, treat it as a creation or insertion task rather than automatically asking for more context.",
        "- If the search proves the target is absent, the backend should decide whether to create it, insert it, or choose a safe structural fallback.",
        "- Add tests for missing-target creation fallback, insertion fallback, and cases where the backend should still ask for more context because the request is truly ambiguous.",
    ].join("\n");
}

export function buildEditPlanCopyPastePrompt(input: EditPlanFeedbackDiagnosticContext): string {
    const reportCode = normalizeString(input.reportCode) || "unknown";
    const jobId = normalizeString(input.jobId) || "unknown";
    const requestId = normalizeString(input.requestId) || "unknown";
    const statusUrl = normalizeString(input.statusUrl) || "none";
    const responseSchemaVersion = normalizeString(input.responseSchemaVersion) || "unknown";
    const query = normalizeString(input.query) || "(unknown)";
    const currentPath = normalizeString(input.currentPath) || "(none)";
    const selectedFiles = normalizeList(input.selectedFiles);
    const framework = normalizeString(input.framework) || "unknown";
    const frameworkLabel = normalizeString(input.frameworkLabel) || "unknown";
    const frameworkConfidence = normalizeString(input.frameworkConfidence) || "unknown";
    const frameworkReason = normalizeString(input.frameworkReason) || "unknown";
    const summaryText = normalizeString(input.summaryText) || "(empty)";
    const reportPrompt = normalizeString(input.reportPrompt) || "(empty)";
    const traceSummaryText = extractTraceSummaryText(input.traceSummary) || "(empty)";
    return [
        "Analyze the following edit-plan diagnostic report. Use the report code and attached metadata to determine whether the result was valid, overly conservative, or incorrect. If the backend should have produced a concrete edit, identify the exact code path, prompt section, or post-processing rule that should change and specify the fix. If the result was valid and the issue is likely in the UI or downstream rendering, say so clearly. If the requested target does not exist anywhere in the project and the request is otherwise clear, prefer creation or insertion over asking for more context. Suggest tests that cover this case and prevent regressions.",
        "",
        "Report code: " + reportCode,
        "Job ID: " + jobId,
        "Request ID: " + requestId,
        "Status URL: " + statusUrl,
        "Schema version: " + responseSchemaVersion,
        "Query: " + query,
        "Current path: " + currentPath,
        "Selected files: " + (selectedFiles.length > 0 ? selectedFiles.join(", ") : "none"),
        "Framework: " + framework,
        "Framework label: " + frameworkLabel,
        "Framework confidence: " + frameworkConfidence,
        "Framework reason: " + frameworkReason,
        "Summary text: " + summaryText,
        "traceSummary.summaryText: " + traceSummaryText,
        "",
        "Prompt:",
        reportPrompt,
        "",
        "Request / response snapshot:",
        formatCompactJson({
            reportCode: normalizeString(input.reportCode) || null,
            jobId: normalizeString(input.jobId) || null,
            requestId: normalizeString(input.requestId) || null,
            statusUrl: normalizeString(input.statusUrl) || null,
            responseSchemaVersion: normalizeString(input.responseSchemaVersion) || null,
            summaryText: normalizeString(input.summaryText) || null,
            query: normalizeString(input.query) || null,
            currentPath: normalizeString(input.currentPath) || null,
            selectedFiles,
            framework: normalizeString(input.framework) || null,
            frameworkLabel: normalizeString(input.frameworkLabel) || null,
            frameworkConfidence: normalizeString(input.frameworkConfidence) || null,
            frameworkReason: normalizeString(input.frameworkReason) || null,
            reportOutcome: input.reportOutcome ?? null,
            reportRequest: input.reportRequest ?? null,
            reportResponse: input.reportResponse ?? null,
            traceSummary: input.traceSummary ?? null,
        }, 1800),
    ].join("\n");
}

export function buildEditPlanSlackDiagnosticText(input: EditPlanFeedbackDiagnosticContext): string {
    const reportCode = normalizeString(input.reportCode) || "unknown";
    const jobId = normalizeString(input.jobId) || "unknown";
    const requestId = normalizeString(input.requestId) || "unknown";
    const summaryText = truncateText(input.summaryText, 700);
    const failureDetail = extractUniqueFailureDetail(input.reportOutcome);
    const humanNote = truncateText(input.summary, 220);

    return [
        "[FRONTEND] Edit-plan feedback: thumbs down",
        formatCompactJson({
            reportCode,
            jobId,
            requestId,
            feedback: "down",
            summaryText,
            failureDetail: failureDetail || null,
            backendInstruction: "Inspect the project files tied to this reportCode/jobId, identify the exact file(s) that should have been edited, and use that to correct file selection and fallback behavior in the edit-plan system.",
        }, 900),
        humanNote && humanNote !== "(empty)" ? `Human note: ${humanNote}` : null,
    ].join("\n");
}
