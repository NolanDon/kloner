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

    // delete-me
    // const priceId = plan === "pro" ? process.env.STRIPE_PRICE_PRO_TEST : process.env.STRIPE_PRICE_AGENCY_TEST;

    if (!priceId) {
        return NextResponse.json(
            { error: "Stripe price not configured for current environment" },
            { status: 500 }
        );
    }

    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();
    const userData = snap.exists ? (snap.data() as any) : {};
    let customerId: string | undefined = userData.stripeCustomerId;

    if (!customerId) {
        const authUser = await admin.auth().getUser(uid);
        const email = authUser.email ?? undefined;

        const customer = await stripe.customers.create({
            email,
            metadata: { firebaseUid: uid },
        });

        customerId = customer.id;

        await userRef.set(
            {
                stripeCustomerId: customerId,
            },
            { merge: true }
        );

        await linkCustomerToUid(customerId, uid);
    }


    const appOrigin = isProd
        ? process.env.NEXT_PUBLIC_APP_ORIGIN || "https://kloner.app"
        : process.env.NEXT_PUBLIC_APP_ORIGIN || "http://localhost:3000";

    // delete-me
    // const appOrigin = "https://kloner.app"

    let successUrl: string;

    if (returnRenderId && returnStep) {
        // always go through /dashboard/view for wizard flows
        const step = returnStep || 2;
        successUrl = `${appOrigin}/dashboard/view?wizard=1&step=${step}&render=${encodeURIComponent(
            returnRenderId || "",
        )}&billing=success`;
    } else {
        // generic billing success
        successUrl = `${appOrigin}/dashboard/view?billing=success`;
    }

    // const cancelUrl = isProd
    //     ? process.env.STRIPE_CANCEL_URL_PROD ||
    //     "https://kloner.app/price?billing=cancelled"
    //     : process.env.STRIPE_CANCEL_URL_TEST ||
    //     "http://localhost:3000/price?billing=cancelled";


    // delete-me
    const cancelUrl = "https://kloner.app/price?billing=cancelled"

    const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            firebaseUid: uid,
            plan,
        },
        subscription_data: {
            metadata: {
                firebaseUid: uid,
                plan,
            },
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
