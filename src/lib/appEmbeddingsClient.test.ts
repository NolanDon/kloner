import {
    getEmbeddingSearchErrorMessage,
    getEmbeddingSearchRefreshQueuedNotice,
    fetchEmbeddingSearch,
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
});
