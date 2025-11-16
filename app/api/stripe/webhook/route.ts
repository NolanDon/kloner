// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import {
    getUidForStripeCustomer,
    linkCustomerToUid,
    mapPriceToTier,
    setUserTierFromStripe,
} from "../../_lib/billing";
import admin from "firebase-admin";
import type Stripe from "stripe";

const stripe = getStripe();
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// minimal admin init (same pattern as billing.ts, safe with guard)
if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT missing for webhook");
    }

    let credJson: admin.ServiceAccount;
    try {
        credJson = JSON.parse(raw);
    } catch {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        credJson = JSON.parse(decoded);
    }

    admin.initializeApp({
        credential: admin.credential.cert(credJson),
    });
}
const db = admin.firestore();

/** Fallback: find uid by stripeCustomerId field if mapping doc is missing */
async function findUidByCustomerId(customerId: string): Promise<string | null> {
    const snap = await db
        .collection("kloner_users")
        .where("stripeCustomerId", "==", customerId)
        .limit(1)
        .get();

    if (snap.empty) return null;
    return snap.docs[0]!.id;
}

export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");

    if (!webhookSecret || !sig) {
        console.error("Stripe webhook: missing secret or signature");
        return NextResponse.json({ error: "Webhook misconfigured" }, { status: 400 });
    }

    const body = await req.text();
    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err: any) {
        console.error(
            "Stripe webhook signature verification failed",
            err?.message || err
        );
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;

                const firebaseUid = session.metadata?.firebaseUid as
                    | string
                    | undefined;

                const customerId =
                    typeof session.customer === "string"
                        ? session.customer
                        : session.customer?.id;

                if (!firebaseUid || !customerId) {
                    console.warn(
                        "checkout.session.completed without firebaseUid or customerId; ignoring",
                        { firebaseUid, customerId }
                    );
                    break;
                }

                await linkCustomerToUid(customerId, firebaseUid);
                // subscription.* events will perform the tier update
                break;
            }

            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
            case "customer.subscription.trial_will_end": {
                const sub = event.data.object as Stripe.Subscription;

                const customerId =
                    typeof sub.customer === "string"
                        ? sub.customer
                        : sub.customer.id;

                if (!customerId) {
                    console.warn(
                        "subscription event without customerId; ignoring",
                        event.id
                    );
                    break;
                }

                // 1) try mapping table
                let uid = await getUidForStripeCustomer(customerId);

                // 2) fall back to kloner_users where stripeCustomerId == customerId
                if (!uid) {
                    uid = await findUidByCustomerId(customerId);
                    if (uid) {
                        await linkCustomerToUid(customerId, uid);
                    }
                }

                if (!uid) {
                    console.warn(
                        "Stripe webhook: no uid mapping and no kloner_users match for customer",
                        customerId
                    );
                    break;
                }

                const firstItem = sub.items?.data?.[0];
                const priceId =
                    typeof firstItem?.price?.id === "string"
                        ? firstItem.price.id
                        : null;

                const tier = mapPriceToTier(priceId);

                const status = sub.status;
                const effectiveTier =
                    status === "active" || status === "trialing" ? tier : "free";

                await setUserTierFromStripe(uid, effectiveTier, {
                    customerId,
                    subscriptionId: sub.id,
                    priceId,
                    status,
                    currentPeriodEnd: (sub as any).current_period_end ?? undefined,
                    cancelAtPeriodEnd: (sub as any).cancel_at_period_end ?? undefined,
                });

                break;
            }

            default:
                // ignore everything else quietly
                break;
        }

        return NextResponse.json({ received: true });
    } catch (err) {
        console.error("Stripe webhook handler error", err);
        return NextResponse.json({ error: "Webhook handler error" }, { status: 500 });
    }
}
