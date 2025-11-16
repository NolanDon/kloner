// app/api/billing/create-checkout-session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { verifySession } from "../../_lib/auth";
import { linkCustomerToUid } from "../../_lib/billing";
import admin from "firebase-admin";

const stripe = getStripe();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const db = admin.firestore();

export async function POST(req: NextRequest) {
    try {
        const { uid } = await verifySession(req);

        const body = await req.json().catch(() => ({}));
        const { plan } = body as { plan?: "pro" | "agency" };

        if (!plan) {
            return NextResponse.json({ error: "Missing plan" }, { status: 400 });
        }

        const isProd = process.env.NODE_ENV === "production";

        const priceId =
            plan === "pro"
                ? isProd
                    ? process.env.STRIPE_PRICE_PRO_PRO // live Pro
                    : process.env.STRIPE_PRICE_PRO_TEST // test Pro
                : isProd
                    ? process.env.STRIPE_PRICE_PRO_AGENCY // live Agency
                    : process.env.STRIPE_PRICE_AGENCY_TEST; // test Agency

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

        // Ensure Stripe customer exists
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

        const successUrl = isProd
            ? process.env.STRIPE_SUCCESS_URL_PROD ||
            "https://kloner.app/dashboard?billing=success"
            : process.env.STRIPE_SUCCESS_URL_TEST ||
            "http://localhost:3000/dashboard?billing=success";

        const cancelUrl = isProd
            ? process.env.STRIPE_CANCEL_URL_PROD ||
            "https://kloner.app/price?billing=cancelled"
            : process.env.STRIPE_CANCEL_URL_TEST ||
            "http://localhost:3000/price?billing=cancelled";

        // 1) Check for an existing active subscription
        const existingSubs = await stripe.subscriptions.list({
            customer: customerId,
            status: "active",
            limit: 1,
        });

        if (existingSubs.data.length > 0) {
            const sub = existingSubs.data[0];
            const firstItem = sub.items.data[0];

            const currentPriceId =
                typeof firstItem?.price?.id === "string"
                    ? firstItem.price.id
                    : null;

            // If already on this price, just bounce back to dashboard
            if (currentPriceId === priceId) {
                return NextResponse.json(
                    { url: successUrl, alreadyOnPlan: true },
                    { status: 200 }
                );
            }

            // 2) Upgrade/downgrade in-place with proration
            await stripe.subscriptions.update(sub.id, {
                items: [
                    {
                        id: firstItem.id,
                        price: priceId,
                    },
                ],
                proration_behavior: "create_prorations",
                metadata: {
                    firebaseUid: uid,
                    plan,
                },
            });

            // Your webhook / tier refresh logic will pick this up.
            // Send user back to dashboard with success flag.
            return NextResponse.json(
                { url: successUrl, upgraded: true },
                { status: 200 }
            );
        }

        // 3) No existing subscription -> first-time purchase via Checkout
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
    } catch (err: any) {
        console.error("create-checkout-session error", err);
        return NextResponse.json(
            { error: "Internal error" },
            { status: 500 }
        );
    }
}
