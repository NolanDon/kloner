import { jest } from "@jest/globals";

describe("POST /api/billing/create-credit-topup-session", () => {
    const OLD_ENV = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV } as any;
    });

    afterAll(() => {
        process.env = OLD_ENV;
    });

    it("requests 3DS for credit top-up checkout", async () => {
        const store = new Map<string, any>();

        jest.doMock("@/app/api/_lib/auth", () => ({
            __esModule: true,
            assertCsrf: () => {},
            verifySession: async () => ({ uid: "uid_1" }),
            getAdminAuth: () => ({
                getUser: async () => ({ email: "user@example.com" }),
            }),
            getAdminDb: () => ({
                collection: (name: string) => ({
                    doc: (uid: string) => ({
                        async get() {
                            const key = `${name}/${uid}`;
                            const data = store.get(key);
                            return {
                                exists: !!data,
                                data: () => data,
                            };
                        },
                        async set(value: any, options?: any) {
                            const key = `${name}/${uid}`;
                            const existing = store.get(key) || {};
                            store.set(key, options?.merge ? { ...existing, ...value } : value);
                        },
                    }),
                }),
            }),
        }));

        const sessionsCreate = jest.fn(async (_payload: any) => ({ url: "https://stripe/checkout" }));

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                customers: {
                    create: async () => ({ id: "cus_new" }),
                },
                checkout: {
                    sessions: {
                        create: sessionsCreate,
                    },
                },
            }),
        }));

        jest.doMock("@/lib/observability", () => ({
            __esModule: true,
            captureCriticalEvent: jest.fn(),
            captureException: jest.fn(),
        }));

        jest.doMock("../../_lib/billing", () => ({
            __esModule: true,
            linkCustomerToUid: jest.fn(),
        }));

        const { POST } = await import("./route");

        const res: any = await POST({
            url: "https://example.com/api/billing/create-credit-topup-session",
            nextUrl: { pathname: "/api/billing/create-credit-topup-session" },
            headers: { get: () => null },
            json: async () => ({ credits: 100 }),
        } as any);

        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.url).toBe("https://stripe/checkout");

        const payload = sessionsCreate.mock.calls[0]?.[0];
        expect(payload.payment_method_options?.card?.request_three_d_secure).toBe("any");
    });

    it("preserves provided next project path in success and cancel URLs", async () => {
        const store = new Map<string, any>();

        jest.doMock("@/app/api/_lib/auth", () => ({
            __esModule: true,
            assertCsrf: () => {},
            verifySession: async () => ({ uid: "uid_project" }),
            getAdminAuth: () => ({
                getUser: async () => ({ email: "user@example.com" }),
            }),
            getAdminDb: () => ({
                collection: (name: string) => ({
                    doc: (uid: string) => ({
                        async get() {
                            const key = `${name}/${uid}`;
                            const data = store.get(key);
                            return {
                                exists: !!data,
                                data: () => data,
                            };
                        },
                        async set(value: any, options?: any) {
                            const key = `${name}/${uid}`;
                            const existing = store.get(key) || {};
                            store.set(key, options?.merge ? { ...existing, ...value } : value);
                        },
                    }),
                }),
            }),
        }));

        const sessionsCreate = jest.fn(async (_payload: any) => ({ url: "https://stripe/checkout" }));

        jest.doMock("@/lib/stripe", () => ({
            __esModule: true,
            getStripe: () => ({
                customers: {
                    create: async () => ({ id: "cus_project" }),
                },
                checkout: {
                    sessions: {
                        create: sessionsCreate,
                    },
                },
            }),
        }));

        jest.doMock("@/lib/observability", () => ({
            __esModule: true,
            captureCriticalEvent: jest.fn(),
            captureException: jest.fn(),
        }));

        jest.doMock("../../_lib/billing", () => ({
            __esModule: true,
            linkCustomerToUid: jest.fn(),
        }));

        const { POST } = await import("./route");

        const res: any = await POST({
            url: "https://example.com/api/billing/create-credit-topup-session",
            nextUrl: { pathname: "/api/billing/create-credit-topup-session" },
            headers: { get: () => null },
            json: async () => ({
                credits: 100,
                next: "/dashboard/view?appId=proj_123&tab=editor#chat",
            }),
        } as any);

        expect(res.status).toBe(200);

        const payload = sessionsCreate.mock.calls[0]?.[0];
        expect(payload.success_url).toContain("/dashboard/view?appId=proj_123&tab=editor&topup=success&session_id=%7BCHECKOUT_SESSION_ID%7D#chat");
        expect(payload.cancel_url).toContain("/dashboard/view?appId=proj_123&tab=editor&topup=cancel#chat");
    });
});