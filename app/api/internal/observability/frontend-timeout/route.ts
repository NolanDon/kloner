import { NextRequest, NextResponse } from "next/server";
import { classifyScanAlert } from "@/lib/scanAlertClassification";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { captureCriticalEvent } from "@/lib/observability";
import type { ObservabilitySeverity } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, max = 500): string {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function cleanNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
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

function cleanDiagnosticUrl(value: unknown): string | undefined {
    if (typeof value !== "string" || !value.trim()) return undefined;
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
        const path = url.pathname.split("/").map((part) =>
            part.length > 64 || part.includes("@") ? "[redacted]" : part,
        ).join("/").slice(0, 240) || "/";
        return `${url.origin}${path}`.slice(0, 300);
    } catch {
        return undefined;
    }
}

function cleanDiagnosticText(value: unknown, max = 500): string | undefined {
    if (typeof value !== "string") return undefined;
    const text = value.slice(0, max)
        .replace(/https?:\/\/[^\s"'<>)}\]]+/gi, (candidate) =>
            (() => {
                const locationSuffix = candidate.match(/:(\d+):(\d+)$/)?.[0] || "";
                const withoutLocation = locationSuffix
                    ? candidate.slice(0, -locationSuffix.length)
                    : candidate;
                return `${cleanDiagnosticUrl(withoutLocation.replace(/[.,;:]$/, "")) || "[URL]"}${locationSuffix}`;
            })(),
        )
        .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
        .replace(/((?:token|secret|api[_-]?key|authorization|password)\s*[=:]\s*)[^\s&;,]+/gi, "$1[redacted]")
        .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted token]");
    return text || undefined;
}

function cleanBrowserFindings(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const raw = value as Record<string, any>;
    const boundedRows = (items: unknown, limit: number, map: (item: Record<string, any>) => unknown) =>
        (Array.isArray(items) ? items : []).slice(0, limit)
            .filter((item): item is Record<string, any> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
            .map(map);
    const cleanUrlRows = (items: unknown, limit = 6) => boundedRows(items, limit, (item) => ({
        ...(cleanDiagnosticUrl(item.url) ? { url: cleanDiagnosticUrl(item.url) } : {}),
        ...(cleanDiagnosticText(item.resourceType, 32) ? { resourceType: cleanDiagnosticText(item.resourceType, 32) } : {}),
        ...(cleanDiagnosticText(item.method, 12) ? { method: cleanDiagnosticText(item.method, 12) } : {}),
        ...(cleanDiagnosticText(item.error, 160) ? { error: cleanDiagnosticText(item.error, 160) } : {}),
        ...(cleanNumber(item.status) !== undefined ? { status: cleanNumber(item.status) } : {}),
        ...(cleanDiagnosticUrl(item.frameUrl) ? { frameUrl: cleanDiagnosticUrl(item.frameUrl) } : {}),
    }));
    const rawPage = raw.page && typeof raw.page === "object" ? raw.page : {};
    const rawNavigation = raw.navigation && typeof raw.navigation === "object" ? raw.navigation : null;
    const findings: Record<string, any> = {
        ...(cleanDiagnosticText(raw.reason, 240) ? { reason: cleanDiagnosticText(raw.reason, 240) } : {}),
        ...(rawNavigation ? { navigation: {
            ...(cleanNumber(rawNavigation.status) !== undefined ? { status: cleanNumber(rawNavigation.status) } : {}),
            ...(cleanDiagnosticUrl(rawNavigation.path) ? { path: cleanDiagnosticUrl(rawNavigation.path) } : {}),
            ...(cleanDiagnosticText(rawNavigation.error, 200) ? { error: cleanDiagnosticText(rawNavigation.error, 200) } : {}),
        } } : {}),
        page: {
            ...(typeof rawPage.bodyVisible === "boolean" ? { bodyVisible: rawPage.bodyVisible } : {}),
            ...(cleanNumber(rawPage.visibleElementCount) !== undefined ? { visibleElementCount: cleanNumber(rawPage.visibleElementCount) } : {}),
            ...(cleanDiagnosticText(rawPage.readyState, 24) ? { readyState: cleanDiagnosticText(rawPage.readyState, 24) } : {}),
        },
        pageErrors: boundedRows(raw.pageErrors, 2, (item) => ({
            ...(cleanDiagnosticText(item.message, 260) ? { message: cleanDiagnosticText(item.message, 260) } : {}),
            ...(cleanDiagnosticText(item.stack, 700) ? { stack: cleanDiagnosticText(item.stack, 700) } : {}),
        })),
        consoleErrors: boundedRows(raw.consoleErrors, 3, (item) => ({
            ...(cleanDiagnosticText(item.message, 220) ? { message: cleanDiagnosticText(item.message, 220) } : {}),
            ...(item.location && typeof item.location === "object" ? { location: {
                ...(cleanDiagnosticUrl(item.location.url) ? { url: cleanDiagnosticUrl(item.location.url) } : {}),
                ...(cleanNumber(item.location.lineNumber) !== undefined ? { lineNumber: cleanNumber(item.location.lineNumber) } : {}),
                ...(cleanNumber(item.location.columnNumber) !== undefined ? { columnNumber: cleanNumber(item.location.columnNumber) } : {}),
            } } : {}),
        })),
        httpErrors: cleanUrlRows(raw.httpErrors, 4),
        requestFailures: cleanUrlRows(raw.requestFailures, 3),
        blockedExternalRequests: cleanUrlRows(raw.blockedExternalRequests, 8),
        blockedDynamicModuleErrors: boundedRows(raw.blockedDynamicModuleErrors, 2, (item) => ({
            ...(cleanDiagnosticText(item.message, 260) ? { message: cleanDiagnosticText(item.message, 260) } : {}),
            ...(cleanDiagnosticText(item.stack, 700) ? { stack: cleanDiagnosticText(item.stack, 700) } : {}),
        })),
        runtimeDiagnostics: boundedRows(raw.runtimeDiagnostics, 8, (item) => ({
            ...(cleanDiagnosticText(item.kind, 32) ? { kind: cleanDiagnosticText(item.kind, 32) } : {}),
            ...(cleanDiagnosticText(item.resourceType, 32) ? { resourceType: cleanDiagnosticText(item.resourceType, 32) } : {}),
            ...(cleanDiagnosticText(item.method, 12) ? { method: cleanDiagnosticText(item.method, 12) } : {}),
            ...(cleanNumber(item.status) !== undefined ? { status: cleanNumber(item.status) } : {}),
            ...(cleanDiagnosticUrl(item.url) ? { url: cleanDiagnosticUrl(item.url) } : {}),
            ...(cleanDiagnosticText(item.message, 260) ? { message: cleanDiagnosticText(item.message, 260) } : {}),
            ...(cleanDiagnosticText(item.stack, 500) ? { stack: cleanDiagnosticText(item.stack, 500) } : {}),
            ...(cleanNumber(item.line) !== undefined ? { line: cleanNumber(item.line) } : {}),
            ...(cleanNumber(item.column) !== undefined ? { column: cleanNumber(item.column) } : {}),
        })),
    };
    const serializedSize = JSON.stringify(findings).length;
    if (serializedSize > 7_000) {
        findings.runtimeDiagnostics = findings.runtimeDiagnostics.slice(0, 4);
        findings.blockedExternalRequests = findings.blockedExternalRequests.slice(0, 4);
    }
    return findings;
}

function browserFindingsForSlack(value: Record<string, any> | undefined): Record<string, unknown> | undefined {
    if (!value) return undefined;
    const boundedRows = (items: unknown, limit: number, textLimit: number) =>
        (Array.isArray(items) ? items : []).slice(0, limit).map((item) => ({
            ...item,
            ...(typeof item?.message === "string" ? { message: item.message.slice(0, textLimit) } : {}),
            ...(typeof item?.stack === "string" ? { stack: item.stack.slice(0, 180) } : {}),
        }));
    return {
        reason: value.reason,
        page: value.page,
        navigation: value.navigation,
        runtimeDiagnostics: boundedRows(value.runtimeDiagnostics, 4, 180),
        httpErrors: (Array.isArray(value.httpErrors) ? value.httpErrors : []).slice(0, 3),
        pageErrors: boundedRows(value.pageErrors, 2, 180),
    };
}

function cleanSeverity(value: unknown): ObservabilitySeverity {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (raw === "critical" || raw === "error" || raw === "warning" || raw === "info") return raw;
    return "critical";
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const requestUserAgent = cleanText(authedReq.headers.get("user-agent"), 500);
            const origin = cleanText(authedReq.headers.get("origin"), 300);
            const referer = cleanText(authedReq.headers.get("referer"), 300);
            const clientIp =
                cleanText(authedReq.headers.get("x-forwarded-for"), 300) ||
                cleanText(authedReq.headers.get("x-real-ip"), 300) ||
                cleanText(authedReq.headers.get("fly-client-ip"), 300) ||
                cleanText(authedReq.headers.get("cf-connecting-ip"), 300) ||
                cleanText(authedReq.headers.get("x-vercel-forwarded-for"), 300);

            let body: any = {};
            try {
                body = await authedReq.json();
            } catch {
                body = {};
            }

            const appId = cleanText(body?.appId, 200);
            const code = cleanText(body?.code, 200);
            const status = cleanText(body?.status, 80) || "unknown";
            const action = cleanText(body?.action, 120) || "preview_timeout_12min";
            let severity = cleanSeverity(body?.severity);
            const route = cleanText(body?.route, 300) || "/dashboard/view";
            const service = cleanText(body?.service, 200) || "webcontainer-runner";
            const message =
                cleanText(body?.message, 1000) ||
                "Preview exceeded timeout while starting in frontend polling";
            const previewUrl = cleanText(body?.previewUrl, 1000);
            const browser = cleanText(body?.browser, 120);
            const payloadUserAgent = cleanText(body?.userAgent, 500);
            const reason = cleanText(body?.reason, 200);
            const machineId = cleanText(body?.machineId, 120);
            const ageMs = cleanNumber(body?.ageMs);
            const elapsedMs = cleanNumber(body?.elapsedMs);
            let statusCode = cleanNumber(body?.statusCode) || ((severity === "info" || severity === "warning") ? 200 : 504);
            const tags = cleanTags(body?.tags) || ["preview", "timeout", "frontend"];
            const requestId = cleanText(body?.requestId, 200);
            const jobId = cleanText(body?.jobId, 200);
            const alertKey = cleanText(body?.alertKey, 300);
            const deduped = body?.deduped === true;

            const backend = body?.backend && typeof body.backend === "object" ? body.backend : {};
            const backendDebug = backend?.debug && typeof backend.debug === "object" ? backend.debug : {};
            const browserFindings = cleanBrowserFindings(body?.browserFindings);
            const browserFindingsDebug = browserFindingsForSlack(browserFindings);

            const backendStatus = cleanText((backend as any)?.status, 80);
            const backendUiStage = cleanText((backend as any)?.uiStage, 120);
            const backendCode = cleanText((backend as any)?.code, 200);
            const backendMessage = cleanText((backend as any)?.message, 1000);
            const backendRequestId = cleanText((backend as any)?.requestId, 200);
            const backendJobId = cleanText((backend as any)?.jobId, 200);
            const timeoutReason = cleanText((backendDebug as any)?.timeoutReason, 120);
            const backendMachineId = cleanText((backendDebug as any)?.machine?.id, 120);
            const machineState = cleanText((backendDebug as any)?.machine?.state, 120);
            const machineRestartCount = cleanNumber((backendDebug as any)?.machine?.restartCount);
            const compileSummary = cleanText((backendDebug as any)?.compile?.summary, 300);
            const rootfsIoCorruption =
                typeof (backendDebug as any)?.storage?.rootfsIoCorruption === "boolean"
                    ? (backendDebug as any).storage.rootfsIoCorruption
                    : undefined;

            // A free-tier request is intentionally stopped before scan work begins.
            // Treat this as an upgrade prompt, never as a capture failure alert.
            if (/EARLY_GENERATION_PAYWALL_REQUIRED|Start your free trial before (?:scanning|generating)|Please upgrade before scanning/i.test(`${code} ${backendCode} ${message} ${backendMessage}`)) {
                return NextResponse.json({ ok: true, suppressed: true, reason: "plan_restriction" });
            }

            const requestContext = {
                callerType: "frontend-browser",
                userAgent: requestUserAgent || undefined,
                origin: origin || undefined,
                referer: referer || undefined,
                clientIp: clientIp || undefined,
                hasSession: true,
                hasBearer: Boolean(authedReq.headers.get("authorization")),
            };

            let classification: string | undefined;
            const editorFailure = action === "url_editor_navigation_error" || /^EDITOR_/.test(code) || /Opening your editor timed out after 5 minutes/i.test(message);
            if (action === "url_capture_terminal_error" || action === "url_capture_stale" || editorFailure) {
                const scanAlert = classifyScanAlert({ code: editorFailure ? code : backendCode || code, message: editorFailure ? message : backendMessage || message, statusCode, backendStatus });
                severity = scanAlert.severity;
                statusCode = scanAlert.statusCode;
                classification = scanAlert.classification;
            }

            const previewTimeout = statusCode === 504 && /preview|iframe|poll_timeout/i.test(`${action} ${reason} ${status}`);
            if (previewTimeout) {
                severity = "error";
                classification = "preview_connection_timeout";
            }

            const enrichedMessage = [
                previewTimeout ? "A user could not open their preview before the connection timed out." : editorFailure ? message.replace(/^URL capture failed for /, "Editor opening failed for ") : message,
                action === "url_capture_stalled" && typeof ageMs === "number"
                    ? `elapsed=${Math.round(ageMs / 1000)}s`
                    : "",
                action.startsWith("url_capture") && backendStatus
                    ? `backendStatus=${backendStatus}`
                    : "",
            ]
                .filter(Boolean)
                .join(" | ");

            await captureCriticalEvent({
                source: "frontend",
                severity,
                statusCode,
                route,
                method: "POST",
                action: editorFailure ? "url_editor_navigation_error" : action,
                userId: uid,
                requestId: requestId || backendRequestId || undefined,
                message: enrichedMessage,
                service,
                tags,
                url: previewUrl || undefined,
                extra: {
                    appId: appId || undefined,
                    code: code || undefined,
                    classification,
                    ...(previewTimeout ? { diagnosticMessage: message } : {}),
                    status,
                    browser: browser || undefined,
                    reason: reason || undefined,
                    userAgent: payloadUserAgent || undefined,
                    ageMs: typeof ageMs === "number" ? ageMs : undefined,
                    elapsedMs: typeof elapsedMs === "number" ? elapsedMs : undefined,
                    requestId: requestId || undefined,
                    jobId: jobId || undefined,
                    backendStatus: backendStatus || undefined,
                    uiCode: editorFailure ? code || undefined : undefined,
                    uiMessage: editorFailure ? message : undefined,
                    backendCode: editorFailure ? undefined : backendCode || code || undefined,
                    backendMessage: editorFailure ? undefined : backendMessage || undefined,
                    backendRequestId: backendRequestId || requestId || undefined,
                    backendJobId: backendJobId || jobId || undefined,
                    requestContext,
                    browserFindings,
                    debugDetails: browserFindingsDebug ? `Browser findings: ${JSON.stringify(browserFindingsDebug)}` : undefined,
                    alertKey: alertKey || undefined,
                    deduped,
                    backend: {
                        status: backendStatus || undefined,
                        uiStage: backendUiStage || undefined,
                        debug: {
                            timeoutReason: timeoutReason || undefined,
                            machine: {
                                id: backendMachineId || machineId || undefined,
                                state: machineState || undefined,
                                restartCount: typeof machineRestartCount === "number" ? machineRestartCount : undefined,
                            },
                            compile: {
                                summary: compileSummary || undefined,
                            },
                            storage: {
                                rootfsIoCorruption,
                            },
                        },
                    },
                },
            });

            return NextResponse.json({ ok: true });
        },
        { csrf: true, methods: ["POST"] },
    );
}
