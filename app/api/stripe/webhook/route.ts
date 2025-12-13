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

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-10-29.clover";

/* ------------------------------------------------------------------ */
/* Env                                                                */
/* ------------------------------------------------------------------ */
const STRIPE_TEST_KEY = process.env.STRIPE_SECRET_KEY_TEST || "";
const STRIPE_PROD_KEY = process.env.STRIPE_SECRET_KEY_PROD || "";

const WH_TEST = process.env.TEST_STRIPE_WEBHOOK_SECRET || "";
const WH_PROD = process.env.STRIPE_WEBHOOK_SECRET || "";

const stripeTest = STRIPE_TEST_KEY
    ? new Stripe(STRIPE_TEST_KEY, { apiVersion: STRIPE_API_VERSION })
    : null;

const stripeProd = STRIPE_PROD_KEY
    ? new Stripe(STRIPE_PROD_KEY, { apiVersion: STRIPE_API_VERSION })
    : null;

/* ------------------------------------------------------------------ */
/* Firebase Admin init                                                 */
/* ------------------------------------------------------------------ */
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

    admin.initializeApp({ credential: admin.credential.cert(credJson) });
}

const db = admin.firestore();

/* ------------------------------------------------------------------ */
/* Affiliate constants                                                 */
/* ------------------------------------------------------------------ */
const AFF_RATE = 0.3;
const AFF_CAP_MONTHS = 12;
const AFF_PENDING_DAYS = 14;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
function cleanStr(v: unknown, max = 256): string {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
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

/* ------------------------------------------------------------------ */
/* UID resolution                                                      */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* Affiliate ref resolution + LOCK                                     */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* Ledger write for invoice.paid                                       */
/* Primary key remains invoice.id for the entry doc.                   */
/* Reversal uses customerId-only lookup (below).                       */
/* ------------------------------------------------------------------ */
async function writeAffiliateLedgerForInvoicePaid(params: {
    stripe: Stripe;
    invoice: Stripe.Invoice;
}): Promise<void> {
    const { stripe, invoice } = params;

    const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;

    const uid = await resolveUidForCustomerId(cleanStr(customerId));
    if (!uid) return;

    const netCollectedCents = Number((invoice as any).amount_paid ?? 0);
    if (!Number.isFinite(netCollectedCents) || netCollectedCents <= 0) return;

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

    const subscriptionId = getInvoiceSubscriptionId(invoice);
    const commissionCents = Math.round(netCollectedCents * AFF_RATE);

    const eligibleAt = admin.firestore.Timestamp.fromDate(
        new Date(paidAtDate.getTime() + AFF_PENDING_DAYS * 24 * 60 * 60 * 1000),
    );

    const now = admin.firestore.FieldValue.serverTimestamp();

    const entryRef = db
        .collection("affiliate_ledger")
        .doc(affiliateRefUsed)
        .collection("entries")
        .doc(invoice.id);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(entryRef);

        if (!snap.exists) {
            tx.set(
                entryRef,
                {
                    affiliateRef: affiliateRefUsed,
                    affiliateSource: affiliateSourceUsed,

                    uid,
                    customerId: cleanStr(customerId),
                    subscriptionId: subscriptionId || null,

                    invoiceId: invoice.id,
                    invoiceNumber: (invoice as any).number || null,

                    netCollectedCents,
                    commissionRate: AFF_RATE,
                    commissionCents,

                    currency: (invoice as any).currency || "usd",

                    paidAt: admin.firestore.Timestamp.fromDate(paidAtDate),
                    eligibleAt,

                    status: "pending",
                    createdAt: now,
                    updatedAt: now,
                },
                { merge: false },
            );
        } else {
            // Keep existing doc; just refresh updatedAt (and anything else you want later).
            tx.set(entryRef, { updatedAt: now }, { merge: true });
        }
    });
}

/* ------------------------------------------------------------------ */
/* Reversal by customerId (no maps)                                    */
/* ------------------------------------------------------------------ */
function statusForReason(reason: "refund" | "dispute" | "voided" | "failed") {
    if (reason === "refund") return "refunded";
    if (reason === "dispute") return "disputed";
    return "reversed";
}

async function findLatestLedgerEntryByCustomer(params: {
    customerId: string;
    amountCents?: number | null;
}): Promise<admin.firestore.QueryDocumentSnapshot | null> {
    const customerId = cleanStr(params.customerId);
    if (!customerId) return null;

    // Avoid composite-index requirements: do not orderBy with where filters.
    // Pull a small window and choose best match in code.
    const snap = await db
        .collectionGroup("entries")
        .where("customerId", "==", customerId)
        .limit(50)
        .get();

    if (snap.empty) return null;

    const amt = typeof params.amountCents === "number" ? params.amountCents : null;
    const wantAmt = !!(amt && Number.isFinite(amt) && amt > 0);

    let best: admin.firestore.QueryDocumentSnapshot | null = null;
    let bestPaidAtMs = -1;

    const isReversed = (d: any) =>
        d?.status === "refunded" || d?.status === "disputed" || d?.status === "reversed";

    const paidAtMs = (d: any) => {
        const p = d?.paidAt;
        if (p instanceof admin.firestore.Timestamp) return p.toMillis();
        if (typeof p === "number") return p;
        return 0;
    };

    // Pass 1: match amount (if provided)
    if (wantAmt) {
        for (const doc of snap.docs) {
            const d = doc.data() as any;
            if (isReversed(d)) continue;
            if (Number(d?.netCollectedCents ?? 0) !== amt) continue;

            const ms = paidAtMs(d);
            if (ms > bestPaidAtMs) {
                bestPaidAtMs = ms;
                best = doc;
            }
        }
        if (best) return best;
    }

    // Pass 2: latest non-reversed
    for (const doc of snap.docs) {
        const d = doc.data() as any;
        if (isReversed(d)) continue;

        const ms = paidAtMs(d);
        if (ms > bestPaidAtMs) {
            bestPaidAtMs = ms;
            best = doc;
        }
    }

    return best;
}

async function markLedgerEntryReversed(params: {
    doc: admin.firestore.QueryDocumentSnapshot;
    reason: "refund" | "voided" | "failed" | "dispute";
    meta?: Record<string, any>;
}): Promise<void> {
    const d = params.doc.data() as any;
    if (!d) return;

    const curStatus = cleanStr(d?.status || "");
    const nextStatus = statusForReason(params.reason);

    // If already in any reversed state, do nothing.
    if (curStatus === "refunded" || curStatus === "disputed" || curStatus === "reversed") return;

    const now = admin.firestore.FieldValue.serverTimestamp();

    await params.doc.ref.set(
        {
            status: nextStatus,
            reversedAt: now,
            reversalReason: params.reason,
            reversalMeta: params.meta || null,
            updatedAt: now,
        },
        { merge: true },
    );
}

async function reverseLatestByCustomerId(params: {
    customerId: string;
    amountCents?: number | null;
    reason: "refund" | "voided" | "failed" | "dispute";
    meta?: Record<string, any>;
}): Promise<void> {
    const customerId = cleanStr(params.customerId);
    if (!customerId) return;

    const doc = await findLatestLedgerEntryByCustomer({
        customerId,
        amountCents:
            typeof params.amountCents === "number" && Number.isFinite(params.amountCents) && params.amountCents > 0
                ? params.amountCents
                : null,
    });

    if (!doc) return;

    await markLedgerEntryReversed({
        doc,
        reason: params.reason,
        meta: params.meta,
    });
}

/* ------------------------------------------------------------------ */
/* Refund event parsing (handles your payloads)                         */
/* ------------------------------------------------------------------ */
function isChargeObject(obj: any): boolean {
    return !!obj && obj.object === "charge" && typeof obj.id === "string" && obj.id.startsWith("ch_");
}

function isRefundObject(obj: any): boolean {
    return !!obj && obj.object === "refund" && typeof obj.id === "string" && obj.id.startsWith("re_");
}

function extractCustomerIdFromChargeObject(obj: any): string {
    const c =
        typeof obj?.customer === "string"
            ? obj.customer
            : typeof obj?.customer?.id === "string"
                ? obj.customer.id
                : "";
    return cleanStr(c);
}

async function reverseFromChargeId(params: {
    stripe: Stripe;
    chargeId: string;
    amountCents?: number | null;
    reason: "refund" | "dispute";
    meta?: Record<string, any>;
}): Promise<void> {
    const chId = cleanStr(params.chargeId);
    if (!chId) return;

    const ch = await params.stripe.charges.retrieve(chId);
    const customerId =
        typeof (ch as any).customer === "string"
            ? (ch as any).customer
            : typeof (ch as any).customer?.id === "string"
                ? (ch as any).customer.id
                : "";

    if (!customerId) return;

    await reverseLatestByCustomerId({
        customerId: cleanStr(customerId),
        amountCents: params.amountCents ?? null,
        reason: params.reason,
        meta: { chargeId: chId, ...(params.meta || {}) },
    });
}

async function reverseFromRefundLikeEvent(params: {
    stripe: Stripe;
    eventType: string;
    obj: any;
}): Promise<void> {
    const { stripe, eventType, obj } = params;

    // Case A: some of your “refund.created” payloads are actually a CHARGE object.
    if (isChargeObject(obj)) {
        const customerId = extractCustomerIdFromChargeObject(obj);
        const amountRefunded = Number(obj?.amount_refunded ?? obj?.amount ?? 0);
        if (!customerId) return;

        await reverseLatestByCustomerId({
            customerId,
            amountCents: Number.isFinite(amountRefunded) && amountRefunded > 0 ? amountRefunded : null,
            reason: "refund",
            meta: {
                eventType,
                chargeId: cleanStr(obj?.id || ""),
                paymentIntentId: cleanStr(obj?.payment_intent || ""),
            },
        });
        return;
    }

    // Case B: refund object (matches your charge.refund.updated + refund.updated payloads)
    if (isRefundObject(obj)) {
        const chargeId = cleanStr(obj?.charge || "");
        const amount = Number(obj?.amount ?? 0);
        if (!chargeId) return;

        await reverseFromChargeId({
            stripe,
            chargeId,
            amountCents: Number.isFinite(amount) && amount > 0 ? amount : null,
            reason: "refund",
            meta: {
                eventType,
                refundId: cleanStr(obj?.id || ""),
                paymentIntentId: cleanStr(obj?.payment_intent || ""),
                refundStatus: cleanStr(obj?.status || ""),
            },
        });
        return;
    }

    // Unknown shape: ignore
}

/* ------------------------------------------------------------------ */
/* Webhook verification + dispatch                                      */
/* ------------------------------------------------------------------ */
export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
        return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
    }

    const body = await req.text();

    let event: Stripe.Event | null = null;

    // Verify against test first
    if (WH_TEST) {
        try {
            event = Stripe.webhooks.constructEvent(body, sig, WH_TEST);
        } catch { }
    }

    if (!event && WH_PROD) {
        try {
            event = Stripe.webhooks.constructEvent(body, sig, WH_PROD);
        } catch { }
    }

    if (!event) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // Choose Stripe client by event.livemode (prevents test/live mismatch).
    const stripe = event.livemode ? stripeProd : stripeTest;

    if (!stripe) {
        return NextResponse.json(
            { error: event.livemode ? "Missing STRIPE_SECRET_KEY_PROD" : "Missing STRIPE_SECRET_KEY_TEST" },
            { status: 500 },
        );
    }

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;
                const firebaseUid = cleanStr(session.metadata?.firebaseUid);
                const customerId =
                    typeof session.customer === "string" ? session.customer : session.customer?.id;

                if (firebaseUid && customerId) {
                    await linkCustomerToUid(cleanStr(customerId), firebaseUid);
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

                const uid = await resolveUidForCustomerId(cleanStr(customerId));
                if (!uid) break;

                const firstItem = sub.items?.data?.[0];
                const priceId =
                    typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;

                const tier = mapPriceToTier(priceId);
                const status = sub.status;
                const effectiveTier = status === "active" || status === "trialing" ? tier : "free";

                await setUserTierFromStripe(uid, effectiveTier, {
                    customerId: cleanStr(customerId),
                    subscriptionId: sub.id,
                    priceId,
                    status,
                    currentPeriodEnd: (sub as any).current_period_end ?? undefined,
                    cancelAtPeriodEnd: (sub as any).cancel_at_period_end ?? undefined,
                });

                break;
            }

            // Ledger creation happens here (has customerId/amount/subscription + metadata for affiliateRef)
            case "invoice.paid":
            case "invoice.payment_succeeded": {
                const inv = event.data.object as Stripe.Invoice;
                await writeAffiliateLedgerForInvoicePaid({ stripe, invoice: inv });
                break;
            }

            // Mark reversed by customerId only (no invoice/PI/charge maps)
            case "invoice.voided": {
                const inv = event.data.object as Stripe.Invoice;
                const customerId =
                    typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
                if (customerId) {
                    await reverseLatestByCustomerId({
                        customerId: cleanStr(customerId),
                        reason: "voided",
                        meta: { eventType: event.type, invoiceId: cleanStr(inv.id) },
                    });
                }
                break;
            }

            case "invoice.payment_failed": {
                const inv = event.data.object as Stripe.Invoice;
                const customerId =
                    typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
                if (customerId) {
                    await reverseLatestByCustomerId({
                        customerId: cleanStr(customerId),
                        reason: "failed",
                        meta: { eventType: event.type, invoiceId: cleanStr(inv.id) },
                    });
                }
                break;
            }

            // These are the ones you showed firing.
            case "charge.refund.updated":
            case "refund.updated":
            case "refund.created": {
                await reverseFromRefundLikeEvent({
                    stripe,
                    eventType: event.type,
                    obj: event.data.object as any,
                });
                break;
            }

            // When Stripe emits a charge object with refunded=true
            case "charge.refunded": {
                const ch = event.data.object as any; // Stripe.Charge
                const customerId = extractCustomerIdFromChargeObject(ch);
                const amountRefunded = Number(ch?.amount_refunded ?? 0);

                if (customerId) {
                    await reverseLatestByCustomerId({
                        customerId,
                        amountCents: Number.isFinite(amountRefunded) && amountRefunded > 0 ? amountRefunded : null,
                        reason: "refund",
                        meta: {
                            eventType: event.type,
                            chargeId: cleanStr(ch?.id || ""),
                            paymentIntentId: cleanStr(ch?.payment_intent || ""),
                            refunded: !!ch?.refunded,
                        },
                    });
                }
                break;
            }

            case "charge.dispute.created": {
                const dispute = event.data.object as any; // Stripe.Dispute
                const chId =
                    typeof dispute?.charge === "string"
                        ? dispute.charge
                        : typeof dispute?.charge?.id === "string"
                            ? dispute.charge.id
                            : "";
                if (chId) {
                    await reverseFromChargeId({
                        stripe,
                        chargeId: cleanStr(chId),
                        amountCents: null,
                        reason: "dispute",
                        meta: { eventType: event.type, disputeId: cleanStr(dispute?.id || "") },
                    });
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
