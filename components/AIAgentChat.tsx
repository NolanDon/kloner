// src/components/AIAgentChat.tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, RotateCcw, Database, FileText, RefreshCw, X, AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import { useAuth } from "@/src/hooks/useAuth";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    type: "text" | "code" | "file-edit";
    restorePointId?: string;
    restoreActionLabel?: string;
    migrationProposalId?: string;
    migrationSql?: string;
    migrationDestructive?: boolean;
    migrationStatus?: "PENDING" | "APPLYING" | "APPLIED" | "FAILED";
};

type Checkpoint = {
    id: string;
    timestamp: Date;
    description: string;
    files: { [path: string]: string };
};

type DatabaseConnection = {
    id: string;
    name: string;
    type: string;
    host: string;
    port: number;
    database: string;
    status: "connected" | "disconnected" | "connecting";
};

type AIAgentChatProps = {
    appId: string;
    files: { [path: string]: { content: string; lastModified: number } };
    onFileEdit: (path: string, content: string, creditRequestId?: string) => void;
    onFilesReplace?: (files: { [path: string]: { content: string; lastModified: number } }) => void;
    onRestoreApplied?: (args: {
        previousFiles: { [path: string]: { content: string; lastModified: number } };
        restoredFiles: { [path: string]: { content: string; lastModified: number } };
    }) => void | Promise<void>;
    creditError?: string | null;
};

type RestorePointItem = {
    id: string;
    label: string;
    kept?: boolean;
    createdAt?: any;
    source?: string;
    paths?: string[];
    undoOf?: string | null;
};

export default function AIAgentChat({ appId, files, onFileEdit, onFilesReplace, onRestoreApplied, creditError }: AIAgentChatProps) {
    const { user } = useAuth();
    const AI_EDIT_COST = 5;
    // Supabase OAuth setup is safe to expose in production (still requires session + CSRF on the server).
    const allowDatabaseSetupUi = true;
    const [aiCreditsRemaining, setAiCreditsRemaining] = useState<number | null>(null);
   const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "assistant",
            content: "Welcome to your app builder! I'm here to help you create amazing applications. 🚀\n\nI can help you with:\n• Adding new features and pages\n• Styling and customizing your design\n• Moving and repositioning elements\n• Adding or removing images and visual assets\n• Updating colors, fonts, and layouts\n• Integrating APIs and external services\n• Fixing bugs and optimizing performance\n\nWhat would you like to build or improve today?",
            timestamp: new Date(),
            type: "text"
        }
    ]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);
    const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
    const [currentCheckpoint, setCurrentCheckpoint] = useState<string | null>(null);
    const [databaseConnections, setDatabaseConnections] = useState<DatabaseConnection[]>([]);
    const [restorePoints, setRestorePoints] = useState<RestorePointItem[]>([]);
    const [isRestoreBusy, setIsRestoreBusy] = useState(false);
    const [lastRestorePointId, setLastRestorePointId] = useState<string | null>(null);
    const [showDatabaseSetup, setShowDatabaseSetup] = useState(false);
    const [showSupabaseSetup, setShowSupabaseSetup] = useState(false);
    const [showSupabaseAdvanced, setShowSupabaseAdvanced] = useState(false);
    const [existingSupabaseProjectRef, setExistingSupabaseProjectRef] = useState("");
    const [existingSupabaseAnonKey, setExistingSupabaseAnonKey] = useState("");
    const [existingSupabaseServiceRoleKey, setExistingSupabaseServiceRoleKey] = useState("");
    const [applyingMigrationIds, setApplyingMigrationIds] = useState<Record<string, boolean>>({});
    const [showMigrationSqlByMessageId, setShowMigrationSqlByMessageId] = useState<Record<string, boolean>>({});
    const [migrationReviewMessageId, setMigrationReviewMessageId] = useState<string | null>(null);
    const [migrationAcknowledge, setMigrationAcknowledge] = useState(false);
    const [migrationConfirmText, setMigrationConfirmText] = useState("");
    const [migrationShowSqlInModal, setMigrationShowSqlInModal] = useState(false);

    useEffect(() => {
        if (allowDatabaseSetupUi) return;
        // Hard-disable any DB setup UI in production.
        setShowDatabaseSetup(false);
        setShowSupabaseSetup(false);
    }, [allowDatabaseSetupUi]);

    useEffect(() => {
        const onOpen = (ev: Event) => {
            if (!allowDatabaseSetupUi) return;
            const detail = (ev as CustomEvent<any>)?.detail || {};
            const provider = String(detail?.provider || "supabase").toLowerCase();
            if (provider !== "supabase") return;
            setShowDatabaseSetup(false);
            setShowSupabaseAdvanced(false);
            setShowSupabaseSetup(true);
        };

        window.addEventListener("kloner:open-db-connect", onOpen as EventListener);
        return () => window.removeEventListener("kloner:open-db-connect", onOpen as EventListener);
    }, [allowDatabaseSetupUi]);

    useEffect(() => {
        setIsHydrated(true);
    }, []);

    useEffect(() => {
        if (!user?.uid) return;
        const userRef = doc(db, "kloner_users", user.uid);
        const unsub = onSnapshot(
            userRef,
            (snap) => {
                const data = snap.exists() ? (snap.data() as any) : null;
                const bucket = data?.["credits.aiEdits"] || data?.credits?.aiEdits || null;
                const remaining = typeof bucket?.remaining === "number" ? bucket.remaining : null;
                setAiCreditsRemaining(Number.isFinite(remaining) ? remaining : null);
            },
            () => {
                // If Firestore read fails (rules/offline), don't block usage.
                setAiCreditsRemaining(null);
            }
        );
        return () => unsub();
    }, [user?.uid]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = useCallback(() => {
        // Use scrollIntoView as primary method
        setTimeout(() => {
            if (messagesEndRef.current) {
                messagesEndRef.current.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'end',
                    inline: 'nearest' 
                });
            }
        }, 0);
        
        // Fallback: also try setting scrollTop on the container
        setTimeout(() => {
            if (messagesEndRef.current) {
                const container = messagesEndRef.current.parentElement;
                if (container) {
                    container.scrollTop = container.scrollHeight;
                }
                
                // Also try scrollIntoView again as backup
                messagesEndRef.current.scrollIntoView({ 
                    behavior: 'auto', 
                    block: 'end' 
                });
            }
        }, 50);
    }, []);

    const loadedFromRemoteRef = useRef(false);
    const initialLoadCompletedRef = useRef(false);
    const lastSavedPayloadRef = useRef<string | null>(null);
    const debugChatIo = useCallback(() => {
        if (typeof window === "undefined") return false;
        try {
            return localStorage.getItem("kloner_debug_chat_io") === "1";
        } catch {
            return false;
        }
    }, []);

    const withCsrfHeaders = useCallback(async () => {
        // Always fetch a fresh CSRF token to avoid stale token issues
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
        } catch (error) {
            console.warn("Failed to fetch CSRF token:", error);
        }

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (csrf) headers["x-csrf"] = String(csrf);
        return headers;
    }, []);

    const bootstrapAppScope = useCallback(async (): Promise<boolean> => {
        // The app-scope cookie is issued by /api/app-builder/:appId/files.
        // It expires (30 min) and can be missing on fresh sessions, so we re-issue it here.
        try {
            await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/files`, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
            });
            return res.ok;
        } catch {
            return false;
        }
    }, [appId]);

    const fetchWithScopeRetry = useCallback(
        async (url: string, init: RequestInit, { retryLabel }: { retryLabel: string }): Promise<Response> => {
            const doFetch = () =>
                fetch(url, {
                    ...init,
                    credentials: "include",
                    cache: "no-store",
                });

            const res = await doFetch();
            if (res.status !== 403) return res;

            // If scope is missing/expired, re-issue and retry once.
            const data = await res.clone().json().catch(() => null);
            const code = String(data?.code || "").toUpperCase();
            const isScope = code === "MISSING_APP_SCOPE" || code === "INVALID_APP_SCOPE";
            if (!isScope) return res;

            const ok = await bootstrapAppScope();
            if (!ok) return res;

            const retryRes = await doFetch();
            if (retryRes.status === 403) {
                console.warn(`[AIAgentChat] ${retryLabel} still forbidden after scope bootstrap`);
            }
            return retryRes;
        },
        [bootstrapAppScope]
    );

    // Load chat history from server (firebase-admin) and migrate any legacy localStorage once.
    useEffect(() => {
        if (loadedFromRemoteRef.current) return;
        if (!user?.uid || !appId) return;

        let cancelled = false;
        (async () => {
            try {
                await ensureSessionAndCsrf().catch(() => null);
                const res = await fetch(`/api/app-builder/${appId}/ai-chat`, {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store",
                });
                if (cancelled) return;

                const data = res.ok ? await res.json().catch(() => null) : null;
                const stored = Array.isArray(data?.messages) ? data.messages : null;

                const toMessage = (m: any): Message | null => {
                    if (!m || typeof m !== "object") return null;
                    const id = typeof m.id === "string" ? m.id : "";
                    const role = m.role === "user" || m.role === "assistant" ? m.role : null;
                    const content = typeof m.content === "string" ? m.content : null;
                    const type = m.type === "text" || m.type === "code" || m.type === "file-edit" ? m.type : "text";
                    const ts = typeof m.timestampMs === "number" ? new Date(m.timestampMs) : (m.timestamp ? new Date(m.timestamp) : new Date());
                    if (!id || !role || content == null || Number.isNaN(ts.getTime())) return null;
                    return {
                        id,
                        role,
                        content,
                        type,
                        timestamp: ts,
                        restorePointId: typeof m.restorePointId === "string" ? m.restorePointId : undefined,
                        restoreActionLabel: typeof m.restoreActionLabel === "string" ? m.restoreActionLabel : undefined,
                    };
                };

                if (stored) {
                    const loaded = stored.map(toMessage).filter(Boolean) as Message[];
                    if (loaded.length) setMessages(loaded);
                    loadedFromRemoteRef.current = true;
                    return;
                }

                // No remote history yet; attempt a one-time migration from legacy localStorage
                if (typeof window !== "undefined") {
                    try {
                        const legacy = localStorage.getItem(`chat_history_${appId}`);
                        if (legacy) {
                            const parsed = JSON.parse(legacy);
                            if (Array.isArray(parsed)) {
                                const loaded = parsed
                                    .map((msg: any) => ({
                                        ...msg,
                                        timestamp: new Date(msg.timestamp),
                                    }))
                                    .filter((msg: any) => msg?.id && msg?.role && msg?.content !== undefined && msg?.timestamp instanceof Date)
                                    .map((msg: any) => ({
                                        id: String(msg.id),
                                        role: msg.role === "user" || msg.role === "assistant" ? msg.role : "user",
                                        content: String(msg.content ?? ""),
                                        timestamp: msg.timestamp as Date,
                                        type: msg.type === "code" || msg.type === "file-edit" ? msg.type : "text",
                                        restorePointId: typeof msg.restorePointId === "string" ? msg.restorePointId : undefined,
                                        restoreActionLabel: typeof msg.restoreActionLabel === "string" ? msg.restoreActionLabel : undefined,
                                    })) as Message[];

                                if (loaded.length) {
                                    setMessages(loaded);
                                    const headers = await withCsrfHeaders();
                                    await fetch(`/api/app-builder/${appId}/ai-chat`, {
                                        method: "POST",
                                        headers,
                                        credentials: "include",
                                        cache: "no-store",
                                        body: JSON.stringify({
                                            messages: loaded.map((m) => ({
                                                id: m.id,
                                                role: m.role,
                                                content: m.content,
                                                type: m.type,
                                                timestampMs: m.timestamp.getTime(),
                                                restorePointId: m.restorePointId ?? null,
                                                restoreActionLabel: m.restoreActionLabel ?? null,
                                            })),
                                        }),
                                    }).catch(() => null);
                                }
                            }
                        }
                    } catch {
                        // ignore migration errors
                    }

                    try {
                        localStorage.removeItem(`chat_history_${appId}`);
                    } catch {
                        // ignore
                    }
                }

                loadedFromRemoteRef.current = true;
            } catch (e) {
                // If server read fails, fall back to in-memory only.
                console.warn("Failed to load chat history", e);
                if (debugChatIo()) {
                    console.log("[AIAgentChat] chat load failed", {
                        appId,
                        uid: user?.uid || null,
                        path: `kloner_users/${user?.uid || "<no-uid>"}/kloner_apps/${appId}/ai_chat/default`,
                    });
                }
                loadedFromRemoteRef.current = true;
            } finally {
                // Allow saving after the first load attempt finishes.
                initialLoadCompletedRef.current = true;
                if (debugChatIo()) console.log("[AIAgentChat] chat load complete", { appId });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [appId, debugChatIo, user?.uid, withCsrfHeaders]);

    const fetchRestorePoints = useCallback(async () => {
        try {
            await ensureSessionAndCsrf().catch(() => null);
            const res = await fetchWithScopeRetry(
                `/api/app-builder/${appId}/restore-points`,
                { method: "GET" },
                { retryLabel: "fetch restore points" }
            );
            if (!res.ok) return;
            const data = await res.json().catch(() => null);
            if (data?.ok && Array.isArray(data.restorePoints)) {
                setRestorePoints(data.restorePoints);
            }
        } catch {
            // ignore
        }
    }, [appId, fetchWithScopeRetry]);

    const syncFilesFromServer = useCallback(async ({ applyToState = true }: { applyToState?: boolean } = {}) => {
        try {
            await ensureSessionAndCsrf().catch(() => null);
            const res = await fetchWithScopeRetry(
                `/api/app-builder/${appId}/files`,
                { method: "GET" },
                { retryLabel: "sync files" }
            );
            if (!res.ok) return null;
            const data = await res.json().catch(() => null);
            if (data?.files && typeof data.files === "object") {
                if (applyToState && onFilesReplace) onFilesReplace(data.files);
                return data.files as { [path: string]: { content: string; lastModified: number } };
            }
        } catch {
            // ignore
        }
        return null;
    }, [appId, fetchWithScopeRetry, onFilesReplace]);

    useEffect(() => {
        fetchRestorePoints();
    }, [fetchRestorePoints]);

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    const saveTimerRef = useRef<number | null>(null);
    // Save chat history via server (debounced)
    useEffect(() => {
        if (!isHydrated) return;
        if (!initialLoadCompletedRef.current) return;
        if (!user?.uid || !appId) return;

        if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = window.setTimeout(async () => {
            try {
                // Keep a reasonable tail to prevent doc bloat.
                const tailMax = 120;
                const base = messages.slice(-tailMax).map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    type: m.type,
                    timestampMs: m.timestamp.getTime(),
                    restorePointId: m.restorePointId ?? null,
                    restoreActionLabel: m.restoreActionLabel ?? null,
                }));

                const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
                const sizeBytes = (payload: any) => {
                    const raw = JSON.stringify(payload);
                    return encoder ? encoder.encode(raw).length : raw.length;
                };

                let payload = base;
                // Firestore doc limit is ~1MB. Keep a safe margin.
                const MAX_BYTES = 800_000;
                if (sizeBytes(payload) > MAX_BYTES) payload = base.slice(-60);
                if (sizeBytes(payload) > MAX_BYTES) payload = base.slice(-30);

                // Skip writes if nothing changed since last successful save.
                const raw = JSON.stringify(payload);
                if (lastSavedPayloadRef.current === raw) {
                    if (debugChatIo()) console.log("[AIAgentChat] chat save skipped (unchanged)", { appId });
                    return;
                }

                await ensureSessionAndCsrf().catch(() => null);
                const headers = await withCsrfHeaders();
                const res = await fetch(`/api/app-builder/${appId}/ai-chat`, {
                    method: "POST",
                    headers,
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify({ messages: payload }),
                });
                if (!res.ok) {
                    throw new Error(`Chat save failed: ${res.status}`);
                }

                lastSavedPayloadRef.current = raw;
                if (debugChatIo()) console.log("[AIAgentChat] chat saved", { appId, messages: payload.length });
            } catch (e) {
                // Non-fatal: chat still works, just won't persist.
                console.warn("Failed to save chat history", e);
                if (debugChatIo()) {
                    console.log("[AIAgentChat] chat save failed", {
                        appId,
                        uid: user?.uid || null,
                        path: `kloner_users/${user?.uid || "<no-uid>"}/kloner_apps/${appId}/ai_chat/default`,
                    });
                }
            }
        }, 750);

        return () => {
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };
    }, [appId, debugChatIo, isHydrated, messages, user?.uid, withCsrfHeaders]);

    const createCheckpoint = useCallback((description: string) => {
        const checkpointId = `checkpoint_${Date.now()}`;
        const checkpoint: Checkpoint = {
            id: checkpointId,
            timestamp: new Date(),
            description,
            files: Object.fromEntries(
                Object.entries(files).map(([path, file]) => [path, file.content])
            ),
        };
        setCheckpoints(prev => [...prev, checkpoint]);
        setCurrentCheckpoint(checkpointId);
    }, [files]);

    const handleDatabaseConnect = useCallback((connection: DatabaseConnection) => {
        setDatabaseConnections(prev => [...prev.filter(c => c.id !== connection.id), connection]);
    }, []);

    const handleDatabaseDisconnect = useCallback((id: string) => {
        setDatabaseConnections(prev => prev.filter(c => c.id !== id));
    }, []);

    const handleCreateSupabaseProject = useCallback(async () => {
        // Popups opened after an await are often blocked by browsers.
        // Open a blank tab/window synchronously (while we still have the click gesture),
        // then navigate it once we have the OAuth URL.
        let popup: Window | null = null;
        try {
            popup = window.open("about:blank", "_blank", "width=600,height=700");
        } catch {
            popup = null;
        }

        try {
            setShowSupabaseSetup(false);
            setMessages(prev => [...prev, {
                id: `creating_project_${Date.now()}`,
                role: "assistant",
                content: "🔄 **Creating your Supabase project...**\n\nRedirecting you to Supabase to authorize project creation. This will open in a new tab.",
                timestamp: new Date(),
                type: "text"
            }]);

            await ensureSessionAndCsrf().catch(() => null);
            const headers = await withCsrfHeaders();

            // Initiate OAuth flow
            const response = await fetch('/api/supabase/create-project', {
                method: 'POST',
                headers,
                credentials: "include",
                cache: "no-store",
                body: JSON.stringify({}),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({} as any));
                const message =
                    typeof error?.message === "string"
                        ? error.message
                        : response.status === 401 || response.status === 403
                        ? "Your session expired. Please refresh the page, log in again, and retry."
                        : "Supabase project creation isn’t configured yet. Ask the admin to set SUPABASE_CLIENT_ID + SUPABASE_CLIENT_SECRET, then retry.";
                throw new Error(message);
            }

            const { authUrl } = await response.json();

            // Navigate the already-opened popup if possible; otherwise fall back to a direct link.
            if (popup && !popup.closed) {
                try {
                    popup.location.href = authUrl;
                    popup.focus();
                } catch {
                    // If navigation is blocked for any reason, fall back to a direct link.
                    popup.close();
                    popup = null;
                }
            }

            if (!popup || popup.closed) {
                setMessages(prev => [...prev, {
                    id: `supabase_oauth_popup_blocked_${Date.now()}`,
                    role: "assistant",
                    content: `⚠️ **Your browser blocked the popup.**\n\nOpen this link to continue:\n${authUrl}\n\n(After approving, come back here and I’ll detect the connection.)`,
                    timestamp: new Date(),
                    type: "text"
                }]);
            }

            // Listen for the OAuth callback via window message or polling
            // We poll for completion and also listen for postMessage from the popup.
            let isDone = false;

            const onMessage = (event: MessageEvent) => {
                try {
                    if (event.origin !== window.location.origin) return;
                    const data: any = event.data;
                    if (!data || data.type !== "kloner:supabase-oauth-result") return;

                    isDone = true;
                    clearInterval(checkCompletion);
                    window.removeEventListener("message", onMessage);

                    if (data.ok) {
                        setMessages(prev => [...prev, {
                            id: `project_created_${Date.now()}`,
                            role: "assistant",
                            content: "✅ **Supabase project created successfully!**\n\nYour new database is ready. I’ve connected it and you can start asking for schema changes safely (propose → confirm → apply).",
                            timestamp: new Date(),
                            type: "text"
                        }]);
                    } else {
                        const details = typeof data.details === "string" ? data.details : "Supabase setup failed";
                        setMessages(prev => [...prev, {
                            id: `create_error_${Date.now()}`,
                            role: "assistant",
                            content: `❌ **Supabase setup failed**\n\n${details}`,
                            timestamp: new Date(),
                            type: "text"
                        }]);
                    }
                } catch {
                    // ignore
                }
            };

            window.addEventListener("message", onMessage);

            const checkCompletion = setInterval(async () => {
                try {
                    const statusResponse = await fetch('/api/supabase/project-status', {
                        method: 'GET',
                    });

                    if (statusResponse.ok) {
                        const status = await statusResponse.json();
                        if (status.completed && status.ok === false) {
                            isDone = true;
                            clearInterval(checkCompletion);
                            window.removeEventListener("message", onMessage);
                            setMessages(prev => [...prev, {
                                id: `create_error_${Date.now()}`,
                                role: "assistant",
                                content: `❌ **Supabase setup failed**\n\n${typeof status.error === "string" ? status.error : "Unknown error"}`,
                                timestamp: new Date(),
                                type: "text"
                            }]);
                            return;
                        }
                        if (status.completed) {
                            isDone = true;
                            clearInterval(checkCompletion);
                            window.removeEventListener("message", onMessage);
                            setMessages(prev => [...prev, {
                                id: `project_created_${Date.now()}`,
                                role: "assistant",
                                content: "✅ **Supabase project created successfully!**\n\nYour new database is ready. I've automatically connected it to your MCP server for AI-powered database assistance.\n\n**What I set up for you:**\n- Database with secure credentials\n- Authentication configured\n- Ready for schema creation\n\nYou can now ask me to create tables, add data, or help with any database tasks!",
                                timestamp: new Date(),
                                type: "text"
                            }]);
                            // Preview refresh is handled via HMR/apply; no rebuild refresh here.
                        }
                    }
                } catch (error) {
                    // Continue polling
                }
            }, 5000); // Check every 5 seconds

            // Stop polling after 5 minutes
            setTimeout(() => {
                if (isDone) return;
                clearInterval(checkCompletion);
                window.removeEventListener("message", onMessage);
            }, 5 * 60 * 1000);

        } catch (error) {
            if (popup && !popup.closed) {
                try {
                    popup.close();
                } catch {
                    // ignore
                }
            }
            console.error('Failed to create Supabase project:', error);
            setMessages(prev => [...prev, {
                id: `create_error_${Date.now()}`,
                role: "assistant",
                content: `❌ **Project creation failed**\n\n${error instanceof Error ? error.message : 'Unknown error occurred'}\n\nPlease try again or create a project manually at [supabase.com](https://supabase.com).`,
                timestamp: new Date(),
                type: "text"
            }]);
        }
    }, []);

    const handleConnectExistingSupabaseProject = useCallback(async () => {
        try {
            if (!user?.uid) throw new Error("Not signed in");

            const projectRef = existingSupabaseProjectRef.trim();
            const anonKey = existingSupabaseAnonKey.trim();
            const serviceRoleKey = existingSupabaseServiceRoleKey.trim();

            if (!projectRef) throw new Error("Please enter your Project Reference ID (or Supabase URL).");
            if (!anonKey) throw new Error("Please enter your Supabase anon key.");

            const headers = await withCsrfHeaders();

            const response = await fetch("/api/supabase/connect-existing", {
                method: "POST",
                headers,
                credentials: "include",
                cache: "no-store",
                body: JSON.stringify({
                    projectRef,
                    anonKey,
                    serviceRoleKey: serviceRoleKey || null,
                }),
            });

            const data = await response.json().catch(() => ({} as any));
            if (!response.ok || !data?.ok) {
                throw new Error(data?.error || `Failed to connect (HTTP ${response.status})`);
            }

            setShowSupabaseSetup(false);
            setShowSupabaseAdvanced(false);
            setExistingSupabaseProjectRef("");
            setExistingSupabaseAnonKey("");
            setExistingSupabaseServiceRoleKey("");

            setMessages((prev) => [
                ...prev,
                {
                    id: `supabase_connected_existing_${Date.now()}`,
                    role: "assistant",
                    content:
                        "✅ **Supabase connected**\n\nI saved your existing Supabase project connection.\n\nNote: manual connections don’t support one-click migrations via the Supabase Platform API. If you want the safe propose→confirm→apply DB workflow, use **Create New Supabase Project** (OAuth).",
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
        } catch (error) {
            console.error("Failed to connect existing Supabase project:", error);
            setMessages((prev) => [
                ...prev,
                {
                    id: `supabase_existing_connect_error_${Date.now()}`,
                    role: "assistant",
                    content: `❌ **Couldn’t connect Supabase**\n\n${error instanceof Error ? error.message : "Unknown error"}`,
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
        }
    }, [existingSupabaseAnonKey, existingSupabaseProjectRef, existingSupabaseServiceRoleKey, user?.uid, withCsrfHeaders]);

    const applyRestorePoint = useCallback(async (restoreId: string, statusMessage?: string) => {
        if (!restoreId || isRestoreBusy) return;
        setIsRestoreBusy(true);

        const previousFiles: { [path: string]: { content: string; lastModified: number } } = {};
        for (const [p, v] of Object.entries(files || {})) {
            if (v && typeof v.content === "string" && typeof v.lastModified === "number") {
                previousFiles[p] = { content: v.content, lastModified: v.lastModified };
            }
        }

        try {
            const headers = await withCsrfHeaders();
            const res = await fetchWithScopeRetry(
                `/api/app-builder/${appId}/restore-points/${restoreId}/apply`,
                { method: "POST", headers, body: JSON.stringify({}) },
                { retryLabel: "apply restore point" }
            );
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                throw new Error(data?.error || "Failed to apply restore point");
            }

            const newId = typeof data?.newRestorePointId === "string" ? data.newRestorePointId : null;
            if (newId) setLastRestorePointId(newId);

            setMessages(prev => [
                ...prev,
                {
                    id: `restore_${Date.now()}`,
                    role: "assistant",
                    content: `${statusMessage || "Applied restore point"}.` + (newId ? " (Redo available)" : ""),
                    timestamp: new Date(),
                    type: "text",
                    restorePointId: newId || undefined,
                    restoreActionLabel: newId ? "Redo" : undefined,
                },
            ]);

            const restoredFiles = await syncFilesFromServer({ applyToState: false });
            if (!restoredFiles) {
                throw new Error("Restore applied, but failed to fetch restored files.");
            }

            // Important ordering:
            // 1) Let the editor suppress its normal onFilesReplace auto-apply.
            // 2) Apply an explicit diff to the running webcontainer.
            // 3) Then replace editor state with restored files.
            try {
                await onRestoreApplied?.({ previousFiles, restoredFiles });
            } catch (e) {
                console.error("onRestoreApplied failed", e);
            }

            if (onFilesReplace) onFilesReplace(restoredFiles);

            await fetchRestorePoints();
        } catch (err) {
            console.error("Apply restore point failed", err);
            setMessages(prev => [
                ...prev,
                {
                    id: `restore_err_${Date.now()}`,
                    role: "assistant",
                    content: "Sorry — I couldn't apply that restore point.",
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
        } finally {
            setIsRestoreBusy(false);
        }
    }, [appId, fetchRestorePoints, fetchWithScopeRetry, files, isRestoreBusy, onFilesReplace, onRestoreApplied, syncFilesFromServer, withCsrfHeaders]);

    const getStatusMessageForAction = useCallback((label?: string) => {
        const v = (label || "").toLowerCase();
        if (v === "undo") return "Undid change";
        if (v === "redo") return "Redid change";
        return "Applied restore point";
    }, []);

    const keepRestorePoint = useCallback(async (restoreId: string) => {
        if (!restoreId || isRestoreBusy) return;
        setIsRestoreBusy(true);
        try {
            const headers = await withCsrfHeaders();
            const res = await fetchWithScopeRetry(
                `/api/app-builder/${appId}/restore-points/${restoreId}/keep`,
                { method: "POST", headers, body: JSON.stringify({}) },
                { retryLabel: "keep restore point" }
            );
            if (!res.ok) throw new Error("Failed to keep restore point");
            await fetchRestorePoints();
        } catch (err) {
            console.error("Keep restore point failed", err);
        } finally {
            setIsRestoreBusy(false);
        }
    }, [appId, fetchRestorePoints, fetchWithScopeRetry, isRestoreBusy, withCsrfHeaders]);

    const createManualRestorePoint = useCallback(async () => {
        if (isRestoreBusy) return;
        setIsRestoreBusy(true);
        try {
            const headers = await withCsrfHeaders();
            const res = await fetchWithScopeRetry(
                `/api/app-builder/${appId}/restore-points`,
                { method: "POST", headers, body: JSON.stringify({ label: "Manual restore point" }) },
                { retryLabel: "create restore point" }
            );
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to create restore point");
            const rid = typeof data?.restorePointId === "string" ? data.restorePointId : null;
            if (rid) setLastRestorePointId(rid);

            setMessages(prev => [
                ...prev,
                {
                    id: `manual_restore_${Date.now()}`,
                    role: "assistant",
                    content: "Saved a restore point.",
                    timestamp: new Date(),
                    type: "text",
                    restorePointId: rid || undefined,
                    restoreActionLabel: "Undo",
                },
            ]);

            await fetchRestorePoints();
        } catch (err) {
            console.error("Create restore point failed", err);
        } finally {
            setIsRestoreBusy(false);
        }
    }, [appId, fetchRestorePoints, fetchWithScopeRetry, isRestoreBusy, withCsrfHeaders]);

    const undoLastChange = useCallback(() => {
        if (lastRestorePointId) {
            applyRestorePoint(lastRestorePointId, "Undid last change");
            return;
        }
        if (checkpoints.length > 1) {
            const lastCheckpoint = checkpoints[checkpoints.length - 2];
            setCurrentCheckpoint(lastCheckpoint.id);
            Object.entries(lastCheckpoint.files).forEach(([path, content]) => {
                onFileEdit(path, content);
            });
            setCheckpoints(prev => prev.slice(0, -1));
        }
    }, [applyRestorePoint, checkpoints, lastRestorePointId, onFileEdit]);

    const sendMessage = async () => {
        if (!input.trim() || isLoading) return;

        // Special-case: applying a previously proposed migration.
        // This should not spend AI credits and should not hit /api/ai-agent.
        const applyMatch = input.trim().match(/^APPLY\s+([0-9a-fA-F-]{36})$/);
        if (applyMatch) {
            const proposalId = applyMatch[1];
            const userMessage: Message = {
                id: `user_${Date.now()}`,
                role: "user",
                content: input.trim(),
                timestamp: new Date(),
                type: "text",
            };

            setMessages((prev) => [...prev, userMessage]);
            setInput("");
            setIsLoading(true);

            try {
                const headers = await withCsrfHeaders();
                setApplyingMigrationIds((prev) => ({ ...prev, [proposalId]: true }));

                const res = await fetch("/api/supabase/migrations/apply", {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ proposalId, confirm: `APPLY ${proposalId}` }),
                });

                const json = await res.json().catch(() => ({} as any));

                if (!res.ok || json?.ok === false) {
                    const msg = typeof json?.error === "string" ? json.error : "Failed to apply migration.";
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `mig_fail_${Date.now()}`,
                            role: "assistant",
                            content: `Migration failed: ${msg}`,
                            timestamp: new Date(),
                            type: "text",
                            migrationProposalId: proposalId,
                            migrationStatus: "FAILED",
                        },
                    ]);
                    return;
                }

                setMessages((prev) => [
                    ...prev,
                    {
                        id: `mig_ok_${Date.now()}`,
                        role: "assistant",
                        content: "Migration applied.",
                        timestamp: new Date(),
                        type: "text",
                        migrationProposalId: proposalId,
                        migrationStatus: "APPLIED",
                    },
                ]);
            } catch (err) {
                console.error("Migration apply error:", err);
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `mig_err_${Date.now()}`,
                        role: "assistant",
                        content: "Sorry, I couldn’t apply that migration. Please try again.",
                        timestamp: new Date(),
                        type: "text",
                        migrationProposalId: proposalId,
                        migrationStatus: "FAILED",
                    },
                ]);
            } finally {
                setApplyingMigrationIds((prev) => {
                    const next = { ...prev };
                    delete next[proposalId];
                    return next;
                });
                setIsLoading(false);
            }
            return;
        }

        // If we can see the remaining balance and it's insufficient, block early.
        if (typeof aiCreditsRemaining === "number" && aiCreditsRemaining < AI_EDIT_COST) {
            const errorMessage: Message = {
                id: `error_${Date.now()}`,
                role: "assistant",
                content: "You have used all AI edit credits for this month.",
                timestamp: new Date(),
                type: "text",
            };
            setMessages((prev) => [...prev, errorMessage]);
            return;
        }

        const userMessage: Message = {
            id: `user_${Date.now()}`,
            role: "user",
            content: input,
            timestamp: new Date(),
            type: "text"
        };

        setMessages(prev => [...prev, userMessage]);
        setInput("");
        setIsLoading(true);

        try {
            const headers = await withCsrfHeaders();

            const res = await fetch("/api/ai-agent", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    message: input,
                    appId,
                    conversationHistory: [...messages.slice(-10), userMessage],
                    databaseConnections
                }),
            });

            if (!res.ok) throw new Error("Failed to get AI response");

            const data = await res.json();
            const aiMessage: Message = {
                id: `ai_${Date.now()}`,
                role: "assistant",
                content: data.response,
                timestamp: new Date(),
                type: "text"
            };

            setMessages(prev => [...prev, aiMessage]);

            // Handle database migrations (propose -> ask user -> apply)
            if (Array.isArray(data.dbMigrations) && data.dbMigrations.length > 0) {
                const headers2 = await withCsrfHeaders();
                for (const mig of data.dbMigrations as Array<any>) {
                    const sql = typeof mig?.sql === "string" ? mig.sql : "";
                    const messageText = typeof mig?.message === "string" ? mig.message : "Database schema change";
                    const destructive = Boolean(mig?.destructive);

                    if (!sql.trim()) continue;

                    const proposeRes = await fetch("/api/supabase/migrations/propose", {
                        method: "POST",
                        headers: headers2,
                        body: JSON.stringify({ sql, message: messageText, destructive }),
                    });

                    const proposeJson = await proposeRes.json().catch(() => ({} as any));
                    if (!proposeRes.ok || proposeJson?.ok === false) {
                        const msg = typeof proposeJson?.error === "string" ? proposeJson.error : "Failed to create migration proposal.";
                        if (msg.toLowerCase().includes("supabase is not connected")) {
                            setShowDatabaseSetup(true);
                            setMessages((prev) => [
                                ...prev,
                                {
                                    id: `mig_need_db_${Date.now()}`,
                                    role: "assistant",
                                    content:
                                        "I can’t update the database yet because it isn’t connected. " +
                                        "Please connect Supabase first (click \"Connect database\" in the editor header), then I’ll retry the database update.",
                                    timestamp: new Date(),
                                    type: "text",
                                },
                            ]);
                        }
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: `mig_prop_fail_${Date.now()}`,
                                role: "assistant",
                                content: `Couldn’t create a migration proposal: ${msg}`,
                                timestamp: new Date(),
                                type: "text",
                            },
                        ]);
                        continue;
                    }

                    const proposalId = String(proposeJson.proposalId || "");
                    const destructiveFinal = Boolean(proposeJson.destructive);

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `mig_prop_${Date.now()}`,
                            role: "assistant",
                            content:
                                `${messageText}\n\nI prepared a database update for this. ` +
                                `Please review it carefully and click “Review & Apply” below to continue. ` +
                                `If you’re unsure, don’t apply it — ask me to explain in plain English first.`,
                            timestamp: new Date(),
                            type: "text",
                            migrationProposalId: proposalId,
                            migrationSql: sql,
                            migrationDestructive: destructiveFinal,
                            migrationStatus: "PENDING",
                        },
                    ]);
                }
            }

            // Handle database setup request (dev-only)
            if (allowDatabaseSetupUi && data.setupDatabase) {
                setTimeout(() => {
                    setShowDatabaseSetup(true);
                }, 1000); // Small delay for better UX
            }

            // Handle file edits if any
            if (data.fileEdits && data.fileEdits.length > 0) {
                createCheckpoint(`AI edit: ${input.slice(0, 50)}...`);
                const creditRequestId =
                    (typeof data?.restorePointId === "string" && data.restorePointId) ||
                    `ai_agent_${appId}_${userMessage.id}`;

                data.fileEdits.forEach((edit: { path: string; content: string }) => {
                    onFileEdit(edit.path, edit.content, creditRequestId);
                });

                const rid = typeof data?.restorePointId === "string" ? data.restorePointId : null;
                if (rid) {
                    setLastRestorePointId(rid);
                    setMessages(prev => [
                        ...prev,
                        {
                            id: `rp_${Date.now()}`,
                            role: "assistant",
                            content: "Created a restore point for that edit.",
                            timestamp: new Date(),
                            type: "text",
                            restorePointId: rid,
                            restoreActionLabel: "Undo",
                        },
                    ]);
                    fetchRestorePoints();
                }
            }
        } catch (err) {
            console.error("AI chat error:", err);
            const errorMessage: Message = {
                id: `error_${Date.now()}`,
                role: "assistant",
                content: "Sorry, I encountered an error. Please try again.",
                timestamp: new Date(),
                type: "text"
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-gray-50 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b bg-white flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Bot className="w-5 h-6 text-accent" />
                    <h3 className="font-medium text-sm">Agent</h3>
                    {creditError ? (
                        <div className="ml-2 text-[11px] text-red-600 max-w-[220px] truncate" title={creditError}>
                            {creditError}
                        </div>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchRestorePoints}
                        className="p-1 hover:bg-gray-200 rounded"
                        title="Refresh restore points"
                        disabled={isRestoreBusy}
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={createManualRestorePoint}
                        className="p-1 hover:bg-gray-200 rounded"
                        title="Save restore point"
                        disabled={isRestoreBusy}
                    >
                        <FileText className="w-4 h-4" />
                    </button>
                    {(lastRestorePointId || checkpoints.length > 1) && (
                        <button
                            onClick={undoLastChange}
                            className="p-1 hover:bg-gray-200 rounded"
                            title="Undo last change"
                            disabled={isRestoreBusy}
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {restorePoints.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-medium text-gray-700">Recent restore points</div>
                            <button
                                onClick={fetchRestorePoints}
                                className="text-xs text-gray-600 hover:text-gray-900"
                                disabled={isRestoreBusy}
                            >
                                Refresh
                            </button>
                        </div>
                        <div className="mt-2 space-y-2">
                            {restorePoints.slice(0, 5).map((rp) => (
                                <div key={rp.id} className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-xs text-gray-800 truncate">{rp.label}</div>
                                        <div className="text-[11px] text-gray-500 truncate">
                                            {rp.id.slice(0, 8)}{rp.kept ? " • kept" : ""}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <button
                                            onClick={() => applyRestorePoint(rp.id, "Applied restore point")}
                                            disabled={isRestoreBusy}
                                            className="px-2 py-1 text-xs bg-gray-50 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                                        >
                                            Apply
                                        </button>
                                        <button
                                            onClick={() => keepRestorePoint(rp.id)}
                                            disabled={isRestoreBusy}
                                            className="px-2 py-1 text-xs bg-gray-50 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                                        >
                                            Keep
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                        <div
                            className={`max-w-[80%] rounded-lg p-3 ${
                                message.role === "user"
                                    ? "bg-purple-50 border border-purple-200 text-gray-900"
                                    : "bg-orange-50 border border-orange-200"
                            }`}
                        >
                            <div className="whitespace-pre-wrap break-words text-sm">{message.content}</div>

                            {message.migrationProposalId && message.migrationSql ? (
                                <div className="mt-3 space-y-2">
                                    <div className="rounded border border-gray-200 bg-white/70 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                                                    {message.migrationDestructive ? (
                                                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                                                    ) : null}
                                                    <span>
                                                        Database update {message.migrationDestructive ? "(risky)" : "(safe)"}
                                                    </span>
                                                </div>
                                                <div className="mt-0.5 text-[11px] text-gray-600">
                                                    {message.migrationProposalId.slice(0, 8)}
                                                    {message.migrationStatus === "APPLIED" ? " • applied" : ""}
                                                    {message.migrationStatus === "FAILED" ? " • failed" : ""}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setShowMigrationSqlByMessageId((prev) => ({
                                                            ...prev,
                                                            [message.id]: !prev[message.id],
                                                        }))
                                                    }
                                                    className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                                                    title="Show advanced SQL"
                                                >
                                                    {showMigrationSqlByMessageId[message.id] ? (
                                                        <span className="inline-flex items-center gap-1">
                                                            <ChevronUp className="h-3 w-3" /> Hide SQL
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1">
                                                            <ChevronDown className="h-3 w-3" /> Show SQL
                                                        </span>
                                                    )}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setMigrationReviewMessageId(message.id);
                                                        setMigrationAcknowledge(false);
                                                        setMigrationConfirmText("");
                                                        setMigrationShowSqlInModal(false);
                                                    }}
                                                    disabled={Boolean(message.migrationStatus === "APPLIED")}
                                                    className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                                    title={message.migrationDestructive ? "Review & apply (risky)" : "Review & apply"}
                                                >
                                                    {message.migrationStatus === "APPLIED" ? "Applied" : "Review & Apply"}
                                                </button>
                                            </div>
                                        </div>

                                        {showMigrationSqlByMessageId[message.id] ? (
                                            <pre className="mt-2 max-h-56 overflow-auto rounded bg-white border border-gray-200 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                                                {message.migrationSql}
                                            </pre>
                                        ) : (
                                            <div className="mt-2 text-[11px] text-gray-600">
                                                SQL is hidden by default to keep this non-technical.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : null}

                            {message.restorePointId && (
                                <div className="mt-2 flex items-center gap-2">
                                    <button
                                        onClick={() =>
                                            applyRestorePoint(
                                                message.restorePointId!,
                                                getStatusMessageForAction(message.restoreActionLabel)
                                            )
                                        }
                                        disabled={isRestoreBusy}
                                        className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                        title={message.restoreActionLabel || "Apply"}
                                    >
                                        {message.restoreActionLabel || "Apply"}
                                    </button>
                                    <button
                                        onClick={() => keepRestorePoint(message.restorePointId!)}
                                        disabled={isRestoreBusy}
                                        className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                        title="Keep (do not auto-trim)"
                                    >
                                        Keep
                                    </button>
                                    <span className="text-[11px] text-gray-500">
                                        {message.restorePointId.slice(0, 8)}
                                    </span>
                                </div>
                            )}
                            <div className="text-xs opacity-70 mt-2">
                                {isHydrated && message.timestamp.toLocaleTimeString()}
                            </div>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white border border-gray-200 rounded-lg p-3 max-w-[80%]">
                            <div className="flex items-center gap-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent"></div>
                                <span className="text-sm text-gray-600">Thinking...</span>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Database Connections */}
            {databaseConnections.length > 0 && (
                <div className="px-4 py-2 border-t bg-white flex-shrink-0">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Database className="w-4 h-4" />
                        <span>Connected databases:</span>
                        {databaseConnections.map((db) => (
                            <span key={db.id} className="bg-black/5 text-gray-800 px-2 py-1 rounded text-xs">
                                {db.name}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Database Setup */}
            {allowDatabaseSetupUi && showDatabaseSetup && (
                <div className="px-4 py-3 border-t bg-black/5 rounded-lg flex-shrink-0">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-[#F55F2A]" />
                            <span className="font-medium text-gray-900">Connect a Database</span>
                        </div>
                        <button
                            onClick={() => setShowDatabaseSetup(false)}
                            className="text-gray-600 hover:text-gray-900"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <p className="text-sm text-gray-700 mb-3">
                        Add a database connection to enable data persistence, user accounts, and dynamic content.
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                        <button
                            onClick={() => {
                                setShowSupabaseAdvanced(false);
                                setShowSupabaseSetup(true);
                            }}
                            className="flex items-center gap-3 px-4 py-3 bg-white rounded-lg text-sm hover:bg-black/5 transition-colors"
                        >
                            <div className="w-8 h-8 rounded-lg overflow-hidden bg-white flex items-center justify-center">
                                <img
                                    src="/images/supabase.webp"
                                    alt="Supabase"
                                    className="w-full h-full object-cover"
                                    draggable={false}
                                />
                            </div>
                            <div className="text-left">
                                <div className="font-semibold text-gray-900">Supabase</div>
                                <div className="text-xs text-gray-600">PostgreSQL with auth & real-time</div>
                            </div>
                        </button>
                    </div>
                </div>
            )}

            {/* Supabase Setup Modal */}
            {allowDatabaseSetupUi && showSupabaseSetup && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg overflow-hidden bg-white flex items-center justify-center">
                                    <img
                                        src="/images/supabase.webp"
                                        alt="Supabase"
                                        className="w-full h-full object-cover"
                                        draggable={false}
                                    />
                                </div>
                                <h3 className="text-lg font-semibold">Connect Database</h3>
                            </div>
                            <button
                                onClick={() => {
                                    setShowSupabaseSetup(false);
                                    setShowSupabaseAdvanced(false);
                                }}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="rounded-lg border border-black/10 bg-black/5 p-3">
                                <div className="text-sm font-semibold text-gray-900">Recommended</div>
                                <div className="text-sm text-gray-700 mt-1">
                                    Create a new Supabase project via OAuth. This is the safest setup and enables the guarded database migration flow.
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={handleCreateSupabaseProject}
                                    className="flex-1 bg-[#F55F2A] text-white py-2 px-4 rounded-full hover:bg-[#E04E1B] transition-colors font-semibold"
                                >
                                    Create New Supabase Project
                                </button>
                                <a
                                    href="https://supabase.com/dashboard"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 px-3 py-2 rounded-full hover:bg-black/5 text-sm text-gray-700 flex items-center gap-2"
                                >
                                    Dashboard <ExternalLink className="w-4 h-4" />
                                </a>
                            </div>

                            <button
                                onClick={() => setShowSupabaseAdvanced((v) => !v)}
                                className="w-full text-left px-3 py-2 rounded-md border border-black/10 hover:bg-black/5 text-sm text-gray-800 flex items-center justify-between"
                            >
                                <span className="font-semibold">Advanced options</span>
                                {showSupabaseAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>

                            {showSupabaseAdvanced ? (
                                <div className="space-y-3 rounded-lg border border-black/10 p-3">
                                    <div className="text-xs text-gray-600">
                                        Manual connections require pasting keys. Use only if you already have a Supabase project.
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Project Reference ID (or Supabase URL)
                                        </label>
                                        <input
                                            type="text"
                                            value={existingSupabaseProjectRef}
                                            onChange={(e) => setExistingSupabaseProjectRef(e.target.value)}
                                            placeholder="abcdefghijklmnopqrst  or  https://abcdefghijklmnopqrst.supabase.co"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#F55F2A]"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            In the URL: <span className="font-mono">https://&lt;project-ref&gt;.supabase.co</span>
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Anon Key</label>
                                        <input
                                            type="password"
                                            value={existingSupabaseAnonKey}
                                            onChange={(e) => setExistingSupabaseAnonKey(e.target.value)}
                                            placeholder="eyJhbGciOi..."
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#F55F2A]"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Supabase Dashboard → Settings → API → Project API keys
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Service Role Key (optional)</label>
                                        <input
                                            type="password"
                                            value={existingSupabaseServiceRoleKey}
                                            onChange={(e) => setExistingSupabaseServiceRoleKey(e.target.value)}
                                            placeholder="eyJhbGciOi..."
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#F55F2A]"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            Only if you need server-side admin access. Keep this secret.
                                        </p>
                                    </div>

                                    <button
                                        onClick={handleConnectExistingSupabaseProject}
                                        className="w-full bg-black text-white py-2 px-4 rounded-full hover:bg-black/90 transition-colors font-semibold"
                                    >
                                        Connect Existing Project
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            )}

            {/* Migration Review & Apply Modal (non-coder friendly guardrails) */}
            {migrationReviewMessageId ? (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
                        {(() => {
                            const msg = messages.find((m) => m.id === migrationReviewMessageId);
                            const proposalId = msg?.migrationProposalId || "";
                            const destructive = Boolean(msg?.migrationDestructive);
                            const isApplying = proposalId ? Boolean(applyingMigrationIds[proposalId]) : false;
                            const typedOk = destructive ? migrationConfirmText.trim().toLowerCase() === "apply" : true;
                            const canApply = Boolean(proposalId) && migrationAcknowledge && typedOk && !isApplying;

                            return (
                                <>
                                    <div className="flex items-start justify-between gap-3 mb-4">
                                        <div className="flex items-start gap-3">
                                            <div className={`mt-0.5 h-9 w-9 rounded-lg flex items-center justify-center ${destructive ? "bg-amber-50" : "bg-green-50"}`}>
                                                {destructive ? (
                                                    <AlertTriangle className="h-5 w-5 text-amber-700" />
                                                ) : (
                                                    <Database className="h-5 w-5 text-green-700" />
                                                )}
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-semibold text-gray-900">
                                                    Review database update
                                                </h3>
                                                <div className="text-sm text-gray-600">
                                                    {destructive
                                                        ? "This may delete or rewrite data. Proceed carefully."
                                                        : "This should be a safe schema change (e.g. adding tables/columns)."}
                                                </div>
                                                {proposalId ? (
                                                    <div className="mt-1 text-xs text-gray-500">ID: {proposalId}</div>
                                                ) : null}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setMigrationReviewMessageId(null)}
                                            className="text-gray-400 hover:text-gray-600"
                                            type="button"
                                            aria-label="Close"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>

                                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
                                        <div className="font-semibold">What this is for</div>
                                        <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">
                                            {msg?.content || "Database update"}
                                        </div>
                                        <div className="mt-2 text-xs text-gray-600">
                                            Note: App “restore points” do not automatically undo database changes.
                                        </div>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                        <label className="flex items-start gap-2 text-sm text-gray-800">
                                            <input
                                                type="checkbox"
                                                className="mt-1"
                                                checked={migrationAcknowledge}
                                                onChange={(e) => setMigrationAcknowledge(e.target.checked)}
                                            />
                                            <span>
                                                I understand this will change my database.
                                                {destructive ? " It could permanently affect existing data." : ""}
                                            </span>
                                        </label>

                                        {destructive ? (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                                    Type APPLY to continue
                                                </label>
                                                <input
                                                    type="text"
                                                    value={migrationConfirmText}
                                                    onChange={(e) => setMigrationConfirmText(e.target.value)}
                                                    placeholder="APPLY"
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                                                />
                                                <div className="mt-1 text-xs text-gray-500">
                                                    This extra step is here to prevent accidents.
                                                </div>
                                            </div>
                                        ) : null}

                                        <button
                                            type="button"
                                            onClick={() => setMigrationShowSqlInModal((v) => !v)}
                                            className="text-xs text-gray-700 underline"
                                        >
                                            {migrationShowSqlInModal ? "Hide advanced SQL" : "Show advanced SQL"}
                                        </button>

                                        {migrationShowSqlInModal && msg?.migrationSql ? (
                                            <pre className="max-h-64 overflow-auto rounded bg-white border border-gray-200 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                                                {msg.migrationSql}
                                            </pre>
                                        ) : null}
                                    </div>

                                    <div className="mt-5 flex gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setMigrationReviewMessageId(null)}
                                            className="flex-1 bg-gray-100 text-gray-900 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            disabled={!canApply}
                                            onClick={async () => {
                                                if (!proposalId) return;
                                                if (applyingMigrationIds[proposalId]) return;
                                                setApplyingMigrationIds((prev) => ({ ...prev, [proposalId]: true }));
                                                try {
                                                    const headers = await withCsrfHeaders();
                                                    const res = await fetch("/api/supabase/migrations/apply", {
                                                        method: "POST",
                                                        headers,
                                                        body: JSON.stringify({ proposalId, confirm: `APPLY ${proposalId}` }),
                                                    });
                                                    const json = await res.json().catch(() => ({} as any));
                                                    if (!res.ok || json?.ok === false) {
                                                        const msgErr = typeof json?.error === "string" ? json.error : "Failed to apply migration.";
                                                        setMessages((prev) =>
                                                            prev.map((m) =>
                                                                m.id === migrationReviewMessageId
                                                                    ? { ...m, migrationStatus: "FAILED", content: `${m.content}\n\nMigration failed: ${msgErr}` }
                                                                    : m
                                                            )
                                                        );
                                                        return;
                                                    }
                                                    setMessages((prev) =>
                                                        prev.map((m) =>
                                                            m.id === migrationReviewMessageId
                                                                ? { ...m, migrationStatus: "APPLIED", content: `${m.content}\n\nMigration applied.` }
                                                                : m
                                                        )
                                                    );
                                                    setMigrationReviewMessageId(null);
                                                } catch (e) {
                                                    console.error("Migration apply error:", e);
                                                    setMessages((prev) =>
                                                        prev.map((m) =>
                                                            m.id === migrationReviewMessageId
                                                                ? { ...m, migrationStatus: "FAILED", content: `${m.content}\n\nMigration failed.` }
                                                                : m
                                                        )
                                                    );
                                                } finally {
                                                    setApplyingMigrationIds((prev) => {
                                                        const next = { ...prev };
                                                        delete next[proposalId];
                                                        return next;
                                                    });
                                                }
                                            }}
                                            className={`flex-1 text-white py-2 px-4 rounded-md transition-colors disabled:opacity-50 ${
                                                destructive ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"
                                            }`}
                                        >
                                            {isApplying ? "Applying…" : destructive ? "Apply (risky)" : "Apply"}
                                        </button>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            ) : null}

            {/* Input */}
            <div className="p-4 border-t bg-white rounded-lg flex-shrink-0">
                <div className="mb-2 flex items-center justify-between">
                    <div className="text-[12px] text-gray-700">
                        {aiCreditsRemaining == null
                            ? "Credits remaining: —"
                            : `Credits remaining: ${aiCreditsRemaining}`}
                    </div>
                    <button
                        type="button"
                        className="px-3 py-1 text-xs font-semibold bg-accent text-white rounded-full hover:bg-accent-dark"
                    >
                        Add credits
                    </button>
                </div>
                <div className="flex gap-2 border border-gray-300">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Ask me to build something..."
                        className="flex-1 p-3 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-accent"
                        rows={3}
                        disabled={isLoading}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={!input.trim() || isLoading}
                        className="px-3 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <Send className="w-6 h-6 text-accent" />
                    </button>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                    Press Enter to send, Shift+Enter for new line
                </div>
            </div>
        </div>
    );
}
