// app/api/_lib/billingSubscriptionGuard.ts
//
// Shared helpers for the checkout routes' single-subscription rule: a
// Stripe customer must never end up with more than one live (billable)
// Kloner subscription. Existence is always checked against the Stripe API
// (every subscription on the customer), never just the subscription id
// stored on the user doc, because the stored id can be stale or point at
// only one of several live subscriptions.

/**
 * States in which a subscription can still bill the customer or be revived
 * into billing. "canceled" and "incomplete_expired" are dead and excluded.
 */
export const BILLABLE_SUBSCRIPTION_STATUSES: readonly string[] = [
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "incomplete",
];

export function isBillableSubscription(sub: { status?: unknown } | null | undefined): boolean {
    if (!sub || typeof sub.status !== "string") return false;
    return BILLABLE_SUBSCRIPTION_STATUSES.includes(sub.status);
}

export function filterBillableSubscriptions<T extends { status?: unknown }>(subs: readonly T[] | null | undefined): T[] {
    if (!Array.isArray(subs)) return [];
    return subs.filter((s) => isBillableSubscription(s));
}

// Survivor priority when duplicates exist: the paid/active subscription
// survives; otherwise the most recently created live one. Matches the
// ordering pickBestSubscription uses in app/api/_lib/billing.ts.
const SURVIVOR_PRIORITY = new Map<string, number>([
    ["active", 1],
    ["trialing", 2],
    ["past_due", 3],
    ["unpaid", 4],
    ["incomplete", 5],
]);

export function pickSurvivorSubscription<T extends { status?: unknown; created?: unknown }>(
    subs: readonly T[] | null | undefined,
): T | null {
    const billable = filterBillableSubscriptions(subs as readonly { status?: unknown }[]) as unknown as T[];
    if (!billable.length) return null;

    const scored = billable
        .map((s) => {
            const st = typeof s?.status === "string" ? s.status : "";
            const score = SURVIVOR_PRIORITY.get(st) ?? 50;
            const created = typeof s?.created === "number" ? s.created : 0;
            return { s, score, created };
        })
        .sort((a, b) => a.score - b.score || b.created - a.created);

    return scored[0]?.s ?? null;
}

// ---------------------------------------------------------------------------
// 3D Secure / payment-action handling.
//
// When a subscription update is made with payment_behavior
// "allow_incomplete" and the saved card needs an extra check (3D Secure),
// Stripe does NOT fail the call. Instead the subscription stays
// past_due / incomplete and the first invoice carries a PaymentIntent in
// status "requires_action" with a next_action.redirect_to_url — the bank's
// verification page. The user must be sent to that URL; after they finish,
// Stripe sends them back to returnUrl. Until the payment completes, the
// subscription is NOT active, so the user gets no paid access (only
// "active" and "trialing" grant access).
//
// This helper re-reads the subscription (an idempotent replay can return a
// stale pre-verification snapshot), finds the invoice's PaymentIntent, and
// returns the URL to send the user to, if one exists. It never throws: on
// any surprise it returns nulls and the caller falls back to its normal
// payment error.
// ---------------------------------------------------------------------------

/** Minimal Stripe surface this helper needs; the real Stripe client fits it. */
export type SubscriptionPaymentActionClient = {
    subscriptions: {
        retrieve: (id: string, params?: Record<string, unknown>) => Promise<any>;
    };
    invoices?: {
        retrieve: (id: string, params?: Record<string, unknown>) => Promise<any>;
    };
    paymentIntents: {
        retrieve: (id: string, params?: Record<string, unknown>) => Promise<any>;
        update: (id: string, params?: Record<string, unknown>) => Promise<any>;
    };
};

export type SubscriptionPaymentAction = {
    /** Fresh subscription status after re-reading Stripe. */
    subscriptionStatus: string | null;
    /** URL to send the user to to complete the payment, if one exists. */
    actionUrl: string | null;
    /** Latest invoice PaymentIntent status, if one was found. */
    paymentIntentStatus: string | null;
};

function readPaymentIntentFromInvoice(stripe: SubscriptionPaymentActionClient, invoice: any): Promise<any> {
    const ref = invoice?.payment_intent;
    if (ref && typeof ref === "object") return Promise.resolve(ref);
    if (typeof ref === "string" && ref) {
        return stripe.paymentIntents.retrieve(ref).catch(() => null);
    }
    const payments = invoice?.payments;
    const first = Array.isArray(payments?.data) ? payments.data[0]?.payment_intent : undefined;
    if (first && typeof first === "object") return Promise.resolve(first);
    if (typeof first === "string" && first) {
        return stripe.paymentIntents.retrieve(first).catch(() => null);
    }
    return Promise.resolve(null);
}

export async function resolveSubscriptionPaymentAction(params: {
    stripe: SubscriptionPaymentActionClient;
    subscription: any;
    returnUrl: string;
}): Promise<SubscriptionPaymentAction> {
    const { stripe, subscription, returnUrl } = params;
    const none = (subscriptionStatus: string | null, paymentIntentStatus: string | null): SubscriptionPaymentAction => ({
        subscriptionStatus,
        actionUrl: null,
        paymentIntentStatus,
    });
    try {
        // Re-read: the update call may have been an idempotent replay of a
        // snapshot taken before the user finished verification.
        let fresh: any = subscription;
        try {
            fresh = await stripe.subscriptions.retrieve(subscription?.id, {
                expand: ["latest_invoice.payment_intent"],
            });
        } catch {
            // Keep the snapshot we already have.
        }
        const subscriptionStatus = typeof fresh?.status === "string" ? fresh.status : null;
        if (subscriptionStatus === "active") return none(subscriptionStatus, null);

        let invoice: any = null;
        if (fresh?.latest_invoice && typeof fresh.latest_invoice === "object") {
            invoice = fresh.latest_invoice;
        } else if (typeof fresh?.latest_invoice === "string" && stripe.invoices) {
            try {
                invoice = await stripe.invoices.retrieve(fresh.latest_invoice, {
                    expand: ["payment_intent"],
                });
            } catch {
                invoice = null;
            }
        }
        if (!invoice) return none(subscriptionStatus, null);

        const paymentIntent: any = await readPaymentIntentFromInvoice(stripe, invoice);
        const paymentIntentStatus =
            typeof paymentIntent?.status === "string" ? paymentIntent.status : null;
        if (!paymentIntent || paymentIntentStatus !== "requires_action") {
            return none(subscriptionStatus, paymentIntentStatus);
        }

        // Standard 3D Secure step: a redirect to the bank's verification
        // page. Point the bank page back at Kloner's success page, then
        // re-read the PaymentIntent so the URL we hand out matches the
        // return address we just set.
        const nextAction = paymentIntent.next_action;
        const redirectUrl =
            nextAction?.type === "redirect_to_url"
                ? nextAction?.redirect_to_url?.url
                : null;
        if (typeof redirectUrl === "string" && redirectUrl) {
            try {
                const updated = await stripe.paymentIntents.update(paymentIntent.id, {
                    return_url: returnUrl,
                });
                try {
                    const freshPi: any = await stripe.paymentIntents.retrieve(updated.id);
                    const freshUrl =
                        freshPi?.next_action?.type === "redirect_to_url"
                            ? freshPi?.next_action?.redirect_to_url?.url
                            : null;
                    if (typeof freshUrl === "string" && freshUrl) {
                        return { subscriptionStatus, actionUrl: freshUrl, paymentIntentStatus };
                    }
                } catch {
                    // Fall through to the pre-update URL.
                }
            } catch {
                // Fall through to the pre-update URL.
            }
            return { subscriptionStatus, actionUrl: redirectUrl, paymentIntentStatus };
        }

        // Any other requires_action shape: Stripe's hosted invoice page can
        // still collect the payment (including 3D Secure).
        const hostedUrl =
            typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : null;
        return { subscriptionStatus, actionUrl: hostedUrl, paymentIntentStatus };
    } catch {
        return none(null, null);
    }
}
