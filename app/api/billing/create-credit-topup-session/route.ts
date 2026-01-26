import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { assertCsrf, getAdminAuth, getAdminDb, verifySession } from "@/app/api/_lib/auth";
import { linkCustomerToUid } from "@/app/api/_lib/billing";
import { getAuthoritativeUserTier } from "@/app/api/_lib/userTier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = getStripe();

type Tier = "free" | "pro" | "agency" | "enterprise" | "unknown";

function normalizeTier(raw: unknown): Tier {
    const t = typeof raw === "string" ? raw.toLowerCase().trim() : "";
    if (t === "pro" || t === "agency" || t === "free" || t === "enterprise" || t === "unknown") return t;
    return "free";
}

function readIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

function getTopUpConfig() {
    const currency = (process.env.STRIPE_AI_EDIT_TOPUP_CURRENCY || "usd").toLowerCase();
    const unitPriceCents = readIntEnv("STRIPE_AI_EDIT_CREDIT_UNIT_PRICE_CENTS", 3);
    const minCredits = readIntEnv("STRIPE_AI_EDIT_TOPUP_MIN_CREDITS", 50);
    const maxCredits = readIntEnv("STRIPE_AI_EDIT_TOPUP_MAX_CREDITS", 5000);
    const stepCredits = readIntEnv("STRIPE_AI_EDIT_TOPUP_STEP_CREDITS", 50);

    return { currency, unitPriceCents, minCredits, maxCredits, stepCredits };
}

function normalizeCredits(input: unknown): number | null {
    const n = typeof input === "number" ? input : typeof input === "string" ? Number(input) : NaN;
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n));
}

async function handler(req: NextRequest, uid: string, sessionClaims?: Record<string, unknown>) {
    const db = getAdminDb();

    const body = await req.json().catch(() => ({} as any));

    const creditsRaw = normalizeCredits(body?.credits);
    if (!creditsRaw) {
        return NextResponse.json({ error: "Missing or invalid credits" }, { status: 400 });
    }

    const { currency, unitPriceCents, minCredits, maxCredits, stepCredits } = getTopUpConfig();

    if (creditsRaw < minCredits || creditsRaw > maxCredits) {
        return NextResponse.json(
            { error: `Credits must be between ${minCredits} and ${maxCredits}.` },
            { status: 400 },
        );
    }

    if (stepCredits > 1 && creditsRaw % stepCredits !== 0) {
        return NextResponse.json(
            { error: `Credits must be in increments of ${stepCredits}.` },
            { status: 400 },
        );
    }

    // Prefer custom claims for realtime entitlement; fallback to authoritative tier when claims are missing.
    const claimsTier = normalizeTier(sessionClaims?.userTier ?? sessionClaims?.tier);
    const tier = (claimsTier && claimsTier !== "free") ? claimsTier : await getAuthoritativeUserTier(uid);

    if (tier !== "pro" && tier !== "agency") {
        return NextResponse.json(
            {
                error: "Credit top-ups are available for Pro and Agency only.",
                meta: {
                    detectedTier: tier,
                    detectedTierSource: claimsTier && claimsTier !== "free" ? "customClaims" : "authoritative",
                },
            },
            { status: 403 },
        );
    }

    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();
    const userData = snap.exists ? (snap.data() as any) : {};

    let customerId: string | undefined =
        typeof userData?.stripeCustomerId === "string" ? userData.stripeCustomerId : undefined;

    if (!customerId) {
        const authUser = await getAdminAuth().getUser(uid);
        const email = authUser.email ?? undefined;

        const customer = await stripe.customers.create({
            email,
            metadata: { firebaseUid: uid },
        });

        customerId = customer.id;

        await userRef.set({ stripeCustomerId: customerId }, { merge: true });
        await linkCustomerToUid(customerId, uid);
    }

    const origin = new URL(req.url).origin;
    const successUrl = new URL("/price?topup=success&session_id={CHECKOUT_SESSION_ID}#topup", origin).toString();
    const cancelUrl = new URL("/price?topup=cancel#topup", origin).toString();

    const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        allow_promotion_codes: true,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
            {
                price_data: {
                    currency,
                    unit_amount: unitPriceCents,
                    product_data: {
                        name: `AI credit top-up (${creditsRaw} credits)`,
                        description: "Adds AI edit credits to your account (does not change your monthly plan limits).",
                    },
                },
                quantity: creditsRaw,
            },
        ],
        metadata: {
            type: "ai_credit_topup",
            firebaseUid: uid,
            aiEditCredits: String(creditsRaw),
            unitPriceCents: String(unitPriceCents),
            currency,
        },
    });

    return NextResponse.json({ url: session.url });
}

export async function POST(req: NextRequest) {
    try {
        assertCsrf(req);
        const decoded = await verifySession(req);
        const uid = decoded.uid;
        const claims = (decoded as any) as Record<string, unknown>;
        return await handler(req, uid, claims);
    } catch (err: any) {
        const status = typeof err?.status === "number" ? err.status : 401;
        const msg = typeof err?.message === "string" ? err.message : "Unauthorized";
        return NextResponse.json({ error: msg }, { status });
    }
}
