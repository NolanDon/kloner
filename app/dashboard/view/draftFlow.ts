import { hash64, normUrl } from "./page.helpers";
import { validateAndNormalizePublicHttpUrl } from "@/src/lib/publicHttpUrl";

export type DashboardDraftCard = {
    draftId: string;
    id: string;
    name: string;
    createdAt: any;
    updatedAt: any;
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
};

type Setter<T> = (next: T | ((prev: T) => T)) => void;

export function normalizeDashboardDraftRecord(draft: any): DashboardDraftCard | null {
    if (!draft || typeof draft !== "object") return null;

    const draftId = String(draft.draftId || draft.id || "").trim();
    if (!draftId) return null;

    const sourceUrl = typeof draft.sourceUrl === "string" ? draft.sourceUrl : null;
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

    const hasIssuePayload = Boolean(
        draft.retryable ||
        draft.blocked ||
        draft.warningCode ||
        draft.warningMessage ||
        draft.warningAction ||
        draft.errorCode ||
        draft.errorMessage ||
        draft.errorReason ||
        draft.userMessage ||
        (Array.isArray(draft.warnings) && draft.warnings.length > 0)
    );
    const completed = Boolean(draft.completed) || (!hasIssuePayload && Boolean(sourceUrl));

    return {
        draftId,
        id: String(draft.id || draftId).trim() || draftId,
        name: displayName,
        createdAt: draft.createdAt ?? Date.now(),
        updatedAt: draft.updatedAt ?? draft.createdAt ?? Date.now(),
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

export async function submitDashboardUrlDraft({
    rawUrl,
    canUseScreenshotCredit,
    fetchImpl,
    push,
    setErr,
    setInfo,
    setShowCreditsPaywall,
    setWebsiteSubmissionPendingUrl,
    setDraftApps,
    setPendingDraftApps,
}: {
    rawUrl: string;
    canUseScreenshotCredit: () => boolean;
    fetchImpl: typeof fetch;
    push: (text: string, tone: "ok" | "warn" | "err") => void;
    setErr: (value: string) => void;
    setInfo: (value: string) => void;
    setShowCreditsPaywall: (mode: "screenshot") => void;
    setWebsiteSubmissionPendingUrl: Setter<string | null>;
    setDraftApps: Setter<DashboardDraftCard[]>;
    setPendingDraftApps: Setter<Record<string, boolean>>;
}): Promise<boolean> {
    const normalized = validateAndNormalizePublicHttpUrl(rawUrl);
    if (!normalized) {
        setErr("Please enter a valid public http(s) URL.");
        setInfo("");
        return false;
    }

    if (!canUseScreenshotCredit()) {
        setErr("You have used all monthly screenshot credits. Upgrade to capture more pages and monitor more sites.");
        setInfo("");
        push("You have used all available screenshot credits for this month.", "warn");
        setShowCreditsPaywall("screenshot");
        return false;
    }

    const canonical = normUrl(normalized);
    setWebsiteSubmissionPendingUrl(canonical);

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

        setPendingDraftApps((prev) => {
            const next = { ...prev };
            delete next[draftDocId];
            return next;
        });

        setErr("");
        setInfo("");
        return true;
    } catch (error) {
        setPendingDraftApps((prev) => {
            const next = { ...prev };
            delete next[draftDocId];
            return next;
        });
        setWebsiteSubmissionPendingUrl((current) => (current === canonical ? null : current));
        throw error;
    }
}