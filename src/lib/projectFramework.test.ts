import { detectProjectFramework, shouldPreserveRuntimeScripts } from "./projectFramework";

describe("projectFramework", () => {
    it("detects a static html/js project and preserves runtime scripts", () => {
        const info = detectProjectFramework({
            "public/index.html": { content: "<html></html>", lastModified: 1 },
            "public/blog/index.html": { content: "<html></html>", lastModified: 1 },
            "server.js": { content: "const express = require('express');", lastModified: 1 },
            "package.json": {
                content: JSON.stringify({
                    scripts: { dev: "node server.js" },
                }),
                lastModified: 1,
            },
        });

        expect(info.key).toBe("html-js");
        expect(shouldPreserveRuntimeScripts(info)).toBe(true);
    });

    it("does not preserve runtime scripts for nextjs", () => {
        const info = detectProjectFramework({
            "app/page.tsx": { content: "export default function Page() { return null; }", lastModified: 1 },
            "app/layout.tsx": { content: "export default function Layout({ children }: any) { return children; }", lastModified: 1 },
            "package.json": {
                content: JSON.stringify({
                    dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
                }),
                lastModified: 1,
            },
        });

        expect(info.key).toBe("nextjs");
        expect(shouldPreserveRuntimeScripts(info)).toBe(false);
    });
});
