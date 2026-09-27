import { getAdminAuth } from "./auth";

function clean(value: unknown, max = 500): string {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function getClientIp(req: { headers: Headers }): string {
    const headers = req.headers;
    const forwarded = headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim();
    return clean(
        forwarded || headers?.get?.("cf-connecting-ip") || headers?.get?.("x-real-ip") || "unknown",
        120,
    );
}

function getHostname(rawUrl: string): string {
    try {
        return new URL(rawUrl).hostname;
    } catch {
        return clean(rawUrl, 200);
    }
}

const ADULT_URL_RE = /(?:adult|blowjob|boob|bukkake|camgirl|camsex|chaturbate|creampie|dildo|escort|fetish|fisting|gangbang|handjob|hardcore|hentai|hookup|horny|masturbat|milf|nsfw|nude|nudes|onlyfans|p0rn|penis|porn|pussy|redtube|rule34|semen|sexcam|sexchat|sexdating|sextoy|sexual|shemale|slut|smut|stripchat|stripper|threesome|voyeur|whore|xhamster|xnxx|xvideo|xxx|youporn)/i;

export function isAdultBlockedUrl(rawUrl: string): boolean {
    const value = clean(rawUrl, 2083);
    if (!value) return false;
    try {
        const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        return ADULT_URL_RE.test([parsed.hostname, parsed.pathname, parsed.search, parsed.hash].join(" "));
    } catch {
        return ADULT_URL_RE.test(value);
    }
}

function getSlackWebhookUrl(): string {
    return (
        process.env.ABUSE_SLACK_WEBHOOK_URL ||
        process.env.SLACK_ERROR_WEBHOOK_URL ||
        process.env.SLACK_WEBHOOK_URL ||
        ""
    ).trim();
}

export async function disableUserForBlockedUrl(params: {
    uid: string;
    url: string;
    ip: string;
    route: string;
    requestId?: string | null;
}): Promise<{ disabled: boolean; slackSent: boolean }> {
    const uid = clean(params.uid, 160);
    const ip = clean(params.ip, 120) || "unknown";
    const hostname = getHostname(params.url);
    let disabled = false;

    try {
        await getAdminAuth().updateUser(uid, { disabled: true });
        disabled = true;
    } catch (error) {
        console.error("[blocked-url-abuse] failed to disable user", {
            uid,
            error: error instanceof Error ? error.message : String(error),
        });
    }

    const webhookUrl = getSlackWebhookUrl();
    if (!webhookUrl) {
        console.error("[blocked-url-abuse] Slack webhook is not configured", { uid, hostname, ip });
        return { disabled, slackSent: false };
    }

    const text = [
        `:rotating_light: *Blocked adult URL — account ${disabled ? "disabled" : "disable FAILED"}*`,
        `UID: \`${uid || "unknown"}\``,
        `IP: \`${ip}\``,
        `Domain: \`${hostname}\``,
        `Route: \`${clean(params.route, 200) || "unknown"}\``,
        `Request ID: \`${clean(params.requestId, 200) || "unknown"}\``,
        `Time: ${new Date().toISOString()}`,
    ].join("\n");

    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                text,
                username: "Kloner Abuse Guard",
                icon_emoji: ":rotating_light:",
                unfurl_links: false,
                unfurl_media: false,
            }),
        });
        if (!response.ok) throw new Error(`Slack webhook failed (${response.status})`);
        return { disabled, slackSent: true };
    } catch (error) {
        console.error("[blocked-url-abuse] failed to notify Slack", {
            uid,
            hostname,
            ip,
            error: error instanceof Error ? error.message : String(error),
        });
        return { disabled, slackSent: false };
    }
}
