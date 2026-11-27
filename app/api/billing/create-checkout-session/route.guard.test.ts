// app/api/billing/create-checkout-session/route.guard.test.ts
//
// Narrowed single-subscription guard for checkout: a customer whose live
// subscription is past_due / unpaid / incomplete must be upgraded in place,
// never handed a second subscription via a new Checkout session. Trialing
// and active behaviour is unchanged from the original route. Uses the REAL
// billingSubscriptionGuard module; Stripe and Firestore are mocked.

export {};

jest.mock("next/server", () => ({
    __esModule: true,
    NextResponse: {
        json: (body: any, init?: { status?: number }) => ({
            status: init?.status ?? 200,
            async json() {
                return body;
            },
        }),
    },
}));

jest.mock("../../_lib/route-guard", () => ({
    __esModule: true,
    requireSessionAndMaybeCsrf: async (req: any, handler: any) => handler({ req, uid: "uid_1" }),
}));

const refreshTierFromStripeForUid = jest.fn(async (_uid: string) => ({}));
jest.mock("../../_lib/billing", () => ({
    __esModule: true,
    linkCustomerToUid: jest.fn(async () => {}),
    refreshTierFromStripeForUid: (uid: string) => refreshTierFromStripeForUid(uid),
}));

jest.mock("@/lib/observability", () => ({
    __esModule: true,
    captureCriticalEvent: jest.fn(async () => {}),
    captureException: jest.fn(async () => {}),
    captureAuditEvent: jest.fn(async () => {}),
}));

jest.mock("@/app/api/_lib/monthlyPrice", () => ({
    __esModule: true,
    resolveMonthlyPriceId: () => "price_pro_123",
}));

jest.mock("@/app/api/_lib/earlyGenerationGate", () => ({
    __esModule: true,
    shouldRequireEarlyGenerationPaywall: async () => false,
}));

jest.mock("@/app/api/_lib/freeTrial", () => ({
    __esModule: true,
    hasPriorSubscriptionHistoryForAccount: async () => false,
}));

jest.mock("@/lib/attribution", () => ({
    __esModule: true,
    parseFirstTouch: () => null,
    attributionToStripeMeta: () => ({}),
}));

jest.mock("@/src/lib/billingAccess", () => ({
    __esModule: true,
    STRIPE_TRIAL_DAYS: 7,
}));

function createFirestoreMock() {
    const store = new Map<string, Record<string, any>>();
    store.set("kloner_users/uid_1", { stripeCustomerId: "cus_1", stripeCustomerIdTest: "cus_1" });
    const db = {
        collection: (name: string) => ({
            doc: (id: string) => {
                const key = `${name}/${id}`;
                return {
                    id,
                    get: async () => {
                        const data = store.get(key);
                        return { exists: !!data, data: () => (data ? { ...data } : undefined) };
                    },
                    set: async (data: any, opts?: { merge?: boolean }) => {
                        const prev = store.get(key) ?? {};
                        store.set(key, opts?.merge ? { ...prev, ...data } : { ...data });
                    },
                };
            },
        }),
        runTransaction: async (handler: any) =>
            handler({
                get: async (ref: any) => ref.get(),
                set: (ref: any, data: any, opts?: any) => ref.set(data, opts),
            }),
    };
    return { db, store };
}

function setupStripe(
    subs: any[],
    opts?: {
        updateImpl?: (id: string, payload: any, options?: any) => Promise<any>;
        retrieveImpl?: (id: string, params?: any) => Promise<any>;
        piRetrieveImpl?: (id: string) => Promise<any>;
    },
) {
    const update = jest.fn(async (id: string, payload: any, _options?: any) => {
        if (opts?.updateImpl) return opts.updateImpl(id, payload, _options);
        const base = subs.find((s) => s.id === id) || { id };
        return { ...base, ...payload, status: "active", cancel_at_period_end: payload?.cancel_at_period_end ?? base.cancel_at_period_end ?? false };
    });
    const retrieve = jest.fn(async (id: string, params?: any) => {
        if (opts?.retrieveImpl) return opts.retrieveImpl(id, params);
        const base = subs.find((s) => s.id === id) || { id };
        return { ...base, status: "active" };
    });
    const cancel = jest.fn(async (id: string) => ({ id, status: "canceled" }));
    const sessionsCreate = jest.fn(async () => ({ url: "https://stripe/checkout" }));
    const piUpdate = jest.fn(async (id: string, payload: any) => ({ id, ...payload }));
    const piRetrieve = jest.fn(async (id: string) => {
        if (opts?.piRetrieveImpl) return opts.piRetrieveImpl(id);
        return {
            id,
            status: "requires_action",
            next_action: {
                type: "redirect_to_url",
                redirect_to_url: { url: "https://bank.example/3ds-fresh" },
            },
        };
    });
    jest.doMock("@/lib/stripe", () => ({
        __esModule: true,
        getStripe: () => ({
            subscriptions: {
                list: async () => ({ data: subs }),
                update,
                retrieve,
                cancel,
            },
            paymentIntents: {
                update: piUpdate,
                retrieve: piRetrieve,
            },
            customers: {
                retrieve: async () => ({ id: "cus_1", deleted: false }),
                create: async () => ({ id: "cus_1" }),
                update: async () => ({}),
            },
            promotionCodes: { list: async () => ({ data: [] }) },
            checkout: { sessions: { create: sessionsCreate } },
        }),
    }));
    return { update, cancel, sessionsCreate, retrieve, piUpdate, piRetrieve };
}

// A subscription whose first invoice needs 3D Secure: the update leaves it
// past_due with a PaymentIntent in requires_action carrying the bank's
// verification URL.
const requiresActionSub = (id: string, status: string, piStatus = "requires_action") => ({
    id,
    status,
    cancel_at_period_end: false,
    created: 100,
    items: { data: [{ id: `si_${id}`, price: { id: "price_old" } }] },
    latest_invoice: {
        id: "in_1",
        hosted_invoice_url: "https://invoice.stripe.com/pay/hosted",
        payment_intent: {
            id: "pi_1",
            status: piStatus,
            next_action:
                piStatus === "requires_action"
                    ? {
                        type: "redirect_to_url",
                        redirect_to_url: { url: "https://bank.example/3ds" },
                    }
                    : null,
        },
    },
});

const billableSub = (id: string, status: string, extra?: Record<string, any>) => ({
    id,
    status,
    cancel_at_period_end: false,
    created: 100,
    items: { data: [{ id: `si_${id}`, price: { id: "price_old" } }] },
    ...extra,
});

describe("POST /api/billing/create-checkout-session (narrowed guard)", () => {
    const OLD_ENV = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV };
        refreshTierFromStripeForUid.mockClear();

        const { db } = createFirestoreMock();
        jest.doMock("firebase-admin", () => ({
            __esModule: true,
            default: {
                apps: [{}],
                firestore: Object.assign(() => db, {
                    FieldValue: {
                        serverTimestamp: () => ({ __type: "serverTimestamp" }),
                        delete: () => ({ __type: "delete" }),
                    },
                }),
                auth: () => ({ getUser: async () => ({ email: "user@example.com" }) }),
            },
        }));
    });

    afterAll(() => {
        process.env = OLD_ENV;
    });

    const req = () =>
        ({
            url: "https://kloner.app/api/billing/create-checkout-session",
            json: async () => ({ plan: "pro" }),
        }) as any;

    it("(c) trialing user upgrades in place via the existing trial path; no checkout session", async () => {
        const { update, sessionsCreate } = setupStripe([billableSub("sub_trial", "trialing")]);
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.upgradedTrial).toBe(true);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0]).toBe("sub_trial");
        expect((update.mock.calls[0][1] as any).trial_end).toBe("now");
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("(a) past_due user is upgraded in place; checkout.sessions.create is never called", async () => {
        const { update, cancel, sessionsCreate } = setupStripe([billableSub("sub_pd", "past_due")]);
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.upgradedExisting).toBe(true);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0]).toBe("sub_pd");
        expect((update.mock.calls[0][1] as any).items).toEqual([
            { id: "si_sub_pd", price: "price_pro_123" },
        ]);
        expect((update.mock.calls[0][2] as any).idempotencyKey).toBe(
            "existing-upgrade:uid_1:sub_pd:pro",
        );
        expect(sessionsCreate).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
    });

    it("(b) unpaid user is upgraded in place; no checkout session", async () => {
        const { update, sessionsCreate } = setupStripe([billableSub("sub_unpaid", "unpaid")]);
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.upgradedExisting).toBe(true);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0]).toBe("sub_unpaid");
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("(b) incomplete user is upgraded in place; no checkout session", async () => {
        const { update, sessionsCreate } = setupStripe([billableSub("sub_inc", "incomplete")]);
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.upgradedExisting).toBe(true);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0]).toBe("sub_inc");
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("(c) active user keeps the existing behaviour: 400, no update, no session", async () => {
        const { update, sessionsCreate } = setupStripe([billableSub("sub_active", "active")]);
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.existingSubscription).toBe(true);
        expect(update).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("two fall-through subs: the survivor is upgraded in place, the other is left untouched, nothing is cancelled or created", async () => {
        const { update, cancel, sessionsCreate } = setupStripe([
            billableSub("sub_unpaid_new", "unpaid", { created: 200 }),
            billableSub("sub_pd_old", "past_due", { created: 100 }),
        ]);
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.upgradedExisting).toBe(true);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0]).toBe("sub_pd_old");
        expect(cancel).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("past_due sub set to cancel: checkout neither un-cancels it nor stacks a new subscription (400)", async () => {
        const { update, sessionsCreate } = setupStripe([
            billableSub("sub_pd_cx", "past_due", { cancel_at_period_end: true }),
        ]);
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.existingSubscription).toBe(true);
        expect(update).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("(e) no live subscription (only a canceled one): a normal new Checkout session is created", async () => {
        const { update, sessionsCreate } = setupStripe([
            { id: "sub_dead", status: "canceled", cancel_at_period_end: false, created: 50 },
        ]);
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.url).toBe("https://stripe/checkout");
        expect(sessionsCreate).toHaveBeenCalledTimes(1);
        expect(update).not.toHaveBeenCalled();
    });

    it("(f) trial upgrade whose card needs 3D Secure: returns the bank verification URL, no checkout session", async () => {
        const held = requiresActionSub("sub_trial", "past_due");
        const { update, sessionsCreate, piUpdate } = setupStripe(
            [billableSub("sub_trial", "trialing")],
            {
                updateImpl: async () => held,
                retrieveImpl: async () => held,
            },
        );
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.upgradedTrial).toBe(true);
        expect(body.requiresAction).toBe(true);
        expect(body.url).toBe("https://bank.example/3ds-fresh");
        expect((update.mock.calls[0][1] as any).payment_behavior).toBe("allow_incomplete");
        expect(piUpdate).toHaveBeenCalledTimes(1);
        expect((piUpdate.mock.calls[0][1] as any).return_url).toContain("billing=success");
        expect(refreshTierFromStripeForUid).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("(f) trial upgrade whose card is declined: 402 with the payment-method message", async () => {
        const held = requiresActionSub("sub_trial", "past_due", "requires_payment_method");
        const { sessionsCreate } = setupStripe([billableSub("sub_trial", "trialing")], {
            updateImpl: async () => held,
            retrieveImpl: async () => held,
        });
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(402);
        expect(body.paymentActionRequired).toBe(true);
        expect(body.error).toContain("Update your payment method");
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("(f) past_due conversion whose card needs 3D Secure: returns the bank verification URL", async () => {
        const held = requiresActionSub("sub_pd", "past_due");
        const { update, sessionsCreate } = setupStripe([billableSub("sub_pd", "past_due")], {
            updateImpl: async () => held,
            retrieveImpl: async () => held,
        });
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.upgradedExisting).toBe(true);
        expect(body.requiresAction).toBe(true);
        expect(body.url).toBe("https://bank.example/3ds-fresh");
        expect((update.mock.calls[0][1] as any).payment_behavior).toBe("allow_incomplete");
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("(f) trial upgrade already completed on re-read: returns the success URL, not the bank URL", async () => {
        const held = requiresActionSub("sub_trial", "past_due");
        const active = { ...held, status: "active" };
        const { sessionsCreate } = setupStripe([billableSub("sub_trial", "trialing")], {
            updateImpl: async () => held,
            retrieveImpl: async () => active,
        });
        const { POST } = await import("./route");
        const res: any = await POST(req());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.upgradedTrial).toBe(true);
        expect(body.requiresAction).toBeUndefined();
        expect(body.url).toContain("billing=success");
        expect(body.url).not.toContain("bank.example");
        expect(refreshTierFromStripeForUid).toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });
});
