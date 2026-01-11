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

    it("does not refresh when tierSource=stripe and tier already paid", async () => {
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
                    }),
                }),
            }),
        };

        jest.doMock("firebase-admin", () => ({ __esModule: true, default: adminMock }));

        const { GET } = await import("./route");
        const res: any = await GET({ url: "https://example.com/api/billing/tier" } as any);
        const body = await res.json();

        expect(refreshTierFromStripeForUid).toHaveBeenCalledTimes(0);
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
