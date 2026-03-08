// app/api/_lib/route-guard.ts
import { NextRequest, NextResponse } from "next/server";
import { assertCsrf, getAdminAuth, verifySession } from "./auth";
import { captureCriticalEvent, captureException } from "@/lib/observability";

function getReqId(req: NextRequest): string {
    const h = req.headers;
    return (
        h.get("x-request-id") ||
        h.get("x-vercel-id") ||
        h.get("fly-request-id") ||
        (globalThis.crypto && "randomUUID" in globalThis.crypto
            ? (globalThis.crypto as any).randomUUID()
            : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`)
    );
}

function toPublicAuthError(err: any): {
    status: number;
    code: string;
    message: string;
    logMessage: string;
    appId?: string;
} | null {
    const status = typeof err?.status === "number" ? err.status : null;
    if (status !== 401 && status !== 403) return null;

    const rawMsg = typeof err?.message === "string" ? err.message : "Unauthorized";
    const code = typeof err?.code === "string" && err.code ? err.code : status === 401 ? "UNAUTHORIZED" : "FORBIDDEN";
    const appId = typeof err?.appId === "string" ? err.appId : undefined;

    // Provide a short, user-actionable message for app-scope problems.
    const isAppScope = /app scope/i.test(rawMsg) || /_APP_SCOPE$/.test(code) || code.includes("APP_SCOPE");
    const message = isAppScope
        ? "Missing or invalid app scope. Open this app in App Builder and retry."
        : rawMsg;

    return {
        status,
        code: isAppScope ? (code === "MISSING_APP_SCOPE" ? "MISSING_APP_SCOPE" : "INVALID_APP_SCOPE") : code,
        message,
        logMessage: rawMsg,
        appId,
    };
}

type GuardOpts = {
    csrf?: boolean;            // enable CSRF check
    methods?: string[];        // restrict allowed methods
};

type AuthedHandler = (args: {
    req: NextRequest;
    uid: string;
}) => Promise<NextResponse>;

function readBearerToken(req: NextRequest): string | null {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
    const token = authHeader.slice(7).trim();
    return token || null;
}

async function getResponseDebugDetails(response: NextResponse): Promise<{
    errorMessage?: string;
    errorCode?: string;
    errorReason?: string;
    debugDetails?: Record<string, unknown>;
}> {
    try {
        const clone = response.clone();
        const contentType = (clone.headers.get("content-type") || "").toLowerCase();

        if (contentType.includes("application/json")) {
            const json: any = await clone.json().catch(() => null);
            if (!json || typeof json !== "object") return {};

            const errorMessage = typeof json.error === "string" ? json.error : undefined;
            const errorCode = typeof json.code === "string" ? json.code : undefined;
            const errorReason = typeof json.reason === "string" ? json.reason : undefined;

            const debugDetails: Record<string, unknown> = {};
            if (json.kind !== undefined) debugDetails.kind = json.kind;
            if (json.remaining !== undefined) debugDetails.remaining = json.remaining;
            if (json.limit !== undefined) debugDetails.limit = json.limit;
            if (json.reqId !== undefined) debugDetails.reqId = json.reqId;
            if (json.debug !== undefined) debugDetails.debug = json.debug;

            return {
                errorMessage,
                errorCode,
                errorReason,
                debugDetails: Object.keys(debugDetails).length ? debugDetails : undefined,
            };
        }

        const text = (await clone.text().catch(() => "")).trim();
        if (!text) return {};
        return { errorMessage: text.slice(0, 300) };
    } catch {
        return {};
    }
}

export async function requireSessionAndMaybeCsrf(
    req: NextRequest,
    handler: AuthedHandler,
    opts: GuardOpts = {}
): Promise<NextResponse> {
    const { csrf = false, methods } = opts;

    if (methods && !methods.includes(req.method)) {
        return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
    }

    let uid: string;
    try {
        try {
            const session = await verifySession(req);
            uid = session.uid;
        } catch (sessionErr) {
            const bearer = readBearerToken(req);
            if (!bearer) throw sessionErr;
            const decoded = await getAdminAuth().verifyIdToken(bearer, true);
            uid = decoded.uid;
        }
    } catch (err) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (csrf) {
        try {
            assertCsrf(req);
        } catch (err: any) {
            const status = typeof err?.status === "number" ? err.status : 403;
            const msg = typeof err?.message === "string" && err.message ? err.message : "CSRF check failed";
            return NextResponse.json({ error: msg }, { status });
        }
    }

    try {
        const response = await handler({ req, uid });
        const status = response.status;

        if (status >= 400) {
            const responseDetails = await getResponseDebugDetails(response);
            const messageParts = [`API responded with status ${status}`];
            if (responseDetails.errorCode) messageParts.push(`code=${responseDetails.errorCode}`);
            if (responseDetails.errorReason) messageParts.push(`reason=${responseDetails.errorReason}`);
            if (responseDetails.errorMessage) messageParts.push(`error=${responseDetails.errorMessage}`);
            const severity = status >= 500 ? "critical" : "error";
            await captureCriticalEvent({
                source: "vercel",
                severity,
                statusCode: status,
                route: req.nextUrl?.pathname,
                method: req.method,
                action: `api.${req.method.toLowerCase()}`,
                userId: uid,
                requestId: getReqId(req),
                message: messageParts.join(" | "),
                url: req.url,
                service: "next-api",
                extra: {
                    query: req.nextUrl?.search || "",
                    responseError: responseDetails.errorMessage || null,
                    responseCode: responseDetails.errorCode || null,
                    responseReason: responseDetails.errorReason || null,
                    responseDebug: responseDetails.debugDetails || null,
                },
            });
        }

        return response;
    } catch (err: any) {
        const reqId = getReqId(req);
        const mapped = toPublicAuthError(err);
        if (mapped) {
            console.warn("[route-guard] auth/scope error", {
                reqId,
                uid,
                appId: mapped.appId,
                path: req.nextUrl?.pathname,
                code: mapped.code,
                message: mapped.logMessage,
            });

            if (mapped.status >= 400) {
                const severity = mapped.status >= 500 ? "critical" : "error";
                const isAppScope = mapped.code === "MISSING_APP_SCOPE" || mapped.code === "INVALID_APP_SCOPE";
                await captureCriticalEvent({
                    source: "vercel",
                    severity,
                    statusCode: mapped.status,
                    route: req.nextUrl?.pathname,
                    method: req.method,
                    action: isAppScope ? "api.app_scope_error" : `api.${req.method.toLowerCase()}`,
                    userId: uid,
                    requestId: reqId,
                    message: isAppScope ? `${mapped.logMessage} (${mapped.code})` : mapped.logMessage,
                    url: req.url,
                    service: "next-api",
                    extra: {
                        code: mapped.code,
                        appId: mapped.appId || null,
                    },
                });
            }

            return NextResponse.json(
                {
                    ok: false,
                    error: mapped.message,
                    code: mapped.code,
                    reqId,
                },
                { status: mapped.status }
            );
        }

        console.error("[route-guard] unhandled error", {
            reqId,
            uid,
            path: req.nextUrl?.pathname,
            message: typeof err?.message === "string" ? err.message : String(err),
        });

        await captureException({
            source: "vercel",
            error: err,
            route: req.nextUrl?.pathname,
            action: `api.${req.method.toLowerCase()}`,
            userId: uid,
            requestId: reqId,
            method: req.method,
            statusCode: 500,
            url: req.url,
            service: "next-api",
        });

        // Return a structured 500 so the frontend can surface a usable error.
        // In production we avoid leaking internal details.
        return NextResponse.json(
            {
                ok: false,
                error: "Internal server error",
                reqId,
                ...(process.env.NODE_ENV !== "production"
                    ? {
                          debug:
                              typeof err?.message === "string"
                                  ? err.message
                                  : String(err),
                      }
                    : {}),
            },
            { status: 500 },
        );
    }
}
