import { BLOCKED_URL_TERMS, getPublicHttpUrlRejectionReason, validateAndNormalizePublicHttpUrl } from "./publicHttpUrl";

describe("publicHttpUrl", () => {
    it("keeps a large blocked-term list for explicit/dangerous URLs", () => {
        expect(BLOCKED_URL_TERMS.length).toBeGreaterThanOrEqual(200);
    });

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

    it("rejects representative blocked terms across path/query/hash", () => {
        const representativeTerms = [
            "pornhub",
            "sexchat",
            "adultdating",
            "camgirl",
            "hentai",
            "nudes",
            "blowjob",
            "milf",
            "xvideos",
            "youporn",
            "ransomware",
            "phishing",
            "crypto drainer",
            "keylogger",
            "botnet",
            "weapon",
            "fentanyl",
            "money laundering",
        ];

        for (const term of representativeTerms) {
            const encoded = encodeURIComponent(term);
            const url = `https://example.com/${encoded}?q=${encoded}#${encoded}`;
            expect(getPublicHttpUrlRejectionReason(url)).toBe(
                "Sexually explicit, financial-account, and dangerous-use URLs are blocked.",
            );
            expect(validateAndNormalizePublicHttpUrl(url)).toBeNull();
        }
    });
});