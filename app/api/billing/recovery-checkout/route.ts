import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/app/api/_lib/auth";
import { linkCustomerToUid } from "@/app/api/_lib/billing";
import { getStripe } from "@/lib/stripe";
import { verifySignedToken } from "@/app/api/private/email-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = getStripe();
const TRIAL_DAYS = 7;
const DEFAULT_EXIT_CODE = "DEPLOY40";

function pickExitPromoId(isProd: boolean) {
    const promo = isProd
        ? process.env.STRIPE_EXIT40_PROMO_PROD
        : process.env.STRIPE_EXIT40_PROMO_TEST;

    const coupon = isProd
        ? process.env.STRIPE_EXIT40_COUPON_PROD || process.env.STRIPE_EXIT40_COUPON_TEST
        : process.env.STRIPE_EXIT40_COUPON_TEST;

    return { promo, coupon };
}

async function resolvePromotionCodeIdFromCode(code?: unknown) {
    const c = typeof code === "string" ? code.trim() : "";
    if (!c) return null;

    const list = await stripe.promotionCodes.list({
        code: c,
        active: true,
        limit: 1,
    });

    return list.data?.[0]?.id || null;
}

async function resolveDiscount(isProd: boolean, offerPromoCode?: unknown) {
    const { promo, coupon } = pickExitPromoId(isProd);
    if (promo) return [{ promotion_code: promo as string }];
    if (coupon) return [{ coupon: coupon as string }];

    const code = typeof offerPromoCode === "string" && offerPromoCode.trim() ? offerPromoCode.trim() : DEFAULT_EXIT_CODE;
    const resolvedPromoId = await resolvePromotionCodeIdFromCode(code);
    if (!resolvedPromoId) {
        throw new Error(`Could not resolve Stripe promotion code "${code}"`);
    }
    return [{ promotion_code: resolvedPromoId }];
}

function isMissingStripeCustomerError(err: any): boolean {
    const code = typeof err?.code === "string" ? err.code : "";
    const param = typeof err?.param === "string" ? err.param : "";
    const message = typeof err?.message === "string" ? err.message : "";
    return (
        (code === "resource_missing" && (param === "customer" || /no such customer/i.test(message))) ||
        /similar object exists in live mode.*test mode key/i.test(message) ||
        /similar object exists in test mode.*live mode key/i.test(message)
    );
}

export async function GET(req: NextRequest) {
    const { searchParams, origin } = new URL(req.url);
    const token = searchParams.get("t") || "";
    const payload = verifySignedToken(token);
    const uid = typeof payload?.uid === "string" ? payload.uid.trim() : "";
    const kind = typeof payload?.k === "string" ? payload.k.trim() : "";

    if (!uid || kind !== "exit40") {
        return NextResponse.json({ ok: false, error: "Invalid recovery token." }, { status: 400 });
    }

    const db = getAdminDb();
    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();
    const userData = snap.exists ? (snap.data() as any) : {};

    const isProd = process.env.NODE_ENV === "production";
    const priceId =
        process.env.NODE_ENV === "production"
            ? process.env.STRIPE_PRICE_PRO_PROD
            : process.env.STRIPE_PRICE_PRO_TEST;

    if (!priceId) {
        return NextResponse.json({ ok: false, error: "Recovery pricing is not configured." }, { status: 500 });
    }

    let customerId: string | undefined =
        typeof userData?.stripeCustomerId === "string" && userData.stripeCustomerId.trim()
            ? userData.stripeCustomerId.trim()
            : undefined;

    const createAndPersistCustomer = async (): Promise<string> => {
        const authUser = await getAdminAuth().getUser(uid);
        const email = authUser.email ?? undefined;

        const customer = await stripe.customers.create({
            email,
            metadata: {
                firebaseUid: uid,
                recovery: "exit40",
            },
        });

        const nextCustomerId = customer.id;
        await userRef.set({ stripeCustomerId: nextCustomerId }, { merge: true });
        await linkCustomerToUid(nextCustomerId, uid);
        return nextCustomerId;
    };

    if (!customerId) {
        try {
            customerId = await createAndPersistCustomer();
        } catch (err: any) {
            if (isMissingStripeCustomerError(err)) {
                customerId = await createAndPersistCustomer();
            } else {
                return NextResponse.json({ ok: false, error: "Unable to prepare recovery checkout." }, { status: 500 });
            }
        }
    }

    const existingSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
    });

    const activeOrTrialing = existingSubs.data.filter((sub) => {
        if (sub.status === "active") return true;
        if (sub.status !== "trialing") return false;
        if (sub.cancel_at_period_end === true) return false;
        return true;
    });

    if (activeOrTrialing.length > 0) {
        return NextResponse.json(
            { ok: false, error: "You already have an active subscription." },
            { status: 400 },
        );
    }

    const discounts = await resolveDiscount(isProd, DEFAULT_EXIT_CODE);

    const successUrl = `${origin}/dashboard/view?billing=success&recovery=1`;
    const cancelUrl = `${origin}/dashboard/view?billing=cancelled&recovery=1`;

    const baseMeta: Record<string, string> = {
        firebaseUid: uid,
        plan: "pro",
        checkoutFlow: "recovery_exit40",
        recoveryCode: DEFAULT_EXIT_CODE,
    };

    const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: uid,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: baseMeta,
        payment_method_options: {
            card: {
                request_three_d_secure: "any",
            },
        },
        discounts,
        subscription_data: {
            trial_period_days: TRIAL_DAYS,
            metadata: baseMeta,
        },
    });

    if (!session.url) {
        return NextResponse.json({ ok: false, error: "Failed to start recovery checkout." }, { status: 500 });
    }

    return NextResponse.redirect(session.url, 302);
}
