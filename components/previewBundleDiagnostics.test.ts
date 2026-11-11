import { inspectPreviewBundleAssets } from "./previewBundleDiagnostics";

describe("inspectPreviewBundleAssets", () => {
    it("finds missing same-origin Vite bundles and matches files present in the project", () => {
        const result = inspectPreviewBundleAssets({
            baseUri: "https://kloner.app/",
            scriptSrcs: [
                "https://kloner.app/assets/routes-vPF9Ao9B.js",
                "https://kloner.app/assets/index-DRkNBjDZ.js",
                "https://kloner.app/assets/Classroom-DKpAguYA.js",
                "https://kloner.app/assets/memories-DwUbpzKI.js",
            ],
            sourceFilePaths: [
                "public/assets/routes-vPF9Ao9B.js",
                "public/assets/index-DRkNBjDZ.js",
            ],
        });

        expect(result.availableScriptFiles).toEqual([
            "assets/routes-vPF9Ao9B.js",
            "assets/index-DRkNBjDZ.js",
        ]);
        expect(result.missingScriptSrcs).toEqual([
            "assets/Classroom-DKpAguYA.js",
            "assets/memories-DwUbpzKI.js",
        ]);
        expect(result.hasNextChunkScripts).toBe(false);
    });

    it("ignores third-party scripts so they are not reported as missing project assets", () => {
        const result = inspectPreviewBundleAssets({
            baseUri: "https://kloner.app/",
            scriptSrcs: [
                "https://cdn.example/assets/analytics-123456.js",
                "/assets/app-123456.js",
            ],
            sourceFilePaths: [],
        });

        expect(result.requestedBundleScripts).toEqual(["assets/app-123456.js"]);
        expect(result.missingScriptSrcs).toEqual(["assets/app-123456.js"]);
    });

    it("reports same-origin bundle requests that actually returned an HTTP error", () => {
        const result = inspectPreviewBundleAssets({
            baseUri: "https://kloner.app/",
            scriptSrcs: ["https://kloner.app/assets/routes-vPF9Ao9B.js"],
            failedScriptSrcs: ["https://kloner.app/assets/routes-vPF9Ao9B.js"],
            sourceFilePaths: ["public/assets/routes-vPF9Ao9B.js"],
        });

        expect(result.missingScriptSrcs).toEqual(["assets/routes-vPF9Ao9B.js"]);
    });
});
