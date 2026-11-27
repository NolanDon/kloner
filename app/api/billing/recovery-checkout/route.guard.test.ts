// app/api/billing/recovery-checkout/route.guard.test.ts
//
// Narrowed single-subscription guard for the recovery (exit-offer)
// checkout: a customer whose live subscription is past_due / unpaid /
// incomplete must be converted in place, never handed a second
// subscription via a new Checkout session. Active / trialing behaviour is
// unchanged from the original route. Uses the REAL
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
        redirect: (url: string, status?: number) => ({
            status: status ?? 302,
            url,
            headers: new Headers({ location: url }),
        }),
    },
}));

jest.mock("@/app/api/private/email-links", () => ({
    __esModule: true,
    verifySignedToken: () => ({ uid: "uid_1", k: "exit40" }),
}));

jest.mock("@/app/api/_lib/billing", () => ({
    __esModule: true,
    linkCustomerToUid: jest.fn(async () => {}),
}));

jest.mock("@/app/api/_lib/monthlyPrice", () => ({
    __esModule: true,
    resolveMonthlyPriceId: () => "price_pro_123",
}));

jest.mock("@/app/api/_lib/earlyGenerationGate", () => ({
    __esModule: true,
    shouldRequireEarlyGenerationPaywall: () => ({ required: false }),
}));

jest.mock("@/app/api/_lib/freeTrial", () => ({
    __esModule: true,
    hasPriorSubscriptionHistoryForAccount: async () => true,
}));

jest.mock("@/src/lib/billingAccess", () => ({
    __esModule: true,
    STRIPE_TRIAL_DAYS: 7,
}));

function setup(
    subs: any[],
    opts?: {
        updateImpl?: (id: string, payload: any, options?: any) => Promise<any>;
        retrieveImpl?: (id: string, params?: any) => Promise<any>;
    },
) {
    const db = {
        collection: (name: string) => ({
            doc: (id: string) => ({
                get: async () => ({
                    exists: true,
                    data: () => ({ stripeCustomerId: "cus_1", stripeCustomerIdTest: "cus_1" }),
                }),
                set: async () => {},
            }),
        }),
    };
    jest.doMock("@/app/api/_lib/auth", () => ({
        __esModule: true,
        getAdminDb: () => db,
        getAdminAuth: () => ({ getUser: async () => ({ email: "user@example.com" }) }),
    }));

    const update = jest.fn(async (id: string, payload: any) => {
        if (opts?.updateImpl) return opts.updateImpl(id, payload);
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
    const piRetrieve = jest.fn(async (id: string) => ({
        id,
        status: "requires_action",
        next_action: {
            type: "redirect_to_url",
            redirect_to_url: { url: "https://bank.example/3ds-fresh" },
        },
    }));
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
                create: async () => ({ id: "cus_1" }),
                retrieve: async () => ({ id: "cus_1" }),
            },
            promotionCodes: { list: async () => ({ data: [{ id: "promo_1" }] }) },
            checkout: { sessions: { create: sessionsCreate } },
        }),
    }));
    return { update, cancel, sessionsCreate, retrieve, piUpdate, piRetrieve };
}

const billableSub = (id: string, status: string, extra?: Record<string, any>) => ({
    id,
    status,
    cancel_at_period_end: false,
    created: 100,
    items: { data: [{ id: `si_${id}`, price: { id: "price_old" } }] },
    ...extra,
});

describe("GET /api/billing/recovery-checkout (narrowed guard)", () => {
    beforeEach(() => {
        jest.resetModules();
    });

    const req = () => ({ url: "https://kloner.app/api/billing/recovery-checkout?t=token" }) as any;

    it("(d) past_due customer is converted in place (recovery discount carried); no new Checkout session", async () => {
        const { update, cancel, sessionsCreate } = setup([billableSub("sub_pd", "past_due")]);
        const { GET } = await import("./route");
        const res: any = await GET(req());

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toContain("billing=success&recovery=1");
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0]).toBe("sub_pd");
        expect((update.mock.calls[0][1] as any).items).toEqual([
            { id: "si_sub_pd", price: "price_pro_123" },
        ]);
        expect((update.mock.calls[0][1] as any).discounts).toEqual([
            { promotion_code: "promo_1" },
        ]);
        expect(sessionsCreate).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
    });

    it("(d) incomplete customer is converted in place; no new Checkout session", async () => {
        const { update, sessionsCreate } = setup([billableSub("sub_inc", "incomplete")]);
        const { GET } = await import("./route");
        const res: any = await GET(req());

        expect(res.status).toBe(302);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0]).toBe("sub_inc");
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("two fall-through subs: the survivor is converted in place, the other is left untouched, nothing is cancelled or created", async () => {
        const { update, cancel, sessionsCreate } = setup([
            billableSub("sub_unpaid_new", "unpaid", { created: 200 }),
            billableSub("sub_pd_old", "past_due", { created: 100 }),
        ]);
        const { GET } = await import("./route");
        const res: any = await GET(req());

        expect(res.status).toBe(302);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0]).toBe("sub_pd_old");
        expect(cancel).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("active customer keeps the existing behaviour: 400, no update, no session", async () => {
        const { update, sessionsCreate } = setup([billableSub("sub_active", "active")]);
        const { GET } = await import("./route");
        const res: any = await GET(req());
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.ok).toBe(false);
        expect(update).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("past_due sub set to cancel: recovery neither un-cancels it nor stacks a new subscription (400)", async () => {
        const { update, sessionsCreate } = setup([
            billableSub("sub_pd_cx", "past_due", { cancel_at_period_end: true }),
        ]);
        const { GET } = await import("./route");
        const res: any = await GET(req());

        expect(res.status).toBe(400);
        expect(update).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("(e) no live subscription (only a canceled one): a normal new Checkout session is created", async () => {
        const { update, sessionsCreate } = setup([
            { id: "sub_dead", status: "canceled", cancel_at_period_end: false, created: 50 },
        ]);
        const { GET } = await import("./route");
        const res: any = await GET(req());

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://stripe/checkout");
        expect(sessionsCreate).toHaveBeenCalledTimes(1);
        expect(update).not.toHaveBeenCalled();
    });

    it("(f) past_due conversion whose card needs 3D Secure: redirects to the bank verification URL", async () => {
        const held = {
            id: "sub_pd",
            status: "past_due",
            cancel_at_period_end: false,
            created: 100,
            items: { data: [{ id: "si_sub_pd", price: { id: "price_old" } }] },
            latest_invoice: {
                id: "in_1",
                hosted_invoice_url: "https://invoice.stripe.com/pay/hosted",
                payment_intent: {
                    id: "pi_1",
                    status: "requires_action",
                    next_action: {
                        type: "redirect_to_url",
                        redirect_to_url: { url: "https://bank.example/3ds" },
                    },
                },
            },
        };
        const { update, sessionsCreate, piUpdate } = setup([billableSub("sub_pd", "past_due")], {
            updateImpl: async () => held,
            retrieveImpl: async () => held,
        });
        const { GET } = await import("./route");
        const res: any = await GET(req());

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://bank.example/3ds-fresh");
        expect((update.mock.calls[0][1] as any).payment_behavior).toBe("allow_incomplete");
        expect(piUpdate).toHaveBeenCalledTimes(1);
        expect((piUpdate.mock.calls[0][1] as any).return_url).toContain("billing=success&recovery=1");
        expect(sessionsCreate).not.toHaveBeenCalled();
    });
});
