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
/* Env (ONLY your names)                                               */
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
/* PI ↔ CH mapping                                                     */
/* ------------------------------------------------------------------ */
async function writePiChargeMap(piId: string, chId: string) {
    const pi = cleanStr(piId);
    const ch = cleanStr(chId);
    if (!pi || !ch) return;

    await db
        .collection("affiliate_charge_map")
        .doc(pi)
        .set(
            {
                piId: pi,
                chId: ch,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
}

async function readChargeForPi(piId: string): Promise<string> {
    const pi = cleanStr(piId);
    if (!pi) return "";
    const snap = await db.collection("affiliate_charge_map").doc(pi).get();
    if (!snap.exists) return "";
    return cleanStr((snap.data() as any)?.chId || "");
}

/* ------------------------------------------------------------------ */
/* Affiliate ref resolution + LOCK (kept)                              */
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
/* Reverse lookup docs + reversals                                     */
/* ------------------------------------------------------------------ */
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
    if (cur?.status === "refunded" || cur?.status === "disputed" || cur?.status === "reversed") {
        return;
    }

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

/* ------------------------------------------------------------------ */
/* Core: write/patch ledger entry from invoice, with PI/CH overrides   */
/* ------------------------------------------------------------------ */
async function writeAffiliateLedgerForInvoicePaid(params: {
    stripe: Stripe;
    invoice: Stripe.Invoice;
    overridePaymentIntentId?: string;
    overrideChargeId?: string;
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

    let paymentIntentId = cleanStr(params.overridePaymentIntentId || "");
    let chargeId = cleanStr(params.overrideChargeId || "");

    // If we have PI but no CH, try your mapping store first, then Stripe retrieve PI.
    if (paymentIntentId && !chargeId) {
        chargeId = await readChargeForPi(paymentIntentId);
        if (!chargeId) {
            try {
                const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
                    expand: ["latest_charge"],
                } as any);

                const latestCharge =
                    typeof (pi as any)?.latest_charge === "string"
                        ? (pi as any).latest_charge
                        : typeof (pi as any)?.latest_charge?.id === "string"
                            ? (pi as any).latest_charge.id
                            : "";

                chargeId = cleanStr(latestCharge);
                if (chargeId) await writePiChargeMap(paymentIntentId, chargeId);
            } catch (e) {
                console.error("[stripe] paymentIntents.retrieve failed in ledger writer", { paymentIntentId }, e);
            }
        }
    }

    const entryRef = db
        .collection("affiliate_ledger")
        .doc(affiliateRefUsed)
        .collection("entries")
        .doc(invoice.id);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(entryRef);

        const chargeIdOrNull = chargeId ? chargeId : null;
        const paymentIntentIdOrNull = paymentIntentId ? paymentIntentId : null;

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

                    chargeId: chargeIdOrNull,
                    paymentIntentId: paymentIntentIdOrNull,

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
            const cur = snap.data() as any;
            const patch: any = { updatedAt: now };

            if (!cur?.paymentIntentId && paymentIntentIdOrNull) patch.paymentIntentId = paymentIntentIdOrNull;
            if (!cur?.chargeId && chargeIdOrNull) patch.chargeId = chargeIdOrNull;

            if (Object.keys(patch).length > 1) {
                tx.set(entryRef, patch, { merge: true });
            }
        }
    });

    await writeReverseLookupDocs({
        affiliateRef: affiliateRefUsed,
        entryId: invoice.id,
        chargeId: chargeId || null,
        paymentIntentId: paymentIntentId || null,
    });
}

/* ------------------------------------------------------------------ */
/* invoice_payment.paid handler (primary)                               */
/* ------------------------------------------------------------------ */
async function handleInvoicePaymentPaid(params: {
    stripe: Stripe;
    invoicePayment: any; // Stripe.InvoicePayment type varies by api version
}): Promise<void> {
    const { stripe, invoicePayment } = params;

    const invoiceId = cleanStr(invoicePayment?.invoice || "");
    const paymentIntentId = cleanStr(invoicePayment?.payment?.payment_intent || "");

    if (!invoiceId) return;

    // Retrieve full invoice in correct mode (same client used to verify webhook secret).
    let invoice: Stripe.Invoice | null = null;
    try {
        invoice = await stripe.invoices.retrieve(invoiceId, {
            expand: ["customer", "subscription", "lines"],
        } as any);
    } catch (e) {
        console.error("[stripe] invoices.retrieve failed in invoice_payment.paid", { invoiceId }, e);
        return;
    }

    // If we can resolve charge quickly, do it now.
    let chargeId = "";
    if (paymentIntentId) {
        chargeId = await readChargeForPi(paymentIntentId);
        if (!chargeId) {
            try {
                const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
                    expand: ["latest_charge"],
                } as any);

                const latestCharge =
                    typeof (pi as any)?.latest_charge === "string"
                        ? (pi as any).latest_charge
                        : typeof (pi as any)?.latest_charge?.id === "string"
                            ? (pi as any).latest_charge.id
                            : "";

                chargeId = cleanStr(latestCharge);
                if (chargeId) await writePiChargeMap(paymentIntentId, chargeId);
            } catch (e) {
                console.error("[stripe] paymentIntents.retrieve failed in invoice_payment.paid", { paymentIntentId }, e);
            }
        }
    }

    await writeAffiliateLedgerForInvoicePaid({
        stripe,
        invoice,
        overridePaymentIntentId: paymentIntentId || undefined,
        overrideChargeId: chargeId || undefined,
    });
}

/* ------------------------------------------------------------------ */
/* Refund reversal                                                     */
/* ------------------------------------------------------------------ */
async function reverseAffiliateFromRefund(params: {
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

    const pi = cleanStr(piId);
    const ch = cleanStr(chId);

    // Primary: reverse by PI/CH lookup docs created when payment happened.
    if (pi) await reverseByLookupId({ lookupId: `pi_${pi}`, reason: "refund" });
    if (ch) await reverseByLookupId({ lookupId: `ch_${ch}`, reason: "refund" });

    // Optional: if you can derive invoiceId, also reverse by inv_.
    // Not required if your pi_/ch_ docs exist, but safe.
    let invoiceId = "";

    if (ch) {
        try {
            const charge = await stripe.charges.retrieve(ch, { expand: ["invoice"] } as any);
            const anyCh = charge as any;
            invoiceId =
                typeof anyCh.invoice === "string"
                    ? anyCh.invoice
                    : typeof anyCh.invoice?.id === "string"
                        ? anyCh.invoice.id
                        : "";
            invoiceId = cleanStr(invoiceId);
        } catch { }
    }

    if (!invoiceId && pi) {
        try {
            const paymentIntent = await stripe.paymentIntents.retrieve(pi, { expand: ["invoice"] } as any);
            const anyPi = paymentIntent as any;
            invoiceId =
                typeof anyPi.invoice === "string"
                    ? anyPi.invoice
                    : typeof anyPi.invoice?.id === "string"
                        ? anyPi.invoice.id
                        : "";
            invoiceId = cleanStr(invoiceId);
        } catch { }
    }

    if (invoiceId) {
        await reverseByLookupId({ lookupId: `inv_${invoiceId}`, reason: "refund" });
    }
}

/* ------------------------------------------------------------------ */
/* Webhook verification + dispatch                                     */
/* ------------------------------------------------------------------ */
function pickStripeClientForVerifiedSecret(usedSecret: string): Stripe {
    if (usedSecret === WH_TEST) {
        if (!stripeTest) throw new Error("Missing STRIPE_SECRET_KEY_TEST");
        return stripeTest;
    }
    if (usedSecret === WH_PROD) {
        if (!stripeProd) throw new Error("Missing STRIPE_SECRET_KEY_PROD");
        return stripeProd;
    }
    throw new Error("Verified with unknown webhook secret");
}

export async function POST(req: NextRequest) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
        return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
    }

    const body = await req.text();

    let event: Stripe.Event | null = null;
    let usedSecret = "";

    if (WH_TEST) {
        try {
            event = Stripe.webhooks.constructEvent(body, sig, WH_TEST);
            usedSecret = WH_TEST;
        } catch { }
    }

    if (!event && WH_PROD) {
        try {
            event = Stripe.webhooks.constructEvent(body, sig, WH_PROD);
            usedSecret = WH_PROD;
        } catch { }
    }

    if (!event || !usedSecret) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const stripe = pickStripeClientForVerifiedSecret(usedSecret);

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

            // Keeps your PI->CH map warm (helps later), but not relied upon.
            case "charge.succeeded": {
                const charge = event.data.object as Stripe.Charge;
                const chId = cleanStr(charge.id);
                const piId = cleanStr((charge as any).payment_intent);
                if (piId && chId) await writePiChargeMap(piId, chId);
                break;
            }

            // PRIMARY: this is where you said you always see invoice + PI.
            case "invoice_payment.paid": {
                const invoicePayment = event.data.object as any;
                await handleInvoicePaymentPaid({ stripe, invoicePayment });
                break;
            }

            // Fallback: keep these in case invoice_payment.paid is missing for some edge case.
            case "invoice.paid":
            case "invoice.payment_succeeded": {
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

            case "refund.created": {
                const refund = event.data.object as Stripe.Refund;
                await reverseAffiliateFromRefund({ stripe, refund });
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
                if (chId) await reverseByLookupId({ lookupId: `ch_${cleanStr(chId)}`, reason: "dispute" });
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
