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

// ---------------- runtime ----------------
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------- env ----------------
const LIVE_SECRET =
    process.env.STRIPE_SECRET_KEY_LIVE ||
    process.env.STRIPE_SECRET_KEY ||
    "";
const TEST_SECRET =
    process.env.STRIPE_SECRET_KEY_TEST ||
    process.env.STRIPE_SECRET_KEY ||
    "";

const LIVE_WEBHOOK_SECRET =
    process.env.STRIPE_WEBHOOK_SECRET_LIVE ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    "";
const TEST_WEBHOOK_SECRET =
    process.env.STRIPE_WEBHOOK_SECRET_TEST ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    "";

if (!LIVE_WEBHOOK_SECRET && !TEST_WEBHOOK_SECRET) {
    console.error("Stripe webhook: missing webhook secret(s)");
}

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

// ---------------- helpers ----------------
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

    // Newer invoice payloads often keep it here:
    const parentSub =
        typeof line0?.parent?.subscription_item_details?.subscription === "string"
            ? line0.parent.subscription_item_details.subscription
            : typeof anyInv?.parent?.subscription_details?.subscription === "string"
                ? anyInv.parent.subscription_details.subscription
                : null;

    return direct || fromLine || parentSub || null;
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
 * Prefer metadata on invoice.parent.subscription_details.metadata (your payload has it),
 * then first line metadata.
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
 * Ensure lock exists and ALWAYS attribute commissions using the lock.
 * Guard lock existence by affiliateRefLockedAt (not by affiliateRefLocked).
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

            // Anchor cap off first paid (do not overwrite if already set)
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

    // Ensure lock exists; always use lock for attribution
    const locked = await ensureAffiliateLockOnFirstPaid({ uid, invoice, paidAtDate });
    if (!locked?.affiliateRefLocked) return;

    const affiliateRefUsed = locked.affiliateRefLocked;
    const affiliateSourceUsed = locked.affiliateSourceLocked || "unknown";

    // 12-month cap anchored to affiliateFirstPaidAt on user doc
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

    // Idempotency: invoice.id is entry id
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
}

async function reverseLedgerEntriesByField(params: {
    field: "invoiceId" | "chargeId" | "paymentIntentId";
    value: string;
    reason: "refund" | "dispute" | "void" | "failed";
}): Promise<void> {
    const { field, value, reason } = params;

    const snap = await db
        .collectionGroup("entries")
        .where(field, "==", value)
        .limit(50)
        .get();

    if (snap.empty) return;

    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const d of snap.docs) {
        const cur = d.data() as any;
        if (cur?.status === "reversed") continue;

        batch.set(
            d.ref,
            {
                status: "reversed",
                reversedAt: now,
                reversalReason: reason,
                updatedAt: now,
            },
            { merge: true },
        );
    }

    await batch.commit();
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const anyC = charge as any;

    const chargeId = typeof anyC.id === "string" ? anyC.id : "";
    const paymentIntentId =
        typeof anyC.payment_intent === "string"
            ? anyC.payment_intent
            : typeof anyC.payment_intent?.id === "string"
                ? anyC.payment_intent.id
                : "";

    // Reverse by chargeId (best), also by paymentIntentId (fallback)
    if (chargeId) {
        await reverseLedgerEntriesByField({
            field: "chargeId",
            value: chargeId,
            reason: "refund",
        });
    }

    if (paymentIntentId) {
        await reverseLedgerEntriesByField({
            field: "paymentIntentId",
            value: paymentIntentId,
            reason: "refund",
        });
    }
}

async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
    const anyD = dispute as any;
    const chargeId = typeof anyD.charge === "string" ? anyD.charge : anyD.charge?.id;
    if (!chargeId) return;

    await reverseLedgerEntriesByField({
        field: "chargeId",
        value: chargeId,
        reason: "dispute",
    });
}

async function handleInvoiceVoided(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice?.id) return;
    await reverseLedgerEntriesByField({
        field: "invoiceId",
        value: invoice.id,
        reason: "void",
    });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice?.id) return;
    await reverseLedgerEntriesByField({
        field: "invoiceId",
        value: invoice.id,
        reason: "failed",
    });
}

/**
 * Accept both live + test webhook secrets on the same endpoint.
 * Stripe objects are mode-isolated, so we must also use the matching API key
 * when we re-fetch (expand) an invoice.
 */
function constructEventWithAnySecret(params: {
    body: string;
    sig: string;
}): Stripe.Event {
    const { body, sig } = params;

    const errors: any[] = [];

    if (LIVE_WEBHOOK_SECRET && stripeLive) {
        try {
            return stripeLive.webhooks.constructEvent(body, sig, LIVE_WEBHOOK_SECRET);
        } catch (e) {
            errors.push(e);
        }
    }

    if (TEST_WEBHOOK_SECRET && stripeTest) {
        try {
            return stripeTest.webhooks.constructEvent(body, sig, TEST_WEBHOOK_SECRET);
        } catch (e) {
            errors.push(e);
        }
    }

    const last = errors[errors.length - 1];
    throw last || new Error("Stripe webhook signature verification failed");
}

export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
        return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
    }

    const body = await req.text();

    let event: Stripe.Event;
    try {
        event = constructEventWithAnySecret({ body, sig });
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
                    typeof session.customer === "string"
                        ? session.customer
                        : session.customer?.id;

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

                // Critical: re-fetch expanded invoice using the matching mode key,
                // otherwise you get "No such invoice ... live key used for test object".
                if (!stripe) break;

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

        // Keep Stripe retries but surface enough info in logs
        return NextResponse.json(
            { error: "Webhook handler error" },
            { status: 500 },
        );
    }
}
