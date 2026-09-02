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

export const TRIAL_CTA_LABEL =
    STRIPE_TRIAL_DAYS > 0 ? `Start your ${STRIPE_TRIAL_DAYS}-day free trial` : "Subscribe now";

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
