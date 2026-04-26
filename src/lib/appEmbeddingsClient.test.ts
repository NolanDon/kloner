import { normalizeEmbeddingSearchChunk, normalizeEmbeddingSearchResponse } from "./appEmbeddingsClient";

describe("normalizeEmbeddingSearchChunk", () => {
    it("drops chunks whose text was stringified into [object Object]", () => {
        expect(
            normalizeEmbeddingSearchChunk({
                path: "app/layout.tsx",
                chunkText: "[object Object]",
                lineRange: { start: 1, end: 1 },
            })
        ).toBeNull();
    });

    it("keeps valid chunks with readable code text", () => {
        const chunk = normalizeEmbeddingSearchChunk({
            path: "app/layout.tsx",
            chunkText: "export default function Layout() { return null; }",
            lineRange: { start: 1, end: 1 },
            chunkIndex: 0,
            similarity: 0.9,
        });

        expect(chunk).not.toBeNull();
        expect(chunk?.chunkText).toContain("export default function Layout");
    });
});

describe("normalizeEmbeddingSearchResponse", () => {
    it("filters malformed chunks from the search response", () => {
        const response = normalizeEmbeddingSearchResponse({
            chunks: [
                {
                    path: "app/layout.tsx",
                    chunkText: "[object Object]",
                },
                {
                    path: "app/page.tsx",
                    chunkText: "const ok = true;",
                },
            ],
        });

        expect(response.chunks).toHaveLength(1);
        expect(response.chunks[0]?.path).toBe("app/page.tsx");
    });
});
