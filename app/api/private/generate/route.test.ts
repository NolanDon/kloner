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
    captureCriticalEvent: async () => undefined,
}));

describe("POST /api/private/generate", () => {
    beforeEach(() => {
        callBackend.mockReset();
        peekUserCredit.mockReset();
        consumeUserCredit.mockReset();
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
        expect(body.error).toBe("Sexually explicit, financial-account, and dangerous-use URLs are blocked.");
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
        expect(body.error).toBe("Sexually explicit, financial-account, and dangerous-use URLs are blocked.");
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
});