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
const getAuthoritativeUserTier = jest.fn();
const appRefGet = jest.fn();
const appRefSet = jest.fn();
const appRef = {
    get: (...args: any[]) => appRefGet(...args),
    set: (...args: any[]) => appRefSet(...args),
};
const collectionKlonerApps = jest.fn(() => ({
    doc: () => appRef,
}));
const collectionKlonerUsers = jest.fn(() => ({
    doc: () => ({
        collection: collectionKlonerApps,
    }),
}));
const getAdminDb = jest.fn(() => ({
    collection: collectionKlonerUsers,
}));

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
        getAdminDb: () => getAdminDb(),
    };
});

jest.mock("../_lib/userTier", () => {
    return {
        __esModule: true,
        getAuthoritativeUserTier: (...args: any[]) => getAuthoritativeUserTier(...args),
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
        getAuthoritativeUserTier.mockReset();
        getAuthoritativeUserTier.mockResolvedValue("pro");
        getAdminDb.mockClear();
        collectionKlonerUsers.mockClear();
        collectionKlonerApps.mockClear();
        appRefGet.mockReset();
        appRefSet.mockReset();
        peekUserCredit.mockResolvedValue({ ok: true, remaining: 10 });
        consumeUserCredit.mockResolvedValue(undefined);
        appRefGet.mockResolvedValue({ exists: false, data: () => ({}) });
        appRefSet.mockResolvedValue(undefined);
        callBackend.mockResolvedValue({
            status: 202,
            json: { appId: "app_123", jobId: "job_123", accepted: true, status: "queued", message: "Accepted" },
            reqId: "req_1",
            url: "https://backend.example/api/v1/generate-app-from-url",
        });
        jest.resetModules();
    });

    it("returns the early paywall before checking credits or calling the backend", async () => {
        process.env.EARLY_PAYWALL_COUNTRIES = "BD";
        getAuthoritativeUserTier.mockResolvedValue("free");
        const { POST } = await import("./route");
        const req: any = {
            headers: new Headers({ "cf-ipcountry": "BD" }),
            json: async () => ({ url: "https://example.com", name: "Example" }),
        };

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(402);
        expect(body).toMatchObject({
            code: "EARLY_GENERATION_PAYWALL_REQUIRED",
            paywallRequired: true,
        });
        expect(peekUserCredit).not.toHaveBeenCalled();
        expect(callBackend).not.toHaveBeenCalled();
        delete process.env.EARLY_PAYWALL_COUNTRIES;
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
                generationType: "nextjs",
                generationFormat: "nextjs",
            },
        });
        expect(peekUserCredit).toHaveBeenCalledWith("uid_1", "pro", "preview");
        expect(consumeUserCredit).toHaveBeenCalledWith("uid_1", "pro", "preview");
    });

    it("forwards html generation type when requested", async () => {
        const { POST } = await import("./route");
        const req: any = {
            json: async () => ({
                url: "https://example.com",
                name: "Example",
                generationType: "html",
            }),
        };

        const res: any = await POST(req);
        await res.json();

        expect(res.status).toBe(202);
        expect(callBackend.mock.calls[0][1]).toMatchObject({
            body: {
                generationType: "html",
                generationFormat: "html",
            },
        });
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

    it("returns a hard 413 when the backend reports gemini_input_too_large", async () => {
        callBackend.mockResolvedValueOnce({
            status: 202,
            json: {
                appId: "app_123",
                jobId: "job_123",
                accepted: false,
                code: "gemini_input_too_large",
                error: "Input too large",
            },
            reqId: "req_3",
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

        expect(res.status).toBe(413);
        expect(body.code).toBe("gemini_input_too_large");
        expect(body.error).toBe("Input too large");
        expect(consumeUserCredit).not.toHaveBeenCalled();
    });

    it("forwards archive-size paywall details from an upstream 402", async () => {
        callBackend.mockResolvedValueOnce({
            status: 402,
            json: {
                ok: false,
                error: "This website is too large for the Free plan.",
                code: "ARCHIVE_SIZE_LIMIT_REACHED",
                paywallRequired: true,
                paywallReason: "archive_size_limit",
                upgrade: { requiredPlan: "pro", action: "upgrade" },
            },
            reqId: "req_paywall",
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

        expect(res.status).toBe(402);
        expect(body).toMatchObject({
            error: "This website is too large for the Free plan.",
            code: "ARCHIVE_SIZE_LIMIT_REACHED",
            paywallRequired: true,
            paywallReason: "archive_size_limit",
            upgrade: { requiredPlan: "pro", action: "upgrade" },
            upstreamStatus: 402,
            reqId: "req_paywall",
        });
        expect(consumeUserCredit).not.toHaveBeenCalled();
    });

    it("maps upstream 404 responses to route mismatch errors", async () => {
        callBackend.mockResolvedValueOnce({
            status: 404,
            json: {
                error: "Not found",
                scope: "api.v1",
                path: "/api/v1/generate-app-from-url",
            },
            reqId: "req_4",
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

        expect(res.status).toBe(404);
        expect(body.code).toBe("BACKEND_ROUTE_NOT_FOUND");
        expect(body.error).toBe("The generation service is temporarily unavailable. Please try again in a bit.");
        expect(body.scope).toBe("api.v1");
        expect(body.path).toBe("/api/v1/generate-app-from-url");
        expect(body.details).toMatchObject({
            backendError: "Not found",
            scope: "api.v1",
            path: "/api/v1/generate-app-from-url",
        });
        expect(consumeUserCredit).not.toHaveBeenCalled();
    });
});
