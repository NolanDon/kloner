// app/api/_lib/billing.ts
import admin from "firebase-admin";
import { stripe } from "@/lib/stripe";

type Tier = "free" | "pro" | "agency";

if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");

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

/** Map Stripe price ID to internal tier */
export function mapPriceToTier(priceId: string | null | undefined): Tier {
    if (!priceId) return "free";

    if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
    if (priceId === process.env.STRIPE_PRICE_AGENCY) return "agency";

    // default fallback if you later add more plans
    return "free";
}

/** Update Firestore + customClaims.tier in a single place */
export async function setUserTierFromStripe(
    uid: string,
    tier: Tier,
    stripeData?: {
        customerId?: string;
        subscriptionId?: string;
        priceId?: string | null;
        status?: string;
        currentPeriodEnd?: number;
        cancelAtPeriodEnd?: boolean | null;
    }
): Promise<void> {
    const userRef = db.collection("kloner_users").doc(uid);

    // merge tier + billing fields into user doc
    const payload: Record<string, unknown> = {
        tier,
        tierSource: "stripe",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (stripeData) {
        if (stripeData.customerId) payload.stripeCustomerId = stripeData.customerId;
        if (stripeData.subscriptionId)
            payload.stripeSubscriptionId = stripeData.subscriptionId;
        if (stripeData.priceId) payload.stripePriceId = stripeData.priceId;
        if (stripeData.status) payload.stripeStatus = stripeData.status;
        if (stripeData.currentPeriodEnd)
            payload.stripeCurrentPeriodEnd = stripeData.currentPeriodEnd;
        if (typeof stripeData.cancelAtPeriodEnd === "boolean")
            payload.stripeCancelAtPeriodEnd = stripeData.cancelAtPeriodEnd;
    }

    await userRef.set(payload, { merge: true });

    // update custom claims without nuking others
    const user = await admin.auth().getUser(uid);
    const existingClaims = user.customClaims || {};
    const newClaims = { ...existingClaims, tier };

    await admin.auth().setCustomUserClaims(uid, newClaims);
}

/** Helper: lookup uid for a Stripe customer */
export async function getUidForStripeCustomer(
    customerId: string
): Promise<string | null> {
    const ref = db.collection("stripe_customers").doc(customerId);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data() as { uid?: string };
    return data?.uid ?? null;
}

/** Helper: store mapping of Stripe customer -> uid */
export async function linkCustomerToUid(customerId: string, uid: string) {
    const ref = db.collection("stripe_customers").doc(customerId);
    await ref.set(
        {
            uid,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    );
}

/** Fetch latest subscription from Stripe for a customer, derive tier, persist */
export async function refreshTierFromStripeForUid(uid: string): Promise<Tier> {
    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();
    const data = snap.exists ? (snap.data() as any) : {};
    const customerId: string | undefined = data.stripeCustomerId;

    if (!customerId) {
        // no Stripe customer yet -> free tier
        await setUserTierFromStripe(uid, "free");
        return "free";
    }

    const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 1,
    });

    if (!subs.data.length) {
        await setUserTierFromStripe(uid, "free", {
            customerId,
        });
        return "free";
    }

    const sub = subs.data[0];
    const firstItem = sub.items.data[0];
    const priceId = typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;

    const tier = mapPriceToTier(priceId);

    await setUserTierFromStripe(uid, tier, {
        customerId,
        subscriptionId: sub.id,
        priceId,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
    });

    return tier;
}
