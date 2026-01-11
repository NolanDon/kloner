// app/api/_lib/billing.test.ts

export {};

/*
  These tests intentionally mock Stripe + firebase-admin.
  They verify that production env var names (STRIPE_PRICE_PRO_PROD)
  and Stripe statuses (trialing) correctly grant Pro/Agency.
*/

type FirestoreDoc = Record<string, any>;

function createFirestoreMock(initialDocs: Record<string, FirestoreDoc>) {
    const docs = new Map<string, FirestoreDoc>(Object.entries(initialDocs));

    function docKey(path: string[]) {
        return path.join("/");
    }

    function makeDocRef(path: string[]) {
        const key = docKey(path);
        return {
            async get() {
                const data = docs.get(key);
                return {
                    exists: !!data,
                    data: () => (data ? { ...data } : undefined),
                    get: (field: string) => (data ? data[field] : undefined),
                };
            },
            async set(update: any, opts?: { merge?: boolean }) {
                const prev = docs.get(key) ?? {};
                const next = opts?.merge ? { ...prev, ...update } : { ...update };
                docs.set(key, next);
            },
        };
    }

    const db = {
        collection(name: string) {
            return {
                doc(id: string) {
                    return makeDocRef([name, id]);
                },
            };
        },
    };

    return { db, docs };
}

function installFirebaseAdminMock(db: any) {
    const firestoreFn: any = () => db;
    firestoreFn.FieldValue = {
        serverTimestamp: () => ({ __type: "serverTimestamp" }),
    };
    firestoreFn.Timestamp = {
        fromDate: (d: Date) => ({ __type: "timestamp", date: d }),
    };

    jest.doMock("firebase-admin", () => {
        return {
            __esModule: true,
            default: {
                apps: [{}],
                initializeApp: jest.fn(),
                credential: { cert: jest.fn() },
                firestore: firestoreFn,
                auth: () => ({
                    getUser: async () => ({ customClaims: {} }),
                    setCustomUserClaims: async () => {},
                }),
            },
        };
    });
}

describe("billing tier logic", () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.STRIPE_PRICE_PRO_TEST;
        delete process.env.STRIPE_PRICE_PRO_PROD;
        delete process.env.STRIPE_PRICE_PRO_PRO;
        delete process.env.STRIPE_PRICE_AGENCY_TEST;
        delete process.env.STRIPE_PRICE_PRO_AGENCY;
    });

    it("mapPriceToTier: uses STRIPE_PRICE_PRO_PROD for production pro", async () => {
        const { db } = createFirestoreMock({});
        installFirebaseAdminMock(db);

        // Stripe isn't needed for mapPriceToTier, but billing.ts imports it at module load.
        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({ subscriptions: { list: async () => ({ data: [] }) } }),
        }));

        process.env.STRIPE_PRICE_PRO_PROD = "price_live_pro";
        process.env.STRIPE_PRICE_PRO_TEST = "price_test_pro";

        const mod = await import("./billing");
        expect(mod.mapPriceToTier("price_live_pro")).toBe("pro");
        expect(mod.mapPriceToTier("price_test_pro")).toBe("pro");
    });

    it("refreshTierFromStripeForUid: chooses active over trialing and returns effectiveTier", async () => {
        const { db, docs } = createFirestoreMock({
            "kloner_users/uid_1": {
                stripeCustomerId: "cus_1",
                tier: "free",
                tierSource: "stripe",
            },
        });
        installFirebaseAdminMock(db);

        process.env.STRIPE_PRICE_PRO_PROD = "price_live_pro";
        process.env.STRIPE_PRICE_PRO_AGENCY = "price_live_agency";

        const listMock = jest.fn(async () => ({
            data: [
                {
                    id: "sub_trial_newer",
                    status: "trialing",
                    created: 200,
                    items: { data: [{ price: { id: "price_live_agency" } }] },
                    current_period_end: 999,
                    trial_end: 111,
                    cancel_at_period_end: false,
                },
                {
                    id: "sub_active_older",
                    status: "active",
                    created: 100,
                    items: { data: [{ price: { id: "price_live_pro" } }] },
                    current_period_end: 888,
                    trial_end: null,
                    cancel_at_period_end: false,
                },
            ],
        }));

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                subscriptions: {
                    list: listMock,
                },
            }),
        }));

        const mod = await import("./billing");

        const tier = await mod.refreshTierFromStripeForUid("uid_1");
        expect(tier).toBe("pro");

        const stored = docs.get("kloner_users/uid_1") || {};
        expect(stored.tier).toBe("pro");
        expect(stored.tierSource).toBe("stripe");
        expect(stored.stripeCustomerId).toBe("cus_1");
        expect(stored.stripeSubscriptionId).toBe("sub_active_older");
        expect(stored.stripeStatus).toBe("active");

        expect(listMock).toHaveBeenCalledWith(
            expect.objectContaining({ customer: "cus_1", status: "all", limit: 10 }),
        );
    });

    it("refreshTierFromStripeForUid: downgrades to free when status is canceled even if price is pro", async () => {
        const { db, docs } = createFirestoreMock({
            "kloner_users/uid_2": {
                stripeCustomerId: "cus_2",
                tier: "pro",
                tierSource: "stripe",
            },
        });
        installFirebaseAdminMock(db);

        process.env.STRIPE_PRICE_PRO_PROD = "price_live_pro";

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                subscriptions: {
                    list: async () => ({
                        data: [
                            {
                                id: "sub_canceled",
                                status: "canceled",
                                created: 123,
                                items: { data: [{ price: { id: "price_live_pro" } }] },
                                current_period_end: 888,
                                trial_end: null,
                                cancel_at_period_end: true,
                            },
                        ],
                    }),
                },
            }),
        }));

        const mod = await import("./billing");
        const tier = await mod.refreshTierFromStripeForUid("uid_2");
        expect(tier).toBe("free");

        const stored = docs.get("kloner_users/uid_2") || {};
        expect(stored.tier).toBe("free");
        expect(stored.stripeStatus).toBe("canceled");
        expect(stored.stripeSubscriptionId).toBe("sub_canceled");
    });
});
