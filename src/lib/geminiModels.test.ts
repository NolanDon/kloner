import { resolveGenerateContentModels } from "./geminiModels";

describe("resolveGenerateContentModels", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("prefers discovered supported models and skips retired flash defaults", async () => {
        const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            json: async () => ({
                models: [
                    { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
                    { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
                    { name: "models/gemini-1.5-flash", supportedGenerationMethods: ["generateContent"] },
                ],
            }),
        } as any);

        const models = await resolveGenerateContentModels({
            apiKey: "test-key",
            preferred: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"],
            fallback: ["gemini-1.5-flash", "gemini-pro"],
            forceRefresh: true,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(models[0]).toBe("gemini-2.5-flash");
        expect(models).toContain("gemini-2.0-flash");
        expect(models).toContain("gemini-1.5-flash");
        expect(models).not.toContain("gemini-pro");
    });
});