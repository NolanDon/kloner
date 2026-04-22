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
const consumeUserCredit = jest.fn();

jest.mock("@/src/lib/callBackend", () => {
    return {
        __esModule: true,
        callBackend: (...args: any[]) => callBackend(...args),
    };
});

jest.mock("../_lib/route-guard", () => {
    return {
        __esModule: true,
        requireSessionAndMaybeCsrf: async (_req: any, handler: any) => handler({ uid: "uid_1", req: _req }),
    };
});

jest.mock("../_lib/auth", () => {
    return {
        __esModule: true,
        verifySession: async () => ({ uid: "uid_1", email: "user@example.com" }),
    };
});

jest.mock("../_lib/userTier", () => {
    return {
        __esModule: true,
        getAuthoritativeUserTier: async () => "pro",
    };
});

jest.mock("../_lib/credits-server", () => {
    return {
        __esModule: true,
        peekUserCredit: (...args: any[]) => peekUserCredit(...args),
        consumeUserCredit: (...args: any[]) => consumeUserCredit(...args),
    };
});

jest.mock("@/src/lib/publicHttpUrl", () => {
    return {
        __esModule: true,
        validateAndNormalizePublicHttpUrl: (url: string) => url,
        getPublicHttpUrlRejectionReason: () => null,
    };
});

describe("POST /api/generate-app-from-url", () => {
    beforeEach(() => {
        callBackend.mockReset();
        peekUserCredit.mockReset();
        consumeUserCredit.mockReset();
        peekUserCredit.mockResolvedValue({ ok: true, remaining: 10 });
        consumeUserCredit.mockResolvedValue(undefined);
        callBackend.mockResolvedValue({
            status: 202,
            json: { appId: "app_123", jobId: "job_123", accepted: true, status: "queued", message: "Accepted" },
            reqId: "req_1",
            url: "https://backend.example/api/v1/generate-app-from-url",
        });
        jest.resetModules();
    });

    it("routes url payloads to archive generation without screenshot preflight", async () => {
        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({
                url: "https://example.com",
                name: "Example",
            }),
        };

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(202);
        expect(body.appId).toBe("app_123");
        expect(body.jobId).toBe("job_123");
        expect(body.accepted).toBe(true);
        expect(callBackend).toHaveBeenCalledTimes(1);
        expect(callBackend.mock.calls[0][1]).toMatchObject({
            path: "/generate-app-from-url",
            method: "POST",
            body: {
                url: "https://example.com",
                name: "Example",
                createPreview: true,
            },
        });
        expect(peekUserCredit).toHaveBeenCalledWith("uid_1", "pro", "preview");
        expect(consumeUserCredit).toHaveBeenCalledWith("uid_1", "pro", "preview");
    });

    it("does not burn preview credits when the backend response is terminal failure shaped", async () => {
        callBackend.mockResolvedValueOnce({
            status: 202,
            json: {
                appId: "app_123",
                accepted: false,
                code: "ARCHIVE_ZIP_MISSING",
                details: { stage: "archive_preflight" },
                error: "Archive zip missing",
            },
            reqId: "req_2",
            url: "https://backend.example/api/v1/generate-app-from-url",
        });

        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({
                url: "https://example.com",
                name: "Example",
            }),
        };

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.code).toBe("ARCHIVE_ZIP_MISSING");
        expect(consumeUserCredit).not.toHaveBeenCalled();
    });
});