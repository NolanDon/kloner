import "server-only";

function normalizeEmail(email: string | null | undefined): string {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function normalizeIp(ip: string | null | undefined): string {
    return typeof ip === "string" ? ip.trim() : "";
}

function parseList(raw: string | undefined | null): string[] {
    const source = typeof raw === "string" ? raw : "";
    if (!source.trim()) return [];

    return source
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean);
}

function getBlockedEmails(): string[] {
    return parseList(process.env.SIGNUP_BLOCKED_EMAILS).map((value) => normalizeEmail(value));
}

function getBlockedIps(): string[] {
    return parseList(process.env.SIGNUP_BLOCKED_IPS).map((value) => normalizeIp(value));
}

export function isBlockedSignupEmail(email: string | null | undefined): boolean {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;

    return getBlockedEmails().includes(normalized);
}

export function isBlockedSignupIp(ip: string | null | undefined): boolean {
    const normalized = normalizeIp(ip);
    if (!normalized) return false;

    return getBlockedIps().includes(normalized);
}

export function getSignupBlockDecision(input: { email?: string | null; ip?: string | null }): {
    blocked: boolean;
    reason: string | null;
    matchedBy: "email" | "ip" | null;
} {
    if (isBlockedSignupEmail(input.email)) {
        return {
            blocked: true,
            reason: "Unable to create an account right now.",
            matchedBy: "email",
        };
    }

    if (isBlockedSignupIp(input.ip)) {
        return {
            blocked: true,
            reason: "Unable to create an account right now.",
            matchedBy: "ip",
        };
    }

    return {
        blocked: false,
        reason: null,
        matchedBy: null,
    };
}
