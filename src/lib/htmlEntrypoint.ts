type HtmlFileRecord = { content: string; lastModified: number };

type HtmlFileMap = Record<string, HtmlFileRecord>;

function normalizePath(path: string | null | undefined): string {
    return String(path || "").trim().replace(/^\/+/, "").replace(/\\/g, "/");
}

function isHtmlPath(path: string | null | undefined): boolean {
    const value = normalizePath(path);
    return Boolean(value) && /\.(html?|xhtml)$/i.test(value);
}

function collectHtmlPathHints(value: unknown, out: Set<string>, limit = 1000): void {
    if (!value || out.size >= limit) return;

    if (typeof value === "string") {
        const candidate = normalizePath(value);
        if (isHtmlPath(candidate)) out.add(candidate);
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) collectHtmlPathHints(item, out, limit);
        return;
    }

    if (typeof value !== "object") return;

    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (isHtmlPath(key)) out.add(normalizePath(key));
        if ((key === "path" || key === "filePath" || key === "targetPath" || key === "htmlPath" || key === "entryPath") && typeof nested === "string") {
            const candidate = normalizePath(nested);
            if (isHtmlPath(candidate)) out.add(candidate);
        }
        collectHtmlPathHints(nested, out, limit);
    }
}

function rankHtmlPath(path: string): number {
    const normalized = normalizePath(path);
    if (!normalized) return Number.POSITIVE_INFINITY;

    if (normalized === "public/index.html" || normalized === "public/index.htm") return 0;
    if (normalized === "index.html" || normalized === "index.htm") return 1;
    if (/^public\/.+\/index\.html?$/i.test(normalized)) return 2;
    if (/^.+\/index\.html?$/i.test(normalized)) return 3;
    if (/^public\/.+\.html?$/i.test(normalized)) return 4;
    return 5;
}

export function pickPreferredHtmlPath(params: {
    files: HtmlFileMap | undefined | null;
    currentPath?: string | null;
    htmlEntryHints?: unknown;
}): string | null {
    const files = params.files || {};
    const htmlPaths = Object.keys(files).map(normalizePath).filter(isHtmlPath);
    if (htmlPaths.length === 0) return null;

    const currentPath = normalizePath(params.currentPath);
    if (currentPath && htmlPaths.includes(currentPath)) {
        return currentPath;
    }

    const hinted = new Set<string>();
    collectHtmlPathHints(params.htmlEntryHints, hinted);
    for (const path of hinted) {
        const normalized = normalizePath(path);
        if (normalized && htmlPaths.includes(normalized)) {
            return normalized;
        }
    }

    const ranked = [...new Set(htmlPaths)].sort((left, right) => {
        const leftRank = rankHtmlPath(left);
        const rightRank = rankHtmlPath(right);
        return leftRank - rightRank || left.localeCompare(right);
    });

    return ranked[0] || null;
}

export { collectHtmlPathHints, isHtmlPath, normalizePath };
