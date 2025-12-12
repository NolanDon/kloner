// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import Stripe from "stripe";
import {
    getUidForStripeCustomer,
    linkCustomerToUid,
    mapPriceToTier,
    setUserTierFromStripe,
} from "../../_lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supports BOTH test + live on one endpoint.
 * Env:
 * - STRIPE_SECRET_KEY_LIVE (recommended)
 * - STRIPE_SECRET_KEY_TEST (recommended)
 * - STRIPE_WEBHOOK_SECRET_LIVE (recommended)
 * - STRIPE_WEBHOOK_SECRET_TEST (recommended)
 * Fallbacks supported:
 * - STRIPE_SECRET_KEY
 * - STRIPE_WEBHOOK_SECRET
 * - FIREBASE_SERVICE_ACCOUNT
 */

const LIVE_SECRET = process.env.STRIPE_SECRET_KEY_LIVE || process.env.STRIPE_SECRET_KEY || "";
const TEST_SECRET = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY || "";

const LIVE_WEBHOOK_SECRET =
    process.env.STRIPE_WEBHOOK_SECRET_LIVE || process.env.STRIPE_WEBHOOK_SECRET || "";
const TEST_WEBHOOK_SECRET =
    process.env.STRIPE_WEBHOOK_SECRET_TEST || process.env.STRIPE_WEBHOOK_SECRET || "";

const stripeLive = LIVE_SECRET
    ? new Stripe(LIVE_SECRET, { apiVersion: "2025-10-29.clover" })
    : null;
const stripeTest = TEST_SECRET
    ? new Stripe(TEST_SECRET, { apiVersion: "2025-10-29.clover" })
    : null;

function stripeForMode(livemode: boolean): Stripe | null {
    return livemode ? stripeLive : stripeTest;
}

// ---------------- firebase admin init ----------------
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

// ---------------- affiliate config ----------------
const AFF_RATE = 0.3;
const AFF_CAP_MONTHS = 12;
const AFF_PENDING_DAYS = 14;

// ---------------- utils ----------------
function cleanStr(v: unknown, max = 128): string {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
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
    return typeof anyInv.status_transitions?.paid_at === "number"
        ? anyInv.status_transitions.paid_at
        : typeof anyInv.created === "number"
            ? anyInv.created
            : Math.floor(Date.now() / 1000);
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
    if (fromLine) return fromLine;

    const parentSub =
        typeof line0?.parent?.subscription_item_details?.subscription === "string"
            ? line0.parent.subscription_item_details.subscription
            : typeof anyInv?.parent?.subscription_details?.subscription === "string"
                ? anyInv.parent.subscription_details.subscription
                : null;

    return parentSub || null;
}

function getInvoiceChargeId(invoice: Stripe.Invoice): string | null {
    const anyInv = invoice as any;
    const c = anyInv.charge;
    if (typeof c === "string") return c;
    if (c && typeof c.id === "string") return c.id;
    return null;
}

function getInvoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
    const anyInv = invoice as any;
    const pi = anyInv.payment_intent;
    if (typeof pi === "string") return pi;
    if (pi && typeof pi.id === "string") return pi.id;
    return null;
}

/**
 * Prefer invoice payload metadata (your payload has this),
 * then line item metadata.
 */
async function resolveAffiliateRefForInvoice(
    invoice: Stripe.Invoice,
): Promise<{ affiliateRef: string; affiliateSource: string }> {
    const anyInv = invoice as any;

    const parentMeta = anyInv?.parent?.subscription_details?.metadata;
    const pRef = cleanStr(parentMeta?.affiliateRef);
    const pSrc = cleanStr(parentMeta?.affiliateSource);
    if (pRef) return { affiliateRef: pRef, affiliateSource: pSrc };

    const lineMeta = anyInv?.lines?.data?.[0]?.metadata;
    const lRef = cleanStr(lineMeta?.affiliateRef);
    const lSrc = cleanStr(lineMeta?.affiliateSource);
    if (lRef) return { affiliateRef: lRef, affiliateSource: lSrc };

    return { affiliateRef: "", affiliateSource: "" };
}

// ---------------- uid resolution ----------------
async function findUidByCustomerId(customerId: string): Promise<string | null> {
    const snap = await db
        .collection("kloner_users")
        .where("stripeCustomerId", "==", customerId)
        .limit(1)
        .get();

    if (snap.empty) return null;
    return snap.docs[0]!.id;
}

async function resolveUidForCustomerId(customerId: string): Promise<string | null> {
    let uid = await getUidForStripeCustomer(customerId);

    if (!uid) {
        uid = await findUidByCustomerId(customerId);
        if (uid) await linkCustomerToUid(customerId, uid);
    }

    return uid;
}

// ---------------- affiliate lock ----------------
async function ensureAffiliateLockOnFirstPaid(params: {
    uid: string;
    invoice: Stripe.Invoice;
    paidAtDate: Date;
}): Promise<{ affiliateRefLocked: string; affiliateSourceLocked: string } | null> {
    const { uid, invoice, paidAtDate } = params;

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
            affiliateSourceLocked: lockedSrcExisting || "unknown",
        };
    }

    const resolved = await resolveAffiliateRefForInvoice(invoice);
    if (!resolved.affiliateRef) return null;

    await userRef.set(
        {
            affiliateRefLockedAt: admin.firestore.FieldValue.serverTimestamp(),
            affiliateRefLocked: resolved.affiliateRef,
            affiliateSourceLocked: resolved.affiliateSource || "unknown",
            affiliateLastSeenAt: admin.firestore.FieldValue.serverTimestamp(),

            affiliateFirstPaidAt:
                data?.affiliateFirstPaidAt instanceof admin.firestore.Timestamp
                    ? data.affiliateFirstPaidAt
                    : admin.firestore.Timestamp.fromDate(paidAtDate),
        },
        { merge: true },
    );

    return {
        affiliateRefLocked: resolved.affiliateRef,
        affiliateSourceLocked: resolved.affiliateSource || "unknown",
    };
}

// ---------------- reverse lookup docs (NO collectionGroup needed) ----------------
// Stores pointers to the ledger entry so refunds/disputes can update directly.
function reverseDocRef(kind: "invoice" | "charge" | "pi", id: string) {
    const col =
        kind === "invoice"
            ? "affiliate_reverse_invoice"
            : kind === "charge"
                ? "affiliate_reverse_charge"
                : "affiliate_reverse_pi";
    return db.collection(col).doc(id);
}

async function writeReverseLookup(params: {
    invoiceId: string;
    chargeId: string | null;
    paymentIntentId: string | null;
    affiliateRef: string;
    entryId: string; // invoiceId (entry doc id)
}) {
    const { invoiceId, chargeId, paymentIntentId, affiliateRef, entryId } = params;

    const payload = {
        affiliateRef,
        entryId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Always write invoice lookup (guaranteed present)
    await reverseDocRef("invoice", invoiceId).set(payload, { merge: true });

    // Best-effort for charge + PI
    if (chargeId) {
        await reverseDocRef("charge", chargeId).set(payload, { merge: true });
    }
    if (paymentIntentId) {
        await reverseDocRef("pi", paymentIntentId).set(payload, { merge: true });
    }
}

async function reverseViaLookup(params: {
    kind: "invoice" | "charge" | "pi";
    id: string;
    reason: "refund" | "dispute" | "void" | "failed";
}): Promise<boolean> {
    const { kind, id, reason } = params;

    const docSnap = await reverseDocRef(kind, id).get();
    if (!docSnap.exists) return false;

    const d = docSnap.data() as any;
    const affiliateRef = cleanStr(d?.affiliateRef);
    const entryId = cleanStr(d?.entryId);
    if (!affiliateRef || !entryId) return false;

    const entryRef = db
        .collection("affiliate_ledger")
        .doc(affiliateRef)
        .collection("entries")
        .doc(entryId);

    const now = admin.firestore.FieldValue.serverTimestamp();

    await entryRef.set(
        {
            status: "reversed",
            reversedAt: now,
            reversalReason: reason,
            updatedAt: now,
        },
        { merge: true },
    );

    return true;
}

// ---------------- ledger writer ----------------
async function writeAffiliateLedgerForInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;

    const uid = await resolveUidForCustomerId(customerId);
    if (!uid) return;

    const netCollectedCents = Number((invoice as any).amount_paid ?? 0);
    if (!Number.isFinite(netCollectedCents) || netCollectedCents <= 0) return;

    const paidAtSec = getInvoicePaidAtSec(invoice);
    const paidAtDate = getInvoicePaidAtDate(invoice);

    const locked = await ensureAffiliateLockOnFirstPaid({ uid, invoice, paidAtDate });
    if (!locked?.affiliateRefLocked) return;

    const affiliateRefUsed = locked.affiliateRefLocked;
    const affiliateSourceUsed = locked.affiliateSourceLocked || "unknown";

    // 12-month cap anchored to affiliateFirstPaidAt
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

    const existing = await entryRef.get();
    if (existing.exists) return;

    const commissionCents = Math.round(netCollectedCents * AFF_RATE);
    const periodKey = monthKeyFromUnix(paidAtSec);

    const eligibleAt = admin.firestore.Timestamp.fromDate(
        new Date(paidAtDate.getTime() + AFF_PENDING_DAYS * 24 * 60 * 60 * 1000),
    );

    const chargeId = getInvoiceChargeId(invoice);
    const paymentIntentId = getInvoicePaymentIntentId(invoice);
    const subscriptionId = getInvoiceSubscriptionId(invoice);

    await entryRef.set(
        {
            affiliateRef: affiliateRefUsed,
            affiliateSource: affiliateSourceUsed,

            uid,
            customerId,
            subscriptionId: subscriptionId || null,

            invoiceId: invoice.id,
            invoiceNumber: (invoice as any).number || null,

            chargeId: chargeId || null,
            paymentIntentId: paymentIntentId || null,

            netCollectedCents,
            commissionRate: AFF_RATE,
            commissionCents,

            currency: (invoice as any).currency || "usd",
            periodKey,

            paidAt: admin.firestore.Timestamp.fromDate(paidAtDate),
            eligibleAt,

            status: "pending",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: false },
    );

    // Critical: reversal lookups so refunds/disputes never need collectionGroup queries
    await writeReverseLookup({
        invoiceId: invoice.id,
        chargeId,
        paymentIntentId,
        affiliateRef: affiliateRefUsed,
        entryId: invoice.id,
    });
}

// ---------------- reversals ----------------
async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const anyC = charge as any;

    const chargeId = typeof anyC.id === "string" ? anyC.id : "";
    const paymentIntentId =
        typeof anyC.payment_intent === "string"
            ? anyC.payment_intent
            : typeof anyC.payment_intent?.id === "string"
                ? anyC.payment_intent.id
                : "";

    // Prefer charge lookup, fallback to PI lookup.
    if (chargeId) {
        const ok = await reverseViaLookup({ kind: "charge", id: chargeId, reason: "refund" });
        if (ok) return;
    }

    if (paymentIntentId) {
        await reverseViaLookup({ kind: "pi", id: paymentIntentId, reason: "refund" });
    }
}

async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
    const anyD = dispute as any;
    const chargeId = typeof anyD.charge === "string" ? anyD.charge : anyD.charge?.id;
    if (!chargeId) return;

    await reverseViaLookup({ kind: "charge", id: chargeId, reason: "dispute" });
}

async function handleInvoiceVoided(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice?.id) return;
    await reverseViaLookup({ kind: "invoice", id: invoice.id, reason: "void" });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice?.id) return;
    await reverseViaLookup({ kind: "invoice", id: invoice.id, reason: "failed" });
}

// ---------------- signature verification (accept live or test) ----------------
function constructEventWithAnySecret(body: string, sig: string): Stripe.Event {
    const errors: any[] = [];

    if (stripeLive && LIVE_WEBHOOK_SECRET) {
        try {
            return stripeLive.webhooks.constructEvent(body, sig, LIVE_WEBHOOK_SECRET);
        } catch (e) {
            errors.push(e);
        }
    }

    if (stripeTest && TEST_WEBHOOK_SECRET) {
        try {
            return stripeTest.webhooks.constructEvent(body, sig, TEST_WEBHOOK_SECRET);
        } catch (e) {
            errors.push(e);
        }
    }

    throw errors[errors.length - 1] || new Error("Signature verification failed");
}

export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
        return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
    }

    const body = await req.text();

    let event: Stripe.Event;
    try {
        event = constructEventWithAnySecret(body, sig);
    } catch (err: any) {
        console.error("Stripe webhook signature verification failed", err?.message || err);
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const livemode = !!(event as any).livemode;
    const stripe = stripeForMode(livemode);

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
                break;
            }

            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
            case "customer.subscription.trial_will_end": {
                const sub = event.data.object as Stripe.Subscription;

                const customerId =
                    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
                if (!customerId) break;

                const uid = await resolveUidForCustomerId(customerId);
                if (!uid) break;

                const firstItem = sub.items?.data?.[0];
                const priceId =
                    typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;

                const tier = mapPriceToTier(priceId);
                const status = sub.status;
                const effectiveTier = status === "active" || status === "trialing" ? tier : "free";

                await setUserTierFromStripe(uid, effectiveTier, {
                    customerId,
                    subscriptionId: sub.id,
                    priceId,
                    status,
                    currentPeriodEnd: (sub as any).current_period_end ?? undefined,
                    cancelAtPeriodEnd: (sub as any).cancel_at_period_end ?? undefined,
                });

                break;
            }

            case "invoice.paid": {
                const invoice = event.data.object as Stripe.Invoice;
                if (!stripe) break;

                // Re-fetch expanded invoice so chargeId/paymentIntentId/subscriptionId are populated.
                const invFull = await stripe.invoices.retrieve(invoice.id, {
                    expand: ["charge", "payment_intent", "subscription", "customer"],
                });

                await writeAffiliateLedgerForInvoicePaid(invFull as any);
                break;
            }

            case "invoice.voided": {
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoiceVoided(invoice);
                break;
            }

            case "invoice.payment_failed": {
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoicePaymentFailed(invoice);
                break;
            }

            case "charge.refunded": {
                const charge = event.data.object as Stripe.Charge;
                await handleChargeRefunded(charge);
                break;
            }

            case "charge.dispute.created": {
                const dispute = event.data.object as Stripe.Dispute;
                await handleDisputeCreated(dispute);
                break;
            }

            default:
                break;
        }

        return NextResponse.json({ received: true });
    } catch (err: any) {
        console.error("Stripe webhook handler error", err);
        return NextResponse.json({ error: "Webhook handler error" }, { status: 500 });
    }
}
