// app/api/stripe/webhook/route.test.ts

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

const linkCustomerToUid = jest.fn<Promise<void>, [string, string]>(async () => {});
const setUserTierFromStripe = jest.fn<Promise<void>, [string, string, any]>(async () => {});
const mapPriceToTier = jest.fn<string, [string | null]>((priceId: string | null) =>
    priceId ? "pro" : "free",
);
const getUidForStripeCustomer = jest.fn<Promise<string | null>, [string]>(async () => "uid_1");

jest.mock("../../_lib/billing", () => {
    return {
        __esModule: true,
        getUidForStripeCustomer: (customerId: string) => getUidForStripeCustomer(customerId),
        linkCustomerToUid: (customerId: string, uid: string) => linkCustomerToUid(customerId, uid),
        mapPriceToTier: (priceId: string | null) => mapPriceToTier(priceId),
        setUserTierFromStripe: (uid: string, tier: string, stripeData: any) =>
            setUserTierFromStripe(uid, tier, stripeData),
    };
});

// Avoid firebase-admin init requiring FIREBASE_SERVICE_ACCOUNT
jest.mock("firebase-admin", () => {
    return {
        __esModule: true,
        default: {
            apps: [{}],
            firestore: () => ({
                collection: () => ({
                    doc: () => ({
                        get: async () => ({ exists: false }),
                        set: async () => {},
                    }),
                }),
            }),
        },
    };
});

describe("POST /api/stripe/webhook", () => {
    beforeEach(() => {
        jest.resetModules();
        linkCustomerToUid.mockClear();
        setUserTierFromStripe.mockClear();
        mapPriceToTier.mockClear();
        getUidForStripeCustomer.mockClear();

        process.env.STRIPE_WEBHOOK_SECRET_TEST = "whsec_test";
        process.env.STRIPE_WEBHOOK_SECRET_LIVE = "";
        process.env.STRIPE_SECRET_KEY_TEST = "sk_test_123";
        process.env.STRIPE_SECRET_KEY_LIVE = "";
        process.env.STRIPE_SECRET_KEY = "";
    });

    it("checkout.session.completed links customer to firebaseUid", async () => {
        const constructEvent = jest.fn(() => ({
            id: "evt_1",
            type: "checkout.session.completed",
            livemode: false,
            data: {
                object: {
                    metadata: { firebaseUid: "uid_abc" },
                    customer: "cus_abc",
                },
            },
        }));

        jest.doMock("stripe", () => {
            return {
                __esModule: true,
                default: function StripeCtor() {
                    return {
                        webhooks: { constructEvent },
                        invoices: { retrieve: async () => ({}) },
                    };
                },
            };
        });

        const { POST } = await import("./route");

        const req = {
            headers: {
                get: (k: string) => (k === "stripe-signature" ? "sig" : null),
            },
            text: async () => "{}",
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.received).toBe(true);
        expect(linkCustomerToUid).toHaveBeenCalledWith("cus_abc", "uid_abc");
    });

    it("customer.subscription.updated sets tier to paid tier when status is trialing", async () => {
        const constructEvent = jest.fn(() => ({
            id: "evt_2",
            type: "customer.subscription.updated",
            livemode: false,
            data: {
                object: {
                    id: "sub_1",
                    status: "trialing",
                    customer: "cus_1",
                    items: { data: [{ price: { id: "price_live_pro" } }] },
                    current_period_end: 123,
                    trial_end: 456,
                    cancel_at_period_end: false,
                },
            },
        }));

        jest.doMock("stripe", () => {
            return {
                __esModule: true,
                default: function StripeCtor() {
                    return {
                        webhooks: { constructEvent },
                        invoices: { retrieve: async () => ({}) },
                    };
                },
            };
        });

        mapPriceToTier.mockReturnValueOnce("pro");
        getUidForStripeCustomer.mockResolvedValueOnce("uid_1");

        const { POST } = await import("./route");

        const req = {
            headers: {
                get: (k: string) => (k === "stripe-signature" ? "sig" : null),
            },
            text: async () => "{}",
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.received).toBe(true);

        expect(setUserTierFromStripe).toHaveBeenCalledWith(
            "uid_1",
            "pro",
            expect.objectContaining({
                customerId: "cus_1",
                subscriptionId: "sub_1",
                priceId: "price_live_pro",
                status: "trialing",
            }),
        );
    });
});
