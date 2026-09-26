import { AI_EDIT_CREDIT_COST, getAuthoritativeAiEditCreditCost } from "./aiEditCredits";

describe("AI edit credit charging", () => {
    test("always uses the server-owned cost", () => {
        expect(getAuthoritativeAiEditCreditCost(0)).toBe(AI_EDIT_CREDIT_COST);
        expect(getAuthoritativeAiEditCreditCost(-100)).toBe(AI_EDIT_CREDIT_COST);
        expect(getAuthoritativeAiEditCreditCost(1)).toBe(AI_EDIT_CREDIT_COST);
        expect(getAuthoritativeAiEditCreditCost(999999)).toBe(AI_EDIT_CREDIT_COST);
        expect(getAuthoritativeAiEditCreditCost(undefined)).toBe(AI_EDIT_CREDIT_COST);
    });
});
