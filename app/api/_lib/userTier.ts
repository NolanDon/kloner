// src/app/api/_lib/userTier.ts
import { getAdminDb } from "./auth";
import { refreshTierFromStripeForUid, type UserTier } from "./billing";

function toDateFromFirestoreTimestampLike(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === "function") {
        try {
            return v.toDate();
        } catch {
            return null;
        }
    }
    return null;
}

function getActiveTierOverride(data: any, now: Date): UserTier | null {
    if (!data || typeof data !== "object") return null;
    const rawTier = typeof data.tierOverrideTier === "string" ? data.tierOverrideTier : "";
    const rawReason = typeof data.tierOverrideReason === "string" ? data.tierOverrideReason : "";
    const reason = rawReason.trim().toLowerCase();
    const until = toDateFromFirestoreTimestampLike(data.tierOverrideUntil);
    if (!rawTier || !until) return null;
    if (!(now < until)) return null;

    const t = rawTier.toLowerCase();
    if (t === "free" || t === "pro" || t === "agency") return t as UserTier;
    return "free";
}

/**
 * Authoritative tier lookup.
 *
 * Logic:
 *  - If Firestore has tierSource = "stripe", trust `tier`.
 *  - Otherwise call refreshTierFromStripeForUid(uid), which:
 *      * hits Stripe
 *      * writes tier + tierSource = "stripe" into kloner_users/{uid}
 *      * returns the tier
 */
export async function getAuthoritativeUserTier(uid: string): Promise<UserTier> {
    const db = getAdminDb();
    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();

    let userData: any = snap.exists ? snap.data() : {};

    // Fraud prevention / manual overrides (e.g., cancel during trial) win.
    const now = new Date();
    const overrideTier = getActiveTierOverride(userData, now);
    if (overrideTier) return overrideTier;

    const source: string | undefined = userData.tierSource;
    const storedTier = (userData.tier as UserTier) || "free";
    const stripeStatus = typeof userData?.stripeStatus === "string" ? userData.stripeStatus : null;
    const stripeSubId = typeof userData?.stripeSubscriptionId === "string" ? userData.stripeSubscriptionId.trim() : "";
    const stripeCancelAtPeriodEnd = userData?.stripeCancelAtPeriodEnd === true;

    const needsDowngradeReconcile =
        storedTier !== "free" &&
        (stripeCancelAtPeriodEnd ||
            !stripeSubId ||
            stripeStatus === "canceled" ||
            stripeStatus === "incomplete_expired" ||
            stripeStatus === "paused" ||
            stripeStatus === "past_due" ||
            stripeStatus === "unpaid" ||
            stripeStatus === "incomplete");

    if (!source || source !== "stripe" || needsDowngradeReconcile) {
        // This helper already updates Firestore and returns the tier.
        const tier = await refreshTierFromStripeForUid(uid);

        // Optional: reload userData if you need more fields afterwards.
        // const fresh = await userRef.get();
        // userData = fresh.exists ? fresh.data() : {};

        return tier;
    }

    return storedTier;
}
