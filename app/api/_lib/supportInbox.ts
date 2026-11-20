// app/api/_lib/supportInbox.ts
// Pure helpers for the admin support inbox (Resend inbound email).
// No I/O here: signature checks, address/subject parsing and threading
// helpers only, so everything in this file is unit-testable.
import crypto from "node:crypto";

export const SUPPORT_EMAIL = "support@kloner.app";
export const SUPPORT_FROM = "Kloner Support <support@kloner.app>";
export const FORWARD_FROM = "Kloner Forward <hello@kloner.app>";
export const FORWARD_TO_EMAIL = "nolan.donb@gmail.com";

/** Shape of a received email as returned by GET /emails/receiving/{id}. */
export type ReceivedEmail = {
    id: string;
    from: string;
    to: string[];
    subject: string;
    text?: string | null;
    html?: string | null;
    message_id?: string | null;
    headers?: Record<string, string> | null;
    attachments?:
        | Array<{
              id?: string;
              filename?: string;
              content_type?: string;
              size?: number;
          }>
        | null;
    created_at?: string | null;
};

/**
 * Verify a Svix signature (Resend signs webhooks through Svix).
 * The signed content is "{svix-id}.{svix-timestamp}.{raw body}" and the
 * key is the base64 part of the "whsec_..." signing secret.
 */
export function verifySvixSignature(args: {
    secret: string;
    msgId: string;
    timestamp: string;
    signatureHeader: string;
    body: string;
    nowSeconds?: number;
    toleranceSeconds?: number;
}): boolean {
    const { secret, msgId, timestamp, signatureHeader, body } = args;
    if (!secret || !msgId || !timestamp || !signatureHeader) return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
    const tolerance = args.toleranceSeconds ?? 300;
    if (Math.abs(now - ts) > tolerance) return false;

    const secretB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
    let key: Buffer;
    try {
        key = Buffer.from(secretB64, "base64");
    } catch {
        return false;
    }
    if (!key.length) return false;

    const expected = crypto
        .createHmac("sha256", key)
        .update(`${msgId}.${timestamp}.${body}`)
        .digest();

    for (const part of signatureHeader.split(" ")) {
        const comma = part.indexOf(",");
        if (comma < 0) continue;
        const version = part.slice(0, comma);
        const sig = part.slice(comma + 1);
        if (version !== "v1" || !sig) continue;
        let actual: Buffer;
        try {
            actual = Buffer.from(sig, "base64");
        } catch {
            continue;
        }
        if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) {
            return true;
        }
    }
    return false;
}

/** Parse "Jane Doe <jane@example.com>" or a bare address. */
export function parseEmailAddress(raw: string): { email: string; name: string | null } {
    const value = (raw || "").trim();
    const match = value.match(/^(.*?)<([^>]+)>\s*$/);
    if (match) {
        const name = match[1].trim().replace(/^"|"$/g, "") || null;
        return { email: match[2].trim().toLowerCase(), name };
    }
    return { email: value.toLowerCase(), name: null };
}

export function recipientsIncludeSupport(to: string[] | string | null | undefined): boolean {
    const list = Array.isArray(to) ? to : to ? [to] : [];
    return list.some((entry) => parseEmailAddress(entry).email === SUPPORT_EMAIL);
}

/** Strip any run of Re:/Fwd:/Fw: prefixes so threads group by their root subject. */
export function normalizeSubject(subject: string | null | undefined): string {
    let out = (subject || "").trim();
    while (/^(re|fwd|fw)\s*:\s*/i.test(out)) {
        out = out.replace(/^(re|fwd|fw)\s*:\s*/i, "").trim();
    }
    return out || "(no subject)";
}

export function replySubject(subject: string | null | undefined): string {
    return `Re: ${normalizeSubject(subject)}`;
}

/** Message-IDs are compared in their bracketed form: "<abc@host>". */
export function normalizeMessageId(id: string): string {
    const trimmed = id.trim();
    if (!trimmed) return trimmed;
    return trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
}

/**
 * Every Message-ID referenced by the In-Reply-To and References headers,
 * bracketed and de-duplicated, in header order.
 */
export function extractReferencedMessageIds(
    headers: Record<string, string> | null | undefined
): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    if (!headers || typeof headers !== "object") return ids;
    for (const [key, value] of Object.entries(headers)) {
        const name = key.toLowerCase();
        if (name !== "in-reply-to" && name !== "references") continue;
        if (typeof value !== "string") continue;
        for (const match of value.matchAll(/<[^>]+>/g)) {
            const id = match[0];
            if (!seen.has(id)) {
                seen.add(id);
                ids.push(id);
            }
        }
    }
    return ids;
}

export function makeSnippet(text: string | null | undefined, max = 140): string {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= max) return clean;
    return `${clean.slice(0, max - 1)}…`;
}
