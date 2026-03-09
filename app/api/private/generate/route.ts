// src/app/api/private/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/src/lib/callBackend";
import { verifySession } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAuthoritativeUserTier } from "../../_lib/userTier";
import { captureCriticalEvent } from "@/lib/observability";
import type { UserTier } from "@/src/lib/credits";
import {
    peekUserCredit,
    consumeUserCredit,
} from "../../_lib/credits-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function isHttpUrl(s?: string): s is string {
    if (!s) return false;
    try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

async function captureUrlScanFailure(params: {
    uid?: string;
    targetUrl: string;
    reason: string;
    statusCode: number;
    requestId?: string;
    extra?: Record<string, unknown>;
}) {
    await captureCriticalEvent({
        source: "internal",
        severity: "critical",
        statusCode: params.statusCode,
        route: "/api/private/generate",
        method: "POST",
        action: "url_scan_failed",
        userId: params.uid,
        requestId: params.requestId,
        service: "url-generate-proxy",
        message: `URL scan failed: ${params.reason}`,
        url: params.targetUrl,
        tags: ["url-scan", "generate", "backend-failure"],
        extra: params.extra,
    });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req }) => {
            let decoded: any;
            try {
                decoded = await verifySession(req);
            } catch (e: any) {
                return NextResponse.json(
                    { error: e?.message || "Unauthorized" },
                    { status: 401 }
                );
            }

            const body = (await req.json().catch(() => ({}))) as { url?: string };
            const { url } = body;

            if (!isHttpUrl(url)) {
                return NextResponse.json(
                    { error: "Invalid URL" },
                    { status: 400 }
                );
            }

            let tier: UserTier;
            try {
                tier = await getAuthoritativeUserTier(decoded.uid);
            } catch (e: any) {
                return NextResponse.json(
                    {
                        error:
                            e?.message ||
                            "Unable to determine subscription tier. Try again shortly.",
                    },
                    { status: 500 }
                );
            }

            // Hard gate: do not even hit Fly if out of snapshot
            try {
                const peek = await peekUserCredit(decoded.uid, tier, "snapshot");
                if (!peek.ok || (peek.remaining !== null && peek.remaining <= 0)) {
                    return NextResponse.json(
                        {
                            error: "Monthly snapshot limit reached for your plan.",
                            remaining: peek.remaining,
                        },
                        { status: 429 }
                    );
                }
            } catch {
                return NextResponse.json(
                    { error: "Unable to check credits. Try again shortly." },
                    { status: 503 }
                );
            }

            try {
                const r = await callBackend(req, {
                    path: "/generate-screenshots",
                    method: "POST",
                    body: { url },
                    timeoutMs: 60_000,
                    acceptOnTimeout: true,
                    userCtx: {
                        uid: decoded.uid,
                        email: decoded?.email || "",
                        tier,
                    },
                });

                // Normalize payload
                const payload =
                    r.json && Object.keys(r.json).length
                        ? r.json
                        : {
                            ok: true,
                            queued: r.status === 202 || r.status === 204,
                        };

                const timedOutBeforeAck =
                    r.status === 202 && (payload as any)?.code === "TIMEOUT_ACCEPTED";

                if (timedOutBeforeAck) {
                    return NextResponse.json(
                        {
                            ok: true,
                            queued: true,
                            accepted: true,
                            code: "TIMEOUT_ACCEPTED",
                        },
                        {
                            status: 202,
                            headers: {
                                "x-request-id": r.reqId,
                                "cache-control": "no-store",
                            },
                        }
                    );
                }

                // Decide if this run actually "succeeded" in a way that should burn a credit.
                //
                // Conditions for success:
                //  - HTTP status is 2xx (r.upstream.ok === true)
                //  - payload.error is falsy
                //  - payload.ok is not explicitly false
                //  - if payload.totalPlanned exists, it must be > 0 (we actually captured something)
                const hasErrorFlag = Boolean((payload as any).error);
                const okField = (payload as any).ok;
                const totalPlanned =
                    typeof (payload as any).totalPlanned === "number"
                        ? (payload as any).totalPlanned
                        : null;

                const logicalOk =
                    r.upstream.ok &&
                    !hasErrorFlag &&
                    okField !== false &&
                    (totalPlanned === null || totalPlanned > 0);

                // Backend failed or produced no captures → no credit burn
                if (!logicalOk) {
                    const status =
                        r.status && r.status >= 400
                            ? r.status
                            : 502;

                    const reason =
                        (typeof (payload as any).error === "string" && (payload as any).error.trim()) ||
                        (typeof (payload as any).message === "string" && (payload as any).message.trim()) ||
                        (typeof (payload as any).reason === "string" && (payload as any).reason.trim()) ||
                        "Backend error (no captures or failed run).";

                    const backendCode =
                        typeof (payload as any).code === "string"
                            ? (payload as any).code
                            : undefined;

                    await captureUrlScanFailure({
                        uid: decoded.uid,
                        targetUrl: url,
                        reason,
                        statusCode: status,
                        requestId: r.reqId,
                        extra: {
                            backendStatus: r.status,
                            upstreamOk: r.upstream.ok,
                            payloadOk: okField,
                            backendCode,
                            totalPlanned,
                        },
                    });

                    return NextResponse.json(
                        {
                            error: reason,
                            ...(totalPlanned === 0
                                ? { reason: "no_captures" }
                                : {}),
                        },
                        {
                            status,
                            headers: {
                                "x-request-id": r.reqId,
                                "cache-control": "no-store",
                            },
                        }
                    );
                }

                // Heavy work succeeded → burn one credit
                try {
                    // NOTE: currently charging "snapshot" credits for this endpoint.
                    await consumeUserCredit(decoded.uid, tier, "snapshot");
                } catch {
                    // If this fails you effectively gave a free run; acceptable.
                }

                return NextResponse.json(payload, {
                    status: 200,
                    headers: {
                        "x-request-id": r.reqId,
                        "cache-control": "no-store",
                    },
                });
            } catch (e: any) {
                await captureUrlScanFailure({
                    uid: decoded.uid,
                    targetUrl: url,
                    reason: e?.message || "Proxy failed",
                    statusCode: 502,
                    extra: {
                        errorName: e?.name || "Error",
                    },
                });

                return NextResponse.json(
                    { error: e?.message || "Proxy failed" },
                    { status: 502 }
                );
            }
        },
        { methods: ["POST"] }
    );
}
