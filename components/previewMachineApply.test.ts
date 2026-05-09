import { postPreviewApply } from "./previewMachineApply";

describe("postPreviewApply", () => {
    test("posts direct browser apply request to /api/previews/apply", async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({
                ok: true,
                saved: true,
                code: "preview-123",
                outcome: "saved",
                restartPending: false,
                requiresRestart: false,
                requiresRebuild: false,
                needsRebuild: false,
                touchesPublicAssets: false,
                hmrLikely: true,
                retryable: false,
                retryAfterSeconds: null,
            }),
        });

        const result = await postPreviewApply({
            appId: "app_123",
            files: [{ path: "app/page.html", content: "<html></html>" }],
            csrf: "csrf-token",
            code: "preview_old",
            idempotencyKey: "idem-1",
            source: "preview-apply",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl).toHaveBeenCalledWith(
            "/api/previews/apply?source=preview-apply",
            expect.objectContaining({
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: expect.objectContaining({
                    "Content-Type": "application/json",
                    "idempotency-key": "idem-1",
                    "x-csrf": "csrf-token",
                }),
            })
        );

        const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as any).body);
        expect(body).toEqual({
            appId: "app_123",
            files: [{ path: "app/page.html", content: "<html></html>" }],
            idempotencyKey: "idem-1",
            code: "preview_old",
        });
        expect(result).toEqual({
            nextCode: "preview-123",
            saved: true,
            outcome: "saved",
            restartPending: false,
            requiresRestart: false,
            requiresRebuild: false,
            needsRebuild: false,
            touchesPublicAssets: false,
            hmrLikely: true,
            retryable: false,
            retryAfterSeconds: null,
        });
    });

    test("throws when backend reports failed save", async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ ok: true, saved: false, error: "write failed" }),
        });

        await expect(
            postPreviewApply({
                appId: "app_123",
                files: [{ path: "app/page.html", content: "<html></html>" }],
                idempotencyKey: "idem-2",
                fetchImpl: fetchImpl as unknown as typeof fetch,
            })
        ).rejects.toThrow("write failed");
    });
});