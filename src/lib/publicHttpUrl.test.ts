import { BLOCKED_URL_TERMS, getPublicHttpUrlRejectionReason, validateAndNormalizePublicHttpUrl } from "./publicHttpUrl";

describe("publicHttpUrl", () => {
    it("keeps a large blocked-term list for explicit/dangerous URLs", () => {
        expect(BLOCKED_URL_TERMS.length).toBeGreaterThanOrEqual(200);
    });

    it("rejects sexually explicit URLs using path terms", () => {
        const url = "https://example.com/porn/videos";

        expect(getPublicHttpUrlRejectionReason(url)).toBe(
            "This URL is blocked.",
        );
        expect(validateAndNormalizePublicHttpUrl(url)).toBeNull();
    });

    it("rejects adult hostname compounds before any backend crawl", () => {
        const blockedUrls = [
            "https://pornify.cc/",
            "https://createaiporn.com/",
            "https://example-porn-site.com/",
            "https://nsfwcreator.example/",
        ];

        for (const url of blockedUrls) {
            expect(getPublicHttpUrlRejectionReason(url)).toBe("This URL is blocked.");
            expect(validateAndNormalizePublicHttpUrl(url)).toBeNull();
        }
    });

    it("rejects dangerous-use URLs using path terms", () => {
        const url = "https://example.com/how-to-build-a-ransomware-kit";

        expect(getPublicHttpUrlRejectionReason(url)).toBe(
            "This URL is blocked.",
        );
        expect(validateAndNormalizePublicHttpUrl(url)).toBeNull();
    });

    it("rejects banking-style hosts", () => {
        const url = "https://secure-banking-example.com/login";

        expect(getPublicHttpUrlRejectionReason(url)).toBe(
            "Banking, government, and account-access URLs are blocked.",
        );
    });

    it("rejects police, international government, and major financial hosts", () => {
        const blockedUrls = [
            "https://city-police.example.com",
            "https://service.gouv.fr",
            "https://agency.gov.in",
            "https://portal.go.jp",
            "https://services.go.ke",
            "https://secure.hsbc.com",
            "https://login.santander.com",
            "https://online.wellsfargo.com",
        ];

        for (const url of blockedUrls) {
            expect(getPublicHttpUrlRejectionReason(url)).toBe(
                "Banking, government, and account-access URLs are blocked.",
            );
            expect(validateAndNormalizePublicHttpUrl(url)).toBeNull();
        }
    });

    it("rejects suspicious host-label quirks commonly used in phishing", () => {
        expect(getPublicHttpUrlRejectionReason("https://www-example.com")).toBe(
            "This domain is blocked from cloning.",
        );
        expect(validateAndNormalizePublicHttpUrl("https://www-example.com")).toBeNull();

        expect(getPublicHttpUrlRejectionReason("https://xn--pple-43d.com")).toBe(
            "This domain is blocked from cloning.",
        );
        expect(validateAndNormalizePublicHttpUrl("https://xn--pple-43d.com")).toBeNull();
    });

    it("rejects common file-sharing and upload hosts, including subdomains", () => {
        const blockedUrls = [
            "https://mega.nz/file/asZyTCYQ",
            "https://sub.mega.nz/",
            "https://drive.google.com/file/d/example",
            "https://www.dropbox.com/s/example/file.zip",
            "https://1drv.ms/u/s/example",
            "https://we.tl/t-example",
            "https://mediafire.com/file/example",
            "https://gofile.io/d/example",
        ];

        for (const url of blockedUrls) {
            expect(getPublicHttpUrlRejectionReason(url)).toBe(
                "File-sharing and upload domains are blocked.",
            );
            expect(validateAndNormalizePublicHttpUrl(url)).toBeNull();
        }
    });

    it("does not block unrelated domains that contain file-host names", () => {
        const url = "https://mega-example.com/";

        expect(getPublicHttpUrlRejectionReason(url)).toBeNull();
        expect(validateAndNormalizePublicHttpUrl(url)).toBe("https://mega-example.com/");
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
                "This URL is blocked.",
            );
            expect(validateAndNormalizePublicHttpUrl(url)).toBeNull();
        }
    });
});
