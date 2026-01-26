// app/api/billing/tier/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import {
    refreshTierFromStripeForUid,
    type UserTier,
} from "../../_lib/billing";
import { monthlyLimitFor } from "@/src/lib/credits";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const db = admin.firestore();

function toFirestoreTsOrDate(date: Date): any {
    const ts = (admin as any)?.firestore?.Timestamp;
    if (ts && typeof ts.fromDate === "function") return ts.fromDate(date);
    return date;
}

function endOfCurrentMonthUtc(): Date {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const firstNextMonth = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
    return new Date(firstNextMonth.getTime() - 1);
}

function aiEditsBucketFromUserData(data: any): any {
    if (!data || typeof data !== "object") return {};
    return data["credits.aiEdits"] || (data.credits && data.credits.aiEdits) || {};
}

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

    // `trial_cancelled` should not revoke paid access immediately.
    // Credits/feature limits are handled via credits overrides.
    if (reason === "trial_cancelled") return null;

    const t = rawTier.toLowerCase();
    if (t === "free" || t === "pro" || t === "agency") return t as UserTier;
    return "free";
}

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

                const now = new Date();
                const overrideTier = getActiveTierOverride(userData, now);
                if (overrideTier) {
                    return NextResponse.json(
                        {
                            uid,
                            tier: overrideTier,
                            stripeStatus: userData.stripeStatus ?? null,
                            currentPeriodEnd: userData.stripeCurrentPeriodEnd ?? null,
                            cancelAtPeriodEnd: userData.stripeCancelAtPeriodEnd ?? null,
                            source: userData.tierSource ?? "override",
                        },
                        { status: 200 },
                    );
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

                // Self-heal: keep credits.aiEdits in sync with the tier.
                // This fixes cases where preview/snapshot look correct (due to usage) but aiEdits stayed at free-tier.
                try {
                    const expected = monthlyLimitFor(tier, "edit");
                    const bucket = aiEditsBucketFromUserData(userData);
                    const currentRemaining =
                        bucket && typeof bucket.remaining === "number" && Number.isFinite(bucket.remaining) && bucket.remaining >= 0
                            ? bucket.remaining
                            : null;
                    const currentMonthly =
                        bucket && typeof bucket.monthlyLimit === "number" && bucket.monthlyLimit >= 0
                            ? bucket.monthlyLimit
                            : null;

                    if (currentMonthly !== expected) {
                        const stripePeriodEndSec =
                            typeof userData?.stripeCurrentPeriodEnd === "number" ? userData.stripeCurrentPeriodEnd : null;
                        const periodEndDate =
                            stripePeriodEndSec && stripePeriodEndSec > 0
                                ? new Date(stripePeriodEndSec * 1000)
                                : endOfCurrentMonthUtc();

                        // IMPORTANT: remaining may include paid top-ups.
                        // On tier change, reset the *monthly* portion to the new expected limit,
                        // but preserve any purchased bonus credits.
                        const bonusRaw = (bucket as any)?.bonusRemaining;
                        const bonus =
                            typeof bonusRaw === "number" && Number.isFinite(bonusRaw) && bonusRaw >= 0
                                ? Math.floor(bonusRaw)
                                : currentRemaining !== null && currentMonthly !== null
                                    ? Math.max(0, currentRemaining - currentMonthly)
                                    : 0;

                        const nextBucket: any =
                            expected === 0
                                ? { monthlyLimit: 0, remaining: null, periodEnd: toFirestoreTsOrDate(periodEndDate) }
                                : {
                                    monthlyLimit: expected,
                                    periodEnd: toFirestoreTsOrDate(periodEndDate),
                                    remaining: expected + bonus,
                                    ...(bonus > 0 ? { bonusRemaining: bonus } : {}),
                                };

                        await userRef.set({ "credits.aiEdits": nextBucket }, { merge: true });

                        const after = await userRef.get();
                        userData = after.exists ? after.data() : userData;
                    }
                } catch (e) {
                    console.error("billing/tier aiEdits self-heal failed", e);
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
