import { getAdminDb } from "@/app/api/_lib/auth";

export type ObservabilitySeverity = "critical" | "error" | "warning" | "info";

type ExtraData = Record<string, unknown>;

export type ObservabilityEvent = {
    source: "vercel" | "fly" | "frontend" | "internal";
    severity: ObservabilitySeverity;
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

function shouldSuppressSlackWebhook(event: StoredEvent): boolean {
    if (isLocalhostUrl(event.url)) return true;

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

function toSlackBlocks(event: StoredEvent, eventId: string) {
    const route = event.route || event.page || "n/a";
    const user = event.userId || "anonymous";
    const reqId = event.requestId || "n/a";
    const status = typeof event.statusCode === "number" ? String(event.statusCode) : "n/a";
    const env = event.environment || envName();
    const title = `${severityEmoji(event.severity)} ${getProjectLabel()} ${event.severity.toUpperCase()}${event.statusCode ? ` (${event.statusCode})` : ""}`;
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

    const stack = truncate(normalizeMultiline(event.stack), MAX_STACK_CHARS);
    const message = truncate(asOneLine(event.message), MAX_MESSAGE_CHARS);
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

    if (event.url) {
        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: truncate(`*URL:* ${event.url}`, MAX_TEXT_CHARS),
            },
        });
    }

    if (stack) {
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

    if (event.extra && Object.keys(event.extra).length > 0) {
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
        text: `${event.severity.toUpperCase()} ${event.message}`,
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
        fingerprint: [
            event.source,
            event.route || event.page || "",
            event.action || "",
            event.statusCode || "",
            event.errorName || "",
            truncate(asOneLine(event.message || ""), 120),
        ]
            .join("|")
            .toLowerCase(),
    };
}

export async function captureCriticalEvent(event: ObservabilityEvent) {
    const normalized = sanitizeEvent(event);
    if (!shouldCaptureEvent(normalized)) return { delivered: false, reason: "below_threshold" as const };

    try {
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
