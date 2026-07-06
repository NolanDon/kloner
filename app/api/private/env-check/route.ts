// app/api/private/env-check/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function requireInternal(req: NextRequest) {
    const key = process.env.INTERNAL_API_KEY || "";
    const got = req.headers.get("x-internal-key") || "";
    if (!key || got !== key) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
}

function baseUrl() {
    const v = (process.env.FRONTEND_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
    if (v) return v.replace(/\/$/, "");
    return "https://kloner.app";
}

function isSet(name: string): boolean {
    const v = (process.env as any)?.[name];
    return typeof v === "string" ? v.trim().length > 0 : false;
}

export async function GET(req: NextRequest) {
    const denied = requireInternal(req);
    if (denied) return denied;

    return NextResponse.json(
        {
            ok: true,
            computed: {
                baseUrl: baseUrl(),
                nodeEnv: process.env.NODE_ENV || null,
            },
            has: {
                RESEND_API_KEY: isSet("RESEND_API_KEY"),
                INTERNAL_API_KEY: isSet("INTERNAL_API_KEY"),
                EMAIL_LINK_SECRET: isSet("EMAIL_LINK_SECRET"),
                EMAIL_SEND_MODE: isSet("EMAIL_SEND_MODE"),
                EMAIL_TEST_TO: isSet("EMAIL_TEST_TO"),
                EMAIL_ENABLE_JOURNEY: isSet("EMAIL_ENABLE_JOURNEY"),
                EMAIL_ENABLE_PRODUCT_LAUNCH: isSet("EMAIL_ENABLE_PRODUCT_LAUNCH"),
                JOURNEY_EMAIL_FROM: isSet("JOURNEY_EMAIL_FROM"),
                WELCOME_EMAIL_FROM: isSet("WELCOME_EMAIL_FROM"),
                STRIPE_EXIT40_PROMO_PROD: isSet("STRIPE_EXIT40_PROMO_PROD"),
                STRIPE_EXIT40_PROMO_TEST: isSet("STRIPE_EXIT40_PROMO_TEST"),
                STRIPE_EXIT40_COUPON_PROD: isSet("STRIPE_EXIT40_COUPON_PROD"),
                STRIPE_EXIT40_COUPON_TEST: isSet("STRIPE_EXIT40_COUPON_TEST"),
                FRONTEND_BASE_URL: isSet("FRONTEND_BASE_URL"),
                NEXT_PUBLIC_SITE_URL: isSet("NEXT_PUBLIC_SITE_URL"),
                FIREBASE_SERVICE_ACCOUNT: isSet("FIREBASE_SERVICE_ACCOUNT"),
            },
        },
        { headers: { "Cache-Control": "no-store" } },
    );
}
