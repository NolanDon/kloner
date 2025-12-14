// app/api/billing/create-checkout-session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import admin from "firebase-admin";
import { linkCustomerToUid } from "../../_lib/billing";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const stripe = getStripe();

const db = admin.firestore();

async function handler({ req, uid }: { req: NextRequest; uid: string }) {
    const body = await req.json().catch(() => ({}));
    const { plan, returnRenderId, returnStep } = body as any;
    if (!plan) {
        return NextResponse.json({ error: "Missing plan" }, { status: 400 });
    }

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
            { status: 500 }
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

        const customer = await stripe.customers.create({
            email,
            metadata: {
                firebaseUid: uid,
                ...(affiliateRef ? { affiliateRef } : {}),
                ...(affiliateSource ? { affiliateSource } : {}),
            },
        });

        customerId = customer.id;

        await userRef.set(
            {
                stripeCustomerId: customerId,
            },
            { merge: true }
        );

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

    const appOrigin = isProd
        ? process.env.NEXT_PUBLIC_APP_ORIGIN || "https://kloner.app"
        : process.env.NEXT_PUBLIC_APP_ORIGIN || "http://localhost:3000";

    let successUrl: string;

    if (returnRenderId && returnStep) {
        const step = returnStep || 2;
        successUrl = `${appOrigin}/dashboard/view?wizard=1&step=${step}&render=${encodeURIComponent(
            returnRenderId || ""
        )}&billing=success`;
    } else {
        successUrl = `${appOrigin}/dashboard/view?billing=success`;
    }

    const cancelUrl = `${appOrigin}/price?billing=cancelled`;

    const baseMeta = {
        firebaseUid: uid,
        plan,
        ...(affiliateRef ? { affiliateRef } : {}),
        ...(affiliateSource ? { affiliateSource } : {}),
    };

    const TRIAL_DAYS = 7;

    const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: uid,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: baseMeta,
        subscription_data: {
            trial_period_days: TRIAL_DAYS,
            metadata: baseMeta,
            // optional but recommended: if you require payment method up-front, keep default behavior.
            // If you ever set `payment_method_collection: "if_required"` elsewhere, remove that for trials.
        },
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, handler, {
        csrf: true,
        methods: ["POST"],
    });
}
