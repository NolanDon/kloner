// src/components/AppBuilderEditor.tsx
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import { Folder, File, Upload, X, RefreshCw, MessageSquare, Code, Check, RotateCcw, Database, Rocket } from "lucide-react";
import AIAgentChat from "./AIAgentChat";
import KlonerLoader from "./KlonerLoader";
import WebContainerRunner from "./WebContainerRunner";
import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import { useVercelIntegration } from "@/src/hooks/useVercelIntegration";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "@/src/hooks/useAuth";
import { useModal } from "@/components/ui/ModalContext";

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

export default function AppBuilderEditor({ appId, onClose, onDeploy }: {
    appId: string;
    onClose: () => void;
    onDeploy?: (app: { id: string; name: string }) => void;
}) {
    const { user } = useAuth();
    const { showConfirm, showAlert } = useModal();
    const [supabaseConnected, setSupabaseConnected] = useState<boolean | null>(null);
    const [supabaseProjectName, setSupabaseProjectName] = useState<string | null>(null);
    const [supabaseProjectRef, setSupabaseProjectRef] = useState<string | null>(null);
    const supabaseVerifyInFlightRef = useRef(false);
    const lastSupabaseVerifyAtRef = useRef(0);
    const supabaseConnectedRef = useRef<boolean | null>(null);

    useEffect(() => {
        supabaseConnectedRef.current = supabaseConnected;
    }, [supabaseConnected]);

        const refreshSupabaseStatusFromApi = useCallback(async (): Promise<boolean> => {
            try {
                const res = await fetch("/api/supabase/project-status", { cache: "no-store" });
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
                    body: JSON.stringify({ cleanupIfDeleted: true }),
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
                              : "Supabase is no longer connected. Please reconnect.";
                    void showAlert(msg, "Database");
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

        useEffect(() => {
            if (!user?.uid) {
                setSupabaseConnected(null);
                setSupabaseProjectName(null);
                setSupabaseProjectRef(null);
                return;
            }

            setSupabaseConnected(null);
            const integrationRef = doc(db, "kloner_users", user.uid, "integrations", "supabase");
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

            return () => unsub();
        }, [refreshSupabaseStatusFromApi, user?.uid, verifySupabaseConnection]);

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
                body: JSON.stringify({ confirm: "DISCONNECT" }),
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
    const [currentFile, setCurrentFile] = useState<string | null>(null);
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [code, setCode] = useState<string>("");
    const [refreshKey, setRefreshKey] = useState(0);
    const [localRestartKey, setLocalRestartKey] = useState(0);
    const [reconnectKey, setReconnectKey] = useState(0);
    const [isWebPreviewReady, setIsWebPreviewReady] = useState(false);
    const [agentCreditError, setAgentCreditError] = useState<string | null>(null);
    const lastConsumedAiCreditRequestIdRef = useRef<string | null>(null);
    const [forceFreshStart, setForceFreshStart] = useState(false);
    const forceFreshStartRef = useRef(false);
    const forceFreshStartKey = useRef(0);
    const [viewMode, setViewMode] = useState<"ai" | "code">("ai"); // Default to AI chat
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
    }, [app?.name]);

    const isGenerationProcessing = app?.generationStatus === "processing";
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

    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (allowNextNavigationRef.current) return;
            if (!getHasUnsavedChanges()) return;
            // Required for Chrome/Safari to show a confirmation dialog.
            e.preventDefault();
            e.returnValue = "";
        };

        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [getHasUnsavedChanges]);

    useEffect(() => {
        // In-app navigation guard for anchor clicks and back/forward.
        // This catches Next.js client-side navigations that won't trigger beforeunload.
        const confirmLeave = async (): Promise<boolean> => {
            if (allowNextNavigationRef.current) return true;
            if (!getHasUnsavedChanges()) return true;
            return await showConfirm(
                "You have unsaved changes that may be lost. Leave this page anyway?",
                "Unsaved changes",
            );
        };

        const onDocumentClickCapture = (e: MouseEvent) => {
            if (e.defaultPrevented) return;
            if (e.button !== 0) return; // left-click only
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (allowNextNavigationRef.current) return;
            if (!getHasUnsavedChanges()) return;

            const target = e.target as HTMLElement | null;
            const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
            if (!anchor) return;
            if (anchor.target && anchor.target !== "_self") return;
            const hrefAttr = (anchor.getAttribute("href") || "").trim();
            if (!hrefAttr || hrefAttr.startsWith("#")) return;

            // Prevent immediate navigation; we'll re-trigger if confirmed.
            e.preventDefault();
            e.stopPropagation();

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

        const onPopState = (e: PopStateEvent) => {
            if (allowNextNavigationRef.current) return;
            if (!getHasUnsavedChanges()) return;

            // We can't cancel popstate directly. Push state back to keep the user here,
            // then ask; if confirmed, go back again.
            if (!leaveGuardArmedRef.current) {
                try {
                    history.pushState({ __klonerLeaveGuard: true }, "", window.location.href);
                    leaveGuardArmedRef.current = true;
                } catch {
                    // ignore
                }
            } else {
                try {
                    history.pushState({ __klonerLeaveGuard: true }, "", window.location.href);
                } catch {
                    // ignore
                }
            }

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
            document.removeEventListener("click", onDocumentClickCapture, true);
            window.removeEventListener("popstate", onPopState);
        };
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

    async function fetchFreshCsrf(): Promise<string | null> {
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
    }

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

    // If we used a placeholder preview while generating, restart the machine with the real files
    // once generation completes.
    const lastGenStatusRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        const status = app?.generationStatus;
        const prev = lastGenStatusRef.current;
        lastGenStatusRef.current = status;

        if (prev === "processing" && status === "ready" && usedPlaceholderRef.current) {
            usedPlaceholderRef.current = false;
            void restartLocalPreview(true);
        }
    }, [app?.generationStatus, restartLocalPreview]);

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
        []
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

            const queued = applyQueuedRef.current;
            const paths = Object.keys(queued);
            if (paths.length === 0) return;

            applyQueuedRef.current = {};
            applyInFlightRef.current = true;
            applyRunAfterRef.current = false;

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
                const now = Date.now();
                const shouldAlert = interactive || now - lastApplyAlertAtRef.current > 15000;
                if (shouldAlert) {
                    lastApplyAlertAtRef.current = now;
                    void showAlert(err?.message || "Live update failed.", "Live update");
                }
            } finally {
                applyInFlightRef.current = false;
                if (applyRunAfterRef.current || Object.keys(applyQueuedRef.current).length > 0) {
                    applyRunAfterRef.current = false;
                    void flushPreviewApply({ interactive: false });
                }
            }
        },
        [appId, restartLocalPreview, showAlert]
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
                            "That file affects dependencies/build settings, so it can’t be hot-updated. Your change is saved; restart the preview to see it.",
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
        [appId, isVercelConnected, enableVercelProtectionBypassAutomatically],
    );

    // Load app data
    useEffect(() => {
        const loadApp = async () => {
            try {
                const res = await fetch(`/api/app-builder/${appId}/files`);
                if (!res.ok) {
                    if (res.status === 404) {
                        console.error('App not found, closing editor');
                        onClose();
                        return;
                    }
                    throw new Error(`Failed to load app: ${res.status} ${res.statusText}`);
                }
                const data = await res.json();
                setApp(data);
                const liveUrl = typeof data?.productionUrl === "string" ? data.productionUrl.trim() : "";
                setLastDeployLiveUrl(liveUrl || null);
                buildFileTree(data.files);
            } catch (err) {
                console.error('Error loading app:', err);
                // For network errors or server errors, don't close immediately
                // Show error state instead
                setError(err instanceof Error ? err.message : 'Failed to load app');
            } finally {
                setLoading(false);
            }
        };
        loadApp();
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

        return () => unsubscribe();
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

    const handleDeploy = () => {
        if (!app || isDeploying) return;

        const alreadyDeployed = Boolean(app.isDeployed) || Boolean(app.productionUrl);
        if (!alreadyDeployed) {
            if (onDeploy) {
                onDeploy({ id: app.id, name: app.name });
                return;
            }
            void showAlert("First deploy is handled in the dashboard deploy wizard.", "Deploy");
            return;
        }

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
            const res = await fetch(`/api/app-builder/${appId}/deploy`, {
                method: "POST",
                headers: csrfHeaders(csrf),
                credentials: "include",
            });

            const data = await res.json().catch(() => ({} as any));
            if (!res.ok || !data?.ok) {
                const msg = (data as any)?.error || `Deploy failed (HTTP ${res.status})`;
                throw new Error(msg);
            }

            const url = (data?.url || data?.previewUrl || "").toString().trim();
            if (!url) throw new Error("Deploy completed but no URL was returned.");

            setLastDeployLiveUrl(url);
            setShowDeploySuccess(true);
            setTimeout(() => setShowDeploySuccess(false), 3500);

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

    if (loading) {
        return (
            <KlonerLoader />
        );
    }

    if (error) {
        return (
            <div className="fixed inset-0 z-[16000] bg-black/70 backdrop-blur-sm flex items-center justify-center">
                <div className="bg-white rounded-lg p-8 max-w-md">
                    <div className="text-center">
                        <div className="text-red-600 text-lg font-semibold mb-2">Failed to load app</div>
                        <div className="text-gray-600 text-sm mb-4">{error}</div>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-dark transition-colors"
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

    if (app.generationStatus === "error") {
        return (
            <div className="fixed inset-0 z-[16000] bg-black/70 backdrop-blur-sm flex items-center justify-center">
                <div className="bg-white rounded-lg p-8 max-w-md">
                    <div className="text-center">
                        <div className="text-red-600 text-lg font-semibold mb-2">Generation Failed</div>
                        <div className="text-gray-600 text-sm mb-4">
                            {app.generationError || "An error occurred while generating your app."}
                        </div>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                            Retry
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
                    <div className="flex min-w-0 items-center gap-3">
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
                            <div className="relative group">
                                <h1
                                    className="text-xl font-semibold cursor-pointer hover:text-purple-600 transition-colors"
                                    onClick={startRename}
                                    title="Click to rename"
                                >
                                    {app?.name || "Untitled Project"}
                                </h1>
                            </div>
                        )}

                        {/* Project controls (moved off top-right) */}
                        <div className="ml-2 flex items-center gap-2">
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
                                          ? "bg-green-100 text-green-900 hover:bg-green-200"
                                          : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                                }`}
                                title={
                                    supabaseConnected
                                        ? `Database connected${supabaseProjectName ? `: ${supabaseProjectName}` : ""}`
                                        : "Connect your database"
                                }
                            >
                                <Database className="w-4 h-4" />
                                {supabaseConnected === null ? (
                                    <span>DB: Verifying</span>
                                ) : supabaseConnected ? (
                                    <span>DB: Connected</span>
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
                        {/* Top-right reserved for machine + deploy (PreviewEditorV2-style) */}
                        <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-2 py-1 shadow-md">
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
                            onClick={onClose}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-md transition hover:bg-neutral-50"
                            title="Close"
                            aria-label="Close editor"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {isGenerationProcessing && previewMode === "webcontainer" ? (
                    <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900">
                        Generating your app. Preview will update automatically when it's ready.
                    </div>
                ) : null}

                <div className="flex flex-1 min-h-0" data-app-builder-container>
                    {/* Left Panel - AI Chat and Controls */}
                    <div 
                        className="flex flex-col border-r bg-gray-50 flex-shrink-0 min-h-0 overflow-hidden" 
                        style={{ width: `${leftPanelWidth}px` }}
                    >
                        {/* View Mode Toggle */}
                        <div className="p-3 border-b">
                            <div className="flex gap-2">
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
                                />
                            ) : (
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
                            )}
                        </div>
                    </div>

                    {/* Resize Handle */}
                    <div
                        className="w-1 bg-gray-300 hover:bg-gray-400 cursor-col-resize transition-colors flex-shrink-0"
                        onMouseDown={() => setIsResizing(true)}
                        title="Drag to resize panels"
                    />

                    {/* Right Panel - Browser-like App View */}
                    <div className="flex-1 flex flex-col min-h-0">
                        {/* Browser Chrome */}
                        <div className="bg-gray-100 border-b px-4 py-2 flex items-center gap-2">
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
                                </div>
                            ) : null}

                            {showDeploySuccess ? (
                                <div className="ml-auto text-xs font-semibold text-emerald-700 flex items-center gap-1">
                                    <span className="inline-block animate-pulse">🎉</span>
                                    Deployed
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
                                        reloadToken={refreshKey}
                                        restartToken={localRestartKey}
                                        reconnectToken={reconnectKey}
                                        forceFreshStart={forceFreshStartKey.current}
                                        pollingConfig={generationEver ? { maxPollingRetries: 90, maxContainerNotFound: 10 } : undefined}
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
