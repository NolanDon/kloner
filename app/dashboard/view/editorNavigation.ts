export type EditorNavigationResult =
    | { ok: true }
    | { ok: false; code: string; message: string };

// A navigation request is not an acknowledgement that the destination rendered.
export async function requestEditorNavigation(input: {
    accessRevoked: boolean;
    signal?: AbortSignal;
    refreshSession: () => Promise<boolean>;
    navigate: () => void;
}): Promise<EditorNavigationResult> {
    if (input.signal?.aborted) return { ok: false, code: "EDITOR_NAVIGATION_CANCELLED", message: "Editor opening cancelled." };
    if (input.accessRevoked) {
        return { ok: false, code: "EDITOR_ACCESS_REVOKED", message: "Your trial was cancelled, so existing projects are locked in the dashboard." };
    }
    try {
        if (!await input.refreshSession()) {
            return { ok: false, code: "EDITOR_SESSION_REFRESH_FAILED", message: "Your app is ready, but we couldn't refresh your sign-in to open the editor. Please retry or sign in again." };
        }
    } catch {
        return { ok: false, code: "EDITOR_SESSION_REFRESH_FAILED", message: "Your app is ready, but we couldn't refresh your sign-in to open the editor. Please retry or sign in again." };
    }
    if (input.signal?.aborted) return { ok: false, code: "EDITOR_NAVIGATION_CANCELLED", message: "Editor opening cancelled." };
    try {
        input.navigate();
        return { ok: true };
    } catch {
        return { ok: false, code: "EDITOR_NAVIGATION_FAILED", message: "Your app is ready, but the editor couldn't open. Please retry opening it; you don't need to scan again." };
    }
}
