export {};

const resendSend = jest.fn();
const store = new Map<string, Record<string, any>>();
const stripeList = jest.fn(async () => ({ data: [] }));

function makeDocSnap(collection: string, id: string) {
    const key = `${collection}/${id}`;
    return {
        id,
        get: async () => makeDocSnap(collection, id),
        ref: {
            get: async () => makeDocSnap(collection, id),
            set: async (data: any, opts?: { merge?: boolean }) => {
                const prev = store.get(key) ?? {};
                store.set(key, opts?.merge ? { ...prev, ...data, ...(data.offers ? { offers: { ...prev.offers, ...data.offers } } : {}) } : { ...data });
            },
        },
        data: () => {
            const value = store.get(key);
            return value ? { ...value } : undefined;
        },
    };
}

function makeQuery(collection: string, cursorId: string | null = null, limitValue = 100) {
    return {
        orderBy: () => makeQuery(collection, cursorId, limitValue),
        limit: (nextLimit: number) => makeQuery(collection, cursorId, nextLimit),
        startAfter: (cursor: any) => makeQuery(collection, cursor?.id || String(cursor || ""), limitValue),
        get: async () => {
            const ids = [...store.keys()]
                .filter((key) => key.startsWith(`${collection}/`))
                .map((key) => key.split("/")[1]!)
                .sort();
            const startIndex = cursorId ? Math.max(0, ids.indexOf(cursorId) + 1) : 0;
            const nextIds = ids.slice(startIndex, startIndex + limitValue);
            const docs = nextIds.map((id) => makeDocSnap(collection, id));
            return {
                empty: docs.length === 0,
                size: docs.length,
                docs,
            };
        },
    };
}

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

jest.mock("firebase-admin", () => ({
    __esModule: true,
    default: {
        apps: [{}],
        firestore: {
            FieldPath: {
                documentId: () => "__name__",
            },
        },
    },
}));

jest.mock("../../_lib/auth", () => ({
    __esModule: true,
    getAdminDb: () => ({
        runTransaction: async (fn: any) => fn({ get: (ref: any) => ref.get(), set: (ref: any, data: any, opts: any) => ref.set(data, opts) }),
        collection: (name: string) => {
            const query = makeQuery(name);
            return {
                orderBy: query.orderBy,
                doc: (id: string) => makeDocSnap(name, id),
            };
        },
    }),
    getAdminAuth: () => ({
        getUserByEmail: async (email: string) => ({ uid: "test_user", email, displayName: "Test User" }),
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

jest.mock("@/lib/stripe", () => ({
    __esModule: true,
    getStripe: () => ({
        subscriptions: {
            list: stripeList,
        },
    }),
}));

describe("GET /api/private/send-journey-emails", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        store.clear();
        resendSend.mockReset().mockResolvedValue({ data: { id: "email_1" } });
        stripeList.mockReset().mockResolvedValue({ data: [] });
        process.env.CRON_SECRET = "cron_secret";
        process.env.INTERNAL_API_KEY = "internal_secret";
        process.env.RESEND_API_KEY = "resend_test";
        process.env.WELCOME_EMAIL_FROM = "hello@kloner.app";
        process.env.EMAIL_LINK_SECRET = "email-secret";
        process.env.NEXT_PUBLIC_SITE_URL = "https://kloner.app";
    });

    it("sends a winback email to dormant signups and skips active users", async () => {
        store.set("kloner_users/dormant_1", {
            email: "dormant@example.com",
            displayName: "Dana",
            notificationPrefs: { journeyEmails: true },
            createdAt: Date.now() - 9 * 24 * 60 * 60 * 1000,
            lastAppActivityAt: Date.now() - 9 * 24 * 60 * 60 * 1000,
            offers: {},
        });
        store.set("kloner_users/recent_1", {
            email: "recent@example.com",
            notificationPrefs: { journeyEmails: true },
            createdAt: Date.now() - 30 * 60 * 1000,
            lastAppActivityAt: Date.now() - 30 * 60 * 1000,
            offers: {},
        });
        store.set("kloner_users/active_1", {
            email: "active@example.com",
            notificationPrefs: { journeyEmails: true },
            createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
            lastAppActivityAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
            stripeStatus: "active",
            offers: {},
        });
        store.set("kloner_users/unsub_1", {
            email: "unsub@example.com",
            notificationPrefs: { journeyEmails: false },
            createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
            lastAppActivityAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
            offers: {},
        });

        const { GET } = await import("./route");
        const req = new Request("https://example.com/api/private/send-journey-emails", {
            headers: {
                authorization: "Bearer cron_secret",
            },
        }) as any;

        const res: any = await GET(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.runId).toMatch(/^journey_/);
        expect(body.sent).toBe(1);
        expect(body.skipped).toBe(3);
        expect(resendSend).toHaveBeenCalledTimes(1);
        const payload = resendSend.mock.calls[0]?.[0];
        expect(payload.subject).toBe("Still want to build this?");
        expect(String(payload.text)).toContain("Claim 40% off");
        expect(String(payload.text)).toContain("/api/billing/recovery-checkout?t=");

        const dormantDoc = store.get("kloner_users/dormant_1") || {};
        expect(dormantDoc.offers?.winback40RecoveryEmailSentAt).toBeTruthy();
        expect(store.get("kloner_users/recent_1")?.offers?.winback40RecoveryEmailSentAt).toBeFalsy();
        expect(store.get("kloner_users/active_1")?.offers?.winback40RecoveryEmailSentAt).toBeFalsy();
        expect(store.get("kloner_users/unsub_1")?.offers?.winback40RecoveryEmailSentAt).toBeFalsy();
        const run = [...store.entries()].find(([key]) => key.startsWith("kloner_email_job_runs/"))?.[1];
        expect(run?.job).toBe("send-journey-emails");
        expect(run?.status).toBe("completed");
        expect(run?.stats).toMatchObject({ scanned: 4, sent: 1, skipped: 3, errors: 0 });
    });

    it("recovers abandoned Stripe checkouts after 30 minutes without a browser return or webhook", async () => {
        store.set("kloner_users/checkout_1", {
            stripeCustomerId: "cus_abandoned",
            lastAppActivityAt: Date.now() - 40 * 60 * 1000,
        });
        const { GET } = await import("./route");
        const req = new Request("https://example.com/api/private/send-journey-emails", {
            headers: { authorization: "Bearer cron_secret" },
        }) as any;
        const res: any = await GET(req);
        expect((await res.json()).sent).toBe(1);
        expect(resendSend.mock.calls[0][0].subject).toBe("A quick note about your checkout");
        expect(store.get("kloner_users/checkout_1")?.offers.exitOffer40RecoveryEmailId).toBe("email_1");
        await GET(req);
        expect(resendSend).toHaveBeenCalledTimes(1);
    });

    it("reports Resend failures and retries them on the next cron run", async () => {
        store.set("kloner_users/checkout_1", { stripeCustomerId: "cus_abandoned" });
        resendSend.mockResolvedValueOnce({ error: { message: "rate limited" } });
        const { GET } = await import("./route");
        const req = new Request("https://example.com/api/private/send-journey-emails", {
            headers: { authorization: "Bearer cron_secret" },
        }) as any;
        const first: any = await GET(req);
        expect(first.status).toBe(500);
        expect((await first.json()).errors).toBe(1);
        expect(store.get("kloner_users/checkout_1")?.offers.exitOffer40RecoveryEmailSentAt).toBeFalsy();
        const retry: any = await GET(req);
        expect((await retry.json()).sent).toBe(1);
        expect(resendSend).toHaveBeenCalledTimes(2);
    });

    it("does not send when Stripe subscription verification fails", async () => {
        store.set("kloner_users/checkout_1", { stripeCustomerId: "cus_abandoned" });
        stripeList.mockRejectedValueOnce(new Error("Stripe unavailable"));
        const { GET } = await import("./route");
        const res: any = await GET(new Request("https://example.com/api/private/send-journey-emails", {
            headers: { authorization: "Bearer cron_secret" },
        }) as any);
        expect(res.status).toBe(500);
        expect(resendSend).not.toHaveBeenCalled();
    });

    it("sends exactly one test through the cron endpoint without processing or marking campaign users", async () => {
        store.set("kloner_users/eligible_customer", { stripeCustomerId: "cus_abandoned" });
        store.set("kloner_users/test_user", { offers: {}, stripeStatus: "active" });
        const { GET } = await import("./route");
        const res: any = await GET(new Request("https://example.com/api/private/send-journey-emails?testEmail=owner%40example.com", {
            headers: { authorization: "Bearer cron_secret" },
        }) as any);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ testMode: true, sent: 1, emailId: "email_1" });
        expect(resendSend).toHaveBeenCalledTimes(1);
        expect(resendSend.mock.calls[0][0]).toMatchObject({ to: "owner@example.com", subject: "A quick note about your checkout" });
        expect(store.get("kloner_users/test_user")?.offers).toEqual({});
        expect(store.get("kloner_users/eligible_customer")?.offers).toBeUndefined();
        expect(stripeList).not.toHaveBeenCalled();
    });

    it("rejects an empty test recipient instead of falling through to the batch", async () => {
        store.set("kloner_users/eligible_customer", { stripeCustomerId: "cus_abandoned" });
        const { GET } = await import("./route");
        const res: any = await GET(new Request("https://example.com/api/private/send-journey-emails?testEmail=", {
            headers: { authorization: "Bearer cron_secret" },
        }) as any);
        expect(res.status).toBe(400);
        expect(resendSend).not.toHaveBeenCalled();
    });

    it("keeps test delivery protected by cron authentication", async () => {
        const { GET } = await import("./route");
        const res: any = await GET(new Request("https://example.com/api/private/send-journey-emails?testEmail=owner%40example.com") as any);
        expect(res.status).toBe(401);
        expect(resendSend).not.toHaveBeenCalled();
    });

    it("rejects unauthorized cron requests", async () => {
        const { GET } = await import("./route");
        const req = new Request("https://example.com/api/private/send-journey-emails") as any;

        const res: any = await GET(req);
        expect(res.status).toBe(401);
        expect(resendSend).not.toHaveBeenCalled();
    });
});
