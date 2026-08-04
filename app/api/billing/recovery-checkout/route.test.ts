export {};

const store = new Map<string, Record<string, any>>();
const sessionsCreate = jest.fn();
const promotionCodesList = jest.fn();

jest.mock("next/server", () => {
    return {
        __esModule: true,
        NextResponse: {
            json: (body: any, init?: { status?: number }) => ({
                status: init?.status ?? 200,
                headers: new Headers(),
                async json() {
                    return body;
                },
            }),
            redirect: (url: string, status = 302) =>
                new Response(null, {
                    status,
                    headers: { Location: url },
                }),
        },
    };
});

jest.mock("@/app/api/_lib/auth", () => ({
    __esModule: true,
    getAdminDb: () => ({
        collection: (name: string) => ({
            doc: (id: string) => {
                const key = `${name}/${id}`;
                return {
                    id,
                    _collection: name,
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
    }),
    getAdminAuth: () => ({
        getUser: async (uid: string) => ({
            uid,
            email: `${uid}@example.com`,
            displayName: "Nolan",
        }),
    }),
}));

jest.mock("@/app/api/_lib/billing", () => ({
    __esModule: true,
    linkCustomerToUid: async () => {},
}));

jest.mock("@/lib/stripe", () => ({
    __esModule: true,
    getStripe: () => ({
        customers: {
            create: async () => ({ id: "cus_new" }),
        },
        subscriptions: {
            list: async () => ({ data: [] }),
        },
        promotionCodes: {
            list: (...args: any[]) => promotionCodesList(...args),
        },
        checkout: {
            sessions: {
                create: (...args: any[]) => sessionsCreate(...args),
            },
        },
    }),
}));

describe("GET /api/billing/recovery-checkout", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        store.clear();
        process.env.EMAIL_LINK_SECRET = "test-secret";
        (process.env as any).NODE_ENV = "production";
        process.env.STRIPE_PRICE_BASIC_PROD = "price_basic_live";
        process.env.STRIPE_PRICE_PRO_PROD = "price_pro_live";
        process.env.STRIPE_EXIT40_PROMO_PROD = "";
        process.env.STRIPE_EXIT40_COUPON_PROD = "";
        promotionCodesList.mockResolvedValue({ data: [{ id: "promo_123" }] });
        sessionsCreate.mockResolvedValue({ url: "https://stripe/checkout" });
    });

    it("creates a discounted recovery checkout session from a signed link", async () => {
        const { makeRecoveryCheckoutUrl } = await import("../../private/email-links");
        store.set("kloner_users/uid_abc", { stripeCustomerId: "cus_abc" });

        const { GET } = await import("./route");
        const url = new URL(makeRecoveryCheckoutUrl({ uid: "uid_abc", kind: "exit40" }));

        const res = await GET(new Request(url.toString()) as any);

        expect(res.status).toBe(302);
        expect(sessionsCreate).toHaveBeenCalledTimes(1);
        const payload = sessionsCreate.mock.calls[0][0];
        expect(payload.customer).toBe("cus_abc");
        expect(payload.line_items?.[0]?.price).toBe("price_basic_live");
        expect(payload.discounts?.[0]?.promotion_code).toBe("promo_123");
        expect(payload.cancel_url).toContain("/dashboard/view");
        expect(payload.subscription_data?.trial_period_days).toBe(7);
        expect(payload.subscription_data?.metadata?.checkoutFlow).toBe("recovery_exit40");
        expect(res.headers.get("Location")).toBe("https://stripe/checkout");
    });
});
