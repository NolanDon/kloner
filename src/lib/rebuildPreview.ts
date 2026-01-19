import { callBackend } from "./callBackend";

type RebuildPreviewArgs = {
    req?: any;
    code?: string;
    appId: string;
    uid: string;
    files?: Record<string, any>;
};

export async function rebuildPreview({ req, code, appId, uid, files }: RebuildPreviewArgs) {
    const body: any = { appId };
    if (typeof code === "string" && code.trim()) body.code = code.trim();
    // Hub rebuild is in-place; it resolves files server-side.

    const response = await callBackend(req ?? ({ headers: {} } as any), {
        // callBackend will prepend BACKEND_PREFIX (defaults to /api/v1)
        path: "/webcontainer/rebuild",
        method: "POST",
        body,
        userCtx: { uid },
        timeoutMs: 30_000,
    });

    const ok = response.status >= 200 && response.status < 300 && Boolean((response.json as any)?.ok ?? true);
    const error = ok ? null : String((response.json as any)?.error || `Rebuild failed (HTTP ${response.status})`);

    return {
        ok,
        status: response.status,
        json: response.json,
        error,
        reqId: response.reqId,
        url: response.url,
    };
}
