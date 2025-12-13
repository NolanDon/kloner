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
/* Helpers                                                            */
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
/* Ledger write (invoice.paid)                                         */
/* Primary key for lookup: customerId                                  */
/* Storage key: invoice.id (still unique per payment)                  */
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
        if (snap.exists) {
            tx.set(entryRef, { updatedAt: now }, { merge: true });
            return;
        }

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
    });
}

/* ------------------------------------------------------------------ */
/* Reversal lookup by customerId                                       */
/* - charge.refunded has customer + amount_refunded                    */
/* - choose most recent matching entry across all affiliates           */
/* ------------------------------------------------------------------ */
async function findLatestLedgerEntryByCustomer(params: {
    customerId: string;
    amountCents?: number | null;
}): Promise<admin.firestore.QueryDocumentSnapshot | null> {
    const customerId = cleanStr(params.customerId);
    if (!customerId) return null;

    let q: admin.firestore.Query = db
        .collectionGroup("entries")
        .where("customerId", "==", customerId);

    const amt = typeof params.amountCents === "number" ? params.amountCents : null;
    if (amt && Number.isFinite(amt) && amt > 0) {
        q = q.where("netCollectedCents", "==", amt);
    }

    // Requires a composite index in Firestore:
    // collectionGroup: entries
    // fields: customerId ASC, netCollectedCents ASC (optional), paidAt DESC
    const snap = await q.orderBy("paidAt", "desc").limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0]!;
}

async function markLedgerEntryReversed(params: {
    doc: admin.firestore.QueryDocumentSnapshot;
    reason: "refund" | "voided" | "failed" | "dispute";
}): Promise<void> {
    const { doc, reason } = params;
    const cur = doc.data() as any;

    if (cur?.status === "refunded" || cur?.status === "disputed" || cur?.status === "reversed") {
        return;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const nextStatus =
        reason === "refund" ? "refunded" : reason === "dispute" ? "disputed" : "reversed";

    await doc.ref.set(
        {
            status: nextStatus,
            reversedAt: now,
            reversalReason: reason,
            updatedAt: now,
        },
        { merge: true },
    );
}

/* ------------------------------------------------------------------ */
/* Webhook verification + dispatch                                     */
/* ------------------------------------------------------------------ */
export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
        return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
    }

    const body = await req.text();

    let event: Stripe.Event | null = null;

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

            case "invoice.paid":
            case "invoice.payment_succeeded": {
                const inv = event.data.object as Stripe.Invoice;
                await writeAffiliateLedgerForInvoicePaid({ stripe, invoice: inv });
                break;
            }

            case "invoice.voided": {
                const inv = event.data.object as Stripe.Invoice;
                const customerId =
                    typeof inv.customer === "string" ? inv.customer : inv.customer?.id;

                if (customerId) {
                    const doc = await findLatestLedgerEntryByCustomer({ customerId });
                    if (doc) await markLedgerEntryReversed({ doc, reason: "voided" });
                }
                break;
            }

            case "invoice.payment_failed": {
                const inv = event.data.object as Stripe.Invoice;
                const customerId =
                    typeof inv.customer === "string" ? inv.customer : inv.customer?.id;

                if (customerId) {
                    const doc = await findLatestLedgerEntryByCustomer({ customerId });
                    if (doc) await markLedgerEntryReversed({ doc, reason: "failed" });
                }
                break;
            }

            case "charge.refunded": {
                const ch = event.data.object as Stripe.Charge;
                const customerId =
                    typeof ch.customer === "string" ? ch.customer : (ch.customer as any)?.id;

                const amountRefunded = Number((ch as any).amount_refunded ?? 0);

                if (customerId) {
                    const doc = await findLatestLedgerEntryByCustomer({
                        customerId: cleanStr(customerId),
                        amountCents: Number.isFinite(amountRefunded) && amountRefunded > 0 ? amountRefunded : null,
                    });
                    if (doc) await markLedgerEntryReversed({ doc, reason: "refund" });
                }
                break;
            }

            case "refund.created": {
                const rf = event.data.object as Stripe.Refund;
                const amount = Number((rf as any).amount ?? 0);

                const chId =
                    typeof rf.charge === "string" ? rf.charge : (rf.charge as any)?.id;

                // Best-effort: if refund includes charge id, it still won’t include customerId reliably.
                // Skip API calls. charge.refunded will handle the actual reversal with customerId.
                void chId;
                void amount;
                break;
            }

            case "charge.dispute.created": {
                const dispute = event.data.object as Stripe.Dispute;
                const chId =
                    typeof (dispute as any).charge === "string"
                        ? (dispute as any).charge
                        : typeof (dispute as any).charge?.id === "string"
                            ? (dispute as any).charge.id
                            : "";

                // No API calls. You’ll still get charge.dispute.created without customerId in payload sometimes.
                // charge.refunded + invoice.* events cover cash movement; disputes mark later if you expand your pipeline.
                void chId;
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
