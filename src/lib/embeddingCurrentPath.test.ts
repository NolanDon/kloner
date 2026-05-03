import { deriveEmbeddingCurrentPath } from "./embeddingCurrentPath";

describe("embeddingCurrentPath", () => {
    it("remaps backend-selected UI queries to a frontend path", () => {
        const files = {
            "server.js": { content: "const express = require('express');", lastModified: 1 },
            "public/index.html": { content: "<button id='close'>Close</button>", lastModified: 1 },
        };

        const decision = deriveEmbeddingCurrentPath({
            selectedFile: "server.js",
            query: "when i click close on the chrome extension popup",
            files,
        });

        expect(decision.derivedCurrentPath).toBe("public/index.html");
        expect(decision.intentClassification).toBe("ui");
    });

    it("keeps backend path for backend intent queries", () => {
        const files = {
            "server.js": { content: "const express = require('express');", lastModified: 1 },
            "public/index.html": { content: "<button id='close'>Close</button>", lastModified: 1 },
        };

        const decision = deriveEmbeddingCurrentPath({
            selectedFile: "server.js",
            query: "increase express timeout for /api route",
            files,
        });

        expect(decision.derivedCurrentPath).toBe("server.js");
        expect(decision.intentClassification).toBe("backend");
    });

    it("keeps a frontend-selected path unchanged", () => {
        const files = {
            "server.js": { content: "const express = require('express');", lastModified: 1 },
            "public/index.html": { content: "<button id='close'>Close</button>", lastModified: 1 },
        };

        const decision = deriveEmbeddingCurrentPath({
            selectedFile: "public/index.html",
            query: "change popup close button text",
            files,
        });

        expect(decision.derivedCurrentPath).toBe("public/index.html");
        expect(decision.intentClassification).toBe("ui");
    });

    it("returns empty currentPath when no reliable frontend path exists", () => {
        const files = {
            "server.js": { content: "const express = require('express');", lastModified: 1 },
            "api/routes/users.js": { content: "module.exports = {};", lastModified: 1 },
        };

        const decision = deriveEmbeddingCurrentPath({
            selectedFile: "server.js",
            query: "update popup modal close button behavior",
            files,
        });

        expect(decision.derivedCurrentPath).toBeNull();
        expect(decision.intentClassification).toBe("ui");
    });
});
