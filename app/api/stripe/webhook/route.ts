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

/* ------------------------------------------------------------------ */
/* Stripe setup — HARD separation between test and live                 */
/* ------------------------------------------------------------------ */

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-10-29.clover";

const STRIPE_LIVE_KEY = process.env.STRIPE_SECRET_KEY_LIVE || "";
const STRIPE_TEST_KEY = process.env.STRIPE_SECRET_KEY_TEST || "";

const stripeLive = STRIPE_LIVE_KEY
    ? new Stripe(STRIPE_LIVE_KEY, { apiVersion: STRIPE_API_VERSION })
    : null;

const stripeTest = STRIPE_TEST_KEY
    ? new Stripe(STRIPE_TEST_KEY, { apiVersion: STRIPE_API_VERSION })
    : null;

const WH_LIVE = process.env.STRIPE_WEBHOOK_SECRET_LIVE || "";
const WH_TEST = process.env.STRIPE_WEBHOOK_SECRET_TEST || "";

function stripeForWebhookSecret(secret: string): Stripe {
    if (secret === WH_LIVE) {
        if (!stripeLive) throw new Error("Missing STRIPE_SECRET_KEY_LIVE");
        return stripeLive;
    }
    if (secret === WH_TEST) {
        if (!stripeTest) throw new Error("Missing STRIPE_SECRET_KEY_TEST");
        return stripeTest;
    }
    throw new Error("Webhook verified with unknown secret");
}

/* ------------------------------------------------------------------ */
/* Firebase Admin                                                       */
/* ------------------------------------------------------------------ */

if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");

    const parsed = raw.trim().startsWith("{")
        ? JSON.parse(raw)
        : JSON.parse(Buffer.from(raw, "base64").toString("utf8"));

    admin.initializeApp({
        credential: admin.credential.cert(parsed),
    });
}

const db = admin.firestore();

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function cleanStr(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

function monthKeyFromUnix(ts: number) {
    const d = new Date(ts * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Affiliate write — SINGLE SOURCE OF TRUTH (invoice)                   */
/* ------------------------------------------------------------------ */

async function writeAffiliateLedgerFromInvoice(params: {
    stripe: Stripe;
    invoiceId: string;
}) {
    const { stripe, invoiceId } = params;

    const invoice = await stripe.invoices.retrieve(invoiceId, {
        expand: ["payment_intent", "charge", "subscription"],
    });

    const customerId =
        typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;

    if (!customerId) return;

    const uid =
        (await getUidForStripeCustomer(customerId)) ||
        (await db
            .collection("kloner_users")
            .where("stripeCustomerId", "==", customerId)
            .limit(1)
            .get()
            .then((s) => (s.empty ? null : s.docs[0].id)));

    if (!uid) return;

    const net = Number((invoice as any).amount_paid || 0);
    if (!net) return;

    const piId =
        typeof (invoice as any).payment_intent === "string"
            ? (invoice as any).payment_intent
            : (invoice as any).payment_intent?.id || null;

    const chId =
        typeof (invoice as any).charge === "string"
            ? (invoice as any).charge
            : (invoice as any).charge?.id || null;

    const paidAt =
        (invoice as any).status_transitions?.paid_at ||
        invoice.created ||
        Math.floor(Date.now() / 1000);

    const entryRef = db
        .collection("affiliate_ledger")
        .doc("default") // replace if you shard by affiliateRef
        .collection("entries")
        .doc(invoice.id);

    await entryRef.set(
        {
            uid,
            customerId,
            invoiceId: invoice.id,
            subscriptionId:
                typeof invoice.subscription === "string"
                    ? invoice.subscription
                    : invoice.subscription?.id || null,

            chargeId: chId,
            paymentIntentId: piId,

            netCollectedCents: net,
            commissionCents: Math.round(net * 0.3),
            currency: invoice.currency,
            periodKey: monthKeyFromUnix(paidAt),

            paidAt: admin.firestore.Timestamp.fromMillis(paidAt * 1000),
            status: "pending",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
}

/* ------------------------------------------------------------------ */
/* Webhook handler                                                      */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
        return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
    }

    const body = await req.text();

    let event: Stripe.Event | null = null;
    let usedSecret: string | null = null;

    try {
        event = Stripe.webhooks.constructEvent(body, sig, WH_LIVE);
        usedSecret = WH_LIVE;
    } catch {
        try {
            event = Stripe.webhooks.constructEvent(body, sig, WH_TEST);
            usedSecret = WH_TEST;
        } catch {
            return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
        }
    }

    const stripe = stripeForWebhookSecret(usedSecret);

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const s = event.data.object as Stripe.Checkout.Session;
                if (s.metadata?.firebaseUid && s.customer) {
                    await linkCustomerToUid(
                        typeof s.customer === "string" ? s.customer : s.customer.id,
                        s.metadata.firebaseUid,
                    );
                }
                break;
            }

            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
                const sub = event.data.object as Stripe.Subscription;
                const customerId =
                    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
                if (!customerId) break;

                const uid = await getUidForStripeCustomer(customerId);
                if (!uid) break;

                const priceId = sub.items?.data?.[0]?.price?.id || null;
                const tier = mapPriceToTier(priceId);

                await setUserTierFromStripe(uid, tier, {
                    customerId,
                    subscriptionId: sub.id,
                    priceId,
                    status: sub.status,
                });
                break;
            }

            /* 🔑 SINGLE SOURCE OF TRUTH */
            case "invoice.paid":
            case "invoice.payment_succeeded": {
                const inv = event.data.object as Stripe.Invoice;
                await writeAffiliateLedgerFromInvoice({
                    stripe,
                    invoiceId: inv.id,
                });
                break;
            }

            default:
                break;
        }

        return NextResponse.json({ received: true });
    } catch (err) {
        console.error("Stripe webhook error", err);
        return NextResponse.json({ error: "Webhook failure" }, { status: 500 });
    }
}
