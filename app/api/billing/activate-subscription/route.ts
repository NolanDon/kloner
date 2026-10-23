import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/app/api/_lib/auth";
import { requireSessionAndMaybeCsrf } from "@/app/api/_lib/route-guard";
import { refreshTierFromStripeForUid } from "@/app/api/_lib/billing";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

// Called only after the download paywall explicitly confirms that billing starts today.
export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const user = (await getAdminDb().collection("kloner_users").doc(uid).get()).data() || {};
        if (!user.stripeSubscriptionId || !user.stripeCustomerId) {
            return NextResponse.json({ error: "No subscription found. Please subscribe first." }, { status: 409 });
        }
        const stripe = getStripe();
        const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
        if (customerId !== user.stripeCustomerId) return NextResponse.json({ error: "Subscription does not match this account." }, { status: 403 });
        if (subscription.status !== "active" && subscription.status !== "trialing") {
            return NextResponse.json({ error: "Please update your subscription and payment method in account settings." }, { status: 409 });
        }
        if (subscription.status === "trialing") {
            try {
                await stripe.subscriptions.update(subscription.id, {
                    trial_end: "now", payment_behavior: "error_if_incomplete", proration_behavior: "none",
                }, { idempotencyKey: `activate-paid:${uid}:${subscription.id}` });
            } catch {
                return NextResponse.json({ error: "Your payment could not be completed. Update your payment method in account settings, then retry." }, { status: 402 });
            }
        }
        await refreshTierFromStripeForUid(uid);
        return NextResponse.json({ ok: true });
    }, { csrf: true, methods: ["POST"] });
}
