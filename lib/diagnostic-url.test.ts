import { redactDiagnosticUrl } from "./diagnostic-url";

test("redacts credentials and state while retaining diagnostic route and configuration", () => {
    const url = redactDiagnosticUrl("https://user:pass@kloner.app/api/vercel/oauth/callback?code=private-code&state=private-state&configurationId=icfg_1#token-secret");
    expect(url).toContain("configurationId=icfg_1");
    expect(url).toContain("code=REDACTED");
    expect(url).not.toMatch(/private-code|private-state|user:pass|token-secret/);
});

test("redacts signed email links and strips unsafe queries from malformed URLs", () => {
    expect(redactDiagnosticUrl("https://kloner.app/api/email/unsubscribe?t=private-token")).not.toContain("private-token");
    expect(redactDiagnosticUrl("bad-url?code=private-code")).toBe("bad-url");
});
