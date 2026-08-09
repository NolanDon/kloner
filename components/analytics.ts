import { db } from "@/lib/firebase";
import { doc, runTransaction, serverTimestamp, collection, addDoc, setDoc, increment, arrayUnion } from "firebase/firestore";

export type ExportAnalyticsUser = {
    uid?: string;
} | null;

type ExportExtra = {
    status?: "success" | "error";
    error?: string | null;
    durationMs?: number | null;
};

function msToMinutesRounded(ms: number | null | undefined): number | null {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
    // one decimal place
    return Math.round((ms / 1000 / 60) * 10) / 10;
}

function getAnalyticsErrorText(err: unknown): { code: string; message: string } {
    const code = String((err as any)?.code || "").trim().toLowerCase();
    const message = String((err as any)?.message || "").trim();
    return { code, message };
}

function isIgnorableAnalyticsError(err: unknown): boolean {
    const { code, message } = getAnalyticsErrorText(err);
    return (
        code.includes("permission-denied") ||
        code.includes("unauthenticated") ||
        code.includes("failed-precondition") ||
        code.includes("unavailable") ||
        code.includes("deadline-exceeded") ||
        code.includes("cancelled") ||
        message.toLowerCase().includes("missing or insufficient permissions") ||
        message.toLowerCase().includes("permission denied") ||
        message.toLowerCase().includes("blocked")
    );
}

function logAnalyticsBestEffortFailure(scope: string, err: unknown) {
    const { code, message } = getAnalyticsErrorText(err);
    const summary = code || message || "unknown error";
    if (isIgnorableAnalyticsError(err)) {
        console.warn(`[analytics] ${scope} skipped (${summary})`);
        return;
    }
    console.warn(`[analytics] ${scope} failed (${summary})`);
}

/* =========================
 * EXPORT ANALYTICS
 * ========================= */

export async function recordExportAnalytics(
    user: ExportAnalyticsUser,
    draftId?: string | null,
    extra?: ExportExtra,
) {
    try {
        if (!user || !user.uid) {
            return;
        }

        const ref = doc(db, "kloner_users", user.uid, "meta", "editor");

        const status: "success" | "error" =
            extra?.status === "error" ? "error" : "success";

        const durationMs =
            typeof extra?.durationMs === "number" && extra.durationMs > 0
                ? extra.durationMs
                : null;

        const durationMinutes = msToMinutesRounded(durationMs);

        await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            const now = serverTimestamp();

            const basePatch = {
                lastExportAt: now,
                lastDraftId: draftId ?? null,
                lastExportStatus: status,
                lastExportError: extra?.error ?? null,

                // old ms field kept for backwards-compat
                lastExportDurationMs: durationMs,

                // new human-readable field
                lastExportDurationMinutes: durationMinutes,
            };

            if (!snap.exists()) {
                const isSuccess = status === "success";
                const isError = status === "error";

                tx.set(
                    ref,
                    {
                        createdAt: now,
                        updatedAt: now,
                        firstExportAt: now,
                        ...basePatch,
                        exportCount: isSuccess ? 1 : 0,        // keep old meaning: successful exports
                        exportAttemptCount: 1,                 // all attempts
                        exportSuccessCount: isSuccess ? 1 : 0,
                        exportErrorCount: isError ? 1 : 0,
                    },
                    { merge: true },
                );
            } else {
                const data = (snap.data() || {}) as Record<string, any>;

                const currentCount =
                    typeof data.exportCount === "number" ? data.exportCount : 0;
                const currentAttempt =
                    typeof data.exportAttemptCount === "number"
                        ? data.exportAttemptCount
                        : 0;
                const currentSuccess =
                    typeof data.exportSuccessCount === "number"
                        ? data.exportSuccessCount
                        : 0;
                const currentError =
                    typeof data.exportErrorCount === "number"
                        ? data.exportErrorCount
                        : 0;

                const isSuccess = status === "success";
                const isError = status === "error";

                tx.set(
                    ref,
                    {
                        updatedAt: now,
                        firstExportAt: data.firstExportAt || now,
                        ...basePatch,
                        exportCount: isSuccess
                            ? currentCount + 1
                            : currentCount,
                        exportAttemptCount: currentAttempt + 1,
                        exportSuccessCount: isSuccess
                            ? currentSuccess + 1
                            : currentSuccess,
                        exportErrorCount: isError
                            ? currentError + 1
                            : currentError,
                    },
                    { merge: true },
                );
            }
        });

    } catch (err) {
        // analytics failures should never block export
        logAnalyticsBestEffortFailure("recordExportAnalytics", err);
    }
}

/* =========================
 * DEPLOY ANALYTICS
 * ========================= */

export type AnalyticsUser = { uid?: string } | null | undefined;

export async function recordDeployAnalytics(
    user: AnalyticsUser,
    patch: Record<string, any>,
    incrementFields: string[] = [],
) {
    try {
        if (!user?.uid) {
            return;
        }

        const ref = doc(
            db,
            "kloner_users",
            user.uid,
            "meta",
            "editor",
        );

        await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            const now = serverTimestamp();

            if (!snap.exists()) {
                const baseCounters: Record<string, number> = {};
                for (const f of incrementFields) {
                    baseCounters[f] = 1;
                }

                tx.set(
                    ref,
                    {
                        createdAt: now,
                        updatedAt: now,
                        ...baseCounters,
                        ...patch,
                    },
                    { merge: true },
                );
            } else {
                const data = (snap.data() || {}) as Record<string, any>;
                const nextCounters: Record<string, number> = {};
                for (const f of incrementFields) {
                    const current = typeof data[f] === "number" ? data[f] : 0;
                    nextCounters[f] = current + 1;
                }

                tx.set(
                    ref,
                    {
                        updatedAt: now,
                        ...nextCounters,
                        ...patch,
                    },
                    { merge: true },
                );
            }
        });

    } catch (err) {
        logAnalyticsBestEffortFailure("recordDeployAnalytics", err);
    }
}

/* =========================
 * EDITOR SESSION ANALYTICS
 * ========================= */

export type EditorSessionMetrics = {
    pageSwitchCount?: number;
    saveCount?: number;          // manual saves
    autosaveCount?: number;      // autosave snapshots
    aiEditCount?: number;        // all AI invocations
    aiMiniToolbarCount?: number; // subset: mini-toolbar
    aiApplyCount?: number;       // when AI HTML is actually applied
    exportCount?: number;
    archiveCount?: number;
    restoreCount?: number;
    modeSwitchCount?: number;
    deviceSwitchCount?: number;
    historyRestoreCount?: number;

    // NEW
    historyClearCount?: number;
    historyDeleteCount?: number;
};

export type EditorSessionCounters = {
    save: number;
    export: number;
    autosave: number;
    pageSwitch: number;
    deviceSwitch: number;
    modeSwitch: number;
    archive: number;
    restore: number;

    historyRestore: number;
    historyClear: number;
    historyDelete: number;

    aiEdit: number;
    aiApply: number;
    aiMiniToolbar: number;
};

export type EditorSessionUser = { uid?: string } | null | undefined;

export async function recordEditorSessionAnalytics(
    user: EditorSessionUser,
    durationMs: number,
    reason: string,
    counters?: EditorSessionCounters,
) {
    try {
        if (!user?.uid) {
            return;
        }

        const uid = user.uid as string;

        const editorRef = doc(
            db,
            "kloner_users",
            uid,
            "meta",
            "editor",
        );

        const safeDurationMs =
            typeof durationMs === "number" && durationMs > 0
                ? durationMs
                : 0;

        const durationMinutes = msToMinutesRounded(safeDurationMs) ?? 0;

        const approxStartedAtIso = new Date(
            Date.now() - safeDurationMs,
        ).toISOString();

        const c: EditorSessionCounters = {
            save: counters?.save ?? 0,
            export: counters?.export ?? 0,
            autosave: counters?.autosave ?? 0,
            pageSwitch: counters?.pageSwitch ?? 0,
            deviceSwitch: counters?.deviceSwitch ?? 0,
            modeSwitch: counters?.modeSwitch ?? 0,
            archive: counters?.archive ?? 0,
            restore: counters?.restore ?? 0,

            historyRestore: counters?.historyRestore ?? 0,
            historyClear: counters?.historyClear ?? 0,
            historyDelete: counters?.historyDelete ?? 0,

            aiEdit: counters?.aiEdit ?? 0,
            aiApply: counters?.aiApply ?? 0,
            aiMiniToolbar: counters?.aiMiniToolbar ?? 0,
        };

        const now = serverTimestamp();

        // Best-effort aggregate doc write. Avoid transaction reads here so editor navigation
        // can't trip over Firestore watch state during route transitions.
        await setDoc(
            editorRef,
            {
                updatedAt: now,
                endedAt: now,

                durationMs: safeDurationMs,
                editorSessionTotalMs: increment(safeDurationMs),

                durationMinutes,
                editorSessionTotalMinutes: increment(durationMinutes),

                reason,

                editorSessionCount: increment(1),

                saveCount: c.save,
                exportCount: c.export,
                autosaveCount: c.autosave,
                pageSwitchCount: c.pageSwitch,
                deviceSwitchCount: c.deviceSwitch,
                modeSwitchCount: c.modeSwitch,
                archiveCount: c.archive,
                restoreCount: c.restore,

                historyRestoreCount: c.historyRestore,

                // NEW per-session fields
                historyClearCount: c.historyClear,
                historyDeleteCount: c.historyDelete,

                aiEditCount: c.aiEdit,
                aiApplyCount: c.aiApply,
                aiMiniToolbarCount: c.aiMiniToolbar,

                lastSessionStartedApproxIso: approxStartedAtIso,
                lastSessionEndedAt: now,
                lastSessionDurationMinutes: durationMinutes,

                editorSaveTotal: increment(c.save),
                editorExportTotal: increment(c.export),
                editorAutosaveTotal: increment(c.autosave),
                editorPageSwitchTotal: increment(c.pageSwitch),
                editorDeviceSwitchTotal: increment(c.deviceSwitch),
                editorModeSwitchTotal: increment(c.modeSwitch),
                editorArchiveTotal: increment(c.archive),
                editorRestoreTotal: increment(c.restore),
                editorHistoryRestoreTotal: increment(c.historyRestore),
                editorHistoryClearTotal: increment(c.historyClear),
                editorHistoryDeleteTotal: increment(c.historyDelete),
                editorAiEditTotal: increment(c.aiEdit),
                editorAiApplyTotal: increment(c.aiApply),
                editorAiMiniToolbarTotal: increment(c.aiMiniToolbar),
            },
            { merge: true },
        );

        // 2) Append-only per-session document
        try {
            const sessionsCol = collection(
                db,
                "kloner_users",
                uid,
                "meta",
                "editor",
                "sessions",
            );

            await addDoc(sessionsCol, {
                createdAt: serverTimestamp(),

                durationMs: safeDurationMs,
                durationMinutes,

                reason,
                approxStartedAtIso,

                saveCount: c.save,
                exportCount: c.export,
                autosaveCount: c.autosave,
                pageSwitchCount: c.pageSwitch,
                deviceSwitchCount: c.deviceSwitch,
                modeSwitchCount: c.modeSwitch,
                archiveCount: c.archive,
                restoreCount: c.restore,

                historyRestoreCount: c.historyRestore,

                // NEW
                historyClearCount: c.historyClear,
                historyDeleteCount: c.historyDelete,

                aiEditCount: c.aiEdit,
                aiApplyCount: c.aiApply,
                aiMiniToolbarCount: c.aiMiniToolbar,
            });

        } catch (err) {
            console.error("recordEditorSessionAnalytics session doc failed", err);
        }
    } catch (err) {
        console.error("recordEditorSessionAnalytics failed", err);
    }
}
