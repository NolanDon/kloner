import "server-only";

export const SIGNUP_BLOCKED_EMAIL_SUBSTRINGS = ["lulavcstreaming"] as const;
export const SIGNUP_BLOCKED_IPS = ["179.251.112.179"] as const;

function normalizeEmail(email: string | null | undefined): string {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function normalizeIp(ip: string | null | undefined): string {
    return typeof ip === "string" ? ip.trim() : "";
}

export function isBlockedSignupEmail(email: string | null | undefined): boolean {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    return SIGNUP_BLOCKED_EMAIL_SUBSTRINGS.some((needle) => normalized.includes(needle));
}

export function isBlockedSignupIp(ip: string | null | undefined): boolean {
    const normalized = normalizeIp(ip);
    if (!normalized) return false;
    return SIGNUP_BLOCKED_IPS.includes(normalized as (typeof SIGNUP_BLOCKED_IPS)[number]);
}

export function getSignupBlockDecision(input: { email?: string | null; ip?: string | null }): {
    blocked: boolean;
    reason: string | null;
    matchedBy: "email" | "ip" | null;
} {
    if (isBlockedSignupEmail(input.email)) {
        return {
            blocked: true,
            reason: "This signup is blocked.",
            matchedBy: "email",
        };
    }

    if (isBlockedSignupIp(input.ip)) {
        return {
            blocked: true,
            reason: "This signup is blocked.",
            matchedBy: "ip",
        };
    }

    return {
        blocked: false,
        reason: null,
        matchedBy: null,
    };
}