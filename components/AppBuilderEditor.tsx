// src/components/AppBuilderEditor.tsx
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import { Folder, File, Play, Upload, X, RefreshCw, MessageSquare, Code, Edit3, Check, RotateCcw } from "lucide-react";
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

function csrfHeaders(csrf: unknown): HeadersInit | undefined {
    if (typeof csrf === "string" && csrf.trim()) {
        return { "x-csrf": csrf };
    }
    return undefined;
}

function addCacheBust(url: string, token: string | number): string {
    try {
        const u = new URL(url);
        u.searchParams.set("t", String(token));
        return u.toString();
    } catch {
        const suffix = url.includes("?") ? "&" : "?";
        return `${url}${suffix}t=${encodeURIComponent(String(token))}`;
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
    const [app, setApp] = useState<AppData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentFile, setCurrentFile] = useState<string | null>(null);
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [code, setCode] = useState<string>("");
    const [refreshKey, setRefreshKey] = useState(0);
    const [localRestartKey, setLocalRestartKey] = useState(0);
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
    const [deployChoiceOpen, setDeployChoiceOpen] = useState(false);
    const [deployChoiceBusy, setDeployChoiceBusy] = useState<"preview" | "live" | null>(null);
    const [deployChoiceError, setDeployChoiceError] = useState<string | null>(null);
    const [lastDeployPreviewUrl, setLastDeployPreviewUrl] = useState<string | null>(null);
    const [lastDeployLiveUrl, setLastDeployLiveUrl] = useState<string | null>(null);
    const [leftPanelWidth, setLeftPanelWidth] = useState(500); // Default wider AI chat panel
    const [isResizing, setIsResizing] = useState(false);
    const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
                            const filesChanged = JSON.stringify(prevApp.files) !== JSON.stringify(firebaseData.files);
                            
                            if (filesChanged || generationStatusChanged) {
                                console.log('Firebase data updated, refreshing UI immediately');
                                const updatedApp = {
                                    ...prevApp,
                                    files: firebaseData.files,
                                    generationStatus: firebaseData.generationStatus,
                                    generationError: firebaseData.generationError,
                                    updatedAt: firebaseData.updatedAt
                                };
                                
                                // Update file tree if files changed
                                if (filesChanged) {
                                    buildFileTree(firebaseData.files);
                                }
                                
                                // If current file was modified, update the editor content
                                if (currentFile && firebaseData.files[currentFile]) {
                                    setCode(firebaseData.files[currentFile].content);
                                }

                                // Trigger WebContainer refresh to show updated content in iframe
                                setRefreshKey((k) => k + 1);
                                
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
    }, [appId, user?.uid, currentFile]);

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
            handleSave();
        }, 1000);
    };

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

        // Auto-save to server
        saveFileToServer(path, content);
    }, [currentFile]);

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

        // Save to server
        saveFileToServer(path, content);
    }, [currentFile]);

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

    const saveFileToServer = useCallback(async (path: string, content: string) => {
        try {
            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/update-file`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ path, content }),
            });
            if (!res.ok) throw new Error("Failed to save");
        } catch (err) {
            console.error("Auto-save failed", err);
        }
    }, [appId]);

    const handleSave = async () => {
        if (!currentFile || !app || isSaving) return;

        setIsSaving(true);
        try {
            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/update-file`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ path: currentFile, content: code }),
            });
            if (!res.ok) throw new Error("Failed to save");
            // Update local state
            setApp((prev) => prev ? {
                ...prev,
                files: {
                    ...prev.files,
                    [currentFile]: { content: code, lastModified: Date.now() },
                },
            } : null);
        } catch (err) {
            console.error("Save failed", err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeploy = () => {
        if (!app || isDeploying) return;

        // Preserve existing behavior when a parent provides an alternate deploy flow.
        if (onDeploy) {
            onDeploy({ id: app.id, name: app.name });
            return;
        }

        setDeployChoiceError(null);
        setDeployChoiceOpen(true);
    };

    const runVercelDeploy = useCallback(async (target: "preview" | "live") => {
        if (!appId) return;
        if (deployChoiceBusy) return;

        setIsDeploying(true);
        setDeployChoiceBusy(target);
        setDeployChoiceError(null);

        try {
            // Ensure Vercel is connected before attempting either deploy.
            if (!isVercelConnected) {
                setVercelConnectOpen(true);
                throw new Error("Vercel is not connected yet.");
            }

            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const endpoint = target === "live" ? "deploy" : "preview";
            const res = await fetch(`/api/app-builder/${appId}/${endpoint}`, {
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

            if (target === "live") setLastDeployLiveUrl(url);
            else setLastDeployPreviewUrl(url);

            // Keep a copy in app state for convenience (even though embedded preview is local now).
            if (target === "preview") {
                setApp((prev) => (prev ? { ...prev, previewUrl: url } : prev));
            }

            return;
        } catch (err: any) {
            setDeployChoiceError(err?.message || "Deploy failed.");
        } finally {
            setDeployChoiceBusy(null);
            // Keep deploy disabled for longer to prevent spam
            setTimeout(() => setIsDeploying(false), 5000);
        }
    }, [appId, deployChoiceBusy, isVercelConnected]);

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
        void rebuildLocalPreview(forceFresh).finally(() => {
            setTimeout(() => setIsRefreshing(false), 500);
        });
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
                            onClick={handleSave}
                            disabled={isSaving}
                            className="px-4 py-2 bg-[#F55F2A] text-white rounded hover:bg-[#E04E1B] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all  rounded-full"
                        >
                            <Upload className="w-4 h-4" />
                            {isSaving ? "Saving..." : "Save"}
                        </button>
                        <button
                            onClick={() => handleRefresh(true)}
                            className="px-4 py-2 bg-[#F55F2A] text-white rounded flex items-center gap-2 rounded-full hover:bg-[#E04E1B]"
                            title="Delete current machine and start fresh"
                        >
                            <RefreshCw className="w-4 h-4" />
                            {isPreviewBuilding ? "Rebuilding…" : "Rebuild"}
                        </button>
                        <button
                            onClick={handleDeploy}
                            disabled={isDeploying}
                            className="px-4 py-2 bg-[#F55F2A] text-white rounded hover:bg-[#E04E1B] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all  rounded-full"
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

                <div className="flex h-full" data-app-builder-container>
                    {/* Left Panel - AI Chat and Controls */}
                    <div 
                        className="flex flex-col border-r bg-gray-50 flex-shrink-0 max-h-full overflow-hidden" 
                        style={{ width: `${leftPanelWidth}px` }}
                    >
                        {/* View Mode Toggle */}
                        <div className="p-3 border-b">
                            <div className="flex bg-white rounded-lg p-1 shadow-sm">
                                <button
                                    onClick={() => setViewMode("ai")}
                                    className={`flex-1 px-2 py-1 rounded text-xs flex items-center justify-center gap-1 ${
                                        viewMode === "ai"
                                            ? "bg-[#F55F2A] text-white"
                                            : "text-gray-600 hover:bg-gray-100"
                                    }`}
                                >
                                    <MessageSquare className="w-3 h-3" />
                                    AI
                                </button>
                                <button
                                    onClick={() => setViewMode("code")}
                                    className={`flex-1 px-2 py-1 rounded text-xs flex items-center justify-center gap-1 ${
                                        viewMode === "code"
                                            ? "bg-[#F55F2A] text-white"
                                            : "text-gray-600 hover:bg-gray-100"
                                    }`}
                                >
                                    <Code className="w-3 h-3" />
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
                    <div className="flex-1 flex flex-col">
                        {/* Browser Chrome */}
                        <div className="bg-gray-100 border-b px-4 py-2 flex items-center gap-2">
                            <div className="flex gap-1">
                                <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                                <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                                <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                            </div>
                            {(lastDeployPreviewUrl || lastDeployLiveUrl) ? (
                                <div className="ml-3 flex items-center gap-2 text-xs">
                                    {lastDeployPreviewUrl ? (
                                        <button
                                            onClick={() => window.open(lastDeployPreviewUrl, "_blank", "noopener,noreferrer")}
                                            className="px-3 py-1 rounded-full border border-gray-300 hover:bg-gray-50"
                                            title="Open Vercel preview deployment"
                                        >
                                            View preview
                                        </button>
                                    ) : null}
                                    {lastDeployLiveUrl ? (
                                        <button
                                            onClick={() => window.open(lastDeployLiveUrl, "_blank", "noopener,noreferrer")}
                                            className="px-3 py-1 rounded-full border border-gray-300 hover:bg-gray-50"
                                            title="Open live deployment"
                                        >
                                            View live
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
                                        files={app.files}
                                        onFileChange={handleFileChangeFromContainer}
                                        reloadToken={refreshKey}
                                        restartToken={localRestartKey}
                                        forceFreshStart={forceFreshStartKey.current}
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
                                                className="px-4 py-2 bg-[#F55F2A] text-white rounded-full hover:bg-[#E04E1B] disabled:opacity-50"
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
                                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#F55F2A] text-white rounded-full hover:opacity-90 disabled:opacity-50"
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

                {deployChoiceOpen && !onDeploy && (
                    <div className="fixed inset-0 z-[17000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="w-full max-w-md rounded-xl bg-white shadow-lg border border-neutral-200 overflow-hidden">
                            <div className="p-4 border-b bg-gradient-to-b from-gray-50 to-white flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <div className="font-semibold text-neutral-900">Deploy</div>
                                    <div className="text-[11px] text-neutral-600">Choose preview or live deployment.</div>
                                </div>
                                <button
                                    onClick={() => {
                                        if (deployChoiceBusy) return;
                                        setDeployChoiceOpen(false);
                                        setDeployChoiceError(null);
                                    }}
                                    className="p-2 hover:bg-gray-200 rounded transition-colors"
                                    title="Close"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="p-4 space-y-3">
                                {deployChoiceError ? (
                                    <div className="text-sm text-red-600">{deployChoiceError}</div>
                                ) : null}

                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => void runVercelDeploy("preview")}
                                        disabled={!!deployChoiceBusy}
                                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50"
                                    >
                                        {deployChoiceBusy === "preview" ? (
                                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black/70" />
                                        ) : null}
                                        Deploy preview
                                    </button>

                                    <button
                                        onClick={() => void runVercelDeploy("live")}
                                        disabled={!!deployChoiceBusy}
                                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-[#F55F2A] text-white hover:bg-[#E04E1B] disabled:opacity-50"
                                    >
                                        {deployChoiceBusy === "live" ? (
                                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                        ) : null}
                                        Deploy live
                                    </button>
                                </div>

                                {(lastDeployPreviewUrl || lastDeployLiveUrl) ? (
                                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-700 space-y-1">
                                        <div className="font-semibold text-neutral-800">Latest links</div>
                                        {lastDeployPreviewUrl ? (
                                            <div>
                                                Preview:{" "}
                                                <button
                                                    onClick={() => window.open(lastDeployPreviewUrl, "_blank", "noopener,noreferrer")}
                                                    className="underline"
                                                >
                                                    Open
                                                </button>
                                            </div>
                                        ) : null}
                                        {lastDeployLiveUrl ? (
                                            <div>
                                                Live:{" "}
                                                <button
                                                    onClick={() => window.open(lastDeployLiveUrl, "_blank", "noopener,noreferrer")}
                                                    className="underline"
                                                >
                                                    Open
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}

                                <div className="text-[11px] text-neutral-600">
                                    Embedded preview is always local. Deploys create real Vercel URLs.
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
