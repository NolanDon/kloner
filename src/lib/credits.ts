// src/lib/credits.ts

export type UserTier = "free" | "pro" | "agency" | "enterprise" | "unknown";
export type CreditKind = "screenshot" | "preview";

export const CREDIT_LIMITS: Record<UserTier, { screenshotDaily: number; previewDaily: number }> = {
    free: {
        // Enough to try the flow without giving away serious usage
        screenshotDaily: 3,
        previewDaily: 3,
    },
    pro: {
        // ~1200 screenshots + ~600 previews per month at max usage
        screenshotDaily: 40,
        previewDaily: 20,
    },
    agency: {
        // Higher-volume clients, but still finite
        // ~4500 screenshots + ~2250 previews per month
        screenshotDaily: 150,
        previewDaily: 75,
    },
    // 0 here means “unlimited” in canConsumeCredit
    enterprise: {
        screenshotDaily: 0,
        previewDaily: 0,
    },
    unknown: {
        screenshotDaily: 0,
        previewDaily: 0,
    },
};

type Claims = { userTier?: unknown } | null | undefined;

export function tierFromClaims(claims: Claims): UserTier {
    if (!claims || typeof claims.userTier !== "string") return "free";

    const raw = claims.userTier.toLowerCase();

    if (raw === "free") return "free";
    if (raw === "pro") return "pro";
    if (raw === "agency") return "agency";
    if (raw === "enterprise") return "enterprise";

    return "unknown";
}

export function canConsumeCredit(tier: UserTier, kind: CreditKind, usedToday: number): boolean {
    const limits = CREDIT_LIMITS[tier] ?? CREDIT_LIMITS.free;

    const daily =
        kind === "screenshot"
            ? limits.screenshotDaily
            : limits.previewDaily;

    // 0 => unlimited for that tier
    if (!daily) return true;

    return usedToday < daily;
}
