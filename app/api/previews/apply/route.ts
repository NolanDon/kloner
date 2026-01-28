import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { assertAppBuilderScope } from "../../_lib/appBuilderScope";
import { callBackend } from "@/src/lib/callBackend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApplyFile = { path: string; content?: string; delete?: boolean };

function sanitizeRelativePath(input: any): string | null {
    const raw = typeof input === "string" ? input.trim() : "";
    if (!raw) return null;
    if (raw.startsWith("/")) return null;
    if (raw.includes("\\")) return null;

    const parts = raw.split("/");
    for (const part of parts) {
        if (!part) return null;
        if (part === "." || part === "..") return null;
    }

    return raw;
}

function byteLen(v: string) {
    return Buffer.byteLength(v, "utf8");
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEffectivelyReady(statusJson: any): boolean {
    const status = String(statusJson?.status || "").toLowerCase();
    const uiStage = String(statusJson?.uiStage || statusJson?.ui_stage || "").toLowerCase();
    return (
        uiStage === "ready" ||
        status === "ready" ||
        ["running", "compiled", "started", "online", "active", "completed", "finished"].includes(status)
    );
}

function looksLikePreviewCode(v: unknown): v is string {
    if (typeof v !== "string") return false;
    const s = v.trim();
    if (!s) return false;
    return /^[a-z0-9-]{8,}$/i.test(s);
}

function resultNeedsRestart(json: any): boolean {
    try {
        return Boolean(
            json?.needsRebuild ||
                json?.needs_rebuild ||
                json?.requiresRebuild ||
                json?.requires_rebuild ||
                json?.requiresRestart ||
                json?.requires_restart,
        );
    } catch {
        return false;
    }
}

function fileSetNeedsRestart(files: ApplyFile[]): boolean {
    const isNotHotUpdatable = (p: string) => {
        const s = String(p || "").trim().toLowerCase();
        if (!s) return false;
        return (
            s === "package.json" ||
            s.endsWith("/package.json") ||
            s === "package-lock.json" ||
            s.endsWith("/package-lock.json") ||
            s === "pnpm-lock.yaml" ||
            s.endsWith("/pnpm-lock.yaml") ||
            s === "yarn.lock" ||
            s.endsWith("/yarn.lock") ||
            s === "bun.lockb" ||
            s.endsWith("/bun.lockb") ||
            s === "next.config.js" ||
            s.endsWith("/next.config.js") ||
            s === "next.config.mjs" ||
            s.endsWith("/next.config.mjs") ||
            s === "tailwind.config.js" ||
            s.endsWith("/tailwind.config.js") ||
            s === "tailwind.config.ts" ||
            s.endsWith("/tailwind.config.ts") ||
            s === "postcss.config.js" ||
            s.endsWith("/postcss.config.js") ||
            s === "tsconfig.json" ||
            s.endsWith("/tsconfig.json")
        );
    };

    return Array.isArray(files) && files.some((f) => isNotHotUpdatable(String((f as any)?.path || "")));
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const appId = typeof body?.appId === "string" ? body.appId.trim() : "";
            const code = typeof body?.code === "string" ? body.code.trim() : "";
            const files = Array.isArray(body?.files) ? (body.files as ApplyFile[]) : null;

            if (!appId || !files || files.length === 0) {
                return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
            }

            if (files.length > 200) {
                return NextResponse.json(
                    { ok: false, error: "Too many files in one request (max 200)." },
                    { status: 400 },
                );
            }

            assertAppBuilderScope(authedReq, uid, appId);

            const sanitizedFiles: ApplyFile[] = [];
            let totalBytes = 0;
            const maxTotalBytes = 2_000_000; // ~2MB
            const maxFileBytes = 600_000; // ~600KB per file

            for (const f of files) {
                const p = sanitizeRelativePath((f as any)?.path);
                if (!p) {
                    return NextResponse.json(
                        { ok: false, error: "Invalid file path. Use a relative path without leading '/' or '..'." },
                        { status: 400 },
                    );
                }

                const del = Boolean((f as any)?.delete);
                const content = (f as any)?.content;

                if (!del && typeof content !== "string") {
                    return NextResponse.json({ ok: false, error: `Missing content for ${p}` }, { status: 400 });
                }

                if (!del && byteLen(content) > maxFileBytes) {
                    return NextResponse.json(
                        { ok: false, error: `File too large for live apply (${p}).` },
                        { status: 400 },
                    );
                }

                totalBytes += byteLen(p);
                if (!del) totalBytes += byteLen(content);
                if (totalBytes > maxTotalBytes) {
                    return NextResponse.json(
                        { ok: false, error: "Payload too large for live apply." },
                        { status: 400 },
                    );
                }

                sanitizedFiles.push({ path: p, ...(del ? { delete: true } : { content }) });
            }

            console.info("[previews/apply]", {
                appId,
                code: code ? "(provided)" : "(omitted)",
                files: sanitizedFiles.length,
                bytes: totalBytes,
                uid,
            });

            let result: Awaited<ReturnType<typeof callBackend>>;
            let firstAttemptStatus: number | null = null;
            let didRetryWithoutCode = false;

            async function hubApply(previewCode?: string) {
                return callBackend(authedReq, {
                    path: "/webcontainer/apply",
                    method: "POST",
                    timeoutMs: 25_000,
                    userCtx: { uid },
                    body: { appId, ...(previewCode ? { code: previewCode } : {}), files: sanitizedFiles },
                });
            }

            async function hubInspect(previewCode?: string) {
                return callBackend(authedReq, {
                    path: "/webcontainer/inspect",
                    method: "GET",
                    timeoutMs: 25_000,
                    userCtx: { uid },
                    query: { appId, ...(previewCode ? { code: previewCode } : {}) },
                });
            }

            async function hubStatus(previewCode: string) {
                return callBackend(authedReq, {
                    path: `/webcontainer/status/${previewCode}`,
                    method: "GET",
                    timeoutMs: 15_000,
                    userCtx: { uid },
                    query: { appId },
                });
            }

            async function hubRestart(previewCode: string) {
                return callBackend(authedReq, {
                    path: `/preview/${previewCode}/restart`,
                    method: "POST",
                    timeoutMs: 20_000,
                    userCtx: { uid },
                    body: { appId },
                });
            }

            async function resolveActivePreviewCode(): Promise<string | ""> {
                if (looksLikePreviewCode(code)) return code;
                const fromResult = (result?.json as any)?.previewCode || (result?.json as any)?.preview_code;
                if (looksLikePreviewCode(fromResult)) return String(fromResult).trim();

                // As a last resort, ask the hub to resolve latest preview by appId.
                const insp = await hubInspect(undefined);
                const inspCode = (insp.json as any)?.code || (insp.json as any)?.previewCode || (insp.json as any)?.preview_code;
                if (looksLikePreviewCode(inspCode)) return String(inspCode).trim();
                return "";
            }

            async function pollReady(previewCode: string, maxMs: number) {
                const startedAt = Date.now();
                let attempt = 0;
                while (Date.now() - startedAt < maxMs) {
                    attempt += 1;
                    const s = await hubStatus(previewCode);
                    if (s.status < 400 && isEffectivelyReady(s.json)) return { ok: true as const, status: s, attempt };
                    await sleep(attempt === 1 ? 750 : 1750);
                }
                return { ok: false as const };
            }
            try {
                const bodyWithCode = { appId, ...(code ? { code } : {}), files: sanitizedFiles };

                result = await callBackend(authedReq, {
                    path: "/webcontainer/apply",
                    method: "POST",
                    timeoutMs: 25_000,
                    userCtx: { uid },
                    body: bodyWithCode,
                });
                firstAttemptStatus = result.status;

                // If the client sent a stale preview code, the hub may reply 404/409 even though a
                // live machine exists for the appId. Retry once without `code` to let the hub
                // resolve the latest active preview.
                if (code && (result.status === 404 || result.status === 409)) {
                    console.info("[previews/apply] retrying without code", { appId, uid, status: result.status });
                    didRetryWithoutCode = true;
                    result = await callBackend(authedReq, {
                        path: "/webcontainer/apply",
                        method: "POST",
                        timeoutMs: 25_000,
                        userCtx: { uid },
                        body: { appId, files: sanitizedFiles },
                    });
                }

                // Handle hub structured errors (409/404) with a small amount of orchestration.
                // This keeps apply reliable during boot and proxy refresh without forcing rebuilds.
                if (result.status === 404) {
                    const hubCode = String((result.json as any)?.code || "").toUpperCase();
                    if (hubCode === "NO_ACTIVE_PREVIEW") {
                        return NextResponse.json(
                            {
                                ...(result.json as any),
                                ok: false,
                                error:
                                    (result.json as any)?.error ||
                                    "No active preview exists yet for this app. Start the preview, then retry apply.",
                            },
                            { status: 404 },
                        );
                    }
                }

                if (result.status === 409) {
                    const hubCode = String((result.json as any)?.code || "").toUpperCase();
                    const previewCode = await resolveActivePreviewCode();

                    if (!previewCode) {
                        // Can't orchestrate without a code; return hub payload as-is.
                        // (The UI can prompt to start/reconnect.)
                    } else if (hubCode === "MACHINE_NOT_READY") {
                        // Wait briefly for the machine to become ready, then retry apply once.
                        const ready = await pollReady(previewCode, 12_000);
                        if (ready.ok) {
                            result = await hubApply(previewCode);
                        }
                    } else if (hubCode === "PROXY_NOT_READY") {
                        // Restart the preview once, wait for inspect to say proxy is ready, then retry apply once.
                        await hubRestart(previewCode);
                        // Poll inspect for proxy readiness (up to ~20s)
                        const startedAt = Date.now();
                        while (Date.now() - startedAt < 20_000) {
                            const insp = await hubInspect(previewCode);
                            if (insp.status < 400 && (insp.json as any)?.ok) break;
                            const inspCode = String((insp.json as any)?.code || "").toUpperCase();
                            if (insp.status === 404 && inspCode === "NO_ACTIVE_PREVIEW") break;
                            await sleep(1500);
                        }
                        result = await hubApply(previewCode);
                    }
                }
            } catch (err: any) {
                const msg = String(err?.message || "Backend call failed");
                console.error("[previews/apply] callBackend threw", { msg });
                if (msg.includes("INTERNAL_API_KEY not set")) {
                    return NextResponse.json(
                        {
                            ok: false,
                            error:
                                "Server is missing INTERNAL_API_KEY. Set it in .env.local and restart the dev server.",
                            code: "MISSING_INTERNAL_API_KEY",
                        },
                        { status: 500 },
                    );
                }
                return NextResponse.json(
                    {
                        ok: false,
                        error: "Failed to reach preview service.",
                        code: "PREVIEW_SERVICE_UNREACHABLE",
                    },
                    { status: 502 },
                );
            }

            if (result.status === 401 || result.status === 403) {
                return NextResponse.json(
                    {
                        ok: false,
                        error:
                            "Preview service authorization failed. This usually means INTERNAL_API_KEY on this server doesn’t match what the hub expects.",
                        code: "PREVIEW_SERVICE_AUTH",
                        ...(process.env.NODE_ENV !== "production"
                            ? { upstream: { status: result.status, reqId: result.reqId, url: result.url } }
                            : {}),
                    },
                    { status: 502 },
                );
            }

            if (process.env.NODE_ENV !== "production" && (result.status === 404 || result.status === 409)) {
                const debug = {
                    status: result.status,
                    firstAttemptStatus,
                    didRetryWithoutCode,
                    reqId: result.reqId,
                    url: result.url,
                };
                const base = result.json;
                if (base && typeof base === "object" && !Array.isArray(base)) {
                    return NextResponse.json({ ...(base as any), __debug: debug }, { status: result.status });
                }
                return NextResponse.json({ ok: result.upstream.ok, data: base, __debug: debug }, { status: result.status });
            }

            // If the hub signals a restart/rebuild is required (usually dependency/config changes),
            // auto-restart so the user doesn't get stuck on a compile error overlay.
            if (result.status < 400) {
                const base = result.json as any;
                const needs = resultNeedsRestart(base) || fileSetNeedsRestart(sanitizedFiles);
                if (needs) {
                    const previewCode = await resolveActivePreviewCode();
                    if (previewCode) {
                        try {
                            await hubRestart(previewCode);
                            await pollReady(previewCode, 20_000);
                            if (base && typeof base === "object" && !Array.isArray(base)) {
                                return NextResponse.json(
                                    { ...(base as any), requiresRestart: true, autoRestarted: true },
                                    { status: result.status },
                                );
                            }
                        } catch {
                            // Best effort only; fall through to returning hub response.
                        }
                    }
                }
            }

            return NextResponse.json(result.json, { status: result.status });
        },
        { csrf: true, methods: ["POST"] },
    );
}
