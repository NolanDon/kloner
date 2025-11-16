// app/api/billing/create-checkout-session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { verifySession } from "../../_lib/auth";
import { linkCustomerToUid } from "../../_lib/billing";
import admin from "firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const db = admin.firestore();

export async function POST(req: NextRequest) {
    try {
        const { uid } = await verifySession(req);

        const body = await req.json().catch(() => ({}));
        const { plan } = body as { plan?: "pro" | "agency" };

        if (!plan) {
            return NextResponse.json(
                { error: "Missing plan" },
                { status: 400 }
            );
        }

        const priceId =
            plan === "pro"
                ? process.env.STRIPE_PRICE_PRO
                : process.env.STRIPE_PRICE_AGENCY;

        if (!priceId) {
            return NextResponse.json(
                { error: "Stripe price not configured" },
                { status: 500 }
            );
        }

        // get or create Stripe customer
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

        const successUrl =
            process.env.STRIPE_SUCCESS_URL ??
            "https://kloner.app/dashboard?billing=success";
        const cancelUrl =
            process.env.STRIPE_CANCEL_URL ??
            "https://kloner.app/price?billing=cancelled";

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
