// src/lib/credits.ts

export type CreditKind = "screenshot" | "preview";

export type UserTier = "free" | "pro" | "agency" | "enterprise" | "unknown";

export const CREDIT_LIMITS: Record<UserTier, { screenshotDaily: number; previewDaily: number }> = {
    free: { screenshotDaily: 3, previewDaily: 5 },
    pro: { screenshotDaily: 20, previewDaily: 40 },  // ~600–1200 runs/month
    agency: { screenshotDaily: 60, previewDaily: 120 }, // ~3600 runs/month
    enterprise: { screenshotDaily: 0, previewDaily: 0 },   // 0 = unlimited / contract
    unknown: { screenshotDaily: 0, previewDaily: 0 },
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
