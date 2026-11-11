const PREVIEW_BUNDLE_PATH = /(?:^|\/)_next\/static\/chunks\/.+\.js$/i;
const ASSET_BUNDLE_PATH = /(?:^|\/)assets\/.+\.m?js$/i;

function normalizeAssetPath(value: string): string {
    return String(value || "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^https?:\/\/[^/]+/i, "")
        .split(/[?#]/)[0]
        .replace(/^[./]+/, "")
        .replace(/^public\//i, "")
        .replace(/^\/+/, "");
}

function resolveScriptPath(src: string, baseUri: string): string | null {
    const raw = String(src || "").trim();
    if (!raw || /^(?:#|data:|blob:|javascript:|mailto:|tel:)/i.test(raw)) return null;

    try {
        const base = new URL(baseUri);
        if (!/^https?:$/.test(base.protocol)) return null;
        const resolved = new URL(raw, base);
        if (resolved.origin !== base.origin || !/^https?:$/.test(resolved.protocol)) return null;
        const path = normalizeAssetPath(resolved.pathname);
        return PREVIEW_BUNDLE_PATH.test(path) || ASSET_BUNDLE_PATH.test(path) ? path : null;
    } catch {
        return null;
    }
}

export function inspectPreviewBundleAssets({
    scriptSrcs = [],
    failedScriptSrcs = [],
    sourceFilePaths = [],
    baseUri = "",
}: {
    scriptSrcs?: string[];
    failedScriptSrcs?: string[];
    sourceFilePaths?: string[];
    baseUri?: string;
} = {}) {
    const availableScriptFiles = Array.from(new Set(
        sourceFilePaths
            .map(normalizeAssetPath)
            .filter((path) => PREVIEW_BUNDLE_PATH.test(path) || ASSET_BUNDLE_PATH.test(path)),
    ));
    const availableScriptFileSet = new Set(availableScriptFiles);
    const requestedBundleScripts = Array.from(new Set(
        scriptSrcs
            .map((src) => resolveScriptPath(src, baseUri))
            .filter((path): path is string => Boolean(path)),
    ));
    const failedBundleScripts = failedScriptSrcs
        .map((src) => resolveScriptPath(src, baseUri))
        .filter((path): path is string => Boolean(path));
    const missingScriptSrcs = Array.from(new Set([
        ...requestedBundleScripts.filter((path) => !availableScriptFileSet.has(path)),
        ...failedBundleScripts,
    ]));

    return {
        requestedBundleScripts,
        availableScriptFiles,
        missingScriptSrcs,
        hasNextChunkScripts: [...requestedBundleScripts, ...failedBundleScripts].some((path) => PREVIEW_BUNDLE_PATH.test(path)),
    };
}
