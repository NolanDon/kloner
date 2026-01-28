// app/api/_lib/route-guard.ts
import { NextRequest, NextResponse } from "next/server";
import { assertCsrf, verifySession } from "./auth";

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
        const session = await verifySession(req);
        uid = session.uid;
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
        return await handler({ req, uid });
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
