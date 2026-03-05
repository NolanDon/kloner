// src/components/AppBuilderEditor.tsx
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import Image from "next/image";
import { Folder, File, Upload, X, RefreshCw, MessageSquare, Code, Check, RotateCcw, Database, Rocket, Monitor, SlidersHorizontal, Images, Send } from "lucide-react";
import AIAgentChat from "./AIAgentChat";
import KlonerLoader from "./KlonerLoader";
import WebContainerRunner from "./WebContainerRunner";
import { bootstrapServerSession, ensureSessionAndCsrf } from "@/lib/auth-client";
import { useVercelIntegration } from "@/src/hooks/useVercelIntegration";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "@/src/hooks/useAuth";
import { useModal } from "@/components/ui/ModalContext";
import { compressImageForUpload } from "@/src/lib/clientImageCompression";
import { sanitizeImageName } from "./helpers";

const VERCEL_INTEGRATION_SLUG =
    process.env.NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG || "kloner";

type FileNode = {
    name: string;
    type: "file" | "folder";
    children?: FileNode[];
    content?: string;
};

type AppData = {
    id: string;
    name: string;
    files: { [path: string]: { content: string; lastModified: number } };
    vercelProjectId?: string;
    previewUrl?: string;
    isDeployed?: boolean;
    productionUrl?: string | null;
    vercelProtectionBypassSecret?: string | null;
    generationStatus?: "processing" | "ready" | "error";
    generationError?: string;
    generationProgress?: number | null;
};

type AutoPreviewPhase =
    | "idle"
    | "checking"
    | "connecting"
    | "building"
    | "enabling-bypass"
    | "loading"
    | "ready"
    | "error";

type CodedError = Error & { code?: string };

type PreviewMode = "vercel" | "webcontainer";

type LeftViewMode = "ai" | "code" | "images";

type StagedImage = {
    id: string;
    originalFile: globalThis.File;
    preparedFile: globalThis.File;
    previewUrl: string;
    originalBytes: number;
    preparedBytes: number;
    alt: string;
    placementPrompt: string;
    uploadedUrl: string | null;
    uploadedPath: string | null;
    status: "staged" | "uploading" | "applied" | "failed";
    error: string | null;
};

type PlacementPosition = "top" | "middle" | "bottom";

type ImagePlacementPlan = {
    targetPath: string;
    position: PlacementPosition;
    label: string;
};

type LastImageInsert = {
    stagedImageId: string;
    targetPath: string;
    previousContent: string;
    uploadedPath: string | null;
};

const IMAGE_PLACEMENT_PLACEHOLDERS = [
    "insert this image on the homepage",
    "insert this image for the product display",
    "insert this image in the footer",
];

const APP_BUILDER_COOKIE_CONSENT_KEY = "kloner.appBuilder.necessaryCookiesAccepted.v1";
const APP_BUILDER_COOKIE_CONSENT_COOKIE = "kloner_app_builder_nc";

function getCookieValue(name: string): string | null {
    if (typeof document === "undefined") return null;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1] || "") : null;
}

function hasAcceptedBuilderNecessaryCookies(): boolean {
    if (typeof window === "undefined") return false;

    try {
        const local = window.localStorage.getItem(APP_BUILDER_COOKIE_CONSENT_KEY);
        if (local === "1") return true;
    } catch {
        // ignore
    }

    const cookie = getCookieValue(APP_BUILDER_COOKIE_CONSENT_COOKIE);
    return cookie === "1";
}

function persistBuilderNecessaryCookiesConsent(): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    try {
        window.localStorage.setItem(APP_BUILDER_COOKIE_CONSENT_KEY, "1");
    } catch {
        // ignore
    }

    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${APP_BUILDER_COOKIE_CONSENT_COOKIE}=1; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
}

function formatDeployUrlShortLabel(url: string | null): string {
    if (!url) return "Open live site";
    try {
        const parsed = new URL(url);
        const path = parsed.pathname === "/" ? "" : parsed.pathname;
        const shortPath = path.length > 12 ? `${path.slice(0, 12)}…` : path;
        return `${parsed.hostname}${shortPath}`;
    } catch {
        return url.length > 28 ? `${url.slice(0, 28)}…` : url;
    }
}

function mergeFilesPreferNewest(
    localFiles: AppData["files"],
    remoteFiles: AppData["files"],
): AppData["files"] {
    const merged: AppData["files"] = {};
    const keys = new Set<string>([...Object.keys(localFiles || {}), ...Object.keys(remoteFiles || {})]);
    for (const key of keys) {
        const local = (localFiles as any)?.[key];
        const remote = (remoteFiles as any)?.[key];
        if (!local && remote) {
            merged[key] = remote;
            continue;
        }
        if (!remote && local) {
            merged[key] = local;
            continue;
        }
        if (!local && !remote) continue;

        const localTs = typeof local?.lastModified === "number" ? local.lastModified : 0;
        const remoteTs = typeof remote?.lastModified === "number" ? remote.lastModified : 0;

        // Prefer the newest edit; if tied, prefer local to avoid "undo" flicker
        // while a client write is still in-flight.
        merged[key] = remoteTs > localTs ? remote : local;
    }
    return merged;
}

function ensureCompilerOptionsObject(jsonText: string): { ok: true; normalized: string } | { ok: false } {
    try {
        const parsed: any = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
        if (!parsed.compilerOptions || typeof parsed.compilerOptions !== "object" || Array.isArray(parsed.compilerOptions)) {
            parsed.compilerOptions = {};
            return { ok: true, normalized: JSON.stringify(parsed, null, 2) + "\n" };
        }
        return { ok: true, normalized: JSON.stringify(parsed, null, 2) + "\n" };
    } catch {
        return { ok: false };
    }
}

function filesShallowEqualByContentAndTimestamp(
    a: AppData["files"],
    b: AppData["files"],
): boolean {
    const aKeys = Object.keys(a || {});
    const bKeys = Object.keys(b || {});
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        const av = (a as any)[key];
        const bv = (b as any)[key];
        if (!bv) return false;
        if (av?.lastModified !== bv?.lastModified) return false;
        if (av?.content !== bv?.content) return false;
    }
    return true;
}

function csrfHeaders(csrf: unknown): HeadersInit | undefined {
    if (typeof csrf === "string" && csrf.trim()) {
        return { "x-csrf": csrf };
    }
    return undefined;
}

function detectNextAppDir(files: AppData["files"] | null | undefined): "src/app" | "app" | null {
    if (!files) return null;
    const keys = Object.keys(files);
    if (keys.some((k) => k === "src/app/layout.tsx" || k.startsWith("src/app/"))) return "src/app";
    if (keys.some((k) => k === "app/layout.tsx" || k.startsWith("app/"))) return "app";
    return null;
}

function buildHeadTsxWithFavicon(faviconUrl: string): string {
    const localHrefLiteral = JSON.stringify("/favicon.ico");
    return (
        `export default function Head() {\n` +
        `  return (\n` +
        `    <>\n` +
        `      {/* kloner:favicon */}\n` +
        `      <link rel="icon" href=${localHrefLiteral} />\n` +
        `    </>\n` +
        `  );\n` +
        `}\n`
    );
}

function upsertFaviconInHeadTsx(existing: string, faviconUrl: string): string {
    const nextHref = JSON.stringify("/favicon.ico");

    // Prefer updating our marker line if present.
    if (existing.includes("kloner:favicon")) {
        const lines = existing.split(/\r?\n/);
        let changed = false;
        const out = lines.map((line) => {
            if (line.includes("kloner:favicon")) {
                changed = true;
                return line;
            }
            if (changed && /<link\s+[^>]*rel=["']icon["'][^>]*>/i.test(line)) {
                return `      <link rel="icon" href=${nextHref} />`;
            }
            return line;
        });
        return out.join("\n");
    }

    // Replace an existing rel="icon" href="..." in either attribute order.
    const r1 = /(<link\s+[^>]*rel=["']icon["'][^>]*href=["'])([^"']*)(["'][^>]*>)/i;
    if (r1.test(existing)) {
        return existing.replace(r1, `$1/favicon.ico$3`);
    }
    const r2 = /(<link\s+[^>]*href=["'])([^"']*)(["'][^>]*rel=["']icon["'][^>]*>)/i;
    if (r2.test(existing)) {
        return existing.replace(r2, `$1/favicon.ico$3`);
    }

    // If it's a TSX file with a return fragment, insert our link near the top.
    const insertAfter = existing.indexOf("return (");
    if (insertAfter !== -1) {
        const idx = existing.indexOf("<>", insertAfter);
        if (idx !== -1) {
            const before = existing.slice(0, idx + 2);
            const after = existing.slice(idx + 2);
            return (
                before +
                `\n      {/* kloner:favicon */}\n      <link rel=\"icon\" href=${nextHref} />` +
                after
            );
        }
    }

    // Fallback: preserve existing and append a safe link.
    return existing + `\n\n{/* kloner:favicon */}\n<link rel=\"icon\" href=${nextHref} />\n`;
}

function buildFaviconIcoRouteTs(faviconUrl: string): string {
    const urlLiteral = JSON.stringify(faviconUrl);
    return (
        `// kloner:favicon-route\n` +
        `const FAVICON_URL = ${urlLiteral};\n\n` +
        `async function fetchFavicon() {\n` +
        `  const upstream = await fetch(FAVICON_URL, { cache: "no-store" });\n` +
        `  if (!upstream.ok) {\n` +
        `    return new Response(null, { status: 307, headers: { Location: FAVICON_URL } });\n` +
        `  }\n` +
        `  const contentType = upstream.headers.get("content-type") || "image/x-icon";\n` +
        `  const cacheControl = upstream.headers.get("cache-control") || "public, max-age=3600";\n` +
        `  const body = await upstream.arrayBuffer();\n` +
        `  return new Response(body, {\n` +
        `    status: 200,\n` +
        `    headers: {\n` +
        `      "content-type": contentType,\n` +
        `      "cache-control": cacheControl,\n` +
        `    },\n` +
        `  });\n` +
        `}\n\n` +
        `export async function GET() {\n` +
        `  return fetchFavicon();\n` +
        `}\n\n` +
        `export async function HEAD() {\n` +
        `  const res = await fetchFavicon();\n` +
        `  return new Response(null, { status: res.status, headers: res.headers });\n` +
        `}\n`
    );
}

function addCacheBust(url: string, token: string | number): string {
    try {
        const u = new URL(url);
        // IMPORTANT: `t` is reserved as the preview viewer token (capability).
        // Use a different param for cache-busting.
        u.searchParams.set("cb", String(token));
        return u.toString();
    } catch {
        const suffix = url.includes("?") ? "&" : "?";
        return `${url}${suffix}cb=${encodeURIComponent(String(token))}`;
    }
}

function addVercelProtectionBypass(url: string, secret: string | null | undefined): string {
    const s = (secret || "").trim();
    if (!s) return url;
    try {
        const u = new URL(url);
        u.searchParams.set("x-vercel-protection-bypass", s);
        return u.toString();
    } catch {
        const suffix = url.includes("?") ? "&" : "?";
        return `${url}${suffix}x-vercel-protection-bypass=${encodeURIComponent(s)}`;
    }
}

function escapeAttribute(value: string): string {
    return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildImageSnippet(url: string, alt: string): string {
    const safeUrl = escapeAttribute(url);
    const safeAlt = escapeAttribute(alt || "");
    return `<img src=\"${safeUrl}\" alt=\"${safeAlt}\" loading=\"lazy\" />`;
}

function detectPlacementPosition(prompt: string): PlacementPosition {
    const p = String(prompt || "").toLowerCase();
    if (/(bottom|footer|end|last|below)/i.test(p)) return "bottom";
    if (/(top|header|hero|start|above|first)/i.test(p)) return "top";
    return "middle";
}

function resolveFileFromPrompt(
    files: AppData["files"],
    prompt: string,
    currentFile: string | null,
): string | null {
    const p = String(prompt || "").toLowerCase();
    const keys = Object.keys(files || {});
    const codeKeys = keys.filter((k) => /\.(tsx|ts|jsx|js|html|mdx?)$/i.test(k));

    const byPriority = (candidates: string[]) => candidates.find((c) => Boolean((files as any)?.[c])) || null;

    if (/(this file|current file|here)/i.test(p) && currentFile && (files as any)?.[currentFile]) {
        return currentFile;
    }

    const homepage = byPriority(["src/app/page.tsx", "app/page.tsx", "src/pages/index.tsx", "pages/index.tsx", "src/pages/index.jsx", "pages/index.jsx"]);
    if (/(homepage|home page|home|landing)/i.test(p) && homepage) {
        return homepage;
    }

    const routeMatch = p.match(/\/(\w[\w-]*)/);
    if (routeMatch && routeMatch[1]) {
        const route = routeMatch[1].toLowerCase();
        const routeFile = codeKeys.find((k) => k.toLowerCase().includes(`/app/${route}/page.`) || k.toLowerCase().includes(`/pages/${route}.`));
        if (routeFile) return routeFile;
    }

    const sectionHints: Array<{ match: RegExp; token: string }> = [
        { match: /(about)/i, token: "about" },
        { match: /(contact)/i, token: "contact" },
        { match: /(pricing|price)/i, token: "price" },
        { match: /(team)/i, token: "team" },
        { match: /(blog)/i, token: "blog" },
        { match: /(faq|support)/i, token: "support" },
    ];
    for (const hint of sectionHints) {
        if (!hint.match.test(p)) continue;
        const match = codeKeys.find((k) => k.toLowerCase().includes(hint.token));
        if (match) return match;
    }

    if (currentFile && (files as any)?.[currentFile] && /\.(tsx|ts|jsx|js|html|mdx?)$/i.test(currentFile)) {
        return currentFile;
    }

    if (homepage) return homepage;
    return codeKeys[0] || null;
}

function resolveImagePlacementPlan(
    files: AppData["files"],
    prompt: string,
    currentFile: string | null,
): ImagePlacementPlan | null {
    const targetPath = resolveFileFromPrompt(files, prompt, currentFile);
    if (!targetPath) return null;
    const position = detectPlacementPosition(prompt);
    return {
        targetPath,
        position,
        label: `${targetPath} (${position})`,
    };
}

function insertSnippetIntoContent(content: string, snippet: string, position: PlacementPosition): string {
    const base = String(content || "");
    const insertAfterTag = (regex: RegExp): string | null => {
        const m = regex.exec(base);
        if (!m || m.index < 0) return null;
        const start = m.index;
        const end = start + m[0].length;
        return `${base.slice(0, end)}\n${snippet}\n${base.slice(end)}`;
    };

    if (position === "top") {
        return (
            insertAfterTag(/<main[^>]*>/i) ||
            insertAfterTag(/<header[^>]*>/i) ||
            insertAfterTag(/<body[^>]*>/i) ||
            `${snippet}\n${base}`
        );
    }

    if (position === "bottom") {
        const mainClose = base.search(/<\/main>/i);
        if (mainClose >= 0) {
            return `${base.slice(0, mainClose)}\n${snippet}\n${base.slice(mainClose)}`;
        }
        const bodyClose = base.search(/<\/body>/i);
        if (bodyClose >= 0) {
            return `${base.slice(0, bodyClose)}\n${snippet}\n${base.slice(bodyClose)}`;
        }
        const needsBreak = base.length > 0 && !base.endsWith("\n");
        return `${base}${needsBreak ? "\n" : ""}${snippet}\n`;
    }

    return (
        insertAfterTag(/<section[^>]*>/i) ||
        insertAfterTag(/<main[^>]*>/i) ||
        (() => {
            const needsBreak = base.length > 0 && !base.endsWith("\n");
            return `${base}${needsBreak ? "\n" : ""}${snippet}\n`;
        })()
    );
}

function FileTree({ nodes, onFileSelect, prefix = "" }: {
    nodes: FileNode[];
    onFileSelect: (path: string) => void;
    prefix?: string;
}) {
    return (
        <ul>
            {nodes.map((node) => (
                <li key={node.name}>
                    <div
                        className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-100"
                        onClick={() => node.type === "file" && onFileSelect(prefix + node.name)}
                    >
                        {node.type === "folder" ? (
                            <Folder className="w-4 h-4" />
                        ) : (
                            <File className="w-4 h-4" />
                        )}
                        <span>{node.name}</span>
                    </div>
                    {node.children && (
                        <FileTree
                            nodes={node.children}
                            onFileSelect={onFileSelect}
                            prefix={prefix + node.name + "/"}
                        />
                    )}
                </li>
            ))}
        </ul>
    );
}

export default function AppBuilderEditor({ appId, onClose, onDeploy, agentWelcomeContext }: {
    appId: string;
    onClose: () => void;
    onDeploy?: (app: { id: string; name: string }) => void;
    agentWelcomeContext?: {
        source?: "prompt" | "url" | "quickstart" | "template" | "sample" | "unknown";
        prompt?: string | null;
        url?: string | null;
        templateName?: string | null;
    };
}) {
    const { user, loading: authLoading } = useAuth();
    const { showConfirm, showAlert } = useModal();

    const faviconInputRef = useRef<HTMLInputElement | null>(null);
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const [faviconUploading, setFaviconUploading] = useState(false);
    const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
    const [supabaseConnected, setSupabaseConnected] = useState<boolean | null>(null);
    const [supabaseProjectName, setSupabaseProjectName] = useState<string | null>(null);
    const [supabaseProjectRef, setSupabaseProjectRef] = useState<string | null>(null);
    const [supabaseDbReachable, setSupabaseDbReachable] = useState<boolean | null>(null);
    const [supabaseDbStatusText, setSupabaseDbStatusText] = useState<string | null>(null);
    const [supabaseDbReason, setSupabaseDbReason] = useState<string | null>(null);
    const [supabaseDbLastCheckedAt, setSupabaseDbLastCheckedAt] = useState<number | null>(null);
    const [cookiesConsentResolved, setCookiesConsentResolved] = useState(false);
    const [acceptedNecessaryCookies, setAcceptedNecessaryCookies] = useState(false);
    const supabaseVerifyInFlightRef = useRef(false);
    const lastSupabaseVerifyAtRef = useRef(0);
    const supabaseConnectedRef = useRef<boolean | null>(null);
    const supabaseDbHealthInFlightRef = useRef(false);
    const lastSupabaseDbHealthAtRef = useRef(0);

    useEffect(() => {
        supabaseConnectedRef.current = supabaseConnected;
    }, [supabaseConnected]);

    useEffect(() => {
        const accepted = hasAcceptedBuilderNecessaryCookies();
        setAcceptedNecessaryCookies(accepted);
        setCookiesConsentResolved(true);
    }, []);

    const acceptNecessaryCookiesAndContinue = useCallback(() => {
        persistBuilderNecessaryCookiesConsent();
        setAcceptedNecessaryCookies(true);
        setCookiesConsentResolved(true);
        setPreviewMode("webcontainer");
        setAutoPreviewError(null);
        setReconnectKey((k) => k + 1);
        setRefreshKey((k) => k + 1);
    }, []);

        const refreshSupabaseStatusFromApi = useCallback(async (): Promise<boolean> => {
            try {
                const url = appId
                    ? `/api/supabase/project-status?appId=${encodeURIComponent(appId)}`
                    : "/api/supabase/project-status";
                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) return false;
                const data: any = await res.json().catch(() => null);
                if (data && data.completed && data.ok) {
                    const name = typeof data?.project?.name === "string" && data.project.name.trim() ? data.project.name.trim() : null;
                    const ref =
                        (typeof data?.project?.ref === "string" && data.project.ref.trim() ? data.project.ref.trim() : null) ||
                        (typeof data?.project?.id === "string" && data.project.id.trim() ? data.project.id.trim() : null);

                    setSupabaseConnected(true);
                    setSupabaseProjectName(name);
                    setSupabaseProjectRef(ref);
                    return true;
                }
                if (data && data.completed && data.ok === false) {
                    setSupabaseConnected(false);
                    setSupabaseProjectName(null);
                    setSupabaseProjectRef(null);
                }
                return false;
            } catch {
                return false;
            }
        }, []);

        const verifySupabaseConnection = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
            if (!user?.uid) return false;
            if (supabaseVerifyInFlightRef.current) return supabaseConnectedRef.current === true;

            const now = Date.now();
            if (now - lastSupabaseVerifyAtRef.current < 10_000) {
                return supabaseConnectedRef.current === true;
            }
            lastSupabaseVerifyAtRef.current = now;
            supabaseVerifyInFlightRef.current = true;

            try {
                const csrf = await ensureSessionAndCsrf().catch(() => null);
                const res = await fetch("/api/supabase/verify", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    body: JSON.stringify({ cleanupIfDeleted: true, appId: appId || undefined }),
                });
                const data: any = await res.json().catch(() => null);

                if (!res.ok || !data?.ok) {
                    // If we're in a neutral/"verifying" state, don't get stuck.
                    // Fall back to the session-protected status endpoint (GET; no CSRF).
                    if (supabaseConnectedRef.current === null) {
                        const ok = await refreshSupabaseStatusFromApi();
                        if (ok) return true;
                        setSupabaseConnected(false);
                        setSupabaseProjectName(null);
                        setSupabaseProjectRef(null);
                        return false;
                    }
                    // Don’t flap the UI on transient failures.
                    return supabaseConnectedRef.current === true;
                }

                if (data.connected) {
                    setSupabaseConnected(true);
                    return true;
                }

                // Not connected; clear locally.
                setSupabaseConnected(false);
                setSupabaseProjectName(null);
                setSupabaseProjectRef(null);

                if (!opts?.silent) {
                    const reason = typeof data?.reason === "string" ? data.reason : "disconnected";
                    const msg =
                        reason === "project_deleted"
                            ? "Your Supabase project no longer exists (it looks like it was deleted). Kloner removed the stale connection."
                            : reason === "unauthorized"
                              ? "Kloner can’t access your Supabase project anymore. Please reconnect Supabase."
                              : reason === "app_mismatch"
                                ? "" // Silently clear — this integration belongs to a different app
                                : "Supabase is no longer connected. Please reconnect.";
                    if (msg) void showAlert(msg, "Database");
                }
                return false;
            } catch {
                if (supabaseConnectedRef.current === null) {
                    const ok = await refreshSupabaseStatusFromApi();
                    if (ok) return true;
                    setSupabaseConnected(false);
                    setSupabaseProjectName(null);
                    setSupabaseProjectRef(null);
                    return false;
                }
                return supabaseConnectedRef.current === true;
            } finally {
                supabaseVerifyInFlightRef.current = false;
            }
        }, [refreshSupabaseStatusFromApi, showAlert, user?.uid]);

        const checkSupabaseDbHealth = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
            if (!user?.uid) return false;
            if (supabaseDbHealthInFlightRef.current) return supabaseDbReachable === true;

            const now = Date.now();
            if (now - lastSupabaseDbHealthAtRef.current < 10_000) {
                return supabaseDbReachable === true;
            }
            lastSupabaseDbHealthAtRef.current = now;
            supabaseDbHealthInFlightRef.current = true;

            try {
                const csrf = await ensureSessionAndCsrf().catch(() => null);
                const res = await fetch("/api/supabase/db-health", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    body: JSON.stringify({ cleanupIfDeleted: true, appId: appId || undefined }),
                    cache: "no-store",
                });

                const data: any = await res.json().catch(() => null);
                setSupabaseDbLastCheckedAt(Date.now());

                if (!res.ok || !data?.ok) {
                    // Don’t flap on transient failures.
                    setSupabaseDbReachable(null);
                    setSupabaseDbStatusText("Could not verify database reachability");
                    return false;
                }

                if (data.connected === false) {
                    setSupabaseConnected(false);
                    setSupabaseProjectName(null);
                    setSupabaseProjectRef(null);
                    setSupabaseDbReachable(false);
                    setSupabaseDbReason(data?.reason || null);
                    setSupabaseDbStatusText(
                        data?.reason === "project_deleted"
                            ? "Supabase project was deleted"
                            : data?.reason === "unauthorized"
                              ? "Supabase access unauthorized"
                              : "Supabase not connected",
                    );

                    if (!opts?.silent) {
                        void showAlert(
                            data?.reason === "project_deleted"
                                ? "Your Supabase project no longer exists (it looks like it was deleted). Kloner removed the stale connection."
                                : "Supabase is not reachable right now. Please reconnect.",
                            "Database",
                        );
                    }
                    return false;
                }

                const reachable = Boolean(data.reachable);
                setSupabaseDbReachable(reachable);
                setSupabaseDbReason(reachable ? null : (data?.reason || null));

                const reason = typeof data?.reason === "string" ? data.reason : "";
                setSupabaseDbStatusText(
                    reachable
                        ? "Database reachable"
                        : reason === "project_paused"
                          ? "Project is paused — resume it in the Supabase dashboard"
                          : reason === "timeout_or_network"
                            ? "Connection timed out — project may still be resuming after a pause"
                            : (typeof data?.error === "string" && data.error.trim())
                              ? data.error.trim()
                              : "Database not reachable (project may be paused or networking is blocked)",
                );
                return reachable;
            } catch {
                setSupabaseDbLastCheckedAt(Date.now());
                setSupabaseDbReachable(null);
                setSupabaseDbReason(null);
                setSupabaseDbStatusText("Could not verify database reachability");
                return false;
            } finally {
                supabaseDbHealthInFlightRef.current = false;
            }
        }, [showAlert, supabaseDbReachable, user?.uid]);

        useEffect(() => {
            if (!user?.uid) {
                setSupabaseConnected(null);
                setSupabaseProjectName(null);
                setSupabaseProjectRef(null);
                setSupabaseDbReachable(null);
                setSupabaseDbReason(null);
                setSupabaseDbStatusText(null);
                setSupabaseDbLastCheckedAt(null);
                return;
            }

            setSupabaseConnected(null);
            const integrationRef = doc(db, "kloner_users", user.uid, "kloner_apps", appId, "integrations", "supabase");
            const unsub = onSnapshot(
                integrationRef,
                (snap) => {
                    if (!snap.exists()) {
                        setSupabaseConnected(false);
                        setSupabaseProjectName(null);
                        setSupabaseProjectRef(null);
                        return;
                    }
                    const data = snap.data() as any;

                    // Optimistically show connected if the integration doc exists.
                    // Background verification will flip it back to disconnected if the project was deleted.
                    setSupabaseConnected(true);
                    setSupabaseProjectName(
                        typeof data?.projectName === "string" && data.projectName.trim() ? data.projectName.trim() : null,
                    );
                    const ref =
                        (typeof data?.projectRef === "string" && data.projectRef.trim() ? data.projectRef.trim() : null) ||
                        (typeof data?.projectId === "string" && data.projectId.trim() ? data.projectId.trim() : null);
                    setSupabaseProjectRef(ref);

                    void verifySupabaseConnection({ silent: true });
                    void checkSupabaseDbHealth({ silent: true });
                },
                () => {
                    // If Firestore read fails (rules/offline), fall back to the session-protected status endpoint.
                    void refreshSupabaseStatusFromApi().then((ok) => {
                        if (!ok) {
                            setSupabaseConnected(false);
                            setSupabaseProjectName(null);
                            setSupabaseProjectRef(null);
                        }
                    });
                },
            );

            let didCleanup = false;
            return () => {
                if (didCleanup) return;
                didCleanup = true;
                try {
                    unsub();
                } catch (err) {
                    // Firestore can throw internal assertion errors in rare edge cases
                    // (e.g. rapid subscribe/unsubscribe or React strict-mode double-invoke).
                    console.warn("Supabase integration listener unsubscribe error:", err);
                }
            };
        }, [checkSupabaseDbHealth, refreshSupabaseStatusFromApi, user?.uid, verifySupabaseConnection]);

        useEffect(() => {
            if (!supabaseConnected) return;
            const id = window.setInterval(() => {
                void checkSupabaseDbHealth({ silent: true });
            }, 60_000);
            return () => window.clearInterval(id);
        }, [checkSupabaseDbHealth, supabaseConnected]);

        const disconnectSupabase = useCallback(async () => {
            if (!user?.uid) {
                void showAlert("Please sign in to disconnect your database.", "Database");
                return;
            }

            const confirmed = await showConfirm(
                "Disconnect Supabase from Kloner?\n\nThis does NOT delete your Supabase project — it only removes Kloner’s stored connection so you can connect a different project.",
                "Database",
            );
            if (!confirmed) return;

            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch("/api/supabase/disconnect", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ confirm: "DISCONNECT", appId: appId || undefined }),
            });

            const data: any = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                const msg = (data && (data.error || data.message)) ? String(data.error || data.message) : "Failed to disconnect.";
                void showAlert(msg, "Database");
                return;
            }

            setSupabaseConnected(false);
            setSupabaseProjectName(null);
            setSupabaseProjectRef(null);
            void showAlert("Disconnected. Your Supabase project was not deleted.", "Database");
        }, [showAlert, showConfirm, user?.uid]);

        const openDatabaseConnect = useCallback(async () => {
            if (!user?.uid) {
                void showAlert("Please sign in to connect a database.", "Database");
                return;
            }

            if (supabaseConnected) {
                // Re-verify before claiming connected/opening external links.
                // If the Supabase project was deleted, this will flip the UI to disconnected.
                // (silent=false so the user gets a clear message.)
                const stillConnected = await verifySupabaseConnection({ silent: false });
                if (!stillConnected) return;
                const label = supabaseProjectName ? `Supabase is connected (\"${supabaseProjectName}\").` : "Supabase is connected.";
                const confirmed = await showConfirm(
                    `${label}\n\nOpen the Supabase dashboard in a new tab?`,
                    "Database",
                );
                if (confirmed) {
                    const ref = (supabaseProjectRef || "").trim();
                    if (ref) {
                        window.open(`https://supabase.com/dashboard/project/${encodeURIComponent(ref)}`, "_blank", "noopener,noreferrer");
                    } else {
                        window.open("https://supabase.com/dashboard", "_blank", "noopener,noreferrer");
                    }
                }
                return;
            }

            setViewMode("ai");
            window.dispatchEvent(new CustomEvent("kloner:open-db-connect", { detail: { provider: "supabase" } }));
        }, [showAlert, showConfirm, supabaseConnected, supabaseProjectName, supabaseProjectRef, user?.uid, verifySupabaseConnection]);
    const [app, setApp] = useState<AppData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);
    const [currentFile, setCurrentFile] = useState<string | null>(null);
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [code, setCode] = useState<string>("");
    const [refreshKey, setRefreshKey] = useState(0);
    const [applyCompleteKey, setApplyCompleteKey] = useState(0);
    const [localRestartKey, setLocalRestartKey] = useState(0);
    const [reconnectKey, setReconnectKey] = useState(0);
    const [isWebPreviewReady, setIsWebPreviewReady] = useState(false);
    const [dismissedGenerationError, setDismissedGenerationError] = useState(false);
    const [agentCreditError, setAgentCreditError] = useState<string | null>(null);
    const lastConsumedAiCreditRequestIdRef = useRef<string | null>(null);
    const [forceFreshStart, setForceFreshStart] = useState(false);
    const forceFreshStartRef = useRef(false);
    const forceFreshStartKey = useRef(0);
    const [viewMode, setViewMode] = useState<LeftViewMode>("ai"); // Default to AI chat
    const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
    const stagedImagesRef = useRef<StagedImage[]>([]);
    const [autoCompressImages, setAutoCompressImages] = useState(true);
    const [lastImageInsert, setLastImageInsert] = useState<LastImageInsert | null>(null);
    const [imagePromptPlaceholderIdx, setImagePromptPlaceholderIdx] = useState(0);
    const [isMobile, setIsMobile] = useState(false);
    const [mobileTab, setMobileTab] = useState<"app" | "prompt">("app");
    const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [tempName, setTempName] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isDeploying, setIsDeploying] = useState(false);
    const [isPreviewBuilding, setIsPreviewBuilding] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [protectedPreviewUrl, setProtectedPreviewUrl] = useState<string | null>(null);
    const [vercelSecuritySettingsUrl, setVercelSecuritySettingsUrl] = useState<string | null>(null);
    const [vercelDeploymentProtectionSettingsUrl, setVercelDeploymentProtectionSettingsUrl] = useState<string | null>(null);
    const [vercelProtectionBypassDraft, setVercelProtectionBypassDraft] = useState<string>("");
    const [savingVercelProtectionBypass, setSavingVercelProtectionBypass] = useState(false);
    const [enablingVercelProtectionBypass, setEnablingVercelProtectionBypass] = useState(false);
    const [autoPreviewPhase, setAutoPreviewPhase] = useState<AutoPreviewPhase>("idle");
    const [autoPreviewError, setAutoPreviewError] = useState<string | null>(null);
    const [autoPreviewAttempt, setAutoPreviewAttempt] = useState<number>(0);
    const [autoPreviewBypassUnsupported, setAutoPreviewBypassUnsupported] = useState(false);
    const [previewMode, setPreviewMode] = useState<PreviewMode>("webcontainer");
    const [vercelConnectOpen, setVercelConnectOpen] = useState(false);
    const [vercelConnectOpening, setVercelConnectOpening] = useState(false);
    const [generationEver, setGenerationEver] = useState(false);

    const handleCompileErrorFixRequest = useCallback((payload: {
        appId: string;
        code: string;
        actionType: "quick_fix_compile";
        fixAction?: string;
        compileError: {
            summary: string;
            detail: string;
            fingerprint: string;
        };
    }) => {
        setViewMode("ai");
        if (isMobile) setMobileTab("prompt");
        if (typeof window === "undefined") return;
        try {
            window.dispatchEvent(new CustomEvent("kloner:compile-error-fix-request", { detail: payload }));
        } catch {
            // ignore
        }
    }, [isMobile]);

    useEffect(() => {
        stagedImagesRef.current = stagedImages;
    }, [stagedImages]);

    useEffect(() => {
        if (viewMode !== "images") return;
        const id = window.setInterval(() => {
            setImagePromptPlaceholderIdx((prev) => (prev + 1) % IMAGE_PLACEMENT_PLACEHOLDERS.length);
        }, 2600);
        return () => window.clearInterval(id);
    }, [viewMode]);

    useEffect(() => {
        return () => {
            for (const item of stagedImagesRef.current) {
                try {
                    URL.revokeObjectURL(item.previewUrl);
                } catch {
                    // ignore
                }
            }
        };
    }, []);

    const uploadImageToUserBlob = useCallback(async (file: globalThis.File) => {
        const csrf = await ensureSessionAndCsrf().catch(() => null);
        const safeName = sanitizeImageName(file.name || "upload.bin");
        const url = `/api/user-blob/upload-url?filename=${encodeURIComponent(safeName)}&renderId=${encodeURIComponent(appId)}`;

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "content-type": file.type || "application/octet-stream",
                ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
            },
            credentials: "include",
            body: file,
        });

        const j = await res.json().catch(() => ({} as any));
        if (!res.ok || !j?.url) {
            throw new Error(j?.error || `upload_failed_${res.status}`);
        }

        return {
            url: String(j.url),
            path: typeof j.path === "string" ? j.path : null,
        };
    }, [appId]);

    const deleteUserBlobPaths = useCallback(async (paths: string[]) => {
        const filtered = paths.filter((p) => typeof p === "string" && p.trim().length > 0);
        if (!filtered.length) return;

        const csrf = await ensureSessionAndCsrf().catch(() => null);
        await fetch("/api/user-blob/delete", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
            },
            credentials: "include",
            body: JSON.stringify({ paths: filtered }),
        }).catch(() => null);
    }, []);

    const handlePickImages = useCallback(() => {
        imageInputRef.current?.click();
    }, []);

    const handleImageFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputFiles = Array.from(e.target.files || []);
        if (!inputFiles.length) return;

        const valid = inputFiles.filter((f) => f.type.startsWith("image/"));
        if (!valid.length) {
            void showAlert("Please select image files only.", "Images");
            e.target.value = "";
            return;
        }

        const nextItems = await Promise.all(
            valid.map(async (file) => {
                let prepared = file;
                if (autoCompressImages) {
                    try {
                        prepared = await compressImageForUpload(file);
                    } catch {
                        prepared = file;
                    }
                }

                return {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    originalFile: file,
                    preparedFile: prepared,
                    previewUrl: URL.createObjectURL(prepared),
                    originalBytes: file.size,
                    preparedBytes: prepared.size,
                    alt: file.name.replace(/\.[^.]+$/, "") || "",
                    placementPrompt: "",
                    uploadedUrl: null,
                    uploadedPath: null,
                    status: "staged" as const,
                    error: null,
                };
            })
        );

        setStagedImages((prev) => [...nextItems, ...prev]);
        e.target.value = "";
    }, [autoCompressImages, showAlert]);

    const removeStagedImage = useCallback((id: string) => {
        setStagedImages((prev) => {
            const target = prev.find((item) => item.id === id);
            if (target) {
                try {
                    URL.revokeObjectURL(target.previewUrl);
                } catch {
                    // ignore
                }
            }
            return prev.filter((item) => item.id !== id);
        });
    }, []);

    const clearStagedImages = useCallback(() => {
        setStagedImages((prev) => {
            for (const item of prev) {
                try {
                    URL.revokeObjectURL(item.previewUrl);
                } catch {
                    // ignore
                }
            }
            return [];
        });
    }, []);

    const updateStagedImage = useCallback((id: string, patch: Partial<StagedImage>) => {
        setStagedImages((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    }, []);

    const generationPlaceholderFiles = useMemo(() => {
        // Minimal Next.js App Router template so we can start a machine immediately
        // while backend generation is still running.
        const appName = String((app as any)?.name || "Kloner App");
        const safeTitle = appName.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return {
            "package.json": {
                content: JSON.stringify(
                    {
                        name: "kloner-generated-app",
                        private: true,
                        scripts: {
                            dev: "next dev -p 3000",
                            build: "next build",
                            start: "next start -p 3000",
                        },
                        dependencies: {
                            next: "^14.0.0",
                            react: "^18.2.0",
                            "react-dom": "^18.2.0",
                        },
                    },
                    null,
                    2,
                ) + "\n",
            },
            "next.config.mjs": {
                content: "export default {\n  reactStrictMode: true,\n};\n",
            },
            "tsconfig.json": {
                content:
                    JSON.stringify(
                        {
                            compilerOptions: {
                                target: "ES2020",
                                lib: ["dom", "dom.iterable", "esnext"],
                                allowJs: true,
                                skipLibCheck: true,
                                strict: false,
                                noEmit: true,
                                esModuleInterop: true,
                                module: "esnext",
                                moduleResolution: "bundler",
                                resolveJsonModule: true,
                                isolatedModules: true,
                                jsx: "preserve",
                                incremental: true,
                                baseUrl: ".",
                                paths: { "@/*": ["./*"] },
                            },
                            include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
                            exclude: ["node_modules"],
                        },
                        null,
                        2,
                    ) + "\n",
            },
            "next-env.d.ts": {
                content: "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types\" />\n\n// NOTE: This file should not be edited\n// see https://nextjs.org/docs/pages/api-reference/config/typescript for more information.\n",
            },
            "app/layout.tsx": {
                content:
                    `export const metadata = {\n  title: ${JSON.stringify(appName)},\n  description: "Generating your app…",\n};\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang=\"en\">\n      <body style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system' }}>{children}</body>\n    </html>\n  );\n}\n`,
            },
            "app/page.tsx": {
                content:
                    `export default function Page() {\n  return (\n    <main style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>\n      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>${safeTitle}</h1>\n      <p style={{ color: '#374151', marginBottom: 16 }}>\n        Your app is being generated from your screenshots.\n      </p>\n      <div style={{ padding: 16, borderRadius: 12, border: '1px solid #e5e7eb', background: '#f9fafb' }}>\n        <div style={{ fontWeight: 600, marginBottom: 6 }}>Preview machine</div>\n        <div style={{ color: '#6b7280' }}>Starting now so it’s ready when generation finishes.</div>\n      </div>\n    </main>\n  );\n}\n`,
            },
        } as Record<string, { content: string }>;
    }, [app]);

    const isGenerationProcessing = app?.generationStatus === "processing";

    const generationErrorText = useMemo(() => {
        return String((app as any)?.generationError || "");
    }, [app]);

    const generationErrorLooksPreviewRelated = useMemo(() => {
        const t = generationErrorText.toLowerCase();
        return (
            t.includes("preview") ||
            t.includes("webcontainer") ||
            t.includes("hub") ||
            t.includes("502") ||
            t.includes("poll") ||
            t.includes("render_failed")
        );
    }, [generationErrorText]);

    useEffect(() => {
        // If the backend marked generation as error due to a transient preview issue,
        // but the preview is now connected, don't hard-block the UI.
        if (app?.generationStatus !== "error") return;
        if (!generationErrorLooksPreviewRelated) return;
        if (!isWebPreviewReady) return;
        setDismissedGenerationError(true);
    }, [app?.generationStatus, generationErrorLooksPreviewRelated, isWebPreviewReady]);
    useEffect(() => {
        if (app?.generationStatus === "processing") {
            setGenerationEver(true);
        }
    }, [app?.generationStatus]);
    const effectivePreviewFiles = useMemo(() => {
        if (isGenerationProcessing) return generationPlaceholderFiles;
        return (app?.files as any) || {};
    }, [app?.files, generationPlaceholderFiles, isGenerationProcessing]);

    const usedPlaceholderRef = useRef(false);
    useEffect(() => {
        if (isGenerationProcessing) usedPlaceholderRef.current = true;
    }, [isGenerationProcessing]);

    // Guard against losing in-editor changes on refresh/navigation.
    // - For full-page navigations (refresh/close/url change), browsers require a synchronous beforeunload prompt.
    // - For in-app navigations (links/back), we can use the global confirm modal.
    const codeRef = useRef<string>("");
    useEffect(() => {
        codeRef.current = code;
    }, [code]);

    const allowNextNavigationRef = useRef(false);
    const leaveGuardArmedRef = useRef(false);
    const getHasUnsavedChanges = useCallback((): boolean => {
        if (!appId) return false;

        // If an autosave is pending, treat as unsaved.
        if (autoSaveTimeoutRef.current) return true;
        if (isSaving) return true;

        const cur = currentFileRef.current;
        if (!cur) return false;
        const files = appRef.current?.files as any;
        const saved = files?.[cur]?.content;
        if (typeof saved !== "string") return false;
        return codeRef.current !== saved;
    }, [appId, isSaving]);

    const getLeaveWarningText = useCallback((): string => {
        return getHasUnsavedChanges()
            ? "You have unsaved changes that may be lost. Leave this page anyway?"
            : "Leave the App Builder?";
    }, [getHasUnsavedChanges]);

    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (allowNextNavigationRef.current) return;
            // Required for Chrome/Safari to show a confirmation dialog.
            e.preventDefault();
            e.returnValue = "";
        };

        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [getHasUnsavedChanges]);

    const showConfirmRef = useRef(showConfirm);
    const getHasUnsavedChangesRef = useRef(getHasUnsavedChanges);
    const getLeaveWarningTextRef = useRef(getLeaveWarningText);

    useEffect(() => {
        showConfirmRef.current = showConfirm;
    }, [showConfirm]);

    useEffect(() => {
        getHasUnsavedChangesRef.current = getHasUnsavedChanges;
        getLeaveWarningTextRef.current = getLeaveWarningText;
    }, [getHasUnsavedChanges, getLeaveWarningText]);

    const leaveConfirmInFlightRef = useRef(false);
    useEffect(() => {
        // In-app navigation guard for anchor clicks and back/forward.
        // This catches Next.js client-side navigations that won't trigger beforeunload.
        const confirmLeave = async (): Promise<boolean> => {
            if (allowNextNavigationRef.current) return true;
            if (leaveConfirmInFlightRef.current) return false;
            leaveConfirmInFlightRef.current = true;
            try {
                const hasUnsaved = Boolean(getHasUnsavedChangesRef.current?.());
                return await showConfirmRef.current(
                    getLeaveWarningTextRef.current?.() || "Leave the App Builder?",
                    hasUnsaved ? "Unsaved changes" : "Leave App Builder",
                );
            } finally {
                leaveConfirmInFlightRef.current = false;
            }
        };

        // Add a same-URL history marker so the first Back press doesn't immediately
        // navigate away (it only changes history.state), giving us a chance to confirm.
        if (typeof window !== "undefined") {
            try {
                const st: any = history.state;
                if (!st || st.__klonerAppBuilderGuard !== true) {
                    history.pushState({ ...(st || {}), __klonerAppBuilderGuard: true }, "", window.location.href);
                    leaveGuardArmedRef.current = true;
                }
            } catch {
                // ignore
            }
        }

        // Some browsers (notably Safari) can fire an initial popstate on page load.
        // Ignore early popstate events so we don't show a leave-confirm as soon as the editor opens.
        let popstateReady = false;
        const armTimer = window.setTimeout(() => {
            popstateReady = true;
        }, 250);

        const onDocumentClickCapture = (e: MouseEvent) => {
            if (e.defaultPrevented) return;
            if (e.button !== 0) return; // left-click only
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (allowNextNavigationRef.current) return;

            const target = e.target as HTMLElement | null;
            const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
            if (!anchor) return;
            if (anchor.target && anchor.target !== "_self") return;
            const hrefAttr = (anchor.getAttribute("href") || "").trim();
            if (!hrefAttr || hrefAttr.startsWith("#")) return;

            // Prevent immediate navigation; we'll re-trigger if confirmed.
            e.preventDefault();
            e.stopPropagation();

            if (leaveConfirmInFlightRef.current) return;
            const href = anchor.href;
            void (async () => {
                const ok = await confirmLeave();
                if (!ok) return;

                allowNextNavigationRef.current = true;
                try {
                    window.location.assign(href);
                } finally {
                    // If navigation fails for some reason, re-arm after a tick.
                    setTimeout(() => {
                        allowNextNavigationRef.current = false;
                    }, 1000);
                }
            })();
        };

        const onPopState = () => {
            if (allowNextNavigationRef.current) return;
            if (!popstateReady) return;

            // If the marker isn't present (e.g. some browsers strip history.state), re-add it.
            try {
                const st: any = history.state;
                if (!st || st.__klonerAppBuilderGuard !== true) {
                    history.pushState({ ...(st || {}), __klonerAppBuilderGuard: true }, "", window.location.href);
                    leaveGuardArmedRef.current = true;
                    return;
                }
            } catch {
                // ignore
            }

            if (leaveConfirmInFlightRef.current) return;
            void (async () => {
                const ok = await confirmLeave();
                if (!ok) return;

                allowNextNavigationRef.current = true;
                try {
                    history.back();
                } finally {
                    setTimeout(() => {
                        allowNextNavigationRef.current = false;
                    }, 1000);
                }
            })();
        };

        document.addEventListener("click", onDocumentClickCapture, true);
        window.addEventListener("popstate", onPopState);
        return () => {
            clearTimeout(armTimer);
            document.removeEventListener("click", onDocumentClickCapture, true);
            window.removeEventListener("popstate", onPopState);
        };
    }, [appId]);

    const closeRequestInFlightRef = useRef(false);
    const requestClose = useCallback(async () => {
        if (closeRequestInFlightRef.current) return;
        closeRequestInFlightRef.current = true;
        try {
            const hasUnsaved = getHasUnsavedChanges();
            const ok = await showConfirm(
                hasUnsaved
                    ? "You have unsaved changes that may be lost. Close the editor anyway?"
                    : "Close the editor? Any unsaved changes will be lost.",
                hasUnsaved ? "Unsaved changes" : "Close editor",
            );
            if (!ok) return;
            onCloseRef.current?.();
        } finally {
            closeRequestInFlightRef.current = false;
        }
    }, [getHasUnsavedChanges, showConfirm]);
    const [deployChoiceError, setDeployChoiceError] = useState<string | null>(null);

    // Lock chat until the preview iframe has successfully loaded.
    // Any reload/restart/reconnect should re-lock until we see another successful iframe load.
    useEffect(() => {
        if (previewMode !== "webcontainer") {
            setIsWebPreviewReady(true);
            return;
        }
        setIsWebPreviewReady(false);
    }, [previewMode, refreshKey, localRestartKey, reconnectKey]);
    const [lastDeployLiveUrl, setLastDeployLiveUrl] = useState<string | null>(null);
    const [showDeploySuccess, setShowDeploySuccess] = useState(false);
    const deployUrlShortLabel = useMemo(() => formatDeployUrlShortLabel(lastDeployLiveUrl), [lastDeployLiveUrl]);
    const [leftPanelWidth, setLeftPanelWidth] = useState(500); // Default wider AI chat panel
    const [isResizing, setIsResizing] = useState(false);
    const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const restartDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const restartInFlightRef = useRef(false);
    const restartQueuedRef = useRef(false);
    const restartQueuedInteractiveRef = useRef(false);

    const didAutoRepairConfigRef = useRef(false);

    const applyDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const applyInFlightRef = useRef(false);
    const applyQueuedRef = useRef<Record<string, string>>({});
    const applyRunAfterRef = useRef(false);
    const lastApplyAlertAtRef = useRef(0);
    const applyRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
    const applyServerErrorRetryCountRef = useRef(0);
    const applyAutoRetryPausedUntilRef = useRef(0);
    const lastApplyFailureStatusRef = useRef<number | null>(null);

    // Firebase can emit multiple snapshots in quick succession. Reloading the preview iframe for
    // every snapshot causes heavy flicker and request thrash. Coalesce into at most ~1 reload/1.5s.
    const firebasePreviewReloadTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastFirebasePreviewReloadAtRef = useRef<number>(0);
    const currentFileRef = useRef<string | null>(null);
    const lastAppliedContentRef = useRef<Record<string, string>>({});

    useEffect(() => {
        currentFileRef.current = currentFile;
    }, [currentFile]);

    const queuePreviewReloadFromFirebase = useCallback(() => {
        const now = Date.now();
        const minIntervalMs = 1500;
        const debounceMs = 500;

        const sinceLast = now - (lastFirebasePreviewReloadAtRef.current || 0);
        const delay = Math.max(debounceMs, minIntervalMs - sinceLast);

        if (firebasePreviewReloadTimerRef.current) {
            clearTimeout(firebasePreviewReloadTimerRef.current);
            firebasePreviewReloadTimerRef.current = null;
        }

        firebasePreviewReloadTimerRef.current = setTimeout(() => {
            firebasePreviewReloadTimerRef.current = null;
            lastFirebasePreviewReloadAtRef.current = Date.now();
            setRefreshKey((k) => k + 1);
        }, delay);
    }, []);

    useEffect(() => {
        return () => {
            if (firebasePreviewReloadTimerRef.current) {
                clearTimeout(firebasePreviewReloadTimerRef.current);
                firebasePreviewReloadTimerRef.current = null;
            }
        };
    }, []);

    const { status: vercelStatus, checking: vercelChecking, refresh: refreshVercelStatus } =
        useVercelIntegration();

    const isVercelConnected = vercelStatus === "connected";
    const isVercelChecking = vercelStatus === "loading" || vercelChecking;

    const appRef = useRef<AppData | null>(null);
    useEffect(() => {
        appRef.current = app;
    }, [app]);

    const suppressNextFilesReplaceApplyRef = useRef(false);

    const autoPreviewRunIdRef = useRef(0);
    const didAutoPreviewStartRef = useRef(false);

    const previewSrc = useMemo(() => {
        const base = (app?.previewUrl || "").trim();
        if (!base) return "";
        const withBypass = addVercelProtectionBypass(base, app?.vercelProtectionBypassSecret || null);
        return addCacheBust(withBypass, refreshKey);
    }, [app?.previewUrl, app?.vercelProtectionBypassSecret, refreshKey]);

    function isLikelyNetworkError(err: unknown): boolean {
        if (!err || typeof err !== "object") return false;
        const message = String((err as any).message || "").toLowerCase();
        // Fetch throws TypeError on network/CORS issues.
        return (
            err instanceof TypeError ||
            message.includes("network") ||
            message.includes("failed to fetch") ||
            message.includes("load failed") ||
            message.includes("fetch")
        );
    }

    function sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    const fetchFreshCsrf = useCallback(async (): Promise<string | null> => {
        try {
            const res = await fetch("/api/auth/csrf", {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                cache: "no-store",
            });
            if (!res.ok) return null;
            const data = await res.json().catch(() => null);
            return (data as any)?.csrf || null;
        } catch {
            return null;
        }
    }, []);

    const restartLocalPreview = useCallback(async (forceFresh: boolean = false) => {
        if (isPreviewBuilding) return;
        setIsPreviewBuilding(true);
        try {
            setPreviewMode("webcontainer");
            if (forceFresh) {
                console.log('🔄 AppBuilderEditor: Incrementing forceFreshStartKey');
                forceFreshStartKey.current += 1;
                setForceFreshStart(true);
                // Reset the flag after a short delay to allow the component to re-render
                setTimeout(() => {
                    console.log('🔄 AppBuilderEditor: Resetting forceFreshStart to false');
                    setForceFreshStart(false);
                }, 100);
            } else {
                setLocalRestartKey((k) => k + 1);
            }
            setRefreshKey((k) => k + 1);
        } finally {
            setIsPreviewBuilding(false);
        }
    }, [isPreviewBuilding]);

    // Allow child panels (like AIAgentChat) to request a true "fresh machine" rebuild.
    useEffect(() => {
        if (typeof window === "undefined") return;

        const handler = (event: Event) => {
            try {
                const ce = event as CustomEvent<any>;
                const requestedAppId = String(ce?.detail?.appId || "").trim();
                if (!requestedAppId || requestedAppId !== appId) return;
                void restartLocalPreview(true);
            } catch {
                // ignore
            }
        };

        window.addEventListener("kloner:preview-force-fresh", handler as any);
        return () => {
            window.removeEventListener("kloner:preview-force-fresh", handler as any);
        };
    }, [appId, restartLocalPreview]);

    const consumeAiEditCredit = useCallback(
        async (creditRequestId: string) => {
            const rid = String(creditRequestId || "").trim();
            if (!rid) return;

            try {
                const csrf = await fetchFreshCsrf();
                const res = await fetch("/api/credits/ai-edits/consume", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify({ requestId: rid, cost: 5 }),
                });

                const data = await res.json().catch(() => ({} as any));
                if (!res.ok || !(data as any)?.ok) {
                    const msg = String((data as any)?.error || `Credit consume failed (HTTP ${res.status})`);
                    setAgentCreditError(msg);
                    return;
                }
            } catch (err: any) {
                setAgentCreditError(String(err?.message || "Failed to consume AI edit credit"));
            }
        },
        [fetchFreshCsrf]
    );


    const changeIsNotHotUpdatable = useCallback((path: string) => {
        const p = String(path || "").trim().toLowerCase();
        if (!p) return false;

        // Dependency / build config files typically cannot be hot-updated.
        return (
            p === "package.json" ||
            p.endsWith("/package.json") ||
            p === "package-lock.json" ||
            p.endsWith("/package-lock.json") ||
            p === "pnpm-lock.yaml" ||
            p.endsWith("/pnpm-lock.yaml") ||
            p === "yarn.lock" ||
            p.endsWith("/yarn.lock") ||
            p === "bun.lockb" ||
            p.endsWith("/bun.lockb") ||
            p === "next.config.js" ||
            p === "next.config.mjs" ||
            p.endsWith("/next.config.js") ||
            p.endsWith("/next.config.mjs") ||
            p === "tailwind.config.js" ||
            p === "tailwind.config.ts" ||
            p.endsWith("/tailwind.config.js") ||
            p.endsWith("/tailwind.config.ts") ||
            p === "postcss.config.js" ||
            p.endsWith("/postcss.config.js") ||
            p === "tsconfig.json" ||
            p.endsWith("/tsconfig.json")
        );
    }, []);

    const flushPreviewApply = useCallback(
        async ({ interactive }: { interactive: boolean }) => {
            if (!appId) return;
            if (applyInFlightRef.current) {
                applyRunAfterRef.current = true;
                return;
            }

            const now0 = Date.now();
            if (applyAutoRetryPausedUntilRef.current && now0 < applyAutoRetryPausedUntilRef.current) {
                // Keep changes queued, but don't hammer the backend.
                if (interactive && now0 - lastApplyAlertAtRef.current > 15000) {
                    lastApplyAlertAtRef.current = now0;
                    void showAlert(
                        "Live update is temporarily paused due to server errors. Your changes are saved. Try Refresh first, if it still fails, please contact support.",
                        "Live update",
                    );
                }
                return;
            }

            const queued = applyQueuedRef.current;
            const paths = Object.keys(queued);
            if (paths.length === 0) return;

            applyQueuedRef.current = {};
            applyInFlightRef.current = true;
            applyRunAfterRef.current = false;

            let scheduledRetry = false;
            try {
                // Prefer sending the locally stored container code when available.
                // If absent, the backend/hub can resolve the latest preview by appId.
                let storedCode = "";
                try {
                    const raw = localStorage.getItem(`webcontainer_${appId}`);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed?.code) storedCode = String(parsed.code).trim();
                    }
                } catch {
                    // ignore
                }

                const csrf = await fetchFreshCsrf();
                const payload: any = {
                    appId,
                    files: paths.map((p) => ({ path: p, content: queued[p] })),
                };
                if (storedCode) payload.code = storedCode;

                const res = await fetch("/api/previews/apply", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify(payload),
                });

                const data = await res.json().catch(() => ({} as any));

                if (!res.ok || !(data as any)?.ok) {
                    // Keep changes queued so we can retry safely.
                    for (const p of paths) {
                        if (queued[p] !== undefined) applyQueuedRef.current[p] = queued[p];
                    }

                    // Track consecutive failures by status.
                    const status = res.status;
                    if (lastApplyFailureStatusRef.current === status) {
                        applyServerErrorRetryCountRef.current += 1;
                    } else {
                        lastApplyFailureStatusRef.current = status;
                        applyServerErrorRetryCountRef.current = 1;
                    }

                    // 404: no active preview found. Start/reconnect non-destructively and let the user retry.
                    if (res.status === 404) {
                        const now = Date.now();
                        if (interactive || now - lastApplyAlertAtRef.current > 15000) {
                            lastApplyAlertAtRef.current = now;
                            void showAlert(
                                "No active preview was found for live apply. Start/reconnect the preview, then your change will retry automatically.",
                                "Live update",
                            );
                        }

                        // Non-destructive kick: WebContainerRunner should attach to existing machine when possible.
                        await restartLocalPreview(false);

                        if (!applyRetryTimerRef.current) {
                            applyRetryTimerRef.current = setTimeout(() => {
                                applyRetryTimerRef.current = null;
                                void flushPreviewApply({ interactive: false });
                            }, 1500);
                        }
                        scheduledRetry = true;
                        return;
                    }

                    // 409: usually means the preview is booting/busy or the provided code was stale.
                    // Never force-fresh here; just retry shortly.
                    if (res.status === 409) {
                        const now = Date.now();
                        if (interactive || now - lastApplyAlertAtRef.current > 15000) {
                            lastApplyAlertAtRef.current = now;
                            void showAlert(
                                "Preview is busy/booting (409). Not restarting anything — will retry live apply automatically.",
                                "Live update",
                            );
                        }

                        if (!applyRetryTimerRef.current) {
                            applyRetryTimerRef.current = setTimeout(() => {
                                applyRetryTimerRef.current = null;
                                void flushPreviewApply({ interactive: false });
                            }, 1000);
                        }
                        scheduledRetry = true;
                        return;
                    }

                    // 5xx: backend/hub transient error. Retry a couple times, then pause.
                    if (res.status >= 500 && res.status <= 599) {
                        const attempt = applyServerErrorRetryCountRef.current;
                        if (attempt <= 2) {
                            const delayMs = 1000 + attempt * 1000;
                            if (!applyRetryTimerRef.current) {
                                applyRetryTimerRef.current = setTimeout(() => {
                                    applyRetryTimerRef.current = null;
                                    void flushPreviewApply({ interactive: false });
                                }, delayMs);
                            }
                            scheduledRetry = true;
                            return;
                        }

                        // Pause auto-retry so we don't spam the server.
                        applyAutoRetryPausedUntilRef.current = Date.now() + 30_000;
                        const now = Date.now();
                        const shouldAlert = interactive || now - lastApplyAlertAtRef.current > 15000;
                        if (shouldAlert) {
                            lastApplyAlertAtRef.current = now;
                            const msg = String((data as any)?.error || `Live update failed (HTTP ${res.status})`);
                            void showAlert(`${msg}\n\nAuto-retry paused for 30 seconds.`, "Live update");
                        }
                        return;
                    }

                    const now = Date.now();
                    const shouldAlert = interactive || now - lastApplyAlertAtRef.current > 15000;
                    if (shouldAlert) {
                        lastApplyAlertAtRef.current = now;
                        const msg = String((data as any)?.error || `Live update failed (HTTP ${res.status})`);
                        void showAlert(msg, "Live update");
                    }
                    return;
                }

                // Success: reset failure/pause state.
                applyServerErrorRetryCountRef.current = 0;
                applyAutoRetryPausedUntilRef.current = 0;
                lastApplyFailureStatusRef.current = null;

                // Mark these contents as applied so we can safely dedupe future queues.
                for (const p of paths) {
                    if (queued[p] !== undefined) {
                        lastAppliedContentRef.current[p] = queued[p];
                    }
                }

                const nextCode = String((data as any)?.code || storedCode || "").trim();
                if (nextCode) {
                    try {
                        localStorage.setItem(
                            `webcontainer_${appId}`,
                            JSON.stringify({ code: nextCode, timestamp: Date.now() })
                        );
                    } catch {
                        // ignore
                    }
                }

                const requiresRestart = Boolean(
                    (data as any)?.requiresRestart || (data as any)?.requiresRebuild || (data as any)?.requires_rebuild,
                );

                // Notify the runner that an apply finished. The runner will do a delayed hard reload
                // only if HMR websocket is blocked/unknown (prevents "reload too early" issues).
                setApplyCompleteKey((k) => k + 1);

                if (requiresRestart) {
                    const now = Date.now();
                    if (interactive || now - lastApplyAlertAtRef.current > 15000) {
                        lastApplyAlertAtRef.current = now;
                        void showAlert(
                            "This change can’t be hot-updated. Your files are saved, but you may need to restart the preview to see it.",
                            "Restart needed",
                        );
                    }
                }
            } catch (err: any) {
                // Network / fetch failures: retry a couple times, then pause.
                if (lastApplyFailureStatusRef.current === -1) {
                    applyServerErrorRetryCountRef.current += 1;
                } else {
                    lastApplyFailureStatusRef.current = -1;
                    applyServerErrorRetryCountRef.current = 1;
                }

                const attempt = applyServerErrorRetryCountRef.current;
                if (attempt <= 2) {
                    const delayMs = 1000 + attempt * 1000;
                    if (!applyRetryTimerRef.current) {
                        applyRetryTimerRef.current = setTimeout(() => {
                            applyRetryTimerRef.current = null;
                            void flushPreviewApply({ interactive: false });
                        }, delayMs);
                    }
                    scheduledRetry = true;
                    return;
                }

                applyAutoRetryPausedUntilRef.current = Date.now() + 30_000;
                const now = Date.now();
                const shouldAlert = interactive || now - lastApplyAlertAtRef.current > 15000;
                if (shouldAlert) {
                    lastApplyAlertAtRef.current = now;
                    void showAlert(err?.message || "Live update failed.", "Live update");
                }
            } finally {
                applyInFlightRef.current = false;

                // If we already scheduled a retry (or we're paused), do not immediately re-flush.
                const now = Date.now();
                const paused = applyAutoRetryPausedUntilRef.current && now < applyAutoRetryPausedUntilRef.current;
                if (scheduledRetry || applyRetryTimerRef.current || paused) {
                    applyRunAfterRef.current = false;
                    return;
                }

                if (applyRunAfterRef.current || Object.keys(applyQueuedRef.current).length > 0) {
                    applyRunAfterRef.current = false;
                    void flushPreviewApply({ interactive: false });
                }
            }
        },
        [appId, fetchFreshCsrf, restartLocalPreview, showAlert]
    );

    const getStoredPreviewCode = useCallback((): string => {
        if (!appId) return "";
        try {
            const raw = localStorage.getItem(`webcontainer_${appId}`);
            if (!raw) return "";
            const parsed = JSON.parse(raw);
            const code = typeof parsed?.code === "string" ? parsed.code.trim() : "";
            return code;
        } catch {
            return "";
        }
    }, [appId]);

    const applyDiffToWebcontainerAndMaybeRestart = useCallback(
        async (prevFiles: AppData["files"], nextFiles: AppData["files"], { interactive }: { interactive: boolean }) => {
            if (!appId) return;

            const prev = prevFiles || ({} as any);
            const next = nextFiles || ({} as any);

            const allPaths = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);

            const entries: Array<{ path: string; content?: string; delete?: boolean }> = [];
            for (const p of allPaths) {
                const prevContent = (prev as any)?.[p]?.content;
                const nextContent = (next as any)?.[p]?.content;

                if (typeof prevContent === "string" && typeof nextContent !== "string") {
                    entries.push({ path: p, delete: true });
                    continue;
                }

                if (typeof nextContent === "string" && typeof prevContent !== "string") {
                    entries.push({ path: p, content: String(nextContent) });
                    continue;
                }

                if (typeof prevContent === "string" && typeof nextContent === "string" && prevContent !== nextContent) {
                    entries.push({ path: p, content: String(nextContent) });
                }
            }

            if (entries.length === 0) return;

            const csrf = await fetchFreshCsrf();
            let activeCode = getStoredPreviewCode();
            let overallNeedsRebuild = false;

            const batchSize = 20;
            for (let i = 0; i < entries.length; i += batchSize) {
                const batch = entries.slice(i, i + batchSize);
                const payload: any = {
                    appId,
                    files: batch.map((e) =>
                        e.delete
                            ? { path: e.path, delete: true }
                            : { path: e.path, content: typeof e.content === "string" ? e.content : "" },
                    ),
                };
                if (activeCode) payload.code = activeCode;

                const res = await fetch("/api/previews/apply", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify(payload),
                });

                const data = await res.json().catch(() => ({} as any));
                if (!res.ok || !(data as any)?.ok) {
                    if (res.status === 404) {
                        if (interactive) {
                            void showAlert(
                                "No active preview is running to apply these changes. Start/reconnect the preview and try again.",
                                "Restore",
                            );
                        }
                        await restartLocalPreview(false);
                        return;
                    }

                    if (res.status === 409) {
                        if (interactive) {
                            void showAlert(
                                "Preview is busy/booting (409). Try restoring again in a moment.",
                                "Restore",
                            );
                        }
                        return;
                    }

                    const msg = String((data as any)?.error || `Restore apply failed (HTTP ${res.status})`);
                    if (interactive) void showAlert(msg, "Restore");
                    return;
                }

                const nextCode = String((data as any)?.code || "").trim();
                if (nextCode) {
                    activeCode = nextCode;
                    try {
                        localStorage.setItem(
                            `webcontainer_${appId}`,
                            JSON.stringify({ code: nextCode, timestamp: Date.now() }),
                        );
                    } catch {
                        // ignore
                    }
                }

                // Update dedupe state for applied files.
                for (const e of batch) {
                    const p = String((e as any)?.path || "").trim();
                    if (!p) continue;
                    if ((e as any)?.delete) {
                        delete lastAppliedContentRef.current[p];
                    } else if (typeof (e as any)?.content === "string") {
                        lastAppliedContentRef.current[p] = String((e as any).content);
                    }
                }

                const needsRebuild = Boolean(
                    (data as any)?.needsRebuild ||
                        (data as any)?.needs_rebuild ||
                        (data as any)?.requiresRebuild ||
                        (data as any)?.requires_rebuild ||
                        (data as any)?.requiresRestart ||
                        (data as any)?.requires_restart,
                );
                overallNeedsRebuild = overallNeedsRebuild || needsRebuild;
            }

            if (overallNeedsRebuild && activeCode) {
                const rres = await fetch("/api/previews/restart", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify({ appId, code: activeCode }),
                });
                const rdata = await rres.json().catch(() => ({} as any));
                if (!rres.ok || !(rdata as any)?.ok) {
                    const msg = String((rdata as any)?.error || `Restart failed (HTTP ${rres.status})`);
                    if (interactive) void showAlert(msg, "Restart needed");
                }
            }
        },
        [appId, fetchFreshCsrf, getStoredPreviewCode, restartLocalPreview, showAlert]
    );

    const queuePreviewApply = useCallback(
        (changes: Array<{ path: string; content: string }>, { interactive }: { interactive: boolean }) => {
            if (!appId) return;
            if (!changes?.length) return;

            for (const c of changes) {
                const p = String(c?.path || "").trim();
                if (!p) continue;
                if (changeIsNotHotUpdatable(p)) {
                    const now = Date.now();
                    if (interactive || now - lastApplyAlertAtRef.current > 15000) {
                        lastApplyAlertAtRef.current = now;
                        void showAlert(
                            "That file affects dependencies/build settings, so it can’t be hot-updated. Your change is saved. Try Refresh first, if it still fails, please contact support.",
                            "Restart needed",
                        );
                    }
                    continue;
                }

                const nextContent = String(c?.content ?? "");
                // Dedupe: avoid re-applying identical content repeatedly (e.g. Firebase snapshot echoes).
                if (applyQueuedRef.current[p] === nextContent) continue;
                if (lastAppliedContentRef.current[p] === nextContent) continue;

                applyQueuedRef.current[p] = nextContent;
            }

            if (applyDebounceRef.current) {
                clearTimeout(applyDebounceRef.current);
                applyDebounceRef.current = null;
            }

            // Small debounce to coalesce rapid edits (especially from AI).
            applyDebounceRef.current = setTimeout(() => {
                applyDebounceRef.current = null;
                void flushPreviewApply({ interactive });
            }, 250);
        },
        [appId, changeIsNotHotUpdatable, flushPreviewApply, showAlert]
    );

    useEffect(() => {
        // Keep the draft in sync when app data loads.
        const next = (app?.vercelProtectionBypassSecret || "").toString();
        setVercelProtectionBypassDraft(next);
    }, [app?.vercelProtectionBypassSecret]);

    const saveVercelProtectionBypass = useCallback(async () => {
        if (!appId) return;
        if (savingVercelProtectionBypass) return;

        setSavingVercelProtectionBypass(true);
        try {
            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/settings`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                body: JSON.stringify({
                    vercelProtectionBypassSecret: vercelProtectionBypassDraft.trim() || null,
                }),
            });

            const data = await res.json().catch(() => ({} as any));
            if (!res.ok || !data?.ok) {
                throw new Error((data as any)?.error || `Failed to save (HTTP ${res.status})`);
            }

            const saved = (data?.vercelProtectionBypassSecret || "").toString();
            setApp((prev) => (prev ? { ...prev, vercelProtectionBypassSecret: saved || null } : prev));

            // Immediately retry embedding if we have a URL.
            const url = (protectedPreviewUrl || "").trim();
            if (url) {
                setPreviewError(null);
                setApp((prev) => (prev ? { ...prev, previewUrl: url } : prev));
                setRefreshKey((k) => k + 1);
            }
        } catch (err: any) {
            console.error("Failed to save Vercel protection bypass", err);
            setPreviewError(err?.message || "Failed to save protection bypass secret.");
        } finally {
            setSavingVercelProtectionBypass(false);
        }
    }, [appId, savingVercelProtectionBypass, vercelProtectionBypassDraft, protectedPreviewUrl]);

    const enableVercelProtectionBypassAutomatically = useCallback(async (): Promise<string> => {
        if (!appId) throw new Error("Missing appId");
        if (enablingVercelProtectionBypass) throw new Error("Bypass is already being enabled");

        setEnablingVercelProtectionBypass(true);
        try {
            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/vercel/protection-bypass`, {
                method: "POST",
                headers: csrfHeaders(csrf),
                credentials: "include",
            });

            const data = await res.json().catch(() => ({} as any));
            if (!res.ok || !data?.ok) {
                const code = (data as any)?.code;
                const message = (data as any)?.error || `Failed to enable bypass (HTTP ${res.status})`;
                if (code === "vercel_bypass_not_supported") {
                    setAutoPreviewBypassUnsupported(true);
                }
                const err = new Error(message) as CodedError;
                err.code = code;
                throw err;
            }

            const secret = (data?.vercelProtectionBypassSecret || "").toString().trim();
            if (!secret) {
                throw new Error("Bypass enabled but no secret was returned.");
            }

            setVercelProtectionBypassDraft(secret);
            setApp((prev) => (prev ? { ...prev, vercelProtectionBypassSecret: secret } : prev));
            return secret;
        } finally {
            setEnablingVercelProtectionBypass(false);
        }
    }, [appId, enablingVercelProtectionBypass]);

    const runAutoPreviewSequence = useCallback(
        async (opts?: { force?: boolean }) => {
            if (!appId) return;

            const runId = ++autoPreviewRunIdRef.current;
            const maxAttempts = 4;

            setAutoPreviewError(null);
            setAutoPreviewAttempt(0);
            setAutoPreviewBypassUnsupported(false);
            setPreviewMode("webcontainer");

            // If a preview URL exists already and we're not forcing a fresh start, just try to load it.
            if (!opts?.force) {
                const existing = (appRef.current?.previewUrl || "").trim();
                if (existing) {
                    setAutoPreviewPhase("loading");
                    setRefreshKey((k) => k + 1);
                    setAutoPreviewPhase("ready");
                    return;
                }
            }

            setAutoPreviewPhase("checking");

            // NOTE: embedded preview now always uses the local runner. Vercel preview deploys are handled via Deploy.
            setAutoPreviewPhase("ready");
            return;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                if (autoPreviewRunIdRef.current !== runId) return;
                setAutoPreviewAttempt(attempt);
                setAutoPreviewPhase("building");
                setPreviewError(null);
                setProtectedPreviewUrl(null);
                setVercelSecuritySettingsUrl(null);
                setVercelDeploymentProtectionSettingsUrl(null);

                try {
                    const csrf = await ensureSessionAndCsrf().catch(() => null);
                    const res = await fetch(`/api/app-builder/${appId}/preview`, {
                        method: "POST",
                        headers: csrfHeaders(csrf),
                        credentials: "include",
                    });

                    const data = await res.json().catch(() => ({} as any));

                    if (!res.ok || !data?.ok) {
                        const code = (data as any)?.code;

                        if (code === "vercel_not_connected") {
                            setAutoPreviewPhase("connecting");
                            setVercelConnectOpen(true);
                            return;
                        }

                        if (code === "vercel_deployment_protected") {
                            const url = (data?.url || data?.previewUrl || data?.deploymentUrl || "").toString();
                            if (url) setProtectedPreviewUrl(url);

                            const deploymentProtectionUrl = (data?.vercelDeploymentProtectionSettingsUrl || "").toString();
                            if (deploymentProtectionUrl) setVercelDeploymentProtectionSettingsUrl(deploymentProtectionUrl);
                            const securityUrl = (data?.vercelSecuritySettingsUrl || "").toString();
                            if (securityUrl) setVercelSecuritySettingsUrl(securityUrl);

                            // Seamless path: if we don't have a bypass secret yet, create/store one and retry embedding.
                            const existingSecret = (appRef.current?.vercelProtectionBypassSecret || "").toString().trim();
                            if (!existingSecret) {
                                setAutoPreviewPhase("enabling-bypass");
                                try {
                                    await enableVercelProtectionBypassAutomatically();
                                } catch (e: any) {
                                    const coded = e as CodedError;
                                    if (coded?.code === "vercel_bypass_not_supported") {
                                        setAutoPreviewError(
                                            "Vercel is blocking iframe embedding for this protected preview. Showing an embedded local preview instead.",
                                        );
                                        setPreviewMode("webcontainer");
                                        setAutoPreviewPhase("error");
                                        return;
                                    }
                                    throw e;
                                }
                            }

                            // Try embedding immediately using the returned deployment URL.
                            if (url) {
                                setAutoPreviewPhase("loading");
                                setPreviewError(null);
                                setApp((prev) => (prev ? { ...prev, previewUrl: url } : prev));
                                setRefreshKey((k) => k + 1);
                                setAutoPreviewPhase("ready");
                                return;
                            }

                            throw new Error((data as any)?.error || "Preview deployment is protected.");
                        }

                        throw new Error((data as any)?.error || `Preview failed (HTTP ${res.status})`);
                    }

                    const nextPreviewUrl = (data?.previewUrl || data?.url || "").toString();
                    if (!nextPreviewUrl) {
                        throw new Error("Preview succeeded but no URL was returned.");
                    }

                    setAutoPreviewPhase("loading");
                    setApp((prev) => (prev ? { ...prev, previewUrl: nextPreviewUrl } : prev));
                    setRefreshKey((k) => k + 1);
                    setAutoPreviewPhase("ready");
                    return;
                } catch (err: any) {
                    if (autoPreviewRunIdRef.current !== runId) return;

                    const msg = err?.message || "Failed to build preview.";
                    setAutoPreviewError(msg);
                    setAutoPreviewPhase("error");

                    // Retry automatically on likely transient network failures.
                    if (isLikelyNetworkError(err) && attempt < maxAttempts) {
                        const backoff = 800 * Math.min(6, attempt);
                        await sleep(backoff);
                        continue;
                    }
                    return;
                }
            }
        },
        [appId, enableVercelProtectionBypassAutomatically],
    );

    // Load app data
    useEffect(() => {
        if (authLoading) return;

        let didCancel = false;
        const controller = new AbortController();

        const loadApp = async () => {
            try {
                if (!user?.uid) {
                    throw new Error("Failed to load app: 401 Unauthorized");
                }

                const fetchFiles = async (forceRefreshToken: boolean) => {
                    await bootstrapServerSession({
                        forceRefresh: forceRefreshToken,
                        minIntervalMs: forceRefreshToken ? 0 : 10 * 60 * 1000,
                        timeoutMs: 12_000,
                        reason: "app_builder_load",
                    }).catch(() => false);

                    const idToken = await user.getIdToken(forceRefreshToken);

                    return fetch(`/api/app-builder/${appId}/files`, {
                        method: "GET",
                        credentials: "include",
                        cache: "no-store",
                        signal: controller.signal,
                        headers: {
                            authorization: `Bearer ${idToken}`,
                        },
                    });
                };

                let res = await fetchFiles(false);
                if (res.status === 401) {
                    res = await fetchFiles(true);
                }

                if (!res.ok) {
                    if (res.status === 404) {
                        console.error("App not found, closing editor");
                        onCloseRef.current?.();
                        return;
                    }
                    throw new Error(`Failed to load app: ${res.status} ${res.statusText}`);
                }
                const data = await res.json();
                if (didCancel) return;
                setApp(data);
                const liveUrl = typeof data?.productionUrl === "string" ? data.productionUrl.trim() : "";
                setLastDeployLiveUrl(liveUrl || null);
                buildFileTree(data.files);
            } catch (err: any) {
                if (didCancel) return;
                if (err?.name === "AbortError") return;
                console.error("Error loading app:", err);
                // For network errors or server errors, don't close immediately.
                // Show error state instead.
                setError(err instanceof Error ? err.message : "Failed to load app");
            } finally {
                if (!didCancel) setLoading(false);
            }
        };

        loadApp();
        return () => {
            didCancel = true;
            controller.abort();
        };
    }, [appId, authLoading, user]);

    // Derive current favicon URL from head.tsx if we created/updated one.
    useEffect(() => {
        const files = app?.files;
        const appDir = detectNextAppDir(files);
        if (!files || !appDir) {
            setFaviconUrl(null);
            return;
        }

        const headPath = `${appDir}/head.tsx`;
        const head = (files as any)?.[headPath]?.content;
        if (typeof head !== "string") {
            setFaviconUrl(null);
            return;
        }

        const m = head.match(/rel=["']icon["'][^>]*href=["']([^"']+)["']/i) ||
            head.match(/href=["']([^"']+)["'][^>]*rel=["']icon["']/i);
        const next = m && m[1] ? String(m[1]).trim() : "";
        setFaviconUrl(next || null);
    }, [app?.files]);

    const handlePickFavicon = useCallback(() => {
        if (faviconUploading) return;
        faviconInputRef.current?.click();
    }, [faviconUploading]);

    const uploadFaviconToUserBlob = useCallback(async (file: globalThis.File): Promise<{ url: string; path?: string }> => {
        const csrf = await ensureSessionAndCsrf().catch(() => null);
        const url = `/api/user-blob/upload-url?filename=${encodeURIComponent("favicon.ico")}&renderId=${encodeURIComponent(appId)}`;

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "content-type": file.type || "application/octet-stream",
                ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
            },
            credentials: "include",
            body: file,
        });

        const j = await res.json().catch(() => ({} as any));
        if (!res.ok || !j?.url) {
            throw new Error(j?.error || `upload_failed_${res.status}`);
        }
        return { url: String(j.url), path: typeof j.path === "string" ? j.path : undefined };
    }, [appId]);

    // Firebase real-time listener for instant UI updates when files change
    useEffect(() => {
        if (!appId || !user?.uid) return;

        const unsubscribe = onSnapshot(
            doc(db, 'kloner_users', user.uid, 'kloner_apps', appId),
            (docSnapshot) => {
                if (docSnapshot.exists()) {
                    const firebaseData = docSnapshot.data();
                    if (firebaseData) {
                        // Update local state immediately when Firebase changes.
                        // Important: generationStatus may update BEFORE files are written.
                        setApp((prevApp) => {
                            if (!prevApp) return prevApp;

                            const nextGenStatus = (firebaseData as any).generationStatus;
                            const nextGenError = (firebaseData as any).generationError;
                            const nextGenProgress =
                                typeof (firebaseData as any).generationProgress === "number"
                                    ? (firebaseData as any).generationProgress
                                    : typeof (firebaseData as any).progress === "number"
                                      ? (firebaseData as any).progress
                                      : null;

                            const generationStatusChanged =
                                prevApp.generationStatus !== nextGenStatus ||
                                prevApp.generationError !== nextGenError ||
                                prevApp.generationProgress !== nextGenProgress;

                            const hasFilesUpdate = Boolean((firebaseData as any).files);
                            const mergedFiles = hasFilesUpdate
                                ? mergeFilesPreferNewest(prevApp.files, (firebaseData as any).files)
                                : prevApp.files;
                            const filesChanged = hasFilesUpdate
                                ? !filesShallowEqualByContentAndTimestamp(prevApp.files, mergedFiles)
                                : false;

                            if (!filesChanged && !generationStatusChanged) return prevApp;

                            const updatedApp: any = {
                                ...prevApp,
                                files: mergedFiles,
                                generationStatus: nextGenStatus,
                                generationError: nextGenError,
                                generationProgress: nextGenProgress,
                                isDeployed: Boolean((firebaseData as any).isDeployed),
                                productionUrl: (firebaseData as any).productionUrl || null,
                                updatedAt: (firebaseData as any).updatedAt,
                            };

                            const nextLiveUrl = typeof (firebaseData as any).productionUrl === "string"
                                ? (firebaseData as any).productionUrl.trim()
                                : "";
                            setLastDeployLiveUrl(nextLiveUrl || null);

                            if (filesChanged) {
                                buildFileTree(mergedFiles);

                                const openPath = currentFileRef.current;
                                if (openPath && (mergedFiles as any)[openPath]) {
                                    setCode((mergedFiles as any)[openPath].content);
                                }

                                if (previewMode !== "webcontainer") {
                                    queuePreviewReloadFromFirebase();
                                    try {
                                        const changes: Array<{ path: string; content: string }> = [];
                                        const prevFiles = prevApp.files || ({} as any);
                                        const nextFiles = mergedFiles || ({} as any);
                                        for (const p of Object.keys(nextFiles)) {
                                            const nextContent = (nextFiles as any)?.[p]?.content;
                                            if (typeof nextContent !== "string") continue;
                                            const prevContent = (prevFiles as any)?.[p]?.content;
                                            if (typeof prevContent === "string" && prevContent === nextContent) continue;
                                            changes.push({ path: p, content: nextContent });
                                        }
                                        if (changes.length) {
                                            queuePreviewApply(changes, { interactive: false });
                                        }
                                    } catch {
                                        // ignore
                                    }
                                }
                            }

                            return updatedApp;
                        });
                    }
                }
            },
            (error) => {
                console.error('Firebase listener error:', error);
            }
        );

        return () => {
            try {
                unsubscribe();
            } catch (err) {
                // Firestore can throw internal assertion errors in rare edge cases
                // (e.g. rapid subscribe/unsubscribe or React strict-mode double-invoke).
                console.warn("Firebase listener unsubscribe error:", err);
            }
        };
    }, [appId, previewMode, user?.uid, queuePreviewApply, queuePreviewReloadFromFirebase]);

    // Load panel width from localStorage on mount
    useEffect(() => {
        const savedWidth = localStorage.getItem('app-builder-left-panel-width');
        if (savedWidth) {
            const width = parseInt(savedWidth, 10);
            if (width >= 300 && width <= 800) { // Reasonable bounds
                setLeftPanelWidth(width);
            }
        }
    }, []);

    // Save panel width to localStorage when it changes
    useEffect(() => {
        localStorage.setItem('app-builder-left-panel-width', leftPanelWidth.toString());
    }, [leftPanelWidth]);

    // Handle resize mouse events
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            
            const container = document.querySelector('[data-app-builder-container]');
            if (!container) return;
            
            const containerRect = container.getBoundingClientRect();
            const newWidth = e.clientX - containerRect.left;
            
            // Constrain width between 300px and 800px
            const constrainedWidth = Math.max(300, Math.min(800, newWidth));
            setLeftPanelWidth(constrainedWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing]);

    const buildFileTree = (files: AppData["files"]) => {
        const tree: FileNode[] = [];
        const paths = Object.keys(files);

        paths.forEach((path) => {
            const parts = path.split("/");
            let current = tree;

            parts.forEach((part, index) => {
                let node = current.find((n) => n.name === part);
                if (!node) {
                    node = {
                        name: part,
                        type: index === parts.length - 1 ? "file" : "folder",
                        children: index === parts.length - 1 ? undefined : [],
                    };
                    current.push(node);
                }
                if (node.children) current = node.children;
            });
        });

        setFileTree(tree);
    };

    const handleFileSelect = (path: string) => {
        if (app?.files[path]) {
            setCurrentFile(path);
            setCode(app.files[path].content);
        }
    };

    const handleCodeChange = (value: string | undefined) => {
        const newCode = value || "";
        setCode(newCode);

        // Auto-save after a delay
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }
        autoSaveTimeoutRef.current = setTimeout(() => {
            handleSave(false);
        }, 1000);
    };

    const handleFilesReplaceFromServer = useCallback(
        (nextFiles: { [path: string]: { content: string; lastModified: number } }) => {
            if (suppressNextFilesReplaceApplyRef.current) {
                suppressNextFilesReplaceApplyRef.current = false;
                setApp((prev) => (prev ? { ...prev, files: nextFiles } : null));
                buildFileTree(nextFiles as any);
                if (currentFile) {
                    const next = nextFiles[currentFile]?.content;
                    if (typeof next === "string") setCode(next);
                    else setCode("");
                }
                return;
            }

            // Live-apply the diff so the running preview reflects server-driven file updates
            // (restore points, server sync) without requiring a manual Save.
            try {
                const prevFiles = appRef.current?.files || ({} as any);
                const changes: Array<{ path: string; content: string }> = [];
                for (const p of Object.keys(nextFiles || {})) {
                    const nextContent = (nextFiles as any)?.[p]?.content;
                    if (typeof nextContent !== "string") continue;
                    const prevContent = (prevFiles as any)?.[p]?.content;
                    if (typeof prevContent === "string" && prevContent === nextContent) continue;
                    changes.push({ path: p, content: nextContent });
                }
                if (changes.length) {
                    queuePreviewApply(changes, { interactive: false });
                }
            } catch {
                // ignore
            }

            setApp((prev) => (prev ? { ...prev, files: nextFiles } : null));

            // Keep file tree in sync (e.g. newly created files).
            buildFileTree(nextFiles as any);

            if (currentFile) {
                const next = nextFiles[currentFile]?.content;
                if (typeof next === "string") setCode(next);
                else setCode("");
            }
        },
        [currentFile, queuePreviewApply]
    );

    // If we used a placeholder preview while generating, rebuild the machine with the real files
    // once generation completes. Important: generationStatus can flip to "ready" before files are
    // fully written, so we re-hydrate from the server first.
    const lastGenStatusRef = useRef<string | undefined>(undefined);
    const generationBaselineFilesRef = useRef<AppData["files"] | null>(null);
    const generationRehydrateInFlightRef = useRef(false);
    useEffect(() => {
        const status = app?.generationStatus;
        const prev = lastGenStatusRef.current;
        lastGenStatusRef.current = status;

        if (status === "processing" && prev !== "processing") {
            generationBaselineFilesRef.current = (app?.files as any) || null;
        }

        if (prev === "processing" && status === "ready" && usedPlaceholderRef.current) {
            if (generationRehydrateInFlightRef.current) return;
            usedPlaceholderRef.current = false;
            generationRehydrateInFlightRef.current = true;

            void (async () => {
                try {
                    if (!appId) return;

                    // Mirror AIAgentChat's flow: refresh session before syncing files.
                    await ensureSessionAndCsrf().catch(() => null);

                    const baseline = generationBaselineFilesRef.current || (app?.files as any) || ({} as any);
                    let lastFetchedFiles: any = null;
                    const start = Date.now();
                    const maxWaitMs = 20000;
                    const intervalMs = 1000;

                    while (Date.now() - start < maxWaitMs) {
                        try {
                            const res = await fetch(`/api/app-builder/${appId}/files`, {
                                method: "GET",
                                credentials: "include",
                                cache: "no-store",
                            });
                            if (res.ok) {
                                const data = await res.json().catch(() => null);
                                const nextFiles = (data as any)?.files;
                                if (nextFiles && typeof nextFiles === "object") {
                                    lastFetchedFiles = nextFiles;
                                    const differsFromBaseline =
                                        !filesShallowEqualByContentAndTimestamp(baseline as any, nextFiles as any);
                                    const differsFromCurrent =
                                        !filesShallowEqualByContentAndTimestamp((app?.files as any) || ({} as any), nextFiles as any);

                                    if (differsFromBaseline || differsFromCurrent) {
                                        suppressNextFilesReplaceApplyRef.current = true;
                                        handleFilesReplaceFromServer(nextFiles);
                                        break;
                                    }
                                }
                            }
                        } catch {
                            // ignore and retry
                        }

                        await new Promise((resolve) => setTimeout(resolve, intervalMs));
                    }

                    if (lastFetchedFiles) {
                        // Even if the server responded with the same files, use the server copy as the
                        // canonical source of truth before we start a fresh machine.
                        suppressNextFilesReplaceApplyRef.current = true;
                        handleFilesReplaceFromServer(lastFetchedFiles);
                    }
                } finally {
                    generationBaselineFilesRef.current = null;
                    generationRehydrateInFlightRef.current = false;

                    // Use the same canonical “force fresh” pathway as the AI agent.
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(
                            new CustomEvent("kloner:preview-force-fresh", {
                                detail: { appId, reason: "generation-ready" },
                            }),
                        );
                    } else {
                        await restartLocalPreview(true);
                    }
                }
            })();
        }
    }, [app?.files, app?.generationStatus, appId, handleFilesReplaceFromServer, restartLocalPreview]);

    const handleRestoreApplied = useCallback(
        async ({ previousFiles, restoredFiles }: { previousFiles: AppData["files"]; restoredFiles: AppData["files"] }) => {
            suppressNextFilesReplaceApplyRef.current = true;
            await applyDiffToWebcontainerAndMaybeRestart(previousFiles, restoredFiles, { interactive: true });
        },
        [applyDiffToWebcontainerAndMaybeRestart]
    );

    function canonicalizeEditPath(
        rawPath: string,
        files: AppData["files"] | null | undefined,
    ): string {
        const trimmed = String(rawPath || "").trim();
        if (!trimmed) return "";

        // Normalize leading slashes to avoid creating duplicate keys.
        let p = trimmed.replace(/^\/+/, "");

        const hasFiles = !!files && typeof files === "object";
        if (hasFiles && (files as any)[p]) return p;

        const keys = hasFiles ? Object.keys(files as any) : [];
        const hasAnyPrefix = (prefix: string) => keys.some((k) => String(k).startsWith(prefix));

        // Prefer src/* roots if present (Next.js convention).
        if (p.startsWith("app/") && hasAnyPrefix("src/app/")) {
            const mapped = `src/${p}`;
            if ((files as any)?.[mapped]) return mapped;
            p = mapped;
        } else if (p.startsWith("src/app/") && hasAnyPrefix("app/")) {
            const mapped = p.replace(/^src\//, "");
            if ((files as any)?.[mapped]) return mapped;
        }

        if (p.startsWith("pages/") && hasAnyPrefix("src/pages/")) {
            const mapped = `src/${p}`;
            if ((files as any)?.[mapped]) return mapped;
            p = mapped;
        } else if (p.startsWith("src/pages/") && hasAnyPrefix("pages/")) {
            const mapped = p.replace(/^src\//, "");
            if ((files as any)?.[mapped]) return mapped;
        }

        // If the agent targets a common entrypoint but uses the "wrong" extension,
        // prefer whichever sibling file already exists.
        const candidatesForSameBase = (base: string) => [
            `${base}.tsx`,
            `${base}.ts`,
            `${base}.jsx`,
            `${base}.js`,
            base,
        ];

        const extMatch = p.match(/^(.*)\.(tsx|ts|jsx|js)$/i);
        if (extMatch && hasFiles) {
            const base = extMatch[1];
            for (const c of candidatesForSameBase(base)) {
                if ((files as any)[c]) return c;
            }
        }

        // Router-specific entrypoint mapping:
        // - If the agent edits pages/index.* but we only have app/page.* (or vice versa),
        //   map to the existing router's entrypoint to ensure the preview reflects changes.
        if (hasFiles) {
            const pagesIndex = p.match(/^(src\/)?pages\/index\.(tsx|ts|jsx|js)$/i);
            const appPage = p.match(/^(src\/)?app\/page\.(tsx|ts|jsx|js)$/i);

            if (pagesIndex) {
                // Prefer src/app/page.* if present, then app/page.*
                for (const c of candidatesForSameBase("src/app/page")) {
                    if ((files as any)[c]) return c;
                }
                for (const c of candidatesForSameBase("app/page")) {
                    if ((files as any)[c]) return c;
                }
            }

            if (appPage) {
                for (const c of candidatesForSameBase("src/pages/index")) {
                    if ((files as any)[c]) return c;
                }
                for (const c of candidatesForSameBase("pages/index")) {
                    if ((files as any)[c]) return c;
                }
            }
        }

        return p;
    }

    const saveFileToServer = useCallback(async (
        path: string,
        content: string,
        opts?: { afterSave?: "apply" | "none"; interactive?: boolean }
    ): Promise<boolean> => {
        try {
            // Always fetch a fresh CSRF token so the header matches the cookie.
            // (Relying on an existing cookie can drift and cause 403s.)
            let csrf: string | null = null;
            try {
                const res = await fetch("/api/auth/csrf", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    credentials: "include",
                    cache: "no-store",
                });
                if (res.ok) {
                    const data = await res.json().catch(() => null);
                    csrf = data?.csrf || null;
                }
            } catch {
                csrf = null;
            }
            const res = await fetch(`/api/app-builder/${appId}/update-file`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                cache: "no-store",
                body: JSON.stringify({ path, content }),
            });
            if (!res.ok) throw new Error("Failed to save");

            const afterSave = opts?.afterSave || "apply";
            if (afterSave === "apply") {
                queuePreviewApply([{ path, content }], { interactive: false });
            }
            return true;
        } catch (err) {
            console.error("Auto-save failed", err);
            if (opts?.interactive) {
                void showAlert("Could not save your change. Please try again.", "Save failed");
            }
            return false;
        }
    }, [appId, queuePreviewApply, showAlert]);

    const applyStagedImage = useCallback(async (id: string) => {
        const item = stagedImages.find((entry) => entry.id === id);
        if (!item) return;

        const allFiles = appRef.current?.files || ({} as AppData["files"]);
        const plan = resolveImagePlacementPlan(allFiles, item.placementPrompt, currentFile);
        if (!plan) {
            void showAlert("I couldn’t find a place for that prompt. Try something like “homepage top” or “/about bottom”.", "Images");
            return;
        }

        const confirm = await showConfirm(
            <div className="space-y-3">
                <Image
                    src={item.previewUrl}
                    alt={item.alt || "Image preview"}
                    width={1200}
                    height={1200}
                    className="h-auto max-h-56 w-full rounded-lg border border-neutral-200 object-contain"
                    unoptimized
                />
                <div className="text-sm text-neutral-700">
                    Place image at {plan.label}?
                </div>
                <div className="text-sm text-neutral-700">
                    Prompt: {item.placementPrompt || "(none)"}
                </div>
            </div>,
            "Images",
        );
        if (!confirm) return;

        updateStagedImage(id, { status: "uploading", error: null });

        try {
            let finalUrl = item.uploadedUrl;
            let finalPath = item.uploadedPath;
            if (!finalUrl) {
                const uploaded = await uploadImageToUserBlob(item.preparedFile);
                finalUrl = uploaded.url;
                finalPath = uploaded.path;
            }

            const targetContent = appRef.current?.files?.[plan.targetPath]?.content || "";
            const snippet = buildImageSnippet(finalUrl, item.alt || "");
            const nextContent = insertSnippetIntoContent(targetContent, snippet, plan.position);

            setApp((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    files: {
                        ...prev.files,
                        [plan.targetPath]: {
                            content: nextContent,
                            lastModified: Date.now(),
                        },
                    },
                };
            });

            if (currentFile === plan.targetPath) {
                setCode(nextContent);
            }

            const ok = await saveFileToServer(plan.targetPath, nextContent, { afterSave: "apply", interactive: true });
            if (!ok) {
                throw new Error("save_failed");
            }

            setLastImageInsert({
                stagedImageId: item.id,
                targetPath: plan.targetPath,
                previousContent: targetContent,
                uploadedPath: finalPath || null,
            });

            updateStagedImage(id, {
                status: "applied",
                uploadedUrl: finalUrl,
                uploadedPath: finalPath || null,
                error: null,
            });
            void showAlert("Image applied to your project.", "Images");
        } catch (err: any) {
            updateStagedImage(id, {
                status: "failed",
                error: err?.message ? String(err.message) : "Failed to apply image",
            });
            void showAlert("Could not apply this image. Please try again.", "Images");
        }
    }, [currentFile, saveFileToServer, showAlert, showConfirm, stagedImages, updateStagedImage, uploadImageToUserBlob]);

    const undoLastImageInsert = useCallback(async () => {
        if (!lastImageInsert) {
            void showAlert("No image insertion to undo yet.", "Images");
            return;
        }

        const { stagedImageId, targetPath, previousContent, uploadedPath } = lastImageInsert;
        const confirmed = await showConfirm(
            `Undo the last image insert in ${targetPath}?`,
            "Images",
        );
        if (!confirmed) return;

        setApp((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                files: {
                    ...prev.files,
                    [targetPath]: {
                        content: previousContent,
                        lastModified: Date.now(),
                    },
                },
            };
        });

        if (currentFile === targetPath) {
            setCode(previousContent);
        }

        const ok = await saveFileToServer(targetPath, previousContent, { afterSave: "apply", interactive: true });
        if (!ok) {
            void showAlert("Undo failed while restoring file content.", "Images");
            return;
        }

        if (uploadedPath) {
            await deleteUserBlobPaths([uploadedPath]);
        }

        updateStagedImage(stagedImageId, {
            status: "staged",
            uploadedUrl: null,
            uploadedPath: null,
            error: null,
        });
        setLastImageInsert(null);
        void showAlert("Image insert reverted.", "Images");
    }, [currentFile, deleteUserBlobPaths, lastImageInsert, saveFileToServer, showAlert, showConfirm, updateStagedImage]);

    const applyFaviconToApp = useCallback(async (nextUrl: string) => {
        const files = appRef.current?.files;
        const appDir = detectNextAppDir(files);

        if (!files || !appDir) {
            await showAlert(
                "This project doesn’t look like a Next.js App Router project (no app/ or src/app/ folder found). I can upload the icon, but can’t auto-wire it into your code.",
                "Favicon",
            );
            return;
        }

        const headPath = `${appDir}/head.tsx`;
        const existing = (files as any)?.[headPath]?.content;

        const faviconRoutePath = `${appDir}/favicon.ico/route.ts`;
        const existingFaviconRoute = (files as any)?.[faviconRoutePath]?.content;
        const canWriteFaviconRoute =
            typeof existingFaviconRoute !== "string" || existingFaviconRoute.includes("kloner:favicon-route");

        const faviconRouteContent = canWriteFaviconRoute ? buildFaviconIcoRouteTs(nextUrl) : null;

        const content =
            typeof existing === "string" && existing.trim().length > 0
                ? upsertFaviconInHeadTsx(existing, nextUrl)
                : buildHeadTsxWithFavicon(nextUrl);

        // Update local state immediately
        setApp((prev) => prev ? {
            ...prev,
            files: {
                ...prev.files,
                [headPath]: { content, lastModified: Date.now() },
                ...(canWriteFaviconRoute && faviconRouteContent
                    ? { [faviconRoutePath]: { content: faviconRouteContent, lastModified: Date.now() } }
                    : null),
            },
        } : prev);

        if (!canWriteFaviconRoute) {
            void showAlert(
                "I found an existing /favicon.ico route in your app and didn’t overwrite it. I updated head.tsx, but your browser may still request /favicon.ico unless you handle that route.",
                "Favicon",
            );
        }

        await saveFileToServer(headPath, content, { afterSave: "none", interactive: true });
        if (canWriteFaviconRoute && faviconRouteContent) {
            await saveFileToServer(faviconRoutePath, faviconRouteContent, { afterSave: "none", interactive: true });
        }

        queuePreviewApply(
            [
                { path: headPath, content },
                ...(canWriteFaviconRoute && faviconRouteContent
                    ? [{ path: faviconRoutePath, content: faviconRouteContent }]
                    : []),
            ],
            { interactive: false },
        );
        setFaviconUrl(nextUrl);
    }, [queuePreviewApply, saveFileToServer, showAlert]);

    const handleFaviconFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setFaviconUploading(true);

            const { url } = await uploadFaviconToUserBlob(file);
            await applyFaviconToApp(url);
            void showAlert("Favicon updated.", "Favicon");
        } catch (err: any) {
            console.error("Favicon upload failed", err);
            void showAlert("Failed to upload favicon. Please try again.", "Favicon");
        } finally {
            setFaviconUploading(false);
            e.target.value = "";
        }
    }, [applyFaviconToApp, showAlert, uploadFaviconToUserBlob]);

    const handleFileChangeFromContainer = useCallback((path: string, content: string) => {
        // While we are in generation-processing state we may be running a placeholder template.
        // Do not persist container-origin writes during that phase.
        if ((appRef.current as any)?.generationStatus === "processing") {
            return;
        }

        // Update local state
        setApp((prev) => prev ? {
            ...prev,
            files: {
                ...prev.files,
                [path]: { content, lastModified: Date.now() },
            },
        } : null);

        // If this is the currently open file, update the editor
        if (path === currentFile) {
            setCode(content);
        }

        // Persist container-origin changes, but do not re-apply/restart (avoids loops).
        saveFileToServer(path, content, { afterSave: "none" });
    }, [currentFile, saveFileToServer]);

    const handleFileEditFromAI = useCallback((path: string, content: string, creditRequestId?: string) => {
        const files = appRef.current?.files;
        const canonicalPath = canonicalizeEditPath(path, files);
        if (!canonicalPath) return;

        // Guardrail: a broken tsconfig/jsconfig can crash Next dev bundler (e.g. baseUrl errors).
        const lower = canonicalPath.toLowerCase();
        if (lower.endsWith("tsconfig.json") || lower.endsWith("jsconfig.json")) {
            try {
                JSON.parse(String(content || ""));
            } catch {
                void showAlert(
                    `The agent produced invalid JSON for ${canonicalPath}. Not applying this change to avoid breaking the preview.`,
                    "Invalid config",
                );
                return;
            }
        }

        // Update local state
        setApp((prev) => prev ? {
            ...prev,
            files: {
                ...prev.files,
                [canonicalPath]: { content, lastModified: Date.now() },
            },
        } : null);

        // If this is the currently open file, update the editor
        if (canonicalPath === currentFile) {
            setCode(content);
        }

        // Save to Firebase first (source of truth), then live-apply via /api/previews/apply.
        void saveFileToServer(canonicalPath, content, { afterSave: "apply" }).then((ok) => {
            const rid = String(creditRequestId || "").trim();
            if (!ok || !rid) return;
            if (lastConsumedAiCreditRequestIdRef.current === rid) return;
            lastConsumedAiCreditRequestIdRef.current = rid;
            void consumeAiEditCredit(rid);
        });
    }, [consumeAiEditCredit, currentFile, saveFileToServer, showAlert]);

    // If an app has a jsconfig/tsconfig with missing compilerOptions (e.g. `{}`), Next's
    // dev bundler can crash reading `baseUrl`. Repair once and restart the local preview.
    useEffect(() => {
        if (didAutoRepairConfigRef.current) return;
        if (!appId) return;
        const files = app?.files;
        if (!files) return;

        const candidates = ["tsconfig.json", "jsconfig.json"];
        const fixes: Array<{ path: string; content: string }> = [];

        for (const p of candidates) {
            const raw = (files as any)?.[p]?.content;
            if (typeof raw !== "string" || !raw.trim()) continue;
            const normalized = ensureCompilerOptionsObject(raw);
            if (!normalized.ok) continue;
            if (normalized.normalized !== raw) {
                fixes.push({ path: p, content: normalized.normalized });
            }
        }

        if (fixes.length === 0) {
            didAutoRepairConfigRef.current = true;
            return;
        }

        didAutoRepairConfigRef.current = true;

        (async () => {
            try {
                for (const f of fixes) {
                    await saveFileToServer(f.path, f.content, { afterSave: "none" });
                }
                // Restart to ensure the preview machine reloads config without crashing.
                await restartLocalPreview(false);
            } catch {
                // ignore; user can manually restart
            }
        })();
    }, [appId, app?.files, restartLocalPreview, saveFileToServer]);

    const handleSave = async (interactive: boolean = true) => {
        if (!currentFile || !app || isSaving) return;

        setIsSaving(true);
        try {
            const ok = await saveFileToServer(currentFile, code, { afterSave: "none", interactive });
            if (!ok) return;

            // Update local state
            setApp((prev) =>
                prev
                    ? {
                        ...prev,
                        files: {
                            ...prev.files,
                            [currentFile]: { content: code, lastModified: Date.now() },
                        },
                    }
                    : null
            );

            queuePreviewApply([{ path: currentFile, content: code }], { interactive });
        } catch (err) {
            console.error("Save failed", err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeploy = async () => {
        if (!app || isDeploying) return;

        const alreadyDeployed = Boolean(app.isDeployed) || Boolean(app.productionUrl);
        if (!alreadyDeployed) {
            const confirmed = await showConfirm(
                "Start deployment for this app now?",
                "Deploy",
            );
            if (!confirmed) return;

            if (onDeploy) {
                onDeploy({ id: app.id, name: app.name });
                return;
            }
            void showAlert("First deploy is handled in the dashboard deploy wizard.", "Deploy");
            return;
        }

        const confirmed = await showConfirm(
            "Deploy your latest changes live now?",
            "Deploy",
        );
        if (!confirmed) return;

        void runVercelDeployLive();
    };

    const runVercelDeployLive = useCallback(async () => {
        if (!appId) return;
        if (isDeploying) return;

        setIsDeploying(true);
        setDeployChoiceError(null);
        setShowDeploySuccess(false);

        try {
            // Ensure Vercel is connected before attempting either deploy.
            if (!isVercelConnected) {
                setVercelConnectOpen(true);
                throw new Error("Vercel is not connected yet.");
            }

            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const doDeploy = async () => {
                const res = await fetch(`/api/app-builder/${appId}/deploy`, {
                    method: "POST",
                    headers: csrfHeaders(csrf),
                    credentials: "include",
                });
                const data = await res.json().catch(() => ({} as any));
                return { res, data };
            };

            let { res, data } = await doDeploy();

            const code = String((data as any)?.code || "").trim();
            const isScopeProblem = code === "MISSING_APP_SCOPE" || code === "INVALID_APP_SCOPE";

            if ((!res.ok || !data?.ok) && isScopeProblem) {
                await fetch(`/api/app-builder/${appId}/scope`, {
                    method: "GET",
                    credentials: "include",
                }).catch(() => null);

                ({ res, data } = await doDeploy());
            }

            if (!res.ok || !data?.ok) {
                const msg = (data as any)?.error || `Deploy failed (HTTP ${res.status})`;
                const debugBits = [
                    (data as any)?.code ? `code=${String((data as any).code)}` : "",
                    (data as any)?.reqId ? `reqId=${String((data as any).reqId)}` : "",
                ].filter(Boolean);
                throw new Error(debugBits.length ? `${msg} (${debugBits.join(", ")})` : msg);
            }

            const url = (data?.url || data?.previewUrl || "").toString().trim();
            if (!url) throw new Error("Deploy completed but no URL was returned.");

            setLastDeployLiveUrl(url);
            setShowDeploySuccess(true);
            setTimeout(() => setShowDeploySuccess(false), 12000);

            return;
        } catch (err: any) {
            setDeployChoiceError(err?.message || "Deploy failed.");
        } finally {
            // Keep deploy disabled for longer to prevent spam
            setTimeout(() => setIsDeploying(false), 5000);
        }
    }, [appId, isDeploying, isVercelConnected]);

    const startVercelOAuthForPreview = useCallback(() => {
        if (!VERCEL_INTEGRATION_SLUG) {
            console.error("Missing NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG");
            setPreviewError("Vercel integration is not configured.");
            return;
        }

        try {
            setVercelConnectOpening(true);
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            const state = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");

            // Persist what we were trying to do so the dashboard can restore state after redirect.
            localStorage.setItem(
                "kloner_vercel_pending_app_preview",
                JSON.stringify({ appId }),
            );

            localStorage.setItem("kloner_vercel_latest_csrf", state);

            document.cookie = [
                `vercel_oauth_state=${state}`,
                "Path=/",
                "Max-Age=600",
                "SameSite=Lax",
            ].join("; ");

            const returnTo = `/dashboard/view?vercel=connected`;
            document.cookie = [
                `vercel_oauth_return=${encodeURIComponent(returnTo)}`,
                "Path=/",
                "Max-Age=600",
                "SameSite=Lax",
            ].join("; ");

            const link = `https://vercel.com/integrations/${VERCEL_INTEGRATION_SLUG}/new?state=${state}`;
            window.location.assign(link);
        } catch (e) {
            console.error("Failed to start Vercel OAuth", e);
            setPreviewError("Could not open Vercel. Try again in a moment.");
            setVercelConnectOpening(false);
        }
    }, [appId]);

    const tryEmbedExistingPreview = useCallback(() => {
        const url = (protectedPreviewUrl || "").trim();
        if (!url) return;
        setPreviewError(null);
        setApp((prev) => (prev ? { ...prev, previewUrl: url } : prev));
        setRefreshKey((k) => k + 1);
    }, [protectedPreviewUrl]);

    // If we just came back from Vercel OAuth, auto-resume the action.
    useEffect(() => {
        if (!isVercelConnected) return;
        if (!appId) return;

        let pending: any = null;
        try {
            const raw = localStorage.getItem("kloner_vercel_pending_app_preview");
            if (raw) pending = JSON.parse(raw);
        } catch {
            pending = null;
        }

        if (!pending || pending.appId !== appId) return;

        try {
            localStorage.removeItem("kloner_vercel_pending_app_preview");
        } catch {
            // ignore
        }

        // No-op for embedded preview; deploy actions will work after connect.
    }, [isVercelConnected, appId]);

    // On editor open: automatically build and show the preview (with retries + automatic bypass).
    useEffect(() => {
        if (!appId) return;
        if (loading) return;
        if (isVercelChecking) return;
        if (didAutoPreviewStartRef.current) return;

        didAutoPreviewStartRef.current = true;

        // Always use embedded local preview.
        setPreviewMode("webcontainer");
        // Kick the runner once to ensure it starts.
        setRefreshKey((k) => k + 1);
    }, [appId, loading, isVercelChecking]);

    const handleRefresh = async (forceFresh: boolean = false) => {
        if (isRefreshing) return;
        
        if (forceFresh) {
            // Show confirmation dialog for force fresh start
            const confirmed = await showConfirm(
                "This will delete the current machine and start completely fresh. Any unsaved changes may be lost. Continue?",
                "Force Fresh Start"
            );
            if (!confirmed) return;
        }
        
        setIsRefreshing(true);
        if (forceFresh) {
            void restartLocalPreview(true).finally(() => {
                setTimeout(() => setIsRefreshing(false), 500);
            });
            return;
        }

        // Default refresh: reconnect/reload without hitting any legacy endpoints.
        setPreviewMode("webcontainer");
        setReconnectKey((k) => k + 1);
        setRefreshKey((k) => k + 1);
        setTimeout(() => setIsRefreshing(false), 500);
    };

    const handleReconnect = () => {
        setPreviewMode("webcontainer");
        setReconnectKey((k) => k + 1);
    };

    const handleRename = async () => {
        if (!app || !tempName.trim()) return;

        try {
            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/rename`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ name: tempName.trim() }),
            });
            if (!res.ok) throw new Error("Failed to rename");
            setApp(prev => prev ? { ...prev, name: tempName.trim() } : null);
            setIsRenaming(false);
        } catch (err) {
            console.error("Rename failed", err);
        }
    };

    const startRename = () => {
        setTempName(app?.name || "");
        setIsRenaming(true);
    };

    const cancelRename = () => {
        setIsRenaming(false);
        setTempName("");
    };

    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(max-width: 767px)");
        const update = () => setIsMobile(Boolean(mq.matches));
        update();

        if (typeof mq.addEventListener === "function") {
            mq.addEventListener("change", update);
            return () => mq.removeEventListener("change", update);
        }

        // Safari < 14 legacy API
        const legacyMq = mq as any;
        if (typeof legacyMq.addListener === "function") legacyMq.addListener(update);
        return () => {
            if (typeof legacyMq.removeListener === "function") legacyMq.removeListener(update);
        };
    }, []);

    const showLeftPanel = !isMobile || mobileTab === "prompt";
    const showRightPanel = !isMobile || mobileTab === "app";

    if (loading) {
        return (
            <KlonerLoader />
        );
    }

    if (error) {
        return (
            <div
                className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/40 p-4"
                onMouseDown={(e) => {
                    if (e.target === e.currentTarget) onCloseRef.current?.();
                }}
            >
                <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white shadow-2xl">
                    <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
                        <div className="space-y-1">
                            <div className="text-sm font-semibold text-neutral-900">Failed to load app</div>
                        </div>

                        <button
                            type="button"
                            onClick={() => onCloseRef.current?.()}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200"
                            title="Close"
                            aria-label="Close"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                className="h-4 w-4 text-neutral-700"
                            >
                                <path
                                    fillRule="evenodd"
                                    d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                                    clipRule="evenodd"
                                />
                            </svg>
                        </button>
                    </div>

                    <div className="px-5 py-4">
                        <div className="text-sm text-neutral-700 whitespace-pre-wrap">{error}</div>
                    </div>

                    <div className="flex justify-end gap-3 border-t border-neutral-200 px-5 py-4">
                        <button
                            type="button"
                            onClick={() => onCloseRef.current?.()}
                            className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50"
                        >
                            Close
                        </button>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 text-sm font-medium text-white bg-[#f55f2a] rounded-lg"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!app) {
        return (
            <div className="fixed inset-0 z-[16000] bg-black/70 backdrop-blur-sm flex items-center justify-center">
                <div className="bg-white rounded-lg p-8">
                    <div className="text-center">App not found</div>
                </div>
            </div>
        );
    }

    if (app.generationStatus === "error" && !dismissedGenerationError) {
        return (
            <div className="fixed inset-0 z-[16000] bg-black/70 backdrop-blur-sm flex items-center justify-center">
                <div className="bg-white rounded-lg p-8 max-w-md">
                    <div className="text-center">
                        <div className="text-red-600 text-lg font-semibold mb-2">Generation Failed</div>
                        <div className="text-gray-600 text-sm mb-4">
                            {app.generationError || "An error occurred while generating your app."}
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                            <button
                                onClick={handleReconnect}
                                className="px-4 py-2 bg-accent text-white rounded-full hover:bg-accent-dark transition-colors"
                            >
                                Reconnect preview
                            </button>
                            <button
                                onClick={() => setDismissedGenerationError(true)}
                                className="px-4 py-2 bg-gray-100 text-gray-900 rounded-full hover:bg-gray-200 transition-colors"
                            >
                                Continue anyway
                            </button>
                            <button
                                onClick={() => window.location.reload()}
                                className="px-4 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors"
                            >
                                Retry
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!cookiesConsentResolved) {
        return <KlonerLoader />;
    }

    if (!acceptedNecessaryCookies) {
        return (
            <div className="fixed inset-0 z-[20000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white shadow-2xl overflow-hidden">
                    <div className="border-b border-neutral-200 px-5 py-4 bg-gradient-to-b from-gray-50 to-white">
                        <div className="text-lg font-semibold text-neutral-900">Accept necessary cookies</div>
                        <div className="mt-1 text-sm text-neutral-600">Required before opening the app builder</div>
                    </div>

                    <div className="px-5 py-4 space-y-3">
                        <p className="text-sm text-neutral-700">
                            Necessary cookies are absolutely required for app building and for connecting your preview to our application inside the embedded editor.
                        </p>
                        <p className="text-sm text-neutral-700">
                            Without this, some browsers may block the routing cookie used by the preview iframe and show a preview load error.
                        </p>
                        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                            This only enables essential app-builder session/routing cookies. No optional marketing cookies are required here.
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-4">
                        <button
                            type="button"
                            onClick={() => onCloseRef.current?.()}
                            className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-200 rounded-full hover:bg-neutral-50"
                        >
                            Close
                        </button>
                        <button
                            type="button"
                            onClick={acceptNecessaryCookiesAndContinue}
                            className="px-4 py-2 text-sm font-semibold text-white bg-[#F55F2A] rounded-full hover:bg-[#E04E1B]"
                        >
                            Accept necessary cookies
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[16000] bg-black/70 backdrop-blur-sm">
            {isGenerationProcessing && previewMode !== "webcontainer" ? (
                <div className="fixed inset-0 z-[17000] bg-black/70 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-white rounded-lg p-8 max-w-md">
                        <div className="text-center">
                            <KlonerLoader />
                            <div className="text-gray-600 text-sm mt-4">
                                Generating your app… Starting a preview machine in the background.
                            </div>

                            {typeof (app as any).generationProgress === "number" ? (
                                <div className="mt-4">
                                    <div className="text-xs font-semibold text-gray-700">
                                        Progress: {Math.max(0, Math.min(100, Math.round((app as any).generationProgress)))}%
                                    </div>
                                    <div className="mt-2 h-2 w-full rounded-full bg-gray-200 overflow-hidden">
                                        <div
                                            className="h-full bg-[#F55F2A]"
                                            style={{
                                                width: `${Math.max(0, Math.min(100, Math.round((app as any).generationProgress)))}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}
            <div className="h-full w-full bg-white flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                    <div className="flex flex-1 min-w-0 items-center gap-3">
                        {isRenaming ? (
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={tempName}
                                    onChange={(e) => setTempName(e.target.value)}
                                    onKeyPress={(e) => {
                                        if (e.key === "Enter") handleRename();
                                        if (e.key === "Escape") cancelRename();
                                    }}
                                    className="px-2 py-1 border rounded text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-accent"
                                    autoFocus
                                />
                                <button
                                    onClick={handleRename}
                                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                                    title="Save name"
                                >
                                    <Check className="w-4 h-4 text-green-600" />
                                </button>
                                <button
                                    onClick={cancelRename}
                                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                                    title="Cancel"
                                >
                                    <RotateCcw className="w-4 h-4 text-red-600" />
                                </button>
                            </div>
                        ) : (
                            <div className="relative group min-w-0">
                                <h1
                                    className="block truncate text-lg sm:text-xl font-semibold cursor-pointer hover:text-accent transition-colors"
                                    onClick={startRename}
                                    title="Click to rename"
                                >
                                    {app?.name || "Untitled Project"}
                                </h1>
                            </div>
                        )}

                        {/* Project controls (moved off top-right) */}
                        <div className="ml-2 hidden md:flex items-center gap-2">
                            <button
                                onClick={() => void handleSave(true)}
                                disabled={isSaving}
                                className="px-4 py-2 bg-[#F55F2A] text-xs font-semibold text-white rounded hover:bg-[#E04E1B] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all rounded-full"
                            >
                                <Upload className="w-4 h-4" />
                                {isSaving ? "Saving..." : "Save"}
                            </button>

                            <button
                                onClick={() => void openDatabaseConnect()}
                                className={`min-w-[170px] px-4 py-2 text-xs font-semibold rounded-full flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
                                    supabaseConnected === null
                                        ? "bg-white text-gray-500 border border-gray-200"
                                        : supabaseConnected
                                          ? supabaseDbReachable === false
                                              ? (supabaseDbReason === "project_paused" || supabaseDbReason === "timeout_or_network")
                                                  ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                                                  : "bg-red-100 text-red-900 hover:bg-red-200"
                                              : supabaseDbReachable === true
                                                ? "bg-green-100 text-green-900 hover:bg-green-200"
                                                : "bg-white text-green-900 border border-green-200 hover:bg-green-50"
                                          : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                                }`}
                                title={
                                    supabaseConnected
                                        ? `${supabaseDbReachable === false ? "Database unreachable" : "Database connected"}${supabaseProjectName ? `: ${supabaseProjectName}` : ""}${supabaseDbStatusText ? `\n\n${supabaseDbStatusText}` : ""}`
                                        : "Connect your database"
                                }
                            >
                                <Database className="w-4 h-4 shrink-0" />
                                {supabaseConnected === null ? (
                                    <span>DB: Verifying…</span>
                                ) : supabaseConnected ? (
                                    <span className="flex flex-col items-start leading-tight">
                                        <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">
                                            {supabaseDbReachable === false
                                                ? supabaseDbReason === "project_paused"
                                                    ? "DB: Paused"
                                                    : supabaseDbReason === "timeout_or_network"
                                                      ? "DB: Resuming"
                                                      : "Unreachable"
                                                : supabaseDbReachable === true
                                                  ? "DB: Healthy"
                                                  : "DB: Connected"}
                                        </span>
                                        {supabaseProjectName ? (
                                            <span className="max-w-[110px] truncate font-semibold" title={supabaseProjectName}>
                                                {supabaseProjectName}
                                            </span>
                                        ) : supabaseProjectRef ? (
                                            <span className="max-w-[110px] truncate font-mono text-[10px]" title={supabaseProjectRef}>
                                                {supabaseProjectRef}
                                            </span>
                                        ) : null}
                                    </span>
                                ) : (
                                    <span>Connect DB</span>
                                )}
                            </button>

                            {supabaseConnected ? (
                                <button
                                    onClick={() => void disconnectSupabase()}
                                    className="p-2 rounded-full border border-red-200 bg-white text-red-700 hover:bg-red-50 transition-colors"
                                    title="Disconnect Supabase from Kloner (does not delete your Supabase project)"
                                    aria-label="Disconnect database"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex gap-2 items-center">
                        <button
                            onClick={() => setMobileControlsOpen(true)}
                            className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-md transition hover:bg-neutral-50"
                            title="Controls"
                            aria-label="Controls"
                        >
                            <SlidersHorizontal className="h-4 w-4" />
                        </button>

                        {/* Top-right reserved for machine + deploy (PreviewEditorV2-style) */}
                        <div className="hidden md:inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-2 py-1 shadow-md">
                            <div className="px-2 text-[11px] font-semibold text-neutral-700 whitespace-nowrap">
                                <span
                                    className={`mr-2 inline-block h-2 w-2 rounded-full ${
                                        isPreviewBuilding
                                            ? "bg-amber-500"
                                            : isRefreshing
                                              ? "bg-blue-500"
                                              : isWebPreviewReady
                                                ? "bg-green-500"
                                                : "bg-neutral-400"
                                    }`}
                                    aria-hidden="true"
                                />
                                Machine: {isPreviewBuilding ? "Starting" : isRefreshing ? "Refreshing" : isWebPreviewReady ? "Ready" : "Idle"}
                            </div>

                            <button
                                onClick={handleReconnect}
                                disabled={isRefreshing || isPreviewBuilding}
                                className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full border border-neutral-300 bg-white px-2.5 text-[12px] font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60"
                                title="Reconnect to the existing machine without restarting"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>Refresh</span>
                            </button>

                            <button
                                onClick={() => handleRefresh(true)}
                                disabled={isPreviewBuilding || isRefreshing}
                                className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full border border-neutral-300 bg-white px-2.5 text-[12px] font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60"
                                title="Delete current machine and rebuild app (this will not delete your website)"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span>{isPreviewBuilding ? "Starting" : "Rebuild"}</span>
                            </button>
                        </div>

                        {showDeploySuccess ? (
                            <div className="md:hidden rounded-xl border border-emerald-200 bg-emerald-50/70 px-2.5 py-2 text-[11px] text-emerald-900">
                                <div className="font-semibold">Live deploy started</div>
                                <div className="mt-0.5 text-emerald-800/90">Rebuild can take a few minutes before updates appear.</div>
                                {lastDeployLiveUrl ? (
                                    <button
                                        type="button"
                                        onClick={() => window.open(lastDeployLiveUrl, "_blank", "noopener,noreferrer")}
                                        className="mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                                        title="Open live site"
                                    >
                                        View live: {deployUrlShortLabel}
                                    </button>
                                ) : null}
                            </div>
                        ) : null}

                        <button
                            onClick={handleDeploy}
                            disabled={isDeploying}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#f55f2a] bg-[#f55f2a] px-3 py-1 text-[13px] font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
                            title="Deploy"
                            aria-label="Deploy"
                        >
                            <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{isDeploying ? "Deploying…" : "Deploy"}</span>
                        </button>

                        <button
                            onClick={() => void requestClose()}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-md transition hover:bg-neutral-50"
                            title="Close"
                            aria-label="Close editor"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Hidden file input: keep mounted for mobile controls */}
                <input
                    ref={faviconInputRef}
                    type="file"
                    accept=".ico,image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml"
                    className="hidden"
                    onChange={handleFaviconFileChange}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageFileChange}
                />

                {isGenerationProcessing && previewMode === "webcontainer" ? (
                    <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900">
                        {"Generating your app. Preview will update automatically when it's ready."}
                    </div>
                ) : null}

                <div className="flex flex-1 min-h-0" data-app-builder-container>
                    {/* Left Panel - AI Chat and Controls */}
                    <div 
                        className={`${showLeftPanel ? "flex" : "hidden"} flex-col bg-gray-50 flex-shrink-0 min-h-0 overflow-hidden w-full md:w-auto md:border-r`}
                        style={!isMobile ? { width: `${leftPanelWidth}px` } : undefined}
                    >
                        {/* View Mode Toggle */}
                        <div className="p-3 border-b sticky top-0 z-10 bg-gray-50">
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    onClick={() => setViewMode("ai")}
                                    className={`flex-1 px-4 py-2 text-xs font-semibold rounded-full flex items-center justify-center gap-2 transition-colors ${
                                        viewMode === "ai"
                                            ? "bg-[#F55F2A] text-white hover:bg-[#E04E1B]"
                                            : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                                    }`}
                                    title="UI"
                                >
                                    <MessageSquare className="w-4 h-4" />
                                    UI
                                </button>
                                <button
                                    onClick={() => setViewMode("code")}
                                    className={`flex-1 px-4 py-2 text-xs font-semibold rounded-full flex items-center justify-center gap-2 transition-colors ${
                                        viewMode === "code"
                                            ? "bg-[#F55F2A] text-white hover:bg-[#E04E1B]"
                                            : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                                    }`}
                                    title="Code"
                                >
                                    <Code className="w-4 h-4" />
                                    Code
                                </button>
                                <button
                                    onClick={() => setViewMode("images")}
                                    className={`flex-1 px-4 py-2 text-xs font-semibold rounded-full flex items-center justify-center gap-2 transition-colors ${
                                        viewMode === "images"
                                            ? "bg-[#F55F2A] text-white hover:bg-[#E04E1B]"
                                            : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                                    }`}
                                    title="Images"
                                >
                                    <Images className="w-4 h-4" />
                                    Images
                                </button>
                            </div>
                        </div>

                        {/* AI Chat or Code View */}
                        <div className="flex-1 min-h-0 overflow-hidden">
                            {viewMode === "ai" ? (
                                // AI Chat Interface
                                <AIAgentChat
                                    appId={appId}
                                    files={app.files}
                                    onFileEdit={handleFileEditFromAI}
                                    onFilesReplace={handleFilesReplaceFromServer}
                                    onRestoreApplied={handleRestoreApplied}
                                    creditError={agentCreditError}
                                    previewReady={previewMode !== "webcontainer" ? true : isWebPreviewReady}
                                    welcomeContext={agentWelcomeContext}
                                />
                            ) : viewMode === "code" ? (
                                // Code View - File Tree and Editor
                                <div className="h-full flex flex-col">
                                    {/* File Tree */}
                                    <div className="flex-1 border-b p-3 overflow-auto">
                                        <h3 className="font-medium mb-2 text-sm">Files</h3>
                                        <FileTree nodes={fileTree} onFileSelect={handleFileSelect} />
                                    </div>

                                    {/* Code Editor */}
                                    <div className="flex-1">
                                        {currentFile ? (
                                            <Editor
                                                height="100%"
                                                language="javascript"
                                                value={code}
                                                onChange={handleCodeChange}
                                                theme="vs-dark"
                                                options={{
                                                    minimap: { enabled: false },
                                                    fontSize: 12,
                                                    lineNumbers: "off",
                                                    scrollBeyondLastLine: false,
                                                }}
                                            />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                                                Select a file to edit
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col">
                                    <div className="border-b p-3 space-y-3">
                                        <div className="flex items-center justify-end gap-3">
                                            {lastImageInsert ? (
                                                <button
                                                    type="button"
                                                    onClick={() => void undoLastImageInsert()}
                                                    className="text-xs font-semibold text-[#F55F2A] hover:text-[#E04E1B]"
                                                >
                                                    Undo last insert
                                                </button>
                                            ) : null}
                                            {stagedImages.length ? (
                                                <button
                                                    type="button"
                                                    onClick={clearStagedImages}
                                                    className="text-xs text-gray-600 hover:text-gray-900"
                                                >
                                                    Clear all
                                                </button>
                                            ) : null}
                                        </div>

                                        <div className="flex flex-col items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={handlePickImages}
                                                className="inline-flex items-center gap-2 rounded-full bg-[#F55F2A] px-3 py-2 text-xs font-semibold text-white hover:bg-[#E04E1B]"
                                            >
                                                <Upload className="w-3.5 h-3.5" />
                                                Upload
                                            </button>
                                            <label className="inline-flex items-center gap-2 text-[11px] text-gray-500">
                                                <input
                                                    type="checkbox"
                                                    checked={autoCompressImages}
                                                    onChange={(e) => setAutoCompressImages(e.target.checked)}
                                                    className="rounded border-gray-300"
                                                />
                                                Auto-compress before upload
                                            </label>
                                        </div>
                                    </div>

                                    <div className="flex-1 overflow-auto p-3 space-y-3">
                                        {stagedImages.length === 0 ? (
                                            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-xs text-gray-600">
                                                Add one or more images to stage them, then type placement prompts like insert into homepage top or add to footer.
                                            </div>
                                        ) : null}

                                        {stagedImages.map((item) => {
                                            const compressionPct = item.originalBytes > 0
                                                ? Math.max(0, Math.round((1 - item.preparedBytes / item.originalBytes) * 100))
                                                : 0;

                                            return (
                                                <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5">
                                                    <div className="flex items-start gap-3">
                                                        <Image
                                                            src={item.previewUrl}
                                                            alt={item.alt || "Staged image"}
                                                            width={64}
                                                            height={64}
                                                            unoptimized
                                                            className="h-16 w-16 rounded-lg object-cover border border-gray-200"
                                                        />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-xs font-semibold text-gray-900 truncate">{item.originalFile.name}</div>
                                                            <div className="text-[11px] text-gray-500">
                                                                {Math.round(item.originalBytes / 1024)}KB → {Math.round(item.preparedBytes / 1024)}KB
                                                                {item.preparedBytes < item.originalBytes ? ` (${compressionPct}% smaller)` : ""}
                                                            </div>

                                                            <details className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                                                                <summary className="cursor-pointer select-none text-[11px] text-gray-600">Alt text</summary>
                                                                <div className="mt-2">
                                                                    <input
                                                                        type="text"
                                                                        value={item.alt}
                                                                        onChange={(e) => updateStagedImage(item.id, { alt: e.target.value })}
                                                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs bg-white"
                                                                        placeholder="Alt text"
                                                                    />
                                                                </div>
                                                            </details>

                                                            {item.error ? (
                                                                <div className="mt-2 text-[11px] text-red-600">{item.error}</div>
                                                            ) : null}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeStagedImage(item.id)}
                                                            className="text-gray-500 hover:text-gray-900"
                                                            title="Remove"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>

                                                    <div className="mt-4 mb-2 space-y-3">
                                                        <label className="block text-[12px] font-medium text-gray-700">Where should this go?</label>
                                                        <div className="relative flex items-center bg-white/95 gap-2 backdrop-blur-md p-2 pl-4 pr-2 shadow-[0_12px_30px_rgba(0,0,0,0.08)] ring-1 ring-neutral-200 rounded-full h-[48px]">
                                                            <input
                                                                type="text"
                                                                value={item.placementPrompt}
                                                                onChange={(e) => updateStagedImage(item.id, { placementPrompt: e.target.value })}
                                                                className="flex-1 bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400 font-medium text-[13px] sm:text-sm"
                                                                placeholder={IMAGE_PLACEMENT_PLACEHOLDERS[imagePromptPlaceholderIdx]}
                                                            />

                                                            <button
                                                                type="button"
                                                                onClick={() => void applyStagedImage(item.id)}
                                                                disabled={item.status === "uploading" || !item.placementPrompt.trim()}
                                                                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition disabled:opacity-60 ${
                                                                    item.status === "applied"
                                                                        ? "bg-emerald-100 text-emerald-700"
                                                                        : item.status === "uploading"
                                                                          ? "bg-neutral-200 text-neutral-600"
                                                                          : "bg-[#F55F2A] text-white hover:bg-[#E04E1B]"
                                                                }`}
                                                                title={item.status === "applied" ? "Applied" : "Apply image"}
                                                                aria-label={item.status === "applied" ? "Applied" : "Apply image"}
                                                            >
                                                                {item.status === "applied" ? (
                                                                    <Check className="h-4 w-4" />
                                                                ) : item.status === "uploading" ? (
                                                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <Send className="h-4 w-4" />
                                                                )}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Resize Handle */}
                    <div
                        className="hidden md:block w-1 bg-gray-300 hover:bg-gray-400 cursor-col-resize transition-colors flex-shrink-0"
                        onMouseDown={() => setIsResizing(true)}
                        title="Drag to resize panels"
                    />

                    {/* Right Panel - Browser-like App View */}
                    <div className={`${showRightPanel ? "flex" : "hidden"} flex-1 flex flex-col min-h-0`}>
                        {/* Browser Chrome */}
                        <div className="hidden md:flex bg-gray-100 border-b px-4 py-2 items-center gap-2">
                            <div className="flex gap-1">
                                <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                                <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                                <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                            </div>
                            {lastDeployLiveUrl ? (
                                <div className="ml-3 flex items-center gap-2 text-xs">
                                    <button
                                        onClick={() => window.open(lastDeployLiveUrl, "_blank", "noopener,noreferrer")}
                                        className="px-3 py-1 rounded-full border border-gray-300 hover:bg-gray-50"
                                        title="Open live deployment"
                                    >
                                        View live
                                    </button>

                                    <a
                                        href="https://vercel.com/domains"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-gray-600 underline hover:text-gray-900"
                                        title="Attach a custom domain in Vercel"
                                    >
                                        Attach custom domain
                                    </a>
                                </div>
                            ) : null}

                            <div className="ml-3 flex items-center gap-2 text-xs">
                                <button
                                    type="button"
                                    onClick={handlePickFavicon}
                                    disabled={faviconUploading}
                                    className="px-3 py-1 rounded-full border border-gray-300 hover:bg-gray-50 disabled:opacity-60"
                                    title="Upload a favicon.ico for this app"
                                >
                                    {faviconUploading ? "Uploading favicon…" : "Upload favicon"}
                                </button>

                                {faviconUrl ? (
                                    <button
                                        type="button"
                                        onClick={() => window.open(faviconUrl, "_blank", "noopener,noreferrer")}
                                        className="text-xs text-gray-600 underline hover:text-gray-900"
                                        title="Open current favicon"
                                    >
                                        View favicon
                                    </button>
                                ) : null}
                            </div>

                            {showDeploySuccess ? (
                                <div className="ml-auto rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
                                    <div className="font-semibold">Live deploy started</div>
                                    <div className="mt-0.5 text-[11px] text-emerald-800/90">Rebuild can take a few minutes before updates appear.</div>
                                    {lastDeployLiveUrl ? (
                                        <button
                                            type="button"
                                            onClick={() => window.open(lastDeployLiveUrl, "_blank", "noopener,noreferrer")}
                                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold underline underline-offset-2"
                                            title="Open live site"
                                        >
                                            View live: {deployUrlShortLabel}
                                        </button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        {/* App Content */}
                        <div className="flex-1 bg-white">
                            {previewMode === "webcontainer" ? (
                                <div className="h-full w-full p-3">
                                    <WebContainerRunner
                                        appId={appId}
                                        files={effectivePreviewFiles}
                                        onFileChange={handleFileChangeFromContainer}
                                        onPreviewReadyChange={setIsWebPreviewReady}
                                        onCompileErrorFixRequest={handleCompileErrorFixRequest}
                                        onBackendReady={() => {
                                            // Keep mode pinned to webcontainer, but do not auto-reconnect.
                                            // Auto-incrementing reconnectKey here causes a reconnect loop
                                            // immediately after the iframe becomes visible.
                                            setPreviewMode("webcontainer");
                                        }}
                                        onRequestRebuild={() => void handleRefresh(true)}
                                        reloadToken={refreshKey}
                                        applyToken={applyCompleteKey}
                                        restartToken={localRestartKey}
                                        reconnectToken={reconnectKey}
                                        forceFreshStart={forceFreshStartKey.current}
                                        pollingConfig={generationEver ? { maxPollingRetries: 480, maxContainerNotFound: 10 } : undefined}
                                    />
                                </div>
                            ) : previewSrc ? (
                                <iframe
                                    title="App preview"
                                    src={previewSrc}
                                    className="w-full h-full"
                                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
                                    referrerPolicy="no-referrer"
                                />
                            ) : (
                                <div className="h-full w-full flex items-center justify-center">
                                    <div className="max-w-md w-full p-6 text-center">
                                        <div className="text-lg font-semibold mb-2">Preview</div>
                                        <div className="text-sm text-gray-600 mb-4">
                                            {autoPreviewPhase === "connecting"
                                                ? "Connect Vercel to load your preview."
                                                : autoPreviewPhase === "enabling-bypass"
                                                    ? "Configuring secure preview access…"
                                                    : autoPreviewPhase === "building"
                                                        ? `Building preview…${autoPreviewAttempt ? ` (attempt ${autoPreviewAttempt})` : ""}`
                                                        : autoPreviewPhase === "loading"
                                                            ? "Loading preview…"
                                                            : autoPreviewPhase === "error"
                                                                ? "Could not load preview."
                                                                : "Preparing preview…"}
                                        </div>

                                        {(autoPreviewError || previewError) ? (
                                            <div className="mb-3 text-sm text-red-600">
                                                {autoPreviewError || previewError}
                                            </div>
                                        ) : null}

                                        {autoPreviewPhase === "error" && autoPreviewBypassUnsupported ? (
                                            <div className="mb-4 w-full text-left">
                                                <div className="text-xs text-gray-600 mb-2">
                                                    If you create a Protection Bypass token in Vercel, paste it here to enable iframe embedding.
                                                </div>
                                                <div className="flex gap-2">
                                                    <input
                                                        value={vercelProtectionBypassDraft}
                                                        onChange={(e) => setVercelProtectionBypassDraft(e.target.value)}
                                                        placeholder="Vercel bypass token"
                                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                                                    />
                                                    <button
                                                        onClick={() => void saveVercelProtectionBypass()}
                                                        disabled={savingVercelProtectionBypass}
                                                        className="px-4 py-2 bg-gray-900 text-white rounded-full hover:bg-black disabled:opacity-50"
                                                    >
                                                        {savingVercelProtectionBypass ? "Saving…" : "Save"}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : null}

                                        <div className="flex flex-col gap-2 items-center">
                                            {protectedPreviewUrl ? (
                                                <button
                                                    onClick={() => window.open(protectedPreviewUrl, "_blank", "noopener,noreferrer")}
                                                    className="px-4 py-2 border border-gray-300 rounded-full hover:bg-gray-50"
                                                >
                                                    Open preview in new tab
                                                </button>
                                            ) : null}

                                            <button
                                                onClick={() => {
                                                    setPreviewMode("webcontainer");
                                                    setAutoPreviewError(null);
                                                }}
                                                className="px-4 py-2 border border-gray-300 rounded-full hover:bg-gray-50"
                                            >
                                                Use embedded local preview
                                            </button>

                                            <button
                                                onClick={() => {
                                                    if (autoPreviewBypassUnsupported && protectedPreviewUrl) {
                                                        window.open(protectedPreviewUrl, "_blank", "noopener,noreferrer");
                                                        return;
                                                    }
                                                    if (autoPreviewPhase === "connecting") {
                                                        startVercelOAuthForPreview();
                                                        return;
                                                    }
                                                    setPreviewMode("vercel");
                                                    void runAutoPreviewSequence({ force: true });
                                                }}
                                                disabled={
                                                    isPreviewBuilding ||
                                                    autoPreviewPhase === "building" ||
                                                    autoPreviewPhase === "enabling-bypass" ||
                                                    autoPreviewPhase === "loading"
                                                }
                                                className="px-4 py-2 bg-[#F55F2A] text-xs font-semibold text-white rounded-full hover:bg-[#E04E1B] disabled:opacity-50"
                                            >
                                                {autoPreviewBypassUnsupported && protectedPreviewUrl
                                                    ? "Open preview"
                                                    : autoPreviewPhase === "connecting"
                                                    ? (vercelConnectOpening ? "Opening Vercel…" : "Connect Vercel")
                                                    : autoPreviewPhase === "building" ||
                                                        autoPreviewPhase === "enabling-bypass" ||
                                                        autoPreviewPhase === "loading"
                                                        ? "Working…"
                                                        : "Retry"}
                                            </button>

                                            {autoPreviewPhase === "connecting" ? (
                                                <div className="text-xs text-gray-500">
                                                    Preview requires Vercel. We’ll continue automatically after you connect.
                                                </div>
                                            ) : null}

                                            {(vercelDeploymentProtectionSettingsUrl || vercelSecuritySettingsUrl) ? (
                                                <button
                                                    onClick={() =>
                                                        window.open(
                                                            vercelDeploymentProtectionSettingsUrl || vercelSecuritySettingsUrl || "https://vercel.com/dashboard",
                                                            "_blank",
                                                            "noopener,noreferrer",
                                                        )
                                                    }
                                                    className="text-xs text-gray-600 underline"
                                                >
                                                    Open Vercel protection settings
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Mobile bottom tabs: keep preview in focus */}
                <div className="md:hidden border-t bg-white px-2 py-2">
                    <div role="tablist" aria-label="Builder tabs" className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mobileTab === "app"}
                            onClick={() => {
                                setMobileTab("app");
                                setMobileControlsOpen(false);
                            }}
                            className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${
                                mobileTab === "app"
                                    ? "bg-[#F55F2A] text-white border-[#F55F2A]"
                                    : "bg-white text-neutral-800 border-neutral-300"
                            }`}
                            title="App"
                        >
                            <Monitor className="h-4 w-4" />
                            <span>Preview</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mobileTab === "prompt"}
                            onClick={() => {
                                setMobileTab("prompt");
                                setMobileControlsOpen(false);
                            }}
                            className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${
                                mobileTab === "prompt"
                                    ? "bg-[#F55F2A] text-white border-[#F55F2A]"
                                    : "bg-white text-neutral-800 border-neutral-300"
                            }`}
                            title="Prompt"
                        >
                            <MessageSquare className="h-4 w-4" />
                            <span>Prompt</span>
                        </button>
                    </div>
                </div>

                {/* Mobile controls sheet */}
                {mobileControlsOpen ? (
                    <div
                        className="md:hidden fixed inset-0 z-[17500] bg-black/40 backdrop-blur-[1px] flex items-end"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Controls"
                        onClick={() => setMobileControlsOpen(false)}
                    >
                        <div
                            className="w-full rounded-t-2xl bg-white border border-neutral-200 shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-4 border-b flex items-center justify-between">
                                <div className="min-w-0">
                                    <div className="font-semibold text-neutral-900">Controls</div>
                                    <div className="text-[11px] text-neutral-600 truncate">
                                        {app?.name || "Untitled Project"}
                                    </div>
                                </div>
                                <button
                                    onClick={() => setMobileControlsOpen(false)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700"
                                    title="Close"
                                    aria-label="Close controls"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="p-4 space-y-2">
                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] font-semibold text-neutral-800">
                                    <span
                                        className={`mr-2 inline-block h-2 w-2 rounded-full ${
                                            isPreviewBuilding
                                                ? "bg-amber-500"
                                                : isRefreshing
                                                  ? "bg-blue-500"
                                                  : isWebPreviewReady
                                                    ? "bg-green-500"
                                                    : "bg-neutral-400"
                                        }`}
                                        aria-hidden="true"
                                    />
                                    Machine: {isPreviewBuilding ? "Starting" : isRefreshing ? "Refreshing" : isWebPreviewReady ? "Ready" : "Idle"}
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => {
                                            setMobileControlsOpen(false);
                                            void handleSave(true);
                                        }}
                                        disabled={isSaving}
                                        className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold bg-[#F55F2A] text-white disabled:opacity-60"
                                        title="Save"
                                    >
                                        <Upload className="h-4 w-4" />
                                        <span>{isSaving ? "Saving…" : "Save"}</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setMobileControlsOpen(false);
                                            handleReconnect();
                                        }}
                                        disabled={isRefreshing || isPreviewBuilding}
                                        className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800 disabled:opacity-60"
                                        title="Refresh machine"
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                        <span>Refresh</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setMobileControlsOpen(false);
                                            void handleRefresh(true);
                                        }}
                                        disabled={isPreviewBuilding || isRefreshing}
                                        className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800 disabled:opacity-60"
                                        title="Rebuild machine"
                                    >
                                        <RefreshCw className="h-4 w-4" />
                                        <span>Rebuild</span>
                                    </button>

                                    <button
                                        onClick={() => void openDatabaseConnect()}
                                        className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800"
                                        title={supabaseConnected && (supabaseProjectName || supabaseProjectRef) ? `Connected to: ${supabaseProjectName || supabaseProjectRef}` : supabaseConnected ? "Open Supabase" : "Connect Database"}
                                    >
                                        <Database className="h-4 w-4 shrink-0" />
                                        {supabaseConnected && (supabaseProjectName || supabaseProjectRef) ? (
                                            <span className="flex flex-col items-start leading-tight">
                                                <span className="text-[10px] uppercase tracking-wide opacity-60">Database</span>
                                                <span className="max-w-[140px] truncate">{supabaseProjectName || supabaseProjectRef}</span>
                                            </span>
                                        ) : (
                                            <span>{supabaseConnected ? "Database" : "Connect DB"}</span>
                                        )}
                                    </button>
                                </div>

                                {supabaseConnected ? (
                                    <button
                                        onClick={() => {
                                            setMobileControlsOpen(false);
                                            void disconnectSupabase();
                                        }}
                                        className="w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-red-200 bg-white text-red-700"
                                        title="Disconnect database"
                                    >
                                        <X className="h-4 w-4" />
                                        <span>Disconnect DB</span>
                                    </button>
                                ) : null}

                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={handlePickFavicon}
                                        disabled={faviconUploading}
                                        className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800 disabled:opacity-60"
                                        title="Upload favicon"
                                    >
                                        <span>{faviconUploading ? "Uploading…" : "Upload favicon"}</span>
                                    </button>
                                    {faviconUrl ? (
                                        <button
                                            type="button"
                                            onClick={() => window.open(faviconUrl, "_blank", "noopener,noreferrer")}
                                            className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800"
                                            title="View favicon"
                                        >
                                            <span>View favicon</span>
                                        </button>
                                    ) : (
                                        <div />
                                    )}
                                </div>

                                {lastDeployLiveUrl ? (
                                    <button
                                        onClick={() => window.open(lastDeployLiveUrl, "_blank", "noopener,noreferrer")}
                                        className="w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800"
                                        title="Open live deployment"
                                    >
                                        <Rocket className="h-4 w-4" />
                                        <span>View live</span>
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}

                {vercelConnectOpen && (
                    <div className="fixed inset-0 z-[17000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="w-full max-w-md rounded-xl bg-white shadow-lg border border-neutral-200 overflow-hidden">
                            <div className="p-4 border-b bg-gradient-to-b from-gray-50 to-white flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <div className="font-semibold text-neutral-900">Connect Vercel</div>
                                    <div className="text-[11px] text-neutral-600">Unlock production-style previews and deploys.</div>
                                </div>
                                <button
                                    onClick={() => {
                                        setVercelConnectOpen(false);
                                        setVercelConnectOpening(false);
                                    }}
                                    className="p-2 hover:bg-gray-200 rounded transition-colors"
                                    title="Close"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="p-4">
                                <div className="text-sm text-gray-700 mb-3">
                                    Required to build previews and deploy your app live.
                                </div>

                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600">
                                    <span className="font-semibold text-neutral-800">Status:</span>{" "}
                                    {isVercelChecking
                                        ? "Checking connection…"
                                        : vercelConnectOpening
                                            ? "Opening Vercel…"
                                            : isVercelConnected
                                                ? "Connected. You can build a preview now."
                                                : "Not connected yet."}
                                </div>

                                <div className="mt-3 flex gap-2">
                                    <button
                                        onClick={startVercelOAuthForPreview}
                                        disabled={isVercelChecking || vercelConnectOpening}
                                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#F55F2A] text-xs font-semibold text-white rounded-full hover:opacity-90 disabled:opacity-50"
                                    >
                                        {(isVercelChecking || vercelConnectOpening) ? (
                                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                                        ) : null}
                                        {vercelConnectOpening
                                            ? "Opening Vercel…"
                                            : isVercelChecking
                                                ? "Checking…"
                                                : "Connect Vercel"}
                                    </button>
                                    <button
                                        onClick={async () => {
                                            await refreshVercelStatus();
                                            setVercelConnectOpening(false);
                                        }}
                                        className="px-4 py-2 rounded-full text-sm border border-neutral-200 hover:bg-neutral-50"
                                        title="Re-check connection"
                                    >
                                        I already connected
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
