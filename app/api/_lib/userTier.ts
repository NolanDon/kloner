// src/app/api/_lib/userTier.ts
import { getAdminDb } from "./auth";
import { refreshTierFromStripeForUid, type UserTier } from "./billing";

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
    const source: string | undefined = userData.tierSource;

    if (!source || source !== "stripe") {
        // This helper already updates Firestore and returns the tier.
        const tier = await refreshTierFromStripeForUid(uid);

        // Optional: reload userData if you need more fields afterwards.
        // const fresh = await userRef.get();
        // userData = fresh.exists ? fresh.data() : {};

        return tier;
    }

    return (userData.tier as UserTier) || "free";
}
