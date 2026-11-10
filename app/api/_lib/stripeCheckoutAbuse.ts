import "server-only";

import crypto from "node:crypto";
import type Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "@/app/api/_lib/auth";
import { captureAuditEvent } from "@/lib/observability";

type SignalType = "cardFingerprint" | "cardCountry" | "name" | "email";
export type AbuseMatch = { type: SignalType; value: string };

type Blocklist = Record<SignalType, string[]>;

const EMPTY_BLOCKLIST: Blocklist = {
    cardFingerprint: [],
    cardCountry: [],
    name: [],
    email: [],
};

function clean(value: unknown, max = 512): string {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function normalizeEmail(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function asStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => clean(item)).filter(Boolean);
}

async function readBlocklist(): Promise<Blocklist> {
    const snapshot = await getAdminDb().collection("abuseBlocklist").get();
    if (snapshot.empty) {
        throw new Error("Stripe checkout abuse blocklist is not configured");
    }

    const blocklist: Blocklist = { ...EMPTY_BLOCKLIST };
    for (const doc of snapshot.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (doc.id === "config") {
            blocklist.cardFingerprint.push(...asStringList(data.cardFingerprints));
            blocklist.cardCountry.push(...asStringList(data.cardCountries));
            blocklist.name.push(...asStringList(data.names));
            blocklist.email.push(...asStringList(data.emails));
        }

        // Individual enabled records can be added to the collection without a deploy.
        if (data.enabled === false) continue;
        const type = clean(data.type) as SignalType;
        const value = clean(data.value);
        if (value && type in blocklist) blocklist[type].push(value);
    }

    return blocklist;
}

export function findAbuseMatches(params: {
    blocklist: Blocklist;
    fingerprint?: string | null;
    country?: string | null;
    billingName?: string | null;
    signupEmail?: string | null;
}): AbuseMatch[] {
    const matches: AbuseMatch[] = [];
    const fingerprint = clean(params.fingerprint);
    const country = clean(params.country).toUpperCase();
    const billingName = normalizeName(clean(params.billingName));
    const signupEmail = normalizeEmail(clean(params.signupEmail));

    for (const value of params.blocklist.cardFingerprint) {
        if (fingerprint && fingerprint === value.trim()) matches.push({ type: "cardFingerprint", value });
    }
    for (const value of params.blocklist.cardCountry) {
        if (country && country === value.trim().toUpperCase()) matches.push({ type: "cardCountry", value });
    }
    for (const value of params.blocklist.name) {
        if (billingName && billingName === normalizeName(value)) matches.push({ type: "name", value });
    }
    for (const value of params.blocklist.email) {
        if (signupEmail && signupEmail === normalizeEmail(value)) matches.push({ type: "email", value });
    }
    return matches;
}

function paymentMethodId(value: string | Stripe.PaymentMethod | null | undefined): string {
    return typeof value === "string" ? value : clean(value?.id);
}

async function getPaymentMethod(stripe: Stripe, subscriptionId: string): Promise<Stripe.PaymentMethod> {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["default_payment_method"],
    });
    let methodRef = subscription.default_payment_method;

    if (!methodRef) {
        const customerId = typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;
        if (customerId) {
            const customer = await stripe.customers.retrieve(customerId, {
                expand: ["invoice_settings.default_payment_method"],
            });
            if (!customer.deleted) methodRef = customer.invoice_settings?.default_payment_method || null;
        }
    }

    const methodId = paymentMethodId(methodRef);
    if (!methodId) throw new Error("Stripe subscription has no retrievable default payment method");
    // Always fetch the authoritative PaymentMethod object from Stripe.
    return stripe.paymentMethods.retrieve(methodId);
}

async function sendCheckAlert(params: {
    uid: string;
    subscriptionId: string;
    sessionId?: string;
    eventId?: string;
    outcome: "passed" | "blocked";
    matches: AbuseMatch[];
}) {
    await captureAuditEvent({
        source: "vercel",
        severity: params.outcome === "blocked" ? "warning" : "info",
        statusCode: params.outcome === "blocked" ? 403 : 200,
        route: "/api/stripe/webhook",
        method: "POST",
        action: "stripe.checkout.abuse_blocklist_check",
        service: "stripe-webhook",
        userId: params.uid,
        requestId: params.eventId || params.subscriptionId,
        message: params.outcome === "blocked"
            ? "Stripe Checkout blocklist check matched; subscription cancellation and account disable were initiated."
            : "Stripe Checkout blocklist check passed.",
        tags: ["stripe", "checkout", "abuse-blocklist", params.outcome],
        extra: {
            stripeSubscriptionId: params.subscriptionId,
            checkoutSessionId: params.sessionId || "",
            matchedSignals: params.matches.map((match) => match.type),
        },
    });
}

async function enforceBlock(params: {
    uid: string;
    subscriptionId: string;
    stripe: Stripe;
    matches: AbuseMatch[];
    eventId?: string;
    sessionId?: string;
    checkRef: FirebaseFirestore.DocumentReference;
    alertNeeded: boolean;
}) {
    const now = Date.now();
    const userRef = getAdminDb().collection("kloner_users").doc(params.uid);
    const auth = getAdminAuth();

    // Deny app access and Pro immediately, even if Stripe is temporarily unavailable.
    await Promise.all([
        auth.updateUser(params.uid, { disabled: true }),
        auth.revokeRefreshTokens(params.uid),
        userRef.set({
            tier: "free",
            tierSource: "abuse_blocklist",
            stripeStatus: "abuse_blocked",
            stripeSubscriptionId: params.subscriptionId,
            abuseBlocklistBlocked: true,
            abuseBlocklistBlockedAt: now,
            abuseBlocklistMatchedSignals: params.matches,
            updatedAt: now,
        }, { merge: true }),
        getAdminDb().collection("abuseBlocklistAttempts").doc(params.subscriptionId).set({
            uid: params.uid,
            stripeSubscriptionId: params.subscriptionId,
            checkoutSessionId: params.sessionId || "",
            stripeEventId: params.eventId || "",
            matchedSignals: params.matches,
            status: "blocked",
            timestamp: now,
        }, { merge: true }),
    ]);

    const subscription = await params.stripe.subscriptions.retrieve(params.subscriptionId);
    if (subscription.status !== "canceled" && subscription.status !== "incomplete_expired") {
        await params.stripe.subscriptions.cancel(params.subscriptionId, { prorate: false }, {
            idempotencyKey: `checkout-abuse-block:${params.subscriptionId}`,
        });
    }

    await params.checkRef.set({ enforcementComplete: true, enforcementCompletedAt: Date.now() }, { merge: true });
    if (params.alertNeeded) {
        await sendCheckAlert({
            uid: params.uid,
            subscriptionId: params.subscriptionId,
            sessionId: params.sessionId,
            eventId: params.eventId,
            outcome: "blocked",
            matches: params.matches,
        });
        await params.checkRef.set({ alertSent: true }, { merge: true });
    }
}

/**
 * Checks a Stripe subscription once per subscription ID. A live lease prevents
 * concurrent Checkout and subscription webhooks from racing a Pro grant ahead
 * of the abuse decision. Incomplete work throws so Stripe retries the event.
 */
export async function checkStripeCheckoutAbuse(params: {
    uid: string;
    subscriptionId: string;
    stripe: Stripe;
    eventId?: string;
    sessionId?: string;
    signupEmail?: string | null;
}): Promise<{ outcome: "passed" | "blocked"; matches: AbuseMatch[] }> {
    const uid = clean(params.uid, 160);
    const subscriptionId = clean(params.subscriptionId, 160);
    if (!uid || !subscriptionId) throw new Error("Missing user or subscription for abuse check");

    const db = getAdminDb();
    const checkRef = db.collection("abuseBlocklistChecks").doc(subscriptionId);
    const now = Date.now();
    const leaseOwner = crypto.randomUUID();
    const claim = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(checkRef);
        const prior = snapshot.exists ? snapshot.data() as Record<string, any> : {};
        if (prior.status === "passed") return { action: "passed" as const, prior };
        if (prior.status === "blocked") return { action: "blocked" as const, prior };
        if (prior.status === "checking" && Number(prior.leaseUntil || 0) > now) {
            return { action: "busy" as const, prior };
        }
        tx.set(checkRef, {
            uid,
            stripeSubscriptionId: subscriptionId,
            status: "checking",
            leaseOwner,
            leaseUntil: now + 90_000,
            lastEventId: params.eventId || "",
            checkoutSessionId: params.sessionId || "",
        }, { merge: true });
        return { action: "claimed" as const, prior };
    });

    if (claim.action === "busy") {
        // Stripe can deliver checkout.session.completed and
        // customer.subscription.created at nearly the same time. Let the
        // request that owns the lease finish so normal duplicate delivery
        // does not become a noisy 500 (and so the subscription event does not
        // acknowledge before the access decision is known).
        const waitUntil = Date.now() + 4_000;
        while (Date.now() < waitUntil) {
            await new Promise((resolve) => setTimeout(resolve, 125));
            const latest = await checkRef.get();
            const current = latest.exists ? latest.data() as Record<string, any> : {};

            if (current.status === "passed") {
                return { outcome: "passed", matches: [] };
            }
            if (current.status === "blocked" && current.enforcementComplete === true) {
                const matches = Array.isArray(current.matchedSignals)
                    ? current.matchedSignals as AbuseMatch[]
                    : [];
                return { outcome: "blocked", matches };
            }
            if (current.status === "retry" || (
                current.status === "checking" && Number(current.leaseUntil || 0) <= Date.now()
            )) {
                break;
            }
        }
        throw new Error("Stripe Checkout abuse check is still running; retry webhook");
    }
    if (claim.action === "passed") {
        if (!claim.prior.alertSent) {
            await sendCheckAlert({ uid, subscriptionId, sessionId: params.sessionId, eventId: params.eventId, outcome: "passed", matches: [] });
            await checkRef.set({ alertSent: true }, { merge: true });
        }
        return { outcome: "passed", matches: [] };
    }
    if (claim.action === "blocked") {
        const matches = Array.isArray(claim.prior.matchedSignals) ? claim.prior.matchedSignals as AbuseMatch[] : [];
        await enforceBlock({
            uid,
            subscriptionId,
            stripe: params.stripe,
            matches,
            eventId: params.eventId,
            sessionId: params.sessionId || clean(claim.prior.checkoutSessionId),
            checkRef,
            alertNeeded: !claim.prior.alertSent,
        });
        return { outcome: "blocked", matches };
    }

    try {
        const existingUser = await db.collection("kloner_users").doc(uid).get();
        const existingUserData = existingUser.exists ? existingUser.data() as Record<string, any> : {};
        if (existingUserData.abuseBlocklistBlocked === true) {
            const matches = Array.isArray(existingUserData.abuseBlocklistMatchedSignals)
                ? existingUserData.abuseBlocklistMatchedSignals as AbuseMatch[]
                : [];
            await checkRef.set({
                status: "blocked",
                matchedSignals: matches,
                checkedAt: Date.now(),
                leaseUntil: 0,
                leaseOwner: "",
                alertSent: false,
                enforcementComplete: false,
            }, { merge: true });
            await enforceBlock({
                uid,
                subscriptionId,
                stripe: params.stripe,
                matches,
                eventId: params.eventId,
                sessionId: params.sessionId,
                checkRef,
                alertNeeded: true,
            });
            return { outcome: "blocked", matches };
        }

        const [authUser, paymentMethod, blocklist] = await Promise.all([
            getAdminAuth().getUser(uid),
            getPaymentMethod(params.stripe, subscriptionId),
            readBlocklist(),
        ]);
        const signupEmail = clean(authUser.email || params.signupEmail, 320);
        const matches = findAbuseMatches({
            blocklist,
            fingerprint: paymentMethod.card?.fingerprint,
            country: paymentMethod.card?.country,
            billingName: paymentMethod.billing_details?.name,
            signupEmail,
        });

        if (matches.length) {
            await checkRef.set({
                status: "blocked",
                matchedSignals: matches,
                checkedAt: Date.now(),
                leaseUntil: 0,
                leaseOwner: "",
                alertSent: false,
                enforcementComplete: false,
            }, { merge: true });
            await enforceBlock({
                uid,
                subscriptionId,
                stripe: params.stripe,
                matches,
                eventId: params.eventId,
                sessionId: params.sessionId,
                checkRef,
                alertNeeded: true,
            });
            return { outcome: "blocked", matches };
        }

        await checkRef.set({
            status: "passed",
            matchedSignals: [],
            checkedAt: Date.now(),
            leaseUntil: 0,
            leaseOwner: "",
            alertSent: false,
        }, { merge: true });
        await sendCheckAlert({
            uid,
            subscriptionId,
            sessionId: params.sessionId,
            eventId: params.eventId,
            outcome: "passed",
            matches: [],
        });
        await checkRef.set({ alertSent: true }, { merge: true });
        return { outcome: "passed", matches: [] };
    } catch (error) {
        const latest = await checkRef.get().catch(() => null);
        if (latest?.data()?.status !== "blocked") {
            await checkRef.set({ status: "retry", leaseUntil: 0, leaseOwner: "", lastErrorCode: "CHECK_OR_ENFORCEMENT_FAILED" }, { merge: true }).catch(() => undefined);
        }
        throw error;
    }
}

