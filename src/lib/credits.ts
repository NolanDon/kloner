import { FREE_EDIT_MONTHLY_CREDITS, FREE_PREVIEW_MONTHLY_CREDITS } from "./billingAccess";

export type CreditKind = "screenshot" | "preview" | "edit";

export type UserTier = "free" | "pro" | "agency" | "enterprise" | "unknown";

/**
 * Monthly credit limits per tier, tuned for cost-efficiency:
 *
 *  - free:    tiny sandbox usage (just enough to feel the product)
 *  - pro:     serious individual / small team usage, but not “abuse”
 *  - agency:  high-volume teams, still bounded
 *  - enterprise: 0 = unlimited / contract, handled outside this file
 *
 * `editMonthly` is the max number of *credits* for AI edits.
 * AI edit charge is usage-based and scaled from request size, so this cap limits the monthly pool of credits available for AI requests.
 */
export const CREDIT_LIMITS: Record<
    UserTier,
    { screenshotMonthly: number; previewMonthly: number; editMonthly: number }
> = {
    free: {
        screenshotMonthly: 100,
        previewMonthly: FREE_PREVIEW_MONTHLY_CREDITS,
        editMonthly: FREE_EDIT_MONTHLY_CREDITS, // small starter pool for usage-based AI edits
    },
    pro: {
        screenshotMonthly: 100,
        previewMonthly: 450,
        editMonthly: 300, // standard pool for usage-based AI edits
    },
    agency: {
        screenshotMonthly: 400,
        previewMonthly: 1500,
        editMonthly: 1200, // larger pool for usage-based AI edits
    },
    // 0 = unlimited / contract; enforce via Stripe + custom terms.
    enterprise: {
        screenshotMonthly: 0,
        previewMonthly: 0,
        editMonthly: 0, // unlimited / contract; enforce via Stripe + custom terms.
    },
    // Unknown should NOT be unlimited. Treat as free-tier safety net.
    unknown: {
        screenshotMonthly: 5,
        previewMonthly: 10,
        editMonthly: 10, // small safety-net pool for usage-based AI edits
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
 *
 * `kind === "edit"` is in *credits*, not events.
 */
export function monthlyLimitFor(
    tier: UserTier,
    kind: CreditKind
): number {
    const t = tier || "free";
    const limits = CREDIT_LIMITS[t] ?? CREDIT_LIMITS.free;

    if (kind === "screenshot") return limits.screenshotMonthly;
    if (kind === "preview") return limits.previewMonthly;
    return limits.editMonthly;
}

/**
 * Monthly credit check using the shared table.
 *
 * `usedThisMonth` must be the count of *credits* used for the current
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
