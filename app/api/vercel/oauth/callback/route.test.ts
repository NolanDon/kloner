const verify = jest.fn();
const capture = jest.fn();
const save = jest.fn();

jest.mock("../../../_lib/auth", () => ({
    SESSION_COOKIE_NAME: "__session", verifySession: (...args: any[]) => verify(...args),
    getAdminDb: () => ({ collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ set: save }) }) }) }) }),
}));
jest.mock("@/lib/observability", () => ({ captureCriticalEvent: (...args: any[]) => capture(...args) }));
jest.mock("../../../_lib/crypto", () => ({ encryptString: (value: string) => `encrypted:${value}` }));
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "server-time" } }));
jest.mock("next/server", () => ({ NextResponse: { redirect: (url: string, opts: any) => ({ url, status: opts.status, headers: new Headers(), cookies: { set: jest.fn() } }) } }));

import { GET } from "./route";

function req(cookies: Record<string, string | undefined> = { __session: "session", vercel_oauth_state: "state-123" }, params = "code=private-code&state=state-123&teamId=team_1&configurationId=config_1") {
    return { url: `https://kloner.app/api/vercel/oauth/callback?${params}`, headers: new Headers({ "x-vercel-id": "platform-req", "user-agent": "Mozilla/5.0", "x-vercel-forwarded-for": "192.0.2.1" }), cookies: { get: (key: string) => cookies[key] ? { value: cookies[key] } : undefined } } as any;
}

beforeEach(() => {
    jest.clearAllMocks();
    verify.mockResolvedValue({ uid: "verified-user", email: "verified@example.com" });
    save.mockResolvedValue(undefined);
    process.env.VERCEL_OAUTH_REDIRECT_URI = "https://kloner.app/api/vercel/oauth/callback";
    process.env.VERCEL_OAUTH_CLIENT_ID = "client-id";
    process.env.VERCEL_OAUTH_CLIENT_SECRET = "client-secret";
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ access_token: "private-access-token", team_id: "verified-provider-team" }) })) as any;
});

test("missing sessions have factual context without invented user identity or leaked secrets", async () => {
    verify.mockRejectedValueOnce(Object.assign(new Error("Unauthorized"), { status: 401 }));
    const response: any = await GET(req({}));
    expect(response.status).toBe(302);
    expect(response.headers.get("x-kloner-request-id")).toBe("platform-req");
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ component: "nextjs-server", requestId: "platform-req", userId: undefined, statusCode: 401, extra: expect.objectContaining({ hasSession: false, hasStateCookie: false, identityStatus: "no session cookie", authFailureCode: "SESSION_COOKIE_MISSING", httpResponseStatus: 302 }) }));
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private-code");
    expect(JSON.stringify(capture.mock.calls)).not.toContain("state-123");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
});

test.each([{ __session: "session" }, { __session: "session", vercel_oauth_state: "wrong-state" }])("missing or mismatched state cannot exchange tokens: %p", async cookies => {
    const response: any = await GET(req(cookies));
    expect(response.url).toContain("reason=state");
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ userId: "verified-user", statusCode: 403 }));
    expect(global.fetch).not.toHaveBeenCalled();
});

test("expired sessions retain the SDK reason, while infrastructure errors are 500s", async () => {
    verify.mockRejectedValueOnce({ status: 401, authCode: "auth/session-cookie-expired" });
    await GET(req());
    expect(capture.mock.calls[0][0]).toMatchObject({ statusCode: 401, extra: { authFailureCode: "auth/session-cookie-expired", identityStatus: "session cookie rejected" } });
    verify.mockRejectedValueOnce({ status: 401, authCode: "auth/internal-error" });
    await GET(req());
    expect(capture.mock.calls[1][0].statusCode).toBe(500);
});

test("one flow's failures share an incident key despite changing codes and configurations", async () => {
    verify.mockRejectedValue({ status: 401 });
    await GET(req({}, "code=one&state=same&teamId=team_1&configurationId=one"));
    await GET(req({}, "code=two&state=same&teamId=team_1&configurationId=two"));
    expect(capture.mock.calls[0][0].extra.oauthIncidentKey).toBe(capture.mock.calls[1][0].extra.oauthIncidentKey);
});

test("valid state and session save encrypted tokens and honor an encoded local return path", async () => {
    verify.mockResolvedValue({ uid: "verified-user", email: "verified@example.com" });
    const response: any = await GET(req({ __session: "session", vercel_oauth_state: "state-123", vercel_oauth_return: encodeURIComponent("/dashboard/view?vercel=connected") }));
    expect(response.url).toContain("/dashboard/view?vercel=connected");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "encrypted:private-access-token", vercelTeamId: "verified-provider-team", connected: true }), { merge: true });
    expect(capture).not.toHaveBeenCalled();
});

test("an external return cookie cannot redirect a successful connection off-site", async () => {
    const response: any = await GET(req({ __session: "session", vercel_oauth_state: "state-123", vercel_oauth_return: "https://evil.example" }));
    expect(response.url).not.toContain("evil.example");
    expect(response.url).toContain("/integrations/vercel/callback");
});

test("provider and storage failures retain verified user context without token data", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 429 });
    await GET(req());
    expect(capture.mock.calls[0][0]).toMatchObject({ userId: "verified-user", statusCode: 502, extra: { providerStatus: 429 } });
    save.mockRejectedValueOnce(new Error("db unavailable"));
    await GET(req());
    expect(capture.mock.calls[1][0]).toMatchObject({ userId: "verified-user", statusCode: 500, extra: { reason: "db" } });
    expect(JSON.stringify(capture.mock.calls)).not.toContain("private-access-token");
});
