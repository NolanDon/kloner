import { scanSourceMatchesUrl } from "./scanSourceIdentity";
test("a corrected hostname never inherits another scan's diagnostics", () => {
    expect(scanSourceMatchesUrl({ url: "https://form-bnisytes.net/" }, "https://form-bni.sytes.net/")).toBe(false);
    expect(scanSourceMatchesUrl({ url: "https://example.com/old" }, "https://example.com/new")).toBe(false);
    expect(scanSourceMatchesUrl({ url: "https://example.com/" }, "https://example.com/#view")).toBe(true);
    expect(scanSourceMatchesUrl(null, "https://example.com/")).toBe(false);
});
