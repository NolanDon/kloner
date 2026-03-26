export {};

const setMock = jest.fn<Promise<void>, [any]>(async () => {});
const docMock = jest.fn(() => ({
    id: "evt_test_1",
    set: setMock,
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
});
