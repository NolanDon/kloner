export {};

const captureCriticalEventMock = jest.fn<Promise<{ delivered: boolean; eventId: string }>, [any]>(async (_event: any) => ({
    delivered: true,
    eventId: "evt_1",
}));

jest.mock("@/lib/observability", () => ({
    __esModule: true,
    captureCriticalEvent: (event: any) => captureCriticalEventMock(event),
}));

jest.mock("@/app/api/_lib/route-guard", () => ({
    __esModule: true,
    requireSessionAndMaybeCsrf: async (_req: any, handler: any) => handler({
        uid: "uid_scan_1",
        req: _req,
    }),
}));

describe("POST /api/internal/observability/frontend-timeout", () => {
    beforeEach(() => {
        captureCriticalEventMock.mockClear();
    });

    it("reports a delayed terminal URL scan error with the URL and backend error details", async () => {
        const { POST } = await import("./route");
        const req: any = {
            headers: {
                get(name: string) {
                    const values: Record<string, string> = {
                        "user-agent": "Mozilla/5.0 Chrome/140",
                        origin: "https://kloner.app",
                        referer: "https://kloner.app/dashboard",
                    };
                    return values[name] || "";
                },
            },
            json: async () => ({
                action: "url_capture_terminal_error",
                route: "/dashboard/view",
                service: "dashboard-view",
                statusCode: 502,
                status: "error",
                code: "SNAPSHOT_FAILED",
                message: "URL capture failed for https://sweetjojomahjong.com/: archive unavailable",
                previewUrl: "https://sweetjojomahjong.com/",
                tags: ["url-capture", "terminal-error", "frontend"],
            }),
        };

        const response: any = await POST(req);
        expect(response.status).toBe(200);
        expect(captureCriticalEventMock).toHaveBeenCalledTimes(1);
        expect(captureCriticalEventMock.mock.calls[0][0]).toMatchObject({
            source: "frontend",
            severity: "critical",
            statusCode: 502,
            action: "url_capture_terminal_error",
            userId: "uid_scan_1",
            url: "https://sweetjojomahjong.com/",
            message: "URL capture failed for https://sweetjojomahjong.com/: archive unavailable",
            tags: ["url-capture", "terminal-error", "frontend"],
            extra: expect.objectContaining({
                code: "SNAPSHOT_FAILED",
                requestContext: expect.objectContaining({ callerType: "frontend-browser" }),
            }),
        });
    });
    it.each(["url_editor_navigation_error", "url_capture_terminal_error"])("identifies editor timeouts without inventing backend errors: %s", async action => {
        const { POST } = await import("./route");
        const req: any = { headers: new Headers(), json: async () => ({ action, appId: "completed-app", statusCode: 502,
            code: action === "url_editor_navigation_error" ? "EDITOR_NAVIGATION_TIMEOUT" : "URL_CAPTURE_TERMINAL_ERROR",
            message: "URL capture failed for https://remowers.shop/: Opening your editor timed out after 5 minutes. Return to the dashboard and open your completed app again.",
            backend: { status: "ready", code: "URL_CAPTURE_TERMINAL_ERROR", message: "Opening your editor timed out after 5 minutes." } }) };
        await POST(req);
        const event = captureCriticalEventMock.mock.calls[0][0];
        expect(event).toMatchObject({ action: "url_editor_navigation_error", statusCode: 504, severity: "error", extra: { appId: "completed-app", classification: "editor_navigation_timeout", backendStatus: "ready" } });
        expect(event.message).toMatch(/^Editor opening failed for /);
        expect(event.extra.backendMessage).toBeUndefined();
        expect(event.extra.backendCode).toBeUndefined();
        expect(event.extra.uiMessage).toContain("Opening your editor");
    });

});

test('a frontend preview timeout is an error with a human sentence and structured diagnostics', async () => {
    captureCriticalEventMock.mockClear();
    const { POST } = await import('./route');
    await POST({ headers: new Headers(), json: async () => ({
        action: 'preview_timeout_12min', severity: 'critical', statusCode: 504, status: 'poll_timeout',
        message: 'Preview polling exceeded 12-minute hard timeout in WebContainerRunner while connecting to machine abc.',
        machineId: 'abc', userAgent: 'Chrome Android', reason: 'poll_timeout',
    }) } as any);
    expect(captureCriticalEventMock.mock.calls[0][0]).toMatchObject({
        severity: 'error', statusCode: 504,
        message: 'A user could not open their preview before the connection timed out.',
        extra: { classification: 'preview_connection_timeout', diagnosticMessage: expect.stringContaining('12-minute'), userAgent: 'Chrome Android' },
    });
});
