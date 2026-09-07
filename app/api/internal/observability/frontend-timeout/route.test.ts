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
});
