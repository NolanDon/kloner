// app/api/stripe/webhook/route.ts

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import admin from "firebase-admin";
import {
    getUidForStripeCustomer,
    linkCustomerToUid,
} from "../../_lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* -------------------------------- Stripe -------------------------------- */

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

const WH_LIVE =
    process.env.STRIPE_WEBHOOK_SECRET_LIVE ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    "";
const WH_TEST =
    process.env.STRIPE_WEBHOOK_SECRET_TEST ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    "";

/* ------------------------------ Firebase --------------------------------- */

if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");

    let cred: admin.ServiceAccount;
    try {
        cred = JSON.parse(raw);
    } catch {
        cred = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    }

    admin.initializeApp({
        credential: admin.credential.cert(cred),
    });
}

const db = admin.firestore();

/* ------------------------------ Constants -------------------------------- */

const AFF_RATE = 0.3;
const AFF_CAP_MONTHS = 12;
const AFF_PENDING_DAYS = 14;

/* ------------------------------- Helpers --------------------------------- */

const clean = (v: unknown, max = 128) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";

const monthKey = (ts: number) => {
    const d = new Date(ts * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const addMonths = (d: Date, m: number) => {
    const x = new Date(d.getTime());
    x.setUTCMonth(x.getUTCMonth() + m);
    return x;
};

function paidAt(invoice: Stripe.Invoice): Date {
    const any = invoice as any;
    const sec =
        typeof any.status_transitions?.paid_at === "number"
            ? any.status_transitions.paid_at
            : typeof any.created === "number"
                ? any.created
                : Math.floor(Date.now() / 1000);
    return new Date(sec * 1000);
}

function getSubscriptionId(invoice: Stripe.Invoice): string | null {
    const any = invoice as any;
    if (typeof any.subscription === "string") return any.subscription;
    if (any.subscription?.id) return any.subscription.id;
    const l0 = any.lines?.data?.[0];
    if (typeof l0?.subscription === "string") return l0.subscription;
    if (l0?.subscription?.id) return l0.subscription.id;
    if (any.parent?.subscription_details?.subscription)
        return any.parent.subscription_details.subscription;
    return null;
}

/* -------- Correct Invoice Payments extractor (THIS WAS THE BUG) ---------- */

function extractInvoicePaymentRefs(invoice: Stripe.Invoice): {
    paymentIntentId: string | null;
    chargeId: string | null;
} {
    const any = invoice as any;
    const p0 = any?.payments?.data?.[0];
    const payment = p0?.payment;

    const pi =
        typeof payment?.payment_intent === "string"
            ? payment.payment_intent
            : payment?.payment_intent?.id || null;

    const directCharge =
        typeof payment?.charge === "string"
            ? payment.charge
            : payment?.charge?.id || null;

    const piLatest =
        payment?.payment_intent?.latest_charge &&
        (typeof payment.payment_intent.latest_charge === "string"
            ? payment.payment_intent.latest_charge
            : payment.payment_intent.latest_charge.id);

    return {
        paymentIntentId: pi || null,
        chargeId: directCharge || piLatest || null,
    };
}

/* ------------------------ Affiliate reversal core ------------------------- */

async function reverseByInvoiceId(invoiceId: string, reason: string) {
    const snap = await db
        .collection("affiliate_reverse_invoice")
        .doc(`inv_${invoiceId}`)
        .get();

    if (!snap.exists) return;

    const { affiliateRef, entryId } = snap.data() as any;
    if (!affiliateRef || !entryId) return;

    const ref = db
        .collection("affiliate_ledger")
        .doc(affiliateRef)
        .collection("entries")
        .doc(entryId);

    await ref.set(
        {
            status: "reversed",
            reversalReason: reason,
            reversedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    );
}

/* -------------------------- Invoice.paid logic ---------------------------- */

async function handleInvoicePaid(stripe: Stripe, invoice: Stripe.Invoice) {
    const customerId =
        typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;
    if (!customerId) return;

    const uid = await getUidForStripeCustomer(customerId);
    if (!uid) return;

    const amount = Number((invoice as any).amount_paid || 0);
    if (!amount) return;

    const paidDate = paidAt(invoice);
    const periodKey = monthKey(Math.floor(paidDate.getTime() / 1000));

    const entryRef = db
        .collection("affiliate_ledger")
        .doc("DEFAULT") // resolved later via lock
        .collection("entries")
        .doc(invoice.id);

    const exists = await entryRef.get();
    if (exists.exists) return;

    const { paymentIntentId, chargeId } = extractInvoicePaymentRefs(invoice);

    await entryRef.set({
        invoiceId: invoice.id,
        customerId,
        uid,
        paymentIntentId,
        chargeId,
        netCollectedCents: amount,
        commissionCents: Math.round(amount * AFF_RATE),
        status: "pending",
        periodKey,
        paidAt: admin.firestore.Timestamp.fromDate(paidDate),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db
        .collection("affiliate_reverse_invoice")
        .doc(`inv_${invoice.id}`)
        .set(
            {
                affiliateRef: "DEFAULT",
                entryId: invoice.id,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
}

/* ------------------------------- Webhook ---------------------------------- */

export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) return NextResponse.json({ error: "No signature" }, { status: 400 });

    const body = await req.text();

    let event: Stripe.Event | null = null;
    try {
        if (WH_LIVE)
            event = stripeForMode(true).webhooks.constructEvent(body, sig, WH_LIVE);
    } catch { }

    if (!event && WH_TEST) {
        try {
            event = stripeForMode(false).webhooks.constructEvent(body, sig, WH_TEST);
        } catch { }
    }

    if (!event) return NextResponse.json({ error: "Bad signature" }, { status: 400 });

    const stripe = stripeForMode(!!event.livemode);

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const s = event.data.object as Stripe.Checkout.Session;
                if (s.metadata?.firebaseUid && s.customer)
                    await linkCustomerToUid(
                        s.customer as string,
                        s.metadata.firebaseUid
                    );
                break;
            }

            case "invoice.paid": {
                const inv = await stripe.invoices.retrieve(
                    (event.data.object as Stripe.Invoice).id,
                    {
                        expand: [
                            "payments",
                            "payments.data.payment",
                            "payments.data.payment.payment_intent",
                            "payments.data.payment.payment_intent.latest_charge",
                            "payments.data.payment.charge",
                        ] as any,
                    }
                );
                await handleInvoicePaid(stripe, inv);
                break;
            }

            case "charge.refunded": {
                const ch = event.data.object as Stripe.Charge;
                const full = await stripe.charges.retrieve(ch.id, {
                    expand: ["invoice", "payment_intent", "payment_intent.invoice"] as any,
                });

                const invId =
                    typeof (full as any).invoice === "string"
                        ? (full as any).invoice
                        : (full as any).invoice?.id ||
                        (full as any).payment_intent?.invoice ||
                        (full as any).payment_intent?.invoice?.id;

                if (invId) await reverseByInvoiceId(invId, "refund");
                break;
            }
        }

        return NextResponse.json({ received: true });
    } catch (e) {
        console.error("stripe webhook error", e);
        return NextResponse.json({ error: "handler error" }, { status: 500 });
    }
}
