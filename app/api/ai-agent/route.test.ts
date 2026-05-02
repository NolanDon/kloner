import { formatRetrievedChunksSection } from "./messageHelpers";

describe("formatRetrievedChunksSection", () => {
    it("renders chunkText content instead of object stringification", () => {
        const prompt = formatRetrievedChunksSection([
            {
                path: "app/page.tsx",
                chunkId: "chunk-1",
                lineRange: { start: 10, end: 16 },
                score: 0.9123,
                chunkText: "const hero = () => {\n  return <section>Hero</section>;\n}",
            },
        ]);

        expect(prompt).toContain("Retrieved embedding chunks:");
        expect(prompt).toContain("app/page.tsx");
        expect(prompt).toContain("lines: 10-16");
        expect(prompt).toContain("const hero = () => {");
        expect(prompt).not.toContain("[object Object]");
    });

    it("throws a clear error when a chunk does not include readable code content", () => {
        expect(() =>
            formatRetrievedChunksSection([
                {
                    path: "app/page.tsx",
                    lineRange: { start: 1, end: 2 },
                },
            ])
        ).toThrow(/missing readable code content/i);
    });
});
