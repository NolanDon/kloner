import type { AppBuilderFileManifest, AppBuilderFileRecord, AppBuilderFiles } from "./htmlStorage";

type AiFileSelectionMode = "copy" | "targeted" | "broad";

export type AiFileSelectionResult = {
    mode: AiFileSelectionMode;
    selectedPaths: string[];
    selectedFiles: AppBuilderFiles;
    summary: string;
    useFullContext: boolean;
};

type SelectionParams = {
    message: string;
    conversation?: string;
    currentFile?: string | null;
    files: AppBuilderFiles;
    fileManifest?: AppBuilderFileManifest | null;
    htmlEditIndex?: unknown;
    maxFiles?: number;
};

const COPY_ONLY_HINTS = [
    "change text",
    "replace text",
    "update text",
    "edit text",
    "banner",
    "headline",
    "title",
    "copy",
    "wording",
    "cta",
    "button text",
    "announcement",
    "hero text",
    "top banner",
    "top bar",
    "header text",
];

const CODE_OR_LAYOUT_HINTS = [
    "component",
    "code",
    "file",
    "fix",
    "bug",
    "layout",
    "responsive",
    "style",
    "css",
    "ts",
    "tsx",
    "js",
    "jsx",
    "api",
    "server",
    "hook",
    "state",
    "logic",
    "refactor",
    "rewrite",
    "performance",
];

const RELOAD_REQUIRED_PATHS = [
    /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i,
    /(^|\/)(tsconfig\.json|jsconfig\.json|next\.config\.[^.]+|postcss\.config\.[^.]+|tailwind\.config\.[^.]+|eslint\.config\.[^.]+|jest\.config\.[^.]+|playwright\.config\.[^.]+|vite\.config\.[^.]+|server\.js)$/i,
    /(^|\/)middleware\.[^.]+$/i,
    /(^|\/)public\/.*\.(html?|xhtml)$/i,
];

const PREFERRED_PATH_HINTS: Array<{ test: RegExp; bonus: number }> = [
    { test: /(^|\/)app\/page\.(tsx|ts|jsx|js)$/i, bonus: 30 },
    { test: /(^|\/)src\/app\/page\.(tsx|ts|jsx|js)$/i, bonus: 30 },
    { test: /(^|\/)app\/layout\.(tsx|ts|jsx|js)$/i, bonus: 24 },
    { test: /(^|\/)src\/app\/layout\.(tsx|ts|jsx|js)$/i, bonus: 24 },
    { test: /(^|\/)public\/index\.html$/i, bonus: 28 },
    { test: /hero|banner|header|announcement|navbar|nav|topbar/i, bonus: 18 },
    { test: /home|landing|marketing|hero|banner/i, bonus: 12 },
    { test: /components\//i, bonus: 8 },
];

const COMMON_ENTRY_POINTS = [
    "package.json",
    "app/page.tsx",
    "app/layout.tsx",
    "app/globals.css",
    "src/app/page.tsx",
    "src/app/layout.tsx",
    "src/app/globals.css",
    "public/index.html",
    "server.js",
];

function normalizePath(path: string): string {
    return String(path || "").trim().replace(/^\/+/, "");
}

function splitWords(value: string): string[] {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\/._-]+/g, " ")
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => part.length > 1);
}

function extractQuotedPhrases(text: string): string[] {
    const out: string[] = [];
    const re = /["“”']([^"“”']{2,120})["“”']/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text || ""))) {
        const value = String(match[1] || "").trim();
        if (value) out.push(value.toLowerCase());
    }
    return Array.from(new Set(out));
}

function collectPathLikeStrings(value: unknown, out: Set<string>, limit = 5000) {
    if (!value || out.size >= limit) return;

    if (typeof value === "string") {
        const raw = value.trim();
        if (/^([a-z0-9_.-]+\/)+[a-z0-9_.-]+/i.test(raw) || /\.(tsx?|jsx?|css|html?|json|md|yaml|yml|js|ts|mjs|cjs|png|jpg|jpeg|gif|svg|webp|woff2?|otf)$/i.test(raw)) {
            out.add(normalizePath(raw));
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) collectPathLikeStrings(item, out, limit);
        return;
    }

    if (typeof value === "object") {
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            if (/(path|filePath|targetPath|htmlPath|entryPath|storagePath)/i.test(key) && typeof nested === "string") {
                out.add(normalizePath(nested));
            }
            if (typeof key === "string" && /\.(tsx?|jsx?|css|html?|json|md|yaml|yml|js|ts|mjs|cjs)$/i.test(key)) {
                out.add(normalizePath(key));
            }
            collectPathLikeStrings(nested, out, limit);
        }
    }
}

function inferSelectionMode(message: string, conversation: string): AiFileSelectionMode {
    const text = `${message}\n${conversation}`.toLowerCase();
    const isCopy = COPY_ONLY_HINTS.some((hint) => text.includes(hint));
    const hasCodeHints = CODE_OR_LAYOUT_HINTS.some((hint) => text.includes(hint));

    if (isCopy && !hasCodeHints) return "copy";
    if (text.includes("whole app") || text.includes("entire app") || text.includes("app-wide") || text.includes("refactor")) return "broad";
    return "targeted";
}

function scorePath(path: string, requestWords: string[], quotedPhrases: string[], mode: AiFileSelectionMode): number {
    const normalized = normalizePath(path).toLowerCase();
    let score = 0;

    for (const phrase of quotedPhrases) {
        if (phrase && normalized.includes(phrase.replace(/\s+/g, ""))) score += 40;
    }

    for (const word of requestWords) {
        if (!word) continue;
        if (normalized.includes(word)) score += 8;
    }

    for (const hint of PREFERRED_PATH_HINTS) {
        if (hint.test.test(normalized)) score += hint.bonus;
    }

    if (mode === "copy") {
        if (normalized.endsWith(".html") || normalized.endsWith(".tsx") || normalized.endsWith(".ts") || normalized.endsWith(".jsx") || normalized.endsWith(".js")) {
            score += 6;
        }
        if (/(banner|hero|header|announcement|nav|navbar|topbar|button|cta)/i.test(normalized)) score += 16;
        if (/public\/index\.html$/i.test(normalized)) score += 30;
    }

    if (mode === "broad") {
        if (normalized.includes("app/") || normalized.includes("components/") || normalized.includes("pages/") || normalized.includes("public/")) score += 6;
    }

    return score;
}

function scoreFileContent(content: string, requestWords: string[], quotedPhrases: string[], mode: AiFileSelectionMode): number {
    const normalized = String(content || "").toLowerCase();
    if (!normalized.trim()) return 0;

    let score = 0;

    for (const phrase of quotedPhrases) {
        if (phrase && normalized.includes(phrase)) score += 32;
    }

    for (const word of requestWords) {
        if (!word) continue;
        const matches = normalized.match(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"));
        if (matches && matches.length > 0) {
            score += Math.min(18, matches.length * (mode === "copy" ? 6 : 4));
        }
    }

    if (mode === "copy") {
        if (/(banner|hero|header|announcement|nav|navbar|topbar|cta|button|copy|title|headline)/i.test(normalized)) {
            score += 10;
        }
        if (normalized.length < 2000) {
            score += 4;
        }
    }

    return score;
}

function orderSelectedFiles(paths: Array<{ path: string; score: number }>, maxFiles: number): string[] {
    return paths
        .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
        .slice(0, maxFiles)
        .map((entry) => entry.path);
}

export function selectAiFiles(params: SelectionParams): AiFileSelectionResult {
    const message = String(params.message || "");
    const conversation = String(params.conversation || "");
    const currentFile = normalizePath(String(params.currentFile || ""));
    const mode = inferSelectionMode(message, conversation);
    const requestedWords = splitWords(message).filter((word) => !["the", "and", "for", "with", "that", "this", "from", "please", "make", "change", "update"].includes(word));
    const quotedPhrases = extractQuotedPhrases(message);
    const currentFileDir = currentFile.includes("/") ? currentFile.slice(0, currentFile.lastIndexOf("/") + 1) : "";

    const manifestPaths = new Set<string>();
    collectPathLikeStrings(params.fileManifest, manifestPaths);
    collectPathLikeStrings(params.htmlEditIndex, manifestPaths);

    for (const path of Object.keys(params.files || {})) {
        manifestPaths.add(normalizePath(path));
    }

    const candidates: Array<{ path: string; score: number }> = [];
    for (const path of manifestPaths) {
        if (!path) continue;
        const normalized = normalizePath(path);
        const record = params.files?.[normalized];
        const content = String(record?.content || "");
        let score = scorePath(normalized, requestedWords, quotedPhrases, mode) + scoreFileContent(content, requestedWords, quotedPhrases, mode);
        if (currentFile && normalized === currentFile) {
            score += mode === "copy" ? 160 : 120;
        } else if (currentFileDir && normalized.startsWith(currentFileDir)) {
            score += mode === "copy" ? 20 : 12;
        }
        if (score > 0) candidates.push({ path, score });
    }

    for (const entryPoint of COMMON_ENTRY_POINTS) {
        if (manifestPaths.has(entryPoint)) {
            candidates.push({ path: entryPoint, score: mode === "copy" ? 10 : 6 });
        }
    }

    if (currentFile) {
        const currentRecord = params.files?.[currentFile];
        const currentContent = String(currentRecord?.content || "");
        const currentScore = 200 + scoreFileContent(currentContent, requestedWords, quotedPhrases, mode);
        candidates.push({ path: currentFile, score: currentScore });
    }

    const maxFiles = typeof params.maxFiles === "number" && params.maxFiles > 0
        ? params.maxFiles
        : mode === "copy"
            ? 3
            : mode === "targeted"
                ? 6
                : 10;

    const selectedPaths = orderSelectedFiles(candidates, maxFiles);
    const hasSourceFile = selectedPaths.some((path) => /(^|\/)(app|src|components)\//i.test(normalizePath(path)));
    const filteredPaths = hasSourceFile
        ? selectedPaths.filter((path) => !/^public\/index\.html$/i.test(normalizePath(path)))
        : selectedPaths;
    const selectedFiles: AppBuilderFiles = {};

    for (const path of filteredPaths) {
        const normalized = normalizePath(path);
        const record = params.files?.[normalized];
        if (record) {
            selectedFiles[normalized] = {
                content: String(record.content || ""),
                lastModified: Number(record.lastModified || Date.now()),
            };
        } else {
            selectedFiles[normalized] = {
                content: "",
                lastModified: Date.now(),
            };
        }
    }

    const totalCandidates = manifestPaths.size || Object.keys(params.files || {}).length;
    const summary = filteredPaths.length
        ? `Selected ${filteredPaths.length} of ${totalCandidates} files (${mode} scope): ${filteredPaths.join(", ")}`
        : `No confident file matches found; using broader context.`;

    return {
        mode,
        selectedPaths: filteredPaths,
        selectedFiles,
        summary,
        useFullContext: filteredPaths.length === 0,
    };
}

export function shouldRefreshAfterAiEdits(paths: string[]): boolean {
    return (paths || []).some((path) => {
        const normalized = normalizePath(path);
        return RELOAD_REQUIRED_PATHS.some((test) => test.test(normalized));
    });
}
