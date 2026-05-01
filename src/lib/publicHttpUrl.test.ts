import { getPublicHttpUrlRejectionReason, validateAndNormalizePublicHttpUrl } from "./publicHttpUrl";

describe("publicHttpUrl", () => {
    it("rejects sexually explicit URLs using path terms", () => {
        const url = "https://example.com/porn/videos";

        expect(getPublicHttpUrlRejectionReason(url)).toBe(
            "Sexually explicit, financial-account, and dangerous-use URLs are blocked.",
        );
        expect(validateAndNormalizePublicHttpUrl(url)).toBeNull();
    });

    it("rejects dangerous-use URLs using path terms", () => {
        const url = "https://example.com/how-to-build-a-ransomware-kit";

        expect(getPublicHttpUrlRejectionReason(url)).toBe(
            "Sexually explicit, financial-account, and dangerous-use URLs are blocked.",
        );
        expect(validateAndNormalizePublicHttpUrl(url)).toBeNull();
    });

    it("rejects banking-style hosts", () => {
        const url = "https://secure-banking-example.com/login";

        expect(getPublicHttpUrlRejectionReason(url)).toBe(
            "Banking, government, and account-access URLs are blocked.",
        );
    });

    it("accepts ordinary public URLs", () => {
        const url = "example.com/products/widget";

        expect(getPublicHttpUrlRejectionReason(url)).toBeNull();
        expect(validateAndNormalizePublicHttpUrl(url)).toBe("https://example.com/products/widget");
    });
});