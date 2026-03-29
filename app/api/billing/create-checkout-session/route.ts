// app/api/billing/create-checkout-session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import admin from "firebase-admin";
import { linkCustomerToUid } from "../../_lib/billing";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { captureCriticalEvent, captureException } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = getStripe();
const db = admin.firestore();

const TRIAL_DAYS = 7;

// Exit-offer rules
const EXIT_OFFER_MS = 15 * 60 * 1000;
const EXIT_OFFER_SKEW_MS = 30 * 1000; // client clock tolerance

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
        ? "6ugbzul1"
        : process.env.STRIPE_EXIT40_COUPON_TEST;

    return { promo, coupon };
}

function isValidExitOfferPayload(payload: { offer?: unknown; offerEndsAt?: unknown }) {
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

    // Only Pro can be eligible for trial. Final decision is made after checking
    // Stripe subscription history for this customer.
    const trialCandidate = plan === "pro";

    const isProd = process.env.NODE_ENV === "production";

    const priceId =
        plan === "pro"
            ? isProd
                ? process.env.STRIPE_PRICE_PRO_PROD
                : process.env.STRIPE_PRICE_PRO_TEST
            : isProd
                ? process.env.STRIPE_PRICE_PRO_AGENCY
                : process.env.STRIPE_PRICE_AGENCY_TEST;

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

    if (!customerId) {
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

        customerId = customer.id;

        await userRef.set({ stripeCustomerId: customerId }, { merge: true });
        await linkCustomerToUid(customerId, uid);
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
            } catch {
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
        await notifyStripeSubscriptionError({
            action: "billing.createCheckoutSession.listSubscriptions",
            uid,
            error: err,
            extra: { plan, customerId },
        });
        throw err;
    }

    const activeOrTrialing = existingSubs.data.filter(
        (sub) => sub.status === "active" || sub.status === "trialing"
    );

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

    const cancelUrl = `${appOrigin}/price?billing=cancelled`;

    const baseMeta: Record<string, string> = {
        firebaseUid: uid,
        plan,
        ...(affiliateRef ? { affiliateRef } : {}),
        ...(affiliateSource ? { affiliateSource } : {}),
        ...(returnAppId ? { returnAppId: String(returnAppId) } : {}),
        ...(returnRenderId ? { returnRenderId: String(returnRenderId) } : {}),
        ...(returnStep ? { returnStep: String(returnStep) } : {}),
        ...(isAppDeployTrialSuccess ? { checkoutFlow: "app_deploy_trial" } : {}),
    };

    // ---- exit-offer discount resolution ----
    const exitOfferRequested = isValidExitOfferPayload({ offer, offerEndsAt });
    const exitOfferGranted = exitOfferRequested ? await claimExitOfferOnce(userRef) : false;

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
    let session;
    try {
        session = await stripe.checkout.sessions.create({
            mode: "subscription",
            customer: customerId,
            client_reference_id: uid,
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: baseMeta,

            ...(discounts?.length ? { discounts } : { allow_promotion_codes: true }),

            subscription_data: {
                ...(includeTrial ? { trial_period_days: TRIAL_DAYS } : {}),
                metadata: baseMeta,
            },
        });
    } catch (err: any) {
        await notifyStripeSubscriptionError({
            action: "billing.createCheckoutSession.createSession",
            uid,
            error: err,
            extra: { plan, customerId, priceId, includeTrial, hasDiscounts: Boolean(discounts?.length) },
        });
        throw err;
    }

    return NextResponse.json({ url: session.url }, { status: 200 });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, handler, {
        csrf: true,
        methods: ["POST"],
    });
}
