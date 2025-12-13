// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import admin from "firebase-admin";
import {
    getUidForStripeCustomer,
    linkCustomerToUid,
    mapPriceToTier,
    setUserTierFromStripe,
} from "../../_lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ------------------------
// Stripe clients (support test + live safely)
// ------------------------
const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-10-29.clover";

const STRIPE_LIVE_KEY =
    process.env.STRIPE_SECRET_KEY_LIVE || process.env.STRIPE_SECRET_KEY || "";
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

// ------------------------
// Helpers
// ------------------------
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

/**
 * Reverse lookup docs
 * IDs:
 * - inv_{invoiceId}
 * - ch_{chargeId}
 * - pi_{paymentIntentId}
 */
async function writeReverseLookupDocs(params: {
    affiliateRef: string;
    entryId: string; // invoice.id
    chargeId?: string | null;
    paymentIntentId?: string | null;
}): Promise<void> {
    const { affiliateRef, entryId, chargeId, paymentIntentId } = params;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const batch = db.batch();

    batch.set(
        db.collection("affiliate_reverse_invoice").doc(`inv_${entryId}`),
        { affiliateRef, entryId, updatedAt: now },
        { merge: true },
    );

    if (chargeId) {
        batch.set(
            db.collection("affiliate_reverse_invoice").doc(`ch_${chargeId}`),
            { affiliateRef, entryId, updatedAt: now },
            { merge: true },
        );
    }

    if (paymentIntentId) {
        batch.set(
            db.collection("affiliate_reverse_invoice").doc(`pi_${paymentIntentId}`),
            { affiliateRef, entryId, updatedAt: now },
            { merge: true },
        );
    }

    await batch.commit();
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

    // Entry idempotency: invoice.id
    const entryRef = db
        .collection("affiliate_ledger")
        .doc(affiliateRefUsed)
        .collection("entries")
        .doc(invoice.id);

    const existing = await entryRef.get();
    if (existing.exists) return;

    const subscriptionId = getInvoiceSubscriptionId(invoice);

    const chargeId = cleanStr(overrides?.chargeId || "") || null;
    const paymentIntentId = cleanStr(overrides?.paymentIntentId || "") || null;

    const commissionCents = Math.round(netCollectedCents * AFF_RATE);
    const periodKey = monthKeyFromUnix(paidAtSec);

    const eligibleAt = admin.firestore.Timestamp.fromDate(
        new Date(paidAtDate.getTime() + AFF_PENDING_DAYS * 24 * 60 * 60 * 1000),
    );

    const now = admin.firestore.FieldValue.serverTimestamp();

    await entryRef.set(
        {
            affiliateRef: affiliateRefUsed,
            affiliateSource: affiliateSourceUsed,

            uid,
            customerId,
            subscriptionId: subscriptionId || null,

            invoiceId: invoice.id,
            invoiceNumber: (invoice as any).number || null,

            // These are now sourced from charge.succeeded (reliable),
            // and invoice.paid is just a redundant safety net.
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

    await writeReverseLookupDocs({
        affiliateRef: affiliateRefUsed,
        entryId: invoice.id,
        chargeId,
        paymentIntentId,
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

            // PRIMARY: capture pi + ch reliably, then create affiliate entry via invoice lookup
            case "charge.succeeded": {
                const charge = event.data.object as Stripe.Charge;
                await handleChargeSucceededForAffiliate({ stripe, charge });
                break;
            }

            // Safety net: keep invoice.paid so you still create entries even if you miss charge.succeeded
            case "invoice.paid": {
                const inv = event.data.object as Stripe.Invoice;
                await writeAffiliateLedgerForInvoicePaid({ stripe, invoice: inv });
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
        return NextResponse.json({ error: "Webhook handler error" }, { status: 500 });
    }
}
