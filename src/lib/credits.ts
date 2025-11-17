// src/lib/credits.ts

export type CreditKind = "screenshot" | "preview";

export type UserTier = "free" | "pro" | "agency" | "enterprise" | "unknown";

/**
 * Monthly credit limits per tier, tuned for cost-efficiency:
 *
 *  - free:    tiny sandbox usage (just enough to feel the product)
 *  - pro:     serious individual / small team usage, but not “abuse”
 *  - agency:  high-volume teams, still bounded
 *  - enterprise: 0 = unlimited / contract, handled outside this file
 */
export const CREDIT_LIMITS: Record<
    UserTier,
    { screenshotMonthly: number; previewMonthly: number }
> = {
    free: {
        // Enough to see the flow, not enough to run real workloads.
        screenshotMonthly: 5,
        previewMonthly: 10,
    },
    pro: {
        // Tightened from 1200 → 400 to keep infra and OpenAI spend sane.
        // This is still a lot of value at $29/mo.
        screenshotMonthly: 100,
        previewMonthly: 400,
    },
    agency: {
        // Agencies get headroom, but not unbounded. Easy to upsell
        // higher tiers or per-seat / overage later.
        screenshotMonthly: 400,
        previewMonthly: 1500,
    },
    // 0 = unlimited / contract; enforce via Stripe + custom terms.
    enterprise: {
        screenshotMonthly: 0,
        previewMonthly: 0,
    },
    // Unknown should NOT be unlimited. Treat as free-tier safety net.
    unknown: {
        screenshotMonthly: 5,
        previewMonthly: 10,
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

/**
 * Single source of truth for monthly limits.
 * 0 => unlimited for that tier+kind.
 */
export function monthlyLimitFor(
    tier: UserTier,
    kind: CreditKind
): number {
    const t = tier || "free";
    const limits = CREDIT_LIMITS[t] ?? CREDIT_LIMITS.free;

    return kind === "screenshot"
        ? limits.screenshotMonthly
        : limits.previewMonthly;
}

/**
 * Monthly credit check using the shared table.
 *
 * `usedThisMonth` must be the count of successful events for the current
 * billing period (calendar month or rolling window) for this user + kind.
 *
 *  - 0 limit => unlimited for that tier / kind (enterprise only).
 *  - otherwise: cannot exceed the per-month cap.
 */
export function canConsumeCredit(
    tier: UserTier,
    kind: CreditKind,
    usedThisMonth: number
): boolean {
    const monthly = monthlyLimitFor(tier, kind);

    // 0 => unlimited for that tier
    if (!monthly) return true;

    return usedThisMonth < monthly;
}
