// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import {
    getUidForStripeCustomer,
    linkCustomerToUid,
    mapPriceToTier,
    setUserTierFromStripe,
} from "../_lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");

    if (!webhookSecret || !sig) {
        return NextResponse.json({ error: "Webhook misconfigured" }, { status: 400 });
    }

    let event;
    const body = await req.text();

    try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err: any) {
        console.error("Stripe webhook signature verification failed", err?.message);
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as any;

                const firebaseUid: string | undefined = session.metadata?.firebaseUid;
                const customerId: string | undefined =
                    typeof session.customer === "string" ? session.customer : undefined;

                if (!firebaseUid || !customerId) break;

                await linkCustomerToUid(customerId, firebaseUid);
                // subscription events will finish the tier update
                break;
            }

            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
            case "customer.subscription.trial_will_end": {
                const sub = event.data.object as any;

                const customerId: string =
                    typeof sub.customer === "string" ? sub.customer : "";
                if (!customerId) break;

                const uid = await getUidForStripeCustomer(customerId);
                if (!uid) {
                    console.warn(
                        "Stripe webhook: no uid mapping for customer",
                        customerId
                    );
                    break;
                }

                const firstItem = sub.items?.data?.[0];
                const priceId: string | null =
                    typeof firstItem?.price?.id === "string"
                        ? firstItem.price.id
                        : null;

                const tier = mapPriceToTier(priceId);

                // If subscription is canceled/expired, downgrade to free
                const status: string = sub.status;
                const effectiveTier =
                    status === "active" || status === "trialing" ? tier : "free";

                await setUserTierFromStripe(uid, effectiveTier, {
                    customerId,
                    subscriptionId: sub.id,
                    priceId,
                    status,
                    currentPeriodEnd: sub.current_period_end,
                    cancelAtPeriodEnd: sub.cancel_at_period_end,
                });

                break;
            }

            default:
                // ignore everything else
                break;
        }

        return NextResponse.json({ received: true });
    } catch (err) {
        console.error("Stripe webhook handler error", err);
        return NextResponse.json({ error: "Webhook handler error" }, { status: 500 });
    }
}
