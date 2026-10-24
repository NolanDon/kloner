// src/app/api/private/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/src/lib/callBackend";
import { verifySession } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAuthoritativeUserTier } from "../../_lib/userTier";
import { captureAuditEvent, captureCriticalEvent } from "@/lib/observability";
import type { UserTier } from "@/src/lib/credits";
import { getPublicHttpUrlRejectionReason, validateAndNormalizePublicHttpUrl } from "@/src/lib/publicHttpUrl";
import {
    peekUserCredit,
    consumeUserCredit,
} from "../../_lib/credits-server";
import { shouldRequireEarlyGenerationPaywall } from "../../_lib/earlyGenerationGate";
import { disableUserForBlockedUrl, getClientIp, isAdultBlockedUrl } from "../../_lib/blockedUrlAbuse";

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
    const host = (() => {
        try { return new URL(params.targetUrl).hostname; } catch { return "this website"; }
    })();
    await captureCriticalEvent({
        source: "internal",
        severity: params.statusCode >= 500 ? "critical" : "error",
        slackColor: "#D83A4E",
        statusCode: params.statusCode,
        route: "/api/private/generate",
        method: "POST",
        action: "url_scan_failed",
        userId: params.uid,
        requestId: params.requestId,
        service: "url-generate-proxy",
        message: `A user couldn't scan ${host}.`,
        url: params.targetUrl,
        tags: ["url-scan", "generate", "backend-failure"],
        extra: {
            ...(params.extra || {}),
            result: "failed",
            failureReason: params.reason,
            downstream: params.downstream || null,
        },
    });
}

async function captureUrlScanStart(params: { uid?: string; targetUrl: string; requestId?: string }) {
    const host = (() => {
        try { return new URL(params.targetUrl).hostname; } catch { return "this website"; }
    })();
    if (typeof captureAuditEvent !== "function") return;
    void captureAuditEvent({
        source: "internal",
        severity: "info",
        slackColor: "#3A86D8",
        route: "/api/private/generate",
        method: "POST",
        action: "url_scan_started",
        userId: params.uid,
        requestId: params.requestId,
        service: "url-generate-proxy",
        message: `A user started a scan of ${host}.`,
        url: params.targetUrl,
        tags: ["url-scan", "generate"],
        extra: { result: "started" },
    });
}

async function captureUrlScanSuccess(params: {
    uid?: string;
    targetUrl: string;
    requestId?: string;
    statusCode: number;
    totalPlanned: number | null;
    backendCode?: string | null;
    backendSource?: string | null;
}) {
    const host = (() => {
        try { return new URL(params.targetUrl).hostname; } catch { return "this website"; }
    })();
    if (typeof captureAuditEvent !== "function") return;
    void captureAuditEvent({
        source: "internal",
        severity: "info",
        slackColor: "#2EAD70",
        statusCode: params.statusCode,
        route: "/api/private/generate",
        method: "POST",
        action: "url_scan_succeeded",
        userId: params.uid,
        requestId: params.requestId,
        service: "url-generate-proxy",
        message: `A user scanned ${host} successfully.`,
        url: params.targetUrl,
        tags: ["url-scan", "generate"],
        extra: {
            result: "succeeded",
            totalPlanned: params.totalPlanned,
            backendStatus: params.statusCode,
            backendCode: params.backendCode || null,
            backendSource: params.backendSource || null,
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

function buildDomainVerificationMessage(targetUrl: string): {
    error: string;
    userMessage: string;
    code: string;
    verificationUrl: string;
    verificationDomain: string;
} | null {
    try {
        const parsed = new URL(targetUrl);
        const verificationDomain = parsed.hostname.replace(/^www\./i, "").trim();
        if (!verificationDomain) return null;

        const verificationUrl = parsed.origin;
        const accessibilityMessage =
            `We couldn't access ${verificationDomain} to scan it. Make sure the site is publicly accessible without a login, CAPTCHA, or network restriction, then try again.`;

        return {
            error: accessibilityMessage,
            userMessage: accessibilityMessage,
            code: "DOMAIN_VERIFICATION_REQUIRED",
            verificationUrl,
            verificationDomain,
        };
    } catch {
        return null;
    }
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

function getUnexpectedBinaryScanResponse(r: { upstream?: any; raw?: string }): {
    contentType: string;
    reason: string;
    rawSummary: string;
} | null {
    const contentType = String(r.upstream?.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
    const raw = typeof r.raw === "string" ? r.raw : "";
    const isWebp = raw.length >= 12 && raw.slice(0, 4) === "RIFF" && raw.slice(8, 12) === "WEBP";
    const isBinaryMedia = /^(?:image|audio|video)\//.test(contentType) || contentType === "application/octet-stream";

    if (!isWebp && !isBinaryMedia) return null;

    const detectedType = contentType || (isWebp ? "image/webp" : "application/octet-stream");
    return {
        contentType: detectedType,
        reason: `Scan backend returned ${detectedType} instead of scan results.`,
        // Keep binary response contents out of logs, Slack alerts, and user-facing errors.
        rawSummary: `[binary response omitted; content-type=${detectedType}${isWebp ? "; signature=RIFF/WEBP" : ""}]`,
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
            } catch (e: any) {
                return jsonNoStatusAlert(
                    { error: e?.message || "Unauthorized" },
                    { status: 401 }
                );
            }

            const body = (await req.json().catch(() => ({}))) as { url?: string };
            const { url } = body;

            const normalizedUrl = typeof url === "string" ? validateAndNormalizePublicHttpUrl(url) : null;
            if (!normalizedUrl) {
                if (typeof url === "string" && url.trim() && isAdultBlockedUrl(url)) {
                    await disableUserForBlockedUrl({
                        uid: decoded.uid,
                        url,
                        ip: getClientIp(req),
                        route: "/api/private/generate",
                        requestId: req.headers?.get?.("x-request-id"),
                    });
                }
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

            const earlyPaywall = shouldRequireEarlyGenerationPaywall(req);
            if (tier === "free" && earlyPaywall.required) {
                return jsonNoStatusAlert(
                    {
                        error: "Please upgrade before scanning a website from this request.",
                        code: "EARLY_GENERATION_PAYWALL_REQUIRED",
                        paywallRequired: true,
                        paywallReason: earlyPaywall.reason,
                        upgrade: { requiredPlan: "pro", action: "upgrade" },
                    },
                    { status: 402, headers: { "Cache-Control": "private, no-store" } },
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

            await captureUrlScanStart({
                uid: decoded.uid,
                targetUrl: normalizedUrl,
                requestId: req.headers?.get?.("x-request-id") || undefined,
            });

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
                    if (typeof captureAuditEvent === "function") void captureAuditEvent({
                        source: "internal",
                        severity: "info",
                        slackColor: "#3A86D8",
                        statusCode: 202,
                        route: "/api/private/generate",
                        method: "POST",
                        action: "url_scan_accepted",
                        userId: decoded.uid,
                        requestId: r.reqId,
                        service: "url-generate-proxy",
                        message: `The scan of ${new URL(normalizedUrl).hostname} is still running; the backend accepted it for processing.`,
                        url: normalizedUrl,
                        tags: ["url-scan", "generate"],
                        extra: { result: "accepted", backendStatus: r.status, backendCode: (payload as any)?.code || null },
                    });
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
                const unexpectedBinaryResponse = getUnexpectedBinaryScanResponse(r);
                const totalPlanned =
                    typeof (payload as any).totalPlanned === "number"
                        ? (payload as any).totalPlanned
                        : null;

                const logicalOk =
                    r.upstream.ok &&
                    !unexpectedBinaryResponse &&
                    !hasErrorFlag &&
                    okField !== false &&
                    (totalPlanned === null || totalPlanned > 0);

                // Backend failed or produced no captures → no credit burn
                if (!logicalOk) {
                    const status =
                        r.status && r.status >= 400
                            ? r.status
                            : 502;

                    const downstream = unexpectedBinaryResponse
                        ? {
                            reason: unexpectedBinaryResponse.reason,
                            code: "UNEXPECTED_BINARY_SCAN_RESPONSE",
                            requestId: r.reqId || null,
                            source: "generate-screenshots",
                            message: unexpectedBinaryResponse.reason,
                            statusText: r.upstream?.statusText || null,
                            raw: unexpectedBinaryResponse.rawSummary,
                            body: null,
                        }
                        : extractDownstreamFailureDetails(r, payload);
                    const domainVerification = status >= 500 && !unexpectedBinaryResponse
                        ? buildDomainVerificationMessage(normalizedUrl)
                        : null;
                    const userError = unexpectedBinaryResponse
                        ? "The scan service returned an image instead of scan results. Please try again."
                        : domainVerification?.userMessage || downstream.reason;

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

                    return jsonNoStatusAlert(
                        {
                            error: userError,
                            userMessage: userError,
                            code: domainVerification?.code || downstream.code || (status >= 500 ? "DOWNSTREAM_FAILURE" : "URL_SCAN_FAILED"),
                            upstreamStatus: r.status,
                            upstreamStatusText: downstream.statusText,
                            upstreamContentType: unexpectedBinaryResponse?.contentType || null,
                            upstreamCode: downstream.code,
                            upstreamRequestId: downstream.requestId,
                            upstreamSource: downstream.source,
                            upstreamMessage: downstream.message,
                            upstreamBody: downstream.body,
                            verificationUrl: domainVerification?.verificationUrl,
                            verificationDomain: domainVerification?.verificationDomain,
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

                await captureUrlScanSuccess({
                    uid: decoded.uid,
                    targetUrl: normalizedUrl,
                    requestId: r.reqId,
                    statusCode: r.status,
                    totalPlanned,
                    backendCode: (payload as any)?.code || null,
                    backendSource: (payload as any)?.source || null,
                });

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
                    requestId: e?.requestId || e?.reqId || req.headers?.get?.("x-request-id") || undefined,
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

                return jsonNoStatusAlert(
                    {
                        error: e?.message || "Proxy failed",
                        code: e?.code || e?.name || "PROXY_FAILURE",
                        upstreamStatus: 502,
                        upstreamSource: "proxy",
                        upstreamMessage: e?.message || "Proxy failed",
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
