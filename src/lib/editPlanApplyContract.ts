/**
 * editPlanApplyContract.ts
 *
 * Pure helpers for interpreting the backend's result.apply contract from
 * completed edit-plan jobs.  No React, no side effects, fully testable.
 *
 * Backend endpoint: GET /api/v1/app-embeddings/jobs/:jobId
 * Relevant payload path: job.result.apply
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmbeddingApplyResultMachine = {
    wrote: number | null;
    deleted: number | null;
    replayed: boolean;
};

/**
 * Full canonical shape of job.result.apply as returned by the backend.
 * All fields are nullable/optional to safely accommodate partial responses.
 */
export type EmbeddingApplyResult = {
    ok: boolean;
    outcome: string | null;
    saved: boolean | null;
    patchedFileCount: number | null;
    expectedOps: number | null;
    machine: EmbeddingApplyResultMachine | null;
    requiresRestart: boolean;
    requiresRebuild: boolean;
    restartPending: boolean;
    restartConfirmed: boolean;
    requestId: string | null;
    code: string | null;
    reason: string | null;
    /** HTTP status code from the machine-layer response, if any */
    machineStatus: number | null;
    retryable: boolean;
    retryAfterSeconds: number | null;
    userMessage: string | null;
    recommendedAction: string | null;
    restartJobId: string | null;
    idempotentProof: string | null;
    // Legacy flat fields still present on some responses
    wrote?: number | null;
    deleted?: number | null;
    [key: string]: unknown;
};

/**
 * The five discrete apply states the frontend must distinguish.
 *
 * confirmed_success  – write proof exists, no restart needed / restart not pending
 * restart_pending    – write proof exists, preview restart queued but not yet confirmed
 * restart_confirmed  – write proof exists, preview restart completed
 * uncertain          – backend could not fully confirm write/preview state
 * failed             – backend explicitly reports failure with no write proof
 */
export type ApplyState =
    | "confirmed_success"
    | "restart_pending"
    | "restart_confirmed"
    | "uncertain"
    | "failed";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the apply payload contains any authoritative evidence that
 * at least one file was written to the preview machine.
 *
 * Rule order mirrors Section 3-A of the Frontend Agent Instruction.
 */
export function hasWriteProof(apply: Partial<EmbeddingApplyResult> | Record<string, unknown>): boolean {
    if (apply.saved === true) return true;

    // machine.wrote / machine.deleted (canonical nested form)
    const machine = apply.machine && typeof apply.machine === "object" ? apply.machine as Record<string, unknown> : null;
    if (machine) {
        const mWrote = machine.wrote;
        const mDeleted = machine.deleted;
        if (typeof mWrote === "number" && mWrote > 0) return true;
        if (typeof mDeleted === "number" && mDeleted > 0) return true;
    }

    // Legacy flat fields (some backends emit these at top level)
    const legacyWrote = (apply as Record<string, unknown>).wrote;
    const legacyDeleted = (apply as Record<string, unknown>).deleted;
    if (typeof legacyWrote === "number" && legacyWrote > 0) return true;
    if (typeof legacyDeleted === "number" && legacyDeleted > 0) return true;

    // patchedFileCount
    if (typeof apply.patchedFileCount === "number" && apply.patchedFileCount > 0) return true;

    // idempotentProof – presence alone is sufficient
    if (typeof apply.idempotentProof === "string" && apply.idempotentProof.trim().length > 0) return true;

    return false;
}

/**
 * Returns true when the apply payload signals an explicit uncertain state,
 * regardless of write proof.
 */
function isUncertainSignal(apply: Record<string, unknown>): boolean {
    const code = String(apply.code || "").trim().toUpperCase();
    const outcome = String(apply.outcome || "").trim().toLowerCase();
    return (
        code === "APPLY_STATE_UNCERTAIN" ||
        apply.uncertain === true ||
        apply.applyUncertain === true ||
        outcome === "apply_uncertain" ||
        outcome === "saved_source_machine_uncertain"
    );
}

// ---------------------------------------------------------------------------
// Core decision function
// ---------------------------------------------------------------------------

/**
 * Derives a single ApplyState from a raw result.apply payload.
 *
 * Never throws.  Returns "uncertain" for any unrecognised/partial payload.
 *
 * Decision order (matches spec Section 11):
 *  1. ok=false AND no write proof               → failed
 *  2. No write proof AND (saved=null OR signal)  → uncertain
 *  3. Write proof AND restartConfirmed=true       → restart_confirmed
 *  4. Write proof AND restartPending=true         → restart_pending
 *  5. Write proof                                 → confirmed_success
 *  6. Fallback                                    → uncertain
 */
export function resolveApplyState(applyRaw: unknown): ApplyState {
    if (!applyRaw || typeof applyRaw !== "object") return "uncertain";

    const apply = applyRaw as Record<string, unknown>;
    const writeProof = hasWriteProof(apply);
    const okExplicitlyFalse = apply.ok === false;
    const saved = apply.saved; // may be boolean, null, or undefined
    const restartPending = apply.restartPending === true;
    const restartConfirmed = apply.restartConfirmed === true;

    // 1. Explicit failure (ok strictly === false) with no evidence of a write
    if (okExplicitlyFalse && !writeProof) {
        return "failed";
    }

    // 2. No write proof + uncertainty signals or unknown saved status
    if (!writeProof) {
        if (isUncertainSignal(apply)) return "uncertain";
        if (saved === null || saved === undefined) return "uncertain";
        // ok=true but saved is false and no write proof – treat as uncertain
        return "uncertain";
    }

    // 3–5. We have write proof; determine restart state.
    if (restartConfirmed) return "restart_confirmed";
    if (restartPending) return "restart_pending";
    return "confirmed_success";
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

/**
 * Returns a concise user-facing message for a given apply state.
 * Always prefers a backend-supplied userMessage when present and non-trivial.
 */
export function buildApplyStateMessage(
    state: ApplyState,
    apply: Partial<EmbeddingApplyResult> | Record<string, unknown>,
): string {
    const userMessage = typeof apply.userMessage === "string" ? apply.userMessage.trim() : "";
    const recommendedAction = typeof apply.recommendedAction === "string" ? apply.recommendedAction.trim() : "";

    switch (state) {
        case "confirmed_success":
            return userMessage || "Changes applied successfully.";

        case "restart_pending":
            return userMessage || "Changes were written. Preview restart is still in progress — it will update shortly.";

        case "restart_confirmed":
            return userMessage || "Changes were written and the preview has been restarted. Refresh the preview to see the latest version.";

        case "uncertain": {
            if (userMessage) return userMessage;
            const savedToSource = apply.savedToSource === true;
            if (savedToSource) {
                return "Your changes were saved, but the preview may not have picked them up yet. Perform a rebuild to load the latest version.";
            }
            const base =
                "We had a hiccup while reconnecting to the preview. Your changes may have been saved, but the live preview may not be up to date yet.";
            return recommendedAction
                ? `${base} Recommended: ${recommendedAction}`
                : `${base} Perform a rebuild to pick up the latest changes.`;
        }

        case "failed": {
            if (userMessage) return userMessage;
            const reason = typeof apply.reason === "string" ? apply.reason.trim() : "";
            const code = typeof apply.code === "string" ? apply.code.trim() : "";
            const parts = ["Changes were not confirmed as applied."];
            if (reason) parts.push(`Reason: ${reason}`);
            if (code) parts.push(`Error code: ${code}`);
            if (recommendedAction) parts.push(`Recommended: ${recommendedAction}`);
            return parts.join("\n");
        }
    }
}
