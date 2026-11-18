jest.mock("../../_lib/route-guard", () => ({
    requireSessionAndMaybeCsrf: jest.fn(async (_req: Request, handler: any) => handler({ uid: "user-123", req: _req })),
}));

jest.mock("../../_lib/appBuilderScope", () => ({ assertAppBuilderScope: jest.fn() }));
jest.mock("@/src/lib/callBackend", () => ({ callBackend: jest.fn() }));
jest.mock("@/lib/observability", () => ({ captureAuditEvent: jest.fn() }));

import { POST } from "./route";
import { callBackend } from "@/src/lib/callBackend";
import { captureAuditEvent } from "@/lib/observability";

describe("/api/app-embeddings/agent-v3", () => {
    beforeEach(() => jest.clearAllMocks());

    it("captures backend diagnostics for a no-changes mutation while preserving its response", async () => {
        const backendResponse = {
            ok: false,
            code: "WORKSPACE_AUTONOMY_V3_NO_CHANGES",
            message: "No files changed",
            requestId: "backend-request-1",
            jobId: "job-1",
            debug: {
                model: "gemini-2.5-flash-lite",
                mutationRequested: true,
                successfulMutationToolCall: false,
                changedFiles: [],
                toolTrace: [{ turn: 1, name: "search_text", ok: true }],
            },
        };
        (callBackend as jest.Mock).mockResolvedValue({
            status: 422,
            json: backendResponse,
            reqId: "proxy-request-1",
        });

        const response = await POST(new Request("http://localhost/api/app-embeddings/agent-v3", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                appId: "draftapp_123",
                query: "Rename it to TSA holding group",
                currentPath: "public/index.html",
            }),
        }) as any);

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toEqual(backendResponse);
        expect(captureAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
            action: "app_embeddings_agent_v3_no_changes",
            requestId: "proxy-request-1",
            extra: expect.objectContaining({
                appId: "draftapp_123",
                currentPath: "public/index.html",
                backendRequestId: "backend-request-1",
                jobId: "job-1",
                userRequest: "Rename it to TSA holding group",
                debug: backendResponse.debug,
            }),
        }));
    });

    it("does not capture unrelated backend errors", async () => {
        (callBackend as jest.Mock).mockResolvedValue({ status: 503, json: { code: "BACKEND_BUSY" }, reqId: "req-2" });
        const response = await POST(new Request("http://localhost/api/app-embeddings/agent-v3", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ appId: "draftapp_123", query: "Rename it" }),
        }) as any);

        expect(response.status).toBe(503);
        expect(captureAuditEvent).not.toHaveBeenCalled();
    });
});
