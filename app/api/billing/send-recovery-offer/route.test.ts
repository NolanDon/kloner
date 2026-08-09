export {};

const resendSend = jest.fn();
const store = new Map<string, Record<string, any>>();

jest.mock("next/server", () => ({
    __esModule: true,
    NextResponse: {
        json: (body: any, init?: { status?: number }) => ({
            status: init?.status ?? 200,
            headers: new Headers(),
            async json() {
                return body;
            },
        }),
    },
}));

jest.mock("../../_lib/route-guard", () => ({
    __esModule: true,
    requireSessionAndMaybeCsrf: async (req: any, handler: any) => handler({ req, uid: "uid_1" }),
}));

jest.mock("../../_lib/auth", () => ({
    __esModule: true,
    verifySession: async () => ({ uid: "uid_1" }),
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

jest.mock("resend", () => ({
    __esModule: true,
    Resend: function ResendMock() {
        return {
            emails: {
                send: (...args: any[]) => resendSend(...args),
            },
        };
    },
}));

describe("POST /api/billing/send-recovery-offer", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        store.clear();
        process.env.EMAIL_LINK_SECRET = "test-secret";
        process.env.RESEND_API_KEY = "resend_test";
        process.env.WELCOME_EMAIL_FROM = "hello@kloner.app";
    });

    it("sends a one-time recovery email when journey emails are enabled", async () => {
        store.set("kloner_users/uid_1", {
            notificationPrefs: { journeyEmails: true },
            offers: {},
        });

        const { POST } = await import("./route");
        const req = {
            json: async () => ({}),
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.sent).toBe(true);
        expect(resendSend).toHaveBeenCalledTimes(1);
        const payload = resendSend.mock.calls[0]?.[0];
        expect(payload.subject).toContain("Still want");
        expect(String(payload.text)).toContain("/api/billing/recovery-checkout?t=");
        expect(String(payload.text)).toContain("/api/email/unsubscribe?t=");
        const userDoc = store.get("kloner_users/uid_1") || {};
        expect(userDoc.offers?.exitOffer40RecoveryEmailSentAt).toBeTruthy();
    });

    it("skips sending when the user was recently active", async () => {
        store.set("kloner_users/uid_1", {
            notificationPrefs: { journeyEmails: true },
            offers: {},
            lastAppActivityAt: Date.now(),
        });

        const { POST } = await import("./route");
        const req = {
            json: async () => ({}),
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.sent).toBe(false);
        expect(body.skipped).toBe("active_recently");
        expect(resendSend).not.toHaveBeenCalled();
    });

    it("skips sending when the user unsubscribed from journey emails", async () => {
        store.set("kloner_users/uid_1", {
            notificationPrefs: { journeyEmails: false },
            offers: {},
        });

        const { POST } = await import("./route");
        const req = {
            json: async () => ({}),
        } as any;

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.sent).toBe(false);
        expect(body.skipped).toBe("unsubscribed");
        expect(resendSend).not.toHaveBeenCalled();
    });
});
