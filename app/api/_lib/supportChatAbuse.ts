import "server-only";

import { getStripe } from "@/lib/stripe";
import { getAdminDb } from "@/app/api/_lib/auth";
import { checkStripeCheckoutAbuse } from "@/app/api/_lib/stripeCheckoutAbuse";

/** Applies the same recent-subscription Stripe abuse screen used by billing
 * before a signed-in account can access support chat.
 */
export async function checkSupportChatAccount(uid: string): Promise<"passed" | "blocked"> {
    const db = getAdminDb();
    const userRef = db.collection("kloner_users").doc(uid);
    const userSnap = await userRef.get();
    const user = userSnap.exists ? userSnap.data() as Record<string, any> : {};
    const customerId = typeof user.stripeCustomerId === "string" ? user.stripeCustomerId : "";

    if (user.abuseBlocklistBlocked === true) return "blocked";
    if (!customerId) return "passed";

    const stripe = getStripe();
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
    if (!subscriptions.data.length) return "passed";

    const priority = new Map<string, number>([
        ["active", 1], ["trialing", 2], ["past_due", 3], ["unpaid", 4],
        ["incomplete", 5], ["incomplete_expired", 6], ["paused", 7], ["canceled", 99],
    ]);
    const subscription = [...subscriptions.data].sort((a, b) => {
        const scoreA = priority.get(a.status) ?? 50;
        const scoreB = priority.get(b.status) ?? 50;
        return scoreA - scoreB || b.created - a.created;
    })[0];
    const needsCheck = user.abuseBlocklistBlocked === true ||
        subscription.metadata?.abuseBlocklistCheck === "1" ||
        Date.now() - subscription.created * 1000 < 24 * 60 * 60 * 1000;
    if (!needsCheck) return "passed";

    const result = await checkStripeCheckoutAbuse({ uid, subscriptionId: subscription.id, stripe });
    return result.outcome;
}
