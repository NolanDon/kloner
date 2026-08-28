export {};

jest.mock("next/server", () => {
    return {
        __esModule: true,
        NextResponse: {
            json: (body: any, init?: { status?: number; headers?: Record<string, string> }) => ({
                status: init?.status ?? 200,
                headers: init?.headers ?? {},
                async json() {
                    return body;
                },
            }),
        },
    };
});

const callBackend = jest.fn();
const peekUserCredit = jest.fn();
const consumeUserCredit = jest.fn();
const captureCriticalEventMock = jest.fn<Promise<unknown>, [any]>(async (_event: any) => undefined);

jest.mock("@/src/lib/callBackend", () => ({
    __esModule: true,
    callBackend: (...args: any[]) => callBackend(...args),
}));

jest.mock("../../_lib/route-guard", () => ({
    __esModule: true,
    requireSessionAndMaybeCsrf: async (_req: any, handler: any) => handler({ uid: "uid_1", req: _req }),
}));

jest.mock("../../_lib/auth", () => ({
    __esModule: true,
    verifySession: async () => ({ uid: "uid_1", email: "user@example.com" }),
}));

jest.mock("../../_lib/userTier", () => ({
    __esModule: true,
    getAuthoritativeUserTier: async () => "pro",
}));

jest.mock("../../_lib/credits-server", () => ({
    __esModule: true,
    peekUserCredit: (...args: any[]) => peekUserCredit(...args),
    consumeUserCredit: (...args: any[]) => consumeUserCredit(...args),
}));

jest.mock("@/lib/observability", () => ({
    __esModule: true,
    captureCriticalEvent: (event: any) => captureCriticalEventMock(event),
}));

describe("POST /api/private/generate", () => {
    beforeEach(() => {
        callBackend.mockReset();
        peekUserCredit.mockReset();
        consumeUserCredit.mockReset();
        captureCriticalEventMock.mockReset();
        peekUserCredit.mockResolvedValue({ ok: true, remaining: 10 });
        consumeUserCredit.mockResolvedValue(undefined);
        callBackend.mockResolvedValue({
            status: 200,
            upstream: { ok: true },
            json: { ok: true, totalPlanned: 1 },
            reqId: "req_1",
        });
    });

    it("blocks sexually explicit URLs before calling backend", async () => {
        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({ url: "https://example.com/porn/videos" }),
        };

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.error).toBe("This URL is blocked.");
        expect(callBackend).not.toHaveBeenCalled();
        expect(peekUserCredit).not.toHaveBeenCalled();
    });

    it("blocks dangerous-use URLs before calling backend", async () => {
        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({ url: "https://example.com/ransomware-builder" }),
        };

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.error).toBe("This URL is blocked.");
        expect(callBackend).not.toHaveBeenCalled();
    });

    it("normalizes safe URLs before sending them upstream", async () => {
        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({ url: "example.com" }),
        };

        const res: any = await POST(req);
        await res.json();

        expect(res.status).toBe(200);
        expect(callBackend).toHaveBeenCalledTimes(1);
        expect(callBackend.mock.calls[0][1]).toMatchObject({
            path: "/generate-screenshots",
            body: { url: "https://example.com/" },
        });
    });

    it("maps downstream 500s to a site accessibility message in the response", async () => {
        callBackend.mockResolvedValueOnce({
            status: 500,
            upstream: { ok: false, statusText: "Internal Server Error" },
            json: {
                error: "Internal server error",
                code: "SCAN_BACKEND_500",
                requestId: "backend_req_123",
                source: "generate-screenshots",
            },
            raw: JSON.stringify({
                error: "Internal server error",
                code: "SCAN_BACKEND_500",
                requestId: "backend_req_123",
                source: "generate-screenshots",
            }),
            reqId: "req_downstream_1",
        });

        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({ url: "https://example.com/" }),
        };

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(500);
        expect(body).toMatchObject({
            error: "We couldn't access example.com to scan it. Make sure the site is publicly accessible without a login, CAPTCHA, or network restriction, then try again.",
            userMessage: "We couldn't access example.com to scan it. Make sure the site is publicly accessible without a login, CAPTCHA, or network restriction, then try again.",
            code: "DOMAIN_VERIFICATION_REQUIRED",
            upstreamStatus: 500,
            upstreamStatusText: "Internal Server Error",
            upstreamCode: "SCAN_BACKEND_500",
            upstreamRequestId: "backend_req_123",
            upstreamSource: "generate-screenshots",
            upstreamMessage: "Internal server error",
            verificationUrl: "https://example.com",
            verificationDomain: "example.com",
        });
        expect(consumeUserCredit).not.toHaveBeenCalled();
        expect(captureCriticalEventMock).toHaveBeenCalledTimes(1);
        const capturedEvent = captureCriticalEventMock.mock.calls[0]?.[0];
        expect(capturedEvent).toMatchObject({
            source: "internal",
            service: "url-generate-proxy",
            action: "url_scan_failed",
            message: "URL scan failed: Internal server error",
            route: "/api/private/generate",
            extra: expect.objectContaining({
                backendStatus: 500,
                backendStatusText: "Internal Server Error",
                backendRequestId: "backend_req_123",
                backendSource: "generate-screenshots",
                backendMessage: "Internal server error",
                backendCode: "SCAN_BACKEND_500",
                backendRaw: expect.stringContaining("Internal server error"),
                downstream: expect.objectContaining({
                    status: 500,
                    statusText: "Internal Server Error",
                    code: "SCAN_BACKEND_500",
                    requestId: "backend_req_123",
                    source: "generate-screenshots",
                    message: "Internal server error",
                }),
            }),
        });
    });
});
