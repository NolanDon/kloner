function readIntEnv(raw: string | undefined, fallback: number): number {
    if (typeof raw !== "string" || !raw.trim()) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function readFloatEnv(raw: string | undefined, fallback: number): number {
    if (typeof raw !== "string" || !raw.trim()) return fallback;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reversible billing knobs shared by client and server.
 *
 * `NEXT_PUBLIC_STRIPE_TRIAL_DAYS=0` disables the free trial without
 * changing the checkout architecture.
 * `NEXT_PUBLIC_FREE_PREVIEW_CREDITS` and `NEXT_PUBLIC_FREE_EDIT_CREDITS`
 * keep the free allowance small and easy to tune.
 */
export const STRIPE_TRIAL_DAYS = Math.max(0, readIntEnv(process.env.NEXT_PUBLIC_STRIPE_TRIAL_DAYS, 7));

/** Enables the early-generation paywall for free accounts, independent of country. */
export const EARLY_GENERATION_PAYWALL_ENABLED =
    process.env.NEXT_PUBLIC_EARLY_GENERATION_PAYWALL_ENABLED === "true";

export const TRIAL_CTA_LABEL =
    STRIPE_TRIAL_DAYS > 0 ? "Start for free today" : "Subscribe now";

/** CTA label used whenever the viewer is billed the moment they upgrade. */
export const BILLING_STARTS_TODAY_CTA = "Upgrade now — billing starts today";

/** Small-print line paired with BILLING_STARTS_TODAY_CTA. */
export const BILLING_STARTS_TODAY_NOTE =
    "Upgrading starts your paid plan right away and bills you today. Cancel anytime.";

/**
 * True when a checkout started by this viewer bills immediately instead of
 * starting a free trial: they are on a trial now, their trial is set to end,
 * or they have any earlier subscription history. The checkout server only
 * grants a trial to accounts with no subscription history at all, so every
 * other viewer must be told billing starts today.
 */
export function viewerBillsImmediately(billingState: unknown, hasSubscriptionHistory: unknown): boolean {
    const state = typeof billingState === "string" ? billingState.trim().toLowerCase() : "";
    if (state === "trialing" || state === "trial_cancelled") return true;
    return state === "free" && hasSubscriptionHistory === true;
}

/** The canonical subscription entitlement used by dashboard and editor gates. */
export function hasSubscriptionAccess(billingState: unknown): boolean {
    const state = typeof billingState === "string" ? billingState.trim().toLowerCase() : "";
    return state === "active" || state === "trialing";
}

export const BASIC_MONTHLY_PRICE_USD = Math.max(
    1,
    readFloatEnv(
        process.env.NEXT_PUBLIC_BASIC_MONTHLY_PRICE_USD,
        readFloatEnv(process.env.NEXT_PUBLIC_PRO_MONTHLY_PRICE_USD, 29.99),
    ),
);

export const FREE_PREVIEW_MONTHLY_CREDITS = Math.max(
    0,
    readIntEnv(process.env.NEXT_PUBLIC_FREE_PREVIEW_CREDITS, 90),
);

export const FREE_EDIT_MONTHLY_CREDITS = Math.max(
    0,
    readIntEnv(process.env.NEXT_PUBLIC_FREE_EDIT_CREDITS, 2),
);
