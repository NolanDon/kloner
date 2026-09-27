const updateUser = jest.fn();

jest.mock("./auth", () => ({
    getAdminAuth: () => ({ updateUser }),
}));

describe("blocked URL abuse enforcement", () => {
    const originalFetch = global.fetch;
    const originalWebhook = process.env.ABUSE_SLACK_WEBHOOK_URL;

    beforeEach(() => {
        updateUser.mockReset();
        updateUser.mockResolvedValue({ uid: "uid_1", disabled: true });
        process.env.ABUSE_SLACK_WEBHOOK_URL = "https://hooks.slack.test/services/a/b/c";
        global.fetch = jest.fn().mockResolvedValue({ ok: true }) as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        if (originalWebhook === undefined) delete process.env.ABUSE_SLACK_WEBHOOK_URL;
        else process.env.ABUSE_SLACK_WEBHOOK_URL = originalWebhook;
    });

    it("extracts the first forwarded IP", async () => {
        const { getClientIp, isAdultBlockedUrl } = await import("./blockedUrlAbuse");
        expect(getClientIp({ headers: new Headers({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" }) })).toBe("203.0.113.10");
        expect(isAdultBlockedUrl("https://createaiporn.com/")).toBe(true);
        expect(isAdultBlockedUrl("https://example.com/ransomware-builder")).toBe(false);
    });

    it("disables the user and sends the IP to Slack", async () => {
        const { disableUserForBlockedUrl } = await import("./blockedUrlAbuse");
        const result = await disableUserForBlockedUrl({
            uid: "uid_1",
            url: "https://pornify.cc/",
            ip: "203.0.113.10",
            route: "/api/generate-app-from-url",
            requestId: "req_1",
        });

        expect(result).toEqual({ disabled: true, slackSent: true });
        expect(updateUser).toHaveBeenCalledWith("uid_1", { disabled: true });
        const body = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body));
        expect(body.text).toContain("203.0.113.10");
        expect(body.text).toContain("pornify.cc");
        expect(body.text).toContain("req_1");
    });
});
