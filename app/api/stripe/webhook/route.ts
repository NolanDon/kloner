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

function getInvoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
    const anyInv = invoice as any;
    const pi = anyInv.payment_intent;

    if (typeof pi === "string") return pi;
    if (pi && typeof pi.id === "string") return pi.id;

    // Some payloads only have charge expanded, and charge has payment_intent
    const c = anyInv.charge;
    if (c && typeof c === "object" && typeof c.payment_intent === "string") {
        return c.payment_intent;
    }
    if (
        c &&
        typeof c === "object" &&
        c.payment_intent &&
        typeof c.payment_intent.id === "string"
    ) {
        return c.payment_intent.id;
    }

    return null;
}

function getInvoiceChargeId(invoice: Stripe.Invoice): string | null {
    const anyInv = invoice as any;

    // 1) Direct charge on invoice
    const c = anyInv.charge;
    if (typeof c === "string") return c;
    if (c && typeof c.id === "string") return c.id;

    // 2) From expanded payment_intent.latest_charge
    const pi = anyInv.payment_intent;
    if (pi && typeof pi === "object") {
        const latestCharge = (pi as any).latest_charge;
        if (typeof latestCharge === "string") return latestCharge;
        if (latestCharge && typeof latestCharge.id === "string") return latestCharge.id;
    }

    return null;
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
            { merge: true }
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
        { merge: true }
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
        { merge: true }
    );

    if (chargeId) {
        batch.set(
            db.collection("affiliate_reverse_invoice").doc(`ch_${chargeId}`),
            { affiliateRef, entryId, updatedAt: now },
            { merge: true }
        );
    }

    if (paymentIntentId) {
        batch.set(
            db.collection("affiliate_reverse_invoice").doc(`pi_${paymentIntentId}`),
            { affiliateRef, entryId, updatedAt: now },
            { merge: true }
        );
    }

    await batch.commit();
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

async function writeAffiliateLedgerForInvoicePaid(params: {
    stripe: Stripe;
    invoice: Stripe.Invoice;
}): Promise<void> {
    const { stripe, invoice } = params;

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

    const chargeId = getInvoiceChargeId(invoice);
    const paymentIntentId = getInvoicePaymentIntentId(invoice);
    const subscriptionId = getInvoiceSubscriptionId(invoice);

    const commissionCents = Math.round(netCollectedCents * AFF_RATE);
    const periodKey = monthKeyFromUnix(paidAtSec);

    const eligibleAt = admin.firestore.Timestamp.fromDate(
        new Date(paidAtDate.getTime() + AFF_PENDING_DAYS * 24 * 60 * 60 * 1000)
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

            // These can still be null in some Stripe payloads, that is fine now.
            // Refund reversal no longer depends on these.
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
            createdAt: now,
            updatedAt: now,
        },
        { merge: false }
    );

    // Always write invoice-based reverse lookup (this is the reliable join key).
    await writeReverseLookupDocs({
        affiliateRef: affiliateRefUsed,
        entryId: invoice.id,
        chargeId: chargeId || null,
        paymentIntentId: paymentIntentId || null,
    });
}

/**
 * NEW: Refund reversal that does NOT depend on chargeId/paymentIntentId being stored on invoice.paid.
 * Strategy:
 * - charge.refunded payload ALWAYS has charge.id and usually payment_intent
 * - retrieve the Charge from Stripe and expand invoice
 * - reverse using inv_{invoiceId} lookup (which you already write on invoice.paid)
 * - fallback: if invoice missing, use invoices.search by payment_intent
 */
async function reverseFromChargeRefunded(params: {
    stripe: Stripe;
    charge: Stripe.Charge;
}): Promise<void> {
    const { stripe, charge } = params;

    const chId = typeof charge.id === "string" ? charge.id : "";
    if (!chId) return;

    // 0) Get PI from webhook payload if present
    const piFromPayload =
        typeof (charge as any).payment_intent === "string"
            ? (charge as any).payment_intent
            : typeof (charge as any).payment_intent?.id === "string"
                ? (charge as any).payment_intent.id
                : "";

    // 1) Retrieve + expand invoice (this is the missing link in your current flow)
    let invId = "";
    let piId = piFromPayload;

    try {
        const full = (await stripe.charges.retrieve(chId, {
            expand: ["invoice", "payment_intent"],
        })) as any;

        const inv = full?.invoice;
        if (typeof inv === "string") invId = inv;
        else if (inv && typeof inv.id === "string") invId = inv.id;

        const pi = full?.payment_intent;
        if (!piId) {
            if (typeof pi === "string") piId = pi;
            else if (pi && typeof pi.id === "string") piId = pi.id;
        }
    } catch (e) {
        console.error("[stripe] charges.retrieve expand failed", { chId }, e);
    }

    // 2) If invoice still missing, use invoices.search by payment_intent (works even when charge.invoice is absent)
    if (!invId && piId) {
        try {
            const res = await stripe.invoices.search({
                query: `payment_intent:"${piId}"`,
                limit: 1,
            });
            if (res.data?.[0]?.id) invId = res.data[0].id;
        } catch (e) {
            console.error("[stripe] invoices.search by payment_intent failed", { piId }, e);
        }
    }

    // 3) Reverse using invoice-based lookup (the one you confirmed exists: inv_in_*)
    if (invId) {
        await reverseByLookupId({ lookupId: `inv_${invId}`, reason: "refund" });
        return;
    }

    // 4) Last-ditch: if you *did* ever store ch_/pi_ mappings, try them too
    await reverseByLookupId({ lookupId: `ch_${chId}`, reason: "refund" });
    if (piId) await reverseByLookupId({ lookupId: `pi_${piId}`, reason: "refund" });
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

            case "invoice.paid": {
                const inv = event.data.object as Stripe.Invoice;

                let invFull: Stripe.Invoice = inv;
                try {
                    invFull = await stripe.invoices.retrieve(inv.id, {
                        // Keep expansions that actually exist and don’t break TS
                        expand: ["charge", "payment_intent", "payment_intent.latest_charge", "subscription"],
                    });

                    const anyInv = invFull as any;
                    console.log("[stripe] invoice.paid expanded", {
                        invoiceId: invFull.id,
                        payment_intent: anyInv.payment_intent?.id ?? anyInv.payment_intent ?? null,
                        latest_charge: anyInv.payment_intent?.latest_charge ?? null,
                        charge: anyInv.charge?.id ?? anyInv.charge ?? null,
                    });
                } catch (e) {
                    console.error("[stripe] invoice.paid retrieve failed", inv.id, e);
                    invFull = inv;
                }

                await writeAffiliateLedgerForInvoicePaid({ stripe, invoice: invFull });
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

            case "charge.refunded": {
                const charge = event.data.object as Stripe.Charge;

                // NEW: do not rely on stored chargeId/piId. Resolve invoiceId from Stripe at refund time.
                await reverseFromChargeRefunded({ stripe, charge });
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
                    // Same idea: disputes are charge-based; you may want to resolve invoice similarly.
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
