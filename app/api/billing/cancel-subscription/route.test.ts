// app/api/billing/cancel-subscription/route.test.ts

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
        requireSessionAndMaybeCsrf: async (_req: any, handler: any) => handler({ uid: "uid_1" }),
    };
});

jest.mock("../../_lib/billing", () => ({
    __esModule: true,
    getSubscriptionIdForUid: jest.fn(async () => "sub_1"),
}));

function createFirestoreMock() {
    const store = new Map<string, any>();

    const db = {
        collection: (name: string) => ({
            doc: (id: string) => {
                const key = `${name}/${id}`;
                return {
                    set: async (data: any, opts?: { merge?: boolean }) => {
                        const prev = store.get(key) ?? {};
                        store.set(key, opts?.merge ? { ...prev, ...data } : { ...data });
                    },
                    get: async () => {
                        const data = store.get(key);
                        return { exists: !!data, data: () => (data ? { ...data } : undefined) };
                    },
                };
            },
        }),
    };

    return { db, store };
}

describe("POST /api/billing/cancel-subscription", () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it("returns 400 when no subscription is linked", async () => {
        jest.doMock("../../_lib/billing", () => ({
            __esModule: true,
            getSubscriptionIdForUid: jest.fn(async () => null),
        }));

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
            },
        }));

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({ subscriptions: { update: async () => ({}) } }),
        }));

        const { POST } = await import("./route");
        const req = { json: async () => ({ atPeriodEnd: true }) } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.ok).toBe(false);
        expect(typeof body.error).toBe("string");
    });

    it("updates Stripe cancel_at_period_end and mirrors fields onto kloner_users", async () => {
        jest.doMock("../../_lib/billing", () => ({
            __esModule: true,
            getSubscriptionIdForUid: jest.fn(async () => "sub_1"),
        }));
        const { db, store } = createFirestoreMock();

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
                auth: () => ({
                    getUser: async () => ({ email: "user@example.com", displayName: "Test User" }),
                }),
            },
        }));

        jest.doMock("@/lib/observability", () => ({
            __esModule: true,
            captureCriticalEvent: jest.fn(async () => {}),
            captureException: jest.fn(async () => {}),
            captureAuditEvent: jest.fn(async () => {}),
        }));

        jest.doMock("resend", () => ({
            __esModule: true,
            Resend: jest.fn().mockImplementation(() => ({
                emails: { send: jest.fn(async () => ({ id: "email_1" })) },
            })),
        }));

        const updateMock = jest.fn(async () => ({
            id: "sub_1",
            cancel_at_period_end: true,
            current_period_end: 123,
            trial_end: 456,
            status: "trialing",
        }));

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({ subscriptions: { update: updateMock } }),
        }));

        const { POST } = await import("./route");
        const req = { json: async () => ({ atPeriodEnd: true, cancellationReason: "pricing" }) } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.subscriptionId).toBe("sub_1");
        expect(body.cancelAtPeriodEnd).toBe(true);
        expect(body.currentPeriodEnd).toBe(123);
        expect(body.trialEnd).toBe(456);
        expect(body.status).toBe("trialing");

        expect(updateMock).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });

        const userDoc = store.get("kloner_users/uid_1") || {};
        expect(userDoc.stripeSubscriptionId).toBe("sub_1");
        expect(userDoc.stripeCancelAtPeriodEnd).toBe(true);
        expect(userDoc.stripeCurrentPeriodEnd).toBe(123);
        expect(userDoc.stripeTrialEnd).toBe(456);
        expect(userDoc.stripeStatus).toBe("trialing");

        // Fraud prevention: cancel during trial immediately downgrades tier + sets override.
        expect(userDoc.tier).toBe("free");
        expect(userDoc.tierSource).toBe("override");
        expect(userDoc.tierOverrideTier).toBe("free");
        expect(userDoc.tierOverrideUntil).toBeTruthy();
    });

    it("rejects a second retention-offer attempt for the same account", async () => {
        const previousCoupon = process.env.STRIPE_RETENTION_COUPON_TEST;
        process.env.STRIPE_RETENTION_COUPON_TEST = "coupon_40_once";

        try {
            const { db, store } = createFirestoreMock();

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
                },
            }));

            const updateMock = jest.fn(async () => ({
                id: "sub_1",
                cancel_at_period_end: false,
                current_period_end: 123,
                trial_end: null,
                status: "active",
            }));

            jest.doMock("@/lib/stripe", () => ({
                __esModule: true,
                getStripe: () => ({
                    coupons: {
                        retrieve: jest.fn(async () => ({ percent_off: 40, duration: "once" })),
                    },
                    subscriptions: {
                        retrieve: jest.fn(async () => ({ id: "sub_1", discounts: [], metadata: {} })),
                        update: updateMock,
                    },
                }),
            }));

            const { POST } = await import("./route");
            const request = () => ({
                json: async () => ({
                    atPeriodEnd: false,
                    cancellationReason: "pricing",
                    retentionOffer: true,
                }),
            }) as any;

            const first = await POST(request());
            expect(first.status).toBe(200);
            expect(updateMock).toHaveBeenCalledTimes(1);
            expect(updateMock).toHaveBeenCalledWith(
                "sub_1",
                expect.objectContaining({
                    cancel_at_period_end: false,
                    discounts: [{ coupon: "coupon_40_once" }],
                }),
            );
            expect(updateMock.mock.calls[0][1]).not.toHaveProperty("cancel_at");
            expect(store.get("kloner_users/uid_1")?.billingRetentionOfferUsedAt).toBeTruthy();

            const second = await POST(request());
            const secondBody = await (second as any).json();
            expect(second.status).toBe(409);
            expect(secondBody.error).toMatch(/already been used/i);
            expect(updateMock).toHaveBeenCalledTimes(1);
        } finally {
            if (previousCoupon === undefined) delete process.env.STRIPE_RETENTION_COUPON_TEST;
            else process.env.STRIPE_RETENTION_COUPON_TEST = previousCoupon;
        }
    });
});
