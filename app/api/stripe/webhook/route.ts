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
                : typeof line0?.parent?.subscription_item_details?.subscription === "string"
                    ? line0.parent.subscription_item_details.subscription
                    : null;

    return fromLine || null;
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
 * Prefer metadata from the invoice payload itself,
 * then subscription metadata, then customer metadata.
 */
async function resolveAffiliateRefForInvoice(
    invoice: Stripe.Invoice
): Promise<{ affiliateRef: string; affiliateSource: string }> {
    const anyInv = invoice as any;

    // 0) invoice.parent.subscription_details.metadata
    const parentMeta = anyInv?.parent?.subscription_details?.metadata;
    const pRef = cleanStr(parentMeta?.affiliateRef);
    const pSrc = cleanStr(parentMeta?.affiliateSource);
    if (pRef) return { affiliateRef: pRef, affiliateSource: pSrc };

    // 0.5) first line item metadata
    const lineMeta = anyInv?.lines?.data?.[0]?.metadata;
    const lRef = cleanStr(lineMeta?.affiliateRef);
    const lSrc = cleanStr(lineMeta?.affiliateSource);
    if (lRef) return { affiliateRef: lRef, affiliateSource: lSrc };

    // 1) subscription metadata
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

    // 2) customer metadata
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
 * Lock affiliate on first paid.
 * Guard ONLY by affiliateRefLockedAt (prevents "half written" state).
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
    const affiliateRef = resolved.affiliateRef;
    const affiliateSource = resolved.affiliateSource;

    if (!affiliateRef) return null;

    await userRef.set(
        {
            affiliateRefLockedAt: admin.firestore.FieldValue.serverTimestamp(),
            affiliateRefLocked: affiliateRef,
            affiliateSourceLocked: affiliateSource || "unknown",
            affiliateLastSeenAt: admin.firestore.FieldValue.serverTimestamp(),

            affiliateFirstPaidAt:
                data?.affiliateFirstPaidAt instanceof admin.firestore.Timestamp
                    ? data.affiliateFirstPaidAt
                    : admin.firestore.Timestamp.fromDate(paidAtDate),
        },
        { merge: true }
    );

    return {
        affiliateRefLocked: affiliateRef,
        affiliateSourceLocked: affiliateSource || "unknown",
    };
}

/**
 * Map invoiceId -> exact entry path so reversals do NOT need collectionGroup queries.
 * affiliate_invoice_map/{invoiceId} { affiliateRef, entryPath, paymentIntentId, chargeId }
 */
async function upsertInvoiceMap(params: {
    invoiceId: string;
    affiliateRef: string;
    entryPath: string;
    chargeId: string | null;
    paymentIntentId: string | null;
}): Promise<void> {
    const { invoiceId, affiliateRef, entryPath, chargeId, paymentIntentId } = params;
    const ref = db.collection("affiliate_invoice_map").doc(invoiceId);
    await ref.set(
        {
            invoiceId,
            affiliateRef,
            entryPath,
            chargeId: chargeId || null,
            paymentIntentId: paymentIntentId || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    );
}

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

    // 12-month cap anchored to affiliateFirstPaidAt on the user doc
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

    // write invoice map for deterministic reversal
    await upsertInvoiceMap({
        invoiceId: invoice.id,
        affiliateRef: affiliateRefUsed,
        entryPath: entryRef.path,
        chargeId,
        paymentIntentId,
    });
}

async function reverseEntryByInvoiceId(params: {
    invoiceId: string;
    reason: "refund" | "dispute" | "voided";
}): Promise<void> {
    const { invoiceId, reason } = params;

    const mapRef = db.collection("affiliate_invoice_map").doc(invoiceId);
    const mapSnap = await mapRef.get();
    if (!mapSnap.exists) return;

    const map = mapSnap.data() as any;
    const entryPath = cleanStr(map?.entryPath || "", 512);
    if (!entryPath) return;

    const entryRef = db.doc(entryPath);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await entryRef.set(
        {
            status: "reversed",
            reversedAt: now,
            reversalReason: reason,
            updatedAt: now,
        },
        { merge: true }
    );
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const anyC = charge as any;
    const invoiceId = typeof anyC.invoice === "string" ? anyC.invoice : anyC.invoice?.id;
    if (invoiceId) {
        await reverseEntryByInvoiceId({ invoiceId, reason: "refund" });
        return;
    }

    // fallback: try payment_intent -> find invoice map by paymentIntentId (single-field query, NOT collectionGroup)
    const pi = typeof anyC.payment_intent === "string" ? anyC.payment_intent : anyC.payment_intent?.id;
    if (!pi) return;

    const snap = await db
        .collection("affiliate_invoice_map")
        .where("paymentIntentId", "==", pi)
        .limit(1)
        .get();

    if (snap.empty) return;
    await reverseEntryByInvoiceId({ invoiceId: snap.docs[0]!.id, reason: "refund" });
}

async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
    const anyD = dispute as any;
    const chargeId = typeof anyD.charge === "string" ? anyD.charge : anyD.charge?.id;
    if (!chargeId) return;

    // find invoice map by chargeId (single collection query)
    const snap = await db
        .collection("affiliate_invoice_map")
        .where("chargeId", "==", chargeId)
        .limit(1)
        .get();

    if (snap.empty) return;
    await reverseEntryByInvoiceId({ invoiceId: snap.docs[0]!.id, reason: "dispute" });
}

async function handleInvoiceVoided(invoice: Stripe.Invoice): Promise<void> {
    const invoiceId = typeof (invoice as any).id === "string" ? (invoice as any).id : "";
    if (!invoiceId) return;
    await reverseEntryByInvoiceId({ invoiceId, reason: "voided" });
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
                // IMPORTANT: re-fetch with expansions so ids are present
                const invoice = event.data.object as Stripe.Invoice;

                const invFull = await stripe.invoices.retrieve(invoice.id, {
                    expand: ["charge", "payment_intent", "subscription"],
                });

                await writeAffiliateLedgerForInvoicePaid(invFull as any);
                break;
            }

            case "invoice.voided": {
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoiceVoided(invoice);
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
    } catch (err) {
        console.error("Stripe webhook handler error", err);
        return NextResponse.json({ error: "Webhook handler error" }, { status: 500 });
    }
}
