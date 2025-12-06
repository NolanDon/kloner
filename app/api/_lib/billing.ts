// app/api/_lib/billing.ts
import admin from "firebase-admin";
import { getStripe } from "@/lib/stripe";
import {
    monthlyLimitFor,
    type CreditKind as CoreCreditKind,
} from "@/src/lib/credits";

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

/**
 * Use Stripe currentPeriodEnd if present, else end of current calendar month (UTC).
 */
function computeCreditPeriodEnd(stripeData?: {
    currentPeriodEnd?: number;
}): Date {
    if (stripeData?.currentPeriodEnd && typeof stripeData.currentPeriodEnd === "number") {
        // Stripe gives seconds since epoch
        return new Date(stripeData.currentPeriodEnd * 1000);
    }

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-based
    const firstNextMonth = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
    return new Date(firstNextMonth.getTime() - 1);
}

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

    // Read existing to decide whether to reset credits
    const existingSnap = await userRef.get();
    const existingData = existingSnap.exists ? (existingSnap.data() as any) : {};

    const previousTier: Tier | undefined = existingData.tier;
    const previousStripePeriodEnd: number | undefined =
        typeof existingData.stripeCurrentPeriodEnd === "number"
            ? existingData.stripeCurrentPeriodEnd
            : undefined;

    const newStripePeriodEnd: number | undefined =
        stripeData && typeof stripeData.currentPeriodEnd === "number"
            ? stripeData.currentPeriodEnd
            : undefined;

    // Only reset credits when:
    //  - first time (no doc), OR
    //  - tier changed, OR
    //  - Stripe period boundary changed (new billing cycle)
    const shouldResetCredits =
        !existingSnap.exists ||
        previousTier !== tier ||
        (newStripePeriodEnd &&
            newStripePeriodEnd !== previousStripePeriodEnd);

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

    const update: Record<string, unknown> = { ...payload };

    if (shouldResetCredits) {
        // Compute new limits for this tier from central credit config
        const previewLimit = monthlyLimitFor(tier, "preview" as CoreCreditKind);
        const screenshotLimit = monthlyLimitFor(
            tier,
            "screenshot" as CoreCreditKind
        );

        // Decide what period end to attach to reset credits
        const periodEndDate = computeCreditPeriodEnd(stripeData);
        const periodEndTs = admin.firestore.Timestamp.fromDate(periodEndDate);

        if (previewLimit !== undefined && previewLimit !== null) {
            update["credits.preview"] =
                previewLimit === 0
                    ? {
                        monthlyLimit: 0,
                        remaining: null,
                        periodEnd: periodEndTs,
                    }
                    : {
                        monthlyLimit: previewLimit,
                        remaining: previewLimit,
                        periodEnd: periodEndTs,
                    };
        }

        if (screenshotLimit !== undefined && screenshotLimit !== null) {
            update["credits.snapshot"] =
                screenshotLimit === 0
                    ? {
                        monthlyLimit: 0,
                        remaining: null,
                        periodEnd: periodEndTs,
                    }
                    : {
                        monthlyLimit: screenshotLimit,
                        remaining: screenshotLimit,
                        periodEnd: periodEndTs,
                    };
        }
    }

    // Apply tier metadata (and optional credit reset) in one write
    await userRef.set(update, { merge: true });

    // Update custom claims without clearing existing ones
    const user = await admin.auth().getUser(uid);
    const existingClaims = user.customClaims || {};

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

/** Helper: store mapping of Stripe customer to uid */
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

    // Cast to any for snake_case Stripe fields that TS does not know
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
