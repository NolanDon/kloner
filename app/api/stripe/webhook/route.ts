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

// minimal admin init (same pattern as billing.ts, safe with guard)
if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT missing for webhook");
    }

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

const AFF_RATE = 0.30;
const AFF_CAP_MONTHS = 12;
const AFF_PENDING_DAYS = 14;

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
    // 1) try mapping table
    let uid = await getUidForStripeCustomer(customerId);

    // 2) fall back to kloner_users where stripeCustomerId == customerId
    if (!uid) {
        uid = await findUidByCustomerId(customerId);
        if (uid) {
            await linkCustomerToUid(customerId, uid);
        }
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

/**
 * Stripe TS types differ across versions: Invoice may not declare `.subscription`.
 * Webhook payloads often still include it, so we safely read via `any` with fallbacks.
 */
function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const anyInv = invoice as any;

    const direct =
        typeof anyInv.subscription === "string"
            ? anyInv.subscription
            : typeof anyInv.subscription?.id === "string"
                ? anyInv.subscription.id
                : null;

    if (direct) return direct;

    // fallback: sometimes present on line items
    const line0 = anyInv.lines?.data?.[0];
    const fromLine =
        typeof line0?.subscription === "string"
            ? line0.subscription
            : typeof line0?.subscription?.id === "string"
                ? line0.subscription.id
                : null;

    // newer payloads: parent.subscription_details.subscription
    const fromParent =
        typeof anyInv.parent?.subscription_details?.subscription === "string"
            ? anyInv.parent.subscription_details.subscription
            : null;

    return direct || fromLine || fromParent || null;
}

/** Best-effort: pull firebaseUid from invoice payload (line metadata or parent.subscription_details.metadata) */
function getInvoiceFirebaseUid(invoice: Stripe.Invoice): string {
    const anyInv = invoice as any;

    const fromLine = cleanStr(anyInv?.lines?.data?.[0]?.metadata?.firebaseUid, 256);
    if (fromLine) return fromLine;

    const fromParent = cleanStr(
        anyInv?.parent?.subscription_details?.metadata?.firebaseUid,
        256
    );
    if (fromParent) return fromParent;

    return "";
}

function getInvoiceAffiliateFromPayload(
    invoice: Stripe.Invoice
): { affiliateRef: string; affiliateSource: string } {
    const anyInv = invoice as any;

    const mLine = anyInv?.lines?.data?.[0]?.metadata || {};
    const affiliateRefLine = cleanStr(mLine?.affiliateRef);
    const affiliateSourceLine = cleanStr(mLine?.affiliateSource);
    if (affiliateRefLine) {
        return { affiliateRef: affiliateRefLine, affiliateSource: affiliateSourceLine };
    }

    const mParent = anyInv?.parent?.subscription_details?.metadata || {};
    const affiliateRefParent = cleanStr(mParent?.affiliateRef);
    const affiliateSourceParent = cleanStr(mParent?.affiliateSource);
    if (affiliateRefParent) {
        return { affiliateRef: affiliateRefParent, affiliateSource: affiliateSourceParent };
    }

    return { affiliateRef: "", affiliateSource: "" };
}

async function resolveAffiliateRefForInvoice(
    invoice: Stripe.Invoice
): Promise<{ affiliateRef: string; affiliateSource: string }> {
    // 0) Prefer invoice payload (fast, reliable, no extra Stripe calls)
    const fromPayload = getInvoiceAffiliateFromPayload(invoice);
    if (fromPayload.affiliateRef) return fromPayload;

    // 1) Prefer subscription metadata
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

    // 2) Fallback to customer metadata
    try {
        const custId =
            typeof invoice.customer === "string"
                ? invoice.customer
                : (invoice.customer as any)?.id;

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

async function writeAffiliateLedgerForInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const customerId =
        typeof invoice.customer === "string"
            ? invoice.customer
            : (invoice.customer as any)?.id;

    if (!customerId) return;

    // Prefer UID from invoice payload to avoid missing mapping edge cases
    const uidFromInvoice = getInvoiceFirebaseUid(invoice);
    const uid = uidFromInvoice || (await resolveUidForCustomerId(customerId));
    if (!uid) return;

    // best-effort: ensure mapping + user doc have stripeCustomerId for future events
    if (uidFromInvoice) {
        try {
            await linkCustomerToUid(customerId, uidFromInvoice);
            await db
                .collection("kloner_users")
                .doc(uidFromInvoice)
                .set({ stripeCustomerId: customerId }, { merge: true });
        } catch {
            // ignore
        }
    }

    const { affiliateRef, affiliateSource } = await resolveAffiliateRefForInvoice(invoice);
    if (!affiliateRef) return;

    const entryRef = db
        .collection("affiliate_ledger")
        .doc(affiliateRef)
        .collection("entries")
        .doc(invoice.id);

    // Idempotent
    const existing = await entryRef.get();
    if (existing.exists) return;

    // Net collected revenue only (Stripe: amount_paid)
    const netCollectedCents = Number((invoice as any).amount_paid ?? 0);
    if (!Number.isFinite(netCollectedCents) || netCollectedCents <= 0) return;

    const commissionCents = Math.round(netCollectedCents * AFF_RATE);

    const paidAtSec =
        typeof (invoice as any).status_transitions?.paid_at === "number"
            ? (invoice as any).status_transitions.paid_at
            : typeof (invoice as any).created === "number"
                ? (invoice as any).created
                : Math.floor(Date.now() / 1000);

    const paidAtDate = new Date(paidAtSec * 1000);
    const periodKey = monthKeyFromUnix(paidAtSec);

    // 12-month cap enforcement anchored to affiliateFirstPaidAt on the USER doc
    const userRef = db.collection("kloner_users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? (userSnap.data() as any) : {};

    let firstPaidAt: admin.firestore.Timestamp | null =
        userData?.affiliateFirstPaidAt instanceof admin.firestore.Timestamp
            ? userData.affiliateFirstPaidAt
            : null;

    if (!firstPaidAt) {
        try {
            const ts = admin.firestore.Timestamp.fromDate(paidAtDate);
            await userRef.set({ affiliateFirstPaidAt: ts }, { merge: true });
            firstPaidAt = ts;
        } catch {
            // ignore
        }
    }

    if (firstPaidAt) {
        const capEnd = addMonths(firstPaidAt.toDate(), AFF_CAP_MONTHS);
        if (paidAtDate.getTime() > capEnd.getTime()) return;
    }

    const eligibleAt = admin.firestore.Timestamp.fromDate(
        new Date(paidAtDate.getTime() + AFF_PENDING_DAYS * 24 * 60 * 60 * 1000)
    );

    await entryRef.set(
        {
            affiliateRef,
            affiliateSource: affiliateSource || "unknown",

            uid,
            customerId,
            subscriptionId: getInvoiceSubscriptionId(invoice),

            invoiceId: invoice.id,
            invoiceNumber: (invoice as any).number || null,

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
        { merge: false }
    );
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
                    typeof session.customer === "string"
                        ? session.customer
                        : (session.customer as any)?.id;

                if (!firebaseUid || !customerId) {
                    console.warn(
                        "checkout.session.completed without firebaseUid or customerId; ignoring",
                        { firebaseUid, customerId }
                    );
                    break;
                }

                await linkCustomerToUid(customerId, firebaseUid);
                await db
                    .collection("kloner_users")
                    .doc(firebaseUid)
                    .set({ stripeCustomerId: customerId }, { merge: true });

                // subscription.* events will perform the tier update
                break;
            }

            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
            case "customer.subscription.trial_will_end": {
                const sub = event.data.object as Stripe.Subscription;

                const customerId =
                    typeof sub.customer === "string" ? sub.customer : (sub.customer as any)?.id;

                if (!customerId) {
                    console.warn("subscription event without customerId; ignoring", event.id);
                    break;
                }

                const uid = await resolveUidForCustomerId(customerId);

                if (!uid) {
                    console.warn(
                        "Stripe webhook: no uid mapping and no kloner_users match for customer",
                        customerId
                    );
                    break;
                }

                const firstItem = sub.items?.data?.[0];
                const priceId =
                    typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;

                const tier = mapPriceToTier(priceId);

                const status = sub.status;
                const effectiveTier =
                    status === "active" || status === "trialing" ? tier : "free";

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
                await writeAffiliateLedgerForInvoicePaid(invoice);
                break;
            }

            default:
                // ignore everything else quietly
                break;
        }

        return NextResponse.json({ received: true });
    } catch (err) {
        console.error("Stripe webhook handler error", err);
        return NextResponse.json({ error: "Webhook handler error" }, { status: 500 });
    }
}
