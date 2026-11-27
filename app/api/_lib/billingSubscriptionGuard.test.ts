// app/api/_lib/billingSubscriptionGuard.test.ts
import {
    filterBillableSubscriptions,
    isBillableSubscription,
    pickSurvivorSubscription,
    resolveSubscriptionPaymentAction,
} from "./billingSubscriptionGuard";

describe("billingSubscriptionGuard", () => {
    it("treats only live states as billable (incomplete_expired and canceled are dead)", () => {
        for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete"]) {
            expect(isBillableSubscription({ status })).toBe(true);
        }
        for (const status of ["canceled", "incomplete_expired", "paused", undefined, null]) {
            expect(isBillableSubscription({ status })).toBe(false);
        }
    });

    it("filters a mixed subscription list down to billable ones", () => {
        const subs = [
            { id: "a", status: "active" },
            { id: "b", status: "canceled" },
            { id: "c", status: "past_due" },
            { id: "d", status: "incomplete_expired" },
        ];
        expect(filterBillableSubscriptions(subs).map((s) => s.id)).toEqual(["a", "c"]);
    });

    it("survivor: the active/paid subscription wins over a newer trialing one", () => {
        const survivor = pickSurvivorSubscription([
            { id: "trial_new", status: "trialing", created: 200 },
            { id: "active_old", status: "active", created: 100 },
        ]);
        expect(survivor?.id).toBe("active_old");
    });

    it("survivor: with no active sub, the newest live one wins", () => {
        const survivor = pickSurvivorSubscription([
            { id: "pd_old", status: "past_due", created: 100 },
            { id: "pd_new", status: "past_due", created: 300 },
            { id: "dead", status: "canceled", created: 999 },
        ]);
        expect(survivor?.id).toBe("pd_new");
    });

    it("survivor: past_due wins over a newer unpaid or incomplete subscription", () => {
        const survivor = pickSurvivorSubscription([
            { id: "inc_new", status: "incomplete", created: 300 },
            { id: "unpaid_mid", status: "unpaid", created: 200 },
            { id: "pd_old", status: "past_due", created: 100 },
        ]);
        expect(survivor?.id).toBe("pd_old");
    });
});

describe("resolveSubscriptionPaymentAction", () => {
    const bankUrl = "https://bank.example/3ds-challenge";
    const freshBankUrl = "https://bank.example/3ds-challenge-fresh";
    const hostedUrl = "https://invoice.stripe.com/pay/hosted";
    const successUrl = "https://kloner.app/dashboard/view?billing=success";

    function paymentIntent(status: string, nextAction?: any) {
        return { id: "pi_1", status, next_action: nextAction ?? null };
    }

    function subscriptionWithInvoice(status: string, pi: any, extraInvoice?: Record<string, any>) {
        return {
            id: "sub_1",
            status,
            latest_invoice: {
                id: "in_1",
                hosted_invoice_url: hostedUrl,
                payment_intent: pi,
                ...(extraInvoice ?? {}),
            },
        };
    }

    function fakeStripe(retrieveSub: any, retrievePi: any) {
        const piUpdate = jest.fn(async (id: string, payload: any) => ({ id, ...payload }));
        const piRetrieve = jest.fn(async (_id: string) => retrievePi);
        const subRetrieve = jest.fn(async (_id: string, _params?: any) => retrieveSub);
        return {
            stripe: {
                subscriptions: { retrieve: subRetrieve },
                paymentIntents: { retrieve: piRetrieve, update: piUpdate },
            } as any,
            piUpdate,
            piRetrieve,
            subRetrieve,
        };
    }

    it("returns the bank redirect URL and points the verification page back at the success URL", async () => {
        const sub = subscriptionWithInvoice(
            "past_due",
            paymentIntent("requires_action", {
                type: "redirect_to_url",
                redirect_to_url: { url: bankUrl },
            }),
        );
        const freshPi = paymentIntent("requires_action", {
            type: "redirect_to_url",
            redirect_to_url: { url: freshBankUrl },
        });
        const { stripe, piUpdate } = fakeStripe(sub, freshPi);

        const result = await resolveSubscriptionPaymentAction({
            stripe,
            subscription: sub,
            returnUrl: successUrl,
        });

        expect(result.subscriptionStatus).toBe("past_due");
        expect(result.paymentIntentStatus).toBe("requires_action");
        expect(result.actionUrl).toBe(freshBankUrl);
        expect(piUpdate).toHaveBeenCalledTimes(1);
        expect(piUpdate.mock.calls[0][0]).toBe("pi_1");
        expect((piUpdate.mock.calls[0][1] as any).return_url).toBe(successUrl);
    });

    it("falls back to the hosted invoice URL when there is no redirect step", async () => {
        const sub = subscriptionWithInvoice(
            "past_due",
            paymentIntent("requires_action", { type: "use_stripe_sdk", stripe_js: "src_1" }),
        );
        const { stripe, piUpdate } = fakeStripe(sub, sub.latest_invoice.payment_intent);

        const result = await resolveSubscriptionPaymentAction({
            stripe,
            subscription: sub,
            returnUrl: successUrl,
        });

        expect(result.actionUrl).toBe(hostedUrl);
        expect(result.paymentIntentStatus).toBe("requires_action");
        expect(piUpdate).not.toHaveBeenCalled();
    });

    it("returns no action URL when the card is declined, and surfaces the status", async () => {
        const sub = subscriptionWithInvoice("past_due", paymentIntent("requires_payment_method"));
        const { stripe, piUpdate } = fakeStripe(sub, sub.latest_invoice.payment_intent);

        const result = await resolveSubscriptionPaymentAction({
            stripe,
            subscription: sub,
            returnUrl: successUrl,
        });

        expect(result.actionUrl).toBeNull();
        expect(result.paymentIntentStatus).toBe("requires_payment_method");
        expect(piUpdate).not.toHaveBeenCalled();
    });

    it("returns active when the re-read subscription is already active", async () => {
        const sub = subscriptionWithInvoice(
            "past_due",
            paymentIntent("requires_action", {
                type: "redirect_to_url",
                redirect_to_url: { url: bankUrl },
            }),
        );
        const activeSub = { ...sub, status: "active" };
        const { stripe, piUpdate } = fakeStripe(activeSub, sub.latest_invoice.payment_intent);

        const result = await resolveSubscriptionPaymentAction({
            stripe,
            subscription: sub,
            returnUrl: successUrl,
        });

        expect(result.subscriptionStatus).toBe("active");
        expect(result.actionUrl).toBeNull();
        expect(piUpdate).not.toHaveBeenCalled();
    });

    it("retrieves a string PaymentIntent id before deciding", async () => {
        const pi = paymentIntent("requires_action", {
            type: "redirect_to_url",
            redirect_to_url: { url: bankUrl },
        });
        const sub = subscriptionWithInvoice("past_due", "pi_1");
        const freshPi = paymentIntent("requires_action", {
            type: "redirect_to_url",
            redirect_to_url: { url: freshBankUrl },
        });
        const { stripe } = fakeStripe(sub, freshPi);
        // The helper retrieves the string id first; the second retrieve (after
        // the return_url update) returns the fresh redirect URL.
        const piRetrieve = (stripe.paymentIntents.retrieve as jest.Mock).mockImplementationOnce(
            async () => pi,
        );

        const result = await resolveSubscriptionPaymentAction({
            stripe,
            subscription: sub,
            returnUrl: successUrl,
        });

        expect(result.actionUrl).toBe(freshBankUrl);
        expect(piRetrieve).toHaveBeenCalled();
    });

    it("returns nulls when there is no invoice", async () => {
        const { stripe } = fakeStripe({ id: "sub_1", status: "past_due", latest_invoice: null }, null);

        const result = await resolveSubscriptionPaymentAction({
            stripe,
            subscription: { id: "sub_1", status: "past_due", latest_invoice: null },
            returnUrl: successUrl,
        });

        expect(result.subscriptionStatus).toBe("past_due");
        expect(result.actionUrl).toBeNull();
        expect(result.paymentIntentStatus).toBeNull();
    });
});
