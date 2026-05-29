import { jest } from "@jest/globals";

describe("POST /api/billing/confirm-credit-topup", () => {
    const OLD_ENV = { ...process.env };

    type DocEntry = { exists: boolean; data: Record<string, any> };

    function makeStore() {
        const store = new Map<string, DocEntry>();
        return {
            get(path: string): DocEntry {
                const hit = store.get(path);
                if (hit) return { exists: hit.exists, data: { ...hit.data } };
                return { exists: false, data: {} };
            },
            set(path: string, value: Record<string, any>, merge?: boolean) {
                const existing = store.get(path);
                if (merge) {
                    store.set(path, {
                        exists: true,
                        data: {
                            ...(existing?.data || {}),
                            ...value,
                        },
                    });
                    return;
                }
                store.set(path, { exists: true, data: { ...value } });
            },
            seed(path: string, value: Record<string, any>) {
                store.set(path, { exists: true, data: { ...value } });
            },
            dump(path: string) {
                return store.get(path);
            },
        };
    }

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV } as any;
    });

    afterAll(() => {
        process.env = OLD_ENV;
    });

    it("applies paid top-up once and updates remaining + bonusRemaining", async () => {
        const store = makeStore();
        store.seed("kloner_users/uid_1", {
            stripeCustomerId: "cus_1",
            "credits.aiEdits": {
                monthlyLimit: 300,
                remaining: 120,
                bonusRemaining: 20,
            },
        });

        const runTransaction = async (fn: (tx: any) => Promise<void>) => {
            const tx = {
                async get(ref: any) {
                    const snap = store.get(ref.__path);
                    return {
                        exists: snap.exists,
                        data: () => snap.data,
                    };
                },
                set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
                    store.set(ref.__path, data, !!opts?.merge);
                },
            };
            await fn(tx);
        };

        jest.doMock("firebase-admin/firestore", () => ({
            __esModule: true,
            FieldValue: {
                serverTimestamp: () => "SERVER_TS",
            },
        }));

        jest.doMock("@/app/api/_lib/auth", () => ({
            __esModule: true,
            assertCsrf: () => {},
            verifySession: async () => ({ uid: "uid_1" }),
            getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "uid_1" }) }),
            getAdminDb: () => ({
                collection: (name: string) => ({
                    doc: (id: string) => ({
                        __path: `${name}/${id}`,
                        async get() {
                            const snap = store.get(`${name}/${id}`);
                            return {
                                exists: snap.exists,
                                data: () => snap.data,
                            };
                        },
                        set(value: Record<string, any>, opts?: { merge?: boolean }) {
                            store.set(`${name}/${id}`, value, !!opts?.merge);
                        },
                    }),
                }),
                runTransaction,
            }),
        }));

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                checkout: {
                    sessions: {
                        retrieve: async () => ({
                            id: "cs_test_1",
                            customer: "cus_1",
                            metadata: {
                                type: "ai_credit_topup",
                                firebaseUid: "uid_1",
                                aiEditCredits: "100",
                            },
                            payment_status: "paid",
                            livemode: false,
                            payment_intent: "pi_1",
                        }),
                    },
                },
            }),
        }));

        jest.doMock("@/lib/observability", () => ({
            __esModule: true,
            captureCriticalEvent: jest.fn(),
            captureException: jest.fn(),
        }));

        const { POST } = await import("./route");

        const req = {
            url: "https://example.com/api/billing/confirm-credit-topup",
            nextUrl: { pathname: "/api/billing/confirm-credit-topup" },
            headers: { get: () => null },
            json: async () => ({ sessionId: "cs_test_1" }),
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.credits).toBe(100);
        expect(body.newRemaining).toBe(220);

        const userDoc = store.dump("kloner_users/uid_1")?.data || {};
        const bucket = userDoc["credits.aiEdits"] || {};

        expect(bucket.remaining).toBe(220);
        expect(bucket.bonusRemaining).toBe(120);

        const topupDoc = store.dump("stripe_credit_topups/cs_test_1");
        expect(topupDoc?.exists).toBe(true);
        expect(topupDoc?.data?.credits).toBe(100);
    });

    it("is idempotent for the same checkout session", async () => {
        const store = makeStore();
        store.seed("kloner_users/uid_1", {
            stripeCustomerId: "cus_1",
            "credits.aiEdits": { monthlyLimit: 300, remaining: 50, bonusRemaining: 0 },
        });

        const runTransaction = async (fn: (tx: any) => Promise<void>) => {
            const tx = {
                async get(ref: any) {
                    const snap = store.get(ref.__path);
                    return {
                        exists: snap.exists,
                        data: () => snap.data,
                    };
                },
                set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
                    store.set(ref.__path, data, !!opts?.merge);
                },
            };
            await fn(tx);
        };

        jest.doMock("firebase-admin/firestore", () => ({
            __esModule: true,
            FieldValue: {
                serverTimestamp: () => "SERVER_TS",
            },
        }));

        jest.doMock("@/app/api/_lib/auth", () => ({
            __esModule: true,
            assertCsrf: () => {},
            verifySession: async () => ({ uid: "uid_1" }),
            getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "uid_1" }) }),
            getAdminDb: () => ({
                collection: (name: string) => ({
                    doc: (id: string) => ({
                        __path: `${name}/${id}`,
                        async get() {
                            const snap = store.get(`${name}/${id}`);
                            return {
                                exists: snap.exists,
                                data: () => snap.data,
                            };
                        },
                        set(value: Record<string, any>, opts?: { merge?: boolean }) {
                            store.set(`${name}/${id}`, value, !!opts?.merge);
                        },
                    }),
                }),
                runTransaction,
            }),
        }));

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                checkout: {
                    sessions: {
                        retrieve: async () => ({
                            id: "cs_test_repeat",
                            customer: "cus_1",
                            metadata: {
                                type: "ai_credit_topup",
                                firebaseUid: "uid_1",
                                aiEditCredits: "75",
                            },
                            payment_status: "paid",
                            livemode: false,
                            payment_intent: "pi_repeat",
                        }),
                    },
                },
            }),
        }));

        jest.doMock("@/lib/observability", () => ({
            __esModule: true,
            captureCriticalEvent: jest.fn(),
            captureException: jest.fn(),
        }));

        const { POST } = await import("./route");

        const req = {
            url: "https://example.com/api/billing/confirm-credit-topup",
            nextUrl: { pathname: "/api/billing/confirm-credit-topup" },
            headers: { get: () => null },
            json: async () => ({ sessionId: "cs_test_repeat" }),
        } as any;

        const firstRes: any = await POST(req);
        expect(firstRes.status).toBe(200);
        const firstUser = store.dump("kloner_users/uid_1")?.data || {};
        expect(firstUser["credits.aiEdits"]?.remaining).toBe(125);

        const secondRes: any = await POST(req);
        expect(secondRes.status).toBe(200);
        const secondUser = store.dump("kloner_users/uid_1")?.data || {};
        expect(secondUser["credits.aiEdits"]?.remaining).toBe(125);
    });
});
