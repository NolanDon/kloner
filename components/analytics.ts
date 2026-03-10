import { db } from "@/lib/firebase";
import { doc, runTransaction, serverTimestamp, collection, addDoc } from "firebase/firestore";

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
        console.error("recordExportAnalytics failed", err);
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
        console.error("recordDeployAnalytics failed", err);
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

export type AppBuilderSessionUser = { uid?: string } | null | undefined;

export type AppBuilderSessionCounters = {
    aiUserMessagesSent?: number;
    viewSwitchCount?: number;
};

export type AppBuilderIntegrationSnapshot = {
    supabaseConnected?: boolean;
    vercelConnected?: boolean;
    stripeConfigured?: boolean;
};

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

        // 1) Aggregate doc
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(editorRef);
            const data = (snap.data() || {}) as Record<string, any>;

            const prevSessionCount =
                typeof data.editorSessionCount === "number"
                    ? data.editorSessionCount
                    : 0;

            const prevTotalMs =
                typeof data.editorSessionTotalMs === "number"
                    ? data.editorSessionTotalMs
                    : 0;

            const prevTotalMinutes =
                typeof data.editorSessionTotalMinutes === "number"
                    ? data.editorSessionTotalMinutes
                    : 0;

            const safeNum = (v: any) =>
                typeof v === "number" && Number.isFinite(v) ? v : 0;

            const prevTotals = {
                editorSaveTotal: safeNum(data.editorSaveTotal),
                editorExportTotal: safeNum(data.editorExportTotal),
                editorAutosaveTotal: safeNum(data.editorAutosaveTotal),
                editorPageSwitchTotal: safeNum(data.editorPageSwitchTotal),
                editorDeviceSwitchTotal: safeNum(data.editorDeviceSwitchTotal),
                editorModeSwitchTotal: safeNum(data.editorModeSwitchTotal),
                editorArchiveTotal: safeNum(data.editorArchiveTotal),
                editorRestoreTotal: safeNum(data.editorRestoreTotal),
                editorHistoryRestoreTotal: safeNum(data.editorHistoryRestoreTotal),

                // NEW totals
                editorHistoryClearTotal: safeNum(data.editorHistoryClearTotal),
                editorHistoryDeleteTotal: safeNum(data.editorHistoryDeleteTotal),

                editorAiEditTotal: safeNum(data.editorAiEditTotal),
                editorAiApplyTotal: safeNum(data.editorAiApplyTotal),
                editorAiMiniToolbarTotal: safeNum(data.editorAiMiniToolbarTotal),
            };

            const totalsPatch = {
                editorSaveTotal: prevTotals.editorSaveTotal + c.save,
                editorExportTotal: prevTotals.editorExportTotal + c.export,
                editorAutosaveTotal: prevTotals.editorAutosaveTotal + c.autosave,
                editorPageSwitchTotal: prevTotals.editorPageSwitchTotal + c.pageSwitch,
                editorDeviceSwitchTotal: prevTotals.editorDeviceSwitchTotal + c.deviceSwitch,
                editorModeSwitchTotal: prevTotals.editorModeSwitchTotal + c.modeSwitch,
                editorArchiveTotal: prevTotals.editorArchiveTotal + c.archive,
                editorRestoreTotal: prevTotals.editorRestoreTotal + c.restore,
                editorHistoryRestoreTotal: prevTotals.editorHistoryRestoreTotal + c.historyRestore,

                // NEW totals patch
                editorHistoryClearTotal: prevTotals.editorHistoryClearTotal + c.historyClear,
                editorHistoryDeleteTotal: prevTotals.editorHistoryDeleteTotal + c.historyDelete,

                editorAiEditTotal: prevTotals.editorAiEditTotal + c.aiEdit,
                editorAiApplyTotal: prevTotals.editorAiApplyTotal + c.aiApply,
                editorAiMiniToolbarTotal: prevTotals.editorAiMiniToolbarTotal + c.aiMiniToolbar,
            };

            const basePatch = {
                updatedAt: now,
                endedAt: now,

                durationMs: safeDurationMs,
                editorSessionTotalMs: prevTotalMs + safeDurationMs,

                durationMinutes,
                editorSessionTotalMinutes: prevTotalMinutes + durationMinutes,

                reason,

                editorSessionCount: prevSessionCount + 1,

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

                ...totalsPatch,
            };

            if (!snap.exists()) {
                tx.set(
                    editorRef,
                    {
                        createdAt: now,
                        ...basePatch,
                    },
                    { merge: true },
                );
            } else {
                tx.set(editorRef, basePatch, { merge: true });
            }

            const userRef = doc(db, "kloner_users", uid);
            tx.set(
                userRef,
                {
                    lastVisitAt: now,
                    lastSessionEndedAt: now,
                    lastSessionDurationMinutes: durationMinutes,
                    lastSessionReason: reason,
                },
                { merge: true },
            );
        });

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

/* =========================
 * APP BUILDER SESSION ANALYTICS
 * ========================= */

export async function recordAppBuilderSessionAnalytics(
    user: AppBuilderSessionUser,
    appId: string,
    durationMs: number,
    reason: string,
    counters?: AppBuilderSessionCounters,
    integrations?: AppBuilderIntegrationSnapshot,
) {
    try {
        if (!user?.uid || !appId) {
            return;
        }

        const uid = user.uid as string;
        const appBuilderRef = doc(
            db,
            "kloner_users",
            uid,
            "meta",
            "app_builder",
        );

        const safeDurationMs =
            typeof durationMs === "number" && durationMs > 0
                ? durationMs
                : 0;
        const durationMinutes = msToMinutesRounded(safeDurationMs) ?? 0;

        const c = {
            aiUserMessagesSent:
                typeof counters?.aiUserMessagesSent === "number" && Number.isFinite(counters.aiUserMessagesSent)
                    ? Math.max(0, counters.aiUserMessagesSent)
                    : 0,
            viewSwitchCount:
                typeof counters?.viewSwitchCount === "number" && Number.isFinite(counters.viewSwitchCount)
                    ? Math.max(0, counters.viewSwitchCount)
                    : 0,
        };

        const integrationSnapshot = {
            supabaseConnected: integrations?.supabaseConnected === true,
            vercelConnected: integrations?.vercelConnected === true,
            stripeConfigured: integrations?.stripeConfigured === true,
        };

        const now = serverTimestamp();

        await runTransaction(db, async (tx) => {
            const snap = await tx.get(appBuilderRef);
            const data = (snap.data() || {}) as Record<string, any>;

            const safeNum = (v: any) =>
                typeof v === "number" && Number.isFinite(v) ? v : 0;

            const prevSessionCount = safeNum(data.appBuilderSessionCount);
            const prevTotalMs = safeNum(data.appBuilderSessionTotalMs);
            const prevTotalMinutes = safeNum(data.appBuilderSessionTotalMinutes);
            const prevAiTotal = safeNum(data.appBuilderAiUserMessageTotal);
            const prevViewSwitchTotal = safeNum(data.appBuilderViewSwitchTotal);
            const prevSessionsWithSupabase = safeNum(data.appBuilderSessionsWithSupabaseCount);
            const prevSessionsWithVercel = safeNum(data.appBuilderSessionsWithVercelCount);
            const prevSessionsWithStripe = safeNum(data.appBuilderSessionsWithStripeCount);

            const nextSessionCount = prevSessionCount + 1;
            const nextTotalMs = prevTotalMs + safeDurationMs;
            const nextTotalMinutes = prevTotalMinutes + durationMinutes;
            const nextAvgMinutes = nextSessionCount > 0 ? Math.round((nextTotalMinutes / nextSessionCount) * 10) / 10 : 0;

            const basePatch = {
                updatedAt: now,
                appBuilderLastSessionEndedAt: now,
                appBuilderLastSessionReason: reason,
                appBuilderLastSessionDurationMs: safeDurationMs,
                appBuilderLastSessionDurationMinutes: durationMinutes,

                appBuilderSessionCount: nextSessionCount,
                appBuilderSessionTotalMs: nextTotalMs,
                appBuilderSessionTotalMinutes: nextTotalMinutes,
                appBuilderAvgSessionMinutes: nextAvgMinutes,

                appBuilderAiUserMessageCount: c.aiUserMessagesSent,
                appBuilderViewSwitchCount: c.viewSwitchCount,

                appBuilderAiUserMessageTotal: prevAiTotal + c.aiUserMessagesSent,
                appBuilderViewSwitchTotal: prevViewSwitchTotal + c.viewSwitchCount,

                appBuilderLastAppId: appId,
                appBuilderLastSupabaseConnected: integrationSnapshot.supabaseConnected,
                appBuilderLastVercelConnected: integrationSnapshot.vercelConnected,
                appBuilderLastStripeConfigured: integrationSnapshot.stripeConfigured,

                appBuilderSessionsWithSupabaseCount:
                    prevSessionsWithSupabase + (integrationSnapshot.supabaseConnected ? 1 : 0),
                appBuilderSessionsWithVercelCount:
                    prevSessionsWithVercel + (integrationSnapshot.vercelConnected ? 1 : 0),
                appBuilderSessionsWithStripeCount:
                    prevSessionsWithStripe + (integrationSnapshot.stripeConfigured ? 1 : 0),

                appBuilderAppIdsTouched: Array.from(
                    new Set([...(Array.isArray(data.appBuilderAppIdsTouched) ? data.appBuilderAppIdsTouched : []), appId]),
                ),
            };

            if (!snap.exists()) {
                tx.set(
                    appBuilderRef,
                    {
                        createdAt: now,
                        ...basePatch,
                    },
                    { merge: true },
                );
            } else {
                tx.set(appBuilderRef, basePatch, { merge: true });
            }
        });

        try {
            const sessionsCol = collection(
                db,
                "kloner_users",
                uid,
                "meta",
                "app_builder",
                "sessions",
            );

            await addDoc(sessionsCol, {
                createdAt: serverTimestamp(),
                appId,
                reason,
                durationMs: safeDurationMs,
                durationMinutes,
                aiUserMessagesSent: c.aiUserMessagesSent,
                viewSwitchCount: c.viewSwitchCount,
                supabaseConnected: integrationSnapshot.supabaseConnected,
                vercelConnected: integrationSnapshot.vercelConnected,
                stripeConfigured: integrationSnapshot.stripeConfigured,
            });
        } catch (err) {
            console.error("recordAppBuilderSessionAnalytics session doc failed", err);
        }
    } catch (err) {
        console.error("recordAppBuilderSessionAnalytics failed", err);
    }
}
