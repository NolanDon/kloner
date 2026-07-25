function readIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (typeof raw !== "string" || !raw.trim()) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reversible billing knobs shared by client and server.
 *
 * `NEXT_PUBLIC_STRIPE_TRIAL_DAYS=0` disables the current free trial without
 * changing the checkout architecture.
 * `NEXT_PUBLIC_FREE_PREVIEW_CREDITS` and `NEXT_PUBLIC_FREE_EDIT_CREDITS`
 * keep the free allowance small and easy to tune.
 */
export const STRIPE_TRIAL_DAYS = Math.max(0, readIntEnv("NEXT_PUBLIC_STRIPE_TRIAL_DAYS", 0));

export const FREE_PREVIEW_MONTHLY_CREDITS = Math.max(
    0,
    readIntEnv("NEXT_PUBLIC_FREE_PREVIEW_CREDITS", 30),
);

export const FREE_EDIT_MONTHLY_CREDITS = Math.max(
    0,
    readIntEnv("NEXT_PUBLIC_FREE_EDIT_CREDITS", 2),
);
