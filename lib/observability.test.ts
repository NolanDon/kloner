export {};

const setMock = jest.fn<Promise<void>, [any]>(async () => {});
const createMock = jest.fn<Promise<void>, [any]>(async () => {});
const docMock = jest.fn(() => ({
    id: "evt_test_1",
    set: setMock,
    create: createMock,
}));
const collectionMock = jest.fn(() => ({
    doc: docMock,
}));

jest.mock("@/app/api/_lib/auth", () => ({
    __esModule: true,
    getAdminDb: () => ({
        collection: collectionMock,
    }),
}));

describe("observability Slack formatting", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.SLACK_ERROR_WEBHOOK_URL = "https://hooks.slack.test/services/a/b/c";
        process.env.SLACK_WEBHOOK_URL = "";
        process.env.SLACK_ERROR_CHANNEL = "";
        process.env.OBS_PROJECT_NAME = "kloner";

        global.fetch = jest.fn(async () => ({
            ok: true,
            status: 200,
            text: async () => "ok",
        })) as any;
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it("prepends [FRONTEND] in Slack title, message section, and body text for frontend events", async () => {
        const { captureCriticalEvent } = await import("./observability");

        await captureCriticalEvent({
            source: "frontend",
            severity: "critical",
            statusCode: 500,
            route: "/api/webcontainer-status",
            requestId: "req_123",
            message: "Preview timeout while loading",
            action: "preview_timeout",
            stack: "Error: timeout\n at loader",
            extra: { retryCount: 3 },
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(String(fetchArgs[1].body));

        expect(body.text).toContain("[FRONTEND]");

        const headerBlock = body.blocks.find((b: any) => b.type === "header");
        expect(headerBlock.text.text).toContain("[FRONTEND]");

        const messageBlock = body.blocks.find(
            (b: any) => b.type === "section" && typeof b.text?.text === "string" && b.text.text.includes("*Message:*"),
        );
        expect(messageBlock.text.text).toContain("[FRONTEND]");
    });

    it("prepends [FRONTEND] for browser-originated frontend requests even when the source is internal", async () => {
        const { captureCriticalEvent } = await import("./observability");

        await captureCriticalEvent({
            source: "internal",
            severity: "error",
            statusCode: 500,
            route: "/api/support/summary-feedback",
            requestId: "req_frontend_browser",
            message: "Slack feedback failed",
            action: "api.post",
            extra: {
                requestContext: {
                    callerType: "frontend-browser",
                },
            },
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(String(fetchArgs[1].body));

        expect(body.text).toContain("[FRONTEND]");

        const headerBlock = body.blocks.find((b: any) => b.type === "header");
        expect(headerBlock.text.text).toContain("[FRONTEND]");

        const messageBlock = body.blocks.find(
            (b: any) => b.type === "section" && typeof b.text?.text === "string" && b.text.text.includes("*Message:*"),
        );
        expect(messageBlock.text.text).toContain("[FRONTEND]");
    });

    it("does not prepend [FRONTEND] for non-frontend events", async () => {
        const { captureCriticalEvent } = await import("./observability");

        await captureCriticalEvent({
            source: "internal",
            severity: "critical",
            statusCode: 500,
            route: "/api/internal/task",
            requestId: "req_456",
            message: "Internal worker failed",
            action: "worker_failure",
        });

        const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(String(fetchArgs[1].body));

        expect(body.text).not.toContain("[FRONTEND]");

        const headerBlock = body.blocks.find((b: any) => b.type === "header");
        expect(headerBlock.text.text).not.toContain("[FRONTEND]");

        const messageBlock = body.blocks.find(
            (b: any) => b.type === "section" && typeof b.text?.text === "string" && b.text.text.includes("*Message:*"),
        );
        expect(messageBlock.text.text).not.toContain("[FRONTEND]");
    });

    it("prepends [PROXY] for url-generate proxy failures and surfaces downstream details", async () => {
        const { captureCriticalEvent } = await import("./observability");

        await captureCriticalEvent({
            source: "internal",
            severity: "critical",
            statusCode: 500,
            route: "/api/private/generate",
            requestId: "req_proxy_1",
            message: "URL scan failed: Internal server error",
            action: "url_scan_failed",
            service: "url-generate-proxy",
            extra: {
                backendStatus: 500,
                backendCode: "SCAN_BACKEND_500",
                backendRequestId: "backend_req_123",
                backendSource: "generate-screenshots",
                backendMessage: "Internal server error",
                backendRaw: "{\"error\":\"Internal server error\"}",
                url: "https://example.com",
            },
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(String(fetchArgs[1].body));

        expect(body.text).toContain("[PROXY]");

        const headerBlock = body.blocks.find((b: any) => b.type === "header");
        expect(headerBlock.text.text).toContain("[PROXY]");

        const messageBlock = body.blocks.find(
            (b: any) => b.type === "section" && typeof b.text?.text === "string" && b.text.text.includes("*Message:*"),
        );
        expect(messageBlock.text.text).toContain("[PROXY]");
        expect(messageBlock.text.text).toContain("Internal server error");

        const contextBlock = body.blocks.find(
            (b: any) => b.type === "section" && typeof b.text?.text === "string" && b.text.text.includes("*Request Context:*"),
        );
        expect(contextBlock.text.text).toContain("Backend status: 500");
        expect(contextBlock.text.text).toContain("Backend code: SCAN_BACKEND_500");
        expect(contextBlock.text.text).toContain("Backend req: backend_req_123");
        expect(contextBlock.text.text).toContain("Backend source: generate-screenshots");
    });

    it("delivers localhost API failures to Slack unless localhost suppression is enabled", async () => {
        const { captureCriticalEvent } = await import("./observability");

        await captureCriticalEvent({
            source: "vercel",
            severity: "critical",
            statusCode: 502,
            route: "/api/preview/render",
            method: "POST",
            requestId: "req_local_502",
            url: "http://localhost:3000/api/preview/render",
            message: "Proxy failed (render)",
            action: "api.post",
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(String(fetchArgs[1].body));

        expect(body.text).toContain("Proxy failed (render)");
        const headerBlock = body.blocks.find((b: any) => b.type === "header");
        expect(headerBlock.text.text).toContain("502");
    });

    it("still delivers url scan backend failures for suppressed users", async () => {
        const { captureCriticalEvent } = await import("./observability");

        await captureCriticalEvent({
            source: "internal",
            severity: "critical",
            statusCode: 422,
            route: "/api/private/generate",
            action: "url_scan_failed",
            userId: "FJPV123456",
            requestId: "req_url_scan_422",
            url: "https://techden.io/",
            service: "url-generate-proxy",
            message: "URL scan failed: Unable to reach target URL",
            tags: ["url-scan", "generate", "backend-failure"],
            extra: { backendStatus: 422, upstreamOk: false },
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(String(fetchArgs[1].body));

        expect(body.text).toContain("Unable to reach target URL");
        expect(body.text).toContain("422");
    });

    it("keeps Slack payloads compact by default", async () => {
        const { captureCriticalEvent } = await import("./observability");

        await captureCriticalEvent({
            source: "internal",
            severity: "critical",
            statusCode: 500,
            route: "/api/test/compact",
            requestId: "req_compact",
            message: "Compact payload check",
            action: "compact_payload_check",
            url: "https://example.com/test",
            stack: "Error: line 1\n at fn1\n at fn2",
            extra: {
                callerType: "api",
                ip: "127.0.0.1",
                browser: "Chrome",
                userAgent: "Mozilla/5.0",
                origin: "https://example.com",
                referer: "https://example.com/page",
                hasSession: true,
                jobId: "job_123",
                machineId: "machine_456",
                nested: { too: "much" },
            },
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(String(fetchArgs[1].body));

        const bodyText = JSON.stringify(body);
        expect(bodyText).not.toContain("*Stack:*");
        expect(bodyText).not.toContain("*Debug:*");
        expect(bodyText).toContain("*Message:*");
        expect(bodyText).toContain("*Source:*");
        expect(bodyText).toContain("*Route/Page:*");
        expect(bodyText).toContain("*Action:*");
    });

    it("includes the tried URL in Slack context for frontend URL capture stalls", async () => {
        const { captureCriticalEvent } = await import("./observability");

        await captureCriticalEvent({
            source: "frontend",
            severity: "critical",
            statusCode: 504,
            route: "/dashboard/view",
            method: "POST",
            requestId: "req_frontend_timeout",
            action: "url_capture_stalled",
            service: "dashboard-view",
            message: "URL capture stayed queued/processing for more than 6 minutes without completion.",
            url: "https://example.com/tried-url",
            extra: {
                requestContext: {
                    callerType: "frontend-browser",
                },
            },
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(String(fetchArgs[1].body));

        expect(body.text).toContain("URL capture stayed queued/processing");

        const contextBlock = body.blocks.find(
            (b: any) => b.type === "section" && typeof b.text?.text === "string" && b.text.text.includes("*Request Context:*"),
        );
        expect(contextBlock.text.text).toContain("URL: https://example.com/tried-url");
    });
});
