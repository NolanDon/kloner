import { createHash } from "crypto";
import { getAdminDb } from "@/app/api/_lib/auth";

export type ObservabilitySeverity = "critical" | "error" | "warning" | "info";

type ExtraData = Record<string, unknown>;

export type ObservabilityEvent = {
    source: "vercel" | "fly" | "frontend" | "internal";
    severity: ObservabilitySeverity;
    alwaysNotifySlack?: boolean;
    statusCode?: number;
    route?: string;
    method?: string;
    page?: string;
    action?: string;
    userId?: string;
    requestId?: string;
    message: string;
    errorName?: string;
    stack?: string;
    url?: string;
    environment?: string;
    service?: string;
    tags?: string[];
    extra?: ExtraData;
    occurredAt?: string;
};

type StoredEvent = ObservabilityEvent & {
    createdAt: Date;
    fingerprint: string;
};

const MAX_STACK_CHARS = 12000;
const MAX_MESSAGE_CHARS = 1000;
const MAX_TEXT_CHARS = 2800;
const MAX_STACK_BLOCK_CHARS = 2400;
const MAX_SLACK_CONTEXT_FIELDS = 4;
const FRONTEND_LABEL = "[FRONTEND]";
const PROXY_LABEL = "[PROXY]";

function isFrontendOrigin(event: Pick<ObservabilityEvent, "source" | "extra">): boolean {
    if (event.source === "frontend") return true;
    const requestContext = (event.extra as Record<string, unknown> | undefined)?.requestContext as
        | Record<string, unknown>
        | undefined;
    return String(requestContext?.callerType || "").trim().toLowerCase() === "frontend-browser";
}

function isProxyOrigin(event: Pick<ObservabilityEvent, "route" | "service" | "source" | "extra">): boolean {
    const route = String(event.route || "").trim().toLowerCase();
    const service = String(event.service || "").trim().toLowerCase();
    if (service.includes("url-generate-proxy")) return true;
    if (service.endsWith("-proxy")) return true;
    if (route === "/api/private/generate") return true;
    return false;
}

function getAlertLabel(event: Pick<ObservabilityEvent, "route" | "service" | "source" | "extra">): string {
    if (isFrontendOrigin(event)) return FRONTEND_LABEL;
    if (isProxyOrigin(event)) return PROXY_LABEL;
    return "";
}

function withAlertLabel(event: Pick<ObservabilityEvent, "route" | "service" | "source" | "extra">, text: string): string {
    const label = getAlertLabel(event);
    if (!label) return text;
    const trimmed = text.trim();
    if (!trimmed) return label;
    if (trimmed.startsWith(label)) return trimmed;
    return `${label} ${trimmed}`;
}

function envName() {
    return process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
}

function getSlackWebhookUrl() {
    return (
        process.env.SLACK_ERROR_WEBHOOK_URL ||
        process.env.SLACK_WEBHOOK_URL ||
        ""
    ).trim();
}

function getSlackChannel() {
    return (process.env.SLACK_ERROR_CHANNEL || "").trim();
}

function getProjectLabel() {
    return (process.env.OBS_PROJECT_NAME || "kloner").trim();
}

function buildSlackDedupeId(event: Pick<StoredEvent, "source" | "action" | "statusCode" | "userId" | "url" | "page" | "message" | "errorName">): string {
    const material = [
        event.source,
        event.action || "",
        event.statusCode || "",
        event.userId || "",
        event.url || event.page || "",
        event.errorName || "",
        event.message || "",
    ].join("|").toLowerCase();

    return createHash("sha256").update(material).digest("hex");
}

function shouldCaptureEvent(event: ObservabilityEvent): boolean {
    if (event.severity === "critical") return true;
    if (typeof event.statusCode === "number" && event.statusCode >= 500) return true;
    if (typeof event.statusCode === "number" && event.statusCode >= 400 && event.severity === "error") return true;
    return false;
}

function severityEmoji(severity: ObservabilitySeverity): string {
    switch (severity) {
        case "critical":
            return ":rotating_light:";
        case "error":
            return ":x:";
        case "warning":
            return ":warning:";
        default:
            return ":information_source:";
    }
}

function truncate(text: string, limit: number): string {
    if (!text) return "";
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function asOneLine(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.replace(/\s+/g, " ").trim();
}

function normalizeMultiline(value: unknown): string {
    if (typeof value !== "string") return "";
    return value
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function chunkString(text: string, chunkSize: number): string[] {
    if (!text) return [];
    if (text.length <= chunkSize) return [text];

    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.slice(i, i + chunkSize));
        i += chunkSize;
    }
    return chunks;
}

function parseCsvSet(raw: string | undefined): Set<string> {
    const out = new Set<string>();
    if (!raw) return out;
    for (const part of raw.split(",")) {
        const v = part.trim();
        if (v) out.add(v);
    }
    return out;
}

function parseCsvList(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
}

function isLocalhostUrl(rawUrl?: string): boolean {
    if (!rawUrl) return false;
    try {
        const u = new URL(rawUrl);
        const host = u.hostname.toLowerCase();
        return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
    } catch {
        return /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(rawUrl);
    }
}

function shouldSuppressLocalhostSlackWebhook(): boolean {
    const raw = (process.env.OBS_SUPPRESS_LOCALHOST_SLACK || "").trim().toLowerCase();
    if (raw === "1" || raw === "true" || raw === "yes") return true;
    if (raw === "0" || raw === "false" || raw === "no") return false;

    // Default to surfacing localhost alerts in development so local 5xx failures
    // still exercise the Slack path during testing.
    return process.env.NODE_ENV === "production";
}

function shouldSuppressSlackWebhook(event: StoredEvent): boolean {
    if (event.alwaysNotifySlack) return false;

    if (isLocalhostUrl(event.url) && shouldSuppressLocalhostSlackWebhook()) return true;

    const action = String(event.action || "").toLowerCase();
    const message = String(event.message || "").toLowerCase();
    const tags = Array.isArray(event.tags)
        ? event.tags.map((t) => String(t || "").toLowerCase())
        : [];

    const isLoadingIssue =
        action.includes("preview") ||
        action.includes("iframe") ||
        action.includes("timeout") ||
        message.includes("preview") ||
        message.includes("iframe") ||
        tags.includes("preview") ||
        tags.includes("timeout") ||
        tags.includes("frontend");

    const isUrlScanBackendFailure =
        action.includes("url_scan_failed") ||
        String(event.route || "").includes("/api/private/generate") ||
        String(event.service || "").toLowerCase().includes("url-generate-proxy") ||
        tags.includes("url-scan") ||
        tags.includes("generate") ||
        tags.includes("backend-failure");

    if (isUrlScanBackendFailure) return false;

    // Loading incidents should always reach Slack, even for internally suppressed users.
    if (isLoadingIssue) return false;

    const suppressedUserIds = parseCsvSet(process.env.OBS_SUPPRESS_SLACK_USER_IDS);
    // Backward compatible default for the primary owner UID prefix requested in ops.
    const suppressedUserPrefixes = [
        "FJPV",
        ...parseCsvList(process.env.OBS_SUPPRESS_SLACK_USER_PREFIXES),
    ];

    const userId = (event.userId || "").trim();
    if (userId && suppressedUserIds.has(userId)) return true;
    if (userId && suppressedUserPrefixes.some((prefix) => userId.startsWith(prefix))) return true;

    return false;
}

function toIsoDate(value?: string): string {
    if (!value) return new Date().toISOString();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
    return parsed.toISOString();
}

function buildDashboardUrl(eventId: string): string {
    const base = (process.env.OBS_DASHBOARD_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
    if (!base) return "";
    return `${base}/dashboard/observability?event=${encodeURIComponent(eventId)}`;
}

function cleanContextValue(value: unknown, max = 200): string {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "";
    const trimmed = String(value).trim();
    if (!trimmed) return "";
    return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function shouldIncludeVerboseSlackDetails(): boolean {
    const raw = (process.env.OBS_SLACK_VERBOSE_DETAILS || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
}

function compactExtraSummary(extra: ExtraData, eventUrl?: string): Array<[string, string]> {
    return [
        ["Caller", cleanContextValue((extra as any).callerType || (extra as any).caller || (extra as any).requestContext?.callerType, 80)],
        ["Job", cleanContextValue((extra as any).jobId || (extra as any).job || (extra as any).requestContext?.jobId, 120)],
        ["Machine", cleanContextValue((extra as any).machineId || (extra as any).backend?.debug?.machine?.id || (extra as any).backend?.machineId, 120)],
        ["URL", cleanContextValue((extra as any).url || eventUrl || (extra as any).requestContext?.url, 220)],
    ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;
}

function urlScanExtraSummary(extra: ExtraData, eventUrl?: string): Array<[string, string]> {
    return [
        ["Backend status", cleanContextValue((extra as any).backendStatus ?? (extra as any).upstreamStatus ?? (extra as any).statusCode, 80)],
        ["Backend code", cleanContextValue((extra as any).backendCode ?? (extra as any).upstreamCode ?? (extra as any).responseCode ?? (extra as any).code, 120)],
        ["Backend req", cleanContextValue((extra as any).backendRequestId ?? (extra as any).upstreamRequestId ?? (extra as any).reqId, 120)],
        ["Backend source", cleanContextValue((extra as any).backendSource ?? (extra as any).upstreamSource ?? (extra as any).service, 120)],
        ["Backend reason", cleanContextValue((extra as any).backendMessage ?? (extra as any).upstreamMessage ?? (extra as any).responseError ?? (extra as any).reason ?? (extra as any).message, 220)],
        ["URL", cleanContextValue((extra as any).url || eventUrl || (extra as any).requestContext?.url, 220)],
    ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;
}

function shouldUseUrlScanSummary(event: Pick<StoredEvent, "route" | "service" | "action" | "tags">): boolean {
    const route = String(event.route || "").toLowerCase();
    const service = String(event.service || "").toLowerCase();
    const action = String(event.action || "").toLowerCase();
    const tags = Array.isArray(event.tags) ? event.tags.map((tag) => String(tag || "").toLowerCase()) : [];
    return (
        action.includes("url_scan_failed") ||
        route === "/api/private/generate" ||
        service.includes("url-generate-proxy") ||
        tags.includes("url-scan") ||
        tags.includes("backend-failure")
    );
}

function toSlackBlocks(event: StoredEvent, eventId: string) {
    const route = event.route || event.page || "n/a";
    const user = event.userId || "anonymous";
    const reqId = event.requestId || "n/a";
    const status = typeof event.statusCode === "number" ? String(event.statusCode) : "n/a";
    const env = event.environment || envName();
    const title = withAlertLabel(
        event,
        `${severityEmoji(event.severity)} ${getProjectLabel()} ${event.severity.toUpperCase()}${event.statusCode ? ` (${event.statusCode})` : ""}`,
    );
    const details = [
        `*Source:* ${event.source}`,
        `*Route/Page:* ${route}`,
        `*Action:* ${event.action || "n/a"}`,
        `*Method:* ${event.method || "n/a"}`,
        `*Status:* ${status}`,
        `*User:* ${user}`,
        `*Req ID:* ${reqId}`,
        `*Env:* ${env}`,
        `*Service:* ${event.service || "n/a"}`,
        `*Time:* ${event.occurredAt}`,
    ].join("\n");

    const extra = (event.extra && typeof event.extra === "object") ? event.extra : {};
    const verboseSlackDetails = shouldIncludeVerboseSlackDetails();
    const contextFields = verboseSlackDetails
        ? [
            ["Caller", cleanContextValue((extra as any).callerType || (extra as any).caller || (extra as any).requestContext?.callerType, 80)],
            ["IP", cleanContextValue((extra as any).ip || (extra as any).clientIp || (extra as any).requestContext?.ip, 80)],
            ["Browser", cleanContextValue((extra as any).browser || (extra as any).requestContext?.browser, 80)],
            ["UA", cleanContextValue((extra as any).userAgent || (extra as any).ua || (extra as any).requestContext?.userAgent, 220)],
            ["Origin", cleanContextValue((extra as any).origin || (extra as any).requestContext?.origin, 220)],
            ["Referer", cleanContextValue((extra as any).referer || (extra as any).requestContext?.referer, 220)],
            ["Has session", typeof (extra as any).hasSession === "boolean" ? String((extra as any).hasSession) : typeof (extra as any).hasSessionSignals === "boolean" ? String((extra as any).hasSessionSignals) : ""],
            ["Job", cleanContextValue((extra as any).jobId || (extra as any).job || (extra as any).requestContext?.jobId, 120)],
            ["Machine", cleanContextValue((extra as any).machineId || (extra as any).backend?.debug?.machine?.id || (extra as any).backend?.machineId, 120)],
        ].filter(([, value]) => Boolean(value)) as Array<[string, string]>
        : (shouldUseUrlScanSummary(event)
            ? urlScanExtraSummary(extra, event.url)
            : compactExtraSummary(extra, event.url)
        ).slice(0, MAX_SLACK_CONTEXT_FIELDS);

    const contextBlock = contextFields.length
        ? [
            "*Request Context:*",
            ...contextFields.map(([label, value]) => `${label}: ${value}`),
        ].join("\n")
        : "";

    const stack = truncate(normalizeMultiline(event.stack), MAX_STACK_CHARS);
    const message = truncate(asOneLine(withAlertLabel(event, event.message)), MAX_MESSAGE_CHARS);
    const dashboardUrl = buildDashboardUrl(eventId);

    const blocks: any[] = [
        {
            type: "header",
            text: {
                type: "plain_text",
                text: truncate(title, 140),
                emoji: true,
            },
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: truncate(`*Message:* ${message}`, MAX_TEXT_CHARS),
            },
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: truncate(details, MAX_TEXT_CHARS),
            },
        },
    ];

    if (contextBlock) {
        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: truncate(contextBlock, MAX_TEXT_CHARS),
            },
        });
    }

    if (event.url && verboseSlackDetails) {
        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: truncate(`*URL:* ${event.url}`, MAX_TEXT_CHARS),
            },
        });
    }

    if (stack && verboseSlackDetails) {
        const stackChunks = chunkString(stack, MAX_STACK_BLOCK_CHARS);
        stackChunks.forEach((part, index) => {
            const label = stackChunks.length > 1 ? `*Stack (${index + 1}/${stackChunks.length}):*` : "*Stack:*";
            blocks.push({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: truncate(`${label}\n\`\`\`${part}\`\`\``, MAX_TEXT_CHARS),
                },
            });
        });
    }

    if (event.extra && Object.keys(event.extra).length > 0 && verboseSlackDetails) {
        let debugJson = "";
        try {
            debugJson = JSON.stringify(event.extra, null, 2);
        } catch {
            debugJson = String(event.extra);
        }

        if (debugJson) {
            blocks.push({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: truncate(`*Debug:*\n\`\`\`${debugJson}\`\`\``, MAX_TEXT_CHARS),
                },
            });
        }
    }

    const links: string[] = [];
    if (dashboardUrl) {
        links.push(`<${dashboardUrl}|Open in dashboard>`);
    }

    if (links.length) {
        blocks.push({
            type: "actions",
            elements: links.map((link) => ({
                type: "button",
                text: {
                    type: "plain_text",
                    text: "View Event",
                    emoji: true,
                },
                url: link.match(/<(.*?)\|/)?.[1] || "",
            })),
        });
    }

    return blocks;
}

async function postToSlack(event: StoredEvent, eventId: string) {
    const webhookUrl = getSlackWebhookUrl();
    if (!webhookUrl) return;
    if (shouldSuppressSlackWebhook(event)) return;

    const body: Record<string, unknown> = {
        text: withAlertLabel(event, `${event.severity.toUpperCase()}${typeof event.statusCode === "number" ? ` (${event.statusCode})` : ""} ${event.message}`),
        blocks: toSlackBlocks(event, eventId),
        unfurl_links: false,
        unfurl_media: false,
    };

    const channel = getSlackChannel();
    if (channel) {
        body.channel = channel;
    }

    const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Slack webhook failed (${res.status}): ${text || "unknown"}`);
    }
}

async function storeEvent(event: StoredEvent): Promise<string> {
    const db = getAdminDb();
    const ref = db.collection("observability_events").doc();

    const sanitizeForFirestore = (value: any): any => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        if (value instanceof Date) return value;

        if (Array.isArray(value)) {
            return value
                .map((item) => sanitizeForFirestore(item))
                .filter((item) => item !== undefined);
        }

        if (typeof value === "object") {
            const cleaned: Record<string, unknown> = {};
            for (const [key, entry] of Object.entries(value)) {
                const next = sanitizeForFirestore(entry);
                if (next !== undefined) cleaned[key] = next;
            }
            return cleaned;
        }

        return value;
    };

    const payload = sanitizeForFirestore({
        ...event,
        tags: event.tags || [],
        extra: event.extra || {},
    });

    await ref.set(payload);
    return ref.id;
}

function sanitizeEvent(event: ObservabilityEvent): StoredEvent {
    return {
        ...event,
        message: truncate(asOneLine(event.message || "Unknown error"), MAX_MESSAGE_CHARS),
        stack: truncate(normalizeMultiline(event.stack || ""), MAX_STACK_CHARS),
        occurredAt: toIsoDate(event.occurredAt),
        environment: event.environment || envName(),
        service: event.service || "app",
        createdAt: new Date(),
        fingerprint: buildSlackDedupeId({
            source: event.source,
            action: event.action,
            statusCode: event.statusCode,
            userId: event.userId,
            url: event.url,
            page: event.page || event.route,
            message: truncate(asOneLine(event.message || ""), 160),
            errorName: event.errorName,
        }),
    };
}

async function reserveSlackDedupe(event: StoredEvent): Promise<boolean> {
    const db = getAdminDb();
    const ref = db.collection("observability_slack_dedupe").doc(event.fingerprint);

    try {
        await ref.create({
            fingerprint: event.fingerprint,
            createdAt: new Date(),
            source: event.source,
            action: event.action || null,
            statusCode: typeof event.statusCode === "number" ? event.statusCode : null,
            userId: event.userId || null,
            url: event.url || event.page || null,
            message: event.message || null,
        });
        return true;
    } catch (err: any) {
        const code = String(err?.code || err?.errorInfo?.code || "");
        const message = String(err?.message || "").toLowerCase();
        if (code === "6" || code === "already-exists" || message.includes("already exists")) {
            return false;
        }
        throw err;
    }
}

export async function captureCriticalEvent(event: ObservabilityEvent) {
    const normalized = sanitizeEvent(event);
    if (!shouldCaptureEvent(normalized)) return { delivered: false, reason: "below_threshold" as const };

    try {
        const shouldSendSlack = await reserveSlackDedupe(normalized);
        if (!shouldSendSlack) {
            return { delivered: false as const, reason: "duplicate" as const };
        }

        const eventId = await storeEvent(normalized);
        await postToSlack(normalized, eventId);
        return { delivered: true as const, eventId };
    } catch (err) {
        console.error("[observability] failed to capture event", {
            message: normalized.message,
            source: normalized.source,
            route: normalized.route,
            statusCode: normalized.statusCode,
            error: err instanceof Error ? err.message : String(err),
        });
        return { delivered: false as const, reason: "capture_failed" as const };
    }
}

export async function captureAuditEvent(event: ObservabilityEvent) {
    const normalized = sanitizeEvent({
        ...event,
        severity: event.severity || "info",
    });

    try {
        const eventId = await storeEvent(normalized);
        await postToSlack(normalized, eventId);
        return { delivered: true as const, eventId };
    } catch (err) {
        console.error("[observability] failed to capture audit event", {
            message: normalized.message,
            source: normalized.source,
            route: normalized.route,
            statusCode: normalized.statusCode,
            error: err instanceof Error ? err.message : String(err),
        });
        return { delivered: false as const, reason: "capture_failed" as const };
    }
}

export async function captureException(params: {
    source: ObservabilityEvent["source"];
    error: unknown;
    route?: string;
    page?: string;
    action?: string;
    userId?: string;
    requestId?: string;
    method?: string;
    statusCode?: number;
    url?: string;
    service?: string;
    extra?: ExtraData;
}) {
    const err = params.error instanceof Error ? params.error : new Error(String(params.error || "Unknown error"));
    const status = params.statusCode || 500;
    const severity: ObservabilitySeverity = status >= 500 ? "critical" : "error";

    return captureCriticalEvent({
        source: params.source,
        severity,
        statusCode: status,
        route: params.route,
        page: params.page,
        action: params.action,
        userId: params.userId,
        requestId: params.requestId,
        method: params.method,
        message: err.message || "Unhandled exception",
        errorName: err.name,
        stack: err.stack,
        url: params.url,
        service: params.service,
        extra: params.extra,
    });
}
