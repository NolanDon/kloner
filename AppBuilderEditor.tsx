// src/components/AppBuilderEditor.tsx
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import { Folder, File, Upload, X, RefreshCw, MessageSquare, Code, Edit3, Check, RotateCcw } from "lucide-react";
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
    const isDevEnv = process.env.NODE_ENV === "development";
    const { user } = useAuth();
    const { showConfirm, showAlert } = useModal();
    const [app, setApp] = useState<AppData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentFile, setCurrentFile] = useState<string | null>(null);
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [code, setCode] = useState<string>("");
    const [refreshKey, setRefreshKey] = useState(0);
    const [localRestartKey, setLocalRestartKey] = useState(0);
    const [reconnectKey, setReconnectKey] = useState(0);
    const [uiUpdatingToken, setUiUpdatingToken] = useState(0);
    const [uiUpdatingCancelToken, setUiUpdatingCancelToken] = useState(0);
    const [forceFreshStart, setForceFreshStart] = useState(false);
    const forceFreshStartRef = useRef(false);
    const forceFreshStartKey = useRef(0);
    const [viewMode, setViewMode] = useState<"ai" | "code">("ai"); // Default to AI chat
    const [isRenaming, setIsRenaming] = useState(false);
    const [tempName, setTempName] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isPreviewRestarting, setIsPreviewRestarting] = useState(false);
    const [previewRestartError, setPreviewRestartError] = useState<string | null>(null);
    const [isDevApplyTesting, setIsDevApplyTesting] = useState(false);
    const [devHmrDebug, setDevHmrDebug] = useState<
        | null
        | {
              chosenRoot: string;
              routerType: "app" | "pages" | "unknown";
              appliedPath: string;
              inspectWsUpgrades: number | null;
              inspectLastWsUrl: string | null;
              lastApplyRequestId: string | null;
              lastApplyWrote: number | null;
              lastApplyPaths: string[];
              notes: string[];
          }
    >(null);
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
    const [deployChoiceError, setDeployChoiceError] = useState<string | null>(null);
    const [lastDeployLiveUrl, setLastDeployLiveUrl] = useState<string | null>(null);
    const [showDeploySuccess, setShowDeploySuccess] = useState(false);
    const [leftPanelWidth, setLeftPanelWidth] = useState(500); // Default wider AI chat panel
    const [isResizing, setIsResizing] = useState(false);
    const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const restartDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const restartInFlightRef = useRef(false);
    const restartQueuedRef = useRef(false);
    const restartQueuedInteractiveRef = useRef(false);

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

    const rebuildLocalPreview = useCallback(async (forceFresh: boolean = false) => {
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

    const triggerPreviewRebuild = useCallback(
        async ({ silent }: { silent: boolean }) => {
            if (!appId) return;

            if (restartInFlightRef.current) {
                restartQueuedRef.current = true;
                if (!silent) restartQueuedInteractiveRef.current = true;
                return;
            }

            restartInFlightRef.current = true;
            if (!silent) {
                setIsPreviewRestarting(true);
                setPreviewRestartError(null);
            }

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
                const payload: any = { appId };
                if (storedCode) payload.code = storedCode;

                // Switch the preview into the "UI updating" state as the rebuild request goes out.
                setUiUpdatingToken((k) => k + 1);

                const res = await fetch(`/api/app-builder/${appId}/preview/rebuild`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    body: JSON.stringify(payload),
                });

                const data = await res.json().catch(() => ({} as any));
                if (!res.ok || !(data as any)?.ok) {
                    // If there is no active preview yet, fall back to creating/starting.
                    if (res.status === 404 || res.status === 409) {
                        if (!silent) setPreviewRestartError(null);
                        setUiUpdatingCancelToken((k) => k + 1);
                        await rebuildLocalPreview(true);
                        return;
                    }

                    const msg = String((data as any)?.error || `Rebuild failed (HTTP ${res.status})`);
                    if (!silent) throw Object.assign(new Error(msg), { status: res.status });
                    setUiUpdatingCancelToken((k) => k + 1);
                    return;
                }

                // Persist returned code so WebContainerRunner can poll status reliably.
                const code = String((data as any)?.code || storedCode || "");
                if (!code) {
                    if (!silent) throw new Error("Rebuild succeeded but no preview code was returned.");
                    setUiUpdatingCancelToken((k) => k + 1);
                    return;
                }

                try {
                    localStorage.setItem(
                        `webcontainer_${appId}`,
                        JSON.stringify({ code, timestamp: Date.now() })
                    );
                } catch {
                    // ignore
                }

                // No extra polling here: WebContainerRunner will poll /api/webcontainer-status
                // and reload the iframe when the machine becomes reachable.
            } catch (err: any) {
                if (!silent) {
                    const msg = String(err?.message || "Failed to rebuild preview.");
                    setPreviewRestartError(msg);
                    setUiUpdatingCancelToken((k) => k + 1);
                } else {
                    // Silent (AI-triggered) rebuild failed; stop the "UI updating" loader.
                    setUiUpdatingCancelToken((k) => k + 1);
                }
            } finally {
                if (!silent) setIsPreviewRestarting(false);
                restartInFlightRef.current = false;

                if (restartQueuedRef.current) {
                    const nextInteractive = restartQueuedInteractiveRef.current;
                    restartQueuedRef.current = false;
                    restartQueuedInteractiveRef.current = false;
                    void triggerPreviewRebuild({ silent: !nextInteractive });
                }
            }
        },
        [appId, rebuildLocalPreview]
    );

    const restartPreviewNow = useCallback(async () => {
        await triggerPreviewRebuild({ silent: false });
    }, [triggerPreviewRebuild]);

    const rebuildPreviewInPlaceSilently = useCallback(async () => {
        await triggerPreviewRebuild({ silent: true });
    }, [triggerPreviewRebuild]);

    const schedulePreviewRestart = useCallback(() => {
        if (!appId) return;
        if (restartDebounceRef.current) {
            clearTimeout(restartDebounceRef.current);
            restartDebounceRef.current = null;
        }

        // Debounce rebuilds so rapid saves collapse into one.
        // Use the same WebContainerRunner logic that runs when the user opens
        // "Customize App": it will connect to an existing container when possible
        // and otherwise spin up a fresh one with the latest file snapshot.
        restartDebounceRef.current = setTimeout(() => {
            restartDebounceRef.current = null;
            void rebuildPreviewInPlaceSilently();
        }, 900);
    }, [appId, rebuildPreviewInPlaceSilently]);

    const changeRequiresRebuild = useCallback((path: string) => {
        const p = String(path || "").trim().toLowerCase();
        if (!p) return false;

        // Dependency / build config files typically require a full rebuild.
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
                        await rebuildLocalPreview(false);

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

                const requiresRebuild = Boolean((data as any)?.requiresRebuild || (data as any)?.requires_rebuild);
                if (requiresRebuild) {
                    const now = Date.now();
                    if (interactive || now - lastApplyAlertAtRef.current > 15000) {
                        lastApplyAlertAtRef.current = now;
                        void showAlert(
                            "This change needs a full rebuild to take effect. Click Rebuild when you’re ready.",
                            "Rebuild needed",
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
        [appId, rebuildLocalPreview, showAlert]
    );

    const runDevApplyTest = useCallback(async () => {
        if (!appId) return;
        if (!isDevEnv) return;
        if (isDevApplyTesting) return;

        setIsDevApplyTesting(true);
        try {
            // Prefer sending the locally stored container code when available.
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

            const summarizeInspect = (idata: any) => {
                const proxy = (idata as any)?.proxy || {};
                const wsUpgrades = typeof proxy?.wsUpgrades === "number" ? proxy.wsUpgrades : null;
                const lastWsUrl = typeof proxy?.lastWs?.url === "string" ? proxy.lastWs.url : null;
                const lastApply = proxy?.lastApply || null;
                const lastApplyRequestId = typeof lastApply?.requestId === "string" ? lastApply.requestId : null;
                const lastApplyWrote = typeof lastApply?.wrote === "number" ? lastApply.wrote : null;
                const lastApplyPaths = Array.isArray(lastApply?.files)
                    ? (lastApply.files as any[])
                          .map((f) => String((f as any)?.path || "").trim())
                          .filter(Boolean)
                          .slice(0, 8)
                    : [];
                return { wsUpgrades, lastWsUrl, lastApplyRequestId, lastApplyWrote, lastApplyPaths };
            };

            const chooseNextRootFromLayout = (layout: any) => {
                const l = layout || {};
                if (l?.hasSrcAppDir === true) return { root: "src/app", routerType: "app" as const };
                if (l?.hasAppDir === true) return { root: "app", routerType: "app" as const };
                if (l?.hasSrcPagesDir === true) return { root: "src/pages", routerType: "pages" as const };
                if (l?.hasPagesDir === true) return { root: "pages", routerType: "pages" as const };
                return { root: "", routerType: "unknown" as const };
            };

            const fallbackExistingEntry = () => {
                const candidates = [
                    { path: "src/app/page.tsx", routerType: "app" as const, root: "src/app" },
                    { path: "app/page.tsx", routerType: "app" as const, root: "app" },
                    { path: "src/pages/index.tsx", routerType: "pages" as const, root: "src/pages" },
                    { path: "pages/index.tsx", routerType: "pages" as const, root: "pages" },
                ];
                for (const c of candidates) {
                    if (app?.files && (app.files as any)[c.path]) return c;
                }
                return null;
            };

            // 1) Inspect first: determine the Next.js layout + proxy readiness.
            const inspectBase = `/api/previews/inspect?appId=${encodeURIComponent(appId)}`;
            const inspectUrl = storedCode ? `${inspectBase}&code=${encodeURIComponent(storedCode)}` : inspectBase;

            const inspectStartedAt = Date.now();
            let inspectOk = false;
            let inspectData: any = null;

            while (Date.now() - inspectStartedAt < 30_000) {
                const ires = await fetch(inspectUrl, {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store",
                });
                const idata = await ires.json().catch(() => ({} as any));
                inspectData = idata;
                const proxy = (idata as any)?.proxy || {};
                const layout = proxy?.layout || {};
                console.log("[dev-hmr-test][inspect]", {
                    status: ires.status,
                    ok: ires.ok,
                    code: (idata as any)?.code,
                    reason: (idata as any)?.reason,
                    wsUpgrades: proxy?.wsUpgrades,
                    lastWsUrl: proxy?.lastWs?.url,
                    layout: {
                        hasSrcAppDir: layout?.hasSrcAppDir,
                        hasAppDir: layout?.hasAppDir,
                        hasSrcPagesDir: layout?.hasSrcPagesDir,
                        hasPagesDir: layout?.hasPagesDir,
                    },
                });

                if (ires.ok && (idata as any)?.ok) {
                    inspectOk = true;
                    break;
                }

                const hubCode = String((idata as any)?.code || "").toUpperCase();

                if (ires.status === 404 && hubCode === "NO_ACTIVE_PREVIEW") {
                    const confirmed = await showConfirm(
                        "No active preview exists yet. Start/reconnect the preview now?",
                        "Test HMR",
                    );
                    if (confirmed) {
                        await rebuildLocalPreview(false);
                        void showAlert(
                            "Preview start/reconnect triggered. Re-run Test HMR once the preview is up.",
                            "Test HMR",
                        );
                    }
                    return;
                }

                if (ires.status === 409 && hubCode === "MACHINE_NOT_READY") {
                    // Keep polling inspect while the machine boots.
                    await sleep(2000);
                    continue;
                }

                if (ires.status === 409 && hubCode === "PROXY_NOT_READY") {
                    const confirmed = await showConfirm(
                        "Preview proxy isn’t ready. Restart the preview proxy now?",
                        "Test HMR",
                    );
                    if (!confirmed) return;

                    const restartCode =
                        storedCode ||
                        String((idata as any)?.previewCode || (idata as any)?.preview_code || (idata as any)?.code || "").trim();

                    if (!restartCode) {
                        void showAlert(
                            "Cannot restart without a preview code. Reconnect the preview first, then retry.",
                            "Test HMR",
                        );
                        return;
                    }

                    const rres = await fetch("/api/previews/restart", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                        },
                        credentials: "include",
                        cache: "no-store",
                        body: JSON.stringify({ appId, code: restartCode }),
                    });
                    const rdata = await rres.json().catch(() => ({} as any));
                    console.log("[dev-hmr-test][restart]", { status: rres.status, ok: rres.ok, data: rdata });

                    if (!rres.ok || !(rdata as any)?.ok) {
                        const msg = String((rdata as any)?.error || `Restart failed (HTTP ${rres.status})`);
                        void showAlert(`${msg}\n\n(Details logged in console)`, "Test HMR");
                        return;
                    }

                    // After restart, loop back to inspect polling.
                    await sleep(2000);
                    continue;
                }

                // Unknown inspect failure.
                const msg = String((idata as any)?.error || `Inspect failed (HTTP ${ires.status})`);
                void showAlert(`${msg}\n\n(Details logged in console)`, "Test HMR");
                return;
            }

            if (!inspectOk) {
                const msg = String((inspectData as any)?.error || "Inspect timed out waiting for preview readiness.");
                void showAlert(`${msg}\n\n(Details logged in console)`, "Test HMR");
                return;
            }

            // 2) Choose exactly one Next.js root from inspect.proxy.layout.
            const proxy = (inspectData as any)?.proxy || {};
            const layout = proxy?.layout || {};
            let { root: chosenRoot, routerType } = chooseNextRootFromLayout(layout);
            const notes: string[] = [];

            if (!chosenRoot || routerType === "unknown") {
                const fallback = fallbackExistingEntry();
                if (!fallback) {
                    void showAlert(
                        "Could not determine the Next.js router root from inspect (no app/pages dirs detected). Open a standard Next.js project template or start the preview, then retry.",
                        "Test HMR",
                    );
                    return;
                }
                chosenRoot = fallback.root;
                routerType = fallback.routerType;
                notes.push(`inspect.layout missing; fell back to existing entry: ${fallback.path}`);
            }

            // 3) Generate exactly one route file based on routerType.
            const stamp = new Date().toISOString();
            const bannerColor = Math.floor(Math.random() * 360);
            const testUi = `export default function KlonerHmrTestPage() {\n  return (\n    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'hsl(${bannerColor} 90% 55%)', color: '#0b0b0c', fontFamily: 'ui-sans-serif, system-ui, -apple-system' }}>\n      <div style={{ maxWidth: 900, padding: 48, background: 'rgba(255,255,255,0.92)', borderRadius: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>\n        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.75 }}>Kloner Next.js HMR Smoke Test</div>\n        <h1 style={{ marginTop: 10, fontSize: 44, lineHeight: 1.05 }}>Hello from HMR</h1>\n        <p style={{ marginTop: 14, fontSize: 18, lineHeight: 1.5 }}>If HMR is connected, this page updates without a refresh.</p>\n        <pre style={{ marginTop: 18, padding: 16, background: '#0b0b0c', color: '#f5f5f5', borderRadius: 14, overflowX: 'auto' }}>{` + "`" + `appId=${appId}\\nupdatedAt=${stamp}\\ncolorHue=${bannerColor}` + "`" + `}</pre>\n        <p style={{ marginTop: 14, fontSize: 14, opacity: 0.75 }}>Click “Test HMR” again: timestamp + hue should change via hot update.</p>\n      </div>\n    </div>\n  );\n}\n`;
            const fileContent = `// Auto-generated by Kloner HMR test\n${testUi}`;

            // Hard test: overwrite the *main* entry page so you can’t miss it.
            // App Router: <root>/page.tsx
            // Pages Router: <root>/index.tsx
            const appliedPath =
                routerType === "app" ? `${chosenRoot}/page.tsx` : `${chosenRoot}/index.tsx`;

            setDevHmrDebug({
                chosenRoot,
                routerType,
                appliedPath,
                inspectWsUpgrades: null,
                inspectLastWsUrl: null,
                lastApplyRequestId: null,
                lastApplyWrote: null,
                lastApplyPaths: [],
                notes,
            });

            const payload: any = { appId, files: [{ path: appliedPath, content: fileContent }] };
            if (storedCode) payload.code = storedCode;

            // Retry a few times on 409 (machine busy/booting) without restarting anything.
            let lastRes: Response | null = null;
            let lastData: any = null;
            for (let attempt = 0; attempt < 5; attempt += 1) {
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
                lastRes = res;
                lastData = data;
                console.log("[dev-hmr-test][apply]", {
                    attempt: attempt + 1,
                    status: res.status,
                    ok: res.ok,
                    code: (data as any)?.code,
                    reason: (data as any)?.reason,
                    needsRebuild: (data as any)?.needsRebuild ?? (data as any)?.requiresRebuild ?? (data as any)?.requires_rebuild,
                    debug: (data as any)?.__debug,
                });

                if (res.ok && (data as any)?.ok) break;
                if (res.status !== 409) break;
                await sleep(800 + attempt * 400);
            }

            const res = lastRes;
            const data = lastData;
            if (!res) throw new Error("Apply test failed: no response");

            if (!res.ok || !(data as any)?.ok) {
                if (res.status === 404) {
                    const confirmed = await showConfirm(
                        "No active preview was found for this app. Start/reconnect the preview now? (This should not delete an existing machine.)",
                        "Apply test",
                    );
                    if (confirmed) {
                        await rebuildLocalPreview(false);
                        void showAlert(
                            "Preview start/reconnect triggered. Click the test button again once the preview is running.",
                            "Apply test",
                        );
                    }
                    return;
                }

                if (res.status === 409) {
                    void showAlert(
                        "Preview returned 409. Check console for hub response (+ __debug) — this is usually MACHINE_NOT_READY or PROXY_NOT_READY.",
                        "Test HMR",
                    );
                    return;
                }

                const msg = String((data as any)?.error || `Apply failed (HTTP ${res.status})`);
                void showAlert(`${msg}\n\n(Details logged in console)`, "Test HMR");
                return;
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

            const requiresRebuild = Boolean((data as any)?.requiresRebuild || (data as any)?.requires_rebuild);
            if (requiresRebuild) {
                void showAlert(
                    "Apply succeeded, but the backend says this needs a full rebuild to take effect.",
                    "Test HMR",
                );
            } else {
                // 4) Re-inspect to validate HMR websocket + lastApply.
                await sleep(1500);
                const i2res = await fetch(inspectUrl, { method: "GET", credentials: "include", cache: "no-store" });
                const i2 = await i2res.json().catch(() => ({} as any));
                const s2 = summarizeInspect(i2);
                const wsOk =
                    typeof s2.wsUpgrades === "number" &&
                    s2.wsUpgrades > 0 &&
                    typeof s2.lastWsUrl === "string" &&
                    s2.lastWsUrl.toLowerCase().includes("webpack-hmr");

                const appliedSeen = s2.lastApplyPaths.some((p) => p === appliedPath);

                setDevHmrDebug((prev) =>
                    prev
                        ? {
                              ...prev,
                              inspectWsUpgrades: s2.wsUpgrades,
                              inspectLastWsUrl: s2.lastWsUrl,
                              lastApplyRequestId: s2.lastApplyRequestId,
                              lastApplyWrote: s2.lastApplyWrote,
                              lastApplyPaths: s2.lastApplyPaths,
                              notes: [...(prev.notes || []), ...(appliedSeen ? [] : ["lastApply did not list the expected file path"])],
                          }
                        : prev,
                );

                if (!wsOk) {
                    const extra = `wsUpgrades=${s2.wsUpgrades ?? "?"}\nlastWs.url=${s2.lastWsUrl || "(none)"}`;
                    void showAlert(
                        `HMR websocket not connected; changes will not hot-update.\n\n${extra}\n\n(See the debug panel next to the button.)`,
                        "Test HMR",
                    );
                    return;
                }

                if (!appliedSeen) {
                    const extra = `lastApply.requestId=${s2.lastApplyRequestId || "(none)"}\nlastApply.wrote=${String(s2.lastApplyWrote ?? "(none)")}\npaths=${s2.lastApplyPaths.join(", ") || "(none)"}`;
                    void showAlert(
                        `Apply succeeded, but inspect.lastApply did not confirm the expected path.\n\n${extra}\n\n(See the debug panel next to the button.)`,
                        "Test HMR",
                    );
                    return;
                }

                void showAlert(
                    "Inspect OK + apply OK + HMR websocket connected. Click Test HMR again to see the timestamp/hue hot-update.",
                    "Test HMR",
                );
            }
        } catch (err: any) {
            console.error("[dev-apply-test] failed", err);
            void showAlert(err?.message || "Test HMR failed.", "Test HMR");
        } finally {
            setIsDevApplyTesting(false);
        }
    }, [appId, app?.files, isDevEnv, isDevApplyTesting, rebuildLocalPreview, showAlert, showConfirm]);

    const queuePreviewApply = useCallback(
        (changes: Array<{ path: string; content: string }>, { interactive }: { interactive: boolean }) => {
            if (!appId) return;
            if (!changes?.length) return;

            for (const c of changes) {
                const p = String(c?.path || "").trim();
                if (!p) continue;
                if (changeRequiresRebuild(p)) {
                    const now = Date.now();
                    if (interactive || now - lastApplyAlertAtRef.current > 15000) {
                        lastApplyAlertAtRef.current = now;
                        void showAlert(
                            "That file affects dependencies/build settings, so it needs a full rebuild. Click Rebuild when you’re ready.",
                            "Rebuild needed",
                        );
                    }
                    continue;
                }
                applyQueuedRef.current[p] = String(c?.content ?? "");
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
        [appId, changeRequiresRebuild, flushPreviewApply, showAlert]
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

            // If a preview URL exists already and we're not forcing a rebuild, just try to load it.
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
                    if (firebaseData && firebaseData.files) {
                        // Update local state immediately when Firebase changes
                        setApp(prevApp => {
                            if (!prevApp) return prevApp;
                            
                            // Check if generation status changed
                            const generationStatusChanged = prevApp.generationStatus !== firebaseData.generationStatus ||
                                                          prevApp.generationError !== firebaseData.generationError;
                            
                            // Only update if files or generation status actually changed to avoid unnecessary re-renders
                            const mergedFiles = mergeFilesPreferNewest(prevApp.files, firebaseData.files);
                            const filesChanged = !filesShallowEqualByContentAndTimestamp(prevApp.files, mergedFiles);
                            
                            if (filesChanged || generationStatusChanged) {
                                const updatedApp = {
                                    ...prevApp,
                                    files: mergedFiles,
                                    generationStatus: firebaseData.generationStatus,
                                    generationError: firebaseData.generationError,
                                    isDeployed: Boolean((firebaseData as any).isDeployed),
                                    productionUrl: (firebaseData as any).productionUrl || null,
                                    updatedAt: firebaseData.updatedAt
                                };

                                const nextLiveUrl = typeof (firebaseData as any).productionUrl === "string"
                                    ? (firebaseData as any).productionUrl.trim()
                                    : "";
                                setLastDeployLiveUrl(nextLiveUrl || null);
                                
                                // Update file tree if files changed
                                if (filesChanged) {
                                    buildFileTree(mergedFiles);
                                }
                                
                                // If the currently open file was modified, update the editor content.
                                // Use a ref so this listener doesn't resubscribe on every tab switch.
                                const openPath = currentFileRef.current;
                                if (openPath && (mergedFiles as any)[openPath]) {
                                    setCode((mergedFiles as any)[openPath].content);
                                }

                                // Trigger preview refresh ONLY when file content changed.
                                // (Generation status changes shouldn't spam iframe reloads.)
                                if (filesChanged) {
                                    queuePreviewReloadFromFirebase();
                                }
                                
                                return updatedApp;
                            }
                            
                            return prevApp;
                        });
                    }
                }
            },
            (error) => {
                console.error('Firebase listener error:', error);
            }
        );

        return () => unsubscribe();
    }, [appId, user?.uid, queuePreviewReloadFromFirebase]);

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
            setApp((prev) => (prev ? { ...prev, files: nextFiles } : null));

            if (currentFile) {
                const next = nextFiles[currentFile]?.content;
                if (typeof next === "string") setCode(next);
                else setCode("");
            }
        },
        [currentFile]
    );

    const saveFileToServer = useCallback(async (
        path: string,
        content: string,
        opts?: { afterSave?: "apply" | "rebuild" | "none"; interactive?: boolean }
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
            } else if (afterSave === "rebuild") {
                schedulePreviewRestart();
            }
            return true;
        } catch (err) {
            console.error("Auto-save failed", err);
            if (opts?.interactive) {
                void showAlert("Could not save your change. Please try again.", "Save failed");
            }
            return false;
        }
    }, [appId, queuePreviewApply, schedulePreviewRestart, showAlert]);

    const handleFileChangeFromContainer = useCallback((path: string, content: string) => {
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

        // Persist container-origin changes, but do not re-apply/rebuild (avoids loops).
        saveFileToServer(path, content, { afterSave: "none" });
    }, [currentFile, saveFileToServer]);

    const handleFileEditFromAI = useCallback((path: string, content: string) => {
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

        // Save to server, then live-apply (no rebuild).
        saveFileToServer(path, content, { afterSave: "apply" });
    }, [currentFile, saveFileToServer]);

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
            void rebuildLocalPreview(true).finally(() => {
                setTimeout(() => setIsRefreshing(false), 500);
            });
            return;
        }

        // Default refresh: rebuild in-place inside the existing machine.
        // Falls back to starting a fresh machine if no active preview exists.
        void restartPreviewNow().finally(() => {
            setTimeout(() => setIsRefreshing(false), 500);
        });
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
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
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

    if (app.generationStatus === "processing") {
        return (
            <div className="fixed inset-0 z-[16000] bg-black/70 backdrop-blur-sm flex items-center justify-center">
                <div className="bg-white rounded-lg p-8 max-w-md">
                    <div className="text-center">
                        <KlonerLoader />
                        <div className="text-gray-600 text-sm mt-4">
                            Generating your app... This may take a few minutes.
                        </div>
                    </div>
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
            <div className="h-full w-full bg-white flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                    <div className="flex items-center gap-3">
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
                    </div>
                    <div className="flex gap-2 items-center">
                        <button
                            onClick={() => void handleSave(true)}
                            disabled={isSaving || isPreviewRestarting}
                            className="px-4 py-2 bg-[#F55F2A] text-xs font-semibold text-white rounded hover:bg-[#E04E1B] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all  rounded-full"
                        >
                            <Upload className="w-4 h-4" />
                            {isSaving ? "Saving..." : isPreviewRestarting ? "Restarting…" : "Save"}
                        </button>
                        {isDevEnv ? (
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => void runDevApplyTest()}
                                    disabled={isDevApplyTesting || isSaving || isPreviewRestarting}
                                    className="px-4 py-2 bg-gray-900 text-xs font-semibold text-white rounded flex items-center gap-2 rounded-full hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Dev only: inspect Next.js layout, apply exactly one route file, and verify HMR websocket + lastApply"
                                >
                                    <Edit3 className="w-4 h-4" />
                                    {isDevApplyTesting ? "Testing…" : "Test HMR"}
                                </button>

                                {devHmrDebug ? (
                                    <div className="hidden lg:block max-w-[560px] px-3 py-2 rounded-2xl border border-black/10 bg-white/70 text-[11px] leading-snug">
                                        <div className="font-semibold text-black/80">HMR debug</div>
                                        <div className="text-black/60">root: {devHmrDebug.chosenRoot} ({devHmrDebug.routerType})</div>
                                        <div className="text-black/60">file: {devHmrDebug.appliedPath}</div>
                                        <div className="text-black/60">
                                            wsUpgrades: {devHmrDebug.inspectWsUpgrades ?? "?"}
                                            {devHmrDebug.inspectLastWsUrl
                                                ? ` • lastWs: ${devHmrDebug.inspectLastWsUrl}`
                                                : ""}
                                        </div>
                                        <div className="text-black/60">
                                            lastApply: {devHmrDebug.lastApplyRequestId || "(none)"} • wrote: {devHmrDebug.lastApplyWrote ?? "?"}
                                        </div>
                                        {devHmrDebug.lastApplyPaths?.length ? (
                                            <div className="text-black/50 truncate">
                                                files: {devHmrDebug.lastApplyPaths.join(" • ")}
                                            </div>
                                        ) : null}
                                        {devHmrDebug.notes?.length ? (
                                            <div className="text-black/50 truncate">notes: {devHmrDebug.notes.join(" • ")}</div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                        <button
                            onClick={handleReconnect}
                            disabled={isRefreshing || isPreviewRestarting || isPreviewBuilding}
                            className="px-4 py-2 bg-[#F55F2A] text-xs font-semibold text-white rounded flex items-center gap-2 rounded-full hover:bg-[#E04E1B] disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Reconnect to the existing machine without rebuilding"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Reconnect
                        </button>
                        <button
                            onClick={() => handleRefresh(true)}
                            disabled={isPreviewBuilding || isRefreshing || isPreviewRestarting}
                            className="px-4 py-2 bg-[#F55F2A] text-xs font-semibold text-white rounded flex items-center gap-2 rounded-full hover:bg-[#E04E1B]"
                            title="Delete current machine and start fresh"
                        >
                            <RefreshCw className="w-4 h-4" />
                            {isPreviewBuilding ? "Rebuilding…" : "Rebuild"}
                        </button>
                        <button
                            onClick={handleDeploy}
                            disabled={isDeploying}
                            className="px-4 py-2 bg-[#F55F2A] text-xs font-semibold text-white rounded hover:bg-[#E04E1B] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all  rounded-full"
                        >
                            <Upload className="w-4 h-4" />
                            {isDeploying ? "Deploying..." : "Deploy"}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-200 rounded transition-colors"
                            title="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {previewRestartError ? (
                    <div className="px-4 py-2 border-b bg-red-50 text-xs text-red-700">
                        <div className="max-w-[900px] truncate" title={previewRestartError}>
                            {previewRestartError}
                        </div>
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
                                    onServerRefresh={handleRefresh}
                                    onFilesReplace={handleFilesReplaceFromServer}
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
                                        files={app.files}
                                        onFileChange={handleFileChangeFromContainer}
                                        reloadToken={refreshKey}
                                        restartToken={localRestartKey}
                                        reconnectToken={reconnectKey}
                                        forceFreshStart={forceFreshStartKey.current}
                                        uiUpdatingToken={uiUpdatingToken}
                                        uiUpdatingCancelToken={uiUpdatingCancelToken}
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
                                        className="px-4 py-2 rounded-full border border-neutral-200 hover:bg-neutral-50"
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
