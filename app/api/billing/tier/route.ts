// app/api/billing/tier/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import {
    refreshTierFromStripeForUid,
    type UserTier,
} from "../../_lib/billing";
import { monthlyLimitFor } from "@/src/lib/credits";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminDb } from "../../_lib/auth";
import {
    sendSiteAccessSuspendedEmail,
    shouldEnforceLiveSiteAccess,
    suspendUserLiveSites,
} from "@/app/api/_lib/subscriptionSiteAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function serializeAiEditsCredits(data: any): {
    remaining: number | null;
    monthlyLimit: number | null;
    bonusRemaining: number | null;
    periodEndMs: number | null;
} {
    const bucket = aiEditsBucketFromUserData(data);
    const remaining = typeof bucket?.remaining === "number" && Number.isFinite(bucket.remaining) ? bucket.remaining : null;
    const monthlyLimit =
        typeof bucket?.monthlyLimit === "number" && Number.isFinite(bucket.monthlyLimit) ? bucket.monthlyLimit : null;
    const bonusRemaining =
        typeof bucket?.bonusRemaining === "number" && Number.isFinite(bucket.bonusRemaining)
            ? bucket.bonusRemaining
            : null;

    const end = toDateFromFirestoreTimestampLike(bucket?.periodEnd);
    const periodEndMs = end ? end.getTime() : null;

    return {
        remaining,
        monthlyLimit,
        bonusRemaining,
        periodEndMs,
    };
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

type BillingState = "free" | "active" | "trialing" | "trial_cancelled";

function getBillingState(data: any, tier: UserTier): BillingState {
    if (!data || typeof data !== "object") return tier === "free" ? "free" : "active";

    const rawReason = typeof data.tierOverrideReason === "string" ? data.tierOverrideReason : "";
    const reason = rawReason.trim().toLowerCase();
    const stripeStatus = typeof data.stripeStatus === "string" ? data.stripeStatus.trim().toLowerCase() : "";
    const cancelAtPeriodEnd = data.stripeCancelAtPeriodEnd === true;

    if (reason === "trial_cancelled" && cancelAtPeriodEnd) return "trial_cancelled";
    if (stripeStatus === "trialing") return "trialing";
    if (tier !== "free") return "active";
    return "free";
}

function getActiveTierOverride(data: any, now: Date): UserTier | null {
    if (!data || typeof data !== "object") return null;
    const rawTier = typeof data.tierOverrideTier === "string" ? data.tierOverrideTier : "";
    const rawReason = typeof data.tierOverrideReason === "string" ? data.tierOverrideReason : "";
    const reason = rawReason.trim().toLowerCase();
    const until = toDateFromFirestoreTimestampLike(data.tierOverrideUntil);
    const stripeStatus = typeof data.stripeStatus === "string" ? data.stripeStatus.trim().toLowerCase() : "";
    if (!rawTier) return null;

    if (reason === "trial_cancelled") {
        if (stripeStatus === "active") return null;
        const t = rawTier.toLowerCase();
        if (t === "free" || t === "pro" || t === "agency") return "free";
        return "free";
    }

    if (!until) return null;
    if (!(now < until)) return null;

    const t = rawTier.toLowerCase();
    if (t === "free" || t === "pro" || t === "agency") return t as UserTier;
    return "free";
}

export async function GET(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid }) => {
            try {
                const db = getAdminDb();
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
                    const billingState = getBillingState(userData, overrideTier);
                    return NextResponse.json(
                        {
                            uid,
                            tier: overrideTier,
                            billingState,
                            stripeStatus: userData.stripeStatus ?? null,
                            stripeSubscriptionId: userData.stripeSubscriptionId ?? null,
                            currentPeriodEnd: userData.stripeCurrentPeriodEnd ?? null,
                            cancelAtPeriodEnd: userData.stripeCancelAtPeriodEnd ?? null,
                            source: userData.tierSource ?? "override",
                            credits: {
                                aiEdits: serializeAiEditsCredits(userData),
                            },
                        },
                        { status: 200 },
                    );
                }

                const storedTier = (userData.tier as UserTier) || "free";

                let stripeRefreshError: string | null = null;

                // Stripe is the entitlement source of truth. Firestore is only a
                // mirror/cache, so refresh on every request (the `refresh` query
                // remains supported for callers that explicitly request it).
                const shouldRefreshFromStripe = true;
                if (shouldRefreshFromStripe || refresh) {
                    try {
                        tier = await refreshTierFromStripeForUid(uid);
                        const freshSnap = await userRef.get();
                        userData = freshSnap.exists ? freshSnap.data() : {};
                    } catch (e: any) {
                        // Stripe refresh is best-effort; never hard-fail the UI.
                        tier = storedTier;
                        stripeRefreshError =
                            typeof e?.message === "string" && e.message
                                ? e.message
                                : "stripe_refresh_failed";
                    }
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

                // Reconcile live-site access on reads too. This covers cancellations
                // that happened before the webhook/enforcement deployment and keeps
                // Stripe authoritative even if a webhook was delayed or missed.
                const normalizedStripeStatus =
                    typeof userData?.stripeStatus === "string" ? userData.stripeStatus.trim().toLowerCase() : "";
                const shouldSuspendSites =
                    userData?.stripeCancelAtPeriodEnd === true ||
                    ["canceled", "unpaid", "past_due", "incomplete", "incomplete_expired", "paused"].includes(normalizedStripeStatus);
                if (shouldSuspendSites && shouldEnforceLiveSiteAccess()) {
                    try {
                        const result = await suspendUserLiveSites(
                            uid,
                            userData?.stripeCancelAtPeriodEnd === true ? "subscription_cancelled" : "payment_failed",
                        );
                        if (result.suspended > 0) {
                            const authUser = await admin.auth().getUser(uid).catch(() => null);
                            const email = authUser?.email?.trim() || "";
                            if (email) {
                                await sendSiteAccessSuspendedEmail({
                                    uid,
                                    email,
                                    name: authUser?.displayName || null,
                                    reason: userData?.stripeCancelAtPeriodEnd === true ? "subscription_cancelled" : "payment_failed",
                                });
                            }
                        }
                    } catch (error) {
                        console.error("billing/tier live-site reconciliation failed", error);
                    }
                }

                const billingState = getBillingState(userData, tier);
                return NextResponse.json(
                    {
                        uid,
                        tier,
                        billingState,
                        stripeStatus: userData.stripeStatus ?? null,
                        stripeSubscriptionId: userData.stripeSubscriptionId ?? null,
                        currentPeriodEnd: userData.stripeCurrentPeriodEnd ?? null,
                        cancelAtPeriodEnd: userData.stripeCancelAtPeriodEnd ?? null,
                        source: userData.tierSource ?? "stripe",
                        stripeRefreshError,
                        credits: {
                            aiEdits: serializeAiEditsCredits(userData),
                        },
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
