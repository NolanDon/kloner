import { hash64, normUrl } from "./page.helpers";
import { validateAndNormalizePublicHttpUrl } from "@/src/lib/publicHttpUrl";

export type DashboardDraftCard = {
    draftId: string;
    id: string;
    name: string;
    createdAt: any;
    updatedAt: any;
    status?: string | null;
    canonicalAppId?: string | null;
    sourceUrl?: string | null;
    retryable?: boolean;
    completed?: boolean;
    pendingCompleted?: boolean;
    warningCode?: string | null;
    warningMessage?: string | null;
    warningAction?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    errorReason?: string | null;
    userMessage?: string | null;
    details?: unknown;
    warnings?: unknown[];
    blocked?: boolean;
    archiveZipPath?: string | null;
    archiveZipUrl?: string | null;
    archiveZipBytes?: number | null;
    archiveZipGeneratedAt?: string | null;
    archiveZipSource?: "draft" | "promoted_app" | null;
    recommendedAction?: string | null;
    thumbnailUrl?: string | null;
};

type Setter<T> = (next: T | ((prev: T) => T)) => void;

export type DashboardUrlProcessingSession = {
    appId: string | null;
    draftId: string | null;
    draftAppId: string | null;
    sourceUrl: string | null;
    archiveZipUrl: string | null;
    archiveZipBytes: number | null;
    errorMessage?: string | null;
    phase: "processing" | "ready" | "navigating" | "error";
    phaseStartedAt: number;
};

export const DRAFT_LOADING_TIMEOUT_MS = 10 * 60 * 1000;

export type DashboardDraftThumbnailLookup =
    | Map<string, string | null>
    | Record<string, string | null | undefined>
    | null
    | undefined;

function getFirstScreenshotUrl(candidate: any): string | null {
    const screenshots = Array.isArray(candidate?.screenshots) ? candidate.screenshots : null;
    const first = screenshots?.[0];
    const url = typeof first?.url === "string" ? first.url.trim() : "";
    return url || null;
}

function readThumbnailLookup(
    lookup: DashboardDraftThumbnailLookup,
    canonicalUrl: string,
): string | null {
    if (!lookup || !canonicalUrl) return null;

    const value = lookup instanceof Map
        ? lookup.get(canonicalUrl)
        : lookup[canonicalUrl];

    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toMillis(value: any): number {
    if (!value) return 0;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value?.toMillis === "function") {
        const millis = value.toMillis();
        return typeof millis === "number" && Number.isFinite(millis) ? millis : 0;
    }

    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}

export function isTimedOutDraftLoadingState(
    draft: {
        status?: string | null;
        createdAt?: any;
        updatedAt?: any;
        completed?: boolean;
        pendingCompleted?: boolean;
        archiveZipPath?: string | null;
        archiveZipUrl?: string | null;
        warningCode?: string | null;
        warningMessage?: string | null;
        warningAction?: string | null;
        errorCode?: string | null;
        errorMessage?: string | null;
        errorReason?: string | null;
        userMessage?: string | null;
        blocked?: boolean;
        retryable?: boolean;
    } | null | undefined,
    nowMs = Date.now(),
): boolean {
    if (!draft || typeof draft !== "object") return false;

    const status = String(draft.status || "").trim().toLowerCase();
    const isLoadingState = [
        "processing",
        "in_progress",
        "queued",
        "pending",
        "booting",
    ].includes(status);
    if (!isLoadingState) return false;

    if (draft.completed === true || draft.pendingCompleted === true) return false;
    if (String(draft.archiveZipPath || draft.archiveZipUrl || "").trim()) return false;
    if (draft.blocked || draft.retryable) return false;
    if (
        draft.warningCode ||
        draft.warningMessage ||
        draft.warningAction ||
        draft.errorCode ||
        draft.errorMessage ||
        draft.errorReason ||
        draft.userMessage
    ) {
        return false;
    }

    const startedAt = toMillis(draft.updatedAt) || toMillis(draft.createdAt);
    if (!startedAt) return false;

    return nowMs - startedAt >= DRAFT_LOADING_TIMEOUT_MS;
}

export function buildTimedOutDraftIssueState(): {
    code: string;
    message: string;
    details: string;
    action: string;
    retryable: boolean;
    blocked: boolean;
} {
    return {
        code: "DRAFT_SCAN_TIMEOUT",
        message: "This draft scan timed out. Delete it and scan again.",
        details: "This draft stayed in a loading state too long and was not picked up.",
        action: "Delete draft",
        retryable: false,
        blocked: false,
    };
}

export function resolveDashboardDraftThumbnailUrl(
    draft: any,
    lookup?: DashboardDraftThumbnailLookup,
): string | null {
    if (!draft || typeof draft !== "object") return null;

    const explicitThumbnailUrl = typeof draft.thumbnailUrl === "string" && draft.thumbnailUrl.trim()
        ? draft.thumbnailUrl.trim()
        : null;
    if (explicitThumbnailUrl) return explicitThumbnailUrl;

    const details = draft?.details && typeof draft.details === "object" ? draft.details : null;
    const directScreenshotUrl =
        getFirstScreenshotUrl(draft) ||
        getFirstScreenshotUrl(details?.trackedUrl) ||
        getFirstScreenshotUrl(details);
    if (directScreenshotUrl) return directScreenshotUrl;

    const normalized = validateAndNormalizePublicHttpUrl(String(draft?.sourceUrl || ""));
    if (normalized) {
        const lookupThumbnail = readThumbnailLookup(lookup, normUrl(normalized));
        if (lookupThumbnail) return lookupThumbnail;
    }

    const referenceImage = [
        draft?.referenceImage,
        details?.referenceImage,
        details?.render?.referenceImage,
    ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
    if (referenceImage) return referenceImage.trim();

    return null;
}

export function shouldDisableDraftDeleteButton(input: {
    isDeleting: boolean;
    isPendingCreation?: boolean;
    disableActions?: boolean;
    accessLocked?: boolean;
}): boolean {
    // Draft delete must stay available even when draft processing is ongoing.
    // Only lock this button while a delete request for this draft is actively in flight.
    return Boolean(input.isDeleting);
}

export function isPersistedDraftPendingState(input: {
    isDraftCard: boolean;
    status?: string | null;
    archiveZipPath?: string | null;
    archiveZipUrl?: string | null;
}): boolean {
    if (!input.isDraftCard) return false;

    const status = String(input.status || "").trim().toLowerCase();
    const archiveReady = Boolean(
        String(input.archiveZipPath || "").trim() ||
        String(input.archiveZipUrl || "").trim(),
    );

    return (
        status === "processing" ||
        status === "in_progress" ||
        status === "queued" ||
        status === "pending" ||
        status === "booting" ||
        ((status === "ready" || status === "warning") && !archiveReady)
    );
}

export function normalizeDashboardDraftRecord(draft: any): DashboardDraftCard | null {
    if (!draft || typeof draft !== "object") return null;

    const draftId = String(draft.draftId || draft.id || "").trim();
    if (!draftId) return null;

    const sourceUrl = typeof draft.sourceUrl === "string" ? draft.sourceUrl : null;
    const status = typeof draft.status === "string" && draft.status.trim() ? draft.status.trim().toLowerCase() : null;
    const canonicalAppId = typeof draft.canonicalAppId === "string" && draft.canonicalAppId.trim()
        ? draft.canonicalAppId.trim()
        : null;
    const displayName = typeof draft.name === "string" && draft.name.trim()
        ? draft.name.trim()
        : (sourceUrl
            ? (() => {
                try {
                    return new URL(sourceUrl).hostname.replace(/^www\./, "") || "Website";
                } catch {
                    return sourceUrl.replace(/^https?:\/\//i, "").split("/")[0] || "Website";
                }
            })()
            : draftId);
    const prefixedDisplayName = /^draft:\s*/i.test(displayName) ? displayName : `Draft: ${displayName}`;

    const hasIssuePayload = Boolean(
        draft.retryable ||
        draft.blocked ||
        status === "warning" ||
        status === "error" ||
        draft.warningCode ||
        draft.warningMessage ||
        draft.warningAction ||
        draft.errorCode ||
        draft.errorMessage ||
        draft.errorReason ||
        draft.userMessage ||
        (Array.isArray(draft.warnings) && draft.warnings.length > 0)
    );

    const details = draft?.details && typeof draft.details === "object" ? draft.details : null;
    const archiveZipPath = [
        draft?.archiveZipPath,
        draft?.archiveZip?.path,
        draft?.zipPath,
        draft?.archive?.zipPath,
        details?.archiveZipPath,
        details?.archiveZip?.path,
        details?.zipPath,
        details?.generation?.archiveZipPath,
    ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
    const archiveZipUrl = [
        draft?.archiveZipUrl,
        draft?.archiveZip?.url,
        draft?.zipUrl,
        draft?.archive?.zipUrl,
        details?.archiveZipUrl,
        details?.archiveZip?.url,
        details?.zipUrl,
        details?.generation?.archiveZipUrl,
    ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
    const archiveZipBytes = [
        draft?.archiveZipBytes,
        draft?.archiveZip?.bytes,
        details?.archiveZipBytes,
        details?.archiveZip?.bytes,
    ].find((value) => typeof value === "number" && Number.isFinite(value)) as number | undefined;
    const archiveZipGeneratedAt = [
        draft?.archiveZipGeneratedAt,
        draft?.archiveZip?.generatedAt,
        details?.archiveZipGeneratedAt,
        details?.archiveZip?.generatedAt,
    ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
    const archiveZipSource = [
        draft?.archiveZipSource,
        draft?.archiveZip?.source,
        details?.archiveZipSource,
        details?.archiveZip?.source,
    ].find((value) => value === "draft" || value === "promoted_app") as "draft" | "promoted_app" | undefined;
    const recommendedAction = [
        draft?.recommendedAction,
        details?.recommendedAction,
    ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
    const archiveReady = Boolean(archiveZipPath || archiveZipUrl);
    const completed = typeof draft.completed === "boolean"
        ? draft.completed
        : typeof draft.pendingCompleted === "boolean"
            ? draft.pendingCompleted
            : status === "ready"
                ? true
                : status === "warning"
                    ? archiveReady
                    : status === "processing" || status === "in_progress" || status === "queued" || status === "pending" || status === "booting"
                        ? false
                        : archiveReady && !hasIssuePayload;

    return {
        draftId,
        id: String(draft.id || draftId).trim() || draftId,
        name: prefixedDisplayName,
        createdAt: draft.createdAt ?? Date.now(),
        updatedAt: draft.updatedAt ?? draft.createdAt ?? Date.now(),
        status,
        canonicalAppId,
        sourceUrl,
        retryable: typeof draft.retryable === "boolean" ? draft.retryable : false,
        completed,
        pendingCompleted: completed,
        warningCode: typeof draft.warningCode === "string" ? draft.warningCode : null,
        warningMessage: typeof draft.warningMessage === "string" ? draft.warningMessage : null,
        warningAction: typeof draft.warningAction === "string" ? draft.warningAction : null,
        errorCode: typeof draft.errorCode === "string" ? draft.errorCode : null,
        errorMessage: typeof draft.errorMessage === "string" ? draft.errorMessage : null,
        errorReason: typeof draft.errorReason === "string" ? draft.errorReason : null,
        userMessage: typeof draft.userMessage === "string" ? draft.userMessage : null,
        details: draft.details ?? null,
        warnings: Array.isArray(draft.warnings) ? draft.warnings : [],
        blocked: typeof draft.blocked === "boolean" ? draft.blocked : false,
        archiveZipPath: archiveZipPath?.trim() || null,
        archiveZipUrl: archiveZipUrl?.trim() || null,
        archiveZipBytes: typeof archiveZipBytes === "number" ? archiveZipBytes : null,
        archiveZipGeneratedAt: archiveZipGeneratedAt?.trim() || null,
        archiveZipSource: archiveZipSource || null,
        recommendedAction: recommendedAction?.trim() || null,
    };
}

export function normalizeDashboardDraftRecords(drafts: any[]): DashboardDraftCard[] {
    return drafts
        .map(normalizeDashboardDraftRecord)
        .filter(Boolean)
        .sort((left, right) => {
            const leftTime = typeof left?.createdAt === "number" ? left.createdAt : 0;
            const rightTime = typeof right?.createdAt === "number" ? right.createdAt : 0;
            return rightTime - leftTime;
        }) as DashboardDraftCard[];
}

export function shouldSuppressCompletedDraftIssue(
    source: any,
    issue?: {
        blocked?: boolean;
        retryable?: boolean;
        code?: string | null;
        message?: string | null;
        details?: string | null;
        action?: string | null;
    } | null,
): boolean {
    if (!source || typeof source !== "object") return false;

    const draftId = String(source.draftId || source.id || "").trim();
    if (!draftId) return false;

    const status = String(source.status || source.generationStatus || source?.generation?.status || "").trim().toLowerCase();
    const archiveReady = Boolean(
        String(source.archiveZipPath || source.archiveZipUrl || source.zipPath || source.zipUrl || "").trim(),
    );
    const completedLike = Boolean(
        source.completed === true ||
        source.pendingCompleted === true ||
        status === "ready" ||
        (archiveReady && !["processing", "queued", "pending", "booting", "in_progress"].includes(status))
    );

    if (!completedLike || !archiveReady) return false;
    if (!issue) return true;

    if (issue.blocked || issue.retryable) return false;

    const text = [
        issue.code,
        issue.message,
        issue.details,
        issue.action,
    ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (!text) return true;

    return !(
        text.includes("rescan") ||
        text.includes("blocked") ||
        text.includes("blacklist") ||
        text.includes("forbidden") ||
        text.includes("not allowed") ||
        text.includes("failed") ||
        text.includes("error")
    );
}

export async function submitDashboardUrlDraft({
    rawUrl,
    canUseScreenshotCredit,
    canUsePreviewCredit,
    fetchImpl,
    push,
    setErr,
    setInfo,
    setShowCreditsPaywall,
    setWebsiteSubmissionPendingUrl,
    setDraftApps,
    setPendingDraftApps,
    onDraftReady,
    isGenerationInFlight,
    setGenerationInFlight,
    onProcessingSessionChange,
    onProcessingError,
}: {
    rawUrl: string;
    canUseScreenshotCredit: () => boolean;
    canUsePreviewCredit?: () => boolean;
    fetchImpl: typeof fetch;
    push: (text: string, tone: "ok" | "warn" | "err") => void;
    setErr: (value: string) => void;
    setInfo: (value: string) => void;
    setShowCreditsPaywall: (mode: "screenshot") => void;
    setWebsiteSubmissionPendingUrl: Setter<string | null>;
    setDraftApps: Setter<DashboardDraftCard[]>;
    setPendingDraftApps: Setter<Record<string, boolean>>;
    onDraftReady?: (draft: DashboardDraftCard) => void | Promise<void>;
    isGenerationInFlight?: (canonicalUrl: string) => boolean;
    setGenerationInFlight?: (canonicalUrl: string | null) => void;
    onProcessingSessionChange?: Setter<DashboardUrlProcessingSession | null>;
    onProcessingError?: (message: string, sourceUrl: string | null) => void;
}): Promise<boolean> {
    // Clear any previous error/info as soon as a new submission begins
    setErr("");
    setInfo("");

    const normalized = validateAndNormalizePublicHttpUrl(rawUrl);
    if (!normalized) {
        setErr("Please enter a valid public http(s) URL.");
        setInfo("");
        onProcessingError?.("Please enter a valid public http(s) URL.", rawUrl || null);
        return false;
    }

    if (!canUseScreenshotCredit()) {
        setErr("");
        setInfo("");
        push("You have used all available screenshot credits for this month.", "warn");
        setShowCreditsPaywall("screenshot");
        return false;
    }

    if (!canUsePreviewCredit?.()) {
        setErr("");
        setInfo("");
        push("You have used all available scan credits for this month.", "warn");
        setShowCreditsPaywall("preview");
        return false;
    }

    const canonical = normUrl(normalized);
    if (isGenerationInFlight?.(canonical)) {
        setWebsiteSubmissionPendingUrl((current) => (current === canonical ? current : current));
        return false;
    }
    setWebsiteSubmissionPendingUrl(canonical);
    setGenerationInFlight?.(canonical);

    const draftCreatedAt = Date.now();
    const draftDocId = `draft_${draftCreatedAt}_${Math.random().toString(36).slice(2, 11)}`;
    const draftAppId = `draftapp_${hash64(canonical)}_${Math.random().toString(36).slice(2, 8)}`;
    const draftName = (() => {
        try {
            return new URL(normalized).hostname.replace(/^www\./, "") || "Website";
        } catch {
            return "Website";
        }
    })();
    const readyDraft: DashboardDraftCard = {
        draftId: draftDocId,
        id: draftAppId,
        name: draftName,
        createdAt: draftCreatedAt,
        updatedAt: draftCreatedAt,
        sourceUrl: normalized,
        retryable: false,
        completed: true,
        pendingCompleted: true,
        warnings: [],
        blocked: false,
    };

    onProcessingSessionChange?.({
        appId: null,
        draftId: draftDocId,
        draftAppId,
        sourceUrl: normalized,
        archiveZipUrl: null,
        archiveZipBytes: null,
        errorMessage: null,
        phase: "processing",
        phaseStartedAt: Date.now(),
    });

    setDraftApps((prev) => {
        if (prev.some((item) => item.draftId === draftDocId || item.id === draftAppId)) return prev;
        return [
            {
                draftId: draftDocId,
                id: draftAppId,
                name: draftName,
                createdAt: draftCreatedAt,
                updatedAt: draftCreatedAt,
                sourceUrl: normalized,
                retryable: false,
                completed: false,
                pendingCompleted: false,
                warnings: [],
                blocked: false,
            },
            ...prev,
        ];
    });
    setPendingDraftApps((prev) => ({ ...prev, [draftDocId]: true }));

    try {
        const res = await fetchImpl("/api/private/generate", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({ url: normalized }),
        });

        if (!res.ok) {
            // Try to read the error body so we can surface a blocked-domain state
            let errorBody: Record<string, any> = {};
            try { errorBody = await res.json(); } catch { /* ignore */ }

            const userFacingText = String(errorBody?.userMessage || errorBody?.message || errorBody?.error || "").trim();
            const errorText = userFacingText.toLowerCase();
            const isDomainBlocked =
                errorText.includes("domain blocked") ||
                errorText.includes("blocked for site cloning") ||
                res.status === 403;

            if (isDomainBlocked) {
                const blockedMessage = errorBody?.error || "Domain blocked for site cloning";
                // Update the optimistic draft in-place to show the blocked state
                setDraftApps((prev) =>
                    prev.map((item) =>
                        item.draftId === draftDocId
                            ? {
                                  ...item,
                                  blocked: true,
                                  retryable: false,
                                  completed: false,
                                  pendingCompleted: false,
                                  errorCode: "BLOCKED_URL",
                                  errorMessage: blockedMessage,
                                  userMessage: blockedMessage,
                                  warningCode: "BLOCKED_URL",
                                  warningMessage: blockedMessage,
                                  warnings: [{ code: "BLOCKED_URL", message: blockedMessage, severity: "error" }],
                              }
                            : item,
                    ),
                );
                setErr(blockedMessage);
                onProcessingSessionChange?.((current) => (
                    current && current.sourceUrl === normalized
                        ? {
                            ...current,
                            appId: current.appId ?? draftAppId,
                            draftId: current.draftId ?? draftDocId,
                            draftAppId: current.draftAppId ?? draftAppId,
                            errorMessage: blockedMessage,
                            phase: "error",
                            phaseStartedAt: current.phaseStartedAt || Date.now(),
                        }
                        : current
                ));
                onProcessingError?.(blockedMessage, normalized);
            } else {
                const fallbackMsg = errorBody?.userMessage || errorBody?.message || errorBody?.error || "Failed to scan this URL. Please try again.";
                const issueCode = typeof errorBody?.code === "string" && errorBody.code.trim()
                    ? errorBody.code.trim()
                    : "SCAN_FAILED";
                const issueDetails = errorBody?.upstreamBody ?? errorBody?.details ?? errorBody?.debugDetails ?? null;

                // Keep the ghost draft visible and convert it into an explicit scan failure
                // so the dashboard can render the error state instead of dropping the card.
                setDraftApps((prev) =>
                    prev.map((item) =>
                        item.draftId === draftDocId
                            ? {
                                  ...item,
                                  blocked: false,
                                  retryable: true,
                                  completed: false,
                                  pendingCompleted: false,
                                  warningCode: issueCode,
                                  warningMessage: String(fallbackMsg),
                                  warningAction: null,
                                  errorCode: issueCode,
                                  errorMessage: String(fallbackMsg),
                                  errorReason: typeof issueDetails === "string" && issueDetails.trim()
                                      ? issueDetails.trim()
                                      : String(fallbackMsg),
                                  userMessage: String(fallbackMsg),
                                  details: issueDetails,
                                  warnings: [
                                      {
                                          code: issueCode,
                                          message: String(fallbackMsg),
                                          severity: "error",
                                      },
                                  ],
                              }
                            : item,
                    ),
                );

                try {
                    await fetchImpl("/api/private/kloner-draft", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        credentials: "include",
                        body: JSON.stringify({
                            action: "upsert",
                            draftId: draftDocId,
                            draft: {
                                id: draftAppId,
                                name: draftName,
                                createdAt: draftCreatedAt,
                                sourceUrl: normalized,
                                retryable: true,
                                completed: false,
                                warningCode: issueCode,
                                warningMessage: String(fallbackMsg),
                                warningAction: null,
                                errorCode: issueCode,
                                errorMessage: String(fallbackMsg),
                                errorReason: typeof issueDetails === "string" && issueDetails.trim()
                                    ? issueDetails.trim()
                                    : String(fallbackMsg),
                                userMessage: String(fallbackMsg),
                                details: issueDetails,
                                warnings: [
                                    {
                                        code: issueCode,
                                        message: String(fallbackMsg),
                                        severity: "error",
                                    },
                                ],
                                blocked: false,
                            },
                        }),
                    });
                } catch (draftError) {
                    console.warn("[drafts] failed to persist scan issue", draftError);
                }

                setErr(String(fallbackMsg));
                onProcessingSessionChange?.((current) => (
                    current && current.sourceUrl === normalized
                        ? {
                            ...current,
                            appId: current.appId ?? draftAppId,
                            draftId: current.draftId ?? draftDocId,
                            draftAppId: current.draftAppId ?? draftAppId,
                            errorMessage: String(fallbackMsg),
                            phase: "error",
                            phaseStartedAt: current.phaseStartedAt || Date.now(),
                        }
                        : current
                ));
                onProcessingError?.(String(fallbackMsg), normalized);
            }

            setPendingDraftApps((prev) => {
                const next = { ...prev };
                delete next[draftDocId];
                return next;
            });
            setWebsiteSubmissionPendingUrl((current) => (current === canonical ? null : current));
            return false;
        }

        setWebsiteSubmissionPendingUrl((current) => (current === canonical ? null : current));

        try {
            await fetchImpl("/api/private/kloner-draft", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                credentials: "include",
                body: JSON.stringify({
                    action: "upsert",
                    draftId: draftDocId,
                    draft: {
                        id: draftAppId,
                        name: draftName,
                        createdAt: draftCreatedAt,
                        sourceUrl: normalized,
                        retryable: false,
                        completed: true,
                        warnings: [],
                        blocked: false,
                    },
                }),
            });
        } catch (draftError) {
            console.warn("[drafts] failed to persist new draft", draftError);
        }

        setErr("");
        setInfo("");
        try {
            await onDraftReady?.(readyDraft);
        } catch (readyDraftError) {
            console.warn("[drafts] failed to auto-promote ready draft", readyDraftError);
        } finally {
            setPendingDraftApps((prev) => {
                const next = { ...prev };
                delete next[draftDocId];
                return next;
            });
        }
        return true;
    } catch (error) {
        setPendingDraftApps((prev) => {
            const next = { ...prev };
            delete next[draftDocId];
            return next;
        });
        setWebsiteSubmissionPendingUrl((current) => (current === canonical ? null : current));
        onProcessingSessionChange?.((current) => (
            current && current.sourceUrl === normalized
                ? {
                    ...current,
                    appId: current.appId ?? draftAppId,
                    draftId: current.draftId ?? draftDocId,
                    draftAppId: current.draftAppId ?? draftAppId,
                    errorMessage: String((error as any)?.message || "Failed to process this URL."),
                    phase: "error",
                    phaseStartedAt: current.phaseStartedAt || Date.now(),
                }
                : current
        ));
        onProcessingError?.(String((error as any)?.message || "Failed to process this URL."), normalized);
        throw error;
    } finally {
        setGenerationInFlight?.(null);
    }
}
