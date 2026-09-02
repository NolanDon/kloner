// app/api/billing/tier/route.test.ts

export {};

/*
  Tests for the critical production behavior:
  - if Firestore tier is still "free" but Stripe fields show active/trialing + sub id,
    the endpoint should force a Stripe refresh (self-heal).
*/

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

const refreshTierFromStripeForUid = jest.fn<Promise<string>, [string]>(async () => "pro");

jest.mock("../../_lib/billing", () => {
    return {
        __esModule: true,
        refreshTierFromStripeForUid: (uid: string) => refreshTierFromStripeForUid(uid),
    };
});

jest.mock("../../_lib/route-guard", () => {
    return {
        __esModule: true,
        requireSessionAndMaybeCsrf: async (_req: any, handler: any) => handler({ uid: "uid_1" }),
    };
});

jest.mock("../../_lib/auth", () => {
    return {
        __esModule: true,
        getAdminDb: () => {
            const admin = require("firebase-admin").default;
            return admin.firestore();
        },
    };
});

type Snap = { exists: boolean; data: () => any };

function snap(data: any): Snap {
    return {
        exists: true,
        data: () => ({ ...data }),
    };
}

describe("GET /api/billing/tier", () => {
    beforeEach(() => {
        refreshTierFromStripeForUid.mockClear();
        jest.resetModules();
    });

    it("self-heals when Stripe says trialing but tier is still free", async () => {
        const first = snap({
            tierSource: "stripe",
            tier: "free",
            stripeStatus: "trialing",
            stripeSubscriptionId: "sub_123",
        });
        const second = snap({
            tierSource: "stripe",
            tier: "pro",
            stripeStatus: "trialing",
            stripeSubscriptionId: "sub_123",
        });

        let getCount = 0;

        const adminMock: any = {
            apps: [{}],
            firestore: () => ({
                collection: () => ({
                    doc: () => ({
                        get: async () => {
                            getCount += 1;
                            return getCount === 1 ? first : second;
                        },
                        set: async () => {},
                    }),
                }),
            }),
        };

        jest.doMock("firebase-admin", () => ({ __esModule: true, default: adminMock }));

        const { GET } = await import("./route");
        const res: any = await GET({ url: "https://example.com/api/billing/tier" } as any);
        const body = await res.json();

        expect(refreshTierFromStripeForUid).toHaveBeenCalledTimes(1);
        expect(body.tier).toBe("pro");
    });

    it("refreshes Stripe even when the mirrored tier already says paid", async () => {
        const only = snap({
            tierSource: "stripe",
            tier: "pro",
            stripeStatus: "trialing",
            stripeSubscriptionId: "sub_123",
        });

        const adminMock: any = {
            apps: [{}],
            firestore: () => ({
                collection: () => ({
                    doc: () => ({
                        get: async () => only,
                        set: async () => {},
                    }),
                }),
            }),
        };

        jest.doMock("firebase-admin", () => ({ __esModule: true, default: adminMock }));

        const { GET } = await import("./route");
        const res: any = await GET({ url: "https://example.com/api/billing/tier" } as any);
        const body = await res.json();

        expect(refreshTierFromStripeForUid).toHaveBeenCalledTimes(1);
        expect(body.tier).toBe("pro");
    });

    it("self-heals credits.aiEdits when tier is pro but aiEdits is still free-tier", async () => {
        const stored = {
            tierSource: "stripe",
            tier: "pro",
            stripeStatus: "active",
            stripeSubscriptionId: "sub_123",
            stripeCurrentPeriodEnd: 1_700_000_000,
            credits: {
                preview: { monthlyLimit: 450, remaining: 450, periodEnd: new Date() },
                snapshot: { monthlyLimit: 100, remaining: 100, periodEnd: new Date() },
                aiEdits: { monthlyLimit: 15, remaining: 15, periodEnd: new Date() },
            },
        };

        const store = { ...stored } as any;
        let setCalls = 0;

        const adminMock: any = {
            apps: [{}],
            firestore: () => ({
                collection: () => ({
                    doc: () => ({
                        get: async () => snap(store),
                        set: async (data: any, _opts?: { merge?: boolean }) => {
                            setCalls += 1;
                            // emulate dot-path merge for the one field we care about
                            if (data && data["credits.aiEdits"]) {
                                store.credits = store.credits || {};
                                store.credits.aiEdits = { ...data["credits.aiEdits"] };
                            }
                        },
                    }),
                }),
            }),
        };

        jest.doMock("firebase-admin", () => ({ __esModule: true, default: adminMock }));

        const { GET } = await import("./route");
        const res: any = await GET({ url: "https://example.com/api/billing/tier" } as any);
        const body = await res.json();

        expect(refreshTierFromStripeForUid).toHaveBeenCalledTimes(1);
        expect(body.tier).toBe("pro");
        expect(setCalls).toBe(1);
        expect(store.credits.aiEdits.monthlyLimit).toBe(300);
        expect(store.credits.aiEdits.remaining).toBe(300);
    });

    it("ignores trial-cancel override once Stripe is active again", async () => {
        const only = snap({
            tierSource: "override",
            tier: "free",
            tierOverrideReason: "trial_cancelled",
            tierOverrideTier: "free",
            tierOverrideUntil: new Date(Date.now() + 86_400_000),
            stripeStatus: "active",
            stripeCancelAtPeriodEnd: false,
            stripeSubscriptionId: "sub_123",
        });

        const adminMock: any = {
            apps: [{}],
            firestore: () => ({
                collection: () => ({
                    doc: () => ({
                        get: async () => only,
                        set: async () => {},
                    }),
                }),
            }),
        };

        jest.doMock("firebase-admin", () => ({ __esModule: true, default: adminMock }));

        const { GET } = await import("./route");
        const res: any = await GET({ url: "https://example.com/api/billing/tier" } as any);
        const body = await res.json();

        expect(refreshTierFromStripeForUid).toHaveBeenCalledTimes(1);
        expect(body.tier).toBe("pro");
    });

    it("refresh=1 forces refresh", async () => {
        const first = snap({
            tierSource: "stripe",
            tier: "free",
            stripeStatus: "canceled",
            stripeSubscriptionId: "sub_123",
        });
        const second = snap({
            tierSource: "stripe",
            tier: "pro",
            stripeStatus: "trialing",
            stripeSubscriptionId: "sub_123",
        });

        let getCount = 0;

        const adminMock: any = {
            apps: [{}],
            firestore: () => ({
                collection: () => ({
                    doc: () => ({
                        get: async () => {
                            getCount += 1;
                            return getCount === 1 ? first : second;
                        },
                        set: async () => {},
                    }),
                }),
            }),
        };

        jest.doMock("firebase-admin", () => ({ __esModule: true, default: adminMock }));

        const { GET } = await import("./route");
        const res: any = await GET({ url: "https://example.com/api/billing/tier?refresh=1" } as any);
        const body = await res.json();

        expect(refreshTierFromStripeForUid).toHaveBeenCalledTimes(1);
        expect(body.tier).toBe("pro");
    });
});
