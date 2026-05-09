// src/components/AppBuilderEditorAgentChat.tsx
"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { Send, Bot, RotateCcw, Database, FileText, RefreshCw, X, AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Copy, Check, Info, ThumbsUp, ThumbsDown } from "lucide-react";
import { ensureSessionAndCsrf } from "@/lib/auth-client";
import { useAuth } from "@/src/hooks/useAuth";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { useModal } from "@/components/ui/ModalContext";
import EditPlanJobStatusCard from "@/components/EditPlanJobStatusCard";
import {
    applyEditPlanOps,
    extractCompletedEditPlanProposal,
    formatEditPlanBackpressureMessage,
    fetchEmbeddingEditPlan,
    fetchEmbeddingEditPlanJobStatus,
    fetchEmbeddingSearch,
    getEmbeddingSearchErrorMessage,
    getEmbeddingSearchRefreshQueuedNotice,
    getEditPlanJobPollDelayMs,
    getEditPlanJobQueueAgeSeconds,
    getEditPlanRetryAfterSeconds,
    isEditPlanBackpressureResult,
    normalizeEmbeddingEditPlanResponse,
    normalizeEmbeddingEditPlanJobStatus,
    normalizeEmbeddingSearchResponse,
    isEditPlanJobActiveStatus as isActiveEditPlanJobStatus,
    isEditPlanJobExpiredByQueueAge,
    isEditPlanJobTerminalStatus,
    type AppEmbeddingEditPlanJobStatus,
    type AppEmbeddingEditPlanProposal,
    type AppEmbeddingEditPlanOp,
    type AppEmbeddingEditPlanResponse,
} from "@/src/lib/appEmbeddingsClient";
import {
    buildProjectFrameworkPrompt,
    chooseFrameworkCurrentFile,
    detectProjectFramework,
    planWouldSwitchFramework,
} from "@/src/lib/projectFramework";
import { deriveEmbeddingCurrentPath } from "@/src/lib/embeddingCurrentPath";
import {
    buildChatRestorePointRevertSuccessMessage,
    buildChatRestorePointsErrorMessage,
    buildRestorePointEndpointAuditPrompt,
    getLatestChatRestorePoint,
    getPreferredOrLatestChatRestorePoint,
    isRestorePointListEndpointMissing,
    normalizeChatRestorePoints,
    type ChatEmbeddingRestorePoint,
} from "@/src/lib/chatRestorePoints";
import {
    resolveApplyState,
    hasWriteProof,
    buildApplyStateMessage,
} from "@/src/lib/editPlanApplyContract";

type SummarySearchFeedbackContext = {
    query: string;
    currentPath: string | null;
    requestedAt: number;
    search?: {
        request?: Record<string, unknown> | null;
        response?: Record<string, unknown> | null;
    } | null;
    jobId?: string | null;
    requestId?: string | null;
};

type EditPlanRequestMeta = {
    query: string;
    currentPath: string | null;
    requestedAt: number;
    preflightRestorePointId?: string | null;
    search?: {
        request?: Record<string, unknown> | null;
        response?: Record<string, unknown> | null;
    } | null;
};

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    type: "text" | "code" | "file-edit";
    debugDetails?: string;
    restorePointId?: string;
    restoreActionLabel?: string;
    migrationProposalId?: string;
    migrationSql?: string;
    migrationDestructive?: boolean;
    migrationStatus?: "PENDING" | "APPLYING" | "APPLIED" | "FAILED";
    migrationErrorCode?: string;
    migrationRelationName?: string;
    migrationCanRegenerate?: boolean;
    migrationRetryPrompt?: string;

    stagedBundleId?: string;
    supabaseContinuationPrompt?: string;
    supabaseContinuationStatus?: "PENDING" | "CONTINUE" | "DISMISS";
    dbSetupPrompt?: string;
    dbSetupStatus?: "PENDING" | "CONNECT" | "BASIC" | "DISMISS";
    retryPrompt?: string;
    retryStatus?: number;
    editPlanRetryPrompt?: string;
    editPlanRetryCurrentPath?: string | null;
    editPlanRebuildPrompt?: boolean;
    editPlanFailure?: boolean;
    editPlanFailureCode?: string;
    editPlanFailureJobId?: string;
    editPlanFailureRequestId?: string;
    editPlanFailureHttpStatus?: number;
    restorePointsCard?: boolean;
    restorePointsCardReason?: string;
    summaryFeedbackContext?: SummarySearchFeedbackContext;
};

type StagedBundle = {
    id: string;
    createdAt: number;
    label: string;
    proposalIds: string[];
    appliedProposalIds: Record<string, boolean>;
    ops: AppEmbeddingEditPlanOp[];
    rawPlan: AppEmbeddingEditPlanResponse;
    creditRequestId?: string;
    needsRebuild?: boolean;
};

type Checkpoint = {
    id: string;
    timestamp: Date;
    description: string;
    files: { [path: string]: string };
};

type DatabaseConnection = {
    id: string;
    name: string;
    type: string;
    host: string;
    port: number;
    database: string;
    status: "connected" | "disconnected" | "connecting";
};

type AppBuilderEditorAgentChatProps = {
    appId: string;
    files: { [path: string]: { content: string; lastModified: number } };
    currentFile?: string | null;
    onFileEdit: (path: string, content: string, creditRequestId?: string) => void;
    onFilesReplace?: (files: { [path: string]: { content: string; lastModified: number } }) => void;
    onRestoreApplied?: (args: {
        previousFiles: { [path: string]: { content: string; lastModified: number } };
        restoredFiles: { [path: string]: { content: string; lastModified: number } };
    }) => void | Promise<void>;
    creditError?: string | null;
    previewReady?: boolean;
    previewIssue?: string | null;
    previewIssueActionLabel?: string | null;
    onPreviewIssueAction?: () => void;
    onPreviewIssueFixRequest?: () => void;
    onUserMessageSent?: () => void;
    welcomeContext?: {
        source?: "prompt" | "url" | "quickstart" | "template" | "sample" | "unknown";
        prompt?: string | null;
        url?: string | null;
        templateName?: string | null;
    };
};

function resolveFallbackCurrentFile(files: { [path: string]: { content: string; lastModified: number } }, currentFile?: string | null): string | null {
    const framework = detectProjectFramework(files);
    return chooseFrameworkCurrentFile(files, framework, currentFile);
}

function normalizeServerFilesMap(
    input: unknown,
): { [path: string]: { content: string; lastModified: number } } {
    const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const normalized: { [path: string]: { content: string; lastModified: number } } = {};

    for (const [path, raw] of Object.entries(source)) {
        const cleanPath = String(path || "").trim();
        if (!cleanPath) continue;

        if (typeof raw === "string") {
            normalized[cleanPath] = { content: raw, lastModified: Date.now() };
            continue;
        }

        if (!raw || typeof raw !== "object") {
            normalized[cleanPath] = { content: "", lastModified: Date.now() };
            continue;
        }

        const file = raw as Record<string, unknown>;
        const content = typeof file.content === "string" ? file.content : "";
        const lastModified = typeof file.lastModified === "number" && Number.isFinite(file.lastModified)
            ? file.lastModified
            : Date.now();

        normalized[cleanPath] = { content, lastModified };
    }

    return normalized;
}

type CompileErrorQuickFixContext = {
    appId: string;
    code: string;
    actionType: "quick_fix_compile";
    fixAction?: string;
    currentPath?: string | null;
    compileError: {
        summary: string;
        detail: string;
        fingerprint: string;
    };
};

type RestorePointItem = {
    id: string;
    label: string;
    kept?: boolean;
    createdAt?: any;
    source?: string;
    paths?: string[];
    undoOf?: string | null;
};

type RestorePointDetail = {
    id: string;
    label: string;
    source?: string;
    kept?: boolean;
    paths?: string[];
    before?: Record<string, string | null>;
    after?: Record<string, string>;
};

type EditHistoryRestorePoint = {
    restorePointId: string;
    touchedPaths: string[];
    restorable: boolean;
    summary: string;
    appliedAt: number;
    query: string;
    currentPath: string | null;
};

type EditHistoryState = {
    undoStack: EditHistoryRestorePoint[];
    redoQueue: Array<{ query: string; currentPath: string | null }>;
};

type KeepUndoPromptState = {
    restorePoint: EditHistoryRestorePoint;
    skippedPaths: string[];
    expiresAt: number;
};

type MigrationApplyFailure = {
    errorText: string;
    errorCode: string | null;
    relationName: string | null;
    canRegenerate: boolean;
};

const STRUCTURAL_UI_HINTS = ["app/layout.tsx", "components/Footer.tsx", "footer.html", "header.html", "site-footer.js", "nav.js"];

function looksLikeStructuralUiRequest(message: string): boolean {
    return /(footer|header|navbar|nav\b|navigation|menu|layout|link)/i.test(String(message || ""));
}

function isStructuralSearchResult(chunks: Array<{ path?: string }>): boolean {
    return chunks.some((chunk) => {
        const path = String(chunk?.path || "").toLowerCase();
        return STRUCTURAL_UI_HINTS.some((hint) => path.includes(hint.toLowerCase())) || /layout|footer|header|nav|menu/.test(path);
    });
}

function isBusyEditPlanStatus(status: number | null | undefined, code: string | null | undefined): boolean {
    const normalizedCode = String(code || "").trim().toUpperCase();
    return status === 503 || normalizedCode === "EMBEDDING_MEMORY_PRESSURE" || normalizedCode === "EMBEDDING_QUEUE_FULL" || normalizedCode === "EMBEDDING_QUEUE_TIMEOUT";
}

function parseRetryDelaySeconds(result: { retryAfter?: string | null; data?: unknown }): number | null {
    return getEditPlanRetryAfterSeconds(result);
}

function waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildEditPlanPauseMessage(requestId: string | null | undefined, code: string | null | undefined): string {
    const details = [
        "We’re busy processing other requests right now.",
        "Please try again in a moment.",
        "No changes were made yet.",
        requestId ? `Request ID: ${requestId}` : null,
        code ? `Error code: ${code}` : null,
    ].filter(Boolean);
    return details.join("\n");
}

function buildEditPlanTerminalMessage(requestId: string | null | undefined, code: string | null | undefined, reason: string) {
    const lowerCode = String(code || "").trim().toUpperCase();
    const isMissingContext = lowerCode === "MISSING_APP_SCOPE" || lowerCode === "INVALID_APP_SCOPE" || lowerCode === "EMBEDDING_INDEX_STALE";
    const header = isMissingContext
        ? "We need a little more context before we can make this change."
        : "We hit an issue on our side before the update could finish.";
    const detailRows = [
        reason ? `Reason: ${reason}` : null,
        requestId ? `Request ID: ${requestId}` : null,
        code ? `Error code: ${code}` : null,
    ].filter(Boolean);

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <div className="text-[15px] font-medium leading-6 text-neutral-900">
                    {header}
                </div>
                <div className="text-sm leading-6 text-neutral-600">
                    No changes were made yet. Please try again in a moment.
                </div>
            </div>
            <details className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                <summary className="cursor-pointer list-none text-sm font-medium text-neutral-800">
                    View details
                </summary>
                <div className="mt-2 space-y-1 text-sm text-neutral-600">
                    {detailRows.length ? detailRows.map((row) => <div key={row}>{row}</div>) : <div>We’re still investigating the issue.</div>}
                </div>
            </details>
        </div>
    );
}

function buildEditPlanTerminalSummary(requestId: string | null | undefined, code: string | null | undefined, reason: string): string {
    const lowerCode = String(code || "").trim().toUpperCase();
    const isMissingContext = lowerCode === "MISSING_APP_SCOPE" || lowerCode === "INVALID_APP_SCOPE" || lowerCode === "EMBEDDING_INDEX_STALE";
    const header = isMissingContext
        ? "We need a little more context before we can make this change."
        : "We hit an issue on our side before the update could finish.";
    return [
        header,
        "No changes were made yet. Please try again in a moment.",
        reason ? `Reason: ${reason}` : null,
        requestId ? `Request ID: ${requestId}` : null,
        code ? `Error code: ${code}` : null,
    ].filter(Boolean).join("\n");
}

function formatEditPlanSeconds(value: number | null | undefined): string | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    if (value < 60) return `${Math.round(value)}s`;
    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function getEditPlanFailureFriendlyMessage(code: string | null | undefined, fallback: string | null | undefined): string {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const applyContractFailureCodes = new Set([
        "EDIT_PLAN_APPLY_FAILURE_INCOMPLETE",
        "EDIT_PLAN_APPLY_FAILURE_MISSING_CODE",
        "EDIT_PLAN_APPLY_FAILURE_MISSING_REASON",
        "EDIT_PLAN_APPLY_FAILURE_MISSING_CODE_AND_REASON",
        "EDIT_PLAN_APPLY_FAILURE_MALFORMED_PAYLOAD",
        "EDIT_PLAN_APPLY_FAILURE_LEGACY_SHAPE_MISMATCH",
    ]);
    if (applyContractFailureCodes.has(normalizedCode)) {
        return "We could not verify the apply result from the worker. Please click refresh, if your changes do not appear, please retry the edit.";
    }
    if (normalizedCode === "EMBEDDING_EDIT_PLAN_QUEUE_FAILED") {
        return "Edit plan queue is unavailable right now. Please retry.";
    }
    if (normalizedCode === "EMBEDDING_MEMORY_PRESSURE") {
        return "Server is under load. Please retry in a moment.";
    }
    if (normalizedCode === "JOB_LOOKUP_FAILED") {
        return "Could not load edit plan status. Please retry.";
    }

    const safeFallback = String(fallback || "").trim();
    return safeFallback || "Edit plan failed. Please retry.";
}

function getEditPlanPollCadenceMs(elapsedMs: number): number {
    if (elapsedMs < 10_000) return 1_200;
    if (elapsedMs < 60_000) return 2_500;
    return 5_000;
}

function extractJobApplyRetryInfo(job: AppEmbeddingEditPlanJobStatus | null | undefined): {
    state: string | null;
    attempt: number | null;
    maxAttempts: number | null;
    nextRetryAfterSeconds: number | null;
    lastFailureMessage: string | null;
} {
    const rootRetry = job && typeof (job as any)?.applyRetry === "object" ? (job as any).applyRetry : null;
    const resultApply = job && typeof (job as any)?.result?.apply === "object"
        ? (job as any).result.apply
        : job && typeof (job as any)?.job?.result?.apply === "object"
            ? (job as any).job.result.apply
            : null;

    const state = String(rootRetry?.state || resultApply?.state || resultApply?.applyRetryState || "").trim().toLowerCase() || null;
    const attemptRaw = Number(rootRetry?.attempt ?? resultApply?.applyAttempts);
    const maxAttemptsRaw = Number(rootRetry?.maxAttempts ?? resultApply?.applyMaxAttempts);
    const nextRetryAfterRaw = Number(rootRetry?.nextRetryAfterSeconds ?? resultApply?.nextRetryAfterSeconds);
    const lastFailure = rootRetry?.lastFailure && typeof rootRetry.lastFailure === "object" ? rootRetry.lastFailure : null;
    const lastFailureMessage = String(
        lastFailure?.error ||
        lastFailure?.reason ||
        lastFailure?.code ||
        "",
    ).trim() || null;

    return {
        state,
        attempt: Number.isFinite(attemptRaw) && attemptRaw > 0 ? Math.floor(attemptRaw) : null,
        maxAttempts: Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0 ? Math.floor(maxAttemptsRaw) : null,
        nextRetryAfterSeconds: Number.isFinite(nextRetryAfterRaw) && nextRetryAfterRaw > 0 ? Math.ceil(nextRetryAfterRaw) : null,
        lastFailureMessage,
    };
}

function shouldSuggestRebuildFromFailure(code: string | null | undefined, body: string | null | undefined): boolean {
    const haystack = `${String(code || "")} ${String(body || "")}`.toLowerCase();
    return (
        haystack.includes("machine") ||
        haystack.includes("proxy") ||
        haystack.includes("webcontainer") ||
        haystack.includes("preview") ||
        haystack.includes("restart")
    );
}

function buildEditPlanDetailsChatMessage(job: AppEmbeddingEditPlanJobStatus): string {
    const proposalSummary = String(job.result?.proposal?.summary || "").trim();
    const resultSummary = String(job.result?.summary || "").trim();
    const summary = proposalSummary || resultSummary;
    return summary;
}

function buildNeedsMoreContextMessage(plan: AppEmbeddingEditPlanResponse, currentFile: string | null): string {
    const questions = [
        ...(Array.isArray(plan.questions) ? plan.questions : []),
        ...(Array.isArray(plan.clarifyingQuestions) ? plan.clarifyingQuestions : []),
    ]
        .map((question) => String(question || "").trim())
        .filter(Boolean)
        .slice(0, 3);

    const intro = currentFile
        ? `I need a bit more detail before I can safely make this change in ${currentFile}.`
        : "I need a bit more detail before I can safely make this change.";

    const guidance = questions.length > 0
        ? ["Please send any of these details:", ...questions.map((question) => `- ${question}`)]
        : ["Please tell me which file, section, or exact text you want changed."];

    return [intro, ...guidance].join("\n");
}

function buildNeedsMoreContextDebugDetails(plan: AppEmbeddingEditPlanResponse): string {
    return JSON.stringify(
        {
            requestId: plan.requestId || null,
            code: plan.code || null,
            reason: plan.reason || null,
            needsMoreContext: Boolean(plan.needsMoreContext),
            questions: Array.isArray(plan.questions) ? plan.questions : [],
            clarifyingQuestions: Array.isArray(plan.clarifyingQuestions) ? plan.clarifyingQuestions : [],
            summary: plan.summary || null,
            opsCount: Array.isArray(plan.ops) ? plan.ops.length : 0,
            searchCount: Array.isArray(plan.search) ? plan.search.length : 0,
            response: plan.response || null,
        },
        null,
        2,
    );
}

function buildEditPlanJobStorageKey(appId: string): string {
    return `kloner:edit-plan-job:${appId}`;
}

function buildEditPlanJobStorageSnapshot(job: AppEmbeddingEditPlanJobStatus): AppEmbeddingEditPlanJobStatus {
    const error = job.error && typeof job.error === "object"
        ? {
            code: typeof job.error.code === "string" ? job.error.code : undefined,
            message: typeof job.error.message === "string" ? job.error.message : undefined,
            retryAfterSeconds: typeof job.error.retryAfterSeconds === "number" ? job.error.retryAfterSeconds : undefined,
        }
        : job.error;

    return {
        status: job.status,
        stage: job.stage ?? null,
        progress: job.progress ?? null,
        queueAgeSeconds: job.queueAgeSeconds ?? null,
        queuedForSeconds: job.queuedForSeconds ?? null,
        runningForSeconds: job.runningForSeconds ?? null,
        leaseRemainingSeconds: job.leaseRemainingSeconds ?? null,
        workerId: job.workerId ?? null,
        attemptCount: job.attemptCount ?? null,
        requestId: job.requestId ?? null,
        jobId: job.jobId ?? null,
        statusUrl: job.statusUrl ?? null,
        queued: job.queued,
        error,
    };
}

function safeSetStorageItem(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // localStorage failed (quota exceeded or access error) – silently skip.
        // We intentionally do not fall back to sessionStorage here because the
        // session store can also be full, and the job will simply re-poll on
        // next mount instead of crashing the dashboard.
    }
}

function safeRemoveStorageItem(key: string): void {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // ignore
    }

    try {
        window.sessionStorage.removeItem(key);
    } catch {
        // ignore
    }
}

function normalizeAssistantMessageText(value: string): string {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function extractCompletedEditPlanResult(job: AppEmbeddingEditPlanJobStatus | null | undefined): Record<string, unknown> | null {
    if (!job || typeof job !== "object") return null;
    if (!isEditPlanJobTerminalStatus(job.status) || String(job.status || "").toLowerCase() !== "completed") return null;

    const result = job.result && typeof job.result === "object"
        ? (job.result as Record<string, unknown>)
        : job.job?.result && typeof job.job.result === "object"
            ? (job.job.result as Record<string, unknown>)
            : null;

    return result;
}

function buildMissingApplyContractFulfillmentPrompt(input: {
    jobId: string | null;
    requestId: string | null;
    statusUrl: string | null;
    summary: string | null;
    diagnosis: string | null;
    proposalFileCount: number;
    proposalPaths: string[];
}): string {
    const compactPaths = input.proposalPaths.slice(0, 12);
    const payload = {
        jobId: input.jobId,
        requestId: input.requestId,
        statusUrl: input.statusUrl,
        summary: input.summary,
        diagnosis: input.diagnosis || "empty",
        proposalFileCount: input.proposalFileCount,
        proposalPaths: compactPaths,
        requirement: {
            field: "result.apply",
            reason: "frontend apply-state + restore-point UX requires backend apply contract",
            requiredShape: {
                outcome: "confirmed_success | restart_pending | restart_confirmed | uncertain | failed",
                patchedFileCount: "number",
                restorePoint: {
                    restorePointId: "string",
                    restorable: "boolean",
                    touchedPaths: ["string"],
                    skippedPaths: ["string"],
                },
                userMessage: "string",
                requestId: "string",
                code: "string",
                retryable: "boolean",
                retryAfterSeconds: "number",
                recommendedAction: "string",
            },
        },
    };

    return [
        "Backend contract fulfillment request:",
        "For completed edit-plan jobs that write files, include a non-null result.apply object so frontend can reliably surface undo/restore behavior.",
        JSON.stringify(payload, null, 2),
    ].join("\n");
}

function isApplyUncertainResult(payload: unknown): boolean {
    const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    if (!data) return false;

    const code = String(data.code || "").trim().toUpperCase();
    const outcome = String(data.outcome || "").trim().toLowerCase();
    return (
        code === "APPLY_STATE_UNCERTAIN" ||
        data.uncertain === true ||
        data.applyUncertain === true ||
        outcome === "apply_uncertain" ||
        outcome === "saved_source_machine_uncertain"
    );
}

function getApplyUncertainMessage(payload: unknown): string {
    const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const backendMessage = typeof data.userMessage === "string" ? data.userMessage.trim() : "";
    if (backendMessage) return backendMessage;

    const savedToSource = data.savedToSource === true;
    if (savedToSource) {
        return "Your changes were saved, but the preview may not have picked them up yet. Perform a rebuild to load the latest version.";
    }

    return "We had a hiccup while reconnecting to the preview. Your changes may have been saved, but the live preview may not be up to date yet. Perform a rebuild to pick up the latest changes.";
}

const STARTER_PROMPTS = [
    "Improve the hero section with stronger hierarchy and clearer CTA.",
    "Tighten spacing and typography to make the layout feel more polished.",
    // "Add a pricing section with plans, feature bullets, and a compare view.",
    // "Refine mobile responsiveness for navigation, spacing, and tap targets.",
];

const PRODUCTION_AGENT_CHAT_BLOCKED = process.env.NEXT_PUBLIC_AGENT_CHAT_BLOCKED === "1";
const PRODUCTION_AGENT_CHAT_BLOCK_MESSAGE = "We’re working on some updates to reduce your token usage. Please check back soon.";

function stripMarkdownBold(text: string): string {
    // Chat renders content as plain text (not markdown), so remove bold markers.
    return (text || "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*\*/g, "");
}

function sanitizeAssistantContent(text: unknown): string {
    const raw = typeof text === "string" ? text : "";
    const lower = raw.toLowerCase();

    if (
        lower.includes("googlegenerativeai error") ||
        lower.includes("candidate was blocked") ||
        lower.includes("recitation") ||
        lower.includes("finishreason")
    ) {
        return "That request couldn’t be completed as written. Try rephrasing it in your own words and avoid pasting large blocks of source text.";
    }

    return raw;
}

function isRetryableAiStatus(status: number | null | undefined): boolean {
    return status === 422 || status === 429 || status === 500 || status === 502;
}

function isUserRetryableAiStatus(status: number | null | undefined): boolean {
    return status === 0 || status === 409 || status === 422 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function renderTextWithLinks(text: string): React.ReactNode {
    const cleaned = stripMarkdownBold(text || "");

    // Linkify full URLs + the key in-app routes we intentionally surface.
    const linkRe = /(https?:\/\/[^\s)\]]+|\/price(?:#topup)?)/g;
    const parts = cleaned.split(linkRe);

    return parts.map((part, idx) => {
        const isUrl = /^https?:\/\//i.test(part);
        const isPricePath = part === "/price" || part === "/price#topup";

        if (!isUrl && !isPricePath) {
            return <span key={idx}>{part}</span>;
        }

        const href = part;

        // Make in-app pricing links look like CTAs (not raw URLs).
        if (isPricePath) {
            const isTopup = part === "/price#topup";
            const label = isTopup ? "Add credits" : "View pricing";
            const classes = isTopup
                ? "inline-flex items-center justify-center rounded-full bg-[#F55F2A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e35625]"
                : "inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-neutral-50";

            return (
                <span key={idx} className="block mt-2">
                    <a href={href} className={classes}>
                        {label}
                    </a>
                </span>
            );
        }

        // External URLs remain normal link styling.
        return (
            <a
                key={idx}
                href={href}
                className="inline-flex items-center gap-1 underline text-blue-700 hover:text-blue-800"
                target="_blank"
                rel="noopener noreferrer"
            >
                <span>{href}</span>
                <ExternalLink className="h-3.5 w-3.5" />
            </a>
        );
    });
}

function buildCompileFixPrefill(ctx: CompileErrorQuickFixContext): string {
    const immutableContext = {
        appId: ctx.appId,
        code: ctx.code,
        actionType: ctx.actionType,
        fixAction: ctx.fixAction || null,
        currentPath: ctx.currentPath ?? null,
        compileError: {
            summary: ctx.compileError.summary,
            detail: ctx.compileError.detail,
            fingerprint: ctx.compileError.fingerprint,
        },
    };

    return [
        "Please fix this compile error using the immutable context below.",
        "",
        "Context (immutable in free-fix mode):",
        JSON.stringify(immutableContext, null, 2),
    ].join("\n");
}

function normalizeLines(text: string): string[] {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function countLineDelta(beforeText: string, afterText: string): { added: number; removed: number } {
    const before = normalizeLines(beforeText);
    const after = normalizeLines(afterText);

    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
        prefix += 1;
    }

    let suffix = 0;
    while (
        suffix < before.length - prefix &&
        suffix < after.length - prefix &&
        before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
        suffix += 1;
    }

    const removed = Math.max(0, before.length - prefix - suffix);
    const added = Math.max(0, after.length - prefix - suffix);
    return { added, removed };
}

function summarizeRestorePointDiff(detail: RestorePointDetail | null | undefined): Array<{ path: string; added: number; removed: number; beforeLines: number; afterLines: number }> {
    if (!detail?.before && !detail?.after) return [];

    const paths = Array.from(new Set([
        ...(detail.paths || []),
        ...Object.keys(detail.before || {}),
        ...Object.keys(detail.after || {}),
    ])).filter(Boolean);

    return paths.map((path) => {
        const beforeText = String(detail.before?.[path] ?? "");
        const afterText = String(detail.after?.[path] ?? "");
        const delta = countLineDelta(beforeText, afterText);
        return {
            path,
            added: delta.added,
            removed: delta.removed,
            beforeLines: normalizeLines(beforeText).length,
            afterLines: normalizeLines(afterText).length,
        };
    });
}

function buildRestorePointDiffPreview(detail: RestorePointDetail | null | undefined, path: string): { before: string; after: string } | null {
    if (!detail) return null;
    const before = String(detail.before?.[path] ?? "");
    const after = String(detail.after?.[path] ?? "");
    if (before === after) return null;
    return { before, after };
}

export default function AppBuilderEditorAgentChat({ appId, files, currentFile, onFileEdit, onFilesReplace, onRestoreApplied, creditError, previewReady, previewIssue, previewIssueActionLabel, onPreviewIssueAction, onPreviewIssueFixRequest, onUserMessageSent, welcomeContext }: AppBuilderEditorAgentChatProps) {
    const { user, userTier } = useAuth();
    const { showConfirm, showAlert } = useModal();
    const PRO_MONTHLY_PRICE_USD = Number.isFinite(Number(process.env.NEXT_PUBLIC_PRO_MONTHLY_PRICE_USD))
        ? Math.max(1, Number(process.env.NEXT_PUBLIC_PRO_MONTHLY_PRICE_USD))
        : 19.99;
    const TOPUP_COMING_SOON = false;
    const allowDatabaseSetupUi = process.env.NODE_ENV !== "production";
    const [aiCreditsRemaining, setAiCreditsRemaining] = useState<number | null>(null);
    const [showCreditsAccuracyNotice, setShowCreditsAccuracyNotice] = useState(true);
    const [topupBusy, setTopupBusy] = useState(false);
    const [topupModalOpen, setTopupModalOpen] = useState(false);
    const [topupCredits, setTopupCredits] = useState<number>(500);
    const [topupConfig, setTopupConfig] = useState<
        | {
              currency: string;
              unitPriceCents: number;
              minCredits: number;
              maxCredits: number;
              stepCredits: number;
          }
        | null
    >(null);

    const topupOptions = (() => {
        const cfg = topupConfig;
        const min = cfg?.minCredits ?? 50;
        const max = cfg?.maxCredits ?? 5000;

        const parseEnv = (raw: string | undefined): number[] => {
            const s = (raw || "").trim();
            if (!s) return [];
            const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
            const nums = parts
                .map((p) => Number.parseInt(p, 10))
                .filter((n) => Number.isFinite(n) && n > 0);
            return Array.from(new Set(nums)).sort((a, b) => a - b);
        };

        const override = parseEnv(process.env.NEXT_PUBLIC_AI_EDIT_TOPUP_OPTIONS);
        const base = override.length
            ? override
            : [50, 100, 200, 400, 800, 1200, 2000, 3000, 4000, 5000, 7500, 10000];

        const filtered = base.filter((n) => n >= min && n <= max);
        if (filtered.length) return filtered;

        const step = cfg?.stepCredits ?? 50;
        const values: number[] = [];
        for (let v = min; v <= max && values.length < 20; v += Math.max(1, step)) values.push(v);
        return values.length ? values : [min];
    })();

    const topupUnitCents = topupConfig?.unitPriceCents ?? 10;
    const topupCurrency = (topupConfig?.currency ?? "usd").toLowerCase();
    const selectedTopupAmount = (topupCredits * topupUnitCents) / 100;
    const showProUpgradeAlternative =
        topupCurrency === "usd" && (userTier === "free" || userTier == null);
    const proSavingsPct =
        selectedTopupAmount > PRO_MONTHLY_PRICE_USD
            ? Math.max(
                  0,
                  Math.round(
                      ((selectedTopupAmount - PRO_MONTHLY_PRICE_USD) / selectedTopupAmount) * 100,
                  ),
              )
            : 0;

    useEffect(() => {
        if (!topupModalOpen) return;
        if (TOPUP_COMING_SOON) return;
        if (topupConfig) return;

        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch("/api/billing/credit-topup-config", { cache: "no-store" });
                if (!res.ok) return;
                const data = (await res.json().catch(() => null)) as any;
                if (!data || cancelled) return;

                const unitPriceCents =
                    typeof data.unitPriceCents === "number" && Number.isFinite(data.unitPriceCents)
                        ? Math.max(1, Math.floor(data.unitPriceCents))
                        : 10;
                const minCredits =
                    typeof data.minCredits === "number" && Number.isFinite(data.minCredits)
                        ? Math.max(1, Math.floor(data.minCredits))
                        : 50;
                const maxCredits =
                    typeof data.maxCredits === "number" && Number.isFinite(data.maxCredits)
                        ? Math.max(minCredits, Math.floor(data.maxCredits))
                        : 5000;
                const stepCredits =
                    typeof data.stepCredits === "number" && Number.isFinite(data.stepCredits)
                        ? Math.max(1, Math.floor(data.stepCredits))
                        : 50;
                const currency = typeof data.currency === "string" ? data.currency : "usd";

                setTopupConfig({ currency, unitPriceCents, minCredits, maxCredits, stepCredits });

                setTopupCredits((prev) => {
                    const options = topupOptions.length ? topupOptions : [minCredits];
                    const clamped = Math.min(Math.max(prev, minCredits), maxCredits);
                    let best = options[0]!;
                    let bestDist = Math.abs(best - clamped);
                    for (const n of options) {
                        const d = Math.abs(n - clamped);
                        if (d < bestDist) {
                            best = n;
                            bestDist = d;
                        }
                    }
                    return best;
                });
            } catch {
                // ignore
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [topupModalOpen]);

    useEffect(() => {
        if (!topupModalOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setTopupModalOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [topupModalOpen]);
    const makeWelcomeMessage = useCallback((ctx?: AppBuilderEditorAgentChatProps["welcomeContext"]) => {
        const cleanOneLine = (v: unknown, max = 180) => {
            const raw = typeof v === "string" ? v : "";
            const collapsed = raw.replace(/\s+/g, " ").trim();
            if (!collapsed) return "";
            return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
        };

        const prompt = cleanOneLine(ctx?.prompt);
        const urlRaw = cleanOneLine(ctx?.url, 220);
        const templateName = cleanOneLine(ctx?.templateName, 80);

        let contextLine = "";
        if (prompt) {
            contextLine = `I saw your request: “${prompt}”`;
        } else if (urlRaw) {
            const nice = urlRaw.replace(/^https?:\/\//i, "");
            contextLine = `I saw you're cloning: ${nice}`;
        } else if (templateName) {
            contextLine = `You're starting from the ${templateName} template.`;
        }

        return [
            contextLine,
            "",
            "I can help with layout, styling, copy, and features.",
            "Choose a direction below or type your own request.",
        ]
            .filter(Boolean)
            .join("\n");
    }, []);

    const [messages, setMessages] = useState<Message[]>(() => [
        {
            id: "welcome",
            role: "assistant",
            content: makeWelcomeMessage(welcomeContext),
            timestamp: new Date(),
            type: "text",
        },
    ]);
    const [input, setInput] = useState("");
    const [freeCompileFixContext, setFreeCompileFixContext] = useState<CompileErrorQuickFixContext | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);
    const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
    const [currentCheckpoint, setCurrentCheckpoint] = useState<string | null>(null);
    const [databaseConnections, setDatabaseConnections] = useState<DatabaseConnection[]>([]);
    const [restorePoints, setRestorePoints] = useState<RestorePointItem[]>([]);
    const [isRestoreBusy, setIsRestoreBusy] = useState(false);
    const [lastRestorePointId, setLastRestorePointId] = useState<string | null>(null);
    const [selectedRestorePointId, setSelectedRestorePointId] = useState<string | null>(null);
    const [restorePointDetailsById, setRestorePointDetailsById] = useState<Record<string, RestorePointDetail | undefined>>({});
    const [activeRestorePointPreview, setActiveRestorePointPreview] = useState<{ restorePointId: string; path: string } | null>(null);
    const [showDatabaseSetup, setShowDatabaseSetup] = useState(false);
    const [showSupabaseSetup, setShowSupabaseSetup] = useState(false);
    const [showSupabaseAdvanced, setShowSupabaseAdvanced] = useState(false);
    const [isSupabaseConnected, setIsSupabaseConnected] = useState(false);
    const [supabaseProjectName, setSupabaseProjectName] = useState<string | null>(null);
    const [supabaseProjectRef, setSupabaseProjectRef] = useState<string | null>(null);
    const [supabaseDbReachable, setSupabaseDbReachable] = useState<boolean | null>(null);
    const [supabaseDbStatusText, setSupabaseDbStatusText] = useState<string | null>(null);
    const [supabaseDbReason, setSupabaseDbReason] = useState<string | null>(null);
    const [supabaseDbLastCheckedAt, setSupabaseDbLastCheckedAt] = useState<number | null>(null);
    const [pendingSupabaseFollowupPrompt, setPendingSupabaseFollowupPrompt] = useState<string | null>(null);
    const [existingSupabaseProjectRef, setExistingSupabaseProjectRef] = useState("");
    const [existingSupabaseAnonKey, setExistingSupabaseAnonKey] = useState("");
    const [existingSupabaseServiceRoleKey, setExistingSupabaseServiceRoleKey] = useState("");
    const [applyingMigrationIds, setApplyingMigrationIds] = useState<Record<string, boolean>>({});
    const [showMigrationSqlByMessageId, setShowMigrationSqlByMessageId] = useState<Record<string, boolean>>({});
    const compileFixRequestCooldownRef = useRef<{ fingerprint: string; until: number } | null>(null);
    const [migrationReviewMessageId, setMigrationReviewMessageId] = useState<string | null>(null);
    const [migrationAcknowledge, setMigrationAcknowledge] = useState(false);
    const [migrationConfirmText, setMigrationConfirmText] = useState("");
    const [migrationShowSqlInModal, setMigrationShowSqlInModal] = useState(false);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [pendingEditPlan, setPendingEditPlan] = useState<AppEmbeddingEditPlanProposal | null>(null);
    const [isApplyingEditPlan, setIsApplyingEditPlan] = useState(false);
    const [editPlanApplyError, setEditPlanApplyError] = useState<string | null>(null);
    const [editPlanApplyStatusMessage, setEditPlanApplyStatusMessage] = useState<string | null>(null);
    const [editPlanApplyLoaderMessage, setEditPlanApplyLoaderMessage] = useState<string | null>(null);
    const [activeEditPlanJob, setActiveEditPlanJob] = useState<AppEmbeddingEditPlanJobStatus | null>(null);
    const [editPlanStatusMessageId, setEditPlanStatusMessageId] = useState<string | null>(null);
    const [editPlanFilesCardMessageId, setEditPlanFilesCardMessageId] = useState<string | null>(null);
    const [showRestorePointsPanel, setShowRestorePointsPanel] = useState(false);
    const [chatRestorePoints, setChatRestorePoints] = useState<ChatEmbeddingRestorePoint[]>([]);
    const [chatRestorePointsLoading, setChatRestorePointsLoading] = useState(false);
    const [chatRestorePointsError, setChatRestorePointsError] = useState<string | null>(null);
    const [chatRestorePointsRequestId, setChatRestorePointsRequestId] = useState<string | null>(null);
    const [chatRestorePointRevertingId, setChatRestorePointRevertingId] = useState<string | null>(null);
    const [summaryFeedbackStateByMessageId, setSummaryFeedbackStateByMessageId] = useState<Record<string, "up" | "down" | "sending" | "error">>({});
    const [editHistory, setEditHistory] = useState<EditHistoryState>({ undoStack: [], redoQueue: [] });
    const [keepUndoPrompt, setKeepUndoPrompt] = useState<KeepUndoPromptState | null>(null);
    const [keepUndoError, setKeepUndoError] = useState<string | null>(null);
    const [historyToast, setHistoryToast] = useState<string | null>(null);
    const lastAppliedEditPlanRef = useRef<AppEmbeddingEditPlanProposal | null>(null);
    const editPlanApplyIdempotencyKeyRef = useRef<string | null>(null);
    const applyPendingEditPlanInFlightRef = useRef(false);
    const keepUndoTimeoutRef = useRef<number | null>(null);
    const editPlanJobRequestMetaRef = useRef<Record<string, EditPlanRequestMeta>>({});

    const [stagedBundles, setStagedBundles] = useState<StagedBundle[]>([]);

    const isSupabaseConnectedRef = useRef(false);
    const supabaseDbHealthInFlightRef = useRef(false);
    const lastSupabaseDbHealthAtRef = useRef(0);
    const scopeRecoveryNoticeAtRef = useRef(0);
    const migrationFailureSeenAtRef = useRef<Record<string, number>>({});
    const editPlanJobVersionRef = useRef(0);
    const editPlanJobStableSignatureRef = useRef<string>("");
    const editPlanJobStableReadsRef = useRef(0);
    const editPlanJobPollTimerRef = useRef<number | null>(null);
    const editPlanJobFetchFailureCountRef = useRef(0);
    const editPlanJobPollDelayOverrideMsRef = useRef<number | null>(null);
    const previewReadyRef = useRef(Boolean(previewReady));
    const editPlanAutoApplyJobIdRef = useRef<string | null>(null);
    const lastEditPlanPromptRef = useRef<string | null>(null);
    const editPlanStatusMessageJobKeyRef = useRef<string | null>(null);
    const editPlanStatusMessageIdRef = useRef<string | null>(null);
    const editPlanStatusMessageTextRef = useRef<string | null>(null);
    const editPlanApplyStatusBubbleTextRef = useRef<string | null>(null);
    const editPlanFailureSurfaceKeyRef = useRef<string | null>(null);
    const lastPreviewIssueChatFingerprintRef = useRef<string | null>(null);
    const chatRestorePointsCardKeyRef = useRef<string | null>(null);
    const chatRestorePointsStableSignalRef = useRef<string | null>(null);
    /** Tracks the jobId for which we have already emitted a restart_pending bubble,
     *  so we don't spam the message on every poll tick while waiting for restartConfirmed. */
    const editPlanRestartPendingEmittedJobIdRef = useRef<string | null>(null);
    const editPlanDetailsMessageKeyRef = useRef<string | null>(null);
    const editPlanDetailsMessageIdRef = useRef<string | null>(null);
    const editPlanDetailsMessageTextRef = useRef<string | null>(null);
    const editPlanFilesCardMessageJobKeyRef = useRef<string | null>(null);
    const latestInquiryMetaRef = useRef<EditPlanRequestMeta | null>(null);
    const latestSummaryFeedbackContextRef = useRef<SummarySearchFeedbackContext | null>(null);
    const previewIssueText = String(previewIssue || '').trim();
    const hasPreviewIssue = Boolean(previewIssueText);
    const showPreviewIssueDetails = process.env.NODE_ENV !== "production";
    const chatDisabled = PRODUCTION_AGENT_CHAT_BLOCKED || (previewReady === false && !freeCompileFixContext && !hasPreviewIssue);
    // Contract gate is owned by the parent editor; chat only renders Fix with AI
    // when the gated callback is provided.
    const hasPreviewIssueFixRequest = typeof onPreviewIssueFixRequest === "function";

    const didSyncSupabasePreviewEnvRef = useRef(false);

    useEffect(() => {
        if (!previewIssueText) {
            lastPreviewIssueChatFingerprintRef.current = null;
            return;
        }

        const normalized = previewIssueText.toLowerCase();
        const isPhaseFailure = normalized.includes("timed out") || normalized.includes("restart") || normalized.includes("failed");
        if (!isPhaseFailure) return;

        const fingerprint = `${appId}:${normalized.slice(0, 240)}`;
        if (lastPreviewIssueChatFingerprintRef.current === fingerprint) return;
        lastPreviewIssueChatFingerprintRef.current = fingerprint;

        setMessages((prev) => [
            ...prev,
            {
                id: `preview_issue_${Date.now()}`,
                role: "assistant",
                content: "Your changes may not have saved. If your changes are not showing, rebuild first.",
                timestamp: new Date(),
                type: "text",
                editPlanRetryPrompt: lastEditPlanPromptRef.current?.trim() || "Retry apply",
            },
        ]);
    }, [appId, previewIssueText]);

    useEffect(() => {
        previewReadyRef.current = Boolean(previewReady);
    }, [previewReady]);

    useEffect(() => {
        if (keepUndoTimeoutRef.current) {
            window.clearTimeout(keepUndoTimeoutRef.current);
            keepUndoTimeoutRef.current = null;
        }
        if (!keepUndoPrompt || isRestoreBusy) return;

        const msRemaining = Math.max(0, keepUndoPrompt.expiresAt - Date.now());
        keepUndoTimeoutRef.current = window.setTimeout(() => {
            pushRestorePointToUndoStack(keepUndoPrompt.restorePoint);
            setKeepUndoPrompt(null);
            setKeepUndoError(null);
        }, msRemaining);

        return () => {
            if (keepUndoTimeoutRef.current) {
                window.clearTimeout(keepUndoTimeoutRef.current);
                keepUndoTimeoutRef.current = null;
            }
        };
    }, [isRestoreBusy, keepUndoPrompt]);

    useEffect(() => {
        if (!historyToast) return;
        const timer = window.setTimeout(() => setHistoryToast(null), 3200);
        return () => window.clearTimeout(timer);
    }, [historyToast]);

    const buildEditPlanStatusBubbleText = useCallback((job: AppEmbeddingEditPlanJobStatus): string => {
        const status = String(job.status || "queued").toLowerCase();
        const applyRetryInfo = extractJobApplyRetryInfo(job);
        const isRetryingApply =
            (status === "working" || status === "processing" || status === "applying")
            && applyRetryInfo.state === "retrying";

        if (isRetryingApply) {
            const attemptLabel = applyRetryInfo.attempt !== null && applyRetryInfo.maxAttempts !== null
                ? `${applyRetryInfo.attempt} of ${applyRetryInfo.maxAttempts}`
                : applyRetryInfo.attempt !== null
                    ? `${applyRetryInfo.attempt}`
                    : "current";
            const retryInLabel = applyRetryInfo.nextRetryAfterSeconds !== null
                ? ` in ${applyRetryInfo.nextRetryAfterSeconds}s`
                : " shortly";
            const detail = applyRetryInfo.lastFailureMessage
                ? `\nLast issue: ${applyRetryInfo.lastFailureMessage}`
                : "";
            return `Applying changes to preview failed temporarily. Retrying (attempt ${attemptLabel})${retryInLabel}.${detail}`;
        }

        const narrative = (() => {
            switch (status) {
                case "queued":
                    return "I’ve queued this edit plan. I’m waiting for a worker to pick it up.";
                case "picked_up":
                    return "The worker picked up the edit plan. I’m waiting for it to start applying.";
                case "working":
                    return "I’m applying the edit plan in the background now.";
                case "processing":
                    return "I’m applying the edit plan in the background now.";
                case "completed":
                    return "The edit plan finished.";
                case "failed":
                    return "The edit plan failed.";
                case "expired":
                    return "The edit plan expired before a worker could finish it.";
                default:
                    return "I’m tracking the edit plan in the background.";
            }
        })();

        return narrative;
    }, []);

    const dispatchAiAgentEvent = useCallback((kind: string, detail?: Record<string, any>) => {
        if (typeof window === "undefined") return;
        try {
            window.dispatchEvent(
                new CustomEvent("kloner:ai-agent-event", {
                    detail: {
                        kind,
                        ts: Date.now(),
                        ...(detail || {}),
                    },
                }),
            );
        } catch {
            // ignore
        }
    }, []);

    const surfaceEditPlanFailure = useCallback((args: {
        body?: string | null;
        code?: string | null;
        jobStatus?: string | null;
        httpStatus?: number | null;
        jobId?: string | null;
        requestId?: string | null;
        retryable: boolean;
        retryPrompt?: string | null;
        retryCurrentPath?: string | null;
        suggestRebuild?: boolean;
    }) => {
        const code = String(args.code || "").trim() || null;
        const jobStatus = String(args.jobStatus || "").trim().toLowerCase() || null;
        const httpStatus = typeof args.httpStatus === "number" && Number.isFinite(args.httpStatus)
            ? Math.max(0, Math.floor(args.httpStatus))
            : null;
        const jobId = String(args.jobId || "").trim() || null;
        const requestId = String(args.requestId || "").trim() || null;
        const body = getEditPlanFailureFriendlyMessage(code, args.body || null);
        const retryPrompt = String(args.retryPrompt || "").trim() || String(lastEditPlanPromptRef.current || "").trim() || null;
        const retryCurrentPath = typeof args.retryCurrentPath === "string" ? (args.retryCurrentPath.trim() || null) : null;

        const dedupeKey = [
            body,
            code || "",
            jobStatus || "",
            String(httpStatus || ""),
            jobId || "",
            requestId || "",
        ].join("|");
        if (editPlanFailureSurfaceKeyRef.current === dedupeKey) return;
        editPlanFailureSurfaceKeyRef.current = dedupeKey;

        setEditPlanApplyLoaderMessage(null);
        setEditPlanApplyStatusMessage("Could not apply changes");
        setEditPlanApplyError([
            body,
            requestId ? `Request ID: ${requestId}` : null,
            jobId ? `Job ID: ${jobId}` : null,
        ].filter(Boolean).join("\n"));

        setMessages((prev) => [
            ...prev,
            {
                id: `edit_plan_failure_${Date.now()}`,
                role: "assistant",
                content: body,
                timestamp: new Date(),
                type: "text",
                editPlanFailure: true,
                editPlanFailureCode: code || undefined,
                editPlanFailureJobId: jobId || undefined,
                editPlanFailureRequestId: requestId || undefined,
                editPlanFailureHttpStatus: httpStatus ?? undefined,
                editPlanRetryPrompt: args.retryable ? (retryPrompt || "Retry apply") : undefined,
                editPlanRetryCurrentPath: retryCurrentPath,
                editPlanRebuildPrompt: args.suggestRebuild === true,
            },
        ]);

        dispatchAiAgentEvent("edit_plan_failure_shown", {
            code,
            jobStatus,
            httpStatus,
            jobId,
            requestId,
            retryable: args.retryable,
        });
    }, [dispatchAiAgentEvent]);

    const withCsrfHeaders = useCallback(async () => {
        let csrf: string | null = null;
        try {
            const res = await fetch("/api/auth/csrf", {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                cache: "no-store",
            });
            if (res.ok) {
                const data = await res.json().catch(() => null);
                csrf = data?.csrf || null;
            }
        } catch (error) {
            console.warn("Failed to fetch CSRF token:", error);
        }

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (csrf) headers["x-csrf"] = String(csrf);
        return headers;
    }, []);

    const formatChatRestorePointTime = useCallback((value: string | null | undefined): string => {
        if (!value) return "Unknown time";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Unknown time";
        return date.toLocaleString();
    }, []);

    const fetchChatRestorePoints = useCallback(async (opts?: { silent?: boolean; limit?: number }): Promise<{ ok: boolean; points: ChatEmbeddingRestorePoint[]; endpointMissing?: boolean }> => {
        const silent = opts?.silent === true;
        const limit = Math.min(50, Math.max(1, Math.floor(Number(opts?.limit ?? 20) || 20)));

        if (!silent) setChatRestorePointsLoading(true);
        setChatRestorePointsError(null);
        setChatRestorePointsRequestId(null);

        try {
            const headers = await withCsrfHeaders();
            const endpoint = `/api/app-builder/${encodeURIComponent(appId)}/restore-points?limit=${limit}`;
            const res = await fetch(endpoint, {
                method: "GET",
                headers,
                credentials: "include",
                cache: "no-store",
            });
            const data = await res.json().catch(() => ({} as any));
            const requestId = typeof data?.requestId === "string" ? data.requestId : null;
            setChatRestorePointsRequestId(requestId);

            if (res.status === 401) {
                setChatRestorePointsError("Session expired. Please sign in again.");
                return { ok: false, points: [] };
            }

            if (!res.ok || data?.ok === false) {
                const endpointMissing = isRestorePointListEndpointMissing({
                    status: res.status,
                    code: data?.code,
                });

                if (endpointMissing) {
                    const auditPrompt = buildRestorePointEndpointAuditPrompt({
                        endpoint,
                        appId,
                        status: res.status,
                        requestId,
                        expectedResponseShape: {
                            ok: true,
                            restorePoints: [
                                {
                                    restorePointId: "string",
                                    requestId: "string",
                                    reason: "string",
                                    createdAt: "string|null",
                                    updatedAt: "string|null",
                                    fileCount: "number",
                                    touchedPaths: ["string"],
                                    skippedPaths: ["string"],
                                    restorable: "boolean",
                                },
                            ],
                        },
                    });
                    console.warn("[restore-point-endpoint-missing]", auditPrompt);
                    setChatRestorePointsError("Couldn’t load the latest restore point right now. Please retry.");
                    return { ok: false, points: [], endpointMissing: true };
                }

                setChatRestorePointsError(buildChatRestorePointsErrorMessage({
                    status: res.status,
                    code: data?.code,
                    error: data?.error,
                    requestId,
                }));
                return { ok: false, points: [] };
            }

            const points = normalizeChatRestorePoints(data);
            setChatRestorePoints(points);
            return { ok: true, points };
        } catch {
            setChatRestorePointsError("Couldn’t load the latest restore point right now. Please retry.");
            return { ok: false, points: [] };
        } finally {
            setChatRestorePointsLoading(false);
        }
    }, [appId, withCsrfHeaders]);

    const pushRestorePointsCardMessage = useCallback((reason: string) => {
        const normalizedReason = String(reason || "").trim() || "update";
        const cardKey = `${normalizedReason}:${Math.floor(Date.now() / 10_000)}`;
        if (chatRestorePointsCardKeyRef.current === cardKey) return;
        chatRestorePointsCardKeyRef.current = cardKey;

        setMessages((prev) => [
            ...prev,
            {
                id: `restore_points_card_${Date.now()}`,
                role: "assistant",
                    content: "Restore point saved, tap undo to revert if you don't like the change.",
                timestamp: new Date(),
                type: "text",
                restorePointsCard: true,
                restorePointsCardReason: normalizedReason,
            },
        ]);
    }, []);

    const showRestorePointsCard = useCallback(async (reason: string): Promise<{ cardVisible: boolean; hasLatestRestorePoint: boolean }> => {
        pushRestorePointsCardMessage(reason);
        const fetchResult = await fetchChatRestorePoints({ silent: false, limit: 20 });
        return {
            cardVisible: fetchResult.ok,
            hasLatestRestorePoint: fetchResult.ok && fetchResult.points.length > 0,
        };
    }, [fetchChatRestorePoints, pushRestorePointsCardMessage]);

    const revertChatRestorePoint = useCallback(async (restorePointId: string) => {
        const id = String(restorePointId || "").trim();
        if (!id) return;
        if (chatRestorePointRevertingId) return;

        setChatRestorePointRevertingId(id);
        setChatRestorePointsError(null);
        try {
            const headers = await withCsrfHeaders();
            const endpoint = `/api/app-builder/${encodeURIComponent(appId)}/restore-points/${encodeURIComponent(id)}/apply`;
            const res = await fetch(endpoint, {
                method: "POST",
                headers,
                credentials: "include",
                cache: "no-store",
                body: JSON.stringify({}),
            });
            const data = await res.json().catch(() => ({} as any));
            const requestId = typeof data?.requestId === "string" ? data.requestId : null;

            if (res.status === 401) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `restore_points_auth_${Date.now()}`,
                        role: "assistant",
                        content: "Session expired. Please sign in again to continue reverting restore points.",
                        timestamp: new Date(),
                        type: "text",
                    },
                ]);
                return;
            }

            if (!res.ok || data?.ok === false) {
                const code = String(data?.code || "").trim().toUpperCase();
                if (isRestorePointListEndpointMissing({ status: res.status, code })) {
                    const auditPrompt = buildRestorePointEndpointAuditPrompt({
                        endpoint,
                        appId,
                        status: res.status,
                        requestId,
                        expectedResponseShape: {
                            ok: true,
                            applied: "number",
                            newRestorePointId: "string",
                        },
                    });
                    console.warn("[restore-point-apply-endpoint-missing]", auditPrompt);
                    setChatRestorePointsError("Couldn’t revert this restore point right now. Please retry.");
                    return;
                }

                if (res.status === 404 || code === "RESTORE_POINT_NOT_FOUND") {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `restore_points_missing_${Date.now()}`,
                            role: "assistant",
                            content: "That restore point is no longer available. I refreshed the list.",
                            timestamp: new Date(),
                            type: "text",
                        },
                    ]);
                    void fetchChatRestorePoints({ silent: false, limit: 20 });
                    return;
                }

                if (res.status === 409 || code === "RESTORE_POINT_NOT_RESTORABLE") {
                    const message = buildChatRestorePointsErrorMessage({
                        status: res.status,
                        code,
                        error: data?.error,
                        requestId,
                    });
                    setChatRestorePointsError(message);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `restore_points_not_restorable_${Date.now()}`,
                            role: "assistant",
                            content: message,
                            timestamp: new Date(),
                            type: "text",
                        },
                    ]);
                    return;
                }

                const withReq = buildChatRestorePointsErrorMessage({
                    status: res.status,
                    code,
                    error: data?.error,
                    requestId,
                });
                setChatRestorePointsError(withReq);
                if (res.status >= 500) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `restore_points_server_error_${Date.now()}`,
                            role: "assistant",
                            content: `Restore point revert failed on the server. Please retry.${requestId ? ` Request ID: ${requestId}` : ""}`,
                            timestamp: new Date(),
                            type: "text",
                        },
                    ]);
                }
                return;
            }

            const applied = Number.isFinite(Number(data?.applied)) ? Math.max(0, Math.floor(Number(data.applied))) : 0;
            const requiresRestart = data?.requiresRestart === true;
            const requiresRebuild = data?.requiresRebuild === true;

            // False-positive guard: applied must be > 0 for a meaningful revert.
            // The API returns applied=1 even for a single file, so trust it.
            const successMessage = buildChatRestorePointRevertSuccessMessage({
                applied,
                requiresRestart,
                requiresRebuild,
                requestId,
            });

            setMessages((prev) => [
                ...prev,
                {
                    id: `restore_points_reverted_${Date.now()}`,
                    role: "assistant",
                    content: successMessage,
                    timestamp: new Date(),
                    type: "text",
                },
            ]);

            // Trigger preview refresh so the reverted files are visible.
            if (typeof window !== "undefined") {
                window.dispatchEvent(
                    new CustomEvent("kloner:preview-force-fresh", {
                        detail: { appId, reason: "restore-point-revert" },
                    }),
                );
            }

            await fetchChatRestorePoints({ silent: false, limit: 20 });
            pushRestorePointsCardMessage("after_revert");
        } catch {
            setChatRestorePointsError("Could not revert this restore point. Please retry.");
        } finally {
            setChatRestorePointRevertingId(null);
        }
    }, [appId, chatRestorePointRevertingId, fetchChatRestorePoints, pushRestorePointsCardMessage, withCsrfHeaders]);

    const submitSummaryFeedback = useCallback(async (message: Message, vote: "up" | "down") => {
        const messageId = String(message.id || "").trim();
        if (!messageId) return;
        if (vote === "up") {
            setSummaryFeedbackStateByMessageId((prev) => ({ ...prev, [messageId]: "up" }));
            return;
        }

        setSummaryFeedbackStateByMessageId((prev) => ({ ...prev, [messageId]: "sending" }));
        try {
            const headers = await withCsrfHeaders();
            const res = await fetch("/api/support/summary-feedback", {
                method: "POST",
                headers,
                credentials: "include",
                cache: "no-store",
                body: JSON.stringify({
                    appId,
                    messageId,
                    summary: String(message.content || "").trim(),
                    feedback: "down",
                    context: message.summaryFeedbackContext || latestSummaryFeedbackContextRef.current || null,
                }),
            });
            const data = await res.json().catch(() => ({} as any));
            if (!res.ok || data?.ok === false) {
                throw new Error(String(data?.error || "Failed to submit feedback."));
            }
            setSummaryFeedbackStateByMessageId((prev) => ({ ...prev, [messageId]: "down" }));
            setMessages((prev) => [
                ...prev,
                {
                    id: `summary_feedback_thanks_${Date.now()}`,
                    role: "assistant",
                    content: "Thanks, this was sent to support for review.",
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
        } catch {
            setSummaryFeedbackStateByMessageId((prev) => ({ ...prev, [messageId]: "error" }));
            setMessages((prev) => [
                ...prev,
                {
                    id: `summary_feedback_error_${Date.now()}`,
                    role: "assistant",
                    content: "Could not send feedback right now. Please try again.",
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
        }
    }, [appId, withCsrfHeaders]);

    useEffect(() => {
        if (!previewReady) return;
        const statusText = String(editPlanApplyStatusMessage || "").trim().toLowerCase();
        if (!statusText) return;

        const looksSettled =
            statusText.includes("preview was refreshed") ||
            statusText.includes("preview is refreshing") ||
            statusText.includes("website was updated") ||
            statusText.includes("restart") ||
            statusText.includes("rebuild");
        if (!looksSettled) return;

        const signal = `${statusText}:${Math.floor(Date.now() / 30_000)}`;
        if (chatRestorePointsStableSignalRef.current === signal) return;
        chatRestorePointsStableSignalRef.current = signal;
        showRestorePointsCard("after_restart_stable");
    }, [editPlanApplyStatusMessage, previewReady, showRestorePointsCard]);

    const startCreditTopup = useCallback(async (credits: number) => {
        if (topupBusy) return;
        if (typeof window === "undefined") return;

        const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

        const creditsInt = Number.isFinite(credits) ? Math.max(1, Math.floor(credits)) : 0;
        if (!creditsInt) return;

        setTopupBusy(true);
        try {
            const idToken = await user?.getIdToken?.().catch(() => null);
            if (!idToken) {
                const loginUrl = `/login?next=${encodeURIComponent(nextPath)}`;
                await showAlert("Your session expired. Please sign in again to continue checkout.", "Sign in required");
                const loginWindow = window.open(loginUrl, "_blank", "noopener,noreferrer");
                if (!loginWindow) {
                    window.location.href = loginUrl;
                }
                return;
            }

            await ensureSessionAndCsrf().catch(() => null);
            const headers = await withCsrfHeaders();
            headers.Authorization = `Bearer ${idToken}`;

            const response = await fetch("/api/billing/create-credit-topup-session", {
                method: "POST",
                headers,
                credentials: "include",
                body: JSON.stringify({ credits: creditsInt, next: nextPath }),
            });

            const data = (await response.json().catch(() => ({}))) as any;

            if (response.status === 401) {
                const loginUrl = `/login?next=${encodeURIComponent(nextPath)}`;
                await showAlert("Your session expired. Please sign in again to continue checkout.", "Sign in required");
                const loginWindow = window.open(loginUrl, "_blank", "noopener,noreferrer");
                if (!loginWindow) {
                    window.location.href = loginUrl;
                }
                return;
            }

            if (!response.ok || !data?.url) {
                throw new Error(typeof data?.error === "string" && data.error ? data.error : "Could not start the Stripe checkout session.");
            }

            window.location.href = data.url;
        } catch (error) {
            console.error("Failed to start top-up checkout", error);
            await showAlert("We couldn’t start checkout right now. Please try again.", "Top up");
        } finally {
            setTopupBusy(false);
        }
    }, [showAlert, topupBusy, user?.getIdToken, withCsrfHeaders]);

    useEffect(() => {
        if (typeof window === "undefined" || !appId) return;
        const storageKey = buildEditPlanJobStorageKey(appId);
        const raw = window.localStorage.getItem(storageKey) || window.sessionStorage.getItem(storageKey);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            const job = normalizeEmbeddingEditPlanJobStatus(parsed);
            const activeJob = isActiveEditPlanJobStatus(job.status) && job.statusUrl ? job : null;
            if (activeJob) {
                setActiveEditPlanJob(activeJob);
            } else {
                safeRemoveStorageItem(storageKey);
            }
        } catch {
            safeRemoveStorageItem(storageKey);
        }
    }, [appId]);

    useEffect(() => {
        if (typeof window === "undefined" || !appId) return;
        const storageKey = buildEditPlanJobStorageKey(appId);
        if (activeEditPlanJob && activeEditPlanJob.statusUrl) {
            if (isActiveEditPlanJobStatus(activeEditPlanJob.status)) {
                safeSetStorageItem(storageKey, JSON.stringify(buildEditPlanJobStorageSnapshot(activeEditPlanJob)));
            } else {
                safeRemoveStorageItem(storageKey);
            }
        } else {
            safeRemoveStorageItem(storageKey);
        }
    }, [activeEditPlanJob, appId]);

    useEffect(() => {
        return () => {
            if (editPlanJobPollTimerRef.current) {
                clearTimeout(editPlanJobPollTimerRef.current);
                editPlanJobPollTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!activeEditPlanJob?.statusUrl || !isActiveEditPlanJobStatus(activeEditPlanJob.status)) return;

        const jobStatusUrl = activeEditPlanJob.statusUrl;
        const jobKey = activeEditPlanJob.jobId || activeEditPlanJob.requestId || jobStatusUrl;
        const requestMeta = editPlanJobRequestMetaRef.current[jobKey]
            || editPlanJobRequestMetaRef.current[`status:${jobStatusUrl}`]
            || (activeEditPlanJob.requestId ? editPlanJobRequestMetaRef.current[`req:${activeEditPlanJob.requestId}`] : undefined)
            || (activeEditPlanJob.jobId ? editPlanJobRequestMetaRef.current[activeEditPlanJob.jobId] : undefined)
            || latestInquiryMetaRef.current
            || null;
        const pollElapsedMs = Math.max(0, Date.now() - Math.max(0, Number(requestMeta?.requestedAt) || Date.now()));
        if (pollElapsedMs >= 120_000) {
            const timeoutCode = "JOB_LOOKUP_TIMEOUT";
            const timeoutMessage = "Edit plan timed out while waiting for a terminal result. Please retry.";
            const timedOutJob = {
                ...activeEditPlanJob,
                status: "failed",
                stage: "failed",
                error: {
                    code: timeoutCode,
                    message: timeoutMessage,
                    retryAfterSeconds: null,
                },
            } as AppEmbeddingEditPlanJobStatus;
            setActiveEditPlanJob(timedOutJob);
            surfaceEditPlanFailure({
                body: timeoutMessage,
                code: timeoutCode,
                jobStatus: "failed",
                httpStatus: null,
                jobId: activeEditPlanJob.jobId || null,
                requestId: activeEditPlanJob.requestId || null,
                retryable: true,
                retryPrompt: requestMeta?.query || lastEditPlanPromptRef.current || null,
                retryCurrentPath: requestMeta?.currentPath || null,
            });
            editPlanJobVersionRef.current += 1;
            return;
        }

        const pollVersion = ++editPlanJobVersionRef.current;
        const signature = [
            activeEditPlanJob.status,
            activeEditPlanJob.stage || "",
            activeEditPlanJob.progress ?? "",
            activeEditPlanJob.queueAgeSeconds ?? "",
            activeEditPlanJob.queuedForSeconds ?? "",
            activeEditPlanJob.runningForSeconds ?? "",
            activeEditPlanJob.workerId || "",
            activeEditPlanJob.attemptCount ?? "",
        ].join("|");
        if (signature === editPlanJobStableSignatureRef.current) {
            editPlanJobStableReadsRef.current += 1;
        } else {
            editPlanJobStableSignatureRef.current = signature;
            editPlanJobStableReadsRef.current = 0;
        }

        const baseDelayMs = getEditPlanPollCadenceMs(pollElapsedMs);
        const delayOverrideMs = editPlanJobPollDelayOverrideMsRef.current;
        const delayMs = typeof delayOverrideMs === "number" && Number.isFinite(delayOverrideMs)
            ? Math.max(baseDelayMs, Math.max(250, Math.floor(delayOverrideMs)))
            : baseDelayMs;
        editPlanJobPollDelayOverrideMsRef.current = null;

        editPlanJobPollTimerRef.current = window.setTimeout(() => {
            void (async () => {
                const result = await fetchEmbeddingEditPlanJobStatus(jobStatusUrl, {});
                if (pollVersion !== editPlanJobVersionRef.current) return;

                if (!result.ok || !result.data) {
                    const statusCode = result.status;
                    const failureCount = editPlanJobFetchFailureCountRef.current + 1;
                    editPlanJobFetchFailureCountRef.current = failureCount;
                    const retryAfterSeconds = getEditPlanRetryAfterSeconds(result);
                    const retryAfterMs = typeof retryAfterSeconds === "number" ? Math.max(0, Math.ceil(retryAfterSeconds * 1000)) : null;
                    const code = String(result.code || "").trim().toUpperCase();

                    if (statusCode === 409) {
                        const contractFailureMessage = getEditPlanFailureFriendlyMessage(code, result.error || null);
                        const resolvedContractCode = code || "EDIT_PLAN_APPLY_FAILURE_MISSING_CODE_AND_REASON";
                        const contractFailedJob = {
                            ...activeEditPlanJob,
                            status: "failed",
                            stage: "failed",
                            error: {
                                code: resolvedContractCode,
                                message: contractFailureMessage,
                                retryAfterSeconds,
                            },
                        } as AppEmbeddingEditPlanJobStatus;
                        setActiveEditPlanJob(contractFailedJob);
                        surfaceEditPlanFailure({
                            body: contractFailureMessage,
                            code: resolvedContractCode,
                            jobStatus: "failed",
                            httpStatus: statusCode,
                            jobId: activeEditPlanJob.jobId || null,
                            requestId: activeEditPlanJob.requestId || null,
                            retryable: true,
                            retryPrompt: requestMeta?.query || lastEditPlanPromptRef.current || null,
                            retryCurrentPath: requestMeta?.currentPath || null,
                        });
                        editPlanJobVersionRef.current += 1;
                        return;
                    }

                    const isTransientStatus = statusCode === 0 || statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504;
                    const isBackpressure = code === "EMBEDDING_EDIT_PLAN_BACKPRESSURE" || code === "JOB_RATE_LIMITED" || statusCode === 429;
                    const shouldRetry = isTransientStatus || isBackpressure;

                    if (shouldRetry && failureCount <= 10) {
                        const exponentialBackoffMs = Math.min(12_000, 1_000 * (2 ** Math.min(failureCount - 1, 4)));
                        editPlanJobPollDelayOverrideMsRef.current = retryAfterMs !== null
                            ? Math.max(exponentialBackoffMs, retryAfterMs)
                            : exponentialBackoffMs;
                        setActiveEditPlanJob((current) => (current ? { ...current } : current));
                        return;
                    }

                    const terminalError =
                        statusCode === 403
                            ? { code: "JOB_FORBIDDEN", message: result.error || "You do not have access to this job.", retryAfterSeconds: null }
                            : statusCode === 404
                                ? { code: "JOB_NOT_FOUND", message: result.error || "We could not find this job.", retryAfterSeconds: null }
                                : failureCount >= 4
                                    ? {
                                        code: result.code || (statusCode === 429 ? "JOB_RATE_LIMITED" : statusCode === 503 ? "JOB_BACKLOG" : statusCode === 504 ? "JOB_TIMEOUT" : "JOB_STATUS_FAILED"),
                                        message: result.error || "We couldn’t refresh this edit-plan job.",
                                        retryAfterSeconds,
                                    }
                                    : null;
                    if (!terminalError) {
                        setActiveEditPlanJob((current) => (current ? { ...current } : current));
                        return;
                    }

                    setActiveEditPlanJob({
                        ...activeEditPlanJob,
                        status: "failed",
                        stage: "failed",
                        error: terminalError,
                    });
                    surfaceEditPlanFailure({
                        body: terminalError.message,
                        code: terminalError.code,
                        jobStatus: "failed",
                        httpStatus: statusCode,
                        jobId: activeEditPlanJob.jobId || null,
                        requestId: activeEditPlanJob.requestId || null,
                        retryable: true,
                        retryPrompt: requestMeta?.query || lastEditPlanPromptRef.current || null,
                        retryCurrentPath: requestMeta?.currentPath || null,
                    });
                    editPlanJobVersionRef.current += 1;
                    return;
                }

                editPlanJobFetchFailureCountRef.current = 0;
                const nextJob = normalizeEmbeddingEditPlanJobStatus(result.data);
                const retryAfterSeconds = getEditPlanRetryAfterSeconds(result);
                if (typeof retryAfterSeconds === "number") {
                    editPlanJobPollDelayOverrideMsRef.current = Math.max(0, Math.ceil(retryAfterSeconds * 1000));
                }
                const nextJobWithIds = {
                    ...nextJob,
                    enqueueRequestId: (activeEditPlanJob as any)?.enqueueRequestId || activeEditPlanJob.requestId || null,
                    jobRequestId: nextJob.requestId || null,
                } as AppEmbeddingEditPlanJobStatus;
                setActiveEditPlanJob(nextJobWithIds);

                if (isEditPlanJobTerminalStatus(nextJobWithIds.status)) {
                    if (nextJobWithIds.status === "completed") {
                        // Check if restart is still pending — keep polling until confirmed.
                        const rawApply = (nextJobWithIds.result as any)?.apply ?? (nextJobWithIds.job?.result as any)?.apply ?? null;
                        if (rawApply && typeof rawApply === "object") {
                            const restartStillPending = (rawApply as any).restartPending === true && (rawApply as any).restartConfirmed !== true;
                            if (restartStillPending) {
                                const awaitJobId = nextJobWithIds.jobId || nextJobWithIds.requestId || null;
                                if (awaitJobId && editPlanRestartPendingEmittedJobIdRef.current !== awaitJobId) {
                                    editPlanRestartPendingEmittedJobIdRef.current = awaitJobId;
                                    setEditPlanApplyStatusMessage(buildApplyStateMessage("restart_pending", rawApply));
                                }
                                // Synthetic active status keeps the polling effect alive.
                                setActiveEditPlanJob({ ...nextJobWithIds, status: "awaiting_restart", stage: "awaiting_restart" });
                                // Do NOT increment editPlanJobVersionRef — allow polling to continue.
                                return;
                            }
                        }

                        const completedProposal = extractCompletedEditPlanProposal(nextJobWithIds);
                        if (!completedProposal) {
                            setActiveEditPlanJob({
                                ...nextJobWithIds,
                                status: "failed",
                                stage: "failed",
                                error: {
                                    code: "JOB_RESULT_MISSING",
                                    message: "The job finished, but the edit plan payload was missing.",
                                    retryAfterSeconds: null,
                                },
                            });
                            surfaceEditPlanFailure({
                                body: "The job finished, but the proposal payload was missing.",
                                code: "JOB_RESULT_MISSING",
                                jobStatus: "failed",
                                httpStatus: result.status,
                                jobId: nextJobWithIds.jobId || activeEditPlanJob.jobId || null,
                                requestId: nextJobWithIds.requestId || activeEditPlanJob.requestId || null,
                                retryable: true,
                                retryPrompt: requestMeta?.query || lastEditPlanPromptRef.current || null,
                                retryCurrentPath: requestMeta?.currentPath || null,
                            });
                            editPlanJobVersionRef.current += 1;
                            return;
                        }

                        setPendingEditPlan(completedProposal);
                        setEditPlanApplyError(null);
                        setEditPlanApplyStatusMessage(
                            completedProposal.needsMoreContext || !Array.isArray(completedProposal.files) || completedProposal.files.length === 0
                                ? "The worker needs more context before I can continue. Try providing more details or files to help the worker complete your change request."
                                : completedProposal.autoApplyAllowed === false
                                    ? "Proposal ready for review."
                                    : "I’m uploading the changes now.",
                        );
                        editPlanJobVersionRef.current += 1;
                        return;
                    }

                    if (nextJobWithIds.status === "expired") {
                        setActiveEditPlanJob(nextJobWithIds);
                        surfaceEditPlanFailure({
                            body: nextJobWithIds.error && typeof nextJobWithIds.error === "object" && typeof nextJobWithIds.error.message === "string"
                                ? nextJobWithIds.error.message
                                : typeof nextJobWithIds.error === "string"
                                    ? nextJobWithIds.error
                                    : "The job expired before it could finish.",
                            code: nextJobWithIds.error && typeof nextJobWithIds.error === "object" && typeof nextJobWithIds.error.code === "string"
                                ? nextJobWithIds.error.code
                                : "JOB_EXPIRED",
                            jobStatus: "expired",
                            httpStatus: result.status,
                            jobId: nextJobWithIds.jobId || activeEditPlanJob.jobId || null,
                            requestId: nextJobWithIds.requestId || activeEditPlanJob.requestId || null,
                            retryable: true,
                            retryPrompt: requestMeta?.query || lastEditPlanPromptRef.current || null,
                            retryCurrentPath: requestMeta?.currentPath || null,
                        });
                        editPlanJobVersionRef.current += 1;
                        return;
                    }

                    if (isEditPlanJobExpiredByQueueAge(nextJobWithIds)) {
                        const queuedAgeSeconds = getEditPlanJobQueueAgeSeconds(nextJobWithIds);
                        const expiredJob = {
                            ...nextJobWithIds,
                            status: "expired",
                            stage: "expired",
                            error: {
                                code: "JOB_QUEUE_TIMEOUT",
                                message: queuedAgeSeconds !== null
                                    ? `This job waited in queue for ${Math.floor(queuedAgeSeconds / 60)} minutes and expired before it could be picked up.`
                                    : "This job waited in queue too long and expired before it could be picked up.",
                                retryAfterSeconds: null,
                            },
                        } as AppEmbeddingEditPlanJobStatus;
                        setActiveEditPlanJob(expiredJob);
                        surfaceEditPlanFailure({
                            body: expiredJob.error && typeof expiredJob.error === "object" && typeof expiredJob.error.message === "string"
                                ? expiredJob.error.message
                                : "This job expired before it could be picked up.",
                            code: "JOB_QUEUE_TIMEOUT",
                            jobStatus: "expired",
                            httpStatus: result.status,
                            jobId: nextJobWithIds.jobId || activeEditPlanJob.jobId || null,
                            requestId: nextJobWithIds.requestId || activeEditPlanJob.requestId || null,
                            retryable: true,
                            retryPrompt: requestMeta?.query || lastEditPlanPromptRef.current || null,
                            retryCurrentPath: requestMeta?.currentPath || null,
                        });
                        editPlanJobVersionRef.current += 1;
                        return;
                    }

                    if (nextJobWithIds.status === "failed") {
                        setActiveEditPlanJob(nextJobWithIds);
                        const failedCode = nextJobWithIds.error && typeof nextJobWithIds.error === "object" && typeof nextJobWithIds.error.code === "string"
                            ? nextJobWithIds.error.code.toUpperCase()
                            : null;
                        const retryInfo = extractJobApplyRetryInfo(nextJobWithIds);
                        const attemptSuffix = retryInfo.attempt !== null && retryInfo.maxAttempts !== null
                            ? ` Failed after ${retryInfo.attempt}/${retryInfo.maxAttempts} apply attempts.`
                            : "";
                        const failedMessage = nextJobWithIds.error && typeof nextJobWithIds.error === "object" && typeof nextJobWithIds.error.message === "string"
                            ? nextJobWithIds.error.message
                            : typeof nextJobWithIds.error === "string"
                                ? nextJobWithIds.error
                                : getEditPlanFailureFriendlyMessage(failedCode, "Edit plan failed. Please retry.");
                        const finalFailureMessage = `${failedMessage}${attemptSuffix}`.trim();
                        surfaceEditPlanFailure({
                            body: finalFailureMessage,
                            code: failedCode,
                            jobStatus: "failed",
                            httpStatus: result.status,
                            jobId: nextJobWithIds.jobId || activeEditPlanJob.jobId || null,
                            requestId: nextJobWithIds.requestId || activeEditPlanJob.requestId || null,
                            retryable: true,
                            retryPrompt: requestMeta?.query || lastEditPlanPromptRef.current || null,
                            retryCurrentPath: requestMeta?.currentPath || null,
                            suggestRebuild: shouldSuggestRebuildFromFailure(failedCode, finalFailureMessage),
                        });
                        editPlanJobVersionRef.current += 1;
                        return;
                    }
                }
            })().catch((err) => {
                if (pollVersion !== editPlanJobVersionRef.current) return;
                surfaceEditPlanFailure({
                    body: String(err?.message || "Failed to refresh edit-plan job status."),
                    code: "JOB_LOOKUP_FAILED",
                    jobStatus: activeEditPlanJob.status,
                    httpStatus: null,
                    jobId: activeEditPlanJob.jobId || null,
                    requestId: activeEditPlanJob.requestId || null,
                    retryable: true,
                    retryPrompt: requestMeta?.query || lastEditPlanPromptRef.current || null,
                    retryCurrentPath: requestMeta?.currentPath || null,
                });
            });
        }, delayMs);

        return () => {
            if (editPlanJobPollTimerRef.current) {
                clearTimeout(editPlanJobPollTimerRef.current);
                editPlanJobPollTimerRef.current = null;
            }
        };
    }, [activeEditPlanJob, surfaceEditPlanFailure]);

    useEffect(() => {
        if (allowDatabaseSetupUi) return;
        // Hard-disable any DB setup UI in production.
        setShowDatabaseSetup(false);
        setShowSupabaseSetup(false);
    }, [allowDatabaseSetupUi]);

    useEffect(() => {
        const onOpen = (ev: Event) => {
            if (!allowDatabaseSetupUi) return;
            const detail = (ev as CustomEvent<any>)?.detail || {};
            const provider = String(detail?.provider || "supabase").toLowerCase();
            if (provider !== "supabase") return;

            // If Supabase is already connected, do NOT show the connect modal or database setup modal.
            if (isSupabaseConnected) {
                setShowDatabaseSetup(false);
                setShowSupabaseAdvanced(false);
                setShowSupabaseSetup(false);
                return;
            }
            setShowDatabaseSetup(false);
            setShowSupabaseAdvanced(false);
            setShowSupabaseSetup(true);
        };

        window.addEventListener("kloner:open-db-connect", onOpen as EventListener);
        return () => window.removeEventListener("kloner:open-db-connect", onOpen as EventListener);
    }, [allowDatabaseSetupUi, isSupabaseConnected]);

    const refreshSupabaseStatusFromApi = useCallback(async (): Promise<boolean> => {
        try {
            const url = appId
                ? `/api/supabase/project-status?appId=${encodeURIComponent(appId)}`
                : "/api/supabase/project-status";
            const res = await fetch(url, {
                method: "GET",
                cache: "no-store",
                credentials: "include",
            });

            if (!res.ok) return false;

            const data: any = await res.json().catch(() => null);
            const connected = !!(data && data.completed && data.ok);

            setIsSupabaseConnected(connected);
            if (connected) {
                const name = typeof data?.project?.name === "string" && data.project.name.trim() ? data.project.name.trim() : null;
                const ref =
                    (typeof data?.project?.ref === "string" && data.project.ref.trim() ? data.project.ref.trim() : null) ||
                    (typeof data?.project?.id === "string" && data.project.id.trim() ? data.project.id.trim() : null);
                setSupabaseProjectName(name);
                setSupabaseProjectRef(ref);
            } else {
                setSupabaseProjectName(null);
                setSupabaseProjectRef(null);
                setSupabaseDbReachable(null);
                setSupabaseDbReason(null);
                setSupabaseDbStatusText(null);
                setSupabaseDbLastCheckedAt(null);
            }

            return connected;
        } catch {
            // Network/offline: do not spam logs; just treat as disconnected.
            setIsSupabaseConnected(false);
            setSupabaseProjectName(null);
            setSupabaseProjectRef(null);
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText(null);
            setSupabaseDbLastCheckedAt(null);
            return false;
        }
    }, []);

    useEffect(() => {
        if (!user?.uid) {
            setIsSupabaseConnected(false);
            setSupabaseProjectName(null);
            setSupabaseProjectRef(null);
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText(null);
            setSupabaseDbLastCheckedAt(null);
            return;
        }

        // If DB setup UI is disabled, don't even check status.
        if (!allowDatabaseSetupUi) {
            setIsSupabaseConnected(false);
            setSupabaseProjectName(null);
            setSupabaseProjectRef(null);
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText(null);
            setSupabaseDbLastCheckedAt(null);
            return;
        }

        let cancelled = false;
        void refreshSupabaseStatusFromApi();

        // Lightweight polling so we update after OAuth completes.
        const t = window.setInterval(() => {
            if (cancelled) return;
            void refreshSupabaseStatusFromApi();
        }, 20_000);

        return () => {
            cancelled = true;
            window.clearInterval(t);
        };
    }, [user?.uid, allowDatabaseSetupUi, refreshSupabaseStatusFromApi]);

    useEffect(() => {
        isSupabaseConnectedRef.current = isSupabaseConnected;
    }, [isSupabaseConnected]);

    useEffect(() => {
        // Self-heal: if the user becomes connected while the modal is open, close it.
        if (!isSupabaseConnected) return;
        setShowDatabaseSetup(false);
        setShowSupabaseSetup(false);
        setShowSupabaseAdvanced(false);
    }, [isSupabaseConnected]);

    useEffect(() => {
        setIsHydrated(true);
    }, []);

    useEffect(() => {
        if (!user?.uid) return;

        const userRef = doc(db, "kloner_users", user.uid);
        let unsub: null | (() => void) = null;

        try {
            unsub = onSnapshot(
                userRef,
                (snap) => {
                    const data = snap.exists() ? (snap.data() as any) : null;
                    const bucket = data?.["credits.aiEdits"] || data?.credits?.aiEdits || null;
                    const remaining = typeof bucket?.remaining === "number" ? bucket.remaining : null;
                    setAiCreditsRemaining(Number.isFinite(remaining) ? remaining : null);
                },
                (err) => {
                    console.error("Firestore listener error (ai edits credits)", err);
                    // If Firestore read fails (rules/offline), don't block usage.
                    setAiCreditsRemaining(null);
                },
            );
        } catch (err) {
            console.error("Failed to subscribe to ai edits credits (Firestore)", err);
            setAiCreditsRemaining(null);
        }

        return () => {
            if (!unsub) return;
            try {
                unsub();
            } catch (err) {
                console.warn("Firestore unsubscribe error (ai edits credits)", err);
            }
        };
    }, [user?.uid]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = useCallback(() => {
        if (!messagesEndRef.current) return;

        messagesEndRef.current.scrollIntoView({
            behavior: "auto",
            block: "end",
            inline: "nearest",
        });

        const container = messagesEndRef.current.parentElement;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, []);

    const latestAssistantMessageId = useMemo(() => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (messages[index]?.role === "assistant") {
                return messages[index].id;
            }
        }
        return null;
    }, [messages]);

    const loadedFromRemoteRef = useRef(false);
    const initialLoadCompletedRef = useRef(false);
    const lastSavedPayloadRef = useRef<string | null>(null);
    const debugChatIo = useCallback(() => {
        if (typeof window === "undefined") return false;
        try {
            return localStorage.getItem("kloner_debug_chat_io") === "1";
        } catch {
            return false;
        }
    }, []);

    const checkSupabaseDbHealth = useCallback(async (opts?: { silent?: boolean }) => {
        if (!user?.uid) {
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText(null);
            setSupabaseDbLastCheckedAt(null);
            return { connected: false, reachable: false, reason: "no_user" as const };
        }

        if (!isSupabaseConnectedRef.current) {
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText(null);
            setSupabaseDbLastCheckedAt(null);
            return { connected: false, reachable: false, reason: "not_connected" as const };
        }

        if (supabaseDbHealthInFlightRef.current) {
            return { connected: true, reachable: supabaseDbReachable === true, reason: "in_flight" as const };
        }

        const now = Date.now();
        if (now - lastSupabaseDbHealthAtRef.current < 10_000) {
            return { connected: true, reachable: supabaseDbReachable === true, reason: "throttled" as const };
        }

        lastSupabaseDbHealthAtRef.current = now;
        supabaseDbHealthInFlightRef.current = true;

        try {
            const headers = await withCsrfHeaders();
            const res = await fetch("/api/supabase/db-health", {
                method: "POST",
                headers,
                body: JSON.stringify({ cleanupIfDeleted: true, appId: appId || undefined }),
                cache: "no-store",
            });

            const data: any = await res.json().catch(() => null);
            setSupabaseDbLastCheckedAt(Date.now());

            if (!res.ok || !data?.ok) {
                setSupabaseDbReachable(null);
                setSupabaseDbReason(null);
                setSupabaseDbStatusText("Could not verify database reachability");
                return { connected: true, reachable: false, reason: "request_failed" as const };
            }

            if (data.connected === false) {
                setSupabaseDbReachable(false);
                setSupabaseDbReason(data?.reason || null);
                setSupabaseDbStatusText(
                    data?.reason === "project_deleted"
                        ? "Supabase project was deleted"
                        : data?.reason === "unauthorized"
                          ? "Supabase access unauthorized"
                          : "Supabase not connected",
                );
                setIsSupabaseConnected(false);
                setSupabaseProjectName(null);
                setSupabaseProjectRef(null);

                if (!opts?.silent) {
                    await showAlert(
                        data?.reason === "project_deleted"
                            ? "Your Supabase project no longer exists (it looks like it was deleted). Kloner removed the stale connection."
                            : "Supabase is not reachable right now. Please reconnect.",
                        "Database",
                    );
                }

                return { connected: false, reachable: false, reason: data?.reason || "disconnected" };
            }

            const reachable = Boolean(data.reachable);
            setSupabaseDbReachable(reachable);
            const reason = typeof data?.reason === "string" ? data.reason : "";
            setSupabaseDbReason(reachable ? null : reason || null);
            setSupabaseDbStatusText(
                reachable
                    ? "Database reachable"
                    : reason === "project_paused"
                      ? "Project is paused — resume it in the Supabase dashboard"
                      : reason === "timeout_or_network"
                        ? "Connection timed out — project may still be resuming after a pause"
                        : (typeof data?.error === "string" && data.error.trim())
                          ? data.error.trim()
                          : "Database not reachable (project may be paused or networking is blocked)",
            );
            return { connected: true, reachable, reason: reason || (reachable ? "ok" : "unreachable"), error: (typeof data?.error === "string" && data.error.trim()) ? data.error.trim() : undefined };
        } catch (e: any) {
            setSupabaseDbLastCheckedAt(Date.now());
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText("Could not verify database reachability");
            return { connected: true, reachable: false, reason: "client_error" as const, error: typeof e?.message === "string" ? e.message : undefined };
        } finally {
            supabaseDbHealthInFlightRef.current = false;
        }
    }, [showAlert, supabaseDbReachable, user?.uid, withCsrfHeaders]);

    useEffect(() => {
        if (!isSupabaseConnected) return;
        void checkSupabaseDbHealth({ silent: true });
        const id = window.setInterval(() => {
            void checkSupabaseDbHealth({ silent: true });
        }, 60_000);
        return () => window.clearInterval(id);
    }, [checkSupabaseDbHealth, isSupabaseConnected]);

    useEffect(() => {
        if (!migrationReviewMessageId) return;
        void checkSupabaseDbHealth({ silent: true });
    }, [checkSupabaseDbHealth, migrationReviewMessageId]);

    useEffect(() => {
        // Only sync envs after preview is ready
        if (!appId) return;
        if (!isSupabaseConnected) return;
        if (didSyncSupabasePreviewEnvRef.current) return;
        didSyncSupabasePreviewEnvRef.current = true;

    }, [appId, isSupabaseConnected, previewReady, withCsrfHeaders]);

    const bootstrapAppScope = useCallback(async (): Promise<boolean> => {
        // The app-scope cookie can be missing on fresh sessions (or expire ~30 min),
        // so we (re-)issue it before calling app-scoped routes.
        try {
            await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/scope`, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
            });
            return res.ok;
        } catch {
            return false;
        }
    }, [appId]);

    const notifyScopeRecoveryFailure = useCallback(
        (retryLabel: string) => {
            const now = Date.now();
            if (now - scopeRecoveryNoticeAtRef.current < 60_000) return;
            scopeRecoveryNoticeAtRef.current = now;

            const text = "This app session needs a fresh start. Please reopen the app in App Builder and try again.";
            void showAlert(text, "App connection");
            setMessages((prev) => [
                ...prev,
                {
                    id: `scope_recovery_${now}`,
                    role: "assistant",
                    content: text,
                    timestamp: new Date(),
                    type: "text",
                },
            ]);

            dispatchAiAgentEvent("app_scope_recovery", {
                appId,
                userId: user?.uid || null,
                retryLabel,
                scopeRecovered: false,
            });
        },
        [appId, dispatchAiAgentEvent, showAlert, user?.uid],
    );

    const fetchWithScopeRetry = useCallback(
        async (url: string, init: RequestInit, { retryLabel }: { retryLabel: string }): Promise<Response> => {
            const isScopeSensitiveRoute = /\/api\/app-builder\/[^/]+\/(ai-chat|restore-points)(?:\/|$)/.test(url);
            const doFetch = () =>
                fetch(url, {
                    ...init,
                    credentials: "include",
                    cache: "no-store",
                });

            if (isScopeSensitiveRoute) {
                const warmed = await bootstrapAppScope().catch(() => false);
                dispatchAiAgentEvent("app_scope_recovery", {
                    appId,
                    userId: user?.uid || null,
                    retryLabel,
                    scopeRecovered: warmed,
                    phase: "preflight",
                });
            }

            const res = await doFetch();
            if (res.status !== 403) return res;

            // If scope is missing/expired, re-issue and retry once.
            const data = await res.clone().json().catch(() => null);
            const code = String(data?.code || "").toUpperCase();
            const isScope = code === "MISSING_APP_SCOPE" || code === "INVALID_APP_SCOPE";
            if (!isScope) return res;

            const ok = await bootstrapAppScope();
            dispatchAiAgentEvent("app_scope_recovery", {
                appId,
                userId: user?.uid || null,
                retryLabel,
                scopeRecovered: ok,
                phase: "403_recover",
            });
            if (!ok) {
                notifyScopeRecoveryFailure(retryLabel);
                return res;
            }

            const retryRes = await doFetch();
            if (retryRes.status === 403) {
                console.warn(`[AppBuilderEditorAgentChat] ${retryLabel} still forbidden after scope bootstrap`);
                notifyScopeRecoveryFailure(retryLabel);
            }

            dispatchAiAgentEvent("app_scope_recovery", {
                appId,
                userId: user?.uid || null,
                retryLabel,
                scopeRecovered: retryRes.status !== 403,
                phase: "post_retry",
            });
            return retryRes;
        },
        [appId, bootstrapAppScope, dispatchAiAgentEvent, notifyScopeRecoveryFailure, user?.uid]
    );

    const scopeBootstrappedForAppIdRef = useRef<string | null>(null);
    const [scopeWarmupComplete, setScopeWarmupComplete] = useState(false);

    // Proactively issue the scope cookie once per appId to avoid noisy 403s.
    useEffect(() => {
        if (!user?.uid || !appId) {
            setScopeWarmupComplete(false);
            return;
        }

        let cancelled = false;
        setScopeWarmupComplete(false);

        const warmScope = async () => {
            if (scopeBootstrappedForAppIdRef.current !== appId) {
                scopeBootstrappedForAppIdRef.current = appId;
                await bootstrapAppScope().catch(() => false);
            }

            if (!cancelled) setScopeWarmupComplete(true);
        };

        void warmScope();

        return () => {
            cancelled = true;
        };
    }, [appId, bootstrapAppScope, user?.uid]);

    // Load chat history from server (firebase-admin) and migrate any legacy localStorage once.
    useEffect(() => {
        if (loadedFromRemoteRef.current) return;
        if (!user?.uid || !appId || !scopeWarmupComplete) return;

        let cancelled = false;
        (async () => {
            try {
                await ensureSessionAndCsrf().catch(() => null);
                const res = await fetchWithScopeRetry(
                    `/api/app-builder/${appId}/ai-chat`,
                    { method: "GET" },
                    { retryLabel: "load ai chat" },
                );
                if (cancelled) return;

                const data = res.ok ? await res.json().catch(() => null) : null;
                const stored = Array.isArray(data?.messages) ? data.messages : null;

                const toMessage = (m: any): Message | null => {
                    if (!m || typeof m !== "object") return null;
                    const id = typeof m.id === "string" ? m.id : "";
                    const role = m.role === "user" || m.role === "assistant" ? m.role : null;
                    const content = typeof m.content === "string" ? m.content : null;
                    const type = m.type === "text" || m.type === "code" || m.type === "file-edit" ? m.type : "text";
                    const ts = typeof m.timestampMs === "number" ? new Date(m.timestampMs) : (m.timestamp ? new Date(m.timestamp) : new Date());
                    if (!id || !role || content == null || Number.isNaN(ts.getTime())) return null;
                    return {
                        id,
                        role,
                        content,
                        type,
                        timestamp: ts,
                        restorePointId: typeof m.restorePointId === "string" ? m.restorePointId : undefined,
                        restoreActionLabel: typeof m.restoreActionLabel === "string" ? m.restoreActionLabel : undefined,
                        supabaseContinuationPrompt:
                            typeof m.supabaseContinuationPrompt === "string" ? m.supabaseContinuationPrompt : undefined,
                        supabaseContinuationStatus:
                            m.supabaseContinuationStatus === "PENDING" ||
                            m.supabaseContinuationStatus === "CONTINUE" ||
                            m.supabaseContinuationStatus === "DISMISS"
                                ? m.supabaseContinuationStatus
                                : undefined,
                        dbSetupPrompt: typeof m.dbSetupPrompt === "string" ? m.dbSetupPrompt : undefined,
                        dbSetupStatus:
                            m.dbSetupStatus === "PENDING" ||
                            m.dbSetupStatus === "CONNECT" ||
                            m.dbSetupStatus === "BASIC" ||
                            m.dbSetupStatus === "DISMISS"
                                ? m.dbSetupStatus
                                : undefined,
                        editPlanRetryPrompt: typeof m.editPlanRetryPrompt === "string" ? m.editPlanRetryPrompt : undefined,
                        editPlanRetryCurrentPath: typeof m.editPlanRetryCurrentPath === "string" ? m.editPlanRetryCurrentPath : undefined,
                        editPlanRebuildPrompt: typeof m.editPlanRebuildPrompt === "boolean" ? m.editPlanRebuildPrompt : undefined,
                        editPlanFailure: m.editPlanFailure === true,
                        editPlanFailureCode: typeof m.editPlanFailureCode === "string" ? m.editPlanFailureCode : undefined,
                        editPlanFailureJobId: typeof m.editPlanFailureJobId === "string" ? m.editPlanFailureJobId : undefined,
                        editPlanFailureRequestId: typeof m.editPlanFailureRequestId === "string" ? m.editPlanFailureRequestId : undefined,
                        editPlanFailureHttpStatus: typeof m.editPlanFailureHttpStatus === "number" ? m.editPlanFailureHttpStatus : undefined,
                        restorePointsCard: m.restorePointsCard === true,
                        restorePointsCardReason: typeof m.restorePointsCardReason === "string" ? m.restorePointsCardReason : undefined,
                    };
                };

                if (stored) {
                    const loaded = stored.map(toMessage).filter(Boolean) as Message[];
                    if (loaded.length) setMessages(loaded);
                    loadedFromRemoteRef.current = true;
                    return;
                }

                // No remote history yet; attempt a one-time migration from legacy localStorage
                if (typeof window !== "undefined") {
                    try {
                        const legacy = localStorage.getItem(`chat_history_${appId}`);
                        if (legacy) {
                            const parsed = JSON.parse(legacy);
                            if (Array.isArray(parsed)) {
                                const loaded = parsed
                                    .map((msg: any) => ({
                                        ...msg,
                                        timestamp: new Date(msg.timestamp),
                                    }))
                                    .filter((msg: any) => msg?.id && msg?.role && msg?.content !== undefined && msg?.timestamp instanceof Date)
                                    .map((msg: any) => ({
                                        id: String(msg.id),
                                        role: msg.role === "user" || msg.role === "assistant" ? msg.role : "user",
                                        content: String(msg.content ?? ""),
                                        timestamp: msg.timestamp as Date,
                                        type: msg.type === "code" || msg.type === "file-edit" ? msg.type : "text",
                                        restorePointId: typeof msg.restorePointId === "string" ? msg.restorePointId : undefined,
                                        restoreActionLabel: typeof msg.restoreActionLabel === "string" ? msg.restoreActionLabel : undefined,
                                        editPlanRetryPrompt: typeof msg.editPlanRetryPrompt === "string" ? msg.editPlanRetryPrompt : undefined,
                                        editPlanRetryCurrentPath: typeof msg.editPlanRetryCurrentPath === "string" ? msg.editPlanRetryCurrentPath : undefined,
                                        editPlanRebuildPrompt: typeof msg.editPlanRebuildPrompt === "boolean" ? msg.editPlanRebuildPrompt : undefined,
                                        editPlanFailure: msg.editPlanFailure === true,
                                        editPlanFailureCode: typeof msg.editPlanFailureCode === "string" ? msg.editPlanFailureCode : undefined,
                                        editPlanFailureJobId: typeof msg.editPlanFailureJobId === "string" ? msg.editPlanFailureJobId : undefined,
                                        editPlanFailureRequestId: typeof msg.editPlanFailureRequestId === "string" ? msg.editPlanFailureRequestId : undefined,
                                        editPlanFailureHttpStatus: typeof msg.editPlanFailureHttpStatus === "number" ? msg.editPlanFailureHttpStatus : undefined,
                                        restorePointsCard: msg.restorePointsCard === true,
                                        restorePointsCardReason: typeof msg.restorePointsCardReason === "string" ? msg.restorePointsCardReason : undefined,
                                    })) as Message[];

                                if (loaded.length) {
                                    setMessages(loaded);
                                    const headers = await withCsrfHeaders();
                                    await fetchWithScopeRetry(
                                        `/api/app-builder/${appId}/ai-chat`,
                                        {
                                            method: "POST",
                                            headers,
                                            body: JSON.stringify({
                                                messages: loaded.map((m) => ({
                                                    id: m.id,
                                                    role: m.role,
                                                    content: m.content,
                                                    type: m.type,
                                                    timestampMs: m.timestamp.getTime(),
                                                    restorePointId: m.restorePointId ?? null,
                                                    restoreActionLabel: m.restoreActionLabel ?? null,
                                                    editPlanRetryPrompt: m.editPlanRetryPrompt ?? null,
                                                    editPlanRetryCurrentPath: m.editPlanRetryCurrentPath ?? null,
                                                    editPlanRebuildPrompt: m.editPlanRebuildPrompt ?? null,
                                                    editPlanFailure: m.editPlanFailure ?? null,
                                                    editPlanFailureCode: m.editPlanFailureCode ?? null,
                                                    editPlanFailureJobId: m.editPlanFailureJobId ?? null,
                                                    editPlanFailureRequestId: m.editPlanFailureRequestId ?? null,
                                                    editPlanFailureHttpStatus: m.editPlanFailureHttpStatus ?? null,
                                                    restorePointsCard: m.restorePointsCard ?? null,
                                                    restorePointsCardReason: m.restorePointsCardReason ?? null,
                                                })),
                                            }),
                                        },
                                        { retryLabel: "migrate legacy chat" },
                                    ).catch(() => null);
                                }
                            }
                        }
                    } catch {
                        // ignore migration errors
                    }

                    try {
                        localStorage.removeItem(`chat_history_${appId}`);
                    } catch {
                        // ignore
                    }
                }

                loadedFromRemoteRef.current = true;
            } catch (e) {
                // If server read fails, fall back to in-memory only.
                console.warn("Failed to load chat history", e);
                if (debugChatIo()) {
                    console.log("[AppBuilderEditorAgentChat] chat load failed", {
                        appId,
                        uid: user?.uid || null,
                        path: `kloner_users/${user?.uid || "<no-uid>"}/kloner_apps/${appId}/ai_chat/default`,
                    });
                }
                loadedFromRemoteRef.current = true;
            } finally {
                // Allow saving after the first load attempt finishes.
                initialLoadCompletedRef.current = true;
                if (debugChatIo()) console.log("[AppBuilderEditorAgentChat] chat load complete", { appId });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [appId, debugChatIo, fetchWithScopeRetry, scopeWarmupComplete, user?.uid, withCsrfHeaders]);

    const fetchRestorePoints = useCallback(async () => {
        if (!scopeWarmupComplete) return;
        try {
            await ensureSessionAndCsrf().catch(() => null);
            const res = await fetchWithScopeRetry(
                `/api/app-builder/${appId}/restore-points`,
                { method: "GET" },
                { retryLabel: "fetch restore points" }
            );
            if (!res.ok) return;
            const data = await res.json().catch(() => null);
            if (data?.ok && Array.isArray(data.restorePoints)) {
                setRestorePoints(data.restorePoints);
            }
        } catch {
            // ignore
        }
    }, [appId, fetchWithScopeRetry, scopeWarmupComplete]);

    const fetchRestorePointDetails = useCallback(async (restorePointId: string) => {
        const id = String(restorePointId || "").trim();
        if (!id || !scopeWarmupComplete) return;
        if (restorePointDetailsById[id]) return;

        try {
            await ensureSessionAndCsrf().catch(() => null);
            const res = await fetchWithScopeRetry(
                `/api/app-builder/${appId}/restore-points?restoreId=${encodeURIComponent(id)}`,
                { method: "GET" },
                { retryLabel: "fetch restore point details" }
            );
            if (!res.ok) return;
            const data = await res.json().catch(() => null);
            if (data?.ok && data?.id) {
                setRestorePointDetailsById((prev) => ({
                    ...prev,
                    [id]: {
                        id: String(data.id),
                        label: String(data.label || "Restore point"),
                        source: typeof data.source === "string" ? data.source : undefined,
                        kept: Boolean(data.kept),
                        paths: Array.isArray(data.paths) ? data.paths : undefined,
                        before: data.before && typeof data.before === "object" ? data.before : undefined,
                        after: data.after && typeof data.after === "object" ? data.after : undefined,
                    },
                }));
            }
        } catch {
            // ignore
        }
    }, [appId, fetchWithScopeRetry, restorePointDetailsById, scopeWarmupComplete]);

    const activeRestorePointPreviewData = activeRestorePointPreview
        ? (() => {
            const detail = restorePointDetailsById[activeRestorePointPreview.restorePointId];
            const preview = buildRestorePointDiffPreview(detail, activeRestorePointPreview.path);
            return preview ? { detail, preview, path: activeRestorePointPreview.path } : null;
        })()
        : null;

    useEffect(() => {
        const ids = Array.from(new Set(messages.map((m) => m.restorePointId).filter((id): id is string => Boolean(id))));
        for (const id of ids) {
            if (!restorePointDetailsById[id]) {
                void fetchRestorePointDetails(id);
            }
        }
    }, [fetchRestorePointDetails, messages, restorePointDetailsById]);

    const syncFilesFromServer = useCallback(async ({ applyToState = true }: { applyToState?: boolean } = {}) => {
        try {
            await ensureSessionAndCsrf().catch(() => null);
            const res = await fetchWithScopeRetry(
                `/api/app-builder/${appId}/files`,
                { method: "GET" },
                { retryLabel: "sync files" }
            );
            if (!res.ok) return null;
            const data = await res.json().catch(() => null);
            if (data?.files && typeof data.files === "object") {
                const normalizedFiles = normalizeServerFilesMap(data.files);
                if (applyToState && onFilesReplace) onFilesReplace(normalizedFiles);
                return normalizedFiles;
            }
        } catch {
            // ignore
        }
        return null;
    }, [appId, fetchWithScopeRetry, onFilesReplace]);

    const runPostMigrationRefreshPipeline = useCallback(async () => {
        const runId = Date.now();

        setMessages((prev) => [
            ...prev,
            {
                id: `mig_progress_applied_${runId}`,
                role: "assistant",
                content: "Website updated. Regenerating website…",
                timestamp: new Date(),
                type: "text",
            },
        ]);

        await syncFilesFromServer({ applyToState: true }).catch(() => null);

        setMessages((prev) => [
            ...prev,
            {
                id: `mig_progress_restart_${runId}`,
                role: "assistant",
                content: "Restarting preview…",
                timestamp: new Date(),
                type: "text",
            },
        ]);

        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new CustomEvent("kloner:preview-force-fresh", {
                    detail: { appId, reason: "migration-applied" },
                }),
            );
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
        const start = Date.now();
        let ready = previewReadyRef.current;
        while (!ready && Date.now() - start < 45_000) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            ready = previewReadyRef.current;
        }
    }, [appId, previewReadyRef, syncFilesFromServer]);

    const projectFramework = useMemo(() => detectProjectFramework(files), [files]);

    const createRestorePointBeforeApply = useCallback(
        async (label: string, paths?: string[]): Promise<string | null> => {
            try {
                const headers = await ensureSessionAndCsrf().then(() => withCsrfHeaders()).catch(() => null);
                if (!headers) return null;

                const uniquePaths = Array.from(new Set((paths || []).map((path) => String(path || "").trim()).filter(Boolean)));

                const res = await fetchWithScopeRetry(
                    `/api/app-builder/${appId}/restore-points`,
                    { method: "POST", headers, body: JSON.stringify({ label, paths: uniquePaths }) },
                    { retryLabel: "create restore point before apply" },
                );
                if (!res.ok) return null;

                const data = await res.json().catch(() => null);
                const restorePointId = typeof data?.restorePointId === "string" ? data.restorePointId.trim() : "";
                return restorePointId || null;
            } catch {
                return null;
            }
        },
        [appId, fetchWithScopeRetry, withCsrfHeaders],
    );

    const applyPendingEditPlan = useCallback(async (proposalArg?: AppEmbeddingEditPlanProposal | null) => {
        if (applyPendingEditPlanInFlightRef.current) return;
        const proposal = proposalArg ?? pendingEditPlan;
        if (!proposal) return;
        lastAppliedEditPlanRef.current = proposal;

        const files = Array.isArray(proposal.files)
            ? proposal.files.filter((file): file is AppEmbeddingEditPlanProposal["files"][number] => Boolean(file && typeof file.path === "string" && file.path.trim()))
            : [];

        if (proposal.needsMoreContext || files.length === 0) {
            setEditPlanApplyStatusMessage(proposal.needsMoreContext
                ? "The worker asked for more context, so I did not send the apply request yet."
                : "The worker did not return any files to apply.");
            return;
        }

        if (proposal.autoApplyAllowed === false) {
            setEditPlanApplyStatusMessage("The worker returned a proposal, but it was not marked safe to auto-apply.");
            return;
        }

        applyPendingEditPlanInFlightRef.current = true;
        setIsApplyingEditPlan(true);
        setEditPlanApplyError(null);
        setEditPlanApplyStatusMessage(null);
        setEditPlanApplyLoaderMessage("Applying changes...");

        const applyMessageId = `edit_plan_apply_${Date.now()}`;
        const upsertApplyMessage = (content: string, extra?: Partial<Message>) => {
            setMessages((prev) => {
                const nextMessage = {
                    id: applyMessageId,
                    role: "assistant" as const,
                    content,
                    timestamp: new Date(),
                    type: "text" as const,
                    ...extra,
                };

                const existingIndex = prev.findIndex((message) => message.id === applyMessageId);
                if (existingIndex === -1) {
                    return [...prev, nextMessage];
                }

                const next = prev.slice();
                next[existingIndex] = { ...next[existingIndex], ...nextMessage };
                return next;
            });
        };

        upsertApplyMessage("Sending the apply request now…");

        try {
            const restoreLabel = String(proposal.summary || "Apply edit plan").trim() || "Apply edit plan";
            const restorePointId = await createRestorePointBeforeApply(restoreLabel, files.map((file) => file.path));
            if (!restorePointId) {
                setEditPlanApplyError("I couldn’t create a restore point for this edit, so I stopped before applying it.");
                setEditPlanApplyStatusMessage("I couldn’t create a restore point, so I stopped before applying it.");
                upsertApplyMessage("I couldn’t create a restore point for this edit, so I stopped before applying it.", {
                    editPlanRetryPrompt: lastEditPlanPromptRef.current?.trim() || "Retry apply",
                });
                return;
            }

            setLastRestorePointId(restorePointId);
            await fetchRestorePoints();

            const headers = await withCsrfHeaders();
            const applyIdempotencyKey = editPlanApplyIdempotencyKeyRef.current || (editPlanApplyIdempotencyKeyRef.current = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
            const applyResult = await applyEditPlanOps({ appId, files, code: null, idempotencyKey: applyIdempotencyKey }, headers);
            const applyData = applyResult.data;
            const applyOutcome = String(applyData?.outcome || "").trim().toLowerCase();
            const applyPhase = String(applyData?.phase || "").trim().toLowerCase();
            const applyReplayed = Boolean(applyData?.replayed);
            const contradictoryStatus = Boolean(applyData?.contradictoryStatus);
            const expectedOps = typeof applyData?.expectedOps === "number" ? applyData.expectedOps : null;
            const machineWrites = typeof (applyData as any)?.machine?.wrote === "number" ? (applyData as any).machine.wrote : null;
            const applyRetryAfterSeconds = typeof applyData?.retryAfterSeconds === "number" ? applyData.retryAfterSeconds : null;
            const applyRestartPending = Boolean(applyData?.restartPending || applyData?.queued || applyData?.outcome === "restart_pending");
            const applyRestartTimedOut = Boolean(applyOutcome === "timeout" || (applyResult.status === 504 && applyData?.retryable));
            const applyRestartConfirmed = Boolean(applyData?.restartConfirmed);
            const applyRestartInProgress = applyRestartPending && !applyRestartConfirmed;

            if (applyPhase === "accepted" || applyPhase === "applying_files" || applyPhase === "files_applied") {
                setEditPlanApplyLoaderMessage("Applying changes...");
            } else if (applyPhase === "restart_pending") {
                setEditPlanApplyLoaderMessage("Queuing restart...");
            } else if (applyPhase === "restarting" || applyRestartInProgress) {
                setEditPlanApplyLoaderMessage("Restarting preview...");
            }

            if (applyReplayed) {
                setEditPlanApplyError(null);
                setEditPlanApplyStatusMessage("This update was already processed. No new apply was started.");
                upsertApplyMessage("This update was already processed. No new apply was started.");
                setEditPlanApplyLoaderMessage(null);
                return;
            }

            if (contradictoryStatus) {
                const warning = "Apply may not have taken effect on the preview machine. Please retry apply.";
                setEditPlanApplyError(warning);
                setEditPlanApplyStatusMessage(warning);
                upsertApplyMessage(warning, {
                    editPlanRetryPrompt: lastEditPlanPromptRef.current?.trim() || "Retry apply",
                });
                setEditPlanApplyLoaderMessage(null);
                return;
            }

            if (isApplyUncertainResult(applyData) || isApplyUncertainResult({
                code: applyResult.code,
                outcome: applyData?.outcome,
                uncertain: (applyData as any)?.uncertain,
                applyUncertain: (applyData as any)?.applyUncertain,
            })) {
                const uncertainMessage = getApplyUncertainMessage({
                    ...(applyData as any),
                    code: (applyData as any)?.code || applyResult.code,
                });
                const recommendedAction = String((applyData as any)?.recommendedAction || "").trim().toLowerCase();
                const retryPrompt = (applyData?.retryable || applyResult.status === 202)
                    ? lastEditPlanPromptRef.current?.trim() || "Retry apply"
                    : undefined;

                setEditPlanApplyError(null);
                setEditPlanApplyStatusMessage(uncertainMessage);
                upsertApplyMessage(uncertainMessage, {
                    editPlanRebuildPrompt: recommendedAction === "rebuild_preview" || Boolean(applyData?.requiresRestart || applyData?.restartPending),
                    editPlanRetryPrompt: retryPrompt,
                });
                setEditPlanApplyLoaderMessage(null);
                return;
            }

            if (applyData?.saved === false && !applyReplayed && (expectedOps === null || expectedOps > 0)) {
                const applyCode = String((applyData as any)?.code || applyResult.code || "").trim().toUpperCase();
                const applyReason = String((applyData as any)?.reason || "").trim().toLowerCase();
                const isProxyApplyFailure = applyCode === "APPLY_PROXY_ERROR" || applyReason === "proxy_request_error";
                const writeFailure = machineWrites === 0
                    ? (isProxyApplyFailure
                        ? "Your changes may not have saved. If your changes are not showing, rebuild first."
                        : "The apply request completed, but no files were written. Please retry apply.")
                    : (isProxyApplyFailure
                        ? "Your changes may not have saved. If your changes are not showing, rebuild first."
                        : "The apply request did not save all file changes. Please retry apply.");
                setEditPlanApplyError(writeFailure);
                setEditPlanApplyStatusMessage(writeFailure);
                upsertApplyMessage(writeFailure, {
                    editPlanRetryPrompt: lastEditPlanPromptRef.current?.trim() || "Retry apply",
                });
                setEditPlanApplyLoaderMessage(null);
                return;
            }

            if (applyOutcome === "failed") {
                const applyCode = String((applyData as any)?.code || applyResult.code || "").trim().toUpperCase();
                const applyReason = String((applyData as any)?.reason || "").trim().toLowerCase();
                const isProxyApplyFailure = applyCode === "APPLY_PROXY_ERROR" || applyReason === "proxy_request_error";
                const failedMessage = isProxyApplyFailure
                    ? "Your changes may not have saved. If your changes are not showing, rebuild first."
                    : "The backend reported that apply failed. Please retry apply.";
                setEditPlanApplyError(failedMessage);
                setEditPlanApplyStatusMessage(failedMessage);
                upsertApplyMessage(failedMessage, {
                    editPlanRetryPrompt: lastEditPlanPromptRef.current?.trim() || "Retry apply",
                });
                setEditPlanApplyLoaderMessage(null);
                return;
            }

            if (applyOutcome === "timeout") {
                const timeoutMessage = "The apply request timed out before restart completed. Please retry in a moment.";
                setEditPlanApplyError(null);
                setEditPlanApplyStatusMessage(timeoutMessage);
                upsertApplyMessage(timeoutMessage, {
                    editPlanRetryPrompt: lastEditPlanPromptRef.current?.trim() || "Retry apply",
                });
                setEditPlanApplyLoaderMessage(null);
                return;
            }

            if (!applyResult.ok && !applyData?.retryable && !applyRestartTimedOut) {
                const requestId = applyResult.requestId || proposal.requestId || null;
                const code = applyResult.code || (applyResult.status === 409 ? "PATCH_RESOLUTION_FAILED" : null);
                const errorText = code === "PROXY_NOT_READY"
                    ? "The preview proxy is not ready yet. Please retry in a moment."
                    : code === "RESTART_ENQUEUE_FAILED"
                        ? "The backend saved files but could not enqueue restart. Please retry apply."
                        : String(applyResult.error || (applyData as any)?.error || "Failed to apply edit plan.");
                setEditPlanApplyError(
                    [
                        "The backend could not apply this edit plan.",
                        errorText,
                        requestId ? `Request ID: ${requestId}` : null,
                        code ? `Error code: ${code}` : null,
                        applyResult.status === 409 ? "Review the anchor details below and refine the request." : null,
                    ].filter(Boolean).join("\n"),
                );
                setEditPlanApplyStatusMessage(null);
                upsertApplyMessage(`The apply request failed: ${errorText}`, {
                    editPlanRetryPrompt: lastEditPlanPromptRef.current?.trim() || "Retry apply",
                });
                setEditPlanApplyLoaderMessage(null);
                return;
            }

            void syncFilesFromServer({ applyToState: true }).catch(() => null);

            if (applyRestartTimedOut || (applyData?.retryable && !applyRestartConfirmed && !applyRestartPending)) {
                const retryHint = applyRetryAfterSeconds !== null ? ` Retry in ${applyRetryAfterSeconds}s.` : "";
                const timeoutMessage = String(applyData?.restartMessage || applyData?.error || "The apply request timed out while waiting for the restart to settle.");

                setEditPlanApplyError(null);
                setEditPlanApplyStatusMessage(`${timeoutMessage}${retryHint}`.trim());
                upsertApplyMessage(`${timeoutMessage}${retryHint}`.trim(), {
                    editPlanRetryPrompt: lastEditPlanPromptRef.current?.trim() || "Retry apply",
                });

                setEditPlanApplyLoaderMessage(null);
                return;
            }

            const applyNeedsRebuild = Boolean(
                applyData?.needsRebuild ??
                    applyData?.requiresRestart ??
                    applyData?.requiresRebuild ??
                    applyData?.touchesPublicAssets ??
                    proposal.needsRebuild,
            );
            if (applyNeedsRebuild) {
                setEditPlanApplyLoaderMessage("Restarting preview...");
                upsertApplyMessage("Files were saved. Preview restart is pending.");

                void syncFilesFromServer({ applyToState: true }).catch(() => null);

                if (typeof window !== "undefined") {
                    window.dispatchEvent(
                        new CustomEvent("kloner:preview-force-fresh", {
                            detail: { appId, reason: "migration-applied" },
                        }),
                    );
                }

                await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            const restartPending = Boolean(applyData?.restartPending || applyData?.restart_pending || applyData?.queued || applyData?.outcome === "restart_pending");
            const restartStatus = String(applyData?.restartStatus || applyData?.restart_status || "").trim().toLowerCase();
            const restartMessage = String(applyData?.restartMessage || applyData?.restart_message || "").trim();
            const restartTimedOut = Boolean(
                applyOutcome === "timeout" ||
                (applyData?.retryable && applyData?.saved !== true && !applyRestartConfirmed && !restartPending && restartStatus === "timeout")
            );

            if (restartTimedOut || restartPending) {
                setEditPlanApplyLoaderMessage(restartPending ? "Queuing restart..." : null);
                const restartContent = restartTimedOut
                    ? restartMessage || "The website update timed out while waiting for the restart to settle. Your files may already be saved."
                    : restartMessage || "The website update is still restarting.";

                setEditPlanApplyError(null);
                setEditPlanApplyStatusMessage(restartContent);
                upsertApplyMessage(restartContent, {
                    editPlanRetryPrompt: lastEditPlanPromptRef.current?.trim() || "Retry apply",
                    editPlanRebuildPrompt: restartTimedOut,
                });
                setEditPlanApplyLoaderMessage(null);
                return;
            }

            setEditPlanApplyStatusMessage(
                applyNeedsRebuild
                    ? "The website update is running and the preview is refreshing."
                    : "The website was updated and the preview was refreshed."
            );
            queueKeepUndoPrompt({
                restorePointId,
                touchedPaths: files.map((file) => file.path),
                skippedPaths: [],
                restorable: true,
                summary: proposal.summary || "Edit applied",
                query: lastEditPlanPromptRef.current || "",
                currentPath: currentFile || null,
            });
            upsertApplyMessage(
                applyNeedsRebuild
                    ? "The website update is running and the preview is refreshing."
                    : "The website was updated and the updated files were synced.",
                {
                    restorePointId,
                },
            );
            showRestorePointsCard("after_apply");

            if (!restartTimedOut && !restartPending) {
                editPlanApplyIdempotencyKeyRef.current = null;
            }
            setEditPlanApplyLoaderMessage(null);
        } catch (err: any) {
            setEditPlanApplyError(String(err?.message || "Failed to apply edit plan."));
            setEditPlanApplyStatusMessage(String(err?.message || "Failed to apply edit plan."));
            editPlanApplyIdempotencyKeyRef.current = null;
            setEditPlanApplyLoaderMessage(null);
        } finally {
            applyPendingEditPlanInFlightRef.current = false;
            setIsApplyingEditPlan(false);
        }
    }, [appId, createRestorePointBeforeApply, currentFile, fetchRestorePoints, pendingEditPlan, showRestorePointsCard, syncFilesFromServer, withCsrfHeaders]);

    useEffect(() => {
        fetchRestorePoints();
    }, [fetchRestorePoints]);

    useEffect(() => {
        if (restorePoints.length === 0) {
            setSelectedRestorePointId(null);
            return;
        }

        if (selectedRestorePointId && restorePoints.some((item) => item.id === selectedRestorePointId)) {
            return;
        }

        const preferredId = lastRestorePointId && restorePoints.some((item) => item.id === lastRestorePointId)
            ? lastRestorePointId
            : restorePoints[0]?.id || null;
        setSelectedRestorePointId(preferredId);
    }, [lastRestorePointId, restorePoints, selectedRestorePointId]);

    useEffect(() => {
        if (!activeEditPlanJob) return;

        const jobKey = activeEditPlanJob.jobId || activeEditPlanJob.requestId || activeEditPlanJob.statusUrl || null;
        if (!jobKey) return;

        const nextContent = buildEditPlanStatusBubbleText(activeEditPlanJob);
        const bubbleId = editPlanStatusMessageIdRef.current;
        const lastContent = editPlanStatusMessageTextRef.current;

        if (editPlanStatusMessageJobKeyRef.current !== jobKey || !bubbleId) {
            const nextBubbleId = `edit_plan_status_${Date.now()}`;
            editPlanStatusMessageJobKeyRef.current = jobKey;
            editPlanStatusMessageIdRef.current = nextBubbleId;
            editPlanStatusMessageTextRef.current = nextContent;
            setEditPlanStatusMessageId(nextBubbleId);
            setMessages((prev) => [
                ...prev,
                {
                    id: nextBubbleId,
                    role: "assistant",
                    content: nextContent,
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
            return;
        }

        if (lastContent !== nextContent) {
            editPlanStatusMessageTextRef.current = nextContent;
            setMessages((prev) =>
                prev.map((message) =>
                    message.id === bubbleId
                        ? {
                            ...message,
                            content: nextContent,
                        }
                        : message,
                ),
            );
        }
    }, [activeEditPlanJob, buildEditPlanStatusBubbleText]);

    useEffect(() => {
        if (!activeEditPlanJob) return;

        const jobKey = activeEditPlanJob.jobId || activeEditPlanJob.requestId || activeEditPlanJob.statusUrl || null;
        if (!jobKey) return;

        const details = buildEditPlanDetailsChatMessage(activeEditPlanJob);
        if (!details) {
            if (editPlanDetailsMessageKeyRef.current !== jobKey) {
                editPlanDetailsMessageKeyRef.current = jobKey;
                editPlanDetailsMessageIdRef.current = null;
                editPlanDetailsMessageTextRef.current = null;
            }
            return;
        }
        const requestMeta = editPlanJobRequestMetaRef.current[jobKey]
            || editPlanJobRequestMetaRef.current[`status:${jobKey}`]
            || (activeEditPlanJob.statusUrl ? editPlanJobRequestMetaRef.current[`status:${activeEditPlanJob.statusUrl}`] : undefined)
            || (activeEditPlanJob.requestId ? editPlanJobRequestMetaRef.current[`req:${activeEditPlanJob.requestId}`] : undefined)
            || (activeEditPlanJob.jobId ? editPlanJobRequestMetaRef.current[activeEditPlanJob.jobId] : undefined)
            || ((activeEditPlanJob as any)?.enqueueRequestId ? editPlanJobRequestMetaRef.current[`req:${String((activeEditPlanJob as any).enqueueRequestId)}`] : undefined)
            || ((activeEditPlanJob as any)?.jobRequestId ? editPlanJobRequestMetaRef.current[`req:${String((activeEditPlanJob as any).jobRequestId)}`] : undefined)
            || latestInquiryMetaRef.current
            || null;
        const feedbackContext = requestMeta
            ? {
                query: requestMeta.query,
                currentPath: requestMeta.currentPath,
                requestedAt: requestMeta.requestedAt,
                search: requestMeta.search || null,
                jobId: activeEditPlanJob.jobId || null,
                requestId: activeEditPlanJob.requestId || null,
            }
            : undefined;
        if (feedbackContext) {
            latestSummaryFeedbackContextRef.current = feedbackContext;
        }
        const existingMessageId = editPlanDetailsMessageIdRef.current;
        const existingMessageText = editPlanDetailsMessageTextRef.current;

        if (editPlanDetailsMessageKeyRef.current !== jobKey || !existingMessageId) {
            const nextBubbleId = `edit_plan_details_${Date.now()}`;
            editPlanDetailsMessageKeyRef.current = jobKey;
            editPlanDetailsMessageIdRef.current = nextBubbleId;
            editPlanDetailsMessageTextRef.current = details;

            setMessages((prev) => [
                ...prev,
                {
                    id: nextBubbleId,
                    role: "assistant",
                    content: details,
                    timestamp: new Date(),
                    type: "text",
                    summaryFeedbackContext: feedbackContext,
                },
            ]);
            return;
        }

        if (existingMessageText !== details) {
            editPlanDetailsMessageTextRef.current = details;
            setMessages((prev) =>
                prev.map((message) =>
                    message.id === existingMessageId
                        ? {
                            ...message,
                            content: details,
                            summaryFeedbackContext: message.summaryFeedbackContext || feedbackContext,
                        }
                        : message,
                ),
            );
        }
    }, [activeEditPlanJob]);

    useEffect(() => {
        if (!activeEditPlanJob) return;

        const proposal = activeEditPlanJob?.result?.proposal ?? activeEditPlanJob?.job?.result?.proposal ?? null;
        const proposalFiles = Array.isArray(proposal?.files) ? proposal.files : [];
        const proposalFileCount =
            typeof proposal?.fileCount === "number" && Number.isFinite(proposal.fileCount)
                ? proposal.fileCount
                : proposalFiles.length;
        const linesAdded =
            typeof proposal?.totalEstimatedLinesAdded === "number" && Number.isFinite(proposal.totalEstimatedLinesAdded)
                ? proposal.totalEstimatedLinesAdded
                : null;
        const linesRemoved =
            typeof proposal?.totalEstimatedLinesRemoved === "number" && Number.isFinite(proposal.totalEstimatedLinesRemoved)
                ? proposal.totalEstimatedLinesRemoved
                : null;
        const hasMeaningfulData =
            String(activeEditPlanJob.status || "").toLowerCase() === "completed"
            && Boolean(proposal)
            && (
                proposalFileCount > 0
                || (typeof linesAdded === "number" && linesAdded > 0)
                || (typeof linesRemoved === "number" && linesRemoved > 0)
                || proposalFiles.some((file) => {
                    const added = typeof file?.estimatedLinesAdded === "number" ? file.estimatedLinesAdded : 0;
                    const removed = typeof file?.estimatedLinesRemoved === "number" ? file.estimatedLinesRemoved : 0;
                    return added > 0 || removed > 0 || Boolean(String(file?.beforePreview || "").trim()) || Boolean(String(file?.afterPreview || "").trim());
                })
            );
        if (!hasMeaningfulData) return;

        const jobKey = activeEditPlanJob.jobId || activeEditPlanJob.requestId || activeEditPlanJob.statusUrl || null;
        if (!jobKey) return;
        if (editPlanFilesCardMessageJobKeyRef.current === jobKey && editPlanFilesCardMessageId) return;

        const nextBubbleId = `edit_plan_files_card_${Date.now()}`;
        editPlanFilesCardMessageJobKeyRef.current = jobKey;
        setEditPlanFilesCardMessageId(nextBubbleId);
        setMessages((prev) => [
            ...prev,
            {
                id: nextBubbleId,
                role: "assistant",
                content: "Files changed",
                timestamp: new Date(),
                type: "text",
            },
        ]);
    }, [activeEditPlanJob, editPlanFilesCardMessageId]);

    useEffect(() => {
        const content = String(editPlanApplyStatusMessage || "").trim();
        if (!content) {
            editPlanApplyStatusBubbleTextRef.current = null;
            return;
        }

        const normalizedContent = normalizeAssistantMessageText(content);
        const recentAssistantMessages = [...messages]
            .reverse()
            .filter((message) => message.role === "assistant")
            .slice(0, 6);

        if (recentAssistantMessages.some((message) => normalizeAssistantMessageText(String(message.content || "")) === normalizedContent)) {
            editPlanApplyStatusBubbleTextRef.current = content;
            return;
        }

        if (messages.some((message) => String(message.id || "").startsWith("edit_plan_apply_status_") && String(message.content || "").trim() === content)) {
            editPlanApplyStatusBubbleTextRef.current = content;
            return;
        }

        if (editPlanApplyStatusBubbleTextRef.current === content) return;
        editPlanApplyStatusBubbleTextRef.current = content;
        const nextBubbleId = `edit_plan_apply_status_${Date.now()}`;
        setMessages((prev) => [
            ...prev,
            {
                id: nextBubbleId,
                role: "assistant",
                content,
                timestamp: new Date(),
                type: "text",
            },
        ]);
    }, [editPlanApplyStatusMessage, messages]);

    useEffect(() => {
        if (!activeEditPlanJob) return;
        const jobId = activeEditPlanJob.jobId || activeEditPlanJob.requestId || null;
        if (!jobId) return;
        if (!isEditPlanJobTerminalStatus(activeEditPlanJob.status) || String(activeEditPlanJob.status || "").toLowerCase() !== "completed") return;
        if (editPlanAutoApplyJobIdRef.current === jobId) return;
        if (isApplyingEditPlan) return;

        editPlanAutoApplyJobIdRef.current = jobId;

        const completedResult = extractCompletedEditPlanResult(activeEditPlanJob);
        const backendApplyResult = completedResult?.apply ?? null;
        const requestMeta = editPlanJobRequestMetaRef.current[jobId]
            || (activeEditPlanJob.requestId ? editPlanJobRequestMetaRef.current[`req:${activeEditPlanJob.requestId}`] : undefined)
            || null;

        if (backendApplyResult && typeof backendApplyResult === "object") {
            // Backend applied as part of the job — surface the result using the apply contract.
            setEditPlanApplyLoaderMessage(null);
            void syncFilesFromServer({ applyToState: true }).catch(() => null);

            const restorePointPayload = (backendApplyResult as any).restorePoint && typeof (backendApplyResult as any).restorePoint === "object"
                ? (backendApplyResult as any).restorePoint
                : null;
            const jobRestorePointId: string | null =
                typeof restorePointPayload?.restorePointId === "string"
                    ? String(restorePointPayload.restorePointId).trim()
                    : null;
            const jobRestorable = restorePointPayload?.restorable !== false;
            const jobTouchedPaths = Array.isArray(restorePointPayload?.touchedPaths)
                ? restorePointPayload.touchedPaths.map((path: unknown) => String(path || "").trim()).filter(Boolean)
                : [];
            const jobSkippedPaths = Array.isArray(restorePointPayload?.skippedPaths)
                ? restorePointPayload.skippedPaths.map((path: unknown) => String(path || "").trim()).filter(Boolean)
                : [];
            if (jobRestorePointId) {
                setLastRestorePointId(jobRestorePointId);
                void fetchRestorePoints().catch(() => null);

                queueKeepUndoPrompt({
                    restorePointId: jobRestorePointId,
                    touchedPaths: jobTouchedPaths,
                    skippedPaths: jobSkippedPaths,
                    restorable: jobRestorable,
                    summary: pendingEditPlan?.summary || (completedResult?.summary as string) || "Edit applied",
                    query: requestMeta?.query || lastEditPlanPromptRef.current || "",
                    currentPath: requestMeta?.currentPath || null,
                });
            }

            // Determine apply state using the backend contract.
            const applyState = resolveApplyState(backendApplyResult);
            const applyRetryState = String((backendApplyResult as any)?.applyRetryState || "").trim().toLowerCase();
            const applyAttempts = Number((backendApplyResult as any)?.applyAttempts);
            const applyMaxAttempts = Number((backendApplyResult as any)?.applyMaxAttempts);
            const retrySuccessNotice =
                applyRetryState === "succeeded_after_retry" && Number.isFinite(applyAttempts) && applyAttempts > 1
                    ? `Applied after retry (${Math.floor(applyAttempts)} attempts).`
                    : null;
            // Prefer pendingEditPlan summary as userMessage fallback for success states.
            const applyResultForMsg = {
                ...(backendApplyResult as Record<string, unknown>),
                userMessage: (backendApplyResult as any).userMessage
                    || (applyState === "confirmed_success" || applyState === "restart_pending" || applyState === "restart_confirmed"
                        ? pendingEditPlan?.summary?.trim() || null
                        : null),
            };
            const applyMsg = buildApplyStateMessage(applyState, applyResultForMsg);

            switch (applyState) {
                case "confirmed_success": {
                    const pfc = (backendApplyResult as any).patchedFileCount;
                    const patchedChip = typeof pfc === "number" && pfc > 0 ? `${pfc} file${pfc !== 1 ? "s" : ""} patched` : null;
                    const contentBase = patchedChip ? `${applyMsg} (${patchedChip})` : applyMsg;
                    const content = retrySuccessNotice ? `${contentBase}\n${retrySuccessNotice}` : contentBase;
                    setEditPlanApplyError(null);
                    setEditPlanApplyStatusMessage(content);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `edit_plan_apply_success_${Date.now()}`,
                            role: "assistant" as const,
                            content,
                            timestamp: new Date(),
                            type: "text" as const,
                            restorePointId: jobRestorePointId || undefined,
                        },
                    ]);
                    showRestorePointsCard("after_apply");
                    break;
                }
                case "restart_pending": {
                    const content = retrySuccessNotice ? `${applyMsg}\n${retrySuccessNotice}` : applyMsg;
                    setEditPlanApplyError(null);
                    setEditPlanApplyStatusMessage(content);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `edit_plan_apply_restart_pending_${Date.now()}`,
                            role: "assistant" as const,
                            content,
                            timestamp: new Date(),
                            type: "text" as const,
                            restorePointId: jobRestorePointId || undefined,
                            editPlanRebuildPrompt: true,
                        },
                    ]);
                    showRestorePointsCard("after_apply");
                    break;
                }
                case "restart_confirmed": {
                    const content = retrySuccessNotice ? `${applyMsg}\n${retrySuccessNotice}` : applyMsg;
                    setEditPlanApplyError(null);
                    setEditPlanApplyStatusMessage(content);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `edit_plan_apply_restart_confirmed_${Date.now()}`,
                            role: "assistant" as const,
                            content,
                            timestamp: new Date(),
                            type: "text" as const,
                            restorePointId: jobRestorePointId || undefined,
                        },
                    ]);
                    showRestorePointsCard("after_apply");
                    break;
                }
                case "uncertain": {
                    const recommendedAction = String((backendApplyResult as any)?.recommendedAction || "").trim().toLowerCase();
                    const retryable = (backendApplyResult as any)?.retryable === true || typeof (backendApplyResult as any)?.retryAfterSeconds === "number";
                    setEditPlanApplyError(null);
                    setEditPlanApplyStatusMessage(applyMsg);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `edit_plan_apply_uncertain_${Date.now()}`,
                            role: "assistant" as const,
                            content: applyMsg,
                            timestamp: new Date(),
                            type: "text" as const,
                            restorePointId: jobRestorePointId || undefined,
                            editPlanRebuildPrompt: recommendedAction === "rebuild_preview" || Boolean((backendApplyResult as any)?.requiresRestart || (backendApplyResult as any)?.restartPending),
                            editPlanRetryPrompt: retryable ? (lastEditPlanPromptRef.current?.trim() || "Retry apply") : undefined,
                        },
                    ]);
                    // Show restore points if a restore point was created (partial write may have occurred).
                    if (jobRestorePointId) showRestorePointsCard("after_uncertain_apply");
                    break;
                }
                case "failed": {
                    const patchErrors: Array<{ path?: string | null; message?: string | null; code?: string | null }> =
                        Array.isArray((backendApplyResult as any).patchErrors) ? (backendApplyResult as any).patchErrors : [];
                    const machineError: string | null =
                        typeof (backendApplyResult as any).machineError === "string" ? (backendApplyResult as any).machineError : null;
                    const errorLines: string[] = [applyMsg];
                    if (machineError) errorLines.push(machineError);
                    if (patchErrors.length > 0) {
                        errorLines.push(`Patch errors:\n${patchErrors.map((e) => `- ${e.path || "?"}: ${e.message || e.code || "error"}`).join("\n")}`);
                    }
                    if (applyRetryState === "exhausted") {
                        if (Number.isFinite(applyAttempts) && Number.isFinite(applyMaxAttempts) && applyAttempts > 0 && applyMaxAttempts > 0) {
                            errorLines.push(`Failed after ${Math.floor(applyAttempts)}/${Math.floor(applyMaxAttempts)} apply attempts.`);
                        } else if (Number.isFinite(applyAttempts) && applyAttempts > 0) {
                            errorLines.push(`Failed after ${Math.floor(applyAttempts)} apply attempts.`);
                        }
                    }
                    const errorContent = errorLines.join("\n");
                    setEditPlanApplyError(errorContent);
                    setEditPlanApplyStatusMessage(applyMsg);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `edit_plan_apply_failed_${Date.now()}`,
                            role: "assistant" as const,
                            content: errorContent,
                            timestamp: new Date(),
                            type: "text" as const,
                            restorePointId: jobRestorePointId || undefined,
                            editPlanRetryPrompt: lastEditPlanPromptRef.current?.trim() || "Retry apply",
                            editPlanRetryCurrentPath: requestMeta?.currentPath || null,
                            editPlanRebuildPrompt: shouldSuggestRebuildFromFailure(String((backendApplyResult as any)?.code || ""), errorContent),
                        },
                    ]);
                    break;
                }
            }

            return;
        }

        const completedProposal = completedResult && typeof completedResult === "object"
            ? (((completedResult as any).proposal && typeof (completedResult as any).proposal === "object")
                ? (completedResult as any).proposal
                : null)
            : null;
        const completedProposalFiles = Array.isArray(completedProposal?.files) ? completedProposal.files : [];
        const completedProposalFileCount =
            typeof completedProposal?.fileCount === "number" && Number.isFinite(completedProposal.fileCount)
                ? completedProposal.fileCount
                : completedProposalFiles.length;
        const completedLinesAdded =
            typeof completedProposal?.totalEstimatedLinesAdded === "number" && Number.isFinite(completedProposal.totalEstimatedLinesAdded)
                ? completedProposal.totalEstimatedLinesAdded
                : null;
        const completedLinesRemoved =
            typeof completedProposal?.totalEstimatedLinesRemoved === "number" && Number.isFinite(completedProposal.totalEstimatedLinesRemoved)
                ? completedProposal.totalEstimatedLinesRemoved
                : null;
        const hasMeaningfulCompletedWrite = Boolean(
            completedProposal
            && (
                completedProposalFileCount > 0
                || (typeof completedLinesAdded === "number" && completedLinesAdded > 0)
                || (typeof completedLinesRemoved === "number" && completedLinesRemoved > 0)
                || (() => {
                    for (const file of completedProposalFiles as Array<Record<string, unknown>>) {
                        const added = typeof file?.estimatedLinesAdded === "number" ? file.estimatedLinesAdded : 0;
                        const removed = typeof file?.estimatedLinesRemoved === "number" ? file.estimatedLinesRemoved : 0;
                        if (added > 0 || removed > 0 || Boolean(String(file?.beforePreview || "").trim()) || Boolean(String(file?.afterPreview || "").trim())) {
                            return true;
                        }
                    }
                    return false;
                })()
            ),
        );

        if (hasMeaningfulCompletedWrite) {
            setEditPlanApplyLoaderMessage(null);
            void syncFilesFromServer({ applyToState: true }).catch(() => null);
            void fetchRestorePoints().catch(() => null);
            if (requestMeta?.preflightRestorePointId) {
                setLastRestorePointId(requestMeta.preflightRestorePointId);
            }

            const contractPrompt = buildMissingApplyContractFulfillmentPrompt({
                jobId: activeEditPlanJob.jobId || null,
                requestId: activeEditPlanJob.requestId || null,
                statusUrl: activeEditPlanJob.statusUrl || null,
                summary: typeof (completedResult as any)?.summary === "string" ? (completedResult as any).summary : null,
                diagnosis: typeof (completedResult as any)?.diagnosis === "string" ? (completedResult as any).diagnosis : null,
                proposalFileCount: completedProposalFileCount,
                proposalPaths: completedProposalFiles.map((file: any) => String(file?.path || "").trim()).filter(Boolean),
            });

            dispatchAiAgentEvent("edit_plan_apply_contract_missing", {
                appId,
                userId: user?.uid || null,
                jobId: activeEditPlanJob.jobId || null,
                requestId: activeEditPlanJob.requestId || null,
                statusUrl: activeEditPlanJob.statusUrl || null,
                proposalFileCount: completedProposalFileCount,
            });

            console.warn("[edit-plan] backend result.apply missing for completed write", {
                jobId: activeEditPlanJob.jobId || null,
                requestId: activeEditPlanJob.requestId || null,
                statusUrl: activeEditPlanJob.statusUrl || null,
                proposalFileCount: completedProposalFileCount,
                proposalPaths: completedProposalFiles.map((file: any) => String(file?.path || "").trim()).filter(Boolean),
                prompt: contractPrompt,
            });

            surfaceEditPlanFailure({
                body: "We could not verify the apply result from the worker. Please retry.",
                code: "EDIT_PLAN_APPLY_FAILURE_LEGACY_SHAPE_MISMATCH",
                jobStatus: "failed",
                httpStatus: 409,
                jobId: activeEditPlanJob.jobId || null,
                requestId: activeEditPlanJob.requestId || null,
                retryable: true,
                retryPrompt: requestMeta?.query || lastEditPlanPromptRef.current || null,
                retryCurrentPath: requestMeta?.currentPath || null,
            });
            void showRestorePointsCard("after_apply_missing_contract");
            return;
        }

        // Do not call /api/v1/webcontainer/apply from the frontend in this flow.
        // Backend workers now own preview-machine apply and restart orchestration.
        if (!pendingEditPlan) return;
        if (pendingEditPlan.needsMoreContext || pendingEditPlan.autoApplyAllowed === false) return;
        if (!Array.isArray(pendingEditPlan.files) || pendingEditPlan.files.length === 0) return;

        // No user-facing message here: apply/restart ownership is server-side.
        return;
    }, [activeEditPlanJob, fetchRestorePoints, isApplyingEditPlan, pendingEditPlan, setLastRestorePointId, setMessages, showRestorePointsCard, surfaceEditPlanFailure, syncFilesFromServer]);

    // Scroll whenever the chat grows so new messages stay in view.
    useLayoutEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    const renderedMessages = useMemo(() => {
        const suppressedTexts = [
            "preview restart failed or timed out. you can retry apply, or refresh/rebuild the preview.",
            "I created you a restore point above, so you can undo this change if needed.",
        ];
        return messages
            .map((message, index) => ({ message, index }))
            .filter(({ message }) => !suppressedTexts.includes(String(message.content || "").trim().toLowerCase()))
            .sort((a, b) => {
                const aTime = a.message.timestamp instanceof Date ? a.message.timestamp.getTime() : new Date(a.message.timestamp).getTime();
                const bTime = b.message.timestamp instanceof Date ? b.message.timestamp.getTime() : new Date(b.message.timestamp).getTime();
                if (aTime !== bTime) return aTime - bTime;
                return a.index - b.index;
            })
            .map((entry) => entry.message);
    }, [messages]);

    const activeEditPlanProposal = activeEditPlanJob?.result?.proposal
        ?? activeEditPlanJob?.job?.result?.proposal
        ?? null;
    const activeEditPlanProposalFiles = Array.isArray(activeEditPlanProposal?.files) ? activeEditPlanProposal.files : [];
    const activeEditPlanProposalFileCount =
        typeof activeEditPlanProposal?.fileCount === "number" && Number.isFinite(activeEditPlanProposal.fileCount)
            ? activeEditPlanProposal.fileCount
            : activeEditPlanProposalFiles.length;
    const activeEditPlanLinesAdded =
        typeof activeEditPlanProposal?.totalEstimatedLinesAdded === "number" && Number.isFinite(activeEditPlanProposal.totalEstimatedLinesAdded)
            ? activeEditPlanProposal.totalEstimatedLinesAdded
            : null;
    const activeEditPlanLinesRemoved =
        typeof activeEditPlanProposal?.totalEstimatedLinesRemoved === "number" && Number.isFinite(activeEditPlanProposal.totalEstimatedLinesRemoved)
            ? activeEditPlanProposal.totalEstimatedLinesRemoved
            : null;
    const hasMeaningfulFileChangeData =
        activeEditPlanProposalFileCount > 0
        || (typeof activeEditPlanLinesAdded === "number" && activeEditPlanLinesAdded > 0)
        || (typeof activeEditPlanLinesRemoved === "number" && activeEditPlanLinesRemoved > 0)
        || activeEditPlanProposalFiles.some((file) => {
            const added = typeof file?.estimatedLinesAdded === "number" ? file.estimatedLinesAdded : 0;
            const removed = typeof file?.estimatedLinesRemoved === "number" ? file.estimatedLinesRemoved : 0;
            return added > 0 || removed > 0 || Boolean(String(file?.beforePreview || "").trim()) || Boolean(String(file?.afterPreview || "").trim());
        });
    const activeEditPlanStatus = String(activeEditPlanJob?.status || "").toLowerCase();
    const showFileChangesCardBubble = Boolean(
        activeEditPlanJob
        && activeEditPlanStatus === "completed"
        && activeEditPlanProposal
        && hasMeaningfulFileChangeData,
    );
    const showActiveEditPlanStatusBubble = Boolean(
        activeEditPlanJob
        && isActiveEditPlanJobStatus(activeEditPlanJob.status),
    );
    const showPreparingChangeSummaryBubble = Boolean(
        showActiveEditPlanStatusBubble
        && !showFileChangesCardBubble
    );
    const latestChatRestorePoint = getLatestChatRestorePoint(chatRestorePoints);
    const preferredChatRestorePoint = getPreferredOrLatestChatRestorePoint(chatRestorePoints, lastRestorePointId);

    const selectedRestorePoint = restorePoints.find((item) => item.id === selectedRestorePointId) ?? restorePoints[0] ?? null;

    const formatHistoryRelativeTime = useCallback((appliedAt: number): string => {
        const deltaMs = Math.max(0, Date.now() - Math.max(0, appliedAt || 0));
        const seconds = Math.floor(deltaMs / 1000);
        if (seconds < 45) return "just now";
        if (seconds < 120) return "1 min ago";
        if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
        if (seconds < 7200) return "1 hour ago";
        if (seconds < 86_400) return `${Math.floor(seconds / 3600)} hours ago`;
        return `${Math.floor(seconds / 86_400)} days ago`;
    }, []);

    const pushRestorePointToUndoStack = useCallback((restorePoint: EditHistoryRestorePoint) => {
        setEditHistory((prev) => ({
            ...prev,
            undoStack: [
                restorePoint,
                ...prev.undoStack.filter((entry) => entry.restorePointId !== restorePoint.restorePointId),
            ],
        }));
    }, []);

    const queueKeepUndoPrompt = useCallback((input: {
        restorePointId: string;
        touchedPaths?: string[] | null;
        skippedPaths?: string[] | null;
        restorable?: boolean | null;
        summary?: string | null;
        query?: string | null;
        currentPath?: string | null;
    }) => {
        const restorePointId = String(input.restorePointId || "").trim();
        if (!restorePointId) return;

        setKeepUndoError(null);

        const restorePoint: EditHistoryRestorePoint = {
            restorePointId,
            touchedPaths: Array.isArray(input.touchedPaths)
                ? Array.from(new Set(input.touchedPaths.map((path) => String(path || "").trim()).filter(Boolean)))
                : [],
            restorable: input.restorable !== false,
            summary: String(input.summary || "Edit applied").trim() || "Edit applied",
            appliedAt: Date.now(),
            query: String(input.query || "").trim(),
            currentPath: typeof input.currentPath === "string" && input.currentPath.trim() ? input.currentPath.trim() : null,
        };

        setKeepUndoPrompt({
            restorePoint,
            skippedPaths: Array.isArray(input.skippedPaths)
                ? Array.from(new Set(input.skippedPaths.map((path) => String(path || "").trim()).filter(Boolean)))
                : [],
            expiresAt: Date.now() + 60_000,
        });
    }, []);

    const getRestoreErrorMessage = useCallback((status: number, code: string | null | undefined, fallback: string): string => {
        const normalized = String(code || "").trim().toUpperCase();
        if (status === 404 || normalized === "RESTORE_POINT_NOT_FOUND") return "This restore point no longer exists.";
        if (status === 409 || normalized === "RESTORE_POINT_NOT_RESTORABLE") return "Undo unavailable — one or more files were too large to snapshot.";
        if (status === 401 || normalized === "UNAUTHORIZED") return "Your session expired. Please sign in again.";
        if (status >= 500 || normalized === "REVERT_FAILED") return "Could not restore files. Please try again.";
        return fallback || "Could not undo — try again.";
    }, []);

    const formatRestorePointCreatedAt = useCallback((value: any): string => {
        if (!value) return "Just now";
        if (typeof value?.toDate === "function") {
            const date = value.toDate();
            return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Just now";
        }
        if (typeof value?.seconds === "number") {
            const date = new Date(value.seconds * 1000);
            return Number.isNaN(date.getTime()) ? "Just now" : date.toLocaleString();
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Just now" : date.toLocaleString();
    }, []);

    const isPersistableChatMessage = useCallback((message: Message) => {
        const id = String(message.id || "");
        return ![
            "edit_plan_status_",
            "mig_progress_",
            "staged_",
            "creating_project_",
            "supabase_oauth_popup_blocked_",
            "supabase_restart_",
            "project_created_",
            "create_error_",
        ].some((prefix) => id.startsWith(prefix));
    }, []);

    const saveTimerRef = useRef<number | null>(null);

    const buildChatPayload = useCallback((input: Message[]) => {
        // Keep a reasonable tail to prevent doc bloat.
        const tailMax = 120;
        const base = input
            .filter(isPersistableChatMessage)
            .slice(-tailMax)
            .map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                type: m.type,
                timestampMs: m.timestamp.getTime(),
                restorePointId: m.restorePointId ?? null,
                restoreActionLabel: m.restoreActionLabel ?? null,
                supabaseContinuationPrompt: m.supabaseContinuationPrompt ?? null,
                supabaseContinuationStatus: m.supabaseContinuationStatus ?? null,
                dbSetupPrompt: m.dbSetupPrompt ?? null,
                dbSetupStatus: m.dbSetupStatus ?? null,
                editPlanRetryPrompt: m.editPlanRetryPrompt ?? null,
                editPlanRetryCurrentPath: m.editPlanRetryCurrentPath ?? null,
                editPlanRebuildPrompt: m.editPlanRebuildPrompt ?? null,
                editPlanFailure: m.editPlanFailure ?? null,
                editPlanFailureCode: m.editPlanFailureCode ?? null,
                editPlanFailureJobId: m.editPlanFailureJobId ?? null,
                editPlanFailureRequestId: m.editPlanFailureRequestId ?? null,
                editPlanFailureHttpStatus: m.editPlanFailureHttpStatus ?? null,
                restorePointsCard: m.restorePointsCard ?? null,
                restorePointsCardReason: m.restorePointsCardReason ?? null,
            }));

        const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
        const sizeBytes = (payload: any) => {
            const raw = JSON.stringify(payload);
            return encoder ? encoder.encode(raw).length : raw.length;
        };

        let payload = base;
        // Firestore doc limit is ~1MB. Keep a safe margin.
        const MAX_BYTES = 800_000;
        if (sizeBytes(payload) > MAX_BYTES) payload = base.slice(-60);
        if (sizeBytes(payload) > MAX_BYTES) payload = base.slice(-30);

        return payload;
    }, [isPersistableChatMessage]);

    const saveChatNow = useCallback(
        async (nextMessages: Message[]) => {
            if (!isHydrated) return;
            if (!initialLoadCompletedRef.current) return;
            if (!user?.uid || !appId) return;

            try {
                const payload = buildChatPayload(nextMessages);
                const raw = JSON.stringify(payload);

                // Skip writes if nothing changed since last successful save.
                if (lastSavedPayloadRef.current === raw) {
                    if (debugChatIo()) console.log("[AppBuilderEditorAgentChat] chat save skipped (unchanged)", { appId });
                    return;
                }

                await ensureSessionAndCsrf().catch(() => null);
                const headers = await withCsrfHeaders();
                const res = await fetchWithScopeRetry(
                    `/api/app-builder/${appId}/ai-chat`,
                    { method: "POST", headers, body: JSON.stringify({ messages: payload }) },
                    { retryLabel: "save ai chat now" },
                );
                if (!res.ok) {
                    throw new Error(`Chat save failed: ${res.status}`);
                }

                lastSavedPayloadRef.current = raw;
                if (debugChatIo()) console.log("[AppBuilderEditorAgentChat] chat saved", { appId, messages: payload.length });
            } catch (e) {
                console.warn("Failed to save chat history", e);
                if (debugChatIo()) {
                    console.log("[AppBuilderEditorAgentChat] chat save failed", {
                        appId,
                        uid: user?.uid || null,
                        path: `kloner_users/${user?.uid || "<no-uid>"}/kloner_apps/${appId}/ai_chat/default`,
                    });
                }
            }
        },
        [appId, buildChatPayload, debugChatIo, fetchWithScopeRetry, isHydrated, user?.uid, withCsrfHeaders],
    );

    const dismissMessage = useCallback(
        (messageId: string) => {
            if (!messageId) return;

            // Cancel pending debounce and persist immediately.
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }

            setMessages((prev) => {
                const next = prev.filter((m) => m.id !== messageId);
                void saveChatNow(next);
                return next;
            });
        },
        [saveChatNow],
    );

    const copyMessageText = useCallback(
        async (message: Message) => {
            const text = String(message.content || "").trim();
            if (!text) return;

            try {
                if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else if (typeof document !== "undefined") {
                    const textarea = document.createElement("textarea");
                    textarea.value = text;
                    textarea.setAttribute("readonly", "true");
                    textarea.style.position = "fixed";
                    textarea.style.opacity = "0";
                    document.body.appendChild(textarea);
                    textarea.focus();
                    textarea.select();
                    document.execCommand("copy");
                    document.body.removeChild(textarea);
                }

                setCopiedMessageId(message.id);
                window.setTimeout(() => {
                    setCopiedMessageId((current) => (current === message.id ? null : current));
                }, 1500);
            } catch {
                void showAlert("Could not copy this message. Please copy it manually.", "Copy failed");
            }
        },
        [showAlert],
    );

    // Save chat history via server (debounced)
    useEffect(() => {
        if (!isHydrated) return;
        if (!initialLoadCompletedRef.current) return;
        if (!user?.uid || !appId) return;

        if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = window.setTimeout(async () => {
            try {
                const payload = buildChatPayload(messages);

                // Skip writes if nothing changed since last successful save.
                const raw = JSON.stringify(payload);
                if (lastSavedPayloadRef.current === raw) {
                    if (debugChatIo()) console.log("[AppBuilderEditorAgentChat] chat save skipped (unchanged)", { appId });
                    return;
                }

                await ensureSessionAndCsrf().catch(() => null);
                const headers = await withCsrfHeaders();
                const res = await fetchWithScopeRetry(
                    `/api/app-builder/${appId}/ai-chat`,
                    { method: "POST", headers, body: JSON.stringify({ messages: payload }) },
                    { retryLabel: "save ai chat debounced" },
                );
                if (!res.ok) {
                    throw new Error(`Chat save failed: ${res.status}`);
                }

                lastSavedPayloadRef.current = raw;
                if (debugChatIo()) console.log("[AppBuilderEditorAgentChat] chat saved", { appId, messages: payload.length });
            } catch (e) {
                // Non-fatal: chat still works, just won't persist.
                console.warn("Failed to save chat history", e);
                if (debugChatIo()) {
                    console.log("[AppBuilderEditorAgentChat] chat save failed", {
                        appId,
                        uid: user?.uid || null,
                        path: `kloner_users/${user?.uid || "<no-uid>"}/kloner_apps/${appId}/ai_chat/default`,
                    });
                }
            }
        }, 750);

        return () => {
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };
    }, [appId, buildChatPayload, debugChatIo, fetchWithScopeRetry, isHydrated, messages, user?.uid, withCsrfHeaders]);

    const createCheckpoint = useCallback((description: string) => {
        const checkpointId = `checkpoint_${Date.now()}`;
        const checkpoint: Checkpoint = {
            id: checkpointId,
            timestamp: new Date(),
            description,
            files: Object.fromEntries(
                Object.entries(files).map(([path, file]) => [path, file.content])
            ),
        };
        setCheckpoints(prev => [...prev, checkpoint]);
        setCurrentCheckpoint(checkpointId);
    }, [files]);

    const applyStagedBundle = useCallback(async (bundleId: string, options?: { unsafe?: boolean }) => {
        const bundle = stagedBundles.find((entry) => entry.id === bundleId);
        if (!bundle) return;

        const restorePointId = await createRestorePointBeforeApply(
            bundle.label || "Apply staged edits",
            bundle.ops.map((op) => op.path),
        );

        if (!restorePointId) {
            setMessages((msgs) => [
                ...msgs,
                {
                    id: `staged_restore_failed_${Date.now()}`,
                    role: "assistant",
                    content:
                        "I couldn’t create a restore point for this change, so I stopped before applying the staged edits.",
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
            return;
        }

        setLastRestorePointId(restorePointId);
        void fetchRestorePoints();

        // Always create a local checkpoint right before applying.
        createCheckpoint(bundle.label || "Apply staged edits");

        const headers = await withCsrfHeaders();
        const applyResult = await applyEditPlanOps({ appId, ops: bundle.ops, code: null }, headers);
        if (!applyResult.ok) {
            setMessages((msgs) => [
                ...msgs,
                {
                    id: `staged_apply_failed_${Date.now()}`,
                    role: "assistant",
                    content: String(applyResult.error || "Failed to apply staged code changes."),
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
            return;
        }

        await syncFilesFromServer({ applyToState: true }).catch(() => null);

        if (bundle.needsRebuild) {
            await runPostMigrationRefreshPipeline();
        }

        // Clear linkage so the modal doesn't keep showing staged actions.
        setMessages((msgs) =>
            msgs.map((m) => (m.stagedBundleId === bundleId ? { ...m, stagedBundleId: undefined } : m))
        );

        // Emit a small chat note.
        setMessages((msgs) => [
            ...msgs,
            {
                id: `staged_applied_${Date.now()}`,
                role: "assistant",
                content: options?.unsafe
                    ? "Applied the staged code changes (without waiting for the database update). If something breaks, you can undo via the restore point/checkpoint."
                    : "Applied the staged code changes now that the database update is applied.",
                timestamp: new Date(),
                type: "text",
                restorePointId,
                restoreActionLabel: "Undo",
            },
        ]);

        setStagedBundles((prev) => prev.filter((b) => b.id !== bundleId));
    }, [appId, createCheckpoint, createRestorePointBeforeApply, fetchRestorePoints, runPostMigrationRefreshPipeline, stagedBundles, syncFilesFromServer, setLastRestorePointId, withCsrfHeaders]);

    const discardStagedBundle = useCallback((bundleId: string) => {
        setStagedBundles((prev) => prev.filter((b) => b.id !== bundleId));
        setMessages((msgs) => msgs.map((m) => (m.stagedBundleId === bundleId ? { ...m, stagedBundleId: undefined } : m)));
        setMessages((msgs) => [
            ...msgs,
            {
                id: `staged_discarded_${Date.now()}`,
                role: "assistant",
                content: "Discarded the staged code changes. Your app will keep using the last working version.",
                timestamp: new Date(),
                type: "text",
            },
        ]);
    }, []);

    const markMigrationApplied = useCallback((proposalId: string) => {
        setStagedBundles((prev) => {
            if (!proposalId) return prev;
            const next = prev.map((b) =>
                b.proposalIds.includes(proposalId)
                    ? { ...b, appliedProposalIds: { ...b.appliedProposalIds, [proposalId]: true } }
                    : b
            );

            // Auto-apply any bundle that is now fully satisfied.
            const ready = next.filter((b) => b.proposalIds.length > 0 && b.proposalIds.every((id) => b.appliedProposalIds[id]));
            if (ready.length === 0) return next;

            // Apply outside of this setter tick.
            queueMicrotask(() => {
                for (const b of ready) {
                    applyStagedBundle(b.id);
                }
            });

            // Keep bundles until applyStagedBundle removes them.
            return next;
        });
    }, [applyStagedBundle]);

    const buildMigrationRetryPrompt = useCallback(
        (relationName: string | null, errorCode: string | null): string => {
            const relationText = relationName ? `missing relation: ${relationName}` : "missing database relation";
            const codeText = errorCode ? ` (error code ${errorCode})` : "";
            return [
                "Regenerate the migration for the current schema and then prepare it for apply again.",
                `Previous apply failed due to ${relationText}${codeText}.`,
                "Re-check current schema first, then produce corrected SQL and matching app code updates.",
            ].join(" ");
        },
        [],
    );

    const parseMigrationApplyFailure = useCallback((payload: any): MigrationApplyFailure => {
        const errorCode =
            typeof payload?.errorCode === "string" && payload.errorCode.trim()
                ? payload.errorCode.trim().toUpperCase()
                : null;
        const relationName =
            typeof payload?.relationName === "string" && payload.relationName.trim()
                ? payload.relationName.trim()
                : null;
        const code = typeof payload?.code === "string" ? payload.code.trim().toUpperCase() : "";
        const canRegenerate =
            Boolean(payload?.canRegenerateMigration) ||
            code === "SUPABASE_RELATION_MISSING" ||
            errorCode === "42P01" ||
            Boolean(relationName);

        return {
            errorText:
                typeof payload?.error === "string" && payload.error.trim()
                    ? payload.error.trim()
                    : "Could not apply this database update.",
            errorCode,
            relationName,
            canRegenerate,
        };
    }, []);

    const formatMigrationFailureContent = useCallback((failure: MigrationApplyFailure): string => {
        const details: string[] = [];
        if (failure.relationName) {
            details.push(`Missing database item: ${failure.relationName}.`);
        }
        if (failure.errorCode) {
            details.push(`Error code: ${failure.errorCode}.`);
        }
        if (failure.canRegenerate) {
            details.push("Use Regenerate update to rebuild this for your current database.");
        }
        if (!details.length) {
            details.push(failure.errorText || "Please retry.");
        }
        return `Update failed. ${details.join(" ")}`;
    }, []);

    const shouldDedupeMigrationFailure = useCallback(
        (proposalId: string, failure: MigrationApplyFailure): boolean => {
            const key = `${proposalId}:${failure.errorCode || "none"}:${failure.relationName || "none"}`;
            const now = Date.now();
            const last = migrationFailureSeenAtRef.current[key] || 0;
            migrationFailureSeenAtRef.current[key] = now;
            return now - last < 60_000;
        },
        [],
    );

    const handleDatabaseConnect = useCallback((connection: DatabaseConnection) => {
        setDatabaseConnections(prev => [...prev.filter(c => c.id !== connection.id), connection]);
    }, []);

    const handleDatabaseDisconnect = useCallback((id: string) => {
        setDatabaseConnections(prev => prev.filter(c => c.id !== id));
    }, []);

    const enqueueSupabaseContinuationPrompt = useCallback((rawPrompt: string) => {
        const prompt = String(rawPrompt || "").replace(/\s+/g, " ").trim();
        if (!prompt) return;

        setMessages((prev) => {
            const exists = prev.some(
                (m) =>
                    m.supabaseContinuationStatus === "PENDING" &&
                    String(m.supabaseContinuationPrompt || "") === prompt,
            );
            if (exists) return prev;

            return [
                ...prev,
                {
                    id: `supabase_continue_${Date.now()}`,
                    role: "assistant",
                    content:
                        `Supabase is connected successfully.\n\nDo you want me to continue with your original request?\n\n“${prompt}”`,
                    timestamp: new Date(),
                    type: "text",
                    supabaseContinuationPrompt: prompt,
                    supabaseContinuationStatus: "PENDING",
                },
            ];
        });
    }, []);

    const enqueueDatabaseSetupChoicePrompt = useCallback((rawPrompt: string) => {
        const prompt = String(rawPrompt || "").replace(/\s+/g, " ").trim();
        if (!prompt) return;

        setMessages((prev) => {
            const exists = prev.some(
                (m) => m.dbSetupStatus === "PENDING" && String(m.dbSetupPrompt || "") === prompt,
            );
            if (exists) return prev;

            return [
                ...prev,
                {
                    id: `db_setup_choice_${Date.now()}`,
                    role: "assistant",
                    content:
                        "This request usually works best with a database. You can connect Supabase, or continue now with a basic version that skips database persistence.",
                    timestamp: new Date(),
                    type: "text",
                    dbSetupPrompt: prompt,
                    dbSetupStatus: "PENDING",
                },
            ];
        });
    }, []);

    const handleCreateSupabaseProject = useCallback(async () => {
        // Popups opened after an await are often blocked by browsers.
        // Open a blank tab/window synchronously (while we still have the click gesture),
        // then navigate it once we have the OAuth URL.
        let popup: Window | null = null;
        try {
            popup = window.open("about:blank", "_blank", "width=600,height=700");
        } catch {
            popup = null;
        }

        try {
            setShowSupabaseSetup(false);
            setMessages(prev => [...prev, {
                id: `creating_project_${Date.now()}`,
                role: "assistant",
                content: "🔄 **Creating your Supabase project...**\n\nRedirecting you to Supabase to authorize project creation. This will open in a new tab.",
                timestamp: new Date(),
                type: "text"
            }]);

            await ensureSessionAndCsrf().catch(() => null);
            const headers = await withCsrfHeaders();

            // Initiate OAuth flow
            const response = await fetch('/api/supabase/create-project', {
                method: 'POST',
                headers,
                credentials: "include",
                cache: "no-store",
                body: JSON.stringify({ appId }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({} as any));
                const message =
                    typeof error?.message === "string"
                        ? error.message
                        : response.status === 401 || response.status === 403
                            ? "Your session expired. Please refresh the page, log in again, and retry."
                            : "Supabase project creation isn’t configured yet. Ask the admin to set SUPABASE_CLIENT_ID + SUPABASE_CLIENT_SECRET, then retry.";
                throw new Error(message);
            }

            const { authUrl } = await response.json();

            // Navigate the already-opened popup if possible; otherwise fall back to a direct link.
            if (popup && !popup.closed) {
                try {
                    popup.location.href = authUrl;
                    popup.focus();
                } catch {
                    // If navigation is blocked for any reason, fall back to a direct link.
                    popup.close();
                    popup = null;
                }
            }

            if (!popup || popup.closed) {
                setMessages(prev => [...prev, {
                    id: `supabase_oauth_popup_blocked_${Date.now()}`,
                    role: "assistant",
                    content: `⚠️ **Your browser blocked the popup.**\n\nOpen this link to continue:\n${authUrl}\n\n(After approving, come back here and I’ll detect the connection.)`,
                    timestamp: new Date(),
                    type: "text"
                }]);
            }

            // Listen for the OAuth callback via window message or polling
            // We poll for completion and also listen for postMessage from the popup.
            let isDone = false;

            const rebuildPreviewAfterSupabase = async (): Promise<{ ok: boolean; error?: string }> => {
                try {
                    await ensureSessionAndCsrf().catch(() => null);
                    // Pull the latest files from Firestore so the rebuild starts with the updated `.env.local`.
                    await syncFilesFromServer({ applyToState: true }).catch(() => null);

                    if (typeof window !== "undefined") {
                        window.dispatchEvent(
                            new CustomEvent("kloner:preview-force-fresh", {
                                detail: { appId, reason: "supabase" },
                            }),
                        );
                    }

                    return { ok: true };
                } catch (e) {
                    const msg = e instanceof Error ? e.message : "Failed to start preview rebuild";
                    console.warn("Failed to start preview rebuild after Supabase connect", e);
                    return { ok: false, error: msg };
                }
            };

            const promptRestartAfterSupabase = async () => {
                const confirmed = await showConfirm(
                    "Database is connected.\n\nTo finish setup, we need to restart your environment. This can take a minute or two. Restart now?",
                    "Restart Required",
                );

                if (!confirmed) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `supabase_restart_skipped_${Date.now()}`,
                            role: "assistant",
                            content:
                                "⚠️ **Supabase is connected, but your preview is still running with the old env vars.**\n\nWhen you’re ready, click **Rebuild app** so it restarts on a fresh machine and loads the new `.env.local` values.",
                            timestamp: new Date(),
                            type: "text",
                        },
                    ]);
                    return;
                }

                setMessages((prev) => [
                    ...prev,
                    {
                        id: `supabase_restart_start_${Date.now()}`,
                        role: "assistant",
                        content: "🧱 Rebuilding preview from scratch so your new database can take effect…",
                        timestamp: new Date(),
                        type: "text",
                    },
                ]);

                const result = await rebuildPreviewAfterSupabase();
                if (!result.ok) {
                    await showAlert(
                        `Supabase is connected, but starting a fresh rebuild failed.\n\n${result.error || "unknown_error"}\n\nTry clicking **Rebuild app** in the editor header.`,
                        "Rebuild failed",
                    );

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `supabase_restart_failed_${Date.now()}`,
                            role: "assistant",
                            content:
                                `❌ **Couldn’t start a fresh rebuild automatically.**\n\n${result.error || "unknown_error"}\n\nClick **Rebuild app** to restart on a fresh machine and load the Supabase env vars.`,
                            timestamp: new Date(),
                            type: "text",
                        },
                    ]);
                    return;
                }

                setMessages((prev) => [
                    ...prev,
                    {
                        id: `supabase_restart_ok_${Date.now()}`,
                        role: "assistant",
                        content: "✅ Rebuild started. You should see the preview reload; once it’s back up, your database should be fully connected and receive for your next request.",
                        timestamp: new Date(),
                        type: "text",
                    },
                ]);
            };

            const onMessage = async (event: MessageEvent) => {
                try {
                    if (event.origin !== window.location.origin) return;
                    const data: any = event.data;
                    if (!data || data.type !== "kloner:supabase-oauth-result") return;

                    isDone = true;
                    clearInterval(checkCompletion);
                    window.removeEventListener("message", onMessage);

                    if (data.ok) {
                        setMessages(prev => [...prev, {
                            id: `project_created_${Date.now()}`,
                            role: "assistant",
                            content: "✅ **Supabase project created successfully!**\n\nYour new database is ready. I’ve connected it and you can start asking for schema changes safely (propose → confirm → apply).",
                            timestamp: new Date(),
                            type: "text"
                        }]);

                        await promptRestartAfterSupabase();
                        if (pendingSupabaseFollowupPrompt) {
                            enqueueSupabaseContinuationPrompt(pendingSupabaseFollowupPrompt);
                            setPendingSupabaseFollowupPrompt(null);
                        }
                    } else {
                        const details = typeof data.details === "string" ? data.details : "Supabase setup failed";
                        setMessages(prev => [...prev, {
                            id: `create_error_${Date.now()}`,
                            role: "assistant",
                            content: `❌ **Supabase setup failed**\n\n${details}`,
                            timestamp: new Date(),
                            type: "text"
                        }]);
                    }
                } catch {
                    // ignore
                }
            };

            window.addEventListener("message", onMessage);

            const checkCompletion = setInterval(async () => {
                try {
                    const statusResponse = await fetch(`/api/supabase/project-status?appId=${encodeURIComponent(appId)}`, {
                        method: 'GET',
                        credentials: "include",
                        cache: "no-store",
                    });

                    if (statusResponse.ok) {
                        const status = await statusResponse.json();
                        if (status.completed && status.ok === false) {
                            isDone = true;
                            clearInterval(checkCompletion);
                            window.removeEventListener("message", onMessage);
                            setMessages(prev => [...prev, {
                                id: `create_error_${Date.now()}`,
                                role: "assistant",
                                content: `❌ **Supabase setup failed**\n\n${typeof status.error === "string" ? status.error : "Unknown error"}`,
                                timestamp: new Date(),
                                type: "text"
                            }]);
                            return;
                        }
                        if (status.completed) {
                            isDone = true;
                            clearInterval(checkCompletion);
                            window.removeEventListener("message", onMessage);
                            setMessages(prev => [...prev, {
                                id: `project_created_${Date.now()}`,
                                role: "assistant",
                                content: "**Project created successfully!**\n\nEverything is ready to use. Your new system is set up and connected so I can help you manage it automatically.\n\n**What’s ready for you:**\n- A secure place to store your data\n- User access and sign-in support\n- Ready to start adding information\n\nYou can now ask me to add information, organize it, or help with anything you want to build!",
                                timestamp: new Date(),
                                type: "text"
                            }]);

                            await promptRestartAfterSupabase();
                            if (pendingSupabaseFollowupPrompt) {
                                enqueueSupabaseContinuationPrompt(pendingSupabaseFollowupPrompt);
                                setPendingSupabaseFollowupPrompt(null);
                            }
                        }
                    }
                } catch (error) {
                    // Continue polling
                }
            }, 5000); // Check every 5 seconds

            // Stop polling after 5 minutes
            setTimeout(() => {
                if (isDone) return;
                clearInterval(checkCompletion);
                window.removeEventListener("message", onMessage);
            }, 5 * 60 * 1000);

        } catch (error) {
            if (popup && !popup.closed) {
                try {
                    popup.close();
                } catch {
                    // ignore
                }
            }
            console.error('Failed to create Supabase project:', error);
            setMessages(prev => [...prev, {
                id: `create_error_${Date.now()}`,
                role: "assistant",
                content: `❌ **Project creation failed**\n\n${error instanceof Error ? error.message : 'Unknown error occurred'}\n\nPlease try again or create a project manually at [supabase.com](https://supabase.com).`,
                timestamp: new Date(),
                type: "text"
            }]);
        }
    }, [appId, enqueueSupabaseContinuationPrompt, pendingSupabaseFollowupPrompt, showAlert, showConfirm, withCsrfHeaders]);

    const handleConnectExistingSupabaseProject = useCallback(async () => {
        try {
            if (!user?.uid) throw new Error("Not signed in");

            const projectRef = existingSupabaseProjectRef.trim();
            const anonKey = existingSupabaseAnonKey.trim();
            const serviceRoleKey = existingSupabaseServiceRoleKey.trim();

            if (!projectRef) throw new Error("Please enter your Project Reference ID (or Supabase URL).");
            if (!anonKey) throw new Error("Please enter your Supabase anon key.");

            const headers = await withCsrfHeaders();

            const response = await fetch("/api/supabase/connect-existing", {
                method: "POST",
                headers,
                credentials: "include",
                cache: "no-store",
                body: JSON.stringify({
                    projectRef,
                    anonKey,
                    serviceRoleKey: serviceRoleKey || null,
                    // Bind to this specific Kloner app (1:1 guarantee).
                    appId: appId || undefined,
                }),
            });

            const data = await response.json().catch(() => ({} as any));
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || `Failed to connect (HTTP ${response.status})`);
            }

            setShowSupabaseSetup(false);
            setShowSupabaseAdvanced(false);
            setExistingSupabaseProjectRef("");
            setExistingSupabaseAnonKey("");
            setExistingSupabaseServiceRoleKey("");

            setMessages((prev) => [
                ...prev,
                {
                    id: `supabase_connected_existing_${Date.now()}`,
                    role: "assistant",
                    content:
                        "✅ **Supabase connected**\n\nI saved your existing Supabase project connection.\n\nNote: manual connections don’t support one-click migrations via the Supabase Platform API. If you want the safe propose→confirm→apply DB workflow, use **Create New Supabase Project** (OAuth).",
                    timestamp: new Date(),
                    type: "text",
                },
            ]);

            if (pendingSupabaseFollowupPrompt) {
                enqueueSupabaseContinuationPrompt(pendingSupabaseFollowupPrompt);
                setPendingSupabaseFollowupPrompt(null);
            }
        } catch (error) {
            console.error("Failed to connect existing Supabase project:", error);
            setMessages((prev) => [
                ...prev,
                {
                    id: `supabase_existing_connect_error_${Date.now()}`,
                    role: "assistant",
                    content: `❌ **Couldn’t connect Supabase**\n\n${error instanceof Error ? error.message : "Unknown error"}`,
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
        }
    }, [enqueueSupabaseContinuationPrompt, existingSupabaseAnonKey, existingSupabaseProjectRef, existingSupabaseServiceRoleKey, pendingSupabaseFollowupPrompt, user?.uid, withCsrfHeaders]);

    const applyRestorePoint = useCallback(async (
        restoreId: string,
        options?: {
            statusMessage?: string;
            redoQuery?: string | null;
            redoCurrentPath?: string | null;
        },
    ): Promise<{ ok: boolean; errorMessage?: string }> => {
        if (!restoreId || isRestoreBusy) return { ok: false, errorMessage: "Could not undo — try again." };
        setIsRestoreBusy(true);

        const previousFiles: { [path: string]: { content: string; lastModified: number } } = {};
        for (const [p, v] of Object.entries(files || {})) {
            if (v && typeof v.content === "string" && typeof v.lastModified === "number") {
                previousFiles[p] = { content: v.content, lastModified: v.lastModified };
            }
        }

        try {
            const headers = await withCsrfHeaders();
            const idToken = await user?.getIdToken?.().catch(() => null);
            if (idToken) {
                headers.Authorization = `Bearer ${idToken}`;
            }

            const v1Res = await fetchWithScopeRetry(
                `/api/v1/app-embeddings/restore-points/${encodeURIComponent(restoreId)}/revert`,
                { method: "POST", headers, body: JSON.stringify({ appId }) },
                { retryLabel: "revert restore point" }
            );

            let res = v1Res;
            let data = await v1Res.json().catch(() => null);

            // Backward-compatible fallback for environments that still use app-builder restore routes.
            if (!v1Res.ok && v1Res.status === 404) {
                res = await fetchWithScopeRetry(
                    `/api/app-builder/${appId}/restore-points/${restoreId}/apply`,
                    { method: "POST", headers, body: JSON.stringify({}) },
                    { retryLabel: "apply restore point" }
                );
                data = await res.json().catch(() => null);
            }

            if (!res.ok || !data?.ok) {
                const normalizedError = getRestoreErrorMessage(
                    res.status,
                    typeof data?.code === "string" ? data.code : null,
                    typeof data?.error === "string" ? data.error : "Could not undo — try again.",
                );
                throw new Error(normalizedError);
            }

            const newId = typeof data?.newRestorePointId === "string"
                ? data.newRestorePointId
                : typeof data?.restorePointId === "string"
                    ? data.restorePointId
                    : null;
            if (newId) setLastRestorePointId(newId);

            setEditHistory((prev) => {
                const nextUndoStack = prev.undoStack.filter((entry) => entry.restorePointId !== restoreId);
                const redoQuery = String(options?.redoQuery || "").trim();
                const nextRedoQueue = redoQuery
                    ? [{ query: redoQuery, currentPath: options?.redoCurrentPath || null }, ...prev.redoQueue]
                    : prev.redoQueue;

                return {
                    undoStack: nextUndoStack,
                    redoQueue: nextRedoQueue,
                };
            });
            setKeepUndoPrompt((prev) => (prev?.restorePoint.restorePointId === restoreId ? null : prev));
            setKeepUndoError(null);
            setHistoryToast("Edit undone. Your project has been restored.");

            setMessages(prev => [
                ...prev,
                {
                    id: `restore_${Date.now()}`,
                    role: "assistant",
                    content: options?.statusMessage || "Edit undone. Your project has been restored.",
                    timestamp: new Date(),
                    type: "text",
                    restorePointId: newId || undefined,
                    restoreActionLabel: newId ? "Redo" : undefined,
                },
            ]);

            const restoredFiles = await syncFilesFromServer({ applyToState: false });
            if (!restoredFiles) {
                throw new Error("Restore applied, but failed to fetch restored files.");
            }

            // Important ordering:
            // 1) Let the editor suppress its normal onFilesReplace auto-apply.
            // 2) Apply an explicit diff to the running webcontainer.
            // 3) Then replace editor state with restored files.
            try {
                await onRestoreApplied?.({ previousFiles, restoredFiles });
            } catch (e) {
                console.error("onRestoreApplied failed", e);
            }

            if (onFilesReplace) onFilesReplace(restoredFiles);

            // Explicit post-undo rehydrate to pick up any delayed backend writes
            // and keep index html style entry files aligned with server state.
            await syncFilesFromServer({ applyToState: true }).catch(() => null);

            if (typeof window !== "undefined") {
                window.dispatchEvent(
                    new CustomEvent("kloner:preview-force-fresh", {
                        detail: { appId, reason: "restore-point-revert" },
                    }),
                );
            }

            if (data?.requiresRestart) {
                setEditPlanApplyStatusMessage("Restore applied. Preview restart is required.");
            }

            await fetchRestorePoints();
            return { ok: true };
        } catch (err) {
            console.error("Apply restore point failed", err);
            const errorMessage = String((err as any)?.message || "Could not undo — try again.");
            setMessages(prev => [
                ...prev,
                {
                    id: `restore_err_${Date.now()}`,
                    role: "assistant",
                    content: errorMessage,
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
            return { ok: false, errorMessage };
        } finally {
            setIsRestoreBusy(false);
        }
    }, [appId, fetchRestorePoints, fetchWithScopeRetry, files, getRestoreErrorMessage, isRestoreBusy, onFilesReplace, onRestoreApplied, syncFilesFromServer, user?.getIdToken, withCsrfHeaders]);

    const getStatusMessageForAction = useCallback((label?: string) => {
        const v = (label || "").toLowerCase();
        if (v === "undo") return "Undid change";
        if (v === "redo") return "Redid change";
        return "Applied restore point";
    }, []);

    const keepRestorePoint = useCallback(async (restoreId: string) => {
        if (!restoreId || isRestoreBusy) return;
        setIsRestoreBusy(true);
        try {
            const headers = await withCsrfHeaders();
            const res = await fetchWithScopeRetry(
                `/api/app-builder/${appId}/restore-points/${restoreId}/keep`,
                { method: "POST", headers, body: JSON.stringify({}) },
                { retryLabel: "keep restore point" }
            );
            if (!res.ok) throw new Error("Failed to keep restore point");
            await fetchRestorePoints();
        } catch (err) {
            console.error("Keep restore point failed", err);
        } finally {
            setIsRestoreBusy(false);
        }
    }, [appId, fetchRestorePoints, fetchWithScopeRetry, isRestoreBusy, withCsrfHeaders]);

    const createManualRestorePoint = useCallback(async () => {
        if (isRestoreBusy) return;
        setIsRestoreBusy(true);
        try {
            const headers = await withCsrfHeaders();
            const res = await fetchWithScopeRetry(
                `/api/app-builder/${appId}/restore-points`,
                { method: "POST", headers, body: JSON.stringify({ label: "Manual restore point" }) },
                { retryLabel: "create restore point" }
            );
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to create restore point");
            const rid = typeof data?.restorePointId === "string" ? data.restorePointId : null;
            if (rid) setLastRestorePointId(rid);

            setMessages(prev => [
                ...prev,
                {
                    id: `manual_restore_${Date.now()}`,
                    role: "assistant",
                    content: "Saved a restore point.",
                    timestamp: new Date(),
                    type: "text",
                    restorePointId: rid || undefined,
                    restoreActionLabel: "Undo",
                },
            ]);

            await fetchRestorePoints();
        } catch (err) {
            console.error("Create restore point failed", err);
        } finally {
            setIsRestoreBusy(false);
        }
    }, [appId, fetchRestorePoints, fetchWithScopeRetry, isRestoreBusy, withCsrfHeaders]);

    const keepCurrentEdit = useCallback(() => {
        if (!keepUndoPrompt) return;
        pushRestorePointToUndoStack(keepUndoPrompt.restorePoint);
        setKeepUndoPrompt(null);
        setKeepUndoError(null);
    }, [keepUndoPrompt, pushRestorePointToUndoStack]);

    const undoCurrentEdit = useCallback(async () => {
        if (!keepUndoPrompt) return;
        if (!keepUndoPrompt.restorePoint.restorable) {
            setKeepUndoError("Undo unavailable — one or more files were too large to snapshot.");
            return;
        }
        setKeepUndoError(null);

        const result = await applyRestorePoint(keepUndoPrompt.restorePoint.restorePointId, {
            statusMessage: "Edit undone. Your project has been restored.",
            redoQuery: keepUndoPrompt.restorePoint.query,
            redoCurrentPath: keepUndoPrompt.restorePoint.currentPath,
        });

        if (result.ok) {
            setKeepUndoPrompt(null);
            return;
        }

        setKeepUndoError(result.errorMessage || "Could not undo — try again.");
    }, [applyRestorePoint, keepUndoPrompt]);

    const redoLastUndo = useCallback(async () => {
        if (isLoading) return;
        const item = editHistory.redoQueue[0];
        if (!item || !String(item.query || "").trim()) return;

        setEditHistory((prev) => ({
            ...prev,
            redoQueue: prev.redoQueue.slice(1),
        }));
        setHistoryToast("Redo queued. Re-running the previous edit request.");

        await sendMessage({
            forcedInput: item.query,
            forcedCurrentPath: item.currentPath,
        });
    }, [editHistory.redoQueue, isLoading]);

    const undoLastChange = useCallback(() => {
        if (lastRestorePointId) {
            void applyRestorePoint(lastRestorePointId, {
                statusMessage: "Undid last change",
                redoQuery: lastEditPlanPromptRef.current || "",
                redoCurrentPath: currentFile || null,
            });
            return;
        }
        if (checkpoints.length > 1) {
            const lastCheckpoint = checkpoints[checkpoints.length - 2];
            setCurrentCheckpoint(lastCheckpoint.id);
            Object.entries(lastCheckpoint.files).forEach(([path, content]) => {
                onFileEdit(path, content);
            });
            setCheckpoints(prev => prev.slice(0, -1));
        }
    }, [applyRestorePoint, checkpoints, currentFile, lastRestorePointId, onFileEdit]);

    const sendMessage = async (opts?: {
        forcedInput?: string;
        forcedCurrentPath?: string | null;
        forcedCompileFixContext?: CompileErrorQuickFixContext;
        allowWhenChatDisabled?: boolean;
        hideUserMessage?: boolean;
        bypassInitialSearch?: boolean;
    }) => {
        const messageInput = typeof opts?.forcedInput === "string" ? opts.forcedInput : input;
        const activeCompileFixContext = opts?.forcedCompileFixContext ?? freeCompileFixContext;
        const allowWhenChatDisabled = opts?.allowWhenChatDisabled === true;
        const hideUserMessage = opts?.hideUserMessage === true;
        const bypassInitialSearch = opts?.bypassInitialSearch === true;
        const shouldRestoreInput = typeof opts?.forcedInput !== "string";

        if (chatDisabled && !allowWhenChatDisabled) return;
        if (!messageInput.trim() || isLoading) return;

        const compileFixPrefill = activeCompileFixContext ? buildCompileFixPrefill(activeCompileFixContext) : "";
        const isFreeCompileFixMode = Boolean(activeCompileFixContext && messageInput === compileFixPrefill);

        // Special-case: applying a previously proposed migration.
        // This should not spend AI credits and should not hit /api/ai-agent.
        const applyMatch = messageInput.trim().match(/^APPLY\s+([0-9a-fA-F-]{36})$/);
        if (applyMatch) {
            const proposalId = applyMatch[1];
            const userMessage: Message = {
                id: `user_${Date.now()}`,
                role: "user",
                content: messageInput.trim(),
                timestamp: new Date(),
                type: "text",
            };

            if (!hideUserMessage) {
                setMessages((prev) => [...prev, userMessage]);
                onUserMessageSent?.();
            }
            setInput("");
            setIsLoading(true);

            try {
                const headers = await withCsrfHeaders();

                const health = await checkSupabaseDbHealth({ silent: true });
                if (!health.reachable) {
                    const detail = health?.error || supabaseDbStatusText || "Database not reachable";
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `mig_blocked_${Date.now()}`,
                            role: "assistant",
                            content:
                                `I can’t apply that migration right now because Supabase isn’t reachable.\n\n${detail}\n\nOpen **Connect Database** and reconnect Supabase (your project may have been paused/deleted).`,
                            timestamp: new Date(),
                            type: "text",
                            migrationProposalId: proposalId,
                            migrationStatus: "FAILED",
                        },
                    ]);
                    return;
                }

                setApplyingMigrationIds((prev) => ({ ...prev, [proposalId]: true }));

                const res = await fetch("/api/supabase/migrations/apply", {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ proposalId, confirm: `APPLY ${proposalId}`, appId }),
                });

                const json = await res.json().catch(() => ({} as any));

                if (!res.ok || json?.ok === false) {
                    const failure = parseMigrationApplyFailure(json);
                    const deduped = shouldDedupeMigrationFailure(proposalId, failure);
                    if (!deduped) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: `mig_fail_${Date.now()}`,
                                role: "assistant",
                                content: formatMigrationFailureContent(failure),
                                timestamp: new Date(),
                                type: "text",
                                migrationProposalId: proposalId,
                                migrationStatus: "FAILED",
                                migrationErrorCode: failure.errorCode || undefined,
                                migrationRelationName: failure.relationName || undefined,
                                migrationCanRegenerate: failure.canRegenerate || undefined,
                                migrationRetryPrompt: failure.canRegenerate
                                    ? buildMigrationRetryPrompt(failure.relationName, failure.errorCode)
                                    : undefined,
                            },
                        ]);
                    }
                    return;
                }

                setMessages((prev) => [
                    ...prev,
                    {
                        id: `mig_ok_${Date.now()}`,
                        role: "assistant",
                        content: "Migration applied.",
                        timestamp: new Date(),
                        type: "text",
                        migrationProposalId: proposalId,
                        migrationStatus: "APPLIED",
                    },
                ]);

                // If we staged code edits behind this migration, apply them now.
                markMigrationApplied(proposalId);
                await runPostMigrationRefreshPipeline();
            } catch (err) {
                console.error("Migration apply error:", err);
                const failure: MigrationApplyFailure = {
                    errorText: "Sorry, I couldn’t apply that migration. Please retry.",
                    errorCode: null,
                    relationName: null,
                    canRegenerate: false,
                };
                if (!shouldDedupeMigrationFailure(proposalId, failure)) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `mig_err_${Date.now()}`,
                            role: "assistant",
                            content: formatMigrationFailureContent(failure),
                            timestamp: new Date(),
                            type: "text",
                            migrationProposalId: proposalId,
                            migrationStatus: "FAILED",
                        },
                    ]);
                }
            } finally {
                setApplyingMigrationIds((prev) => {
                    const next = { ...prev };
                    delete next[proposalId];
                    return next;
                });
                setIsLoading(false);
            }
            return;
        }

        // If we can see the remaining balance and it's exhausted, block early.
        if (!isFreeCompileFixMode && typeof aiCreditsRemaining === "number" && aiCreditsRemaining <= 0) {
            const topup = "/price#topup";
            const errorMessage: Message = {
                id: `error_${Date.now()}`,
                role: "assistant",
                content:
                    `You have used all AI edit credits for this month.\nAdd credits: ${topup}`,
                timestamp: new Date(),
                type: "text",
            };
            setMessages((prev) => [...prev, errorMessage]);
            return;
        }

        const userMessage: Message = {
            id: `user_${Date.now()}`,
            role: "user",
            content: messageInput,
            timestamp: new Date(),
            type: "text"
        };

        if (!hideUserMessage) {
            setMessages(prev => [...prev, userMessage]);
            onUserMessageSent?.();
        }
        setInput("");
        setIsLoading(true);
        lastEditPlanPromptRef.current = messageInput;

        try {
            const headers = await withCsrfHeaders();
            const searchRequestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `search_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            const requestHeaders = {
                ...headers,
                "x-request-id": searchRequestId,
                "x-client-request-id": searchRequestId,
            };
            const selectedCurrentFile = typeof opts?.forcedCurrentPath === "string"
                ? (opts.forcedCurrentPath.trim() || null)
                : resolveFallbackCurrentFile(files, currentFile);
            const currentPathDecision = deriveEmbeddingCurrentPath({
                selectedFile: selectedCurrentFile,
                query: messageInput,
                files,
                frameworkInfo: projectFramework,
            });
            const effectiveCurrentFile = currentPathDecision.derivedCurrentPath;
            const currentPathDebug = {
                selectedFile: currentPathDecision.selectedFile,
                derivedCurrentPath: currentPathDecision.derivedCurrentPath,
                intentClassification: currentPathDecision.intentClassification,
                reason: currentPathDecision.reason,
            };
            console.info("[AppBuilderEditorAgentChat] embedding currentPath decision", {
                appId,
                queryPreview: messageInput.slice(0, 200),
                ...currentPathDebug,
            });
            const inquiryRequestedAt = Date.now();
            latestInquiryMetaRef.current = {
                query: messageInput,
                currentPath: effectiveCurrentFile || null,
                requestedAt: inquiryRequestedAt,
                search: bypassInitialSearch
                    ? {
                        request: {
                            skipped: true,
                            reason: "bypassInitialSearch",
                            query: messageInput,
                            currentPath: effectiveCurrentFile || null,
                            debugCurrentPath: currentPathDebug,
                        },
                        response: {
                            skipped: true,
                            reason: "bypassInitialSearch",
                        },
                    }
                    : null,
            };
            const frameworkPrompt = buildProjectFrameworkPrompt(projectFramework, messageInput);
            let scopeRecoveryDuringRun = false;
            let scopeRecoveryRecoveredDuringRun = false;
            const isScopeErrorResult = <T,>(result: { status: number; code?: string | null }) => {
                const code = String(result.code || "").trim().toUpperCase();
                return result.status === 403 && (code === "MISSING_APP_SCOPE" || code === "INVALID_APP_SCOPE");
            };
            const recoverAppScopeForAiRequest = async <T,>(retryLabel: string, request: () => Promise<{ ok: boolean; status: number; code?: string | null } & T>): Promise<{ ok: boolean; status: number; code?: string | null } & T> => {
                const firstResult = await request();
                if (!isScopeErrorResult(firstResult)) return firstResult;

                scopeRecoveryDuringRun = true;

                const warmed = await bootstrapAppScope().catch(() => false);
                dispatchAiAgentEvent("app_scope_recovery", {
                    appId,
                    userId: user?.uid || null,
                    retryLabel,
                    scopeRecovered: warmed,
                    phase: "ai_request_recover",
                });

                if (warmed) {
                    const retryResult = await request();
                    if (!isScopeErrorResult(retryResult)) {
                        scopeRecoveryRecoveredDuringRun = true;
                        return retryResult;
                    }
                }

                notifyScopeRecoveryFailure(retryLabel);
                return firstResult;
            };
            dispatchAiAgentEvent("request", {
                appId,
                userId: user?.uid || null,
                messageLen: messageInput.length,
                messagePreview: messageInput.slice(0, 280),
                historyCount: Math.min(messages.length + 1, 11),
                freeCompileFixMode: isFreeCompileFixMode,
            });

            if (isFreeCompileFixMode && activeCompileFixContext) {
                dispatchAiAgentEvent("compile_error_fix_sent", {
                    appId,
                    code: activeCompileFixContext.code,
                    fingerprint: activeCompileFixContext.compileError.fingerprint,
                    actionType: activeCompileFixContext.actionType,
                    fixAction: activeCompileFixContext.fixAction || null,
                });
            }
            let normalizedSearch = normalizeEmbeddingSearchResponse({});
            let refreshQueuedNotice: string | null = null;
            let summarySearchContext: { request?: Record<string, unknown> | null; response?: Record<string, unknown> | null } | null = null;
            if (!bypassInitialSearch) {
                const searchRequestBody = {
                    appId,
                    query: messageInput,
                    requestText: frameworkPrompt,
                    currentPath: effectiveCurrentFile,
                    debugCurrentPath: currentPathDebug,
                    maxChunks: 10,
                    framework: projectFramework.key,
                    frameworkLabel: projectFramework.label,
                    frameworkConfidence: projectFramework.confidence,
                    frameworkReason: projectFramework.reason,
                };
                const searchRequestBodyBytes = new TextEncoder().encode(JSON.stringify(searchRequestBody)).length;
                const searchStartedAt = Date.now();

                dispatchAiAgentEvent("search_request_start", {
                    appId,
                    userId: user?.uid || null,
                    requestId: searchRequestId,
                    bodySizeBytes: searchRequestBodyBytes,
                    currentPath: effectiveCurrentFile,
                    selectedFile: currentPathDebug.selectedFile,
                    intentClassification: currentPathDebug.intentClassification,
                    currentPathReason: currentPathDebug.reason,
                    maxChunks: 10,
                    queryLen: messageInput.length,
                });

                const searchResult = await recoverAppScopeForAiRequest(
                    "embedding search",
                    () => fetchEmbeddingSearch(searchRequestBody, requestHeaders),
                );

                if (scopeRecoveryDuringRun) {
                    const scopeMessage = scopeRecoveryRecoveredDuringRun
                        ? "I had to refresh this app session before searching files. Please run your request again so I can continue safely."
                        : "This app session needs a fresh start. Please reopen the app in App Builder and try again.";
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `scope_recovery_search_${Date.now()}`,
                            role: "assistant",
                            content: scopeMessage,
                            timestamp: new Date(),
                            type: "text",
                        },
                    ]);
                    return;
                }

                if (isScopeErrorResult(searchResult)) {
                    return;
                }

                normalizedSearch = normalizeEmbeddingSearchResponse(searchResult.data);
                let searchElapsedMs = Date.now() - searchStartedAt;

                const shouldRetrySearchForStructuralUi =
                    looksLikeStructuralUiRequest(messageInput) &&
                    !isStructuralSearchResult(normalizedSearch.chunks);

                if (searchResult.ok && shouldRetrySearchForStructuralUi) {
                    const structuralHintText = `Prefer structural targets like ${STRUCTURAL_UI_HINTS.join(", ")}.`;
                    const structuralSearchBody = {
                        ...searchRequestBody,
                        requestText: `${frameworkPrompt}\n\n${structuralHintText}`,
                        query: `${messageInput}\n\n${structuralHintText}`,
                    };
                    const structuralSearchResult = await recoverAppScopeForAiRequest(
                        "structural embedding search",
                        () => fetchEmbeddingSearch(structuralSearchBody, requestHeaders),
                    );

                    if (isScopeErrorResult(structuralSearchResult)) {
                        return;
                    }

                    if (structuralSearchResult.ok) {
                        const structuralNormalizedSearch = normalizeEmbeddingSearchResponse(structuralSearchResult.data);
                        if (structuralNormalizedSearch.chunks.length > 0 && isStructuralSearchResult(structuralNormalizedSearch.chunks)) {
                            dispatchAiAgentEvent("search_request_retry", {
                                appId,
                                userId: user?.uid || null,
                                requestId: searchRequestId,
                                reason: "structural_hints",
                                initialChunkCount: normalizedSearch.chunks.length,
                                retryChunkCount: structuralNormalizedSearch.chunks.length,
                            });
                            normalizedSearch.chunks.splice(0, normalizedSearch.chunks.length, ...structuralNormalizedSearch.chunks);
                            normalizedSearch.refreshQueued = structuralNormalizedSearch.refreshQueued;
                            searchElapsedMs = Date.now() - searchStartedAt;
                        }
                    }
                }

                summarySearchContext = {
                    request: searchRequestBody as Record<string, unknown>,
                    response: {
                        ok: searchResult.ok,
                        status: searchResult.status,
                        code: searchResult.code || null,
                        requestId: searchResult.requestId || null,
                        retryAfter: searchResult.retryAfter || null,
                        refreshQueued: normalizedSearch.refreshQueued === true,
                        returned: typeof (searchResult.data as any)?.returned === "number" ? (searchResult.data as any).returned : null,
                        candidates: Array.isArray((searchResult.data as any)?.candidates)
                            ? (searchResult.data as any).candidates.length
                            : null,
                        chunks: normalizedSearch.chunks.slice(0, 10).map((chunk) => ({
                            path: chunk.path,
                            lineRange: chunk.lineRange,
                            chunkIndex: chunk.chunkIndex,
                            similarity: chunk.similarity,
                        })),
                    },
                };
                latestInquiryMetaRef.current = {
                    query: messageInput,
                    currentPath: effectiveCurrentFile || null,
                    requestedAt: inquiryRequestedAt,
                    search: summarySearchContext,
                };

                dispatchAiAgentEvent("search_request_end", {
                    appId,
                    userId: user?.uid || null,
                    requestId: searchRequestId,
                    ok: searchResult.ok,
                    status: searchResult.status,
                    code: searchResult.code || null,
                    elapsedMs: searchElapsedMs,
                    chunksLength: normalizedSearch.chunks.length,
                    refreshQueued: normalizedSearch.refreshQueued === true,
                    returned: typeof (searchResult.data as any)?.returned === "number" ? (searchResult.data as any).returned : null,
                    candidates: Array.isArray((searchResult.data as any)?.candidates)
                        ? (searchResult.data as any).candidates.length
                        : null,
                });

                if (!searchResult.ok) {
                    if (searchResult.status === 409 && normalizedSearch.chunks.length === 0) {
                        const normalizedSearchCode = String(searchResult.code || "").trim().toUpperCase();
                        const retryAfterSeconds = (() => {
                            const fromBody = Number((searchResult.data as any)?.retryAfterSeconds);
                            if (Number.isFinite(fromBody) && fromBody >= 0) return Math.max(0, Math.ceil(fromBody));
                            const fromHeader = Number(searchResult.retryAfter);
                            if (Number.isFinite(fromHeader) && fromHeader >= 0) return Math.max(0, Math.ceil(fromHeader));
                            return null;
                        })();
                        const reqId = searchResult.requestId || (searchResult.data as any)?.requestId || (searchResult.data as any)?.reqId || null;
                        const retryHint = retryAfterSeconds !== null
                            ? ` Please retry in about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`
                            : " Please retry in a moment.";
                        const softStopMessage = normalizedSearchCode === "EMBEDDING_CHUNK_FETCH_INCOMPLETE"
                            ? `I couldn’t finish fetching enough file context for this request.${retryHint}`
                            : "The file search is still updating. I don’t have grounded context yet, so try again in a moment.";

                        dispatchAiAgentEvent("search_request_soft_stop", {
                            appId,
                            userId: user?.uid || null,
                            requestId: searchRequestId,
                            status: searchResult.status,
                            code: searchResult.code || null,
                            retryAfterSeconds,
                            elapsedMs: searchElapsedMs,
                            chunksLength: 0,
                        });

                        setMessages(prev => [
                            ...prev,
                            {
                                id: `search_note_${Date.now()}`,
                                role: "assistant",
                                content: [
                                    softStopMessage,
                                    reqId ? `Request ID: ${reqId}` : null,
                                ].filter(Boolean).join("\n"),
                                timestamp: new Date(),
                                type: "text",
                            },
                        ]);
                        return;
                    }

                    dispatchAiAgentEvent("response_error", {
                        appId,
                        userId: user?.uid || null,
                        status: searchResult.status,
                    });
                    const errorCode =
                        searchResult.code ||
                        (searchResult.status === 409
                            ? "EMBEDDING_INDEX_STALE"
                            : searchResult.status === 503
                                ? "EMBEDDING_MEMORY_PRESSURE"
                                : searchResult.status === 504
                                    ? "EMBEDDING_SEARCH_TIMEOUT"
                                    : searchResult.status === 429
                                        ? "EMBEDDING_SEARCH_RATE_LIMITED"
                                        : "EMBEDDING_SEARCH_FAILED");
                    const searchError = new Error(
                        getEmbeddingSearchErrorMessage(searchResult.status, searchResult.code, searchResult.error),
                    );
                    (searchError as any).status = searchResult.status;
                    (searchError as any).code = errorCode;
                    (searchError as any).retryPrompt = messageInput;
                    throw searchError;
                }

                refreshQueuedNotice = getEmbeddingSearchRefreshQueuedNotice(normalizedSearch);
            }

            let editPlanResult = await recoverAppScopeForAiRequest(
                "edit plan",
                () => fetchEmbeddingEditPlan(
                    {
                        appId,
                        query: messageInput,
                        requestText: frameworkPrompt,
                        currentPath: effectiveCurrentFile,
                        debugCurrentPath: currentPathDebug,
                        maxChunks: 10,
                    },
                    requestHeaders,
                ),
            );

            if (isScopeErrorResult(editPlanResult)) {
                return;
            }

            if (!editPlanResult.ok) {
                dispatchAiAgentEvent("response_error", {
                    appId,
                    userId: user?.uid || null,
                    status: editPlanResult.status,
                });

                if (isEditPlanBackpressureResult(editPlanResult)) {
                    const backpressureMessage = formatEditPlanBackpressureMessage(editPlanResult);
                    if (shouldRestoreInput) {
                        setInput(messageInput);
                    }
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `edit_plan_backpressure_${Date.now()}`,
                            role: "assistant",
                            content: backpressureMessage,
                            timestamp: new Date(),
                            type: "text",
                            retryPrompt: messageInput,
                            retryStatus: 429,
                            editPlanRetryPrompt: messageInput,
                            editPlanRetryCurrentPath: effectiveCurrentFile || null,
                        },
                    ]);
                    return;
                }

                const editPlanErrorCode =
                    editPlanResult.code ||
                    (editPlanResult.status === 409
                        ? "EMBEDDING_INDEX_STALE"
                        : editPlanResult.status === 503
                            ? "EMBEDDING_MEMORY_PRESSURE"
                            : editPlanResult.status === 504
                                ? "EMBEDDING_SEARCH_TIMEOUT"
                                : editPlanResult.status === 429
                                    ? "EDIT_PLAN_RATE_LIMITED"
                                    : "EDIT_PLAN_FAILED");
                const editPlanRequestId = editPlanResult.requestId || null;
                const retryDelaySeconds = parseRetryDelaySeconds(editPlanResult);
                const isBusy = isBusyEditPlanStatus(editPlanResult.status, editPlanErrorCode);
                const hasRetryDelay = typeof retryDelaySeconds === "number" && retryDelaySeconds > 0;
                const isRetryablePause = isBusy && hasRetryDelay;

                if (isBusy && !isRetryablePause) {
                    const pauseMessage = buildEditPlanPauseMessage(editPlanRequestId, editPlanErrorCode);
                    await showAlert(pauseMessage, "We’re busy right now");
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `edit_plan_busy_${Date.now()}`,
                            role: "assistant",
                            content: pauseMessage,
                            timestamp: new Date(),
                            type: "text",
                            retryPrompt: messageInput,
                            retryStatus: 503,
                            editPlanRetryPrompt: messageInput,
                            editPlanRetryCurrentPath: effectiveCurrentFile || null,
                        },
                    ]);
                    return;
                }

                if (isRetryablePause) {
                    const pauseMessage = buildEditPlanPauseMessage(editPlanRequestId, editPlanErrorCode);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `edit_plan_busy_${Date.now()}`,
                            role: "assistant",
                            content: pauseMessage,
                            timestamp: new Date(),
                            type: "text",
                            retryPrompt: messageInput,
                            retryStatus: 503,
                            editPlanRetryPrompt: messageInput,
                            editPlanRetryCurrentPath: effectiveCurrentFile || null,
                        },
                    ]);
                    setIsLoading(false);
                    await waitMs(Math.min(retryDelaySeconds * 1000, 45_000));
                    setIsLoading(true);

                    const retryEditPlanResult = await recoverAppScopeForAiRequest(
                        "edit plan retry",
                        () => fetchEmbeddingEditPlan(
                            {
                                appId,
                                query: messageInput,
                                requestText: frameworkPrompt,
                                currentPath: effectiveCurrentFile,
                                debugCurrentPath: currentPathDebug,
                                maxChunks: 10,
                            },
                            requestHeaders,
                        ),
                    );

                    if (isScopeErrorResult(retryEditPlanResult)) {
                        return;
                    }

                    if (!retryEditPlanResult.ok) {
                        const retryCode = retryEditPlanResult.code || editPlanErrorCode;
                        const retryRequestId = retryEditPlanResult.requestId || editPlanRequestId || null;
                        const retryReason = retryEditPlanResult.error || "We’re busy processing other requests right now.";
                        const terminalMessage = buildEditPlanTerminalMessage(retryRequestId, retryCode, retryReason);
                        const terminalMessageText = buildEditPlanTerminalSummary(retryRequestId, retryCode, retryReason);

                        await showAlert(terminalMessage, "Update couldn’t finish");
                        dispatchAiAgentEvent("edit_plan_failure_shown", {
                            code: retryCode,
                            jobStatus: null,
                            httpStatus: retryEditPlanResult.status,
                            jobId: null,
                            requestId: retryRequestId,
                            retryable: true,
                        });
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: `edit_plan_terminal_${Date.now()}`,
                                role: "assistant",
                                content: terminalMessageText,
                                timestamp: new Date(),
                                type: "text",
                                retryPrompt: messageInput,
                                retryStatus: 503,
                                editPlanRetryPrompt: messageInput,
                                editPlanRetryCurrentPath: effectiveCurrentFile || null,
                                editPlanFailure: true,
                                editPlanFailureCode: retryCode,
                                editPlanFailureRequestId: retryRequestId || undefined,
                                editPlanFailureHttpStatus: retryEditPlanResult.status,
                            },
                        ]);
                        return;
                    }

                    editPlanResult = retryEditPlanResult;
                }

                const isMissingContext = editPlanResult.status === 409 || editPlanErrorCode === "EMBEDDING_INDEX_STALE";
                const isTerminalEditPlanFailure =
                    isMissingContext ||
                    editPlanResult.status === 502 ||
                    editPlanResult.status === 504 ||
                    editPlanErrorCode === "EMBEDDING_EDIT_PLAN_FAILED" ||
                    (editPlanResult.status === 500 && !editPlanResult.retryAfter && !(editPlanResult.data as any)?.retryAfterSeconds);

                if (isTerminalEditPlanFailure) {
                    const requestIdText = editPlanResult.requestId || editPlanRequestId || "unknown";
                    const reasonText = editPlanResult.error || "The update could not be completed.";
                    const terminalMessage = buildEditPlanTerminalMessage(requestIdText, editPlanErrorCode, reasonText);
                    const terminalMessageText = buildEditPlanTerminalSummary(requestIdText, editPlanErrorCode, reasonText);

                    await showAlert(terminalMessage, "Update couldn’t finish");
                    dispatchAiAgentEvent("edit_plan_failure_shown", {
                        code: editPlanErrorCode,
                        jobStatus: null,
                        httpStatus: editPlanResult.status,
                        jobId: null,
                        requestId: requestIdText,
                        retryable: true,
                    });
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `edit_plan_failed_${Date.now()}`,
                            role: "assistant",
                            content: terminalMessageText,
                            timestamp: new Date(),
                            type: "text",
                            retryPrompt: messageInput,
                            retryStatus: 503,
                            editPlanRetryPrompt: messageInput,
                            editPlanRetryCurrentPath: effectiveCurrentFile || null,
                            editPlanFailure: true,
                            editPlanFailureCode: editPlanErrorCode,
                            editPlanFailureRequestId: requestIdText,
                            editPlanFailureHttpStatus: editPlanResult.status,
                        },
                    ]);
                    return;
                }

                const editPlanError = new Error(
                    getEmbeddingSearchErrorMessage(editPlanResult.status, editPlanResult.code, editPlanResult.error),
                );
                (editPlanError as any).status = editPlanResult.status;
                (editPlanError as any).code = editPlanErrorCode;
                (editPlanError as any).retryPrompt = messageInput;
                (editPlanError as any).requestId = editPlanResult.requestId || null;
                (editPlanError as any).phase = "edit-plan";
                throw editPlanError;
            }

            const rawPlan = normalizeEmbeddingEditPlanResponse(editPlanResult.data);
            const queuedResponseLike = editPlanResult.status === 202 || rawPlan.queued === true || Boolean(rawPlan.statusUrl) || Boolean(rawPlan.jobId) || Boolean(rawPlan.job?.statusUrl) || Boolean(rawPlan.job?.jobId);
            const queuedJob = queuedResponseLike ? normalizeEmbeddingEditPlanJobStatus(rawPlan.job || rawPlan) : null;
            const queuedStatusUrl = rawPlan.statusUrl || queuedJob?.statusUrl || null;
            if (queuedResponseLike && (!queuedJob || !queuedStatusUrl)) {
                const queuedErrorMessage = "The edit-plan job was accepted, but the backend did not return a status URL to poll.";
                await showAlert(
                    <div className="space-y-2">
                        <div className="text-sm text-neutral-800">{queuedErrorMessage}</div>
                        <div className="text-xs text-neutral-600">Request ID: {rawPlan.requestId || editPlanResult.requestId || "unknown"}</div>
                    </div>,
                    "Edit plan queue error",
                );
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `edit_plan_queued_missing_status_${Date.now()}`,
                        role: "assistant",
                        content: `${queuedErrorMessage}\nRequest ID: ${rawPlan.requestId || editPlanResult.requestId || "unknown"}\nJob ID: ${rawPlan.jobId || "unknown"}`,
                        timestamp: new Date(),
                        type: "text",
                        retryPrompt: messageInput,
                        retryStatus: 503,
                    },
                ]);
                return;
            }

            if (queuedJob && queuedStatusUrl && isActiveEditPlanJobStatus(queuedJob.status)) {
                editPlanJobVersionRef.current += 1;
                editPlanJobStableSignatureRef.current = "";
                editPlanJobStableReadsRef.current = 0;
                editPlanJobFetchFailureCountRef.current = 0;
                editPlanJobPollDelayOverrideMsRef.current = null;
                editPlanFilesCardMessageJobKeyRef.current = null;
                setEditPlanFilesCardMessageId(null);
                const preflightRestorePointId = await createRestorePointBeforeApply(
                    messageInput,
                    effectiveCurrentFile ? [effectiveCurrentFile] : undefined,
                );
                if (preflightRestorePointId) {
                    setLastRestorePointId(preflightRestorePointId);
                }
                const enqueueRequestId = rawPlan.requestId || editPlanResult.requestId || null;
                const queuedJobId = queuedJob.jobId || rawPlan.jobId || null;
                const requestMeta: EditPlanRequestMeta = {
                    query: messageInput,
                    currentPath: effectiveCurrentFile || null,
                    requestedAt: inquiryRequestedAt,
                    preflightRestorePointId: preflightRestorePointId || null,
                    search: summarySearchContext || latestInquiryMetaRef.current?.search || null,
                };
                if (queuedJobId) {
                    editPlanJobRequestMetaRef.current[queuedJobId] = requestMeta;
                }
                if (enqueueRequestId) {
                    editPlanJobRequestMetaRef.current[`req:${enqueueRequestId}`] = requestMeta;
                }
                if (queuedStatusUrl) {
                    editPlanJobRequestMetaRef.current[`status:${queuedStatusUrl}`] = requestMeta;
                }
                setActiveEditPlanJob({
                    ...queuedJob,
                    statusUrl: queuedStatusUrl,
                    requestId: queuedJob.requestId || enqueueRequestId,
                    jobId: queuedJobId,
                    enqueueRequestId,
                    jobRequestId: queuedJob.requestId || null,
                } as AppEmbeddingEditPlanJobStatus);
                setIsLoading(false);
                return;
            }

            if (queuedResponseLike) {
                const queuedErrorMessage = `The edit-plan job was accepted, but it came back in an unexpected state: ${String(queuedJob?.status || rawPlan.status || editPlanResult.status)}.`;
                await showAlert(
                    <div className="space-y-2">
                        <div className="text-sm text-neutral-800">{queuedErrorMessage}</div>
                        <div className="text-xs text-neutral-600">Request ID: {rawPlan.requestId || editPlanResult.requestId || "unknown"}</div>
                    </div>,
                    "Edit plan queue error",
                );
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `edit_plan_queued_unexpected_${Date.now()}`,
                        role: "assistant",
                        content: `${queuedErrorMessage}\nRequest ID: ${rawPlan.requestId || editPlanResult.requestId || "unknown"}\nJob ID: ${rawPlan.jobId || "unknown"}`,
                        timestamp: new Date(),
                        type: "text",
                        retryPrompt: messageInput,
                        retryStatus: 503,
                    },
                ]);
                return;
            }

            const planMeta = rawPlan as any;
            const planRequestId = typeof planMeta?.requestId === "string" ? planMeta.requestId : null;
            const creditCost = typeof planMeta?.creditCost === "number" && Number.isFinite(planMeta.creditCost)
                ? Math.max(1, Math.floor(planMeta.creditCost))
                : 1;
            const planOps = Array.isArray(rawPlan?.ops)
                ? rawPlan.ops.filter((op): op is AppEmbeddingEditPlanOp => Boolean(op && typeof op.path === "string" && op.path.trim()))
                : [];
            const hasChargeableWork = planOps.length > 0 || (Array.isArray(rawPlan?.dbMigrations) && rawPlan.dbMigrations.length > 0);

            if (!isFreeCompileFixMode && planRequestId && hasChargeableWork) {
                const headers2 = await withCsrfHeaders();
                const consumeRes = await fetch("/api/credits/ai-edits/consume", {
                    method: "POST",
                    headers: headers2,
                    body: JSON.stringify({ requestId: planRequestId, cost: creditCost }),
                });
                const consumeJson = await consumeRes.json().catch(() => ({} as any));
                if (!consumeRes.ok || consumeJson?.ok === false) {
                    const topup = "/price#topup";
                    const messageText = typeof consumeJson?.error === "string" && consumeJson.error.trim()
                        ? consumeJson.error
                        : "You have used all AI edit credits for this month.";
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `error_${Date.now()}`,
                            role: "assistant",
                            content: `${messageText}\nAdd credits: ${topup}`,
                            timestamp: new Date(),
                            type: "text",
                        },
                    ]);
                    return;
                }
                if (typeof consumeJson?.remaining === "number" && Number.isFinite(consumeJson.remaining)) {
                    setAiCreditsRemaining(consumeJson.remaining);
                }
            } else if (!isFreeCompileFixMode && planRequestId && !hasChargeableWork) {
                dispatchAiAgentEvent("response_noop", {
                    appId,
                    userId: user?.uid || null,
                    requestId: planRequestId,
                    reason: "no_chargeable_changes_returned",
                    hasFileEdits: planOps.length > 0,
                    fileEditsCount: planOps.length,
                    hasDbMigrations: Array.isArray(rawPlan?.dbMigrations) && rawPlan.dbMigrations.length > 0,
                    dbMigrationsCount: Array.isArray(rawPlan?.dbMigrations) ? rawPlan.dbMigrations.length : 0,
                });
            }

            dispatchAiAgentEvent("response_ok", {
                appId,
                userId: user?.uid || null,
                hasFileEdits: planOps.length > 0,
                fileEditsCount: planOps.length,
                hasDbMigrations: Array.isArray(rawPlan?.dbMigrations) && rawPlan.dbMigrations.length > 0,
                dbMigrationsCount: Array.isArray(rawPlan?.dbMigrations) ? rawPlan.dbMigrations.length : 0,
                restorePointId: typeof planMeta?.restorePointId === "string" ? planMeta.restorePointId : null,
                responseLen: typeof rawPlan?.summary === "string" ? rawPlan.summary.length : null,
            });

            // If the edit plan indicates a rebuild is required, keep the current UX note.
            let aiContent = sanitizeAssistantContent(rawPlan.summary || rawPlan.response || "I've prepared an edit plan.");
            if (refreshQueuedNotice) {
                aiContent = `${aiContent}\n\n${refreshQueuedNotice}`;
            }
            if (Array.isArray(rawPlan.notes) && rawPlan.notes.length > 0) {
                const noteText = rawPlan.notes.filter((note) => typeof note === "string" && note.trim()).slice(0, 5).join("\n- ");
                if (noteText) {
                    aiContent = `${aiContent}\n\nNotes:\n- ${noteText}`;
                }
            }
            if (rawPlan.needsRebuild) {
                aiContent += "\n\nThis plan needs a rebuild before the changes are fully visible.";
            }
            const clarifyingQuestions: string[] = Array.isArray(planMeta?.clarifyingQuestions)
                ? planMeta.clarifyingQuestions
                      .filter((q: unknown) => typeof q === "string" && q.trim())
                      .map((q: string) => q.trim())
                      .slice(0, 3)
                : [];
            if (clarifyingQuestions.length > 0 && !clarifyingQuestions.some((q) => aiContent.includes(q))) {
                aiContent = [
                    aiContent,
                    "",
                    "A few details would help me target the right file:",
                    ...clarifyingQuestions.map((q) => `- ${q}`),
                ].join("\n");
            }
            if (typeof aiContent === "string" && /restart|server.*restart|refresh.*server|database credentials|should work in a moment/i.test(aiContent)) {
                aiContent +=
                    "\n\nIf you just updated your database credentials or made a major config change, you may need to click the **Rebuild app** button in the top right to fully restart your app server.";
            }
            const aiMessage: Message = {
                id: `ai_${Date.now()}`,
                role: "assistant",
                content: aiContent,
                timestamp: new Date(),
                type: "text"
            };

            setMessages(prev => [...prev, aiMessage]);

            const hasDbMigrations = Array.isArray(rawPlan.dbMigrations) && rawPlan.dbMigrations.length > 0;
            const planHasDeleteOps = planOps.some((op) => String(op.op || "").toLowerCase() === "delete");
            const planSwitchesFramework = planWouldSwitchFramework(planOps.map((op) => op.path), projectFramework);

            if (planSwitchesFramework) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `framework_mismatch_${Date.now()}`,
                        role: "assistant",
                        content:
                            projectFramework.key === "html-js"
                                ? "I detected a plain HTML/JS project, so I won’t apply Next.js scaffold files. I can keep this change in the current framework, or you can ask for a migration explicitly."
                                : "This plan would switch frameworks, which I won’t do automatically. I can keep the current file pattern, or you can ask me to migrate it explicitly.",
                        timestamp: new Date(),
                        type: "text",
                    },
                ]);
                return;
            }

            // Handle database migrations (propose -> ask user -> apply)
            const proposalIdsForThisResponse: string[] = [];
            if (hasDbMigrations) {
                const headers2 = await withCsrfHeaders();
                for (const mig of rawPlan.dbMigrations as Array<any>) {
                    const sql = typeof mig?.sql === "string" ? mig.sql : "";
                    const messageText = typeof mig?.message === "string" ? mig.message : "Database schema change";
                    const destructive = Boolean(mig?.destructive);

                    if (!sql.trim()) continue;

                    const proposeRes = await fetch("/api/supabase/migrations/propose", {
                        method: "POST",
                        headers: headers2,
                        body: JSON.stringify({ sql, message: messageText, destructive, appId }),
                    });

                    const proposeJson = await proposeRes.json().catch(() => ({} as any));
                    if (!proposeRes.ok || proposeJson?.ok === false) {
                        const msg = typeof proposeJson?.error === "string" ? proposeJson.error : "Failed to create migration proposal.";
                        if (msg.toLowerCase().includes("supabase is not connected")) {
                            if (!isSupabaseConnectedRef.current) {
                                setShowDatabaseSetup(true);
                            }
                            setMessages((prev) => [
                                ...prev,
                                {
                                    id: `mig_need_db_${Date.now()}`,
                                    role: "assistant",
                                    content:
                                        "I can’t update the database yet because it isn’t connected. " +
                                        "Please connect Supabase first (click \"Connect database\" in the editor header), then I’ll retry the database update.",
                                    timestamp: new Date(),
                                    type: "text",
                                },
                            ]);
                        }
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: `mig_prop_fail_${Date.now()}`,
                                role: "assistant",
                                content: `Couldn’t create a migration proposal: ${msg}`,
                                timestamp: new Date(),
                                type: "text",
                            },
                        ]);
                        continue;
                    }

                    const proposalId = String(proposeJson.proposalId || "");
                    const destructiveFinal = Boolean(proposeJson.destructive);

                    if (proposalId) proposalIdsForThisResponse.push(proposalId);

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `mig_prop_${Date.now()}`,
                            role: "assistant",
                            content:
                                `${messageText}\n\nI prepared a database update for this. ` +
                                `Please review it carefully and click “Review & Apply” below to continue. ` +
                                `If you’re unsure, don’t apply it — ask me to explain in plain English first.`,
                            timestamp: new Date(),
                            type: "text",
                            migrationProposalId: proposalId,
                            migrationSql: sql,
                            migrationDestructive: destructiveFinal,
                            migrationStatus: "PENDING",
                        },
                    ]);
                }
            }

            // Handle database setup request
            if (rawPlan.setupDatabase) {
                const followupPrompt = messageInput.trim();
                if (followupPrompt) {
                    setPendingSupabaseFollowupPrompt(followupPrompt);
                    enqueueDatabaseSetupChoicePrompt(followupPrompt);
                }
                if (allowDatabaseSetupUi) {
                    setTimeout(() => {
                        if (isSupabaseConnectedRef.current) return;
                        setShowDatabaseSetup(true);
                    }, 1000); // Small delay for better UX
                }
            }

            // Handle file edits if any
            if (planOps.length > 0) {
                dispatchAiAgentEvent("file_edits_received", {
                    appId,
                    userId: user?.uid || null,
                    count: planOps.length,
                    creditRequestId:
                        (typeof planMeta?.restorePointId === "string" && planMeta.restorePointId) ||
                        `ai_agent_${appId}_${userMessage.id}`,
                });
                const creditRequestId =
                    (typeof planMeta?.restorePointId === "string" && planMeta.restorePointId) ||
                    `ai_agent_${appId}_${userMessage.id}`;

                // Safety: if the agent also proposed DB changes, don't persist/apply code changes yet.
                // This prevents the preview from breaking on missing schema until the user confirms the migration.
                if (hasDbMigrations) {
                    const bundleId = `staged_${Date.now()}`;
                    const label = `AI edit plan (staged): ${(rawPlan.summary || messageInput).slice(0, 50)}...`;

                    if (planHasDeleteOps) {
                        console.warn("[AppBuilderEditorChat] edit plan includes delete operations while DB migration staging is active; delete ops will be deferred until the next non-staged apply.");
                    }

                    setStagedBundles((prev) => [
                        ...prev,
                        {
                            id: bundleId,
                            createdAt: Date.now(),
                            label,
                            proposalIds: proposalIdsForThisResponse,
                            appliedProposalIds: {},
                            ops: planOps,
                            rawPlan,
                            creditRequestId,
                            needsRebuild: Boolean(rawPlan.needsRebuild),
                        },
                    ]);

                    // Link the staged code bundle to one migration message so we keep a single DB confirmation modal.
                    if (proposalIdsForThisResponse.length > 0) {
                        const attachTo = proposalIdsForThisResponse[0];
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.migrationProposalId === attachTo
                                    ? {
                                        ...m,
                                        stagedBundleId: bundleId,
                                        content: `${m.content}\n\n(Your related code changes are staged and will apply automatically after this database update.)`,
                                    }
                                    : m
                            )
                        );
                    } else {
                        // Fallback: no proposal ID to attach to (e.g. DB not connected). Keep a single message with actions.
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: `staged_note_${Date.now()}`,
                                role: "assistant",
                                content:
                                    "I staged the code changes for this request because it requires a database update, but I couldn’t create a migration proposal yet. Connect your database and ask me to retry, or discard the staged code changes.",
                                timestamp: new Date(),
                                type: "text",
                                stagedBundleId: bundleId,
                            },
                        ]);
                    }

                } else {
                    if (rawPlan.needsMoreContext) {
                        const assistantMessage = buildNeedsMoreContextMessage(rawPlan, currentFile || null);
                        const debugDetails = process.env.NODE_ENV !== "production" ? buildNeedsMoreContextDebugDetails(rawPlan) : undefined;

                        setMessages((prev) => [
                            ...prev,
                            {
                                id: `edit_plan_more_context_${Date.now()}`,
                                role: "assistant",
                                content: assistantMessage,
                                timestamp: new Date(),
                                type: "text",
                                debugDetails,
                            },
                        ]);
                        setPendingEditPlan(null);
                        setEditPlanApplyError(null);
                        setEditPlanApplyStatusMessage("The worker asked for more context, so I did not apply anything.");
                        setIsApplyingEditPlan(false);
                        return;
                    }

                    setPendingEditPlan(null);
                    setEditPlanApplyError(null);
                    setEditPlanApplyStatusMessage("The worker did not return a proposal in this response yet.");
                    return;
                }
            }

            if (isFreeCompileFixMode) {
                setFreeCompileFixContext(null);
            }
        } catch (err: any) {
            dispatchAiAgentEvent("client_error", {
                appId,
                userId: user?.uid || null,
                error: err?.message || String(err),
            });
            console.error("AI chat error:", err);
            const status = typeof err?.status === "number" ? err.status : null;
            const retryable = isRetryableAiStatus(status);
            const userRetryable = isUserRetryableAiStatus(status);
            const retryPrompt = typeof err?.retryPrompt === "string" && err.retryPrompt.trim() ? err.retryPrompt : input;
            const userFacingErrorMessage = status !== null
                ? getEmbeddingSearchErrorMessage(status, typeof err?.code === "string" ? err.code : null, typeof err?.message === "string" ? err.message : null)
                : "Sorry, I couldn’t complete that request right now. Please try again in a few minutes.";
            const errorMessage: Message = {
                id: `error_${Date.now()}`,
                role: "assistant",
                content: retryable
                    ? status === 422
                        ? "I found the page and searched nearby files, but I couldn’t make a safe edit from the request as written. Tell me the exact section, file, or text you want changed, and I’ll apply that directly."
                        : "That request failed temporarily. Use retry to try again."
                    : userRetryable
                        ? userFacingErrorMessage
                        : "Sorry, I couldn’t complete that request right now. Please try again in a few minutes.",
                timestamp: new Date(),
                type: "text",
                retryPrompt: userRetryable ? retryPrompt : undefined,
                retryStatus: userRetryable ? status ?? undefined : undefined,
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!isLoading) {
            return;
        }
    }, [isLoading]);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const onCompileFix = (event: Event) => {
            const detail = (event as CustomEvent<any>)?.detail || {};
            const autoSend = detail?.autoSend === true;
            const code = typeof detail?.code === "string" ? detail.code.trim() : "";
            const actionType = String(detail?.actionType || "").toLowerCase();
            const summary = typeof detail?.compileError?.summary === "string" ? detail.compileError.summary.trim() : "";
            const detailText = typeof detail?.compileError?.detail === "string" ? detail.compileError.detail : "";
            const fingerprint = typeof detail?.compileError?.fingerprint === "string" ? detail.compileError.fingerprint.trim() : "";
            if (!code || actionType !== "quick_fix_compile" || !summary || !fingerprint) return;

            const ctx: CompileErrorQuickFixContext = {
                appId: String(detail?.appId || appId),
                code,
                actionType: "quick_fix_compile",
                fixAction: typeof detail?.fixAction === "string" ? detail.fixAction : undefined,
                currentPath: null,
                compileError: {
                    summary,
                    detail: detailText,
                    fingerprint,
                },
            };

            const prefill = buildCompileFixPrefill(ctx);
            const lockKey = `${ctx.appId}:${ctx.code}:${ctx.compileError.fingerprint}`;
            const now = Date.now();
            const cooldown = compileFixRequestCooldownRef.current;
            const cooldownMs = 5_000;
            if (cooldown && cooldown.fingerprint === lockKey && now < cooldown.until) return;
            compileFixRequestCooldownRef.current = { fingerprint: lockKey, until: now + cooldownMs };

            if (autoSend) {
                setTimeout(() => {
                    void (async () => {
                        try {
                            await sendMessage({
                                forcedInput: prefill,
                                forcedCompileFixContext: ctx,
                                hideUserMessage: true,
                                allowWhenChatDisabled: true,
                            });
                        } finally {
                            // cooldown persists until expiry
                        }
                    })();
                }, 0);
                return;
            }
        };

        window.addEventListener("kloner:compile-error-fix-request", onCompileFix as EventListener);
        return () => {
            window.removeEventListener("kloner:compile-error-fix-request", onCompileFix as EventListener);
        };
    }, [appId, sendMessage]);

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!chatDisabled) sendMessage();
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-gray-50 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b bg-white flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Bot className="w-5 h-6 text-accent" />
                    <h3 className="font-medium text-sm">Agent</h3>
                    {process.env.NODE_ENV !== "production" ? (
                        <span
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-600"
                            title={projectFramework.reason}
                            aria-label={projectFramework.label}
                        >
                            <Info className="h-3 w-3" />
                        </span>
                    ) : null}
                    {creditError ? (
                        <div className="ml-2 text-[11px] text-red-600 max-w-[220px] truncate" title={creditError}>
                            {creditError}
                        </div>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowRestorePointsPanel((prev) => !prev)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
                        aria-expanded={showRestorePointsPanel}
                        aria-label="Toggle timeline"
                        title="Timeline"
                    >
                        <FileText className="h-3.5 w-3.5" />
                        <span>Timeline</span>
                        {restorePoints.length > 0 ? (
                            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-neutral-100 px-1.5 text-[10px] text-neutral-600">
                                {restorePoints.length}
                            </span>
                        ) : null}
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showRestorePointsPanel ? "rotate-180" : ""}`} />
                    </button>
                    <button
                        onClick={fetchRestorePoints}
                        className="p-1 hover:bg-gray-200 rounded"
                        title="Refresh restore points"
                        disabled={isRestoreBusy}
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={createManualRestorePoint}
                        className="p-1 hover:bg-gray-200 rounded"
                        title="Save restore point"
                        disabled={isRestoreBusy}
                    >
                        <FileText className="w-4 h-4" />
                    </button>
                    {(lastRestorePointId || checkpoints.length > 1) && (
                        <button
                            onClick={undoLastChange}
                            className="p-1 hover:bg-gray-200 rounded"
                            title="Undo last change"
                            disabled={isRestoreBusy}
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>
                    )}
                    {editHistory.redoQueue.length > 0 ? (
                        <button
                            type="button"
                            onClick={() => {
                                void redoLastUndo();
                            }}
                            className="p-1 hover:bg-gray-200 rounded"
                            title="Redo last undone edit"
                            disabled={isRestoreBusy || isLoading}
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    ) : null}
                </div>
            </div>

            {showRestorePointsPanel ? (
                <div className="relative z-20 flex-shrink-0">
                    <div className="absolute left-2 right-2 top-2 max-h-[65vh] overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.12)] sm:left-3 sm:right-3 sm:p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium text-neutral-900">Timeline</div>
                                <div className="mt-1 text-[11px] text-neutral-500">Revert to any restore point. This rolls back changes made after that point.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowRestorePointsPanel(false)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200"
                                aria-label="Close timeline"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="mt-3 space-y-2">
                            {restorePoints.length === 0 ? (
                                <div className="min-w-0 rounded-lg border border-dashed border-[#F55F2A]/20 bg-[#FFF8F5] px-3 py-2 text-xs text-neutral-600">
                                    No timeline checkpoints yet. A restore point is created automatically before AI applies edits.
                                </div>
                            ) : (
                                restorePoints.map((rp) => {
                                    const rpLabel = String(rp.label || "Restore point").trim() || "Restore point";
                                    const rpTime = formatRestorePointCreatedAt(rp.createdAt);
                                    const canRevert = !isRestoreBusy;
                                    return (
                                        <div key={rp.id} className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-xs font-medium text-neutral-900">{rpLabel}</div>
                                                    <div className="mt-0.5 text-[11px] text-neutral-500">
                                                        {rpTime}{rp.kept ? " · kept" : ""}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const confirmRollback = window.confirm(
                                                            "Revert to this timeline checkpoint?\n\nYour project will roll back to this point and all changes made after it will be lost.",
                                                        );
                                                        if (!confirmRollback) return;
                                                        void applyRestorePoint(rp.id, {
                                                            statusMessage: "Project rolled back to the selected timeline checkpoint. Rebuilding preview now.",
                                                        });
                                                    }}
                                                    disabled={!canRevert}
                                                    className="inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    Revert
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            ) : null}

            {historyToast ? (
                <div className="mx-4 mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    {historyToast}
                </div>
            ) : null}

            {keepUndoPrompt ? (
                <div className="mx-4 mt-3 rounded-2xl border border-emerald-200 bg-[linear-gradient(180deg,rgba(236,253,245,0.98),rgba(255,255,255,1))] px-4 py-3 shadow-[0_10px_24px_rgba(5,150,105,0.08)]">
                    <div className="text-sm text-emerald-900">Edit applied to {keepUndoPrompt.restorePoint.touchedPaths[0] || "your project"}</div>
                    <div className="mt-1 text-xs text-emerald-800">Looks good? You can undo this change at any time.</div>
                    {keepUndoPrompt.restorePoint.restorable ? null : (
                        <div className="mt-2 text-xs text-amber-700">
                            Undo unavailable (file too large to snapshot).
                        </div>
                    )}
                    {keepUndoPrompt.skippedPaths.length > 0 ? (
                        <div className="mt-1 text-[11px] text-amber-700">
                            Skipped files: {keepUndoPrompt.skippedPaths.slice(0, 3).join(", ")}{keepUndoPrompt.skippedPaths.length > 3 ? " ..." : ""}
                        </div>
                    ) : null}
                    {keepUndoError ? (
                        <div className="mt-2 text-xs text-rose-700">{keepUndoError}</div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={keepCurrentEdit}
                            className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50"
                            disabled={isRestoreBusy}
                        >
                            Keep Changes
                        </button>
                        {keepUndoPrompt.restorePoint.restorable ? (
                            <button
                                type="button"
                                onClick={() => {
                                    void undoCurrentEdit();
                                }}
                                className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50"
                                disabled={isRestoreBusy}
                            >
                                ↩ Undo Edit
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-4 bg-[radial-gradient(circle_at_top,_rgba(245,95,42,0.10),_transparent_36%),linear-gradient(180deg,rgba(255,250,247,0.96),rgba(255,255,255,1))]">
                {messages.length === 0 && !isLoading ? (
                    <div className="rounded-2xl border border-dashed border-[#F55F2A]/20 bg-white/80 px-4 py-10 text-center text-sm text-neutral-500 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                        No messages yet. Start with one of the suggestions below.
                    </div>
                ) : null}

                {renderedMessages.map((message) => {
                    const isStatusPlaceholderBubble = Boolean(
                        message.role === "assistant"
                        && message.id === editPlanStatusMessageId
                        && activeEditPlanJob,
                    );
                    const isFilesCardPlaceholderBubble = Boolean(
                        message.role === "assistant"
                        && message.id === editPlanFilesCardMessageId
                        && !showFileChangesCardBubble,
                    );
                    if (isStatusPlaceholderBubble || isFilesCardPlaceholderBubble) {
                        return null;
                    }

                    return (
                    <div
                        key={message.id}
                        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >

                        <div
                            className={`relative max-w-[82%] rounded-[1.35rem] px-4 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.08)] ${message.role === "user"
                                ? "border border-[#F55F2A]/20 bg-[linear-gradient(135deg,#F55F2A_0%,#FF8A5C_100%)] text-white"
                                : "border border-[#F55F2A]/14 bg-[linear-gradient(180deg,rgba(255,251,248,0.98),rgba(255,255,255,0.95))] text-neutral-900"
                                }`}
                        >
                            {!(message.role === "assistant" && message.id === editPlanStatusMessageId && activeEditPlanJob) ? (
                                message.editPlanFailure ? (
                                    <div className="space-y-2">
                                        <div className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-900">
                                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                                            <span>Could not apply changes</span>
                                        </div>
                                        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-900">{message.content}</div>
                                        {showPreviewIssueDetails ? (
                                            <details className="rounded-xl border border-neutral-200 bg-neutral-50/70 px-3 py-2">
                                                <summary className="cursor-pointer list-none text-xs font-medium text-neutral-700">
                                                    View technical details
                                                </summary>
                                                <div className="mt-2 space-y-1 text-xs text-neutral-600 break-all">
                                                    {message.editPlanFailureCode ? <div>Code: {message.editPlanFailureCode}</div> : null}
                                                    {message.editPlanFailureJobId ? <div>Job: {message.editPlanFailureJobId}</div> : null}
                                                    {message.editPlanFailureRequestId ? <div>Request: {message.editPlanFailureRequestId}</div> : null}
                                                    {typeof message.editPlanFailureHttpStatus === "number" ? <div>HTTP: {message.editPlanFailureHttpStatus}</div> : null}
                                                </div>
                                            </details>
                                        ) : null}
                                    </div>
                                ) : (
                                    <div className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${message.role === "user" ? "text-white/95" : "text-neutral-900"}`}>
                                        {renderTextWithLinks(message.content)}
                                    </div>
                                )
                            ) : null}

                            {message.role === "assistant" && String(message.id || "").startsWith("edit_plan_details_") ? (
                                (() => {
                                    const feedbackState = summaryFeedbackStateByMessageId[message.id] || null;
                                    if (feedbackState === "up" || feedbackState === "down") return null;
                                    return (
                                        <div className="mt-3 flex flex-col items-center justify-center gap-2 text-center">
                                            <div className="text-[11px] font-medium text-neutral-500">How was this response?</div>
                                            <div className="flex items-center justify-center gap-4">
                                                <button
                                                    type="button"
                                                    title="Good response"
                                                    aria-label="Good response"
                                                    disabled={feedbackState === "sending"}
                                                    onClick={() => {
                                                        void submitSummaryFeedback(message, "up");
                                                    }}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <ThumbsUp className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    title="Needs improvement"
                                                    aria-label="Needs improvement"
                                                    disabled={feedbackState === "sending"}
                                                    onClick={() => {
                                                        void submitSummaryFeedback(message, "down");
                                                    }}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <ThumbsDown className="h-4 w-4" />
                                                </button>
                                            </div>
                                            {feedbackState === "sending" ? (
                                                <div className="text-[10px] text-neutral-400">Sending feedback...</div>
                                            ) : feedbackState === "error" ? (
                                                <div className="text-[10px] text-red-500">Could not send feedback. Try again.</div>
                                            ) : null}
                                        </div>
                                    );
                                })()
                            ) : null}

                            {message.role === "assistant" && message.debugDetails && process.env.NODE_ENV !== "production" ? (
                                <details className="mt-3 rounded-2xl border border-neutral-200 bg-white/90 px-3 py-2 text-left">
                                    <summary className="inline-flex cursor-pointer list-none items-center justify-center rounded-full border border-blue-200 bg-blue-50 p-1 text-blue-600 hover:bg-blue-100">
                                        <Info className="h-3.5 w-3.5" />
                                    </summary>
                                    <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-neutral-600">
                                        {message.debugDetails}
                                    </pre>
                                </details>
                            ) : null}

                            {message.supabaseContinuationPrompt && message.supabaseContinuationStatus === "PENDING" ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => {
                                            const prompt = String(message.supabaseContinuationPrompt || "").trim();
                                            const blocked = isLoading;
                                            if (!prompt || blocked) return;

                                            setMessages((prev) =>
                                                prev.map((m) =>
                                                    m.id === message.id
                                                        ? { ...m, supabaseContinuationStatus: "CONTINUE" as const }
                                                        : m,
                                                ),
                                            );

                                            void sendMessage({ forcedInput: prompt, allowWhenChatDisabled: true });
                                        }}
                                        className="inline-flex items-center rounded-full bg-[#F55F2A] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#E04E1B] disabled:opacity-50"
                                    >
                                        Continue request
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => {
                                            if (isLoading) return;
                                            setMessages((prev) => [
                                                ...prev.map((m) =>
                                                    m.id === message.id
                                                        ? { ...m, supabaseContinuationStatus: "DISMISS" as const }
                                                        : m,
                                                ),
                                                {
                                                    id: `supabase_continue_dismiss_${Date.now()}`,
                                                    role: "assistant",
                                                    content: "No problem, I won’t continue that request unless you ask.",
                                                    timestamp: new Date(),
                                                    type: "text",
                                                },
                                            ]);
                                        }}
                                        className="inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 transition hover:bg-black/5 disabled:opacity-50"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            ) : null}

                            {message.dbSetupPrompt && message.dbSetupStatus === "PENDING" ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {allowDatabaseSetupUi ? (
                                        <button
                                            type="button"
                                            disabled={isLoading}
                                            onClick={() => {
                                                const blocked = isLoading;
                                                if (blocked) return;

                                                setMessages((prev) =>
                                                    prev.map((m) =>
                                                        m.id === message.id
                                                            ? { ...m, dbSetupStatus: "CONNECT" as const }
                                                            : m,
                                                    ),
                                                );

                                                // Always open the Supabase integration popup from this CTA,
                                                // even if already connected, so users can immediately manage/reconnect.
                                                setShowDatabaseSetup(true);
                                                setShowSupabaseAdvanced(false);
                                                setShowSupabaseSetup(true);
                                            }}
                                            className="inline-flex items-center rounded-full bg-[#F55F2A] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#E04E1B] disabled:opacity-50"
                                        >
                                            Connect Supabase
                                        </button>
                                    ) : null}

                                    <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => {
                                            const blocked = isLoading;
                                            if (blocked) return;

                                            const prompt = String(message.dbSetupPrompt || "").trim();
                                            if (!prompt) return;

                                            setMessages((prev) =>
                                                prev.map((m) =>
                                                    m.id === message.id
                                                        ? { ...m, dbSetupStatus: "BASIC" as const }
                                                        : m,
                                                ),
                                            );

                                            const forcedInput = `${prompt}\n\nContinue without Supabase or any database setup. Build a basic version that does not require database persistence. Use UI/in-memory behavior only, and do not store auth credentials or passwords.`;
                                            void sendMessage({ forcedInput, allowWhenChatDisabled: true });
                                        }}
                                        className="inline-flex items-center rounded-full bg-[#111827] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black disabled:opacity-50"
                                    >
                                        Continue with basic version
                                    </button>

                                    <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => {
                                            const blocked = isLoading;
                                            if (blocked) return;

                                            setMessages((prev) => [
                                                ...prev.map((m) =>
                                                    m.id === message.id
                                                        ? { ...m, dbSetupStatus: "DISMISS" as const }
                                                        : m,
                                                ),
                                                {
                                                    id: `db_setup_choice_dismiss_${Date.now()}`,
                                                    role: "assistant",
                                                    content: "No problem. Ask anytime if you want to connect a database or continue with a basic version.",
                                                    timestamp: new Date(),
                                                    type: "text",
                                                },
                                            ]);
                                        }}
                                        className="inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 transition hover:bg-black/5 disabled:opacity-50"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            ) : null}

                            {message.id === "welcome" && message.role === "assistant" ? (
                                <div className="mt-3 flex w-full flex-col gap-2">
                                    {STARTER_PROMPTS.map((starter) => (
                                        <button
                                            key={starter}
                                            type="button"
                                            onClick={() => {
                                                setInput(starter);
                                                inputRef.current?.focus();
                                            }}
                                            className="flex min-h-[3.25rem] w-full items-center rounded-2xl border border-[#F55F2A]/15 bg-white px-4 py-3 text-left text-sm font-medium text-neutral-900 whitespace-normal break-words shadow-[0_8px_18px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-[#F55F2A]/30 hover:shadow-[0_16px_30px_rgba(245,95,42,0.10)]"
                                            title="Use this as your prompt"
                                        >
                                            {starter}
                                        </button>
                                    ))}
                                </div>
                            ) : null}

                            {message.restorePointsCard ? (
                                <div className="mt-2 space-y-4 p-1">
                                    {chatRestorePointsLoading ? (
                                        <div className="text-xs text-neutral-500">Loading latest restore point...</div>
                                    ) : null}

                                    {chatRestorePointsError ? (
                                        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                            {chatRestorePointsError}
                                        </div>
                                    ) : null}

                                    {!chatRestorePointsLoading && chatRestorePoints.length === 0 ? (
                                        <div className="text-xs text-neutral-500">No restore point available yet.</div>
                                    ) : null}

                                    {preferredChatRestorePoint ? (
                                        (() => {
                                            const point = preferredChatRestorePoint;
                                            const isUndoBusy = chatRestorePointRevertingId === point.restorePointId;
                                            const reasonText = String(point.reason || "").trim();
                                            return (
                                                <div className="text-sm text-neutral-800 space-y-4">
                                                    {reasonText ? (
                                                        <details className="group w-full rounded-3xl border border-neutral-200 bg-white/90 shadow-lg shadow-black/5">
                                                            <summary className="flex w-full cursor-pointer list-none items-center gap-2 px-4 py-4">
                                                                <div className="min-w-0 flex-1 truncate font-medium text-neutral-900 text-sm">
                                                                    {reasonText}
                                                                </div>
                                                                <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500 transition-transform group-open:rotate-180" />
                                                            </summary>
                                                            <div className="border-t border-neutral-200 bg-neutral-50/40 px-4 py-4">
                                                                <p className="text-sm text-neutral-800 whitespace-pre-wrap break-words">{reasonText}</p>
                                                            </div>
                                                        </details>
                                                    ) : null}
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={!point.restorable || isUndoBusy || isRestoreBusy}
                                                            onClick={() => void revertChatRestorePoint(point.restorePointId)}
                                                            className="rounded-full bg-[#F55F2A] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#E04E1B] disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            {isUndoBusy ? "Undoing..." : "Undo"}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={isRestoreBusy}
                                                            onClick={() => void keepRestorePoint(point.restorePointId)}
                                                            className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            Keep
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })()
                                    ) : null}
                                </div>
                            ) : null}

                            {message.stagedBundleId ? (
                                <div className="mt-2 text-[11px] text-gray-600">
                                    Code changes are staged (not saved) and will apply after the database update.
                                </div>
                            ) : null}
                            {/* Prominent warning/info for risky or pending migrations */}
                            {message.migrationProposalId && message.migrationSql && (message.migrationStatus === "PENDING" || message.migrationStatus === "APPLYING") && (
                                <div className={`my-3 flex items-center gap-2 ${message.migrationDestructive ? "text-amber-700" : "text-blue-700"}`}>
                                    {message.migrationDestructive ? (
                                        <AlertTriangle className="h-5 w-5" />
                                    ) : (
                                        <Database className="h-5 w-5" />
                                    )}
                                    <span className="font-bold text-base">
                                        Database update required
                                    </span>
                                </div>
                            )}

                            {message.role === "assistant" && message.id === editPlanFilesCardMessageId && activeEditPlanJob && showFileChangesCardBubble ? (
                                <div className="mt-3 flex justify-start">
                                    <div className="w-full max-w-none px-0 py-0 shadow-none">
                                        <EditPlanJobStatusCard
                                            job={activeEditPlanJob}
                                            applyStatusMessage={editPlanApplyStatusMessage}
                                            onRetry={
                                                (activeEditPlanJob.status === "failed" || activeEditPlanJob.status === "expired") && lastEditPlanPromptRef.current?.trim()
                                                    ? () => {
                                                        const jobKey = activeEditPlanJob.jobId || activeEditPlanJob.requestId || activeEditPlanJob.statusUrl || "";
                                                        const requestMeta = editPlanJobRequestMetaRef.current[jobKey]
                                                            || (activeEditPlanJob.statusUrl ? editPlanJobRequestMetaRef.current[`status:${activeEditPlanJob.statusUrl}`] : undefined)
                                                            || (activeEditPlanJob.requestId ? editPlanJobRequestMetaRef.current[`req:${activeEditPlanJob.requestId}`] : undefined)
                                                            || (activeEditPlanJob.jobId ? editPlanJobRequestMetaRef.current[activeEditPlanJob.jobId] : undefined)
                                                            || null;
                                                        const retryPrompt = String(requestMeta?.query || lastEditPlanPromptRef.current || "").trim();
                                                        const retryCurrentPath = typeof requestMeta?.currentPath === "string"
                                                            ? (requestMeta.currentPath.trim() || null)
                                                            : null;
                                                        if (!retryPrompt) return;
                                                        void sendMessage({
                                                            forcedInput: retryPrompt,
                                                            forcedCurrentPath: retryCurrentPath,
                                                            allowWhenChatDisabled: true,
                                                            hideUserMessage: true,
                                                            bypassInitialSearch: true,
                                                        });
                                                    }
                                                    : undefined
                                            }
                                            onDismiss={
                                                isActiveEditPlanJobStatus(activeEditPlanJob.status)
                                                    ? undefined
                                                    : () => {
                                                        editPlanJobVersionRef.current += 1;
                                                        setActiveEditPlanJob(null);
                                                    }
                                            }
                                        />
                                    </div>
                                </div>
                            ) : null}

                            {message.migrationProposalId && message.migrationSql ? (
                                <div className="mt-3 space-y-2">
                                    <div className="rounded border border-gray-200 bg-white/70 p-3">
                                        {/* <div className="flex items-center justify-between gap-3"> */}
                                        {/* <div className="min-w-0"> */}
                                        {/* <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                                                    {message.migrationDestructive ? (
                                                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                                                    ) : null}
                                                    <span>
                                                        Database update
                                                    </span>
                                                </div> */}
                                        {/* </div> */}
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setShowMigrationSqlByMessageId((prev) => ({
                                                        ...prev,
                                                        [message.id]: !prev[message.id],
                                                    }))
                                                }
                                                className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                                                title="Show advanced SQL"
                                            >
                                                {showMigrationSqlByMessageId[message.id] ? (
                                                    <span className="inline-flex items-center gap-1">
                                                        <ChevronUp className="h-3 w-3" /> Hide SQL
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1">
                                                        <ChevronDown className="h-3 w-3" /> Show SQL
                                                    </span>
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setMigrationReviewMessageId(message.id);
                                                    setMigrationAcknowledge(false);
                                                    setMigrationConfirmText("");
                                                    setMigrationShowSqlInModal(false);
                                                }}
                                                disabled={Boolean(message.migrationStatus === "APPLIED")}
                                                className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                                title={message.migrationDestructive ? "Review & apply (risky)" : "Review & apply"}
                                            >
                                                {message.migrationStatus === "APPLIED" ? "Applied" : "Review & Apply"}
                                            </button>
                                        </div>
                                        {/* </div> */}

                                        {showMigrationSqlByMessageId[message.id] && (
                                            <pre className="mt-2 max-h-56 overflow-auto rounded bg-white border border-gray-200 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                                                {message.migrationSql}
                                            </pre>
                                        )}

                                        {message.migrationStatus === "FAILED" ? (
                                            <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900">
                                                <div className="font-semibold">Database update failed</div>
                                                {message.migrationRelationName ? (
                                                    <div className="mt-1">Missing item: {message.migrationRelationName}</div>
                                                ) : null}
                                                {message.migrationErrorCode ? (
                                                    <div className="mt-1">Error code: {message.migrationErrorCode}</div>
                                                ) : null}
                                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setMigrationReviewMessageId(message.id);
                                                            setMigrationAcknowledge(false);
                                                            setMigrationConfirmText("");
                                                            setMigrationShowSqlInModal(false);
                                                        }}
                                                        className="px-2 py-1 text-xs bg-white border border-red-300 rounded hover:bg-red-100"
                                                    >
                                                        Retry apply
                                                    </button>
                                                    {message.migrationCanRegenerate && message.migrationRetryPrompt ? (
                                                        <button
                                                            type="button"
                                                            disabled={isLoading}
                                                            onClick={() => {
                                                                void sendMessage({ forcedInput: message.migrationRetryPrompt });
                                                            }}
                                                            className="px-2 py-1 text-xs bg-white border border-red-300 rounded hover:bg-red-100 disabled:opacity-50"
                                                        >
                                                            Regenerate update
                                                        </button>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}

                            {message.restorePointId && showPreviewIssueDetails && !message.editPlanRetryPrompt && (
                                <div className="mt-2 space-y-2">
                                    {(() => {
                                        const detail = restorePointDetailsById[message.restorePointId!];
                                        const summary = summarizeRestorePointDiff(detail);
                                        if (summary.length === 0) return null;

                                        return (
                                            <div className="rounded-xl border border-[#F55F2A]/15 bg-white/80 p-3">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="text-xs font-semibold text-neutral-800">Restore point diff</div>
                                                    <div className="text-[11px] text-neutral-500">Captured before the apply request was sent.</div>
                                                    <span
                                                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-600"
                                                        title="Development-only diff preview"
                                                        aria-label="Development-only diff preview"
                                                    >
                                                        <Info className="h-3 w-3" />
                                                    </span>
                                                </div>
                                                <div className="mt-3 space-y-2">
                                                    {summary.map((entry) => (
                                                        <button
                                                            key={entry.path}
                                                            type="button"
                                                            onClick={() => setActiveRestorePointPreview({ restorePointId: message.restorePointId!, path: entry.path })}
                                                            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-left transition hover:border-[#F55F2A]/30 hover:bg-white hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F55F2A]/30"
                                                        >
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div className="min-w-0 text-xs font-medium text-neutral-900 truncate">{entry.path}</div>
                                                                <div className="flex shrink-0 items-center gap-2 text-[11px] font-semibold">
                                                                    <span className="text-emerald-700">+{entry.added}</span>
                                                                    <span className="text-rose-700">-{entry.removed}</span>
                                                                </div>
                                                            </div>
                                                            <div className="mt-1 text-[11px] text-neutral-500">
                                                                {entry.beforeLines} lines before • {entry.afterLines} lines after
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            onClick={() => {
                                                void applyRestorePoint(message.restorePointId!, {
                                                    statusMessage: getStatusMessageForAction(message.restoreActionLabel),
                                                });
                                            }}
                                            disabled={isRestoreBusy}
                                            className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                            title={message.restoreActionLabel || "Apply"}
                                        >
                                            {message.restoreActionLabel || "Apply"}
                                        </button>
                                        <button
                                            onClick={() => keepRestorePoint(message.restorePointId!)}
                                            disabled={isRestoreBusy}
                                            className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                            title="Keep (do not auto-trim)"
                                        >
                                            Keep
                                        </button>
                                        <span className="text-[11px] text-gray-500">
                                            {message.restorePointId.slice(0, 8)}
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div className="mt-2 flex items-center justify-between gap-2">
                                <div className="text-xs opacity-70">
                                    {isHydrated && message.timestamp.toLocaleTimeString()}
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => void copyMessageText(message)}
                                        className={`rounded p-1 transition-colors ${message.role === "user" ? "text-white/90 hover:text-white hover:bg-white/15" : "text-gray-500 hover:text-gray-900 hover:bg-black/5"}`}
                                        title={copiedMessageId === message.id ? "Copied" : "Copy message"}
                                        aria-label={copiedMessageId === message.id ? "Copied" : "Copy message"}
                                    >
                                        {copiedMessageId === message.id ? (
                                            <Check className="h-3.5 w-3.5" />
                                        ) : (
                                            <Copy className="h-3.5 w-3.5" />
                                        )}
                                    </button>
                                    {message.role === "assistant" && message.retryPrompt && isRetryableAiStatus(message.retryStatus) ? (
                                        <button
                                            type="button"
                                            disabled={isLoading}
                                            onClick={() => {
                                                const prompt = String(message.retryPrompt || "").trim();
                                                if (!prompt || isLoading) return;
                                                void sendMessage({ forcedInput: prompt });
                                            }}
                                            className="rounded p-1 transition-colors text-gray-500 hover:text-gray-900 hover:bg-black/5 disabled:opacity-50"
                                            title={message.retryStatus === 422 ? "Retry with broader search" : "Retry request"}
                                            aria-label={message.retryStatus === 422 ? "Retry with broader search" : "Retry request"}
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                        </button>
                                    ) : null}
                                    {message.role === "assistant" && message.editPlanRetryPrompt ? (
                                        <button
                                            type="button"
                                            disabled={isLoading}
                                            onClick={() => {
                                                if (isLoading) return;
                                                const retryPrompt = String(message.editPlanRetryPrompt || "").trim();
                                                const prompt = retryPrompt && retryPrompt.toLowerCase() !== "retry apply"
                                                    ? retryPrompt
                                                    : String(lastEditPlanPromptRef.current || "").trim();
                                                const retryCurrentPath = typeof message.editPlanRetryCurrentPath === "string"
                                                    ? (message.editPlanRetryCurrentPath.trim() || null)
                                                    : null;
                                                if (!prompt) return;
                                                void sendMessage({
                                                    forcedInput: prompt,
                                                    forcedCurrentPath: retryCurrentPath,
                                                    allowWhenChatDisabled: true,
                                                    hideUserMessage: true,
                                                    bypassInitialSearch: true,
                                                });
                                            }}
                                            className="rounded p-1 transition-colors text-gray-500 hover:text-gray-900 hover:bg-black/5 disabled:opacity-50"
                                            title="Retry apply"
                                            aria-label="Retry apply"
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                        </button>
                                    ) : null}
                                    {message.role === "assistant" && message.editPlanRebuildPrompt && hasPreviewIssueFixRequest ? (
                                        <button
                                            type="button"
                                            disabled={isLoading}
                                            onClick={() => {
                                                if (isLoading) return;
                                                onPreviewIssueFixRequest?.();
                                            }}
                                            className="rounded p-1 transition-colors text-gray-500 hover:text-gray-900 hover:bg-black/5 disabled:opacity-50"
                                            title="Rebuild app"
                                            aria-label="Rebuild app"
                                        >
                                            <RefreshCw className="h-3.5 w-3.5" />
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        onClick={() => dismissMessage(message.id)}
                                        className={`rounded p-1 transition-colors ${message.role === "user" ? "text-white/90 hover:text-white hover:bg-white/15" : "text-gray-500 hover:text-gray-900 hover:bg-black/5"}`}
                                        title="Dismiss message"
                                        aria-label="Dismiss message"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    );
                })}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="max-w-[82%] rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                            <div className="flex items-center gap-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent"></div>
                                <span className="text-sm text-gray-700">Working on it</span>
                            </div>
                        </div>
                    </div>
                )}
                {showPreparingChangeSummaryBubble && !isLoading && !editPlanApplyLoaderMessage && (
                    <div className="flex justify-start">
                        <div className="max-w-[82%] rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                            <div className="flex items-center gap-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent"></div>
                                <span className="text-sm text-gray-700">Preparing change summary...</span>
                            </div>
                        </div>
                    </div>
                )}
                {editPlanApplyLoaderMessage && !isLoading && (
                    <div className="flex justify-start">
                        <div className="max-w-[82%] rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                            <div className="flex items-center gap-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent"></div>
                                <span className="text-sm text-gray-700">{editPlanApplyLoaderMessage}</span>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Database Connections */}
                            {activeRestorePointPreviewData ? (
                                <div
                                    className="fixed inset-0 z-[17000] bg-black/30 px-3 py-3 sm:px-4 sm:py-6"
                                    onMouseDown={(e) => {
                                        if (e.target === e.currentTarget) setActiveRestorePointPreview(null);
                                    }}
                                >
                                    <div className="mx-auto mt-4 w-full max-w-4xl overflow-hidden rounded-2xl sm:rounded-3xl border border-neutral-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.25)]">
                                        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3 sm:px-5 sm:py-4">
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-neutral-900">File diff preview</div>
                                                <div className="mt-0.5 break-all text-[11px] sm:text-xs text-neutral-500">{activeRestorePointPreviewData.path}</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setActiveRestorePointPreview(null)}
                                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                                                aria-label="Close diff preview"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <div className="grid gap-0 md:grid-cols-2">
                                            <div className="border-b border-neutral-200 md:border-b-0 md:border-r md:border-neutral-200">
                                                <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">Replaced / removed</div>
                                                <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words bg-[#fffafa] px-4 py-4 text-[11px] sm:text-[12px] leading-5 sm:leading-6 text-rose-950">
                                                    <span className="text-rose-700">{activeRestorePointPreviewData.preview.before || "(empty)"}</span>
                                                </pre>
                                            </div>
                                            <div>
                                                <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700">New / added</div>
                                                <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words bg-[#fbfffb] px-4 py-4 text-[11px] sm:text-[12px] leading-5 sm:leading-6 text-emerald-950">
                                                    <span className="text-emerald-700">{activeRestorePointPreviewData.preview.after || "(empty)"}</span>
                                                </pre>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
            {databaseConnections.length > 0 && (
                <div className="px-4 py-2 border-t bg-white flex-shrink-0">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Database className="w-4 h-4" />
                        <span>Connected databases:</span>
                        {databaseConnections.map((db) => (
                            <span key={db.id} className="bg-black/5 text-gray-800 px-2 py-1 rounded text-xs">
                                {db.name}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Database Setup */}
            {allowDatabaseSetupUi && showDatabaseSetup && (
                <div className="px-4 py-3 border-t bg-black/5 rounded-lg flex-shrink-0">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-[#F55F2A]" />
                            <span className="font-medium text-gray-900">Connect a Database</span>
                        </div>
                        <button
                            onClick={() => setShowDatabaseSetup(false)}
                            className="text-gray-600 hover:text-gray-900"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <p className="text-sm text-gray-700 mb-3">
                        Add a database connection to enable data persistence, user accounts, and dynamic content.
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                        <button
                            onClick={() => {
                                if (isSupabaseConnected) return;
                                setShowSupabaseAdvanced(false);
                                setShowSupabaseSetup(true);
                            }}
                            disabled={isSupabaseConnected}
                            className="flex items-center gap-3 px-4 py-3 bg-white rounded-lg text-sm hover:bg-black/5 transition-colors"
                        >
                            <div className="w-8 h-8 rounded-lg overflow-hidden bg-white flex items-center justify-center">
                                <img
                                    src="/images/supabase.webp"
                                    alt="Supabase"
                                    className="w-full h-full object-cover"
                                    draggable={false}
                                />
                            </div>
                            <div className="text-left">
                                <div className="font-semibold text-gray-900">Supabase</div>
                                <div className="text-xs text-gray-600">
                                    {isSupabaseConnected
                                        ? (
                                            <>
                                                <span className={supabaseDbReachable === false ? "text-red-600" : supabaseDbReachable === true ? "text-green-700" : "text-gray-600"}>
                                                    {supabaseDbReachable === false ? "Unreachable" : supabaseDbReachable === true ? "Healthy" : "Connected"}
                                                </span>
                                                {(supabaseProjectName || supabaseProjectRef) ? (
                                                    <span className="ml-1 font-medium text-gray-800">
                                                        &mdash; {supabaseProjectName || supabaseProjectRef}
                                                    </span>
                                                ) : null}
                                            </>
                                        )
                                        : "PostgreSQL with auth & real-time. Click here to get started."}
                                </div>
                            </div>
                        </button>
                    </div>
                </div>
            )}

            {/* Supabase Setup Modal */}
            {allowDatabaseSetupUi && showSupabaseSetup && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl border border-black/10 shadow-xl p-6 max-w-md w-full mx-4">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg overflow-hidden bg-white flex items-center justify-center">
                                    <img
                                        src="/images/supabase.webp"
                                        alt="Supabase"
                                        className="w-full h-full object-cover"
                                        draggable={false}
                                    />
                                </div>
                                <h3 className="text-lg font-semibold">Connect Database</h3>
                            </div>
                            <button
                                onClick={() => {
                                    setShowSupabaseSetup(false);
                                    setShowSupabaseAdvanced(false);
                                }}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="rounded-xl border border-black/10 bg-white p-3">
                                <div className="text-sm font-semibold text-gray-900">Recommended</div>
                                <div className="text-sm text-gray-700 mt-1">
                                    Create a new database. This enables you to begin storing user or product data.
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={handleCreateSupabaseProject}
                                    className="flex-1 bg-[#F55F2A] text-white py-2 px-4 rounded-full hover:bg-[#E04E1B] text-sm transition-colors"
                                >
                                    Create
                                </button>
                                <a
                                    href="https://supabase.com/dashboard"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 px-3 py-2 rounded-full border border-black/10 hover:bg-gray-50 text-sm text-gray-700 flex items-center gap-2"
                                >
                                    Dashboard <ExternalLink className="w-4 h-4" />
                                </a>
                            </div>

                            <button
                                onClick={() => setShowSupabaseAdvanced((v) => !v)}
                                className="w-full text-left px-3 py-2 rounded-xl border border-black/10 hover:bg-gray-50 text-sm text-gray-800 flex items-center justify-between"
                            >
                                <span className="font-semibold">I already have a database</span>
                                {showSupabaseAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>

                            {showSupabaseAdvanced ? (
                                <div className="space-y-3 rounded-xl border border-black/10 bg-white p-3">
                                    <div className="text-xs text-gray-600">
                                        Manual connections require pasting keys. Use only if you already have a Supabase project.
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Project Reference ID (or Supabase URL)
                                        </label>
                                        <input
                                            type="text"
                                            value={existingSupabaseProjectRef}
                                            onChange={(e) => setExistingSupabaseProjectRef(e.target.value)}
                                            placeholder="abcdefghijklmnopqrst  or  https://abcdefghijklmnopqrst.supabase.co"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#F55F2A]"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            In the URL: <span className="font-mono">https://&lt;project-ref&gt;.supabase.co</span>
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Anon Key</label>
                                        <input
                                            type="password"
                                            value={existingSupabaseAnonKey}
                                            onChange={(e) => setExistingSupabaseAnonKey(e.target.value)}
                                            placeholder="eyJhbGciOi..."
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#F55F2A]"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Supabase Dashboard → Settings → API → Project API keys
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Service Role Key (optional)</label>
                                        <input
                                            type="password"
                                            value={existingSupabaseServiceRoleKey}
                                            onChange={(e) => setExistingSupabaseServiceRoleKey(e.target.value)}
                                            placeholder="eyJhbGciOi..."
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#F55F2A]"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Only if you need server-side admin access. Keep this secret.
                                        </p>
                                    </div>

                                    <button
                                        onClick={handleConnectExistingSupabaseProject}
                                        className="w-full bg-black text-white py-2 px-4 rounded-full hover:bg-black/90 transition-colors font-semibold"
                                    >
                                        Connect Existing Project
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            )}

            {/* Migration Review & Apply Modal (non-coder friendly guardrails) */}
            {migrationReviewMessageId ? (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
                        {(() => {
                            const msg = messages.find((m) => m.id === migrationReviewMessageId);
                            const proposalId = msg?.migrationProposalId || "";
                            const destructive = Boolean(msg?.migrationDestructive);
                            const isApplying = proposalId ? Boolean(applyingMigrationIds[proposalId]) : false;
                            const typedOk = destructive ? migrationConfirmText.trim().toLowerCase() === "apply" : true;
                            const dbBlocksApply = isSupabaseConnected && supabaseDbReachable === false;
                            const canApply = Boolean(proposalId) && migrationAcknowledge && typedOk && !isApplying && !dbBlocksApply;

                            return (
                                <>
                                    <div className="flex items-start justify-between gap-3 mb-4">
                                        <div className="flex items-start gap-3">
                                            <div className={`mt-0.5 h-9 w-9 rounded-lg flex items-center justify-center ${destructive ? "bg-amber-50" : "bg-green-50"}`}>
                                                {destructive ? (
                                                    <AlertTriangle className="h-5 w-5 text-amber-700" />
                                                ) : (
                                                    <Database className="h-5 w-5 text-green-700" />
                                                )}
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-semibold text-gray-900">
                                                    Review database update
                                                </h3>
                                                <div className="text-sm text-gray-600">
                                                    This may change your database schema or data. Proceed carefully.
                                                </div>
                                                {proposalId ? (
                                                    <div className="mt-1 text-xs text-gray-500">ID: {proposalId}</div>
                                                ) : null}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setMigrationReviewMessageId(null)}
                                            className="text-gray-400 hover:text-gray-600"
                                            type="button"
                                            aria-label="Close"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>

                                    {isSupabaseConnected ? (
                                        supabaseDbReachable === false ? (
                                            <div className={`mt-4 rounded-md border p-3 text-sm ${
                                                supabaseDbReason === "project_paused" || supabaseDbReason === "timeout_or_network"
                                                    ? "border-amber-200 bg-amber-50 text-amber-900"
                                                    : "border-red-200 bg-red-50 text-red-800"
                                            }`}>
                                                <div className="font-semibold">
                                                    {supabaseDbReason === "project_paused"
                                                        ? "Supabase project is paused"
                                                        : supabaseDbReason === "timeout_or_network"
                                                          ? "Database still resuming…"
                                                          : "Supabase is connected, but the database is unreachable"}
                                                </div>
                                                <div className={`mt-1 text-sm whitespace-pre-wrap ${
                                                    supabaseDbReason === "project_paused" || supabaseDbReason === "timeout_or_network"
                                                        ? "text-amber-800"
                                                        : "text-red-700"
                                                }`}>
                                                    {supabaseDbStatusText || "Database not reachable (project may be paused or deleted)."}
                                                </div>
                                                <div className="mt-2 flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => void checkSupabaseDbHealth({ silent: true })}
                                                        className={`px-2 py-1 text-xs bg-white rounded ${
                                                            supabaseDbReason === "project_paused" || supabaseDbReason === "timeout_or_network"
                                                                ? "border border-amber-200 hover:bg-amber-50"
                                                                : "border border-red-200 hover:bg-red-50"
                                                        }`}
                                                    >
                                                        Re-check
                                                    </button>
                                                    {supabaseDbLastCheckedAt ? (
                                                        <span className={`text-[11px] ${
                                                            supabaseDbReason === "project_paused" || supabaseDbReason === "timeout_or_network"
                                                                ? "text-amber-700/80"
                                                                : "text-red-700/80"
                                                        }`}>
                                                            Last checked {Math.max(1, Math.round((Date.now() - supabaseDbLastCheckedAt) / 1000))}s ago
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : supabaseDbReachable === null ? (
                                            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
                                                Checking Supabase database reachability…
                                            </div>
                                        ) : null
                                    ) : null}

                                    {/* <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
                                        <div className="font-semibold">What this is for</div>
                                        <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">
                                            {msg?.content || "Database update"}
                                        </div>
                                        <div className="mt-2 text-xs text-gray-600">
                                            Note: App “restore points” do not automatically undo database changes.
                                        </div>
                                    </div> */}
                                    {msg?.stagedBundleId ? (
                                        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
                                            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                                                <div className="text-sm font-semibold text-amber-900">Code changes are staged</div>
                                                <div className="mt-1 text-xs text-amber-900/80">
                                                    These code changes have not been saved yet to avoid breaking the app before the database update.
                                                    After you apply this migration, the code changes will apply automatically.
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const ok = window.confirm(
                                                                "Discard the staged code changes?\n\nThis will keep your app on the last working version."
                                                            );
                                                            if (!ok) return;
                                                            discardStagedBundle(msg.stagedBundleId!);
                                                        }}
                                                        className="px-3 py-1.5 text-xs font-semibold rounded border border-amber-200 bg-white text-amber-900 hover:bg-amber-100/60"
                                                    >
                                                        Discard staged code
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const ok = window.confirm(
                                                                "Apply the staged code changes now (without waiting for the database update)?\n\nThis can break the app if the schema isn’t updated yet."
                                                            );
                                                            if (!ok) return;
                                                            applyStagedBundle(msg.stagedBundleId!, { unsafe: true });
                                                        }}
                                                        className="px-3 py-1.5 text-xs font-semibold rounded border border-amber-200 bg-white text-amber-900 hover:bg-amber-100/60"
                                                        title="Unsafe: apply code before DB update"
                                                    >
                                                        Apply staged code (unsafe)
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}

                                    <div className="mt-4 space-y-3">
                                        <label className="flex items-start gap-2 text-sm text-gray-800">
                                            <input
                                                type="checkbox"
                                                className="mt-1"
                                                checked={migrationAcknowledge}
                                                onChange={(e) => setMigrationAcknowledge(e.target.checked)}
                                            />
                                            <span>
                                                I understand this will change my database.
                                                {destructive ? " It could permanently affect existing data." : ""}
                                            </span>
                                        </label>

                                        {destructive ? (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                                    Type APPLY to continue
                                                </label>
                                                <input
                                                    type="text"
                                                    value={migrationConfirmText}
                                                    onChange={(e) => setMigrationConfirmText(e.target.value)}
                                                    placeholder="APPLY"
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                                                />
                                                <div className="mt-1 text-xs text-gray-500">
                                                    This extra step is here to prevent accidents.
                                                </div>
                                            </div>
                                        ) : null}

                                        <button
                                            type="button"
                                            onClick={() => setMigrationShowSqlInModal((v) => !v)}
                                            className="text-xs text-gray-700 underline"
                                        >
                                            {migrationShowSqlInModal ? "Hide advanced SQL" : "Show advanced SQL"}
                                        </button>

                                        {migrationShowSqlInModal && msg?.migrationSql ? (
                                            <pre className="max-h-64 overflow-auto rounded bg-white border border-gray-200 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                                                {msg.migrationSql}
                                            </pre>
                                        ) : null}
                                    </div>

                                    <div className="mt-5 flex gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setMigrationReviewMessageId(null)}
                                            className="flex-1 bg-gray-100 text-gray-900 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            disabled={!canApply}
                                            onClick={async () => {
                                                if (!proposalId) return;
                                                if (applyingMigrationIds[proposalId]) return;
                                                setApplyingMigrationIds((prev) => ({ ...prev, [proposalId]: true }));
                                                try {
                                                    const health = await checkSupabaseDbHealth({ silent: true });
                                                    if (!health.reachable) {
                                                        const detail = health?.error || supabaseDbStatusText || "Database not reachable";
                                                        setMessages((prev) =>
                                                            prev.map((m) =>
                                                                m.id === migrationReviewMessageId
                                                                    ? { ...m, migrationStatus: "FAILED", content: `${m.content}\n\nMigration failed: Supabase is unreachable.\n${detail}` }
                                                                    : m
                                                            )
                                                        );
                                                        return;
                                                    }

                                                    const headers = await withCsrfHeaders();
                                                    const res = await fetch("/api/supabase/migrations/apply", {
                                                        method: "POST",
                                                        headers,
                                                        body: JSON.stringify({ proposalId, confirm: `APPLY ${proposalId}`, appId }),
                                                    });
                                                    const json = await res.json().catch(() => ({} as any));
                                                    if (!res.ok || json?.ok === false) {
                                                        const failure = parseMigrationApplyFailure(json);
                                                        const failureText = formatMigrationFailureContent(failure);
                                                        shouldDedupeMigrationFailure(proposalId, failure);
                                                        setMessages((prev) =>
                                                            prev.map((m) =>
                                                                m.id === migrationReviewMessageId
                                                                    ? {
                                                                          ...m,
                                                                          migrationStatus: "FAILED",
                                                                          migrationErrorCode: failure.errorCode || undefined,
                                                                          migrationRelationName: failure.relationName || undefined,
                                                                          migrationCanRegenerate: failure.canRegenerate || undefined,
                                                                          migrationRetryPrompt: failure.canRegenerate
                                                                              ? buildMigrationRetryPrompt(failure.relationName, failure.errorCode)
                                                                              : undefined,
                                                                          content: String(m.content || "").includes(failureText)
                                                                              ? m.content
                                                                              : `${m.content}\n\n${failureText}`,
                                                                      }
                                                                    : m
                                                            )
                                                        );
                                                        return;
                                                    }
                                                    setMessages((prev) =>
                                                        prev.map((m) =>
                                                            m.id === migrationReviewMessageId
                                                                ? { ...m, migrationStatus: "APPLIED", content: `${m.content}\n\nMigration applied.` }
                                                                : m
                                                        )
                                                    );

                                                    // If we staged code edits behind this migration, apply them now.
                                                    markMigrationApplied(proposalId);
                                                    await runPostMigrationRefreshPipeline();
                                                    setMigrationReviewMessageId(null);
                                                } catch (e) {
                                                    console.error("Migration apply error:", e);
                                                    setMessages((prev) =>
                                                        prev.map((m) =>
                                                            m.id === migrationReviewMessageId
                                                                ? {
                                                                      ...m,
                                                                      migrationStatus: "FAILED",
                                                                      content: String(m.content || "").includes("Update failed.")
                                                                          ? m.content
                                                                          : `${m.content}\n\nUpdate failed. Please retry.`,
                                                                  }
                                                                : m
                                                        )
                                                    );
                                                } finally {
                                                    setApplyingMigrationIds((prev) => {
                                                        const next = { ...prev };
                                                        delete next[proposalId];
                                                        return next;
                                                    });
                                                }
                                            }}
                                            className={`flex-1 text-white py-2 px-4 rounded-md transition-colors disabled:opacity-50 ${destructive ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"
                                                }`}
                                        >
                                            {isApplying ? "Applying…" : "Apply"}
                                        </button>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            ) : null}

            {/* Input */}
            <div className="p-4 border-t bg-white rounded-lg flex-shrink-0">
                {/* {showCreditsAccuracyNotice ? (
                    <div className="mb-2 flex items-start justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
                        <div className="text-sm leading-5 text-amber-800">
                            <span>We make daily accuracy improvements. Please use </span>
                            <span className="inline-flex items-center gap-1 align-middle">
                                <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>/</span>
                                <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
                            </span>
                            <span> feedback to help us improve your experience.</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowCreditsAccuracyNotice(false)}
                            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-amber-700 transition hover:bg-amber-100"
                            aria-label="Dismiss credit accuracy notice"
                            title="Dismiss"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ) : null} */}

                <div className="mb-2 flex items-center justify-between">
                    <div className="text-[12px] text-gray-700">
                        {aiCreditsRemaining == null
                            ? "Credits remaining: —"
                            : `Credits remaining: ${aiCreditsRemaining}`}
                    </div>
                    <button
                        type="button"
                        className="px-3 py-1 text-xs font-semibold bg-accent text-white rounded-full hover:bg-accent-dark disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                        onClick={() => {
                            if (topupBusy) return;
                            setTopupModalOpen(true);
                        }}
                        disabled={topupBusy}
                    >
                        <span>{topupBusy ? "Opening checkout…" : "Add credits"}</span>
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                </div>

                {topupModalOpen ? (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                        <div className="w-full max-w-lg rounded-2xl border border-black/10 bg-white shadow-xl">
                            <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
                                <div>
                                    <div className="text-lg font-semibold text-neutral-900">Top up AI credits</div>
                                    <div className="mt-0.5 text-xs text-neutral-600">
                                        AI edit credits scale with request size.
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setTopupModalOpen(false)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                                    aria-label="Close"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="px-6 py-5">
                                {TOPUP_COMING_SOON ? (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                        Credit top-ups are currently disabled.
                                    </div>
                                ) : null}

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-[11px] font-semibold text-neutral-600">Credits</label>
                                        <select
                                            value={topupCredits}
                                            onChange={(e) => setTopupCredits(Number(e.target.value))}
                                            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-black/5"
                                            disabled={TOPUP_COMING_SOON || topupBusy}
                                        >
                                            {topupOptions.map((n) => (
                                                <option key={n} value={n}>
                                                    {n.toLocaleString()} credits
                                                </option>
                                            ))}
                                        </select>

                                        <div className="mt-2 text-[12px] text-neutral-700">
                                            Credit use varies by request size.
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                                            Total
                                        </div>
                                        <div className="mt-2 text-2xl font-semibold text-neutral-900">
                                            {(() => {
                                                const unit = topupConfig?.unitPriceCents ?? 10;
                                                const currency = (topupConfig?.currency ?? "usd").toLowerCase();
                                                const amount = ((topupCredits * unit) / 100).toFixed(2);
                                                return currency === "usd" ? `$${amount}` : `${currency.toUpperCase()} ${amount}`;
                                            })()}
                                        </div>
                                        <div className="mt-2 text-[11px] text-neutral-600">
                                            Top-ups never expire. Applied after Stripe confirms payment.
                                        </div>
                                    </div>
                                </div>

                                {showProUpgradeAlternative ? (
                                    <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/5 p-4">
                                        <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">
                                            Pro alternative
                                        </div>
                                        <div className="mt-1 text-sm font-semibold text-neutral-900">
                                            Upgrade to Pro for ${PRO_MONTHLY_PRICE_USD.toFixed(2)}/month
                                        </div>
                                        <div className="mt-1 text-[12px] text-neutral-700">
                                            {proSavingsPct > 0
                                                ? `Save roughly ${proSavingsPct}% on this purchase by upgrading your account to Pro instead.`
                                                : "Pro can be better value than repeated top-ups as usage grows."}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setTopupModalOpen(false);
                                                window.location.href = "/price";
                                            }}
                                            className="mt-3 inline-flex rounded-full border border-accent/30 bg-white px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/5"
                                        >
                                            Upgrade to Pro Instead
                                        </button>
                                    </div>
                                ) : null}

                                <div className="mt-5 flex flex-col gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                                if (topupBusy) return;
                                            setTopupModalOpen(false);
                                                void (async () => {
                                                    if (typeof window === "undefined") return;

                                                    const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                                                    const creditsInt = Number.isFinite(topupCredits) ? Math.max(1, Math.floor(topupCredits)) : 0;
                                                    if (!creditsInt) return;

                                                    setTopupBusy(true);
                                                    try {
                                                        const idToken = await user?.getIdToken?.().catch(() => null);
                                                        if (!idToken) {
                                                            const loginUrl = `/login?next=${encodeURIComponent(nextPath)}`;
                                                            await showAlert("Your session expired. Please sign in again to continue checkout.", "Sign in required");
                                                            const loginWindow = window.open(loginUrl, "_blank", "noopener,noreferrer");
                                                            if (!loginWindow) {
                                                                window.location.href = loginUrl;
                                                            }
                                                            return;
                                                        }

                                                        await ensureSessionAndCsrf().catch(() => null);
                                                        const headers = await withCsrfHeaders();
                                                        headers.Authorization = `Bearer ${idToken}`;

                                                        const response = await fetch("/api/billing/create-credit-topup-session", {
                                                            method: "POST",
                                                            headers,
                                                            credentials: "include",
                                                            body: JSON.stringify({ credits: creditsInt, next: nextPath }),
                                                        });

                                                        const data = (await response.json().catch(() => ({}))) as any;

                                                        if (response.status === 401) {
                                                            const loginUrl = `/login?next=${encodeURIComponent(nextPath)}`;
                                                            await showAlert("Your session expired. Please sign in again to continue checkout.", "Sign in required");
                                                            const loginWindow = window.open(loginUrl, "_blank", "noopener,noreferrer");
                                                            if (!loginWindow) {
                                                                window.location.href = loginUrl;
                                                            }
                                                            return;
                                                        }

                                                        if (!response.ok || !data?.url) {
                                                            throw new Error(typeof data?.error === "string" && data.error ? data.error : "Could not start the Stripe checkout session.");
                                                        }

                                                        window.location.href = data.url;
                                                    } catch (error) {
                                                        console.error("Failed to start top-up checkout", error);
                                                        await showAlert("We couldn’t start checkout right now. Please try again.", "Top up");
                                                    } finally {
                                                        setTopupBusy(false);
                                                    }
                                                })();
                                        }}
                                        className="w-full rounded-full bg-accent text-white px-4 py-3 text-sm font-semibold hover:bg-accent-dark disabled:opacity-60 disabled:cursor-not-allowed"
                                        disabled={TOPUP_COMING_SOON || topupBusy}
                                    >
                                        Continue to Stripe
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTopupModalOpen(false);
                                            window.location.href = "/price#topup";
                                        }}
                                        className="w-full rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
                                    >
                                        View pricing
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {PRODUCTION_AGENT_CHAT_BLOCKED ? (
                    <div className="mb-3 rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] px-4 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                        <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-neutral-900">Agent chat is temporarily paused</p>
                                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                        Paused
                                    </span>
                                </div>
                                <p className="mt-1 text-sm leading-relaxed text-neutral-700">
                                    {PRODUCTION_AGENT_CHAT_BLOCK_MESSAGE}
                                </p>
                            </div>
                        </div>
                    </div>
                ) : chatDisabled ? (
                    <div className="mb-3 rounded-[1.5rem] border border-amber-200 bg-[linear-gradient(180deg,rgba(255,247,237,0.98),rgba(255,255,255,1))] px-4 py-4 shadow-[0_12px_32px_rgba(251,146,60,0.10)]">
                        <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 ring-1 ring-amber-200">
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-neutral-900">Preview not ready yet</p>
                                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                        Waiting
                                    </span>
                                </div>
                                <p className="mt-1 text-sm leading-relaxed text-neutral-700">
                                    Preview is still loading. Chat will unlock once the preview renders.
                                </p>
                            </div>
                        </div>
                    </div>
                ) : hasPreviewIssue ? (
                    <div className="mb-3 rounded-[1.5rem] border border-rose-200 bg-[linear-gradient(180deg,rgba(255,241,242,0.98),rgba(255,255,255,1))] px-4 py-4 shadow-[0_12px_32px_rgba(244,63,94,0.10)]">
                        <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 ring-1 ring-rose-200">
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-rose-950">Preview hit an error</p>
                                    <span className="inline-flex items-center rounded-full border border-rose-200 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-700">
                                        Error
                                    </span>
                                </div>
                                <p className="mt-1 text-sm leading-relaxed text-neutral-700">
                                    Something went wrong building website.
                                </p>
                                <div className="mt-3 flex items-center gap-2">
                                    {hasPreviewIssueFixRequest ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onPreviewIssueFixRequest?.();
                                            }}
                                            className="inline-flex shrink-0 items-center justify-center rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                                        >
                                            Fix with AI
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => onPreviewIssueAction?.()}
                                            className="inline-flex shrink-0 items-center rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-100"
                                        >
                                            {String(previewIssueActionLabel || "Refresh").trim() || "Refresh"}
                                        </button>
                                    )}
                                    <details className="relative ml-auto shrink-0">
                                        <summary className="inline-flex cursor-pointer list-none items-center justify-center rounded-full border border-rose-200 bg-white p-2 text-rose-600 transition hover:bg-rose-50">
                                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                        </summary>
                                        <div className="absolute right-0 z-20 bottom-full mb-2 w-[min(28rem,calc(100vw-4rem))] max-w-[calc(100vw-4rem)] rounded-xl border border-rose-200 bg-white px-3 py-2 shadow-[0_10px_24px_rgba(244,63,94,0.08)]">
                                            <div className="space-y-2">
                                                <p className="text-sm leading-6 text-neutral-700">
                                                    The preview ran into a problem, but you can still chat here to debug it or ask for help.
                                                </p>
                                                <div className="max-w-full rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900 break-words whitespace-pre-wrap">
                                                    {previewIssueText}
                                                </div>
                                            </div>
                                        </div>
                                    </details>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="flex items-stretch overflow-hidden rounded-[1.35rem] border border-[#F55F2A]/18 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => {
                            const nextValue = e.target.value;
                            if (freeCompileFixContext) {
                                const lockedValue = buildCompileFixPrefill(freeCompileFixContext);
                                if (nextValue !== lockedValue) {
                                    const notice = "Free compile-fix mode was disabled because the immutable context was edited. This request now uses normal billed mode.";
                                    setFreeCompileFixContext(null);
                                    setInput(nextValue);
                                    setMessages((prev) => [
                                        ...prev,
                                        {
                                            id: `compile_fix_unlocked_${Date.now()}`,
                                            role: "assistant",
                                            content: notice,
                                            timestamp: new Date(),
                                            type: "text",
                                        },
                                    ]);
                                    return;
                                }
                            }
                            setInput(nextValue);
                        }}
                        onKeyPress={handleKeyPress}
                        placeholder="Ask me to build something..."
                        className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
                        rows={3}
                        disabled={isLoading || chatDisabled}
                    />
                    <button
                        type="button"
                        onClick={() => {
                            void sendMessage();
                        }}
                        disabled={!input.trim() || isLoading || chatDisabled}
                        className="flex w-16 items-center justify-center border-l border-[#F55F2A]/12 bg-[linear-gradient(180deg,rgba(245,95,42,0.98),rgba(233,94,50,0.96))] text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Send message"
                    >
                        <Send className="h-6 w-6" />
                    </button>
                </div>
                <div className="mt-2 text-xs text-neutral-500">
                    Press Enter to send, Shift+Enter for new line
                </div>
            </div>
        </div>
    );
}
