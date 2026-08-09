// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import admin from "firebase-admin";
import { Resend } from "resend";
import {
    effectiveTierFromStripeSubscription,
    getUidForStripeCustomer,
    linkCustomerToUid,
    mapPriceToTier,
    setUserTierFromStripe,
} from "../../_lib/billing";
import { captureCriticalEvent, captureException } from "@/lib/observability";
import { makeRecoveryCheckoutUrl, makeUnsubUrl } from "@/app/api/private/email-links";
import {
    canSendRecoveryOfferEmail,
    hasActiveOrTrialingStripeSubscription,
    hasLikelyActivePaidAccess,
} from "@/app/api/_lib/recoveryOffer";
import { buildRecoveryOfferEmail } from "@/app/api/_lib/recoveryOfferEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const WELCOME_SENDER = "Nolan From Kloner <hello@kloner.app>";
const RECOVERY_SENDER = "Kloner Team <hello@kloner.app>";

// ------------------------
// Stripe clients (support test + live safely)
// ------------------------
const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-10-29.clover";

const STRIPE_LIVE_KEY =
    process.env.STRIPE_SECRET_KEY_LIVE ||
    process.env.STRIPE_SECRET_KEY_PROD ||
    process.env.STRIPE_SECRET_KEY ||
    "";
const STRIPE_TEST_KEY =
    process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY || "";

const stripeLive = STRIPE_LIVE_KEY
    ? new Stripe(STRIPE_LIVE_KEY, { apiVersion: STRIPE_API_VERSION })
    : null;

const stripeTest = STRIPE_TEST_KEY
    ? new Stripe(STRIPE_TEST_KEY, { apiVersion: STRIPE_API_VERSION })
    : null;

function stripeForMode(livemode: boolean): Stripe {
    const s = livemode ? stripeLive : stripeTest;
    if (!s) {
        const k = process.env.STRIPE_SECRET_KEY || "";
        if (!k) throw new Error("Stripe API key missing");
        return new Stripe(k, { apiVersion: STRIPE_API_VERSION });
    }
    return s;
}

// Webhook secrets (support test + live; verify against both)
const WH_LIVE =
    process.env.STRIPE_WEBHOOK_SECRET_LIVE ||
    process.env.STRIPE_WEBHOOK_SECRET_PROD ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    "";
const WH_TEST =
    process.env.STRIPE_WEBHOOK_SECRET_TEST ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    "";

// ------------------------
// Firebase Admin init
// ------------------------
if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing for webhook");

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

// ------------------------
// Affiliate constants
// ------------------------
const AFF_RATE = 0.3;
const AFF_CAP_MONTHS = 12;
const AFF_PENDING_DAYS = 14;

function getResend() {
        const key = process.env.RESEND_API_KEY;
        if (!key) throw new Error("RESEND_API_KEY env not set");
        return new Resend(key);
}

function appOrigin() {
        return (process.env.FRONTEND_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://kloner.app").replace(/\/$/, "");
}

function buildTrialWelcomeHtml(args: { name?: string | null; dashboardUrl: string }) {
        const safeName = (args.name || "there").trim() || "there";

        return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>Your Kloner trial is live</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
            <td align="center" style="padding:40px 16px;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;">
                    <tr>
                        <td style="font-size:15px;line-height:1.65;">
                            <p style="margin:0 0 16px 0;">Hey ${safeName},</p>

                            <p style="margin:0 0 16px 0;">
                                Your Kloner trial is live. You can start building right now from the dashboard.
                            </p>

                            <p style="margin:0 0 16px 0;">
                                If you want a landing page, use the Generate website button.
                                If you want a full app, use the top prompt to describe what you want and let Kloner build the Next.js version for you.
                            </p>

                            <div style="margin:0 0 16px 0;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;">
                                <p style="margin:0 0 8px 0;font-weight:700;">Quick rule of thumb</p>
                                <p style="margin:0;color:#374151;">
                                    Landing pages are best for simple marketing sites.
                                    Next.js apps are better when you need auth, data, dashboards, or any app-like behavior.
                                </p>
                            </div>

                            <p style="margin:0 0 24px 0;">
                                <a href="${args.dashboardUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;">
                                    Open your dashboard
                                </a>
                            </p>

                            <p style="margin:0 0 28px 0;">
                                If you want help choosing the right starting point, just reply to this email.
                            </p>

                            <p style="margin:0 0 24px 0;color:#6b7280;">— The Kloner team</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

function buildTrialWelcomeText(args: { name?: string | null; dashboardUrl: string }) {
        const safeName = (args.name || "there").trim() || "there";

        return `Hey ${safeName},

Your Kloner trial is live. You can start building right now from the dashboard.

If you want a landing page, use the Generate website button.
If you want a full app, use the top prompt to describe what you want and let Kloner build the Next.js version for you.

Quick rule of thumb:
Landing pages are best for simple marketing sites.
Next.js apps are better when you need auth, data, dashboards, or any app-like behavior.

Open your dashboard:
${args.dashboardUrl}

If you want help choosing the right starting point, just reply to this email.

— The Kloner team`;
}

async function sendTrialWelcomeEmail(params: {
        uid: string;
        sessionId: string;
        email: string;
        name?: string | null;
}) {
        const userRef = db.collection("kloner_users").doc(params.uid);
        const snap = await userRef.get();
        const data = snap.exists ? (snap.data() as any) : {};
        if (data?.trialWelcomeEmailSessionId === params.sessionId) return;

        const from = process.env.WELCOME_EMAIL_FROM || WELCOME_SENDER;
        if (!from) throw new Error("WELCOME_EMAIL_FROM env not set");

        const dashboardUrl = `${appOrigin()}/dashboard/view`;
        const resend = getResend();
        const result = await resend.emails.send({
                from,
                to: params.email,
                subject: "Welcome to your Kloner trial",
                text: buildTrialWelcomeText({ name: params.name, dashboardUrl }),
                html: buildTrialWelcomeHtml({ name: params.name, dashboardUrl }),
        });

        if ("error" in result && result.error) {
                throw new Error(result.error.message || "Email send failed");
        }

        await userRef.set(
                {
                        trialWelcomeEmailSessionId: params.sessionId,
                        trialWelcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true },
        );
}

function hasRecoveryOfferEmail(userData: Record<string, any> | null | undefined): boolean {
        if (!userData || typeof userData !== "object") return false;
        const nested = (userData as any)?.offers;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
                if ((nested as any).exitOffer40RecoveryEmailSentAt) return true;
                if ((nested as any).exitOffer40RecoveryEmailSessionId) return true;
                if ((nested as any).winback40RecoveryEmailSentAt) return true;
        }
        if ((userData as any)["offers.exitOffer40RecoveryEmailSentAt"]) return true;
        if ((userData as any)["offers.winback40RecoveryEmailSentAt"]) return true;
        return false;
}

async function claimRecoveryOfferEmailOnce(userRef: FirebaseFirestore.DocumentReference, sessionId: string): Promise<boolean> {
        return db.runTransaction(async (tx: any) => {
                const snap = await tx.get(userRef);
                const data = snap.exists ? (snap.data() as Record<string, any>) : {};
                if (hasRecoveryOfferEmail(data)) return false;

                tx.set(
                        userRef,
                        {
                                offers: {
                                        ...(data?.offers && typeof data.offers === "object" && !Array.isArray(data.offers) ? data.offers : {}),
                                        exitOffer40RecoveryEmailSessionId: sessionId,
                                        exitOffer40RecoveryEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
                                },
                        },
                        { merge: true },
                );

                return true;
        });
}

async function sendRecoveryOfferEmail(params: {
    uid: string;
    sessionId: string;
    email: string;
    name?: string | null;
    stripe: Stripe;
    customerId?: string | null;
}) {
        const userRef = db.collection("kloner_users").doc(params.uid);
        const snap = await userRef.get();
        const data = snap.exists ? (snap.data() as any) : {};
        const activityGate = canSendRecoveryOfferEmail(data);
        if (!activityGate.ok) return;

        if (hasLikelyActivePaidAccess(data)) return;

        const customerId =
            typeof params.customerId === "string" && params.customerId.trim()
                ? params.customerId.trim()
                : typeof data?.stripeCustomerId === "string" && data.stripeCustomerId.trim()
                    ? data.stripeCustomerId.trim()
                    : "";
        if (customerId) {
            const activeSub = await hasActiveOrTrialingStripeSubscription(params.stripe, customerId).catch(() => false);
            if (activeSub) return;
        }

        const canClaim = await claimRecoveryOfferEmailOnce(userRef, params.sessionId);
        if (!canClaim) return;

        const from = process.env.WELCOME_EMAIL_FROM || RECOVERY_SENDER;
        const linkUrl = makeRecoveryCheckoutUrl({ uid: params.uid, kind: "exit40" });
        const unsubUrl = makeUnsubUrl({ uid: params.uid, kind: "journey" });
        const offer = buildRecoveryOfferEmail({
                name: params.name,
                linkUrl,
                unsubUrl,
                variant: "checkout",
        });
        const resend = getResend();
        const result = await resend.emails.send({
                from,
                to: params.email,
                subject: offer.subject,
                text: offer.text,
                html: offer.html,
        });

        if (result && typeof result === "object" && "error" in result && (result as any).error) {
                throw new Error(((result as any).error?.message as string) || "Recovery email send failed");
        }
}

// ------------------------
// Helpers
// ------------------------
function cleanStr(v: unknown, max = 128): string {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function cleanInt(v: unknown): number | null {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : NaN;
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n));
}

async function applyAiCreditTopupFromCheckoutSession(session: Stripe.Checkout.Session) {
    const meta = (session.metadata || {}) as Record<string, any>;
    if (cleanStr(meta.type) !== "ai_credit_topup") return;

    // Only credit after Stripe confirms payment.
    // For async methods, use checkout.session.async_payment_succeeded.
    const paymentStatus = typeof (session as any).payment_status === "string" ? (session as any).payment_status : "";
    if (paymentStatus && paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
        return;
    }

    const uid = cleanStr(meta.firebaseUid || meta.uid, 256);
    const credits = cleanInt(meta.aiEditCredits);

    if (!uid || !credits) {
        console.warn("[stripe-webhook] topup missing uid/credits", {
            sessionId: session.id,
            uid,
            credits,
        });
        return;
    }

    const topupRef = db.collection("stripe_credit_topups").doc(session.id);
    const userRef = db.collection("kloner_users").doc(uid);

    await db.runTransaction(async (tx: any) => {
        const topupSnap = await tx.get(topupRef);
        if (topupSnap.exists) return;

        const userSnap = await tx.get(userRef);
        const data = userSnap.exists ? (userSnap.data() as any) : {};
        const bucket = data["credits.aiEdits"] || (data.credits && data.credits.aiEdits) || {};

        // If remaining is null, treat as unlimited and skip crediting.
        const remainingRaw = bucket?.remaining;
        if (remainingRaw === null) {
            tx.set(
                topupRef,
                {
                    uid,
                    credits,
                    skipped: true,
                    reason: "unlimited_remaining_null",
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    livemode: !!session.livemode,
                    customerId:
                        typeof session.customer === "string" ? session.customer : session.customer?.id || null,
                    paymentIntentId:
                        typeof session.payment_intent === "string"
                            ? session.payment_intent
                            : session.payment_intent?.id || null,
                },
                { merge: true },
            );
            return;
        }

        const remaining =
            typeof remainingRaw === "number" && Number.isFinite(remainingRaw) && remainingRaw >= 0
                ? remainingRaw
                : 0;

        const monthlyLimitRaw = bucket?.monthlyLimit;
        const monthlyLimit =
            typeof monthlyLimitRaw === "number" && Number.isFinite(monthlyLimitRaw) && monthlyLimitRaw >= 0
                ? monthlyLimitRaw
                : null;

        const bonusRaw = (bucket as any)?.bonusRemaining;
        const existingBonus =
            typeof bonusRaw === "number" && Number.isFinite(bonusRaw) && bonusRaw >= 0
                ? Math.floor(bonusRaw)
                : monthlyLimit !== null
                    ? Math.max(0, remaining - monthlyLimit)
                    : 0;

        const newRemaining = remaining + credits;
        const newBonusRemaining = existingBonus + credits;

        const nextBucket: Record<string, any> = {
            ...(bucket && typeof bucket === "object" ? bucket : {}),
            remaining: newRemaining,
            bonusRemaining: newBonusRemaining,
            lastTopUpAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Avoid writing undefined fields.
        for (const k of Object.keys(nextBucket)) {
            if (nextBucket[k] === undefined) delete nextBucket[k];
        }

        tx.set(userRef, { "credits.aiEdits": nextBucket }, { merge: true });

        tx.set(
            topupRef,
            {
                uid,
                credits,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                livemode: !!session.livemode,
                customerId:
                    typeof session.customer === "string" ? session.customer : session.customer?.id || null,
                paymentIntentId:
                    typeof session.payment_intent === "string"
                        ? session.payment_intent
                        : session.payment_intent?.id || null,
                paymentStatus: paymentStatus || null,
            },
            { merge: true },
        );
    });
}

function monthKeyFromUnix(tsSec: number): string {
    const d = new Date(tsSec * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}

function addMonths(date: Date, months: number): Date {
    const d = new Date(date.getTime());
    d.setUTCMonth(d.getUTCMonth() + months);
    return d;
}

function getInvoicePaidAtSec(invoice: Stripe.Invoice): number {
    const anyInv = invoice as any;
    const paidAtSec =
        typeof anyInv.status_transitions?.paid_at === "number"
            ? anyInv.status_transitions.paid_at
            : typeof anyInv.created === "number"
                ? anyInv.created
                : Math.floor(Date.now() / 1000);
    return paidAtSec;
}

function getInvoicePaidAtDate(invoice: Stripe.Invoice): Date {
    return new Date(getInvoicePaidAtSec(invoice) * 1000);
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const anyInv = invoice as any;

    const direct =
        typeof anyInv.subscription === "string"
            ? anyInv.subscription
            : typeof anyInv.subscription?.id === "string"
                ? anyInv.subscription.id
                : null;
    if (direct) return direct;

    const line0 = anyInv.lines?.data?.[0];
    const fromLine =
        typeof line0?.subscription === "string"
            ? line0.subscription
            : typeof line0?.subscription?.id === "string"
                ? line0.subscription.id
                : null;

    const parentSub =
        typeof anyInv?.parent?.subscription_details?.subscription === "string"
            ? anyInv.parent.subscription_details.subscription
            : typeof anyInv?.parent?.subscription_details?.subscription?.id === "string"
                ? anyInv.parent.subscription_details.subscription.id
                : null;

    return fromLine || parentSub || null;
}

/** Fallback: find uid by stripeCustomerId field if mapping doc is missing */
async function findUidByCustomerId(customerId: string): Promise<string | null> {
    const snap = await db
        .collection("kloner_users")
        .where("stripeCustomerId", "==", customerId)
        .limit(1)
        .get();

    if (snap.empty) return null;
    return snap.docs[0]!.id;
}

/** Resolve uid from mapping table or fallback query */
async function resolveUidForCustomerId(customerId: string): Promise<string | null> {
    let uid = await getUidForStripeCustomer(customerId);

    if (!uid) {
        uid = await findUidByCustomerId(customerId);
        if (uid) await linkCustomerToUid(customerId, uid);
    }

    return uid;
}

/**
 * Prefer metadata from invoice payload, then subscription metadata, then customer metadata.
 */
async function resolveAffiliateRefForInvoice(params: {
    stripe: Stripe;
    invoice: Stripe.Invoice;
}): Promise<{ affiliateRef: string; affiliateSource: string }> {
    const { stripe, invoice } = params;
    const anyInv = invoice as any;

    const parentMeta = anyInv?.parent?.subscription_details?.metadata;
    const pRef = cleanStr(parentMeta?.affiliateRef);
    const pSrc = cleanStr(parentMeta?.affiliateSource);
    if (pRef) return { affiliateRef: pRef, affiliateSource: pSrc };

    const lineMeta = anyInv?.lines?.data?.[0]?.metadata;
    const lRef = cleanStr(lineMeta?.affiliateRef);
    const lSrc = cleanStr(lineMeta?.affiliateSource);
    if (lRef) return { affiliateRef: lRef, affiliateSource: lSrc };

    try {
        const subId = getInvoiceSubscriptionId(invoice);
        if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            const affiliateRef = cleanStr((sub.metadata as any)?.affiliateRef);
            const affiliateSource = cleanStr((sub.metadata as any)?.affiliateSource);
            if (affiliateRef) return { affiliateRef, affiliateSource };
        }
    } catch { }

    try {
        const custId =
            typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (custId) {
            const cust = await stripe.customers.retrieve(custId);
            const meta = (cust as any)?.metadata || {};
            const affiliateRef = cleanStr(meta?.affiliateRef);
            const affiliateSource = cleanStr(meta?.affiliateSource);
            if (affiliateRef) return { affiliateRef, affiliateSource };
        }
    } catch { }

    return { affiliateRef: "", affiliateSource: "" };
}

/**
 * Hard rule: lock affiliateRef on first paid.
 */
async function ensureAffiliateLockOnFirstPaid(params: {
    uid: string;
    stripe: Stripe;
    invoice: Stripe.Invoice;
    paidAtDate: Date;
}): Promise<{ affiliateRefLocked: string; affiliateSourceLocked: string } | null> {
    const { uid, stripe, invoice, paidAtDate } = params;

    const userRef = db.collection("kloner_users").doc(uid);
    const snap = await userRef.get();
    const data = snap.exists ? (snap.data() as any) : {};

    const lockedAtExists = !!data?.affiliateRefLockedAt;
    const lockedRefExisting = cleanStr(data?.affiliateRefLocked || "");
    const lockedSrcExisting = cleanStr(data?.affiliateSourceLocked || "");

    if (lockedAtExists && lockedRefExisting) {
        await userRef.set(
            { affiliateLastSeenAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true },
        );
        return {
            affiliateRefLocked: lockedRefExisting,
            affiliateSourceLocked:
                lockedSrcExisting || cleanStr(data?.affiliateSource || "") || "unknown",
        };
    }

    const resolved = await resolveAffiliateRefForInvoice({ stripe, invoice });
    const affiliateRef = resolved.affiliateRef;
    const affiliateSource =
        resolved.affiliateSource || cleanStr(data?.affiliateSource || "") || "unknown";

    if (!affiliateRef) return null;

    const existingFirstPaid =
        data?.affiliateFirstPaidAt instanceof admin.firestore.Timestamp
            ? (data.affiliateFirstPaidAt as admin.firestore.Timestamp)
            : null;

    await userRef.set(
        {
            affiliateRefLockedAt: admin.firestore.FieldValue.serverTimestamp(),
            affiliateRefLocked: affiliateRef,
            affiliateSourceLocked: affiliateSource || "unknown",
            affiliateLastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
            affiliateFirstPaidAt: existingFirstPaid
                ? existingFirstPaid
                : admin.firestore.Timestamp.fromDate(paidAtDate),
        },
        { merge: true },
    );

    return {
        affiliateRefLocked: affiliateRef,
        affiliateSourceLocked: affiliateSource || "unknown",
    };
}

function statusForReason(reason: "refund" | "dispute" | "voided" | "failed") {
    if (reason === "refund") return "refunded";
    if (reason === "dispute") return "disputed";
    return "reversed";
}

async function reverseEntryDirect(params: {
    affiliateRef: string;
    entryId: string;
    reason: "refund" | "dispute" | "voided" | "failed";
}): Promise<void> {
    const { affiliateRef, entryId, reason } = params;

    const ref = db
        .collection("affiliate_ledger")
        .doc(affiliateRef)
        .collection("entries")
        .doc(entryId);

    const snap = await ref.get();
    if (!snap.exists) return;

    const cur = snap.data() as any;
    if (cur?.status === "refunded" || cur?.status === "disputed" || cur?.status === "reversed")
        return;

    const now = admin.firestore.FieldValue.serverTimestamp();

    await ref.set(
        {
            status: statusForReason(reason),
            reversedAt: now,
            reversalReason: reason,
            updatedAt: now,
        },
        { merge: true },
    );
}

async function reverseByLookupId(params: {
    lookupId: string;
    reason: "refund" | "dispute" | "voided" | "failed";
}): Promise<void> {
    const { lookupId, reason } = params;

    const snap = await db.collection("affiliate_reverse_invoice").doc(lookupId).get();
    if (!snap.exists) return;

    const data = snap.data() as any;
    const affiliateRef = cleanStr(data?.affiliateRef || "");
    const entryId = cleanStr(data?.entryId || "");
    if (!affiliateRef || !entryId) return;

    await reverseEntryDirect({ affiliateRef, entryId, reason });
}

/**
 * Find the subscription invoice for a PaymentIntent.
 * This is the core join that fixes your “invoice.paid has no pi/ch” problem.
 */
async function findInvoiceIdForPaymentIntent(stripe: Stripe, piId: string): Promise<string> {
    if (!piId) return "";
    try {
        const res = await stripe.invoices.search({
            query: `payment_intent:"${piId}"`,
            limit: 1,
        });
        return res.data?.[0]?.id || "";
    } catch (e) {
        console.error("[stripe] invoices.search payment_intent failed", { piId }, e);
        return "";
    }
}

async function writeAffiliateLedgerForInvoicePaid(params: {
    stripe: Stripe;
    invoice: Stripe.Invoice;
    overrides?: {
        chargeId?: string | null;
        paymentIntentId?: string | null;
    };
}): Promise<void> {
    const { stripe, invoice, overrides } = params;

    const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;

    const uid = await resolveUidForCustomerId(customerId);
    if (!uid) return;

    const netCollectedCents = Number((invoice as any).amount_paid ?? 0);
    if (!Number.isFinite(netCollectedCents) || netCollectedCents <= 0) return;

    const paidAtSec = getInvoicePaidAtSec(invoice);
    const paidAtDate = getInvoicePaidAtDate(invoice);

    const locked = await ensureAffiliateLockOnFirstPaid({
        uid,
        stripe,
        invoice,
        paidAtDate,
    });
    if (!locked?.affiliateRefLocked) return;

    const affiliateRefUsed = locked.affiliateRefLocked;
    const affiliateSourceUsed = locked.affiliateSourceLocked || "unknown";

    const userRef = db.collection("kloner_users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? (userSnap.data() as any) : {};
    const firstPaidAt =
        userData?.affiliateFirstPaidAt instanceof admin.firestore.Timestamp
            ? (userData.affiliateFirstPaidAt as admin.firestore.Timestamp)
            : null;

    if (firstPaidAt) {
        const capEnd = addMonths(firstPaidAt.toDate(), AFF_CAP_MONTHS);
        if (paidAtDate.getTime() > capEnd.getTime()) return;
    }

    const entryRef = db
        .collection("affiliate_ledger")
        .doc(affiliateRefUsed)
        .collection("entries")
        .doc(invoice.id);

    const chargeId = cleanStr(overrides?.chargeId || "") || null;
    const paymentIntentId = cleanStr(overrides?.paymentIntentId || "") || null;

    const subscriptionId = getInvoiceSubscriptionId(invoice);
    const commissionCents = Math.round(netCollectedCents * AFF_RATE);
    const periodKey = monthKeyFromUnix(paidAtSec);

    const eligibleAt = admin.firestore.Timestamp.fromDate(
        new Date(paidAtDate.getTime() + AFF_PENDING_DAYS * 24 * 60 * 60 * 1000),
    );

    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(entryRef);

        if (!snap.exists) {
            tx.set(
                entryRef,
                {
                    affiliateRef: affiliateRefUsed,
                    affiliateSource: affiliateSourceUsed,

                    uid,
                    customerId,
                    subscriptionId: subscriptionId || null,

                    invoiceId: invoice.id,
                    invoiceNumber: (invoice as any).number || null,

                    chargeId,
                    paymentIntentId,

                    netCollectedCents,
                    commissionRate: AFF_RATE,
                    commissionCents,

                    currency: (invoice as any).currency || "usd",
                    periodKey,

                    paidAt: admin.firestore.Timestamp.fromDate(paidAtDate),
                    eligibleAt,

                    status: "pending",
                    createdAt: now,
                    updatedAt: now,
                },
                { merge: false },
            );
        } else {
            const cur = snap.data() as any;

            // Patch only missing ids, never overwrite non-null ids
            const patch: any = { updatedAt: now };

            if (!cur?.chargeId && chargeId) patch.chargeId = chargeId;
            if (!cur?.paymentIntentId && paymentIntentId) patch.paymentIntentId = paymentIntentId;

            // If nothing to patch, do nothing.
            if (Object.keys(patch).length > 1) {
                tx.set(entryRef, patch, { merge: true });
            }
        }
    });
}


/**
 * Create the affiliate ledger entry from charge.succeeded (the event that reliably has pi + ch).
 * It finds the invoice via payment_intent and then calls the same writer.
 */
async function handleChargeSucceededForAffiliate(params: {
    stripe: Stripe;
    charge: Stripe.Charge;
}): Promise<void> {
    const { stripe, charge } = params;

    const chId = typeof charge.id === "string" ? charge.id : "";
    const piId =
        typeof (charge as any).payment_intent === "string"
            ? (charge as any).payment_intent
            : typeof (charge as any).payment_intent?.id === "string"
                ? (charge as any).payment_intent.id
                : "";

    if (!chId || !piId) return;

    const invoiceId = await findInvoiceIdForPaymentIntent(stripe, piId);
    if (!invoiceId) return;

    try {
        const invFull = await stripe.invoices.retrieve(invoiceId, {
            expand: ["subscription"],
        });
        await writeAffiliateLedgerForInvoicePaid({
            stripe,
            invoice: invFull,
            overrides: { chargeId: chId, paymentIntentId: piId },
        });
    } catch (e) {
        console.error("[stripe] charge.succeeded -> invoice.retrieve failed", { invoiceId, chId, piId }, e);
    }
}

/**
 * Refund reversal driven by refund.created (refund object has pi + charge).
 * This is the second half of the “same payment_intent join” approach.
 */
async function handleRefundCreatedForAffiliate(params: {
    stripe: Stripe;
    refund: Stripe.Refund;
}): Promise<void> {
    const { stripe, refund } = params;

    const piId =
        typeof refund.payment_intent === "string"
            ? refund.payment_intent
            : (refund.payment_intent as any)?.id;

    const chId =
        typeof refund.charge === "string"
            ? refund.charge
            : (refund.charge as any)?.id;

    // Prefer PI join (most reliable), fallback to charge join
    const invoiceId = piId ? await findInvoiceIdForPaymentIntent(stripe, piId) : "";
    if (invoiceId) {
        await reverseByLookupId({ lookupId: `inv_${invoiceId}`, reason: "refund" });
        return;
    }

    if (piId) await reverseByLookupId({ lookupId: `pi_${piId}`, reason: "refund" });
    if (chId) await reverseByLookupId({ lookupId: `ch_${chId}`, reason: "refund" });
}

// ------------------------
// Webhook handler
// ------------------------
export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
        await captureCriticalEvent({
            source: "vercel",
            severity: "error",
            statusCode: 400,
            route: req.nextUrl?.pathname,
            method: "POST",
            action: "stripe.webhook.signature",
            message: "Missing stripe-signature",
            service: "stripe-webhook",
            url: req.url,
        });
        return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
    }

    const body = await req.text();

    // Verify against live then test
    let event: Stripe.Event | null = null;
    let usedSecret: string | null = null;

    if (WH_LIVE) {
        try {
            event = stripeForMode(true).webhooks.constructEvent(body, sig, WH_LIVE);
            usedSecret = WH_LIVE;
        } catch { }
    }

    if (!event && WH_TEST) {
        try {
            event = stripeForMode(false).webhooks.constructEvent(body, sig, WH_TEST);
            usedSecret = WH_TEST;
        } catch { }
    }

    if (!event || !usedSecret) {
        await captureCriticalEvent({
            source: "vercel",
            severity: "error",
            statusCode: 400,
            route: req.nextUrl?.pathname,
            method: "POST",
            action: "stripe.webhook.signature",
            message: "Invalid signature",
            service: "stripe-webhook",
            url: req.url,
        });
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const stripe = stripeForMode(!!event.livemode);

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;

                const firebaseUid = session.metadata?.firebaseUid as string | undefined;
                const customerId =
                    typeof session.customer === "string" ? session.customer : session.customer?.id;

                if (firebaseUid && customerId) {
                    await linkCustomerToUid(customerId, firebaseUid);
                }

                await applyAiCreditTopupFromCheckoutSession(session);

                const checkoutFlow = cleanStr((session.metadata as any)?.checkoutFlow, 64);
                if (firebaseUid && checkoutFlow === "app_deploy_trial") {
                    try {
                        const authUser = await admin.auth().getUser(firebaseUid);
                        const email = authUser.email?.trim() || "";
                        if (email) {
                            await sendTrialWelcomeEmail({
                                uid: firebaseUid,
                                sessionId: session.id,
                                email,
                                name: authUser.displayName || null,
                            });
                        }
                    } catch (err) {
                        console.error("[stripe-webhook] trial welcome email failed", err);
                    }
                }
                break;
            }

            case "checkout.session.expired": {
                const session = event.data.object as Stripe.Checkout.Session;
                const firebaseUid = session.metadata?.firebaseUid as string | undefined;
                const plan = cleanStr((session.metadata as any)?.plan, 64);

                if (firebaseUid && plan === "pro") {
                    try {
                        const authUser = await admin.auth().getUser(firebaseUid);
                        const email = authUser.email?.trim() || "";
                        if (email) {
                            await sendRecoveryOfferEmail({
                                uid: firebaseUid,
                                sessionId: session.id,
                                email,
                                name: authUser.displayName || null,
                                stripe,
                                customerId: typeof session.customer === "string" ? session.customer : null,
                            });
                        }
                    } catch (err) {
                        console.error("[stripe-webhook] recovery email failed", err);
                    }
                }
                break;
            }

            case "checkout.session.async_payment_succeeded": {
                const session = event.data.object as Stripe.Checkout.Session;
                await applyAiCreditTopupFromCheckoutSession(session);
                break;
            }

            case "checkout.session.async_payment_failed": {
                // No-op for top-ups; user can retry.
                break;
            }

            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
            case "customer.subscription.trial_will_end": {
                const sub = event.data.object as Stripe.Subscription;

                const customerId =
                    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
                if (!customerId) break;

                const uid = await resolveUidForCustomerId(customerId);
                if (!uid) break;

                const firstItem = sub.items?.data?.[0];
                const priceId =
                    typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;

                const tier = mapPriceToTier(priceId);
                const status = sub.status;
                const effectiveTier = effectiveTierFromStripeSubscription({
                    mappedTier: tier,
                    status,
                    currentPeriodEnd: (sub as any).current_period_end ?? null,
                    trialEnd: (sub as any).trial_end ?? null,
                    created: typeof (sub as any).created === "number" ? (sub as any).created : null,
                });

                await setUserTierFromStripe(uid, effectiveTier, {
                    customerId,
                    subscriptionId: sub.id,
                    priceId,
                    status,
                    currentPeriodEnd: (sub as any).current_period_end ?? undefined,
                    trialEnd: (sub as any).trial_end ?? undefined,
                    cancelAtPeriodEnd: (sub as any).cancel_at_period_end ?? undefined,
                });

                break;
            }

            // PRIMARY: capture pi + ch reliably, then create affiliate entry via invoice lookup
            case "charge.succeeded": {
                const charge = event.data.object as Stripe.Charge;
                await handleChargeSucceededForAffiliate({ stripe, charge });
                break;
            }

            // Safety net: keep invoice.paid so you still create entries even if you miss charge.succeeded
            case "invoice.paid":
            case "invoice.payment_succeeded": {
                const inv = event.data.object as Stripe.Invoice;

                // These often exist on the invoice; if not, retrieve the invoice to fill them.
                let piId =
                    typeof (inv as any).payment_intent === "string"
                        ? (inv as any).payment_intent
                        : typeof (inv as any).payment_intent?.id === "string"
                            ? (inv as any).payment_intent.id
                            : "";

                let chId =
                    typeof (inv as any).charge === "string"
                        ? (inv as any).charge
                        : typeof (inv as any).charge?.id === "string"
                            ? (inv as any).charge.id
                            : "";

                let invFull: Stripe.Invoice | null = null;

                if (!piId || !chId) {
                    try {
                        invFull = await stripe.invoices.retrieve(inv.id, {
                            expand: ["payment_intent", "charge"],
                        });

                        piId =
                            typeof (invFull as any).payment_intent === "string"
                                ? (invFull as any).payment_intent
                                : typeof (invFull as any).payment_intent?.id === "string"
                                    ? (invFull as any).payment_intent.id
                                    : piId;

                        chId =
                            typeof (invFull as any).charge === "string"
                                ? (invFull as any).charge
                                : typeof (invFull as any).charge?.id === "string"
                                    ? (invFull as any).charge.id
                                    : chId;
                    } catch (e) {
                        console.error("[stripe] invoice.retrieve for ids failed", { invoiceId: inv.id }, e);
                    }
                }

                await writeAffiliateLedgerForInvoicePaid({
                    stripe,
                    invoice: invFull || inv,
                    overrides: {
                        chargeId: chId || null,
                        paymentIntentId: piId || null,
                    },
                });

                break;
            }

            case "invoice.voided": {
                const inv = event.data.object as Stripe.Invoice;
                await reverseByLookupId({ lookupId: `inv_${inv.id}`, reason: "voided" });
                break;
            }

            case "invoice.payment_failed": {
                const inv = event.data.object as Stripe.Invoice;
                await reverseByLookupId({ lookupId: `inv_${inv.id}`, reason: "failed" });
                break;
            }

            // PRIMARY: refund object has pi + ch (same join key as charge.succeeded)
            case "refund.created": {
                const refund = event.data.object as Stripe.Refund;
                await handleRefundCreatedForAffiliate({ stripe, refund });
                break;
            }

            // Fallbacks you might still receive
            case "charge.refunded": {
                const obj: any = event.data.object as any;

                // Some Stripe setups send charge.refunded with a Charge, not a Refund
                if (obj?.object === "charge") {
                    const charge = obj as Stripe.Charge;
                    const chId = typeof charge.id === "string" ? charge.id : "";
                    const piId =
                        typeof (charge as any).payment_intent === "string"
                            ? (charge as any).payment_intent
                            : typeof (charge as any).payment_intent?.id === "string"
                                ? (charge as any).payment_intent.id
                                : "";

                    const invoiceId = piId ? await findInvoiceIdForPaymentIntent(stripe, piId) : "";
                    if (invoiceId) {
                        await reverseByLookupId({ lookupId: `inv_${invoiceId}`, reason: "refund" });
                    } else {
                        if (piId) await reverseByLookupId({ lookupId: `pi_${piId}`, reason: "refund" });
                        if (chId) await reverseByLookupId({ lookupId: `ch_${chId}`, reason: "refund" });
                    }
                } else if (obj?.object === "refund") {
                    await handleRefundCreatedForAffiliate({ stripe, refund: obj as Stripe.Refund });
                }
                break;
            }

            case "charge.dispute.created": {
                const dispute = event.data.object as Stripe.Dispute;

                const chId =
                    typeof (dispute as any).charge === "string"
                        ? (dispute as any).charge
                        : typeof (dispute as any).charge?.id === "string"
                            ? (dispute as any).charge.id
                            : null;

                if (chId) {
                    await reverseByLookupId({ lookupId: `ch_${chId}`, reason: "dispute" });
                }
                break;
            }

            default:
                break;
        }

        return NextResponse.json({ received: true });
    } catch (err: any) {
        console.error("Stripe webhook handler error", err);
        await captureException({
            source: "vercel",
            error: err,
            route: req.nextUrl?.pathname,
            method: "POST",
            action: "stripe.webhook.handle",
            statusCode: 500,
            service: "stripe-webhook",
            url: req.url,
            extra: {
                eventType: event?.type || null,
                livemode: typeof event?.livemode === "boolean" ? event.livemode : null,
            },
        });
        return NextResponse.json({ error: "Webhook handler error" }, { status: 500 });
    }
}
