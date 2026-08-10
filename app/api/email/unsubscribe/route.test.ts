export {};

const store = new Map<string, Record<string, any>>();

jest.mock("next/server", () => ({
    __esModule: true,
    NextResponse: {
        redirect: (url: string | URL, status = 302) =>
            new Response(null, {
                status,
                headers: {
                    location: String(url),
                },
            }),
    },
}));

jest.mock("../../_lib/auth", () => ({
    __esModule: true,
    getAdminDb: () => ({
        collection: (name: string) => ({
            doc: (id: string) => {
                const key = `${name}/${id}`;
                return {
                    id,
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
}));

describe("GET /api/email/unsubscribe", () => {
    beforeEach(() => {
        jest.resetModules();
        store.clear();
        process.env.EMAIL_LINK_SECRET = "test-secret";
        process.env.FRONTEND_BASE_URL = "https://kloner.app";
        delete process.env.NEXT_PUBLIC_SITE_URL;
    });

    it("turns off journey emails and redirects back to settings", async () => {
        store.set("kloner_users/uid_1", {
            notificationPrefs: {
                journeyEmails: true,
                productEmails: true,
                securityEmails: true,
            },
        });

        const { makeSignedToken } = await import("../../private/email-links");
        const token = makeSignedToken({ uid: "uid_1", k: "journey", ts: Date.now() });

        const { GET } = await import("./route");
        const req = new Request(`https://kloner.app/api/email/unsubscribe?t=${encodeURIComponent(token)}`) as any;

        const res: any = await GET(req);
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://kloner.app/settings?tab=notifications&unsub=ok&k=journey");

        const userDoc = store.get("kloner_users/uid_1") || {};
        expect(userDoc.notificationPrefs?.journeyEmails).toBe(false);
        expect(userDoc.notificationPrefs?.productEmails).toBe(true);
        expect(userDoc.notificationPrefs?.securityEmails).toBe(true);
        expect(userDoc.notificationPrefsUpdatedAt).toBeTruthy();
        expect(userDoc.notificationUnsubbedAt).toBeTruthy();
        expect(userDoc.notificationUnsubbedKind).toBe("journey");
    });

    it("redirects missing tokens to the missing state", async () => {
        const { GET } = await import("./route");
        const req = new Request("https://kloner.app/api/email/unsubscribe") as any;

        const res: any = await GET(req);
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://kloner.app/settings?tab=notifications&unsub=missing");
    });

    it("redirects invalid tokens to the invalid state", async () => {
        const { GET } = await import("./route");
        const req = new Request("https://kloner.app/api/email/unsubscribe?t=bad-token") as any;

        const res: any = await GET(req);
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://kloner.app/settings?tab=notifications&unsub=invalid");
    });
});
