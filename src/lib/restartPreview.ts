import { callBackend } from "./callBackend";

type RestartPreviewArgs = {
    req?: any;
    code: string;
    appId: string;
    uid: string;
    files?: Record<string, any>;
};

export async function restartPreview({ req, code, appId, uid, files }: RestartPreviewArgs) {
    const body: any = { appId };
    if (files && typeof files === "object") body.files = files;

    const origin =
        process.env.BACKEND_ORIGIN ||
        process.env.BACKEND_URL;
    if (!origin) {
        return {
            ok: false,
            status: 500,
            json: { ok: false, error: "BACKEND_ORIGIN/BACKEND_URL not set" },
            error: "BACKEND_ORIGIN/BACKEND_URL not set",
            reqId: "",
            url: "",
        };
    }

    const base = origin.replace(/\/+$/, "");
    const upstreamUrl = `${base}/api/v1/preview/${encodeURIComponent(code)}/restart`;

    const response = await callBackend(req ?? ({ headers: {} } as any), {
        // Use an absolute URL so we cannot accidentally hit localhost/self-origin.
        path: upstreamUrl,
        method: "POST",
        body,
        userCtx: { uid },
        timeoutMs: 30_000,
    });

    const ok = response.status >= 200 && response.status < 300 && Boolean((response.json as any)?.ok ?? true);
    const error = ok ? null : String((response.json as any)?.error || `Restart failed (HTTP ${response.status})`);

    return {
        ok,
        status: response.status,
        json: response.json,
        error,
        reqId: response.reqId,
        url: response.url,
    };
}
