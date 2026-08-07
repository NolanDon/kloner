// app/api/billing/create-checkout-session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { STRIPE_TRIAL_DAYS } from "@/src/lib/billingAccess";
import admin from "firebase-admin";
import { linkCustomerToUid } from "../../_lib/billing";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { captureCriticalEvent, captureException } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = getStripe();
const db = admin.firestore();

// Exit-offer rules
const EXIT_OFFER_MS = 15 * 60 * 1000;
const EXIT_OFFER_SKEW_MS = 30 * 1000; // client clock tolerance
// Exit offer is intentionally disabled here so the 40% discount can only be
// applied through the signed recovery email link.
const EXIT_OFFER_DISABLED = true;

async function notifyStripeSubscriptionError(params: {
    action: string;
    uid: string;
    error: any;
    extra?: Record<string, unknown>;
}) {
    const { action, uid, error, extra } = params;
    const status =
        typeof error?.statusCode === "number"
            ? error.statusCode
            : typeof error?.status === "number"
              ? error.status
              : 500;

    if (status >= 500) {
        await captureException({
            source: "vercel",
            error,
            route: "/api/billing/create-checkout-session",
            method: "POST",
            action,
            statusCode: status,
            service: "billing-subscription",
            userId: uid,
            extra,
        });
        return;
    }

    await captureCriticalEvent({
        source: "vercel",
        severity: "critical",
        statusCode: status,
        route: "/api/billing/create-checkout-session",
        method: "POST",
        action,
        service: "billing-subscription",
        userId: uid,
        message: typeof error?.message === "string" ? error.message : "Stripe subscription flow error",
        errorName: typeof error?.type === "string" ? error.type : undefined,
        stack: typeof error?.stack === "string" ? error.stack : undefined,
        extra,
    });
}

function pickExitPromoId(isProd: boolean) {
    const promo = isProd
        ? process.env.STRIPE_EXIT40_PROMO_PROD
        : process.env.STRIPE_EXIT40_PROMO_TEST;

    const coupon = isProd
        ? process.env.STRIPE_EXIT40_COUPON_PROD
        : process.env.STRIPE_EXIT40_COUPON_TEST;

    return { promo, coupon };
}

function resolveCheckoutPriceId(plan: string, isProd: boolean): string | null {
    const normalizedPlan = String(plan || "").trim().toLowerCase();
    if (normalizedPlan === "agency") {
        return isProd
            ? process.env.STRIPE_PRICE_AGENCY_PROD || process.env.STRIPE_PRICE_PRO_AGENCY || null
            : process.env.STRIPE_PRICE_AGENCY_TEST || null;
    }

    if (normalizedPlan === "pro" || normalizedPlan === "basic") {
        return isProd
            ? process.env.STRIPE_PRICE_BASIC_PROD ||
                  process.env.STRIPE_PRICE_PRO_PROD ||
                  null
            : process.env.STRIPE_PRICE_BASIC_TEST ||
                  process.env.STRIPE_PRICE_PRO_TEST ||
                  null;
    }

    return null;
}

function isValidExitOfferPayload(payload: { offer?: unknown; offerEndsAt?: unknown }) {
    if (EXIT_OFFER_DISABLED) return false;
    if (payload.offer !== "exit40") return false;

    const endsAt = typeof payload.offerEndsAt === "number" ? payload.offerEndsAt : NaN;
    if (!Number.isFinite(endsAt) || endsAt <= 0) return false;

    const now = Date.now();

    // Must not be expired
    if (now > endsAt) return false;

    // Must be a near-future deadline, not some far future cheated value
    const maxFuture = now + EXIT_OFFER_MS + EXIT_OFFER_SKEW_MS;
    if (endsAt > maxFuture) return false;

    return true;
}

function hasClaimedExitOffer(userData: Record<string, any> | null | undefined): boolean {
    if (!userData || typeof userData !== "object") return false;
    const nested = (userData as any)?.offers;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        if ((nested as any).exitOffer40Claimed === true) return true;
    }
    if ((userData as any)["offers.exitOffer40Claimed"] === true) return true;
    return false;
}

async function claimExitOfferOnce(userRef: FirebaseFirestore.DocumentReference): Promise<boolean> {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const data = snap.exists ? ((snap.data() as Record<string, any>) || {}) : {};
        if (hasClaimedExitOffer(data)) {
            return false;
        }

        const serverTimestampValue =
            (admin.firestore as any)?.FieldValue?.serverTimestamp?.() ?? new Date();

        const prevOffers =
            data?.offers && typeof data.offers === "object" && !Array.isArray(data.offers)
                ? data.offers
                : {};

        tx.set(
            userRef,
            {
                offers: {
                    ...prevOffers,
                    exitOffer40Claimed: true,
                    exitOffer40ClaimedAt: serverTimestampValue,
                },
            },
            { merge: true },
        );

        return true;
    });
}

async function resolvePromotionCodeIdFromCode(code?: unknown) {
    const c = typeof code === "string" ? code.trim() : "";
    if (!c) return null;

    const list = await stripe.promotionCodes.list({
        code: c,
        active: true,
        limit: 1,
    });

    return list.data?.[0]?.id || null; // promo_...
}

function assertValidDiscountId(promo?: string | null, coupon?: string | null) {
    if (promo && !promo.startsWith("promo_")) {
        throw new Error(
            `STRIPE_EXIT40_PROMO_* must be a Promotion Code id starting with "promo_". Got: "${promo}"`,
        );
    }
    if (coupon && typeof coupon !== "string") {
        throw new Error(
            `STRIPE_EXIT40_COUPON_* must be a valid Stripe Coupon id. Got: "${coupon}"`,
        );
    }
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

async function handler({ req, uid }: { req: NextRequest; uid: string }) {
    const body = await req.json().catch(() => ({}));

    const {
        plan,
        returnRenderId,
        returnAppId,
        returnStep,

        // exit-offer inputs
        offer, // "exit40"
        offerEndsAt, // number (ms)
        offerReason, // optional
        offerPromoCode, // optional: "DEPLOY40" (human code)
    } = body as any;

    if (!plan) {
        return NextResponse.json({ error: "Missing plan" }, { status: 400 });
    }

    // Trial is configurable and defaults to 7 days.
    const trialCandidate = plan === "pro" && STRIPE_TRIAL_DAYS > 0;

    const isProd = process.env.NODE_ENV === "production";

    const priceId = resolveCheckoutPriceId(plan, isProd);

    if (!priceId) {
        return NextResponse.json(
            { error: "Stripe price not configured for current environment" },
            { status: 500 },
        );
    }

    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();
    const userData = snap.exists ? (snap.data() as any) : {};

    const affiliateRef: string =
        typeof userData?.affiliateRef === "string" ? userData.affiliateRef.trim() : "";
    const affiliateSource: string =
        typeof userData?.affiliateSource === "string" ? userData.affiliateSource.trim() : "";

    let customerId: string | undefined = userData.stripeCustomerId;

    const createAndPersistCustomer = async (): Promise<string> => {
        const authUser = await admin.auth().getUser(uid);
        const email = authUser.email ?? undefined;

        let customer;
        try {
            customer = await stripe.customers.create({
                email,
                metadata: {
                    firebaseUid: uid,
                    ...(affiliateRef ? { affiliateRef } : {}),
                    ...(affiliateSource ? { affiliateSource } : {}),
                },
            });
        } catch (err: any) {
            await notifyStripeSubscriptionError({
                action: "billing.createCheckoutSession.createCustomer",
                uid,
                error: err,
                extra: { plan, email: email || null },
            });
            throw err;
        }

        const nextCustomerId = customer.id;
        await userRef.set({ stripeCustomerId: nextCustomerId }, { merge: true });
        await linkCustomerToUid(nextCustomerId, uid);
        return nextCustomerId;
    };

    if (!customerId) {
        customerId = await createAndPersistCustomer();
    } else {
        if (affiliateRef || affiliateSource) {
            try {
                await stripe.customers.update(customerId, {
                    metadata: {
                        firebaseUid: uid,
                        ...(affiliateRef ? { affiliateRef } : {}),
                        ...(affiliateSource ? { affiliateSource } : {}),
                    },
                });
            } catch (err: any) {
                if (isMissingStripeCustomerError(err)) {
                    customerId = await createAndPersistCustomer();
                }
                // ignore
            }
        }
    }

    let existingSubs;
    try {
        existingSubs = await stripe.subscriptions.list({
            customer: customerId,
            status: "all",
            limit: 100,
        });
    } catch (err: any) {
        if (customerId && isMissingStripeCustomerError(err)) {
            customerId = await createAndPersistCustomer();
            existingSubs = await stripe.subscriptions.list({
                customer: customerId,
                status: "all",
                limit: 100,
            });
        } else {
            await notifyStripeSubscriptionError({
                action: "billing.createCheckoutSession.listSubscriptions",
                uid,
                error: err,
                extra: { plan, customerId },
            });
            throw err;
        }
    }

    const activeOrTrialing = existingSubs.data.filter((sub) => {
        if (sub.status === "active") return true;
        if (sub.status !== "trialing") return false;

        // If a trial was already cancelled, let the user continue with a normal paid checkout
        // on the same account. The new checkout will not include a trial.
        if (sub.cancel_at_period_end === true) return false;

        return true;
    });

    if (activeOrTrialing.length > 0) {
        return NextResponse.json(
            {
                error: "You already have an active subscription. Please manage your existing subscription instead.",
                existingSubscription: true,
            },
            { status: 400 }
        );
    }

    // Anti-abuse: one free trial per customer lifecycle.
    // If this customer has any prior subscription history (including canceled),
    // do not attach a new trial.
    const hasAnySubscriptionHistory = existingSubs.data.length > 0;
    const includeTrial = trialCandidate && !hasAnySubscriptionHistory;
    const isAppDeployTrialSuccess = !!(returnAppId && includeTrial);

    const appOrigin = isProd
        ? process.env.NEXT_PUBLIC_APP_ORIGIN || "https://kloner.app"
        : process.env.NEXT_PUBLIC_APP_ORIGIN || "http://localhost:3000";

    const successUrl =
        returnRenderId && returnStep
            ? `${appOrigin}/dashboard/view?wizard=1&step=${returnStep || 2}&render=${encodeURIComponent(
                returnRenderId || "",
            )}&billing=success`
            : returnAppId && returnStep
                ? isAppDeployTrialSuccess
                    ? `${appOrigin}/dashboard/view?billing=success&trial=1`
                    : `${appOrigin}/dashboard/view?wizard=1&step=${returnStep || 3}&appId=${encodeURIComponent(
                        returnAppId || "",
                    )}&billing=success`
            : `${appOrigin}/dashboard/view?billing=success`;

    const cancelUrl = `${appOrigin}/dashboard/view?billing=cancelled&recovery=1`;

    // ---- exit-offer discount resolution ----
    const exitOfferRequested = isValidExitOfferPayload({ offer, offerEndsAt });
    const exitOfferGranted = exitOfferRequested ? await claimExitOfferOnce(userRef) : false;

    const baseMeta: Record<string, string> = {
        firebaseUid: uid,
        plan,
        ...(affiliateRef ? { affiliateRef } : {}),
        ...(affiliateSource ? { affiliateSource } : {}),
        ...(returnAppId ? { returnAppId: String(returnAppId) } : {}),
        ...(returnRenderId ? { returnRenderId: String(returnRenderId) } : {}),
        ...(returnStep ? { returnStep: String(returnStep) } : {}),
        ...(exitOfferRequested ? { checkoutFlow: "recovery_exit40" } : {}),
        ...(isAppDeployTrialSuccess ? { checkoutFlow: "app_deploy_trial" } : {}),
    };

    let discounts:
        | Array<{ promotion_code?: string; coupon?: string }>
        | undefined = undefined;

    if (exitOfferRequested && exitOfferGranted) {
        // 1) Prefer env ids (fast, deterministic)
        const { promo, coupon } = pickExitPromoId(isProd);

        try {
            assertValidDiscountId(promo || null, coupon || null);
        } catch (e: any) {
            return NextResponse.json({ error: e?.message || "Invalid discount env id" }, { status: 500 });
        }

        if (promo) {
            discounts = [{ promotion_code: promo }];
        } else if (coupon) {
            discounts = [{ coupon }];
        } else {
            // 2) Fallback: resolve human code -> promo_...
            const resolvedPromoId = await resolvePromotionCodeIdFromCode(offerPromoCode);
            if (!resolvedPromoId) {
                return NextResponse.json(
                    {
                        error:
                            "Exit offer requested but no STRIPE_EXIT40_PROMO_* / STRIPE_EXIT40_COUPON_* configured and offerPromoCode could not be resolved.",
                    },
                    { status: 500 },
                );
            }
            discounts = [{ promotion_code: resolvedPromoId }];
        }

        baseMeta.exitOffer = "exit40";
        if (typeof offerReason === "string" && offerReason.trim()) {
            baseMeta.exitOfferReason = offerReason.trim().slice(0, 32);
        }
        if (typeof offerPromoCode === "string" && offerPromoCode.trim()) {
            baseMeta.exitOfferPromoCode = offerPromoCode.trim().slice(0, 64);
        }
    } else if (exitOfferRequested && !exitOfferGranted) {
        baseMeta.exitOffer = "exit40_blocked_already_claimed";
    }

    // Stripe constraint: cannot send allow_promotion_codes with discounts.
    const createSession = (resolvedCustomerId: string) =>
        stripe.checkout.sessions.create({
            mode: "subscription",
            customer: resolvedCustomerId,
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

            ...(discounts?.length ? { discounts } : { allow_promotion_codes: true }),

            subscription_data: {
                ...(includeTrial ? { trial_period_days: STRIPE_TRIAL_DAYS } : {}),
                metadata: baseMeta,
            },
        });

    let session;
    try {
        session = await createSession(customerId);
    } catch (err: any) {
        if (customerId && isMissingStripeCustomerError(err)) {
            customerId = await createAndPersistCustomer();
            session = await createSession(customerId);
        } else {
            await notifyStripeSubscriptionError({
                action: "billing.createCheckoutSession.createSession",
                uid,
                error: err,
                extra: { plan, customerId, priceId, includeTrial, hasDiscounts: Boolean(discounts?.length) },
            });
            throw err;
        }
    }

    return NextResponse.json({ url: session.url }, { status: 200 });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, handler, {
        csrf: true,
        methods: ["POST"],
    });
}
