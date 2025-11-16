// app/api/_lib/billing.ts
import admin from "firebase-admin";
import { getStripe } from "@/lib/stripe";

export type UserTier = "free" | "pro" | "agency";
export type Tier = UserTier;

const stripe = getStripe();

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

/** Map Stripe price IDs (test + live) to an internal tier string. */
export function mapPriceToTier(priceId: string | null | undefined): UserTier {
    if (!priceId) return "free";

    const proIds = [
        process.env.STRIPE_PRICE_PRO_TEST,
        process.env.STRIPE_PRICE_PRO_PRO,
    ].filter(Boolean) as string[];

    const agencyIds = [
        process.env.STRIPE_PRICE_AGENCY_TEST,
        process.env.STRIPE_PRICE_PRO_AGENCY,
    ].filter(Boolean) as string[];

    if (proIds.includes(priceId)) return "pro";
    if (agencyIds.includes(priceId)) return "agency";

    console.warn("mapPriceToTier: unknown price id", priceId);
    return "free";
}

/** Update Firestore + customClaims in a single place */
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

    // keep both keys to stay compatible with existing client code
    const newClaims = {
        ...existingClaims,
        tier,
        userTier: tier,
    };

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

export async function refreshTierFromStripeForUid(uid: string): Promise<Tier> {
    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();
    const data = snap.exists ? (snap.data() as any) : {};
    const customerId: string | undefined = data.stripeCustomerId;

    if (!customerId) {
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

    // Cast to any for snake_case Stripe fields that TS doesn't know about
    const subAny = subs.data[0] as any;

    const firstItem = subAny.items?.data?.[0];
    const priceId =
        typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;

    const tier = mapPriceToTier(priceId);

    const currentPeriodEnd: number | undefined =
        typeof subAny.current_period_end === "number"
            ? subAny.current_period_end
            : undefined;

    const cancelAtPeriodEnd: boolean | null =
        typeof subAny.cancel_at_period_end === "boolean"
            ? subAny.cancel_at_period_end
            : null;

    await setUserTierFromStripe(uid, tier, {
        customerId,
        subscriptionId: subAny.id as string,
        priceId,
        status: subAny.status as string,
        currentPeriodEnd,
        cancelAtPeriodEnd,
    });

    return tier;
}

