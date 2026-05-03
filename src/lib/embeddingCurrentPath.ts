import { chooseFrameworkCurrentFile, detectProjectFramework, type ProjectFrameworkInfo } from "@/src/lib/projectFramework";

type AppFiles = { [path: string]: { content: string; lastModified: number } };

export type EmbeddingIntentClassification = "ui" | "backend" | "unknown";

export type EmbeddingCurrentPathDecision = {
    selectedFile: string | null;
    derivedCurrentPath: string | null;
    intentClassification: EmbeddingIntentClassification;
    reason: string;
};

const UI_INTENT_TOKENS = [
    "popup",
    "modal",
    "dialog",
    "button",
    "cta",
    "close",
    "dismiss",
    "hide",
    "remove",
    "click",
    "render",
    "dom",
    "class",
    "id",
    "html",
    "css",
];

const BACKEND_INTENT_TOKENS = [
    "express",
    "route",
    "middleware",
    "api",
    "server",
    "port",
    "node",
    "env",
    "proxy",
    "timeout",
    "restart",
];

const BACKEND_ENTRYPOINT_FILE_RE = /(^|\/)(server|main|app|index)\.(js|ts|mjs|cjs)$/i;

function normalizePath(path: string | null | undefined): string | null {
    const trimmed = String(path || "").trim();
    return trimmed ? trimmed.replace(/^\/+/, "") : null;
}

function countTokenHits(query: string, tokens: string[]): number {
    const text = String(query || "").toLowerCase();
    let hits = 0;
    for (const token of tokens) {
        const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i");
        if (pattern.test(text)) hits += 1;
    }
    return hits;
}

export function classifyEmbeddingIntent(query: string): EmbeddingIntentClassification {
    const uiHits = countTokenHits(query, UI_INTENT_TOKENS);
    const backendHits = countTokenHits(query, BACKEND_INTENT_TOKENS);

    if (uiHits > backendHits && uiHits > 0) return "ui";
    if (backendHits > uiHits && backendHits > 0) return "backend";
    return "unknown";
}

export function isBackendEntrypointPath(path: string | null | undefined): boolean {
    const normalized = normalizePath(path);
    if (!normalized) return false;
    return BACKEND_ENTRYPOINT_FILE_RE.test(normalized);
}

function pathLooksFrontend(path: string | null | undefined): boolean {
    const normalized = normalizePath(path);
    if (!normalized) return false;
    if (isBackendEntrypointPath(normalized)) return false;
    if (/^(api|app\/api)\//i.test(normalized)) return false;

    return (
        /^public\/index\.html?$/i.test(normalized) ||
        /^public\/.+\/index\.html?$/i.test(normalized) ||
        /^index\.html?$/i.test(normalized) ||
        /^(?:src\/)?app\/.+\.(tsx|ts|jsx|js|css|scss|sass|less|html?)$/i.test(normalized) ||
        /^(?:src\/)?pages\/.+\.(tsx|ts|jsx|js|css|scss|sass|less|html?)$/i.test(normalized) ||
        /\.(tsx|jsx|css|scss|sass|less|html?)$/i.test(normalized)
    );
}

function findPreferredFrontendPath(files: AppFiles, frameworkInfo?: ProjectFrameworkInfo): string | null {
    const framework = frameworkInfo || detectProjectFramework(files);
    const frameworkCandidate = normalizePath(chooseFrameworkCurrentFile(files, framework, null));
    if (frameworkCandidate && pathLooksFrontend(frameworkCandidate)) {
        return frameworkCandidate;
    }

    const paths = Object.keys(files || {});
    const pickFirst = (patterns: RegExp[]): string | null => {
        const match = paths.find((path) => patterns.some((pattern) => pattern.test(path)));
        return normalizePath(match);
    };

    return (
        pickFirst([
            /^public\/index\.html?$/i,
            /^public\/.+\/index\.html?$/i,
            /^index\.html?$/i,
            /^(?:src\/)?app\/page\.(tsx|ts|jsx|js|mdx?)$/i,
            /^(?:src\/)?pages\/index\.(tsx|ts|jsx|js|mdx?)$/i,
        ]) ||
        paths.map((path) => normalizePath(path)).find((path) => pathLooksFrontend(path)) ||
        null
    );
}

export function deriveEmbeddingCurrentPath(args: {
    selectedFile?: string | null;
    query: string;
    files: AppFiles;
    frameworkInfo?: ProjectFrameworkInfo;
}): EmbeddingCurrentPathDecision {
    const selectedFile = normalizePath(args.selectedFile);
    const intentClassification = classifyEmbeddingIntent(args.query);

    if (!selectedFile) {
        return {
            selectedFile,
            derivedCurrentPath: null,
            intentClassification,
            reason: "no_selected_file",
        };
    }

    if (!isBackendEntrypointPath(selectedFile)) {
        return {
            selectedFile,
            derivedCurrentPath: selectedFile,
            intentClassification,
            reason: "selected_file_not_backend_entrypoint",
        };
    }

    if (intentClassification !== "ui") {
        return {
            selectedFile,
            derivedCurrentPath: selectedFile,
            intentClassification,
            reason: "backend_intent_or_unknown_keep_selected",
        };
    }

    const frontendPath = findPreferredFrontendPath(args.files, args.frameworkInfo);
    if (frontendPath) {
        return {
            selectedFile,
            derivedCurrentPath: frontendPath,
            intentClassification,
            reason: "ui_intent_backend_selected_remapped_to_frontend_path",
        };
    }

    return {
        selectedFile,
        derivedCurrentPath: null,
        intentClassification,
        reason: "ui_intent_backend_selected_no_frontend_path_found",
    };
}