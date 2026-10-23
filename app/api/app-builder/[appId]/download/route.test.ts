/** @jest-environment node */
export {};
let mockUser: any;
let mockApp: any;
const mockBuild = jest.fn(async () => new Uint8Array([80, 75]));
const mockRefresh = jest.fn(async () => "pro");
const mockScope = jest.fn();
jest.mock("@/app/api/_lib/auth", () => ({ getAdminDb: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ data: () => mockUser }), collection: () => ({ doc: () => ({ get: async () => ({ exists: Boolean(mockApp), data: () => mockApp }) }) }) }) }) }) }));
jest.mock("@/app/api/_lib/route-guard", () => ({ requireSessionAndMaybeCsrf: async (req: any, handler: any) => handler({ uid: "owner", req }) }));
jest.mock("@/app/api/_lib/appBuilderScope", () => ({ assertAppBuilderScope: (...args: any[]) => mockScope(...args) }));
jest.mock("@/app/api/_lib/billing", () => ({ refreshTierFromStripeForUid: (...args: any[]) => (mockRefresh as any)(...args) }));
jest.mock("@/app/api/_lib/projectDownload", () => ({
    ...jest.requireActual("@/app/api/_lib/projectDownload"),
    buildProjectDownload: (...args: any[]) => (mockBuild as any)(...args),
}));

beforeEach(() => { jest.clearAllMocks(); mockUser = { tier: "pro", stripeStatus: "trialing", stripeSubscriptionId: "sub" }; mockApp = { name: "Test project", files: {} }; });
test("trial requests receive a paywall even when the tier and client claim pro", async () => {
    const { POST } = await import("./route");
    const response = await POST({ json: async () => ({ tier: "pro" }) } as any, { params: { appId: "app" } });
    expect(response.status).toBe(402);
    expect((await response.json()).code).toBe("PAID_SUBSCRIPTION_REQUIRED");
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockScope).toHaveBeenCalledWith(expect.anything(), "owner", "app");
});
test("paid users receive the archive with their current editor buffer", async () => {
    mockUser.stripeStatus = "active";
    const { POST } = await import("./route");
    const currentFile = { path: "index.html", content: "current editor" };
    const response = await POST({ json: async () => ({ currentFile }) } as any, { params: Promise.resolve({ appId: "app" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockBuild).toHaveBeenCalledWith(expect.objectContaining({ uid: "owner", appId: "app", currentFile }));
});
test("paid users cannot download a project outside their account", async () => {
    mockUser.stripeStatus = "active"; mockApp = null;
    const { POST } = await import("./route");
    expect((await POST({ json: async () => ({}) } as any, { params: { appId: "foreign" } })).status).toBe(404);
    expect(mockBuild).not.toHaveBeenCalled();
});
