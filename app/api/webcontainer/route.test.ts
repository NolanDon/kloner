export {};

const callBackend = jest.fn();

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

jest.mock("@/src/lib/callBackend", () => ({
    __esModule: true,
    callBackend: (...args: any[]) => callBackend(...args),
}));

jest.mock("../../api/_lib/route-guard", () => ({
    __esModule: true,
    requireSessionAndMaybeCsrf: async (_req: any, handler: any) => handler({ uid: "uid_1", req: _req }),
}));

jest.mock("../../api/_lib/appBuilderScope", () => ({
    __esModule: true,
    assertAppBuilderScope: () => undefined,
}));

describe("POST /api/webcontainer", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.INTERNAL_API_SECRET = "test-internal-secret";
        callBackend.mockResolvedValue({
            status: 503,
            upstream: {
                status: 503,
                headers: {
                    get: (name: string) => (name.toLowerCase() === "x-request-id" ? "upstream_req_123" : null),
                },
            },
            json: {
                error: "Internal server error",
                code: "WEB_CONTAINER_STARTUP_UNAVAILABLE",
                reason: "worker_pool_unavailable",
                debug: { queueDepth: 12 },
            },
            raw: JSON.stringify({
                error: "Internal server error",
                code: "WEB_CONTAINER_STARTUP_UNAVAILABLE",
                reason: "worker_pool_unavailable",
                debug: { queueDepth: 12 },
            }),
            reqId: "proxy_req_123",
            url: "https://backend.example/api/v1/webcontainer",
        });
    });

    it("preserves upstream 503 details instead of flattening them", async () => {
        const { POST } = await import("./route");
        const req: any = {
            headers: {
                get: (name: string) => (name.toLowerCase() === "x-kloner-internal" ? "test-internal-secret" : null),
            },
            json: async () => ({
                appId: "draftapp_123",
                files: {
                    "public/index.html": { content: "<html></html>", lastModified: Date.now() },
                },
            }),
        };

        const res: any = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(503);
        expect(body).toMatchObject({
            error: "Internal server error",
            code: "WEB_CONTAINER_STARTUP_UNAVAILABLE",
            reason: "worker_pool_unavailable",
            upstreamStatus: 503,
            upstreamRequestId: "proxy_req_123",
            debug: { queueDepth: 12 },
        });
        expect(callBackend).toHaveBeenCalledTimes(1);
    });
});
