import { hasAbandonedSubscriptionCheckout, hasActiveOrTrialingStripeSubscription } from "./recoveryOffer";

const expired = { id: "cs_old", mode: "subscription", status: "expired", payment_status: "unpaid", expires_at: 0 };
const fakeStripe = (data: any[]) => ({ checkout: { sessions: { list: async () => ({ data }) } } } as any);

test("does not confuse a customer or abandoned topup with an abandoned subscription", async () => {
    expect(await hasAbandonedSubscriptionCheckout(fakeStripe([]), "cus_1")).toBe(false);
    expect(await hasAbandonedSubscriptionCheckout(fakeStripe([{ ...expired, mode: "payment" }]), "cus_1")).toBe(false);
    expect(await hasAbandonedSubscriptionCheckout(fakeStripe([expired]), "cus_1")).toBe(true);
});

test("does not interrupt a still-open retry after an older expired checkout", async () => {
    expect(await hasAbandonedSubscriptionCheckout(fakeStripe([expired, { ...expired, id: "cs_new", status: "open", expires_at: 20 }]), "cus_1", 10_000)).toBe(false);
});

test("only confirmed async failure is eligible; pending asynchronous payment is left alone", async () => {
    const pending = { ...expired, id: "cs_async", status: "complete" };
    expect(await hasAbandonedSubscriptionCheckout(fakeStripe([pending]), "cus_1")).toBe(false);
    expect(await hasAbandonedSubscriptionCheckout(fakeStripe([pending]), "cus_1", Date.now(), "cs_async")).toBe(true);
});

test("trialing subscriptions remain excluded even when scheduled to cancel", async () => {
    const stripe: any = { subscriptions: { list: async () => ({ data: [{ status: "trialing", cancel_at_period_end: true }] }) } };
    expect(await hasActiveOrTrialingStripeSubscription(stripe, "cus_1")).toBe(true);
});
