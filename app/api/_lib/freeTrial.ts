import { createHash } from "node:crypto";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "./auth";

const TRIAL_CLAIMS = "kloner_free_trial_claims";

export function normalizeBillingEmail(email: string | null | undefined): string {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function emailClaimId(email: string): string {
    return createHash("sha256").update(normalizeBillingEmail(email)).digest("hex");
}

/**
 * Trial eligibility must follow the Kloner account/email, not a single Stripe
 * customer ID. Customers can be recreated, while their subscription history
 * remains relevant to trial eligibility.
 */
export async function hasPriorSubscriptionHistoryForAccount(params: {
    uid: string;
    email?: string | null;
    stripe: Stripe;
}): Promise<boolean> {
    const { uid, stripe } = params;
    const email = normalizeBillingEmail(params.email);
    const db = getAdminDb();
    const userRef = db.collection("kloner_users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? (userSnap.data() as Record<string, any>) : {};

    if (userData.freeTrialUsedAt || userData.freeTrialUsed === true) return true;

    if (email) {
        const claim = await db.collection(TRIAL_CLAIMS).doc(emailClaimId(email)).get();
        if (claim.exists) return true;
    }

    const customerIds = new Set<string>();
    if (typeof userData.stripeCustomerId === "string" && userData.stripeCustomerId) {
        customerIds.add(userData.stripeCustomerId);
    }

    const mappedCustomers = await db
        .collection("stripe_customers")
        .where("uid", "==", uid)
        .get();
    for (const customer of mappedCustomers.docs) customerIds.add(customer.id);

    // Include Stripe customers created by earlier/duplicate account records
    // using the same email. Empty top-up-only customers do not count as history.
    if (email) {
        const customers = await stripe.customers.list({ email, limit: 100 });
        for (const customer of customers.data) customerIds.add(customer.id);
    }

    const history = await Promise.all(
        [...customerIds].map((customer) =>
            stripe.subscriptions.list({ customer, status: "all", limit: 1 }),
        ),
    );
    return history.some((result) => result.data.length > 0);
}

/** Persist trial use so cancellation, customer replacement, or account relinking cannot reset eligibility. */
export async function markFreeTrialUsed(params: {
    uid: string;
    subscriptionId?: string | null;
    email?: string | null;
}): Promise<void> {
    const { uid } = params;
    let email = normalizeBillingEmail(params.email);
    if (!email) {
        try {
            const user = await getAdminAuth().getUser(uid);
            email = normalizeBillingEmail(user.email);
        } catch {
            // The UID marker still protects this account if Auth lookup is unavailable.
        }
    }

    const db = getAdminDb();
    const usedAt = new Date();
    const batch = db.batch();
    batch.set(
        db.collection("kloner_users").doc(uid),
        {
            freeTrialUsed: true,
            freeTrialUsedAt: usedAt,
            ...(params.subscriptionId ? { freeTrialSubscriptionId: params.subscriptionId } : {}),
        },
        { merge: true },
    );

    if (email) {
        batch.set(
            db.collection(TRIAL_CLAIMS).doc(emailClaimId(email)),
            {
                uid,
                usedAt,
                ...(params.subscriptionId ? { subscriptionId: params.subscriptionId } : {}),
            },
            { merge: true },
        );
    }

    await batch.commit();
}
