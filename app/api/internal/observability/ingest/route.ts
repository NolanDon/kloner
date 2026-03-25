import { NextRequest, NextResponse } from "next/server";
import { captureCriticalEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function isAuthorized(req: NextRequest): boolean {
    const expected = (process.env.OBS_INGEST_TOKEN || process.env.INTERNAL_API_KEY || "").trim();
    if (!expected) return false;

    const headerToken = (req.headers.get("x-observability-token") || "").trim();
    const authHeader = (req.headers.get("authorization") || "").trim();
    const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

    return headerToken === expected || bearer === expected;
}

function allowUnauthFrontendIngest(req: NextRequest, source: unknown): boolean {
    const enabled = (process.env.OBS_ALLOW_UNAUTH_FRONTEND_INGEST || "").toLowerCase().trim();
    if (enabled !== "1" && enabled !== "true") return false;
    if ((typeof source === "string" ? source.toLowerCase() : "") !== "frontend") return false;

    const origin = (req.headers.get("origin") || "").trim();
    if (!origin) return false;
    const host = req.headers.get("host") || "";
    try {
        const originUrl = new URL(origin);
        return originUrl.host === host;
    } catch {
        return false;
    }
}

function cleanString(value: unknown, max = 500): string | undefined {
    if (typeof value !== "string") return undefined;
    const v = value.trim();
    if (!v) return undefined;
    return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function cleanStatus(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === "string") {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n)) return n;
    }
    return undefined;
}

function cleanTags(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const tags = value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20);
    return tags.length ? tags : undefined;
}

function getClientIp(req: NextRequest): string | undefined {
    const candidates = [
        req.headers.get("x-forwarded-for"),
        req.headers.get("x-real-ip"),
        req.headers.get("fly-client-ip"),
        req.headers.get("cf-connecting-ip"),
        req.headers.get("x-vercel-forwarded-for"),
    ];
    const raw = candidates.find((value) => typeof value === "string" && value.trim()) || "";
    const ip = raw.split(",")[0].trim();
    return ip || undefined;
}

function classifyCaller(req: NextRequest, isAuthorized: boolean, source: string): string {
    const userAgent = (req.headers.get("user-agent") || "").toLowerCase();
    const origin = (req.headers.get("origin") || "").trim();
    const referer = (req.headers.get("referer") || "").trim();
    const browserContext = Boolean(origin || referer);
    const scriptUa = /curl|wget|python-requests|go-http-client|postmanruntime|okhttp|httpie/.test(userAgent);

    if (isAuthorized) return browserContext ? "tokenized-browser" : "tokenized-api";
    if ((source || "").toLowerCase() === "frontend") return "frontend-browser";
    if (scriptUa && !browserContext) return "anonymous-script";
    if (browserContext) return "browser-anonymous";
    return "unknown";
}

export async function POST(req: NextRequest) {
    let payload: any;
    try {
        payload = await req.json();
    } catch {
        return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
    }

    if (!isAuthorized(req) && !allowUnauthFrontendIngest(req, payload?.source)) {
        return unauthorized();
    }

    const inputEvents = Array.isArray(payload?.events) ? payload.events : [payload];
    if (!inputEvents.length) {
        return NextResponse.json({ ok: false, error: "No events provided" }, { status: 400 });
    }

    const results: Array<{ delivered: boolean; eventId?: string | null; reason?: string }> = [];
    const requestContext = {
        callerType: classifyCaller(req, isAuthorized(req), String(payload?.source || "")),
        userAgent: (req.headers.get("user-agent") || "").trim() || undefined,
        origin: (req.headers.get("origin") || "").trim() || undefined,
        referer: (req.headers.get("referer") || "").trim() || undefined,
        clientIp: getClientIp(req),
        hasSession: Boolean(req.headers.get("cookie")),
        hasBearer: Boolean((req.headers.get("authorization") || "").trim()),
    };

    for (const item of inputEvents.slice(0, 25)) {
        const statusCode = cleanStatus(item?.statusCode);
        const providedSeverity = cleanString(item?.severity, 20)?.toLowerCase();
        const severity =
            providedSeverity === "critical" ||
            providedSeverity === "error" ||
            providedSeverity === "warning" ||
            providedSeverity === "info"
                ? providedSeverity
                : statusCode && statusCode >= 500
                  ? "critical"
                  : "error";

        const message = cleanString(item?.message, 1000) || "Backend error event";
        const source = cleanString(item?.source, 50)?.toLowerCase() === "fly" ? "fly" : cleanString(item?.source, 50)?.toLowerCase() === "frontend" ? "frontend" : "internal";

        const result = await captureCriticalEvent({
            source,
            severity,
            statusCode,
            route: cleanString(item?.route, 200),
            method: cleanString(item?.method, 20),
            page: cleanString(item?.page, 200),
            action: cleanString(item?.action, 200),
            userId: cleanString(item?.userId, 200),
            requestId: cleanString(item?.requestId, 200),
            message,
            errorName: cleanString(item?.errorName, 200),
            stack: cleanString(item?.stack, 10000),
            url: cleanString(item?.url, 1000),
            service: cleanString(item?.service, 200) || "fly-backend",
            tags: cleanTags(item?.tags),
            environment: cleanString(item?.environment, 100),
            occurredAt: cleanString(item?.occurredAt, 100),
            extra: {
                ...(typeof item?.extra === "object" && item.extra ? item.extra : {}),
                requestContext,
            },
        });

        results.push({
            delivered: result.delivered,
            eventId: "eventId" in result ? result.eventId : null,
            reason: "reason" in result ? result.reason : undefined,
        });
    }

    const deliveredCount = results.filter((r) => r.delivered).length;
    return NextResponse.json({ ok: true, deliveredCount, total: results.length, results });
}
