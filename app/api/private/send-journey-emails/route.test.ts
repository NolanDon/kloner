export {};

const resendSend = jest.fn();
const store = new Map<string, Record<string, any>>();
const stripeList = jest.fn(async () => ({ data: [] }));

function makeDocSnap(collection: string, id: string) {
    const key = `${collection}/${id}`;
    return {
        id,
        ref: {
            set: async (data: any, opts?: { merge?: boolean }) => {
                const prev = store.get(key) ?? {};
                store.set(key, opts?.merge ? { ...prev, ...data } : { ...data });
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
        collection: (name: string) => {
            const query = makeQuery(name);
            return {
                orderBy: query.orderBy,
                doc: (id: string) => makeDocSnap(name, id),
            };
        },
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

    it("rejects unauthorized cron requests", async () => {
        const { GET } = await import("./route");
        const req = new Request("https://example.com/api/private/send-journey-emails") as any;

        const res: any = await GET(req);
        expect(res.status).toBe(401);
        expect(resendSend).not.toHaveBeenCalled();
    });
});
