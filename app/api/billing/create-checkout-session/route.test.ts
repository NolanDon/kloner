// app/api/billing/create-checkout-session/route.test.ts

export {};

jest.mock("next/server", () => {
    return {
        __esModule: true,
        NextResponse: {
            json: (body: any, init?: { status?: number }) => {
                return {
                    status: init?.status ?? 200,
                    async json() {
                        return body;
                    },
                };
            },
        },
    };
});

jest.mock("../../_lib/route-guard", () => {
    return {
        __esModule: true,
        requireSessionAndMaybeCsrf: async (req: any, handler: any) => handler({ req, uid: "uid_1" }),
    };
});

const linkCustomerToUid = jest.fn<Promise<void>, [string, string]>(async () => {});

jest.mock("../../_lib/billing", () => {
    return {
        __esModule: true,
        linkCustomerToUid: (customerId: string, uid: string) => linkCustomerToUid(customerId, uid),
    };
});

function createFirestoreMock(initialUser?: Record<string, any>) {
    const store = new Map<string, Record<string, any>>();
    if (initialUser) store.set("kloner_users/uid_1", { ...initialUser });

    const db = {
        collection: (name: string) => ({
            doc: (id: string) => {
                const key = `${name}/${id}`;
                return {
                    get: async () => {
                        const data = store.get(key);
                        return {
                            exists: !!data,
                            data: () => (data ? { ...data } : undefined),
                        };
                    },
                    set: async (data: any, opts?: { merge?: boolean }) => {
                        const prev = store.get(key) ?? {};
                        store.set(key, opts?.merge ? { ...prev, ...data } : { ...data });
                    },
                };
            },
        }),
    };

    return { db, store };
}

describe("POST /api/billing/create-checkout-session", () => {
    const OLD_ENV = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV } as any;
        linkCustomerToUid.mockClear();
    });

    afterAll(() => {
        process.env = OLD_ENV;
    });

    it("uses STRIPE_PRICE_PRO_PROD for pro in production and builds success_url with wizard params", async () => {
        (process.env as any).NODE_ENV = "production";
        process.env.NEXT_PUBLIC_APP_ORIGIN = "https://kloner.app";
        process.env.STRIPE_PRICE_PRO_PROD = "price_live_pro";

        const { db } = createFirestoreMock({ stripeCustomerId: "cus_1" });

        jest.doMock("firebase-admin", () => ({
            __esModule: true,
            default: {
                apps: [{}],
                firestore: () => db,
                auth: () => ({ getUser: async () => ({ email: "a@b.com" }) }),
            },
        }));

        const sessionsCreate = jest.fn<Promise<{ url: string }>, [any]>(
            async (_payload: any) => ({ url: "https://stripe/checkout" }),
        );

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                subscriptions: {
                    list: async () => ({ data: [] }),
                },
                customers: {
                    create: async () => ({ id: "cus_1" }),
                    update: async () => ({}),
                },
                promotionCodes: {
                    list: async () => ({ data: [] }),
                },
                checkout: {
                    sessions: {
                        create: sessionsCreate,
                    },
                },
            }),
        }));

        const { POST } = await import("./route");

        const req = {
            url: "https://example.com/api/billing/create-checkout-session",
            json: async () => ({
                plan: "pro",
                returnRenderId: "rid_1",
                returnStep: 2,
            }),
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.url).toBe("https://stripe/checkout");

        expect(sessionsCreate).toHaveBeenCalledTimes(1);
        const payload = sessionsCreate.mock.calls[0]?.[0];
        expect(payload).toBeTruthy();

        expect(payload.line_items?.[0]?.price).toBe("price_live_pro");
        expect(payload.success_url).toContain("/dashboard/view?");
        expect(payload.success_url).toContain("wizard=1");
        expect(payload.success_url).toContain("render=rid_1");
        expect(payload.success_url).toContain("step=2");
        expect(payload.success_url).toContain("billing=success");

        // Pro includes a trial by default.
        expect(payload.subscription_data?.trial_period_days).toBe(7);
    });

    it("does not include a free trial for agency", async () => {
        (process.env as any).NODE_ENV = "production";
        process.env.NEXT_PUBLIC_APP_ORIGIN = "https://kloner.app";
        process.env.STRIPE_PRICE_PRO_AGENCY = "price_live_agency";

        const { db } = createFirestoreMock({ stripeCustomerId: "cus_1" });

        jest.doMock("firebase-admin", () => ({
            __esModule: true,
            default: {
                apps: [{}],
                firestore: () => db,
                auth: () => ({ getUser: async () => ({ email: "a@b.com" }) }),
            },
        }));

        const sessionsCreate = jest.fn<Promise<{ url: string }>, [any]>(async (_payload: any) => ({
            url: "https://stripe/checkout",
        }));

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                subscriptions: {
                    list: async () => ({ data: [] }),
                },
                customers: {
                    create: async () => ({ id: "cus_1" }),
                    update: async () => ({}),
                },
                promotionCodes: {
                    list: async () => ({ data: [] }),
                },
                checkout: {
                    sessions: {
                        create: sessionsCreate,
                    },
                },
            }),
        }));

        const { POST } = await import("./route");

        const req = {
            url: "https://example.com/api/billing/create-checkout-session",
            json: async () => ({ plan: "agency" }),
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.url).toBe("https://stripe/checkout");

        expect(sessionsCreate).toHaveBeenCalledTimes(1);
        const payload = sessionsCreate.mock.calls[0]?.[0];

        expect(payload.line_items?.[0]?.price).toBe("price_live_agency");
        expect(payload.subscription_data?.trial_period_days).toBeUndefined();
    });

    it("blocks duplicate checkout if customer already has active/trialing subscription", async () => {
        (process.env as any).NODE_ENV = "production";
        process.env.NEXT_PUBLIC_APP_ORIGIN = "https://kloner.app";
        process.env.STRIPE_PRICE_PRO_PROD = "price_live_pro";

        const { db } = createFirestoreMock({ stripeCustomerId: "cus_1" });

        jest.doMock("firebase-admin", () => ({
            __esModule: true,
            default: {
                apps: [{}],
                firestore: () => db,
                auth: () => ({ getUser: async () => ({ email: "a@b.com" }) }),
            },
        }));

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                subscriptions: {
                    list: async () => ({ data: [{ status: "trialing" }] }),
                },
                customers: {
                    create: async () => ({ id: "cus_1" }),
                    update: async () => ({}),
                },
                promotionCodes: {
                    list: async () => ({ data: [] }),
                },
                checkout: {
                    sessions: {
                        create: async () => ({ url: "https://stripe/checkout" }),
                    },
                },
            }),
        }));

        const { POST } = await import("./route");

        const req = {
            url: "https://example.com/api/billing/create-checkout-session",
            json: async () => ({ plan: "pro" }),
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.existingSubscription).toBe(true);
        expect(typeof body.error).toBe("string");
    });

    it("creates customer when none exists, links customer->uid, and writes stripeCustomerId to Firestore", async () => {
        (process.env as any).NODE_ENV = "test";
        process.env.NEXT_PUBLIC_APP_ORIGIN = "http://localhost:3000";
        process.env.STRIPE_PRICE_PRO_TEST = "price_test_pro";

        const { db, store } = createFirestoreMock({});

        jest.doMock("firebase-admin", () => ({
            __esModule: true,
            default: {
                apps: [{}],
                firestore: () => db,
                auth: () => ({ getUser: async () => ({ email: "user@example.com" }) }),
            },
        }));

        const customersCreate = jest.fn(async () => ({ id: "cus_new" }));

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                subscriptions: {
                    list: async () => ({ data: [] }),
                },
                customers: {
                    create: customersCreate,
                    update: async () => ({}),
                },
                promotionCodes: {
                    list: async () => ({ data: [] }),
                },
                checkout: {
                    sessions: {
                        create: async () => ({ url: "https://stripe/checkout" }),
                    },
                },
            }),
        }));

        const { POST } = await import("./route");

        const req = {
            url: "https://example.com/api/billing/create-checkout-session",
            json: async () => ({ plan: "pro" }),
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.url).toBe("https://stripe/checkout");

        expect(customersCreate).toHaveBeenCalledTimes(1);
        expect(linkCustomerToUid).toHaveBeenCalledWith("cus_new", "uid_1");

        const userDoc = store.get("kloner_users/uid_1") || {};
        expect(userDoc.stripeCustomerId).toBe("cus_new");
    });

    it("applies exit-offer discount using promo id and omits allow_promotion_codes", async () => {
        (process.env as any).NODE_ENV = "production";
        process.env.NEXT_PUBLIC_APP_ORIGIN = "https://kloner.app";
        process.env.STRIPE_PRICE_PRO_PROD = "price_live_pro";
        process.env.STRIPE_EXIT40_PROMO_PROD = "promo_123";

        const { db } = createFirestoreMock({ stripeCustomerId: "cus_1" });

        jest.doMock("firebase-admin", () => ({
            __esModule: true,
            default: {
                apps: [{}],
                firestore: () => db,
                auth: () => ({ getUser: async () => ({ email: "a@b.com" }) }),
            },
        }));

        const sessionsCreate = jest.fn<Promise<{ url: string }>, [any]>(
            async (_payload: any) => ({ url: "https://stripe/checkout" }),
        );

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                subscriptions: {
                    list: async () => ({ data: [] }),
                },
                customers: {
                    create: async () => ({ id: "cus_1" }),
                    update: async () => ({}),
                },
                promotionCodes: {
                    list: async () => ({ data: [] }),
                },
                checkout: {
                    sessions: {
                        create: sessionsCreate,
                    },
                },
            }),
        }));

        const { POST } = await import("./route");

        const req = {
            url: "https://example.com/api/billing/create-checkout-session",
            json: async () => ({
                plan: "pro",
                offer: "exit40",
                offerEndsAt: Date.now() + 5_000,
                offerPromoCode: "DEPLOY40",
                offerReason: "close",
            }),
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.url).toBe("https://stripe/checkout");

        const payload = sessionsCreate.mock.calls[0]?.[0];
        expect(payload).toBeTruthy();
        expect(payload.discounts).toEqual([{ promotion_code: "promo_123" }]);
        expect(payload.allow_promotion_codes).toBeUndefined();
        expect(payload.metadata.exitOffer).toBe("exit40");
        expect(payload.subscription_data?.metadata?.exitOffer).toBe("exit40");
    });
});
