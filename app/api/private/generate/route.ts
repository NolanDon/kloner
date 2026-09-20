// src/app/api/private/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/src/lib/callBackend";
import { verifySession } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAuthoritativeUserTier } from "../../_lib/userTier";
import { captureCriticalEvent } from "@/lib/observability";
import type { UserTier } from "@/src/lib/credits";
import { getPublicHttpUrlRejectionReason, validateAndNormalizePublicHttpUrl } from "@/src/lib/publicHttpUrl";
import { getUserFacingUrlErrorMessage } from "@/src/lib/userFacingErrors";
import { recordUrlScanAttempt } from "@/src/lib/urlScanReport";
import {
    peekUserCredit,
    consumeUserCredit,
} from "../../_lib/credits-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

async function captureUrlScanFailure(params: {
    uid?: string;
    targetUrl: string;
    reason: string;
    statusCode: number;
    requestId?: string;
    downstream?: {
        status?: number | null;
        statusText?: string | null;
        code?: string | null;
        requestId?: string | null;
        source?: string | null;
        message?: string | null;
        raw?: string | null;
        body?: unknown;
    };
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
        extra: {
            ...(params.extra || {}),
            downstream: params.downstream || null,
        },
    });
}

function firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
    }
    return "";
}

function extractDownstreamFailureDetails(
    r: { status: number; reqId: string; upstream: { statusText?: string | null }; raw?: string },
    payload: any
) {
    const objectPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const nestedError = (objectPayload as any).error;
    const nestedErrorMessage =
        typeof nestedError === "string"
            ? nestedError
            : nestedError && typeof nestedError === "object"
                ? firstNonEmptyString((nestedError as any).message, (nestedError as any).error, (nestedError as any).reason)
                : "";
    const message = firstNonEmptyString(
        nestedErrorMessage,
        (objectPayload as any).message,
        (objectPayload as any).reason,
        (objectPayload as any).detail,
        (objectPayload as any).errorMessage,
    );
    const code = firstNonEmptyString(
        (objectPayload as any).code,
        (objectPayload as any).errorCode,
        (objectPayload as any).failureCode,
        (objectPayload as any).reasonCode,
    );
    const source = firstNonEmptyString(
        (objectPayload as any).source,
        (objectPayload as any).service,
        (objectPayload as any).origin,
    );
    const requestId = firstNonEmptyString(
        (objectPayload as any).requestId,
        (objectPayload as any).reqId,
        (objectPayload as any).request_id,
        r.reqId,
    );
    const statusText = firstNonEmptyString(
        r.upstream?.statusText,
        (objectPayload as any).statusText,
        (objectPayload as any).statusMessage,
    );
    const raw = typeof r.raw === "string" ? r.raw.trim() : "";

    const reason = firstNonEmptyString(
        message,
        code,
        statusText,
        raw,
        `Backend responded with status ${r.status}`,
    ) || "Backend error";

    return {
        reason,
        code: code || null,
        requestId: requestId || null,
        source: source || null,
        message: message || null,
        statusText: statusText || null,
        raw: raw || null,
        body: objectPayload && Object.keys(objectPayload).length ? objectPayload : null,
    };
}

function jsonNoStatusAlert(body: any, init: { status: number; headers?: Record<string, string> }) {
    return NextResponse.json(body, {
        ...init,
        headers: {
            ...(init.headers || {}),
            "x-observability-skip-status-alert": "1",
        },
    });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ req }) => {
            let decoded: any;
            try {
                decoded = await verifySession(req);
            } catch {
                return jsonNoStatusAlert(
                    { error: getUserFacingUrlErrorMessage({ status: 401, code: "UNAUTHORIZED" }) },
                    { status: 401 }
                );
            }

            const body = (await req.json().catch(() => ({}))) as { url?: string };
            const { url } = body;

            const normalizedUrl = typeof url === "string" ? validateAndNormalizePublicHttpUrl(url) : null;
            if (!normalizedUrl) {
                return jsonNoStatusAlert(
                    { error: getPublicHttpUrlRejectionReason(typeof url === "string" ? url : "") || "Invalid URL" },
                    { status: 400 }
                );
            }

            let tier: UserTier;
            try {
                tier = await getAuthoritativeUserTier(decoded.uid);
            } catch (e: any) {
                return jsonNoStatusAlert(
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
                    return jsonNoStatusAlert(
                        {
                            error: "Monthly snapshot limit reached for your plan.",
                            remaining: peek.remaining,
                        },
                        { status: 429 }
                    );
                }
            } catch {
                return jsonNoStatusAlert(
                    { error: "Unable to check credits. Try again shortly." },
                    { status: 503 }
                );
            }

            try {
                const r = await callBackend(req, {
                    path: "/generate-screenshots",
                    method: "POST",
                    body: { url: normalizedUrl },
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
                    void recordUrlScanAttempt({
                        uid: decoded.uid,
                        tier,
                        url: normalizedUrl,
                        status: "queued",
                        httpStatus: r.status,
                        backendCode: (payload as any)?.code || "TIMEOUT_ACCEPTED",
                        backendRequestId: r.reqId,
                        requestId: r.reqId,
                    }).catch((error) => console.error("[url-scan-report] failed to record queued scan", error));
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

                    const downstream = extractDownstreamFailureDetails(r, payload);

                    await captureUrlScanFailure({
                        uid: decoded.uid,
                        targetUrl: normalizedUrl,
                        reason: downstream.reason,
                        statusCode: status,
                        requestId: r.reqId,
                        downstream: {
                            status: r.status,
                            statusText: downstream.statusText,
                            code: downstream.code,
                            requestId: downstream.requestId,
                            source: downstream.source,
                            message: downstream.message,
                            raw: downstream.raw,
                            body: downstream.body,
                        },
                        extra: {
                            backendStatus: r.status,
                            backendStatusText: downstream.statusText,
                            backendRequestId: downstream.requestId,
                            backendSource: downstream.source,
                            backendMessage: downstream.message,
                            upstreamOk: r.upstream.ok,
                            payloadOk: okField,
                            backendCode: downstream.code,
                            totalPlanned,
                            backendRaw: downstream.raw,
                        },
                    });
                    void recordUrlScanAttempt({
                        uid: decoded.uid,
                        tier,
                        url: normalizedUrl,
                        status: "failure",
                        httpStatus: status,
                        backendCode: downstream.code,
                        backendRequestId: downstream.requestId,
                        backendSource: downstream.source,
                        rawError: downstream.reason,
                        rawResponse: downstream.raw,
                        totalPlanned,
                        requestId: r.reqId,
                    }).catch((error) => console.error("[url-scan-report] failed to record failed scan", error));

                    const userMessage = getUserFacingUrlErrorMessage({
                        status,
                        code: downstream.code,
                        reason: downstream.reason,
                        message: downstream.message,
                    });

                    return jsonNoStatusAlert(
                        {
                            error: userMessage,
                            code: downstream.code || (status >= 500 ? "DOWNSTREAM_FAILURE" : "URL_SCAN_FAILED"),
                            ...(totalPlanned === 0
                                ? { reason: "no_captures" }
                                : {}),
                        },
                        {
                            status,
                            headers: {
                                "x-request-id": r.reqId,
                                "cache-control": "no-store",
                                "x-observability-skip-status-alert": "1",
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

                void recordUrlScanAttempt({
                    uid: decoded.uid,
                    tier,
                    url: normalizedUrl,
                    status: "success",
                    httpStatus: r.status,
                    backendRequestId: r.reqId,
                    totalPlanned,
                    requestId: r.reqId,
                }).catch((error) => console.error("[url-scan-report] failed to record successful scan", error));

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
                    targetUrl: normalizedUrl,
                    reason: e?.message || "Proxy failed",
                    statusCode: 502,
                    downstream: {
                        status: 502,
                        statusText: "Proxy failed",
                        code: e?.code || e?.name || "PROXY_FAILURE",
                        requestId: e?.requestId || e?.reqId || null,
                        source: "proxy",
                        message: e?.message || "Proxy failed",
                    },
                    extra: {
                        errorName: e?.name || "Error",
                        proxyFailure: true,
                        proxyErrorCode: e?.code || null,
                    },
                });
                void recordUrlScanAttempt({
                    uid: decoded.uid,
                    tier,
                    url: normalizedUrl,
                    status: "failure",
                    httpStatus: 502,
                    backendCode: e?.code || e?.name || "PROXY_FAILURE",
                    rawError: e?.message || "Proxy failed",
                    requestId: e?.requestId || e?.reqId || null,
                }).catch((error) => console.error("[url-scan-report] failed to record proxy failure", error));

                const userMessage = getUserFacingUrlErrorMessage({
                    status: 502,
                    code: e?.code || e?.name || "PROXY_FAILURE",
                    message: e?.message || "Proxy failed",
                });

                return jsonNoStatusAlert(
                    {
                        error: userMessage,
                        code: e?.code || e?.name || "PROXY_FAILURE",
                    },
                    {
                        status: 502,
                        headers: {
                            "x-observability-skip-status-alert": "1",
                        },
                    }
                );
            }
        },
        { methods: ["POST"] }
    );
}
