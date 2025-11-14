// app/dashboard/view/page.helpers.test.tsx

import { act } from "react";
import { isHttpUrl, normUrl, ensureHttp, hash64, tsToMs, extractHashFromKey, shortVersionFromShotPath, rendersEqual, CREDIT_LIMITS, useCooldown } from "./page.helpers";

describe("URL helpers", () => {
    it("isHttpUrl returns true for http/https and false otherwise", () => {
        expect(isHttpUrl("http://example.com")).toBe(true);
        expect(isHttpUrl("https://example.com")).toBe(true);
        expect(isHttpUrl("ftp://example.com")).toBe(false);
        expect(isHttpUrl("example.com")).toBe(false);
        expect(isHttpUrl("")).toBe(false);
        expect(isHttpUrl(undefined)).toBe(false);
    });

    it("normUrl strips hash and preserves URL", () => {
        const original = "https://example.com/page#section";
        const result = normUrl(original);
        expect(result).toBe("https://example.com/page");
    });

    it("normUrl falls back to trimmed input on invalid URLs", () => {
        expect(normUrl(" not-a-url ")).toBe("not-a-url");
    });

    it("ensureHttp adds https:// when missing and preserves http/https", () => {
        expect(ensureHttp("example.com")).toBe("https://example.com");
        expect(ensureHttp("  example.com  ")).toBe("https://example.com");
        expect(ensureHttp("http://example.com")).toBe("http://example.com");
        expect(ensureHttp("https://example.com")).toBe("https://example.com");
        expect(ensureHttp("")).toBe("");
    });
});

describe("hash64", () => {
    it("produces a stable hash for the same input", () => {
        const a = hash64("https://example.com");
        const b = hash64("https://example.com");
        expect(a).toBe(b);
    });

    it("produces different hashes for different inputs", () => {
        const a = hash64("https://example.com/a");
        const b = hash64("https://example.com/b");
        expect(a).not.toBe(b);
    });
});

describe("tsToMs", () => {
    it("returns 0 for falsy values", () => {
        expect(tsToMs(null)).toBe(0);
        expect(tsToMs(undefined)).toBe(0);
    });

    it("handles Date instances", () => {
        const d = new Date(1700000000000);
        expect(tsToMs(d)).toBe(1700000000000);
    });

    it("handles Firestore Timestamp-like objects", () => {
        const fakeTimestamp = {
            toDate: () => new Date(1700000000000),
        };
        expect(tsToMs(fakeTimestamp as any)).toBe(1700000000000);
    });

    it("passes through numbers", () => {
        expect(tsToMs(123456)).toBe(123456);
    });
});

describe("extractHashFromKey", () => {
    it("extracts trailing digits from screenshot filenames", () => {
        const key =
            "kloner-screenshots/user/url-scans/159dabc396a3bad9/159dabc396a3bad9-1762822804825.jpeg";
        const hash = extractHashFromKey(key);
        expect(hash).toBe("1762822804825");
    });

    it("falls back to last alphanumeric token when no trailing digits", () => {
        const key = "kloner-screenshots/user/url-scans/some-path/abcdEF";
        const hash = extractHashFromKey(key);
        expect(hash).toBe("abcdEF");
    });

    it("returns null for empty or bad keys", () => {
        expect(extractHashFromKey("")).toBeNull();
        expect(extractHashFromKey(undefined as any)).toBeNull();
    });
});

describe("shortVersionFromShotPath", () => {
    it("uses last digits of filename and trims to 4 chars", () => {
        const path =
            "kloner-screenshots/user/url-scans/159dabc396a3bad9/159dabc396a3bad9-1762822804825.jpeg";
        const label = shortVersionFromShotPath(path, null, 4);
        expect(label).toBe("4825");
    });

    it("falls back to alphanumeric token when no digit tail", () => {
        const path = "kloner-screenshots/user/url-scans/foo/bar/abcdEF.png";
        const label = shortVersionFromShotPath(path, null, 4);
        expect(label).toBe("cdEF");
    });

    it("falls back to provided hash when path has no useful suffix", () => {
        const path = "kloner-screenshots/user/url-scans/foo/bar/.jpeg";
        const label = shortVersionFromShotPath(path, "159dabc396a3bad9", 4);
        expect(label).toBe("3bad");
    });

    it("returns 'v' when nothing usable is available", () => {
        const path = "";
        const label = shortVersionFromShotPath(path, null, 4);
        expect(label).toBe("v");
    });
});

describe("rendersEqual", () => {
    const base = (overrides: Partial<{ id: string } & any> = {}) => ({
        id: "id-1",
        status: "ready",
        html: "<div>ok</div>",
        key: "key-1",
        nameHint: "site.com",
        ...overrides,
    });

    it("returns true when arrays are the same reference", () => {
        const arr = [base()];
        expect(rendersEqual(arr, arr)).toBe(true);
    });

    it("returns true when contents match exactly", () => {
        const a = [base()];
        const b = [base()];
        expect(rendersEqual(a, b)).toBe(true);
    });

    it("returns false when lengths differ", () => {
        const a = [base()];
        const b = [base(), base({ id: "id-2" })];
        expect(rendersEqual(a, b)).toBe(false);
    });

    it("returns false when id differs", () => {
        const a = [base({ id: "id-1" })];
        const b = [base({ id: "id-2" })];
        expect(rendersEqual(a, b)).toBe(false);
    });

    it("returns false when status differs", () => {
        const a = [base({ status: "ready" })];
        const b = [base({ status: "queued" })];
        expect(rendersEqual(a, b)).toBe(false);
    });

    it("returns false when html differs", () => {
        const a = [base({ html: "<div>a</div>" })];
        const b = [base({ html: "<div>b</div>" })];
        expect(rendersEqual(a, b)).toBe(false);
    });

    it("returns false when key differs", () => {
        const a = [base({ key: "key-1" })];
        const b = [base({ key: "key-2" })];
        expect(rendersEqual(a, b)).toBe(false);
    });

    it("returns false when nameHint differs", () => {
        const a = [base({ nameHint: "a.com" })];
        const b = [base({ nameHint: "b.com" })];
        expect(rendersEqual(a, b)).toBe(false);
    });
});

describe("CREDIT_LIMITS", () => {
    it("defines non-zero limits for free/pro/agency", () => {
        expect(CREDIT_LIMITS.free.screenshotDaily).toBeGreaterThan(0);
        expect(CREDIT_LIMITS.free.previewDaily).toBeGreaterThan(0);

        expect(CREDIT_LIMITS.pro.screenshotDaily).toBeGreaterThan(
            CREDIT_LIMITS.free.screenshotDaily
        );
        expect(CREDIT_LIMITS.pro.previewDaily).toBeGreaterThan(
            CREDIT_LIMITS.free.previewDaily
        );

        expect(CREDIT_LIMITS.agency.screenshotDaily).toBeGreaterThan(
            CREDIT_LIMITS.pro.screenshotDaily
        );
        expect(CREDIT_LIMITS.agency.previewDaily).toBeGreaterThan(
            CREDIT_LIMITS.pro.previewDaily
        );
    });

    it("treats enterprise and unknown as unlimited via zero sentinel", () => {
        expect(CREDIT_LIMITS.enterprise.screenshotDaily).toBe(0);
        expect(CREDIT_LIMITS.enterprise.previewDaily).toBe(0);
        expect(CREDIT_LIMITS.unknown.screenshotDaily).toBe(0);
        expect(CREDIT_LIMITS.unknown.previewDaily).toBe(0);
    });
});
