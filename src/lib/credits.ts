// src/lib/credits.ts

export type UserTier = "free" | "pro" | "agency" | "enterprise" | "unknown";
export type CreditKind = "screenshot" | "preview";

export const CREDIT_LIMITS: Record<UserTier, { screenshotDaily: number; previewDaily: number }> = {
    free: {
        screenshotDaily: 3,
        previewDaily: 5,
    },
    pro: {
        screenshotDaily: 100,
        previewDaily: 200,
    },
    agency: {
        screenshotDaily: 400,
        previewDaily: 800,
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
