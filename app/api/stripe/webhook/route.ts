// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import {
    getUidForStripeCustomer,
    linkCustomerToUid,
    mapPriceToTier,
    setUserTierFromStripe,
} from "../../_lib/billing";
import admin from "firebase-admin";
import type Stripe from "stripe";

const stripe = getStripe();
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// minimal admin init
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

const AFF_RATE = 0.3;
const AFF_CAP_MONTHS = 12;
const AFF_PENDING_DAYS = 14;

// Reverse lookup collections (direct doc reads, no collectionGroup queries)
const REV_INVOICE = "affiliate_reverse_invoice";
const REV_CHARGE = "affiliate_reverse_charge";
const REV_PI = "affiliate_reverse_payment_intent";

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

    const fromParent =
        typeof anyInv?.parent?.subscription_details?.subscription === "string"
            ? anyInv.parent.subscription_details.subscription
            : null;

    return direct || fromLine || fromParent || null;
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
 * Prefer metadata from invoice payload first, then subscription metadata, then customer metadata.
 */
async function resolveAffiliateRefForInvoice(
    invoice: Stripe.Invoice
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

    try {
        const subId = getInvoiceSubscriptionId(invoice);
        if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            const affiliateRef = cleanStr((sub.metadata as any)?.affiliateRef);
            const affiliateSource = cleanStr((sub.metadata as any)?.affiliateSource);
            if (affiliateRef) return { affiliateRef, affiliateSource };
        }
    } catch {
        // ignore
    }

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
    } catch {
        // ignore
    }

    return { affiliateRef: "", affiliateSource: "" };
}

/**
 * Lock affiliate at first successful paid invoice.
 * Guard ONLY by affiliateRefLockedAt (not by affiliateRefLocked).
 */
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
            { merge: true }
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
        { merge: true }
    );

    return {
        affiliateRefLocked: resolved.affiliateRef,
        affiliateSourceLocked: resolved.affiliateSource || "unknown",
    };
}

async function writeReverseLookupDocs(params: {
    affiliateRef: string;
    entryId: string; // invoice.id
    invoiceId: string;
    chargeId: string | null;
    paymentIntentId: string | null;
}) {
    const { affiliateRef, entryId, invoiceId, chargeId, paymentIntentId } = params;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const batch = db.batch();

    // Always write invoice -> (affiliateRef, entryId)
    batch.set(
        db.collection(REV_INVOICE).doc(invoiceId),
        { affiliateRef, entryId, updatedAt: now },
        { merge: true }
    );

    // Optional charge -> (affiliateRef, entryId)
    if (chargeId) {
        batch.set(
            db.collection(REV_CHARGE).doc(chargeId),
            { affiliateRef, entryId, invoiceId, updatedAt: now },
            { merge: true }
        );
    }

    // Optional payment_intent -> (affiliateRef, entryId)
    if (paymentIntentId) {
        batch.set(
            db.collection(REV_PI).doc(paymentIntentId),
            { affiliateRef, entryId, invoiceId, updatedAt: now },
            { merge: true }
        );
    }

    await batch.commit();
}

/**
 * Main ledger write.
 * IMPORTANT: expects invoice to be "full" when possible (expanded via retrieve),
 * but still works with a partial payload.
 */
async function writeAffiliateLedgerForInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;

    const uid = await resolveUidForCustomerId(customerId);
    if (!uid) return;

    const netCollectedCents = Number((invoice as any).amount_paid ?? 0);
    if (!Number.isFinite(netCollectedCents) || netCollectedCents <= 0) return;

    const paidAtSec = getInvoicePaidAtSec(invoice);
    const paidAtDate = new Date(paidAtSec * 1000);

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

    const entryId = invoice.id;

    const entryRef = db
        .collection("affiliate_ledger")
        .doc(affiliateRefUsed)
        .collection("entries")
        .doc(entryId);

    const existing = await entryRef.get();
    if (existing.exists) return;

    const commissionCents = Math.round(netCollectedCents * AFF_RATE);
    const periodKey = monthKeyFromUnix(paidAtSec);

    const eligibleAt = admin.firestore.Timestamp.fromDate(
        new Date(paidAtDate.getTime() + AFF_PENDING_DAYS * 24 * 60 * 60 * 1000)
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
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: false }
    );

    // Write lookup docs so refunds/disputes can reverse without collectionGroup queries
    await writeReverseLookupDocs({
        affiliateRef: affiliateRefUsed,
        entryId,
        invoiceId: invoice.id,
        chargeId: chargeId || null,
        paymentIntentId: paymentIntentId || null,
    });
}

async function reverseByAffiliateEntry(params: {
    affiliateRef: string;
    entryId: string;
    reason: "refund" | "dispute" | "voided";
}) {
    const { affiliateRef, entryId, reason } = params;

    const ref = db.collection("affiliate_ledger").doc(affiliateRef).collection("entries").doc(entryId);
    const snap = await ref.get();
    if (!snap.exists) return;

    const cur = snap.data() as any;
    if (cur?.status === "reversed") return;

    const now = admin.firestore.FieldValue.serverTimestamp();

    await ref.set(
        {
            status: "reversed",
            reversedAt: now,
            reversalReason: reason,
            updatedAt: now,
        },
        { merge: true }
    );
}

async function reverseFromLookup(params: {
    invoiceId?: string | null;
    chargeId?: string | null;
    paymentIntentId?: string | null;
    reason: "refund" | "dispute" | "voided";
}) {
    const { invoiceId, chargeId, paymentIntentId, reason } = params;

    // Prefer charge lookup first (refunds/disputes), then PI, then invoice
    if (chargeId) {
        const snap = await db.collection(REV_CHARGE).doc(chargeId).get();
        if (snap.exists) {
            const d = snap.data() as any;
            const affiliateRef = cleanStr(d?.affiliateRef);
            const entryId = cleanStr(d?.entryId);
            if (affiliateRef && entryId) {
                await reverseByAffiliateEntry({ affiliateRef, entryId, reason });
                return;
            }
        }
    }

    if (paymentIntentId) {
        const snap = await db.collection(REV_PI).doc(paymentIntentId).get();
        if (snap.exists) {
            const d = snap.data() as any;
            const affiliateRef = cleanStr(d?.affiliateRef);
            const entryId = cleanStr(d?.entryId);
            if (affiliateRef && entryId) {
                await reverseByAffiliateEntry({ affiliateRef, entryId, reason });
                return;
            }
        }
    }

    if (invoiceId) {
        const snap = await db.collection(REV_INVOICE).doc(invoiceId).get();
        if (snap.exists) {
            const d = snap.data() as any;
            const affiliateRef = cleanStr(d?.affiliateRef);
            const entryId = cleanStr(d?.entryId);
            if (affiliateRef && entryId) {
                await reverseByAffiliateEntry({ affiliateRef, entryId, reason });
                return;
            }
        }
    }
}

async function safeRetrieveExpandedInvoice(invoiceId: string): Promise<Stripe.Invoice | null> {
    try {
        // expand ensures charge/payment_intent/subscription populate consistently
        const inv = await stripe.invoices.retrieve(invoiceId, {
            expand: ["charge", "payment_intent", "subscription", "lines.data.price"],
        });
        return inv as Stripe.Invoice;
    } catch (e) {
        // Key mismatch (test vs live) or missing invoice should not 500 your webhook.
        return null;
    }
}

export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");

    if (!webhookSecret || !sig) {
        console.error("Stripe webhook: missing secret or signature");
        return NextResponse.json({ error: "Webhook misconfigured" }, { status: 400 });
    }

    const body = await req.text();
    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err: any) {
        console.error("Stripe webhook signature verification failed", err?.message || err);
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;

                const firebaseUid = session.metadata?.firebaseUid as string | undefined;
                const customerId =
                    typeof session.customer === "string" ? session.customer : session.customer?.id;

                if (!firebaseUid || !customerId) break;

                await linkCustomerToUid(customerId, firebaseUid);
                break;
            }

            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
            case "customer.subscription.trial_will_end": {
                const sub = event.data.object as Stripe.Subscription;
                const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
                if (!customerId) break;

                const uid = await resolveUidForCustomerId(customerId);
                if (!uid) break;

                const firstItem = sub.items?.data?.[0];
                const priceId = typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;

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

                // Try to fetch a full invoice (so chargeId/paymentIntentId/subscriptionId are not null)
                const expanded = await safeRetrieveExpandedInvoice(invoice.id);
                await writeAffiliateLedgerForInvoicePaid(expanded || invoice);

                break;
            }

            // Invoice-level reversal fallback (works even when chargeId is missing)
            case "invoice.voided": {
                const invoice = event.data.object as Stripe.Invoice;
                await reverseFromLookup({
                    invoiceId: invoice.id,
                    reason: "voided",
                });
                break;
            }

            case "charge.refunded": {
                const charge = event.data.object as Stripe.Charge;
                const anyC = charge as any;
                const chargeId = typeof anyC.id === "string" ? anyC.id : null;
                const paymentIntentId =
                    typeof anyC.payment_intent === "string"
                        ? anyC.payment_intent
                        : typeof anyC.payment_intent?.id === "string"
                            ? anyC.payment_intent.id
                            : null;

                await reverseFromLookup({
                    chargeId,
                    paymentIntentId,
                    reason: "refund",
                });

                break;
            }

            case "charge.dispute.created": {
                const dispute = event.data.object as Stripe.Dispute;
                const anyD = dispute as any;
                const chargeId = typeof anyD.charge === "string" ? anyD.charge : anyD.charge?.id || null;

                await reverseFromLookup({
                    chargeId,
                    reason: "dispute",
                });

                break;
            }

            default:
                break;
        }

        return NextResponse.json({ received: true });
    } catch (err) {
        console.error("Stripe webhook handler error", err);
        return NextResponse.json({ error: "Webhook handler error" }, { status: 500 });
    }
}
