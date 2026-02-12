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

function resolvedFrontendBaseUrl() {
    const v = (process.env.FRONTEND_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
    if (v) return v.replace(/\/+$/, "");
    // Keep stable default for prod.
    return "https://kloner.app";
}

function isSet(name: string): boolean {
    const v = (process.env as any)?.[name];
    return typeof v === "string" ? v.trim().length > 0 : false;
}

function isInternal(req: NextRequest): boolean {
    const key = (process.env.INTERNAL_API_KEY || "").trim();
    const got = (req.headers.get("x-internal-key") || "").trim();
    return Boolean(key) && got === key;
}

export async function GET(req: NextRequest) {
    // No secrets returned; safe to expose in dev.
    const origin = resolvedBackendOrigin();
    const prefix = resolvedBackendPrefix();
    const internalKeySet = Boolean(process.env.INTERNAL_API_KEY);
    const includePrivateDiagnostics = isInternal(req);
    const frontendBaseUrl = includePrivateDiagnostics ? resolvedFrontendBaseUrl() : null;

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
        frontend: includePrivateDiagnostics
            ? {
                  baseUrl: frontendBaseUrl,
                  env: {
                      FRONTEND_BASE_URL_SET: isSet("FRONTEND_BASE_URL"),
                      NEXT_PUBLIC_SITE_URL_SET: isSet("NEXT_PUBLIC_SITE_URL"),
                      VERCEL_URL_SET: isSet("VERCEL_URL"),
                      VERCEL_ENV: process.env.VERCEL_ENV || null,
                  },
              }
            : null,
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
            ...(includePrivateDiagnostics
                ? {
                      // Email/campaign related (booleans only)
                      RESEND_API_KEY_SET: isSet("RESEND_API_KEY"),
                      EMAIL_LINK_SECRET_SET: isSet("EMAIL_LINK_SECRET"),
                      EMAIL_SEND_MODE_SET: isSet("EMAIL_SEND_MODE"),
                      EMAIL_TEST_TO_SET: isSet("EMAIL_TEST_TO"),
                      EMAIL_ENABLE_JOURNEY_SET: isSet("EMAIL_ENABLE_JOURNEY"),
                      EMAIL_ENABLE_PRODUCT_LAUNCH_SET: isSet("EMAIL_ENABLE_PRODUCT_LAUNCH"),
                      JOURNEY_EMAIL_FROM_SET: isSet("JOURNEY_EMAIL_FROM"),
                  }
                : null),
        },
    });
}
