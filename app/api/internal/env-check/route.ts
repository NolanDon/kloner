import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolvedBackendOrigin() {
    return (
        process.env.BACKEND_ORIGIN ||
        process.env.BACKEND_URL ||
        process.env.PUBLIC_ORIGIN ||
        `http://127.0.0.1:${process.env.PORT || 8080}`
    ).replace(/\/+$/, "");
}

function resolvedBackendPrefix() {
    return (process.env.BACKEND_PREFIX ?? "/api/v1").replace(/^\/+|\/+$/g, "");
}

export async function GET(_req: NextRequest) {
    // No secrets returned; safe to expose in dev.
    const origin = resolvedBackendOrigin();
    const prefix = resolvedBackendPrefix();
    const internalKeySet = Boolean(process.env.INTERNAL_API_KEY);

    const healthUrl = `${origin}/${prefix}/health`;

    let ok = false;
    let status: number | null = null;
    let error: string | null = null;

    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(healthUrl, { method: "GET", signal: controller.signal, cache: "no-store" });
        clearTimeout(t);
        status = res.status;
        ok = res.ok;
    } catch (e: any) {
        error = String(e?.message || e || "fetch failed");
    }

    return NextResponse.json({
        backend: {
            origin,
            prefix: `/${prefix}`,
            healthUrl,
            health: { ok, status, error },
        },
        env: {
            INTERNAL_API_KEY_SET: internalKeySet,
            BACKEND_ORIGIN_SET: Boolean(process.env.BACKEND_ORIGIN),
            BACKEND_URL_SET: Boolean(process.env.BACKEND_URL),
            BACKEND_PREFIX_SET: Boolean(process.env.BACKEND_PREFIX),
        },
    });
}
