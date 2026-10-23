/** @jest-environment node */
export {};
let mockSubscription: any;
const mockUpdate = jest.fn(async () => ({ status: "active" }));
const mockRefresh = jest.fn();
jest.mock("@/app/api/_lib/auth", () => ({ getAdminDb: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({ stripeSubscriptionId: "sub", stripeCustomerId: "cus" }) }) }) }) }) }));
jest.mock("@/app/api/_lib/route-guard", () => ({ requireSessionAndMaybeCsrf: async (req: any, handler: any) => handler({ uid: "owner", req }) }));
jest.mock("@/app/api/_lib/billing", () => ({ refreshTierFromStripeForUid: (...args: any[]) => mockRefresh(...args) }));
jest.mock("@/lib/stripe", () => ({ getStripe: () => ({ subscriptions: { retrieve: async () => mockSubscription, update: (...args: any[]) => (mockUpdate as any)(...args) } }) }));
beforeEach(() => { jest.clearAllMocks(); mockSubscription = { id: "sub", customer: "cus", status: "trialing" }; });
test("explicit trial upgrade starts billing once with an idempotency key", async () => {
    const { POST } = await import("./route");
    expect((await POST({} as any)).status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("sub", expect.objectContaining({ trial_end: "now", payment_behavior: "error_if_incomplete" }), { idempotencyKey: "activate-paid:owner:sub" });
    expect(mockRefresh).toHaveBeenCalledWith("owner");
});
test("a paid subscriber is not charged again", async () => {
    mockSubscription.status = "active";
    const { POST } = await import("./route");
    expect((await POST({} as any)).status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
});
test("rejects a mismatched customer before any billing mutation", async () => {
    mockSubscription.customer = "other";
    const { POST } = await import("./route");
    expect((await POST({} as any)).status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
});
