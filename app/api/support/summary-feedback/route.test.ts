export {};

const fetchMock = jest.fn();

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

jest.mock("../../_lib/route-guard", () => ({
    requireSessionAndMaybeCsrf: async (_req: Request, handler: any) => handler({ uid: "user-123", req: _req }),
}));

describe("POST /api/support/summary-feedback", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.SLACK_ERROR_WEBHOOK_URL = "https://hooks.slack.com/services/test";
        process.env.SLACK_WEBHOOK_URL = "";
        (global as any).fetch = fetchMock;
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => "ok",
        });
    });

    it("posts the edit-plan diagnostic report to Slack with the report code", async () => {
        const { POST } = await import("./route");

        const response = await POST(
            new Request("http://localhost/api/support/summary-feedback", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    messageId: "msg_123",
                    feedback: "down",
                    reportCode: "EPR-APP1-USER-JOBREPOR-REQREP",
                    jobId: "job_123",
                    requestId: "req_123",
                    summaryText: "Added nav bar and animation",
                    summary: "The response asked for more context even though the target existed.",
                    reportOutcome: { code: "NEEDS_MORE_CONTEXT", reason: "Need exact file path." },
                }),
            }) as any,
        );

        const responsePayload = await response.json();

        expect(response.status).toBe(200);
        expect(responsePayload).toMatchObject({ ok: true, sent: true, posted: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [webhookUrl, requestInit] = fetchMock.mock.calls[0];
        expect(webhookUrl).toBe("https://hooks.slack.com/services/test");
        expect(requestInit.method).toBe("POST");
        const slackPayload = JSON.parse(String(requestInit.body));
        expect(slackPayload.text).toContain("[FRONTEND] Edit-plan feedback: thumbs down");
        expect(slackPayload.text).toContain("\"reportCode\": \"EPR-APP1-USER-JOBREPOR-REQREP\"");
        expect(slackPayload.text).toContain("\"jobId\": \"job_123\"");
        expect(slackPayload.text).toContain("\"requestId\": \"req_123\"");
        expect(slackPayload.text).toContain("\"summaryText\": \"Added nav bar and animation\"");
        expect(slackPayload.text).toContain("\"failureDetail\": \"NEEDS_MORE_CONTEXT\"");
        expect(slackPayload.text).toContain("\"backendInstruction\": \"Inspect the project files tied to this reportCode/jobId, identify the exact file(s) that should have been edited, and use that to correct file selection and fallback behavior in the edit-plan system.\"");
        expect(slackPayload.text).toContain("Human note: The response asked for more context even though the target existed.");
        expect(slackPayload.text).not.toContain("currentPath");
        expect(slackPayload.text).not.toContain("traceSummary");
        expect(slackPayload.text).not.toContain("Request / response snapshot");
    });

    it("still accepts older feedback payloads without report fields", async () => {
        const { POST } = await import("./route");

        const response = await POST(
            new Request("http://localhost/api/support/summary-feedback", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    appId: "draftapp_123",
                    messageId: "msg_456",
                    summary: "Needs improvement",
                    feedback: "down",
                    context: {
                        query: "please add a nav bar",
                        currentPath: "public/index.html",
                        requestedAt: Date.now(),
                        jobId: "job_456",
                        requestId: "req_456",
                        search: { request: { q: "x" }, response: { ok: true } },
                    },
                }),
            }) as any,
        );

        const responsePayload = await response.json();

        expect(response.status).toBe(200);
        expect(responsePayload).toMatchObject({ ok: true, sent: true, posted: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const slackPayload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(slackPayload.text).toContain("[FRONTEND] Edit-plan feedback: thumbs down");
        expect(slackPayload.text).toContain("\"reportCode\": \"unknown\"");
        expect(slackPayload.text).toContain("Human note: Needs improvement");
    });
});
