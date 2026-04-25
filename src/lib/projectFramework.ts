export type ProjectFrameworkKey = "nextjs" | "html-js" | "unknown";

export type ProjectFrameworkInfo = {
    key: ProjectFrameworkKey;
    label: string;
    confidence: "high" | "medium" | "low";
    reason: string;
    nextSignals: string[];
    htmlSignals: string[];
    isAmbiguous: boolean;
};

type AppFiles = { [path: string]: { content: string; lastModified: number } } | null | undefined;

function asString(value: unknown, max = 120_000): string {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    return text.length <= max ? text : text.slice(0, max);
}

function hasPath(files: AppFiles, pattern: RegExp): boolean {
    return Object.keys(files || {}).some((path) => pattern.test(path));
}

function readPackageJson(files: AppFiles): any {
    const raw = asString(files?.["package.json"]?.content || "", 120_000);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function pushUnique(list: string[], value: string): void {
    const text = asString(value, 200);
    if (!text || list.includes(text)) return;
    list.push(text);
}

export function detectProjectFramework(files: AppFiles): ProjectFrameworkInfo {
    const nextSignals: string[] = [];
    const htmlSignals: string[] = [];

    const packageJson = readPackageJson(files);
    const packageDeps = {
        dependencies: packageJson?.dependencies || {},
        devDependencies: packageJson?.devDependencies || {},
        peerDependencies: packageJson?.peerDependencies || {},
    };

    const hasNextDep = [packageDeps.dependencies, packageDeps.devDependencies, packageDeps.peerDependencies].some((deps) =>
        Boolean(deps && typeof deps === "object" && (deps.next || deps["next"])),
    );
    const hasReactDep = [packageDeps.dependencies, packageDeps.devDependencies, packageDeps.peerDependencies].some((deps) =>
        Boolean(deps && typeof deps === "object" && (deps.react || deps["react"])),
    );
    const hasReactDomDep = [packageDeps.dependencies, packageDeps.devDependencies, packageDeps.peerDependencies].some((deps) =>
        Boolean(deps && typeof deps === "object" && (deps["react-dom"] || deps["react-dom"])),
    );

    if (hasNextDep) pushUnique(nextSignals, "package.json includes next");
    if (hasReactDep && hasReactDomDep) pushUnique(nextSignals, "package.json includes react and react-dom");
    if (hasPath(files, /^(?:src\/)?app\/layout\.(tsx|ts|jsx|js|mdx?)$/i)) pushUnique(nextSignals, "app/layout exists");
    if (hasPath(files, /^(?:src\/)?app\/page\.(tsx|ts|jsx|js|mdx?)$/i)) pushUnique(nextSignals, "app/page exists");
    if (hasPath(files, /^(?:src\/)?app\/.*\/page\.(tsx|ts|jsx|js|mdx?)$/i)) pushUnique(nextSignals, "nested app page route exists");
    if (hasPath(files, /^(?:src\/)?pages\/_app\.(tsx|ts|jsx|js|mdx?)$/i)) pushUnique(nextSignals, "pages/_app exists");
    if (hasPath(files, /^(?:src\/)?pages\/index\.(tsx|ts|jsx|js|mdx?)$/i)) pushUnique(nextSignals, "pages/index exists");
    if (hasPath(files, /^next\.config\.(js|mjs|ts|cjs)$/i)) pushUnique(nextSignals, "next.config exists");
    if (hasPath(files, /^src\/app\/.*$/i) || hasPath(files, /^app\/.*$/i)) pushUnique(nextSignals, "app/ directory present");

    if (hasPath(files, /^public\/index\.html?$/i)) pushUnique(htmlSignals, "public/index.html exists");
    if (hasPath(files, /^public\/.+\/index\.html?$/i)) pushUnique(htmlSignals, "public/**/index.html exists");
    if (hasPath(files, /^index\.html?$/i)) pushUnique(htmlSignals, "root index.html exists");
    if (hasPath(files, /^server\.(js|ts)$/i)) pushUnique(htmlSignals, "server.js/ts exists");

    const htmlScriptHints = asString(packageJson?.scripts?.start || packageJson?.scripts?.dev || "", 4000).toLowerCase();
    if (htmlScriptHints.includes("live-server") || htmlScriptHints.includes("http-server") || htmlScriptHints.includes("serve ")) {
        pushUnique(htmlSignals, "package scripts look static-site oriented");
    }

    const nextScore =
        nextSignals.length * 2 +
        (hasNextDep ? 3 : 0) +
        (hasReactDep && hasReactDomDep ? 1 : 0);
    const htmlScore =
        htmlSignals.length * 2 +
        (hasPath(files, /^public\/index\.html?$/i) ? 3 : 0) +
        (hasPath(files, /^index\.html?$/i) ? 2 : 0);

    const hasNextScaffold = Boolean(
        hasNextDep ||
        hasPath(files, /^(?:src\/)?app\/layout\.(tsx|ts|jsx|js|mdx?)$/i) ||
        hasPath(files, /^(?:src\/)?app\/page\.(tsx|ts|jsx|js|mdx?)$/i) ||
        hasPath(files, /^(?:src\/)?pages\/_app\.(tsx|ts|jsx|js|mdx?)$/i) ||
        hasPath(files, /^(?:src\/)?pages\/index\.(tsx|ts|jsx|js|mdx?)$/i) ||
        hasPath(files, /^next\.config\.(js|mjs|ts|cjs)$/i),
    );

    if (hasNextScaffold) {
        return {
            key: "nextjs",
            label: "Next.js",
            confidence: nextScore >= 7 ? "high" : "medium",
            reason: nextSignals[0] || "Next.js scaffold detected.",
            nextSignals,
            htmlSignals,
            isAmbiguous: nextScore <= htmlScore,
        };
    }

    if (nextScore === 0 && htmlScore === 0) {
        return {
            key: "unknown",
            label: "Unknown framework",
            confidence: "low",
            reason: "Not enough scaffold signals were found.",
            nextSignals,
            htmlSignals,
            isAmbiguous: true,
        };
    }

    if (nextScore >= 5 && nextScore > htmlScore + 1) {
        return {
            key: "nextjs",
            label: "Next.js",
            confidence: nextScore >= 7 ? "high" : "medium",
            reason: nextSignals[0] || "Next.js scaffold detected.",
            nextSignals,
            htmlSignals,
            isAmbiguous: false,
        };
    }

    if (htmlScore >= 4 && htmlScore > nextScore + 1) {
        return {
            key: "html-js",
            label: "HTML/JS",
            confidence: htmlScore >= 6 ? "high" : "medium",
            reason: htmlSignals[0] || "Static HTML/JS scaffold detected.",
            nextSignals,
            htmlSignals,
            isAmbiguous: false,
        };
    }

    if (nextScore > htmlScore) {
        return {
            key: "unknown",
            label: "unknown",
            confidence: "low",
            reason: `Next.js signals (${nextSignals.join(", ") || "none"}) conflict with HTML/JS signals (${htmlSignals.join(", ") || "none"}).`,
            nextSignals,
            htmlSignals,
            isAmbiguous: true,
        };
    }

    if (htmlScore > nextScore) {
        return {
            key: "html-js",
            label: "HTML/JS",
            confidence: htmlScore >= 6 ? "high" : "medium",
            reason: htmlSignals[0] || "Static HTML/JS scaffold detected.",
            nextSignals,
            htmlSignals,
            isAmbiguous: false,
        };
    }

    return {
        key: "unknown",
        label: "unknown",
        confidence: "low",
        reason: `Next.js signals (${nextSignals.join(", ") || "none"}) and HTML/JS signals (${htmlSignals.join(", ") || "none"}) are too close to pick safely.`,
        nextSignals,
        htmlSignals,
        isAmbiguous: true,
    };
}

export function buildProjectFrameworkGuidance(info: ProjectFrameworkInfo): string {
    if (info.key === "nextjs") {
        return [
            "Detected framework: Next.js.",
            "Preserve the existing Next.js/App Router scaffold.",
            "Do not invent plain HTML/JS files unless the user explicitly asks for a migration.",
            "Prefer edits inside the existing app/, src/app/, or pages/ structure.",
            "If there are stray static-site files, treat them as assets unless the user explicitly asks to migrate away from Next.js.",
        ].join(" ");
    }

    if (info.key === "html-js") {
        return [
            "Detected framework: plain HTML/JS.",
            "Preserve the existing static-site or server-based file layout.",
            "Do not create Next.js app router files or convert the project to Next.js unless the user explicitly asks for a migration.",
            "Prefer HTML, CSS, JS, or existing server files already present in the repo.",
        ].join(" ");
    }

    return [
        "Framework detection is ambiguous.",
        "Preserve the existing file pattern and do not switch frameworks by guessing.",
        "If a change would require a framework migration, ask a clarifying question first.",
        "Prefer the safest edit that matches the current files already in the repository.",
    ].join(" ");
}

export function buildProjectFrameworkPrompt(info: ProjectFrameworkInfo, userPrompt: string): string {
    const prompt = asString(userPrompt, 30_000);
    const lines = [
        buildProjectFrameworkGuidance(info),
        `Framework confidence: ${info.confidence}.`,
        `Framework reason: ${info.reason}.`,
        `Next.js signals: ${info.nextSignals.length ? info.nextSignals.join(", ") : "none"}.`,
        `HTML/JS signals: ${info.htmlSignals.length ? info.htmlSignals.join(", ") : "none"}.`,
        "Before suggesting or applying file changes, inspect the repository’s current files and keep changes within the existing scaffold.",
    ];

    if (info.isAmbiguous) {
        lines.push("If the proposed change would switch frameworks, ask for clarification instead of guessing.");
        lines.push("Do not start implementing in one framework and then reverse course in the same response.");
    } else if (info.key === "nextjs") {
        lines.push("Treat Next.js as the source of truth for this repository unless the user explicitly asks to migrate.");
    }

    if (prompt) {
        lines.push("User request:");
        lines.push(prompt);
    }

    return lines.join("\n");
}

export function pathLooksLikeNextJsScaffold(path: string): boolean {
    const value = String(path || "").trim();
    if (!value) return false;

    return (
        /^(?:src\/)?app\/.+\/page\.(tsx|ts|jsx|js|mdx?)$/i.test(value) ||
        /^(?:src\/)?app\/page\.(tsx|ts|jsx|js|mdx?)$/i.test(value) ||
        /^(?:src\/)?app\/layout\.(tsx|ts|jsx|js|mdx?)$/i.test(value) ||
        /^(?:src\/)?pages\/(?:index|.+)\.(tsx|ts|jsx|js|mdx?)$/i.test(value) ||
        /^next\.config\.(js|mjs|ts|cjs)$/i.test(value) ||
        /^(?:src\/)?pages\/_app\.(tsx|ts|jsx|js|mdx?)$/i.test(value)
    );
}

export function pathLooksLikeStaticSiteFile(path: string): boolean {
    const value = String(path || "").trim();
    if (!value) return false;

    return (
        /^public\/.+\/index\.html?$/i.test(value) ||
        /^public\/index\.html?$/i.test(value) ||
        /^index\.html?$/i.test(value) ||
        /^server\.(js|ts)$/i.test(value) ||
        /\.(html?|css|js|mjs|cjs|json|md|mdx)$/i.test(value)
    );
}

export function planWouldSwitchFramework(
    paths: string[],
    info: ProjectFrameworkInfo,
): boolean {
    const list = Array.isArray(paths) ? paths.map((path) => String(path || "").trim()).filter(Boolean) : [];
    if (!list.length) return false;

    if (info.key === "html-js" || info.key === "unknown") {
        return list.some((path) => pathLooksLikeNextJsScaffold(path));
    }

    return false;
}

export function chooseFrameworkCurrentFile(
    files: AppFiles,
    info: ProjectFrameworkInfo,
    currentFile?: string | null,
): string | null {
    const normalizedCurrent = String(currentFile || "").trim();
    if (normalizedCurrent && files?.[normalizedCurrent]) return normalizedCurrent;

    const keys = Object.keys(files || {});
    const pickFirst = (patterns: RegExp[]) => keys.find((path) => patterns.some((pattern) => pattern.test(path))) || null;

    if (info.key === "html-js") {
        return (
            pickFirst([
                /^public\/index\.html?$/i,
                /^public\/.+\/index\.html?$/i,
                /^index\.html?$/i,
                /^server\.(js|ts)$/i,
                /^app\.(js|ts)$/i,
                /^main\.(js|ts)$/i,
                /^index\.(js|ts)$/i,
                /^script\.(js|ts)$/i,
            ]) ||
            pickFirst([/\.html?$/i, /\.(js|ts|jsx|tsx|mdx?)$/i])
        );
    }

    if (info.key === "nextjs") {
        return (
            pickFirst([
                /^(?:src\/)?app\/page\.(tsx|ts|jsx|js|mdx?)$/i,
                /^(?:src\/)?app\/layout\.(tsx|ts|jsx|js|mdx?)$/i,
                /^(?:src\/)?pages\/index\.(tsx|ts|jsx|js|mdx?)$/i,
                /^(?:src\/)?pages\/_app\.(tsx|ts|jsx|js|mdx?)$/i,
            ]) ||
            pickFirst([/^(?:src\/)?app\/.+\/page\.(tsx|ts|jsx|js|mdx?)$/i, /\.(tsx|ts|jsx|js|mdx?)$/i])
        );
    }

    return pickFirst([
        /^public\/index\.html?$/i,
        /^public\/.+\/index\.html?$/i,
        /^index\.html?$/i,
        /^(?:src\/)?app\/page\.(tsx|ts|jsx|js|mdx?)$/i,
        /^(?:src\/)?pages\/index\.(tsx|ts|jsx|js|mdx?)$/i,
        /\.(html?|tsx|ts|jsx|js|mdx?)$/i,
    ]);
}