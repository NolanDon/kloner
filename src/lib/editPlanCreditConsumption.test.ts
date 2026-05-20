import { resolveEditPlanCreditCharge } from "./editPlanCreditConsumption";

describe("resolveEditPlanCreditCharge", () => {
    it("consumes credits for queued work with a request id", () => {
        const result = resolveEditPlanCreditCharge({
            isFreeCompileFixMode: false,
            requestId: "req_123",
            creditCost: 3.8,
            ops: [{ path: "app/page.tsx" }],
            dbMigrations: [],
        });

        expect(result.requestId).toBe("req_123");
        expect(result.creditCost).toBe(3);
        expect(result.hasChargeableWork).toBe(true);
        expect(result.shouldConsume).toBe(true);
    });

    it("trims the request id before deciding to consume", () => {
        const result = resolveEditPlanCreditCharge({
            isFreeCompileFixMode: false,
            requestId: "  req_456  ",
            creditCost: 1,
            ops: [{ path: "app/page.tsx" }],
            dbMigrations: null,
        });

        expect(result.requestId).toBe("req_456");
        expect(result.shouldConsume).toBe(true);
    });

    it("does not consume in free compile-fix mode", () => {
        const result = resolveEditPlanCreditCharge({
            isFreeCompileFixMode: true,
            requestId: "req_789",
            creditCost: 1,
            ops: [{ path: "app/page.tsx" }],
            dbMigrations: [],
        });

        expect(result.shouldConsume).toBe(false);
    });

    it("does not consume when there is no chargeable work", () => {
        const result = resolveEditPlanCreditCharge({
            isFreeCompileFixMode: false,
            requestId: "req_999",
            creditCost: 1,
            ops: [{ path: "   " }],
            dbMigrations: [],
        });

        expect(result.hasChargeableWork).toBe(false);
        expect(result.shouldConsume).toBe(false);
    });

    it("does not consume without a request id", () => {
        const result = resolveEditPlanCreditCharge({
            isFreeCompileFixMode: false,
            requestId: "   ",
            creditCost: 1,
            ops: [{ path: "app/page.tsx" }],
            dbMigrations: [],
        });

        expect(result.requestId).toBeNull();
        expect(result.shouldConsume).toBe(false);
    });
});