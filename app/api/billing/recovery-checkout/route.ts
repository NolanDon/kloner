import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/app/api/_lib/auth";
import { linkCustomerToUid } from "@/app/api/_lib/billing";
import { getStripe } from "@/lib/stripe";
import { verifySignedToken } from "@/app/api/private/email-links";
import { STRIPE_TRIAL_DAYS } from "@/src/lib/billingAccess";
import { resolveMonthlyPriceId } from "@/app/api/_lib/monthlyPrice";
import { shouldRequireEarlyGenerationPaywall } from "@/app/api/_lib/earlyGenerationGate";
import { hasPriorSubscriptionHistoryForAccount } from "@/app/api/_lib/freeTrial";
import {
    filterBillableSubscriptions,
    pickSurvivorSubscription,
    resolveSubscriptionPaymentAction,
} from "@/app/api/_lib/billingSubscriptionGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = getStripe();
const DEFAULT_EXIT_CODE = "DEPLOY40";

function resolveRecoveryPriceId(isProd: boolean): string | null {
    return resolveMonthlyPriceId(isProd);
}

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
    const priceId = resolveRecoveryPriceId(isProd);
    const earlyPaywallCountry = shouldRequireEarlyGenerationPaywall(req).required;

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

    // A past_due / unpaid / incomplete subscription is still the customer's
    // one live subscription. Convert it in place to the recovery plan
    // instead of creating a SECOND subscription through a new Checkout
    // session. If several such subscriptions somehow exist, the survivor
    // (past_due first, else the newest) is converted and the rest are left
    // untouched.
    const existingBillableSubscription = pickSurvivorSubscription(
        filterBillableSubscriptions(existingSubs.data as any[]).filter(
            (sub: any) =>
                sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete",
        ),
    );

    if (existingBillableSubscription) {
        if (existingBillableSubscription.cancel_at_period_end === true) {
            // Already set to cancel: do not silently reverse that, and do
            // not stack a new subscription either.
            return NextResponse.json(
                { ok: false, error: "You already have an active subscription." },
                { status: 400 },
            );
        }

        const subscriptionItem = existingBillableSubscription.items?.data?.[0];
        if (!subscriptionItem?.id) {
            return NextResponse.json(
                { ok: false, error: "We couldn’t update your existing subscription." },
                { status: 500 },
            );
        }

        const currentPriceId =
            typeof subscriptionItem.price === "string"
                ? subscriptionItem.price
                : subscriptionItem.price?.id;
        const update: any = {
            cancel_at_period_end: false,
            // Same as create-checkout-session: let Stripe hold the
            // subscription while the card's extra check (3D Secure) is
            // completed, instead of failing outright. No paid access until
            // the payment actually completes.
            payment_behavior: "allow_incomplete",
            proration_behavior: "none",
            expand: ["latest_invoice.payment_intent"],
        };
        if (currentPriceId !== priceId) {
            update.items = [{ id: subscriptionItem.id, price: priceId }];
        }

        // Carry the recovery discount onto the existing subscription.
        const recoveryDiscounts = await resolveDiscount(isProd, DEFAULT_EXIT_CODE);
        if (recoveryDiscounts?.length) {
            update.discounts = recoveryDiscounts;
        }

        try {
            const updatedSubscription = await stripe.subscriptions.update(
                existingBillableSubscription.id,
                update,
                { idempotencyKey: `recovery-upgrade:${uid}:${existingBillableSubscription.id}` },
            );
            if (updatedSubscription.status === "active") {
                return NextResponse.redirect(`${origin}/dashboard/view?billing=success&recovery=1`, 302);
            }
            // Not active yet: either the card needs its extra verification
            // step, or the payment failed outright. Send the user to the
            // verification page when Stripe has one.
            const action = await resolveSubscriptionPaymentAction({
                stripe: stripe as any,
                subscription: updatedSubscription,
                returnUrl: `${origin}/dashboard/view?billing=success&recovery=1`,
            });
            if (action.subscriptionStatus === "active") {
                return NextResponse.redirect(`${origin}/dashboard/view?billing=success&recovery=1`, 302);
            }
            if (action.actionUrl) {
                return NextResponse.redirect(action.actionUrl, 302);
            }
            if (action.paymentIntentStatus === "requires_payment_method") {
                return NextResponse.json(
                    { ok: false, error: "We couldn’t charge your saved payment method to restart the paid plan. Update your payment method in account settings, then try again." },
                    { status: 402 },
                );
            }
            return NextResponse.json(
                { ok: false, error: "Your subscription wasn’t activated. Please check your payment method and try again." },
                { status: 402 },
            );
        } catch (err: any) {
            return NextResponse.json(
                { ok: false, error: "We couldn’t charge your saved payment method to restart the paid plan. Update your payment method in account settings, then try again." },
                { status: 402 },
            );
        }
    }

    let hasAnySubscriptionHistory =
        existingSubs.data.length > 0 ||
        !!userData.freeTrialUsedAt ||
        userData.freeTrialUsed === true;
    if (STRIPE_TRIAL_DAYS > 0 && !hasAnySubscriptionHistory) {
        try {
            const email = (await getAdminAuth().getUser(uid)).email;
            hasAnySubscriptionHistory = await hasPriorSubscriptionHistoryForAccount({
                uid,
                email,
                stripe,
            });
        } catch (error) {
            // If eligibility cannot be verified, keep the recovery discount but withhold the trial.
            hasAnySubscriptionHistory = true;
            console.error("[billing] recovery trial eligibility check failed; trial withheld", {
                uid,
                error,
            });
        }
    }
    const includeTrial = STRIPE_TRIAL_DAYS > 0 && !earlyPaywallCountry && !hasAnySubscriptionHistory;

    const discounts = await resolveDiscount(isProd, DEFAULT_EXIT_CODE);

    const successUrl = `${origin}/dashboard/view?billing=success&recovery=1`;
    const cancelUrl = `${origin}/dashboard/view?billing=cancelled`;

    const baseMeta: Record<string, string> = {
        firebaseUid: uid,
        plan: "pro",
        abuseBlocklistCheck: "1",
        checkoutFlow: "recovery_exit40",
        recoveryCode: DEFAULT_EXIT_CODE,
        ...(includeTrial ? { trialWelcomeEmail: "1" } : {}),
    };

    const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: uid,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: baseMeta,
        // Collect the card for future off-session invoices, but let Stripe/Radar
        // request 3DS dynamically when the issuer or risk engine requires it.
        payment_method_collection: "always",
        discounts,
        subscription_data: {
            ...(includeTrial ? { trial_period_days: STRIPE_TRIAL_DAYS } : {}),
            metadata: baseMeta,
        },
    });

    if (!session.url) {
        return NextResponse.json({ ok: false, error: "Failed to start recovery checkout." }, { status: 500 });
    }

    return NextResponse.redirect(session.url, 302);
}
