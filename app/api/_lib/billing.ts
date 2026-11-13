// app/api/_lib/billing.ts
import admin from "firebase-admin";
import { getStripe } from "@/lib/stripe";
import { monthlyLimitFor, TRIAL_AI_EDIT_CHANGE_LIMIT, type CreditKind as CoreCreditKind } from "@/src/lib/credits";
import { AI_EDIT_CREDIT_COST } from "@/src/lib/aiEditCredits";
import { captureCriticalEvent, captureException } from "@/lib/observability";
import { checkStripeCheckoutAbuse } from "@/app/api/_lib/stripeCheckoutAbuse";

export type UserTier = "free" | "pro" | "agency";
export type Tier = UserTier;

const DEFAULT_PAYMENT_FAILURE_GRACE_DAYS = 3;

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
const RECOVERY_OFFER_MIN_INACTIVE_MS = 30 * 60 * 1000;

function toEpochMs(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "string") {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "object") {
        const maybeAny = value as any;
        if (typeof maybeAny.toMillis === "function") {
            const ms = maybeAny.toMillis();
            return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
        }
        if (typeof maybeAny.seconds === "number") {
            const ms = maybeAny.seconds * 1000 + (typeof maybeAny.nanoseconds === "number" ? Math.floor(maybeAny.nanoseconds / 1_000_000) : 0);
            return Number.isFinite(ms) ? ms : null;
        }
        if (typeof maybeAny._seconds === "number") {
            const ms = maybeAny._seconds * 1000 + (typeof maybeAny._nanoseconds === "number" ? Math.floor(maybeAny._nanoseconds / 1_000_000) : 0);
            return Number.isFinite(ms) ? ms : null;
        }
    }
    return null;
}

export function getUserLastAppActivityMs(userData: Record<string, any> | null | undefined): number | null {
    if (!userData || typeof userData !== "object") return null;

    const candidates = [
        userData.lastAppActivityAt,
        userData.lastActivityAt,
        userData.appActivityAt,
        userData.updatedAt,
        userData.createdAt,
    ];

    for (const value of candidates) {
        const ms = toEpochMs(value);
        if (ms !== null) return ms;
    }

    return null;
}

export function canSendRecoveryOfferEmail(
    userData: Record<string, any> | null | undefined,
    nowMs: number = Date.now(),
): { ok: boolean; reason?: "unsubscribed" | "active_recently"; lastActivityMs: number | null } {
    const prefs = (userData?.notificationPrefs || {}) as any;
    if (prefs?.journeyEmails === false) {
        return { ok: false, reason: "unsubscribed", lastActivityMs: getUserLastAppActivityMs(userData) };
    }

    const lastActivityMs = getUserLastAppActivityMs(userData);
    if (lastActivityMs !== null && nowMs - lastActivityMs < RECOVERY_OFFER_MIN_INACTIVE_MS) {
        return { ok: false, reason: "active_recently", lastActivityMs };
    }

    return { ok: true, lastActivityMs };
}

export async function getCustomerIdForUid(uid: string): Promise<string | null> {
    // Primary: your real schema (from your screenshot)
    const userSnap = await db.collection("kloner_users").doc(uid).get();
    if (userSnap.exists) {
        const v = userSnap.get("stripeCustomerId");
        if (typeof v === "string" && v) return v;
    }

    // Fallbacks (older schemas)
    const legacy1 = await db
        .collection("stripe_customers")
        .doc(uid)
        .get()
        .catch(() => null as any);
    if (legacy1?.exists) {
        const v = legacy1.get("customerId") ?? legacy1.get("id");
        if (typeof v === "string" && v) return v;
    }

    const legacy2 = await db
        .collection("users")
        .doc(uid)
        .get()
        .catch(() => null as any);
    if (legacy2?.exists) {
        const v = legacy2.get("stripeCustomerId");
        if (typeof v === "string" && v) return v;
    }

    return null;
}

export async function getSubscriptionIdForUid(uid: string): Promise<string | null> {
    const userSnap = await db.collection("kloner_users").doc(uid).get();
    if (userSnap.exists) {
        const v = userSnap.get("stripeSubscriptionId");
        if (typeof v === "string" && v) return v;
    }
    return null;
}

/** Map Stripe price IDs (test + live) to an internal tier string. */
export function mapPriceToTier(priceId: string | null | undefined): UserTier {
    if (!priceId) return "free";

    const proIds = [
        process.env.STRIPE_PRICE_BASIC_TEST,
        process.env.STRIPE_PRICE_PRO_TEST,
        // Production (live) env var (used by create-checkout-session)
        process.env.STRIPE_PRICE_BASIC_PROD,
        process.env.STRIPE_PRICE_PRO_PROD,
    ].filter(Boolean) as string[];

    const agencyIds = [
        process.env.STRIPE_PRICE_AGENCY_TEST,
        process.env.STRIPE_PRICE_PRO_AGENCY,
        process.env.STRIPE_PRICE_AGENCY_PROD,
    ].filter(Boolean) as string[];

    if (proIds.includes(priceId)) return "pro";
    if (agencyIds.includes(priceId)) return "agency";

    console.warn("mapPriceToTier: unknown price id", priceId);
    return "free";
}

/**
 * Use Stripe currentPeriodEnd if present, else end of current calendar month (UTC).
 */
function computeCreditPeriodEnd(stripeData?: { currentPeriodEnd?: number | null }): Date {
    if (typeof stripeData?.currentPeriodEnd === "number") {
        // Stripe gives seconds since epoch
        return new Date(stripeData.currentPeriodEnd * 1000);
    }

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-based
    const firstNextMonth = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
    return new Date(firstNextMonth.getTime() - 1);
}

function readAiEditsBucket(data: any): Record<string, any> | null {
    const bucket = data?.["credits.aiEdits"] || (data?.credits && data.credits.aiEdits) || null;
    return bucket && typeof bucket === "object" ? bucket : null;
}

function normalizeNonNegativeInt(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    return Math.floor(value);
}

function inferBonusRemaining(bucket: Record<string, any> | null): number {
    if (!bucket) return 0;

    const explicit = normalizeNonNegativeInt((bucket as any).bonusRemaining);
    if (explicit !== null) return explicit;

    const remaining = normalizeNonNegativeInt((bucket as any).remaining);
    const monthlyLimit = normalizeNonNegativeInt((bucket as any).monthlyLimit);
    if (remaining !== null && monthlyLimit !== null) {
        return Math.max(0, remaining - monthlyLimit);
    }

    return 0;
}

export async function setUserTierFromStripe(
    uid: string,
    tier: Tier,
    stripeData?: {
        customerId?: string | null;
        subscriptionId?: string | null;
        priceId?: string | null;
        status?: string | null;
        currentPeriodEnd?: number | null; // unix seconds
        trialEnd?: number | null; // unix seconds
        cancelAtPeriodEnd?: boolean | null;
    },
): Promise<void> {
    const userRef = db.collection("kloner_users").doc(uid);

    // Read existing to decide whether to reset credits
    const existingSnap = await userRef.get();
    const existingData = existingSnap.exists ? (existingSnap.data() as any) : {};

    const previousTier: Tier | undefined = existingData.tier;
    const previousStripeStatus = typeof existingData.stripeStatus === "string" ? existingData.stripeStatus : null;
    const nextStripeStatus = typeof stripeData?.status === "string" ? stripeData.status : previousStripeStatus;
    const trialStatusChanged = (previousStripeStatus === "trialing") !== (nextStripeStatus === "trialing");
    const isTrialing = nextStripeStatus === "trialing";
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
        trialStatusChanged ||
        (newStripePeriodEnd && newStripePeriodEnd !== previousStripePeriodEnd);

    const update: Record<string, unknown> = {
        tier,
        tierSource: "stripe",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (isTrialing && (previousStripeStatus !== "trialing" || typeof existingData.trialAiChangesUsed !== "number")) {
        const priorAiBucket = readAiEditsBucket(existingData);
        const priorMonthlyLimit = typeof priorAiBucket?.monthlyLimit === "number" ? priorAiBucket.monthlyLimit : 0;
        const priorRemaining = typeof priorAiBucket?.remaining === "number" ? priorAiBucket.remaining : priorMonthlyLimit;
        const priorBonus = inferBonusRemaining(priorAiBucket);
        const priorMonthlyRemaining = Math.max(0, Math.min(priorMonthlyLimit, priorRemaining - priorBonus));
        const inferredUsed = previousStripeStatus === "trialing"
            ? Math.min(TRIAL_AI_EDIT_CHANGE_LIMIT, Math.floor(Math.max(0, priorMonthlyLimit - priorMonthlyRemaining) / AI_EDIT_CREDIT_COST))
            : 0;
        update.trialAiChangesUsed = inferredUsed;
        update.trialAiChangesLimit = TRIAL_AI_EDIT_CHANGE_LIMIT;
    }

    // Mirror Stripe fields onto kloner_users, including nulls to clear stale state
    if (stripeData) {
        if ("customerId" in stripeData) update.stripeCustomerId = stripeData.customerId ?? null;
        if ("subscriptionId" in stripeData)
            update.stripeSubscriptionId = stripeData.subscriptionId ?? null;
        if ("priceId" in stripeData) update.stripePriceId = stripeData.priceId ?? null;
        if ("status" in stripeData) update.stripeStatus = stripeData.status ?? null;
        if ("currentPeriodEnd" in stripeData)
            update.stripeCurrentPeriodEnd =
                typeof stripeData.currentPeriodEnd === "number" ? stripeData.currentPeriodEnd : null;
        if ("trialEnd" in stripeData)
            update.stripeTrialEnd = typeof stripeData.trialEnd === "number" ? stripeData.trialEnd : null;
        if ("cancelAtPeriodEnd" in stripeData)
            update.stripeCancelAtPeriodEnd =
                typeof stripeData.cancelAtPeriodEnd === "boolean" ? stripeData.cancelAtPeriodEnd : null;
    }

    if (shouldResetCredits) {
        // Compute new limits for this tier from central credit config
        const previewLimit = monthlyLimitFor(tier, "preview" as CoreCreditKind, isTrialing);
        const screenshotLimit = monthlyLimitFor(tier, "screenshot" as CoreCreditKind, isTrialing);
        const editLimit = monthlyLimitFor(tier, "edit" as CoreCreditKind, isTrialing);

        // Decide what period end to attach to reset credits
        const periodEndDate = computeCreditPeriodEnd(stripeData);
        const periodEndTs = admin.firestore.Timestamp.fromDate(periodEndDate);

        if (previewLimit !== undefined && previewLimit !== null) {
            update["credits.preview"] =
                previewLimit === 0
                    ? { monthlyLimit: 0, remaining: null, periodEnd: periodEndTs }
                    : { monthlyLimit: previewLimit, remaining: previewLimit, periodEnd: periodEndTs };
        }

        if (screenshotLimit !== undefined && screenshotLimit !== null) {
            update["credits.snapshot"] =
                screenshotLimit === 0
                    ? { monthlyLimit: 0, remaining: null, periodEnd: periodEndTs }
                    : { monthlyLimit: screenshotLimit, remaining: screenshotLimit, periodEnd: periodEndTs };
        }

        if (editLimit !== undefined && editLimit !== null) {
            const existingAiBucket = readAiEditsBucket(existingData);
            const existingBonus = inferBonusRemaining(existingAiBucket);
            update["credits.aiEdits"] =
                editLimit === 0
                    ? {
                          monthlyLimit: 0,
                          remaining: null,
                          periodEnd: periodEndTs,
                          ...(existingBonus > 0 ? { bonusRemaining: existingBonus } : {}),
                      }
                    : {
                          monthlyLimit: editLimit,
                          remaining: editLimit + existingBonus,
                          periodEnd: periodEndTs,
                          ...(existingBonus > 0 ? { bonusRemaining: existingBonus } : {}),
                      };
        }
    } else {
        // Self-heal: if aiEdits bucket is out of sync with the tier, fix it without forcing
        // a full credit reset for other buckets.
        const editLimit = monthlyLimitFor(tier, "edit" as CoreCreditKind, isTrialing);
        if (editLimit !== undefined && editLimit !== null) {
            const rawBucket = readAiEditsBucket(existingData);

            const currentMonthly =
                rawBucket && typeof rawBucket.monthlyLimit === "number" && rawBucket.monthlyLimit >= 0
                    ? rawBucket.monthlyLimit
                    : null;

            if (currentMonthly !== editLimit) {
                const periodEndDate = computeCreditPeriodEnd(stripeData);
                const periodEndTs = admin.firestore.Timestamp.fromDate(periodEndDate);
                const existingBonus = inferBonusRemaining(rawBucket);
                update["credits.aiEdits"] =
                    editLimit === 0
                        ? {
                              monthlyLimit: 0,
                              remaining: null,
                              periodEnd: periodEndTs,
                              ...(existingBonus > 0 ? { bonusRemaining: existingBonus } : {}),
                          }
                        : {
                              monthlyLimit: editLimit,
                              remaining: editLimit + existingBonus,
                              periodEnd: periodEndTs,
                              ...(existingBonus > 0 ? { bonusRemaining: existingBonus } : {}),
                          };
            }
        }

        const screenshotLimit = monthlyLimitFor(tier, "screenshot" as CoreCreditKind, isTrialing);
        const snapshotBucket = existingData?.["credits.snapshot"] || existingData?.credits?.snapshot || {};
        const currentSnapshotLimit = typeof snapshotBucket.monthlyLimit === "number" ? snapshotBucket.monthlyLimit : null;
        if (currentSnapshotLimit !== screenshotLimit) {
            const periodEndTs = admin.firestore.Timestamp.fromDate(computeCreditPeriodEnd(stripeData));
            const currentRemaining = typeof snapshotBucket.remaining === "number" ? snapshotBucket.remaining : screenshotLimit;
            update["credits.snapshot"] = {
                monthlyLimit: screenshotLimit,
                remaining: screenshotLimit === 0 ? null : Math.max(0, Math.min(currentRemaining, screenshotLimit)),
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
export async function getUidForStripeCustomer(customerId: string): Promise<string | null> {
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
        { merge: true },
    );
}

function pickBestSubscription(subs: any[]): any | null {
    if (!subs?.length) return null;

    const priority = new Map<string, number>([
        ["active", 1],
        ["trialing", 2],
        ["past_due", 3],
        ["unpaid", 4],
        ["incomplete", 5],
        ["incomplete_expired", 6],
        ["paused", 7],
        ["canceled", 99],
    ]);

    const scored = subs
        .map((s) => {
            const st = typeof s?.status === "string" ? s.status : "canceled";
            const score = priority.get(st) ?? 50;
            const created = typeof s?.created === "number" ? s.created : 0;
            return { s, score, created };
        })
        .sort((a, b) => a.score - b.score || b.created - a.created);

    return scored[0]?.s ?? subs[0];
}

function readPaymentFailureGraceSeconds(): number {
    const raw = process.env.STRIPE_SUBSCRIPTION_PAYMENT_GRACE_DAYS;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    const days = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PAYMENT_FAILURE_GRACE_DAYS;
    return days * 24 * 60 * 60;
}

export function effectiveTierFromStripeSubscription(params: {
    mappedTier: Tier;
    status?: string | null;
    currentPeriodEnd?: number | null;
    trialEnd?: number | null;
    cancelAtPeriodEnd?: boolean | null;
    created?: number | null;
    nowMs?: number;
}): Tier {
    const {
        mappedTier,
        status,
        currentPeriodEnd,
        trialEnd,
        cancelAtPeriodEnd,
        created,
        nowMs = Date.now(),
    } = params;

    const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
    // A cancellation requested from Kloner revokes product/site access immediately.
    // Stripe keeps the subscription `active` until the paid period ends, so status
    // alone must not be treated as an entitlement when cancel_at_period_end is set.
    if (cancelAtPeriodEnd === true) return "free";
    if (normalized === "active" || normalized === "trialing") return mappedTier;

    const graceStatuses = new Set(["past_due", "unpaid", "incomplete"]);
    if (!graceStatuses.has(normalized)) return "free";

    const nowSec = Math.floor(nowMs / 1000);
    const graceSec = readPaymentFailureGraceSeconds();
    const anchorSec =
        typeof currentPeriodEnd === "number" && Number.isFinite(currentPeriodEnd) && currentPeriodEnd > 0
            ? currentPeriodEnd
            : typeof trialEnd === "number" && Number.isFinite(trialEnd) && trialEnd > 0
              ? trialEnd
              : typeof created === "number" && Number.isFinite(created) && created > 0
                ? created
                : nowSec;

    if (nowSec <= anchorSec + graceSec) {
        return mappedTier;
    }

    return "free";
}

export async function refreshTierFromStripeForUid(uid: string): Promise<Tier> {
    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();
    const data = snap.exists ? (snap.data() as any) : {};

    // Manual overrides (fraud/support/admin) can win over Stripe status.
    // Trial cancellation should revoke paid access immediately.
    let hasTrialCancelledOverride = false;
    try {
        const rawTier = typeof data?.tierOverrideTier === "string" ? data.tierOverrideTier : "";
        const rawReason = typeof data?.tierOverrideReason === "string" ? data.tierOverrideReason : "";
        const reason = rawReason.trim().toLowerCase();
        const until = data?.tierOverrideUntil;
        const untilDate: Date | null =
            until && typeof until.toDate === "function"
                ? (until.toDate() as Date)
                : until instanceof Date
                    ? until
                    : null;
        if (rawTier && untilDate && new Date() < untilDate) {
            if (reason === "trial_cancelled") {
                hasTrialCancelledOverride = true;
            } else {
                const t = rawTier.toLowerCase();
                const overrideTier: Tier = t === "pro" || t === "agency" ? (t as Tier) : "free";
                return overrideTier;
            }
        }
    } catch {
        // ignore
    }

    // Local development uses Stripe test mode and may point at the same
    // Firestore project as production. Never let a test-mode refresh rewrite
    // the shared live tier, status, or credit buckets.
    if (process.env.NODE_ENV !== "production") {
        const storedTier = typeof data.tier === "string" ? data.tier.toLowerCase() : "free";
        return storedTier === "pro" || storedTier === "agency"
            ? storedTier
            : "free";
    }

    let customerId: string | undefined = data.stripeCustomerId;

    const findMappedCustomerWithSubscriptions = async (excludeCustomerId?: string) => {
        const mappings = await db.collection("stripe_customers").where("uid", "==", uid).get();
        for (const mapping of mappings.docs) {
            const candidateId = mapping.id;
            if (!candidateId || candidateId === excludeCustomerId) continue;
            try {
                const candidateSubscriptions = await stripe.subscriptions.list({
                    customer: candidateId,
                    status: "all",
                    limit: 10,
                });
                if (candidateSubscriptions.data.length) {
                    return { customerId: candidateId, subscriptions: candidateSubscriptions };
                }
            } catch {
                // Mappings can contain test-mode customers. A live Stripe key
                // cannot retrieve those; continue until a live customer matches.
            }
        }
        return null;
    };

    if (!customerId) {
        const mappedCustomer = await findMappedCustomerWithSubscriptions();
        if (mappedCustomer) {
            customerId = mappedCustomer.customerId;
            await userRef.set({ stripeCustomerId: customerId }, { merge: true });
        }
    }

    if (!customerId) {
        await setUserTierFromStripe(uid, "free", {
            customerId: null,
            subscriptionId: null,
            priceId: null,
            status: null,
            currentPeriodEnd: null,
            trialEnd: null,
            cancelAtPeriodEnd: null,
        });
        return "free";
    }

    let subs;
    try {
        subs = await stripe.subscriptions.list({
            customer: customerId,
            status: "all",
            // don’t assume the first one is the right one; Stripe returns most-recent, not “best”
            limit: 10,
        });
    } catch (error: any) {
        const status =
            typeof error?.statusCode === "number"
                ? error.statusCode
                : typeof error?.status === "number"
                  ? error.status
                  : 500;

        const stripeCode = String(error?.code || error?.raw?.code || "").toLowerCase();
        const isMissingCustomer = status === 404 || stripeCode === "resource_missing";
        if (isMissingCustomer) {
            const mappedCustomer = await findMappedCustomerWithSubscriptions(customerId).catch(() => null);
            if (mappedCustomer) {
                customerId = mappedCustomer.customerId;
                subs = mappedCustomer.subscriptions;
                await userRef.set({ stripeCustomerId: customerId }, { merge: true });
            }
        }

        if (!subs) {
            if (status >= 500) {
                await captureException({
                    source: "vercel",
                    error,
                    action: "billing.refreshTier.listSubscriptions",
                    statusCode: status,
                    service: "billing-subscription",
                    userId: uid,
                    extra: { customerId },
                });
            } else {
                await captureCriticalEvent({
                    source: "vercel",
                    severity: "critical",
                    statusCode: status,
                    action: "billing.refreshTier.listSubscriptions",
                    service: "billing-subscription",
                    userId: uid,
                    message: typeof error?.message === "string" ? error.message : "Stripe subscription list failed",
                    errorName: typeof error?.type === "string" ? error.type : undefined,
                    stack: typeof error?.stack === "string" ? error.stack : undefined,
                    extra: { customerId },
                });
            }

            throw error;
        }
    }

    if (!subs.data.length) {
        await setUserTierFromStripe(uid, "free", {
            customerId,
            subscriptionId: null,
            priceId: null,
            status: null,
            currentPeriodEnd: null,
            trialEnd: null,
            cancelAtPeriodEnd: null,
        });
        return "free";
    }

    const subAny = pickBestSubscription(subs.data as any[]) as any;

    const subscriptionId = typeof subAny.id === "string" ? subAny.id : "";
    const recentSubscription = typeof subAny.created === "number" &&
        Date.now() - subAny.created * 1000 < 24 * 60 * 60 * 1000;
    const needsAbuseCheck = data.abuseBlocklistBlocked === true ||
        subAny.metadata?.abuseBlocklistCheck === "1" ||
        recentSubscription;
    if (needsAbuseCheck) {
        try {
            const abuseCheck = await checkStripeCheckoutAbuse({
                uid,
                subscriptionId,
                stripe,
            });
            if (abuseCheck.outcome === "blocked") return "free";
        } catch (error) {
            // The success-page tier refresh is also an entitlement grant path.
            // Fail closed while the blocklist decision is unavailable so a
            // disabled Stripe webhook cannot allow Pro access around the check.
            await userRef.set({ tier: "free", tierSource: "abuse_blocklist_pending" }, { merge: true }).catch(() => undefined);
            throw Object.assign(new Error("Checkout abuse screening is temporarily unavailable"), {
                code: "STRIPE_CHECKOUT_ABUSE_CHECK_FAILED",
                cause: error,
            });
        }
    }

    const firstItem = subAny.items?.data?.[0];
    const priceId = typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;

    const tier = mapPriceToTier(priceId);

    const currentPeriodEnd =
        typeof subAny.current_period_end === "number" ? (subAny.current_period_end as number) : null;

    const trialEnd = typeof subAny.trial_end === "number" ? (subAny.trial_end as number) : null;

    const cancelAtPeriodEnd =
        typeof subAny.cancel_at_period_end === "boolean"
            ? (subAny.cancel_at_period_end as boolean)
            : null;

    const status = typeof subAny.status === "string" ? (subAny.status as string) : null;

    // IMPORTANT: during trial, user has paid access; treat as the tier they selected.
    // Otherwise (canceled/unpaid/etc) downgrade to free.
    const effectiveTier: Tier = effectiveTierFromStripeSubscription({
        mappedTier: tier,
        status,
        currentPeriodEnd,
        trialEnd,
        cancelAtPeriodEnd,
        created: typeof subAny.created === "number" ? subAny.created : null,
    });

    if (hasTrialCancelledOverride && status === "active") {
        await userRef.set(
            {
                tierOverrideTier: admin.firestore.FieldValue.delete(),
                tierOverrideUntil: admin.firestore.FieldValue.delete(),
                tierOverrideReason: admin.firestore.FieldValue.delete(),
                tierOverrideSetAt: admin.firestore.FieldValue.delete(),
                creditsOverrideTier: admin.firestore.FieldValue.delete(),
                creditsOverrideUntil: admin.firestore.FieldValue.delete(),
                creditsOverrideReason: admin.firestore.FieldValue.delete(),
                creditsOverrideSetAt: admin.firestore.FieldValue.delete(),
            },
            { merge: true },
        );
    }

    await setUserTierFromStripe(uid, effectiveTier, {
        customerId,
        subscriptionId: typeof subAny.id === "string" ? subAny.id : null,
        priceId,
        status,
        currentPeriodEnd,
        trialEnd,
        cancelAtPeriodEnd,
    });

    return effectiveTier;
}
