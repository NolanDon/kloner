import { getUserFacingUrlErrorMessage } from "@/src/lib/userFacingErrors";

describe("getUserFacingUrlErrorMessage", () => {
    it("never exposes a raw fetch error", () => {
        expect(getUserFacingUrlErrorMessage({ status: 502, message: "Failed to fetch" })).toBe(
            "We couldn’t reach this website right now. Check that it opens publicly, then try again in a moment.",
        );
    });

    it("handles blocked websites with actionable language", () => {
        expect(getUserFacingUrlErrorMessage({ status: 403, code: "BLOCKED_URL" })).toContain(
            "access is restricted",
        );
    });

    it("handles cross-domain redirects", () => {
        expect(getUserFacingUrlErrorMessage({ status: 422, code: "CROSS_DOMAIN_REDIRECT" })).toContain(
            "final destination URL",
        );
    });

    it("handles scan limits without exposing backend details", () => {
        expect(getUserFacingUrlErrorMessage({ status: 429, code: "MONTHLY_SNAPSHOT_LIMIT" })).toContain(
            "monthly scan limit",
        );
    });
});
