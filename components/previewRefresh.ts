export function requestWorkspacePreviewRefresh(appId: string, revision: string) {
    if (!appId || !revision || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("kloner:workspace-preview-updated", { detail: { appId, revision } }));
}

export function requestPreviewForceFresh({
    appId,
    reason,
}: {
    appId: string;
    reason?: string | null;
}): boolean {
    const requestedAppId = String(appId || "").trim();
    if (!requestedAppId) return false;

    const normalizedReason = String(reason || "").trim().toLowerCase();
    if (normalizedReason.startsWith("restore")) return false;

    if (typeof window === "undefined") return false;

    window.dispatchEvent(
        new CustomEvent("kloner:preview-force-fresh", {
            detail: {
                appId: requestedAppId,
                reason: normalizedReason || undefined,
            },
        }),
    );
    return true;
}
