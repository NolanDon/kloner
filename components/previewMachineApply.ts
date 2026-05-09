import { normalizePreviewApplyResponse } from "@/src/lib/appEmbeddingsClient";

export type PreviewApplyFile = {
    path: string;
    content: string;
};

export type PreviewApplyResult = {
    nextCode: string;
    saved: boolean;
    outcome: string;
    restartPending: boolean;
    requiresRestart: boolean;
    requiresRebuild: boolean;
    needsRebuild: boolean;
    touchesPublicAssets: boolean;
    hmrLikely: boolean | null;
    retryable: boolean;
    retryAfterSeconds: number | null;
};

type PostPreviewApplyArgs = {
    appId: string;
    files: PreviewApplyFile[];
    csrf?: string | null;
    code?: string;
    idempotencyKey: string;
    source?: string;
    fetchImpl?: typeof fetch;
};

export async function postPreviewApply({
    appId,
    files,
    csrf,
    code,
    idempotencyKey,
    source,
    fetchImpl = fetch,
}: PostPreviewApplyArgs): Promise<PreviewApplyResult> {
    const payload: Record<string, unknown> = {
        appId,
        files,
        idempotencyKey,
    };
    if (typeof code === "string" && code.trim()) {
        payload.code = code.trim();
    }

    const sourceTag = String(source || "").trim();
    const applyUrl = sourceTag
        ? `/api/previews/apply?source=${encodeURIComponent(sourceTag)}`
        : "/api/previews/apply";

    const res = await fetchImpl(applyUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "idempotency-key": String(idempotencyKey || ""),
            ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({} as any));
    const apply = normalizePreviewApplyResponse(data, res.status, res.headers.get("retry-after"));

    if (!res.ok || !apply.ok || apply.saved === false) {
        throw new Error(
            String(
                apply.restartMessage ||
                apply.error ||
                (data as any)?.error ||
                `Preview apply failed (HTTP ${res.status})`
            )
        );
    }

    const retryAfterSecondsRaw = (data as any)?.retryAfterSeconds;
    const retryAfterSeconds = typeof retryAfterSecondsRaw === "number" ? retryAfterSecondsRaw : null;

    return {
        nextCode: String((data as any)?.code || "").trim(),
        saved: true,
        outcome: String((data as any)?.outcome || "saved"),
        restartPending: Boolean((data as any)?.restartPending || (data as any)?.queued),
        requiresRestart: Boolean((data as any)?.requiresRestart || (data as any)?.requires_restart),
        requiresRebuild: Boolean((data as any)?.requiresRebuild || (data as any)?.requires_rebuild),
        needsRebuild: Boolean((data as any)?.needsRebuild || (data as any)?.needs_rebuild),
        touchesPublicAssets: Boolean((data as any)?.touchesPublicAssets),
        hmrLikely: typeof (data as any)?.hmrLikely === "boolean" ? Boolean((data as any)?.hmrLikely) : null,
        retryable: Boolean((data as any)?.retryable),
        retryAfterSeconds,
    };
}