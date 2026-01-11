// app/api/billing/tier/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import {
    refreshTierFromStripeForUid,
    type UserTier,
} from "../../_lib/billing";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const db = admin.firestore();

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            try {
                const { searchParams } = new URL(req.url);
                const refresh = searchParams.get("refresh") === "1";

                let tier: UserTier = "free";
                let userData: any = {};

                const userRef = db.collection("kloner_users").doc(uid);
                const snap = await userRef.get();
                if (snap.exists) {
                    userData = snap.data();
                }

                const source: string | undefined = userData.tierSource;

                const stripeStatus = typeof userData.stripeStatus === "string" ? userData.stripeStatus : null;
                const stripeSubId = typeof userData.stripeSubscriptionId === "string" ? userData.stripeSubscriptionId : "";
                const storedTier = (userData.tier as UserTier) || "free";

                // Self-heal: if Stripe shows an active/trialing subscription but Firestore tier is still free,
                // force a refresh from Stripe. This is critical for redirect flows (checkout success → resume wizard)
                // and for production env misconfig incidents.
                const looksPaidButTierFree =
                    storedTier === "free" &&
                    !!stripeSubId &&
                    (stripeStatus === "active" || stripeStatus === "trialing");

                // force refresh, or if we don't yet trust that Firestore tier
                if (
                    refresh ||
                    looksPaidButTierFree ||
                    !source || // no source set yet
                    source !== "stripe" // make Stripe the source of truth
                ) {
                    tier = await refreshTierFromStripeForUid(uid);
                    const freshSnap = await userRef.get();
                    userData = freshSnap.exists ? freshSnap.data() : {};
                } else {
                    tier = (userData.tier as UserTier) || "free";
                }

                return NextResponse.json(
                    {
                        uid,
                        tier,
                        stripeStatus: userData.stripeStatus ?? null,
                        currentPeriodEnd: userData.stripeCurrentPeriodEnd ?? null,
                        cancelAtPeriodEnd: userData.stripeCancelAtPeriodEnd ?? null,
                        source: userData.tierSource ?? "stripe",
                    },
                    { status: 200 }
                );
            } catch (err) {
                console.error("billing/tier error", err);
                return NextResponse.json(
                    { error: "Internal error" },
                    { status: 500 }
                );
            }
        },
        { methods: ["GET"] }
    );
}
