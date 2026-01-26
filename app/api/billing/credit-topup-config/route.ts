import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

export async function GET() {
    const currency = (process.env.STRIPE_AI_EDIT_TOPUP_CURRENCY || "usd").toLowerCase();

    // Pricing is in USD cents per 1 AI credit.
    // NOTE: One AI edit typically consumes 5 credits.
    const unitPriceCents = readIntEnv("STRIPE_AI_EDIT_CREDIT_UNIT_PRICE_CENTS", 3);

    const minCredits = readIntEnv("STRIPE_AI_EDIT_TOPUP_MIN_CREDITS", 50);
    const maxCredits = readIntEnv("STRIPE_AI_EDIT_TOPUP_MAX_CREDITS", 5000);
    const stepCredits = readIntEnv("STRIPE_AI_EDIT_TOPUP_STEP_CREDITS", 50);

    return NextResponse.json({
        currency,
        unitPriceCents,
        minCredits,
        maxCredits,
        stepCredits,
    });
}
