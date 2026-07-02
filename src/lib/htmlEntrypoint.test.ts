import { pickPreferredHtmlPath } from "./htmlEntrypoint";

describe("htmlEntrypoint", () => {
    it("prefers the current html file when it exists", () => {
        const decision = pickPreferredHtmlPath({
            files: {
                "public/index.html": { content: "<html></html>", lastModified: 1 },
                "public/about.html": { content: "<html></html>", lastModified: 1 },
            },
            currentPath: "public/about.html",
        });

        expect(decision).toBe("public/about.html");
    });

    it("prefers public index.html over other html files", () => {
        const decision = pickPreferredHtmlPath({
            files: {
                "public/about.html": { content: "<html></html>", lastModified: 1 },
                "public/index.html": { content: "<html></html>", lastModified: 1 },
                "public/blog/index.html": { content: "<html></html>", lastModified: 1 },
            },
        });

        expect(decision).toBe("public/index.html");
    });

    it("prefers nested index html when root index is absent", () => {
        const decision = pickPreferredHtmlPath({
            files: {
                "public/about.html": { content: "<html></html>", lastModified: 1 },
                "public/blog/index.html": { content: "<html></html>", lastModified: 1 },
                "public/blog/post.html": { content: "<html></html>", lastModified: 1 },
            },
        });

        expect(decision).toBe("public/blog/index.html");
    });

    it("honors html entry hints when they point at an existing html file", () => {
        const decision = pickPreferredHtmlPath({
            files: {
                "pages/home.html": { content: "<html></html>", lastModified: 1 },
                "pages/landing.html": { content: "<html></html>", lastModified: 1 },
            },
            htmlEntryHints: {
                primary: {
                    entryPath: "pages/landing.html",
                },
            },
        });

        expect(decision).toBe("pages/landing.html");
    });

    it("falls back to the first html path when no better hint exists", () => {
        const decision = pickPreferredHtmlPath({
            files: {
                "pages/about.html": { content: "<html></html>", lastModified: 1 },
                "pages/contact.html": { content: "<html></html>", lastModified: 1 },
            },
        });

        expect(decision).toBe("pages/about.html");
    });
});
