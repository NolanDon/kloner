describe("billing access defaults", () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.NEXT_PUBLIC_FREE_EDIT_CREDITS;
        delete process.env.NEXT_PUBLIC_STRIPE_TRIAL_DAYS;
    });

    it("keeps the free edit allowance at two credits by default", async () => {
        const { FREE_EDIT_MONTHLY_CREDITS, STRIPE_TRIAL_DAYS } = await import("./billingAccess");
        const { monthlyLimitFor } = await import("./credits");

        expect(STRIPE_TRIAL_DAYS).toBe(0);
        expect(FREE_EDIT_MONTHLY_CREDITS).toBe(2);
        expect(monthlyLimitFor("free", "edit")).toBe(2);
    });
});
