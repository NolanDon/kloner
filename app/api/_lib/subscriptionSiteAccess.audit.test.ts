export {};
const critical = jest.fn(async (_event: any) => ({ delivered: true }));
const audit = jest.fn(async (_event: any) => ({ delivered: true }));
let projects: any[] = [];
const userRef: any = {
    get: async () => ({ exists: true, data: () => ({}) }),
    set: jest.fn(async () => {}),
    collection: (name: string) => ({
        doc: () => ({}),
        get: async () => ({ docs: name === "kloner_apps" ? projects.map((p) => ({ data: () => p })) : [] }),
    }),
};
jest.mock("./auth", () => ({ getAdminDb: () => ({ collection: () => ({ doc: () => userRef }) }) }));
jest.mock("./vercel-integration", () => ({ loadVercelIntegration: async () => ({ accessToken: "test-token" }) }));
jest.mock("@/lib/observability", () => ({ captureAuditEvent: (event: any) => audit(event), captureCriticalEvent: (event: any) => critical(event) }));

describe("billing pause audit reporting", () => {
    const originalFetch = global.fetch;
    afterEach(() => { global.fetch = originalFetch; });
    beforeEach(() => { critical.mockClear(); audit.mockClear(); projects = []; });

    it("keeps a missing provider project visible as an incomplete operation", async () => {
        projects = [{ vercelProjectId: "prj_missing" }];
        global.fetch = jest.fn(async () => ({ ok: false, status: 404 })) as any;
        const { suspendUserLiveSites } = await import("./subscriptionSiteAccess");
        const result = await suspendUserLiveSites("user-debug", "subscription_cancelled");
        expect(result.failed).toBe(1);
        expect(critical.mock.calls[0][0]).toMatchObject({ severity: "error", statusCode: 502, action: "billing.liveSites.pause_failed", userId: "user-debug" });
        expect(audit).not.toHaveBeenCalled();
    });

    it("reports provider HTTP status and scope without exposing credentials", async () => {
        projects = [{ vercelProjectId: "prj_scope", vercelTeamId: "team_test" }];
        global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: { code: "forbidden" } }) })) as any;
        const { suspendUserLiveSites } = await import("./subscriptionSiteAccess");
        await suspendUserLiveSites("user-debug", "subscription_cancelled");
        const event = critical.mock.calls[0][0];
        expect(event.message).toContain("HTTP 403");
        expect(event.message).toContain("team_test");
        expect(JSON.stringify(event)).not.toContain("test-token");
    });

    it("does not flood Slack when there are no live projects", async () => {
        const { suspendUserLiveSites } = await import("./subscriptionSiteAccess");
        expect(await suspendUserLiveSites("user-debug", "subscription_cancelled")).toMatchObject({ suspended: 0, failed: 0 });
        expect(audit).not.toHaveBeenCalled();
        expect(critical).not.toHaveBeenCalled();
    });
});
