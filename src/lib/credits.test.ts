// src/lib/credits.test.ts

import { tierFromClaims, UserTier, CREDIT_LIMITS, canConsumeCredit } from "./credits";

describe("tierFromClaims", () => {
    it("defaults to free if no tier present", () => {
        expect(tierFromClaims({})).toBe("free");
    });

    it("normalizes known tiers", () => {
        const tiers: UserTier[] = ["free", "pro", "agency", "enterprise", "unknown"];
        for (const t of tiers) {
            if (t === "unknown") continue;
            expect(tierFromClaims({ userTier: t })).toBe(t === "free" ? "free" : t);
        }
    });
});

describe("CREDIT_LIMITS", () => {
    it("defines limits for each tier", () => {
        expect(CREDIT_LIMITS.free.screenshotDaily).toBeGreaterThan(0);
        expect(CREDIT_LIMITS.pro.previewDaily).toBeGreaterThan(CREDIT_LIMITS.free.previewDaily);
    });
});

describe("canConsumeCredit", () => {
    it("allows consumption below limit", () => {
        expect(canConsumeCredit("free", "screenshot", 0)).toBe(true);
    });

    it("blocks consumption at limit", () => {
        const limit = CREDIT_LIMITS.free.screenshotDaily;
        expect(canConsumeCredit("free", "screenshot", limit)).toBe(false);
    });

    it("treats enterprise as unlimited", () => {
        expect(canConsumeCredit("enterprise", "preview", 10_000)).toBe(true);
    });
});
