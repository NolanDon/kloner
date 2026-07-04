jest.mock("../../_lib/route-guard", () => ({
    requireSessionAndMaybeCsrf: jest.fn(async (_req: Request, handler: any) => {
        return handler({
            uid: "user-123",
            req: _req,
        });
    }),
}));

jest.mock("../../_lib/appBuilderScope", () => ({
    assertAppBuilderScope: jest.fn(),
}));

jest.mock("@/src/lib/callBackend", () => ({
    callBackend: jest.fn(),
}));

import { POST } from "./route";
import { callBackend } from "@/src/lib/callBackend";

describe("/api/app-embeddings/edit-plan", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("forwards the edit-plan request to the backend without worker management", async () => {
        (callBackend as jest.Mock).mockResolvedValue({
            status: 200,
            json: {
                ok: true,
                result: {
                    summary: "ok",
                },
            },
            reqId: "req-abc",
            upstream: {
                headers: new Headers(),
            },
        });

        const req = new Request("http://localhost/api/app-embeddings/edit-plan", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-request-id": "req-abc",
            },
            body: JSON.stringify({
                appId: "draftapp_123",
                query: "please add a nav bar",
                requestText: "please add a nav bar",
                currentPath: "public/index.html",
                selectedFiles: ["public/index.html", "components/Nav.tsx"],
                maxChunks: 10,
                search: [{ path: "public/index.html", chunkText: "hello" }],
                framework: "html-js",
                frameworkLabel: "HTML/JS",
                frameworkConfidence: "high",
                frameworkReason: "public/index.html exists",
            }),
        });

        const response = await POST(req as any);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toMatchObject({
            ok: true,
            result: {
                summary: "ok",
            },
            reqId: "req-abc",
        });

        expect(callBackend).toHaveBeenCalledTimes(1);
        expect(callBackend).toHaveBeenCalledWith(
            expect.any(Request),
            expect.objectContaining({
                path: "/app-embeddings/edit-plan",
                method: "POST",
                timeoutMs: 45_000,
                userCtx: { uid: "user-123" },
                body: expect.objectContaining({
                    appId: "draftapp_123",
                    query: "please add a nav bar",
                    requestText: "please add a nav bar",
                    currentPath: "public/index.html",
                    selectedFiles: ["public/index.html", "components/Nav.tsx"],
                    maxChunks: 10,
                    search: [{ path: "public/index.html", chunkText: "hello" }],
                    framework: "html-js",
                    frameworkLabel: "HTML/JS",
                    frameworkConfidence: "high",
                    frameworkReason: "public/index.html exists",
                }),
            }),
        );
    });

    it("does not emit EDIT_PLAN_WORKER_OFFLINE when the backend returns an error", async () => {
        (callBackend as jest.Mock).mockResolvedValue({
            status: 503,
            json: {
                ok: false,
                error: "backend busy",
                code: "BACKEND_BUSY",
            },
            reqId: "req-def",
            upstream: {
                headers: new Headers(),
            },
        });

        const req = new Request("http://localhost/api/app-embeddings/edit-plan", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                appId: "draftapp_123",
                query: "please add a nav bar",
            }),
        });

        const response = await POST(req as any);
        const payload = await response.json();

        expect(response.status).toBe(503);
        expect(payload).toMatchObject({
            ok: false,
            error: "backend busy",
            code: "BACKEND_BUSY",
            reqId: "req-def",
        });
        expect(JSON.stringify(payload)).not.toContain("EDIT_PLAN_WORKER_OFFLINE");
    });
});
