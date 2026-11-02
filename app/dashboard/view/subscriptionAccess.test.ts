import { isDashboardProjectAccessLocked } from "./subscriptionAccess";

describe("dashboard subscription access", () => {
    it("locks projects when a subscription is scheduled to cancel", () => {
        expect(isDashboardProjectAccessLocked({
            billingState: "active",
            stripeStatus: "active",
            cancelAtPeriodEnd: true,
        })).toBe(true);
    });

    it.each(["canceled", "cancelled"])("locks projects for a %s subscription", (stripeStatus) => {
        expect(isDashboardProjectAccessLocked({ stripeStatus })).toBe(true);
    });

    it("keeps projects available for subscriptions that have not been cancelled", () => {
        expect(isDashboardProjectAccessLocked({
            billingState: "active",
            stripeStatus: "active",
            cancelAtPeriodEnd: false,
        })).toBe(false);
    });

    it("supports the admin-only cancellation preview", () => {
        expect(isDashboardProjectAccessLocked({ previewMode: true })).toBe(true);
    });
});