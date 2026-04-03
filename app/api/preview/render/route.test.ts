export {};

jest.mock("next/server", () => {
    return {
        __esModule: true,
        NextResponse: {
            json: (body: any, init?: { status?: number }) => {
                return {
                    status: init?.status ?? 200,
                    async json() {
                        return body;
                    },
                };
            },
        },
    };
});

const callBackend = jest.fn();
const peekUserCredit = jest.fn();

jest.mock("@/src/lib/callBackend", () => {
    return {
        __esModule: true,
        callBackend: (...args: any[]) => callBackend(...args),
    };
});

jest.mock("../../_lib/auth", () => {
    return {
        __esModule: true,
        verifySession: async () => ({ uid: "uid_1", email: "user@example.com" }),
    };
});

jest.mock("../../_lib/route-guard", () => {
    return {
        __esModule: true,
        requireSessionAndMaybeCsrf: async (_req: any, handler: any) => handler({ req: _req }),
    };
});

jest.mock("../../_lib/userTier", () => {
    return {
        __esModule: true,
        getAuthoritativeUserTier: async () => "pro",
    };
});

jest.mock("../../_lib/credits-server", () => {
    return {
        __esModule: true,
        peekUserCredit: (...args: any[]) => peekUserCredit(...args),
        consumeUserCredit: jest.fn(),
    };
});

describe("POST /api/preview/render", () => {
    beforeEach(() => {
        callBackend.mockReset();
        peekUserCredit.mockReset();
        jest.resetModules();
    });

    it("returns Missing keys when screenshot storage keys are absent", async () => {
        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({
                url: "https://example.com",
                createPreview: true,
            }),
        };

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.error).toBe("Missing keys");
        expect(callBackend).not.toHaveBeenCalled();
        expect(peekUserCredit).not.toHaveBeenCalled();
    });
});
