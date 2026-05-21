const MODEL_DISCOVERY_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

type GeminiModelInfo = {
    name?: string;
    supportedGenerationMethods?: string[];
};

let cachedGenerateContentModels: string[] = [];
let cachedGenerateContentModelsAt = 0;

function normalizeModelName(name: string): string {
    return String(name || "").replace(/^models\//, "");
}

function uniqueModels(list: string[]): string[] {
    return Array.from(new Set(list.filter(Boolean)));
}

async function listGenerateContentModels(apiKey: string): Promise<string[]> {
    if (!apiKey) return [];
    const url = `${MODEL_DISCOVERY_URL}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) {
        throw new Error(`ListModels failed: ${res.status} ${res.statusText}`);
    }
    const payload = (await res.json()) as { models?: GeminiModelInfo[] };
    const models = payload.models || [];
    return models
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => normalizeModelName(model.name || ""))
        .filter(Boolean);
}

export async function resolveGenerateContentModels(params: {
    apiKey: string;
    preferred?: string[];
    fallback?: string[];
    forceRefresh?: boolean;
}): Promise<string[]> {
    const apiKey = String(params.apiKey || "").trim();
    const preferred = Array.isArray(params.preferred) ? params.preferred : [];
    const fallback = Array.isArray(params.fallback) ? params.fallback : [];
    const forceRefresh = params.forceRefresh === true;
    const now = Date.now();

    if (!forceRefresh && cachedGenerateContentModels.length > 0 && now - cachedGenerateContentModelsAt < MODEL_CACHE_TTL_MS) {
        return cachedGenerateContentModels;
    }

    try {
        const available = await listGenerateContentModels(apiKey);
        if (available.length > 0) {
            const preferredMatches = preferred.filter((name) => available.includes(name));
            const rest = available.filter((name) => !preferredMatches.includes(name));
            cachedGenerateContentModels = uniqueModels([...preferredMatches, ...rest]);
            cachedGenerateContentModelsAt = now;
            return cachedGenerateContentModels;
        }
    } catch (err) {
        console.warn("[gemini-models] Failed to discover models; using fallback", err);
    }

    cachedGenerateContentModels = uniqueModels([...preferred, ...fallback]);
    cachedGenerateContentModelsAt = now;
    return cachedGenerateContentModels;
}
