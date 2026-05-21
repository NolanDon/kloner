// app/api/private/send-journey-emails/route.test.ts

export {};

describe("makeUnsubUrl", () => {
    it("builds an unsubscribe URL under /api/email/unsubscribe", async () => {
        process.env.EMAIL_LINK_SECRET = "test-secret";
        process.env.NEXT_PUBLIC_SITE_URL = "https://kloner.app";

        const { makeUnsubUrl } = await import("../email-links");
        const url = new URL(makeUnsubUrl({ uid: "uid_123", kind: "journey" }));

        expect(url.origin).toBe("https://kloner.app");
        expect(url.pathname).toBe("/api/email/unsubscribe");
        expect(url.searchParams.get("t")).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });
});
