import { BASIC_MONTHLY_PRICE_USD } from "@/src/lib/billingAccess";

const LEGACY_1999_PRICE_USD = 19.99;

function is1999Price(value: number): boolean {
    return Math.abs(value - LEGACY_1999_PRICE_USD) < 0.005;
}

/**
 * Select the Stripe monthly price using the same numeric setting that drives
 * the public pricing UI. The existing PRO price is the legacy $19.99 price;
 * BASIC is the current/default monthly price slot.
 */
export function resolveMonthlyPriceId(isProd: boolean): string | null {
    const priceIds = isProd
        ? is1999Price(BASIC_MONTHLY_PRICE_USD)
            ? [process.env.STRIPE_PRICE_PRO_PROD, process.env.STRIPE_PRICE_BASIC_PROD]
            : [process.env.STRIPE_PRICE_BASIC_PROD, process.env.STRIPE_PRICE_PRO_PROD]
        : is1999Price(BASIC_MONTHLY_PRICE_USD)
            ? [process.env.STRIPE_PRICE_PRO_TEST, process.env.STRIPE_PRICE_BASIC_TEST]
            : [process.env.STRIPE_PRICE_BASIC_TEST, process.env.STRIPE_PRICE_PRO_TEST];

    return priceIds.find((value) => typeof value === "string" && value.trim())?.trim() || null;
}
