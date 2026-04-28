import {
    getEmbeddingSearchErrorMessage,
    getEmbeddingSearchRefreshQueuedNotice,
    extractCompletedEditPlanResult,
    formatEditPlanBackpressureMessage,
    fetchEmbeddingEditPlan,
    fetchEmbeddingEditPlanJobStatus,
    fetchEmbeddingSearch,
    applyEditPlanOps,
    getEditPlanJobDisplayStatus,
    getEditPlanJobPollDelayMs,
    getEditPlanRetryAfterSeconds,
    isEditPlanJobActiveStatus,
    isEditPlanJobTerminalStatus,
    isEditPlanBackpressureResult,
    normalizePreviewApplyResponse,
    normalizeEmbeddingEditPlanJobStatus,
    normalizeEmbeddingEditPlanResponse,
    normalizeEmbeddingSearchResponse,
    withLoadingState,
} from "./appEmbeddingsClient";

describe("appEmbeddingsClient", () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it("normalizes refreshQueued search responses and exposes a subtle notice", () => {
        const normalized = normalizeEmbeddingSearchResponse({
            refreshQueued: true,
            chunks: [
                {
                    path: "app/page.tsx",
                    chunkText: "export default function Page() { return <main />; }",
                },
            ],
        });

        expect(normalized.refreshQueued).toBe(true);
        expect(normalized.chunks).toHaveLength(1);
        expect(getEmbeddingSearchRefreshQueuedNotice(normalized)).toContain("file search is still updating in the background");
    });

    it("returns human-readable messages for stale-index and timeout responses", () => {
        expect(getEmbeddingSearchErrorMessage(409, "EMBEDDING_INDEX_STALE", null)).toContain("file search is refreshing");
        expect(getEmbeddingSearchErrorMessage(503, "EMBEDDING_MEMORY_PRESSURE", null)).toContain("file search is busy");
        expect(getEmbeddingSearchErrorMessage(504, "EMBEDDING_SEARCH_TIMEOUT", null)).toContain("file search took too long");
    });

    it("clears loading state for successful search responses", async () => {
        const transitions: boolean[] = [];
        const setLoading = (next: boolean) => transitions.push(next);

        jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({
                refreshQueued: true,
                chunks: [
                    {
                        path: "app/page.tsx",
                        chunkText: "export default function Page() { return <main />; }",
                    },
                ],
            }),
        } as any);

        await expect(
            withLoadingState(setLoading, () => fetchEmbeddingSearch({ appId: "app-1", query: "hero" }, {}))
        ).resolves.toMatchObject({
            ok: true,
            status: 200,
        });

        expect(transitions).toEqual([true, false]);
    });

    it("clears loading state for non-2xx search responses", async () => {
        const transitions: boolean[] = [];
        const setLoading = (next: boolean) => transitions.push(next);

        jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
            ok: false,
            status: 409,
            headers: { get: () => null },
            json: async () => ({
                error: "index stale",
                code: "EMBEDDING_INDEX_STALE",
            }),
        } as any);

        await expect(
            withLoadingState(setLoading, () => fetchEmbeddingSearch({ appId: "app-1", query: "hero" }, {}))
        ).resolves.toMatchObject({
            ok: false,
            status: 409,
            code: "EMBEDDING_INDEX_STALE",
        });

        expect(transitions).toEqual([true, false]);
    });

    it("clears loading state for memory-pressure responses", async () => {
        const transitions: boolean[] = [];
        const setLoading = (next: boolean) => transitions.push(next);

        jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
            ok: false,
            status: 503,
            headers: { get: () => null },
            json: async () => ({
                error: "busy",
                code: "EMBEDDING_MEMORY_PRESSURE",
            }),
        } as any);

        await expect(
            withLoadingState(setLoading, () => fetchEmbeddingSearch({ appId: "app-1", query: "hero" }, {}))
        ).resolves.toMatchObject({
            ok: false,
            status: 503,
            code: "EMBEDDING_MEMORY_PRESSURE",
        });

        expect(transitions).toEqual([true, false]);
    });

    it("clears loading state for search timeout responses", async () => {
        const transitions: boolean[] = [];
        const setLoading = (next: boolean) => transitions.push(next);

        jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
            ok: false,
            status: 504,
            headers: { get: () => null },
            json: async () => ({
                error: "timed out",
                code: "EMBEDDING_SEARCH_TIMEOUT",
            }),
        } as any);

        await expect(
            withLoadingState(setLoading, () => fetchEmbeddingSearch({ appId: "app-1", query: "hero" }, {}))
        ).resolves.toMatchObject({
            ok: false,
            status: 504,
            code: "EMBEDDING_SEARCH_TIMEOUT",
        });

        expect(transitions).toEqual([true, false]);
    });

    it("aborts slow search requests and clears loading state", async () => {
        jest.useFakeTimers();

        const transitions: boolean[] = [];
        const setLoading = (next: boolean) => transitions.push(next);

        jest.spyOn(globalThis, "fetch").mockImplementation((_, init?: RequestInit) => {
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
                });
            }) as any;
        });

        const request = withLoadingState(setLoading, () => fetchEmbeddingSearch({ appId: "app-1", query: "hero" }, {}));

        await jest.advanceTimersByTimeAsync(42_100);

        await expect(request).resolves.toMatchObject({
            ok: false,
            status: 504,
            code: "EMBEDDING_SEARCH_TIMEOUT",
        });

        expect(transitions).toEqual([true, false]);
    });

    it("accepts queued edit-plan responses from a 202 and preserves job metadata", async () => {
        jest.spyOn(globalThis, "fetch" as any).mockResolvedValueOnce({
            ok: true,
            status: 202,
            headers: { get: () => null },
            json: async () => ({
                ok: true,
                queued: true,
                requestId: "req-queued",
                jobId: "job-queued",
                statusUrl: "/api/v1/app-embeddings/jobs/job-queued",
                status: "queued",
                stage: "searching",
                job: {
                    status: "queued",
                    stage: "searching",
                    progress: 5,
                    queueAgeSeconds: 8,
                    queuedForSeconds: 8,
                },
            }),
        } as any);

        await expect(fetchEmbeddingEditPlan({ appId: "app-1", query: "hero" }, {})).resolves.toMatchObject({
            ok: true,
            status: 202,
            data: expect.objectContaining({
                queued: true,
                requestId: "req-queued",
                jobId: "job-queued",
                statusUrl: "/api/v1/app-embeddings/jobs/job-queued",
                job: expect.objectContaining({
                    status: "queued",
                    stage: "searching",
                }),
            }),
        });
    });

    it("detects edit-plan backpressure and prefers the body retry-after countdown", async () => {
        jest.spyOn(globalThis, "fetch" as any).mockResolvedValueOnce({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            headers: { get: (name: string) => (String(name).toLowerCase() === "retry-after" ? "17" : null) },
            json: async () => ({
                code: "EMBEDDING_EDIT_PLAN_BACKPRESSURE",
                requestId: "req-pressure",
                reason: "Queue is full",
                retryAfterSeconds: 9,
                queueMetrics: {
                    queuedCount: 14,
                    oldestQueuedAgeSeconds: 31,
                },
                thresholds: {
                    queuedCount: 12,
                },
            }),
        } as any);

        const result = await fetchEmbeddingEditPlan({ appId: "app-1", query: "hero" }, {});

        expect(result).toMatchObject({
            ok: false,
            status: 429,
            code: "EMBEDDING_EDIT_PLAN_BACKPRESSURE",
            requestId: "req-pressure",
        });
        expect(isEditPlanBackpressureResult(result)).toBe(true);
        expect(getEditPlanRetryAfterSeconds(result)).toBe(9);
        expect(formatEditPlanBackpressureMessage(result)).toContain("The edit-plan queue is busy. Try again in 9 seconds.");
        expect(formatEditPlanBackpressureMessage(result)).toContain("Queue metrics: 14 waiting, oldest 31 seconds");
        expect(formatEditPlanBackpressureMessage(result)).toContain("Request ID: req-pressure");
    });

    it("normalizes job status payloads and exposes terminal states", async () => {
        jest.spyOn(globalThis, "fetch" as any).mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({
                status: "completed",
                stage: "completed",
                progress: 100,
                requestId: "req-1",
                jobId: "job-1",
                workerId: "worker-1",
                queueAgeSeconds: 12,
                runningForSeconds: 31,
                result: {
                    summary: "Done",
                    needsRebuild: false,
                    ops: [],
                    notes: [],
                    search: [],
                },
            }),
        } as any);

        await expect(fetchEmbeddingEditPlanJobStatus("/api/v1/app-embeddings/jobs/job-1", {})).resolves.toMatchObject({
            ok: true,
            status: 200,
            data: expect.objectContaining({
                status: "completed",
                workerId: "worker-1",
                queueAgeSeconds: 12,
                runningForSeconds: 31,
            }),
        });

        const completedJob = normalizeEmbeddingEditPlanJobStatus({
            status: "completed",
            result: {
                summary: "Done",
                needsRebuild: false,
                ops: [],
                notes: [],
                search: [],
            },
        });

        expect(isEditPlanJobActiveStatus(completedJob.status)).toBe(false);
        expect(isEditPlanJobTerminalStatus(completedJob.status)).toBe(true);
        expect(getEditPlanJobDisplayStatus("expired")).toBe("Job expired, re-queued");
        expect(getEditPlanJobPollDelayMs("queued", 0)).toBe(1400);
        expect(getEditPlanJobPollDelayMs("queued", 3)).toBe(2500);
        expect(extractCompletedEditPlanResult(completedJob)).toMatchObject({
            summary: "Done",
        });
    });

    it("surfaces access and lookup failures from the job status endpoint", async () => {
        jest.spyOn(globalThis, "fetch" as any)
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                headers: { get: () => null },
                json: async () => ({ error: "Forbidden" }),
            } as any)
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
                headers: { get: () => null },
                json: async () => ({ error: "Not found" }),
            } as any);

        await expect(fetchEmbeddingEditPlanJobStatus("/api/v1/app-embeddings/jobs/job-403", {})).resolves.toMatchObject({
            ok: false,
            status: 403,
            error: "Forbidden",
        });

        await expect(fetchEmbeddingEditPlanJobStatus("/api/v1/app-embeddings/jobs/job-404", {})).resolves.toMatchObject({
            ok: false,
            status: 404,
            error: "Not found",
        });
    });

    it("normalizes preview apply saved, pending, and timeout outcomes", () => {
        expect(normalizePreviewApplyResponse({ ok: true, outcome: "saved", saved: true }, 200, null)).toMatchObject({
            ok: true,
            outcome: "saved",
            saved: true,
            restartPending: false,
            retryable: false,
        });

        expect(normalizePreviewApplyResponse({ ok: true, outcome: "restart_pending", saved: true, restartPending: true, retryAfterSeconds: 12 }, 200, null)).toMatchObject({
            ok: true,
            outcome: "restart_pending",
            saved: true,
            restartPending: true,
            retryable: false,
            retryAfterSeconds: 12,
        });

        expect(normalizePreviewApplyResponse({ ok: true, outcome: "restart_timeout", saved: true, retryable: true, retryAfterSeconds: 9 }, 504, null)).toMatchObject({
            ok: true,
            outcome: "restart_timeout",
            saved: true,
            restartPending: false,
            retryable: true,
            retryAfterSeconds: 9,
        });

        expect(normalizePreviewApplyResponse({ ok: true, outcome: "failed", saved: false, retryable: false }, 400, null)).toMatchObject({
            ok: true,
            outcome: "failed",
            saved: false,
            restartPending: false,
            retryable: false,
        });

        expect(normalizePreviewApplyResponse({ ok: true, saved: true, restartPending: true, restartStatus: "timeout", queued: true }, 504, null)).toMatchObject({
            ok: true,
            saved: true,
            restartPending: true,
            restartStatus: "timeout",
            retryable: false,
        });

        expect(
            normalizePreviewApplyResponse(
                {
                    ok: true,
                    outcome: "saved",
                    saved: true,
                    machineId: "machine-123",
                    resolvedFrom: "preview-code",
                },
                200,
                null,
            ),
        ).toMatchObject({
            machineId: "machine-123",
            resolvedFrom: "preview-code",
        });
    });

    it("forwards idempotency keys and normalizes apply responses", async () => {
        const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({
                ok: true,
                outcome: "restart_pending",
                saved: true,
                restartPending: true,
                restartConfirmed: false,
                idempotencyKey: "idem-123",
                retryAfterSeconds: 7,
                requestId: "req-apply",
                touchesPublicAssets: true,
            }),
        } as any);

        await expect(
            applyEditPlanOps({
                appId: "app-1",
                files: [{ path: "public/index.html", content: "<main />" }],
                code: "preview-1",
                idempotencyKey: "idem-123",
            }, {})
        ).resolves.toMatchObject({
            ok: true,
            status: 200,
            requestId: "req-apply",
            data: expect.objectContaining({
                outcome: "restart_pending",
                saved: true,
                restartPending: true,
                retryAfterSeconds: 7,
                idempotencyKey: "idem-123",
                touchesPublicAssets: true,
            }),
        });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0] as any;
        expect(url).toBe("/api/v1/webcontainer/apply");
        expect(init.headers["idempotency-key"]).toBe("idem-123");
        expect(JSON.parse(init.body)).toMatchObject({
            appId: "app-1",
            code: "preview-1",
            idempotencyKey: "idem-123",
            files: [{ path: "public/index.html", content: "<main />" }],
        });
    });
});
