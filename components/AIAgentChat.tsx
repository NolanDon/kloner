// src/components/AIAgentChat.tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, RotateCcw, Database, FileText, RefreshCw, X, AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { ensureSessionAndCsrf } from "@/lib/auth-client";
import { useAuth } from "@/src/hooks/useAuth";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { useModal } from "@/components/ui/ModalContext";

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

    stagedBundleId?: string;
};

type StagedBundle = {
    id: string;
    createdAt: number;
    label: string;
    proposalIds: string[];
    appliedProposalIds: Record<string, boolean>;
    fileEdits: Array<{ path: string; content: string }>;
    creditRequestId?: string;
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
    previewReady?: boolean;
    welcomeContext?: {
        source?: "prompt" | "url" | "quickstart" | "template" | "sample" | "unknown";
        prompt?: string | null;
        url?: string | null;
        templateName?: string | null;
    };
};

type CompileErrorQuickFixContext = {
    appId: string;
    code: string;
    actionType: "quick_fix_compile";
    fixAction?: string;
    compileError: {
        summary: string;
        detail: string;
        fingerprint: string;
    };
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

function stripMarkdownBold(text: string): string {
    // Chat renders content as plain text (not markdown), so remove bold markers.
    return (text || "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*\*/g, "");
}

function renderTextWithLinks(text: string): React.ReactNode {
    const cleaned = stripMarkdownBold(text || "");

    // Linkify full URLs + the key in-app routes we intentionally surface.
    const linkRe = /(https?:\/\/[^\s)\]]+|\/price(?:#topup)?)/g;
    const parts = cleaned.split(linkRe);

    return parts.map((part, idx) => {
        const isUrl = /^https?:\/\//i.test(part);
        const isPricePath = part === "/price" || part === "/price#topup";

        if (!isUrl && !isPricePath) {
            return <span key={idx}>{part}</span>;
        }

        const href = part;

        // Make in-app pricing links look like CTAs (not raw URLs).
        if (isPricePath) {
            const isTopup = part === "/price#topup";
            const label = isTopup ? "Add credits" : "View pricing";
            const classes = isTopup
                ? "inline-flex items-center justify-center rounded-full bg-[#F55F2A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e35625]"
                : "inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-neutral-50";

            return (
                <span key={idx} className="block mt-2">
                    <a href={href} className={classes}>
                        {label}
                    </a>
                </span>
            );
        }

        // External URLs remain normal link styling.
        return (
            <a
                key={idx}
                href={href}
                className="inline-flex items-center gap-1 underline text-blue-700 hover:text-blue-800"
                target="_blank"
                rel="noopener noreferrer"
            >
                <span>{href}</span>
                <ExternalLink className="h-3.5 w-3.5" />
            </a>
        );
    });
}

function buildCompileFixPrefill(ctx: CompileErrorQuickFixContext): string {
    const immutableContext = {
        appId: ctx.appId,
        code: ctx.code,
        actionType: ctx.actionType,
        fixAction: ctx.fixAction || null,
        compileError: {
            summary: ctx.compileError.summary,
            detail: ctx.compileError.detail,
            fingerprint: ctx.compileError.fingerprint,
        },
    };

    return [
        "Please fix this compile error using the immutable context below.",
        "",
        "Context (immutable in free-fix mode):",
        JSON.stringify(immutableContext, null, 2),
    ].join("\n");
}

export default function AIAgentChat({ appId, files, onFileEdit, onFilesReplace, onRestoreApplied, creditError, previewReady, welcomeContext }: AIAgentChatProps) {
    const { user } = useAuth();
    const { showConfirm, showAlert } = useModal();
    const AI_EDIT_COST = 5;
    const TOPUP_COMING_SOON = false;
    // Supabase OAuth setup is safe to expose in production (still requires session + CSRF on the server).
    const allowDatabaseSetupUi = true;
    const [aiCreditsRemaining, setAiCreditsRemaining] = useState<number | null>(null);
    const [topupBusy, setTopupBusy] = useState(false);
    const [topupModalOpen, setTopupModalOpen] = useState(false);
    const [topupCredits, setTopupCredits] = useState<number>(500);
    const [topupConfig, setTopupConfig] = useState<
        | {
              currency: string;
              unitPriceCents: number;
              minCredits: number;
              maxCredits: number;
              stepCredits: number;
          }
        | null
    >(null);

    const topupOptions = (() => {
        const cfg = topupConfig;
        const min = cfg?.minCredits ?? 50;
        const max = cfg?.maxCredits ?? 5000;

        const parseEnv = (raw: string | undefined): number[] => {
            const s = (raw || "").trim();
            if (!s) return [];
            const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
            const nums = parts
                .map((p) => Number.parseInt(p, 10))
                .filter((n) => Number.isFinite(n) && n > 0);
            return Array.from(new Set(nums)).sort((a, b) => a - b);
        };

        const override = parseEnv(process.env.NEXT_PUBLIC_AI_EDIT_TOPUP_OPTIONS);
        const base = override.length
            ? override
            : [50, 100, 200, 400, 800, 1200, 2000, 3000, 4000, 5000, 7500, 10000];

        const filtered = base.filter((n) => n >= min && n <= max);
        if (filtered.length) return filtered;

        const step = cfg?.stepCredits ?? 50;
        const values: number[] = [];
        for (let v = min; v <= max && values.length < 20; v += Math.max(1, step)) values.push(v);
        return values.length ? values : [min];
    })();

    useEffect(() => {
        if (!topupModalOpen) return;
        if (TOPUP_COMING_SOON) return;
        if (topupConfig) return;

        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch("/api/billing/credit-topup-config", { cache: "no-store" });
                if (!res.ok) return;
                const data = (await res.json().catch(() => null)) as any;
                if (!data || cancelled) return;

                const unitPriceCents =
                    typeof data.unitPriceCents === "number" && Number.isFinite(data.unitPriceCents)
                        ? Math.max(1, Math.floor(data.unitPriceCents))
                        : 3;
                const minCredits =
                    typeof data.minCredits === "number" && Number.isFinite(data.minCredits)
                        ? Math.max(1, Math.floor(data.minCredits))
                        : 50;
                const maxCredits =
                    typeof data.maxCredits === "number" && Number.isFinite(data.maxCredits)
                        ? Math.max(minCredits, Math.floor(data.maxCredits))
                        : 5000;
                const stepCredits =
                    typeof data.stepCredits === "number" && Number.isFinite(data.stepCredits)
                        ? Math.max(1, Math.floor(data.stepCredits))
                        : 50;
                const currency = typeof data.currency === "string" ? data.currency : "usd";

                setTopupConfig({ currency, unitPriceCents, minCredits, maxCredits, stepCredits });

                setTopupCredits((prev) => {
                    const options = topupOptions.length ? topupOptions : [minCredits];
                    const clamped = Math.min(Math.max(prev, minCredits), maxCredits);
                    let best = options[0]!;
                    let bestDist = Math.abs(best - clamped);
                    for (const n of options) {
                        const d = Math.abs(n - clamped);
                        if (d < bestDist) {
                            best = n;
                            bestDist = d;
                        }
                    }
                    return best;
                });
            } catch {
                // ignore
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [topupModalOpen]);

    useEffect(() => {
        if (!topupModalOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setTopupModalOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [topupModalOpen]);
    const makeWelcomeMessage = useCallback((ctx?: AIAgentChatProps["welcomeContext"]) => {
        const base = "Agent ready.";

        const cleanOneLine = (v: unknown, max = 180) => {
            const raw = typeof v === "string" ? v : "";
            const collapsed = raw.replace(/\s+/g, " ").trim();
            if (!collapsed) return "";
            return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
        };

        const prompt = cleanOneLine(ctx?.prompt);
        const urlRaw = cleanOneLine(ctx?.url, 220);
        const templateName = cleanOneLine(ctx?.templateName, 80);

        let contextLine = "";
        if (prompt) {
            contextLine = `I saw your request: “${prompt}”`;
        } else if (urlRaw) {
            const nice = urlRaw.replace(/^https?:\/\//i, "");
            contextLine = `I saw you're cloning: ${nice}`;
        } else if (templateName) {
            contextLine = `You're starting from the ${templateName} template.`;
        }

        return [
            base,
            "",
            contextLine,
            "",
            "I can help with layout, styling, images, copy, and features.",
            "Ideas to start: improve the hero, tighten spacing, add a pricing section, or refine mobile responsiveness.",
            "Tell me what direction you want, and I’ll implement it.",
        ]
            .filter(Boolean)
            .join("\n");
    }, []);

    const [messages, setMessages] = useState<Message[]>(() => [
        {
            id: "welcome",
            role: "assistant",
            content: makeWelcomeMessage(welcomeContext),
            timestamp: new Date(),
            type: "text",
        },
    ]);
    const [input, setInput] = useState("");
    const [freeCompileFixContext, setFreeCompileFixContext] = useState<CompileErrorQuickFixContext | null>(null);
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
    const [isSupabaseConnected, setIsSupabaseConnected] = useState(false);
    const [supabaseProjectName, setSupabaseProjectName] = useState<string | null>(null);
    const [supabaseProjectRef, setSupabaseProjectRef] = useState<string | null>(null);
    const [supabaseDbReachable, setSupabaseDbReachable] = useState<boolean | null>(null);
    const [supabaseDbStatusText, setSupabaseDbStatusText] = useState<string | null>(null);
    const [supabaseDbReason, setSupabaseDbReason] = useState<string | null>(null);
    const [supabaseDbLastCheckedAt, setSupabaseDbLastCheckedAt] = useState<number | null>(null);
    const [existingSupabaseProjectRef, setExistingSupabaseProjectRef] = useState("");
    const [existingSupabaseAnonKey, setExistingSupabaseAnonKey] = useState("");
    const [existingSupabaseServiceRoleKey, setExistingSupabaseServiceRoleKey] = useState("");
    const [applyingMigrationIds, setApplyingMigrationIds] = useState<Record<string, boolean>>({});
    const [showMigrationSqlByMessageId, setShowMigrationSqlByMessageId] = useState<Record<string, boolean>>({});
    const [migrationReviewMessageId, setMigrationReviewMessageId] = useState<string | null>(null);
    const [migrationAcknowledge, setMigrationAcknowledge] = useState(false);
    const [migrationConfirmText, setMigrationConfirmText] = useState("");
    const [migrationShowSqlInModal, setMigrationShowSqlInModal] = useState(false);

    const [stagedBundles, setStagedBundles] = useState<StagedBundle[]>([]);

    const isSupabaseConnectedRef = useRef(false);
    const supabaseDbHealthInFlightRef = useRef(false);
    const lastSupabaseDbHealthAtRef = useRef(0);

    const chatDisabled = previewReady === false && !freeCompileFixContext;

    const didSyncSupabasePreviewEnvRef = useRef(false);

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

            // If Supabase is already connected, do NOT show the connect modal or database setup modal.
            if (isSupabaseConnected) {
                setShowDatabaseSetup(false);
                setShowSupabaseAdvanced(false);
                setShowSupabaseSetup(false);
                return;
            }
            setShowDatabaseSetup(false);
            setShowSupabaseAdvanced(false);
            setShowSupabaseSetup(true);
        };

        window.addEventListener("kloner:open-db-connect", onOpen as EventListener);
        return () => window.removeEventListener("kloner:open-db-connect", onOpen as EventListener);
    }, [allowDatabaseSetupUi, isSupabaseConnected]);

    const refreshSupabaseStatusFromApi = useCallback(async (): Promise<boolean> => {
        try {
            const url = appId
                ? `/api/supabase/project-status?appId=${encodeURIComponent(appId)}`
                : "/api/supabase/project-status";
            const res = await fetch(url, {
                method: "GET",
                cache: "no-store",
                credentials: "include",
            });

            if (!res.ok) return false;

            const data: any = await res.json().catch(() => null);
            const connected = !!(data && data.completed && data.ok);

            setIsSupabaseConnected(connected);
            if (connected) {
                const name = typeof data?.project?.name === "string" && data.project.name.trim() ? data.project.name.trim() : null;
                const ref =
                    (typeof data?.project?.ref === "string" && data.project.ref.trim() ? data.project.ref.trim() : null) ||
                    (typeof data?.project?.id === "string" && data.project.id.trim() ? data.project.id.trim() : null);
                setSupabaseProjectName(name);
                setSupabaseProjectRef(ref);
            } else {
                setSupabaseProjectName(null);
                setSupabaseProjectRef(null);
                setSupabaseDbReachable(null);
                setSupabaseDbReason(null);
                setSupabaseDbStatusText(null);
                setSupabaseDbLastCheckedAt(null);
            }

            return connected;
        } catch {
            // Network/offline: do not spam logs; just treat as disconnected.
            setIsSupabaseConnected(false);
            setSupabaseProjectName(null);
            setSupabaseProjectRef(null);
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText(null);
            setSupabaseDbLastCheckedAt(null);
            return false;
        }
    }, []);

    useEffect(() => {
        if (!user?.uid) {
            setIsSupabaseConnected(false);
            setSupabaseProjectName(null);
            setSupabaseProjectRef(null);
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText(null);
            setSupabaseDbLastCheckedAt(null);
            return;
        }

        // If DB setup UI is disabled, don't even check status.
        if (!allowDatabaseSetupUi) {
            setIsSupabaseConnected(false);
            setSupabaseProjectName(null);
            setSupabaseProjectRef(null);
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText(null);
            setSupabaseDbLastCheckedAt(null);
            return;
        }

        let cancelled = false;
        void refreshSupabaseStatusFromApi();

        // Lightweight polling so we update after OAuth completes.
        const t = window.setInterval(() => {
            if (cancelled) return;
            void refreshSupabaseStatusFromApi();
        }, 20_000);

        return () => {
            cancelled = true;
            window.clearInterval(t);
        };
    }, [user?.uid, allowDatabaseSetupUi, refreshSupabaseStatusFromApi]);

    useEffect(() => {
        isSupabaseConnectedRef.current = isSupabaseConnected;
    }, [isSupabaseConnected]);

    useEffect(() => {
        // Self-heal: if the user becomes connected while the modal is open, close it.
        if (!isSupabaseConnected) return;
        setShowDatabaseSetup(false);
        setShowSupabaseSetup(false);
        setShowSupabaseAdvanced(false);
    }, [isSupabaseConnected]);

    useEffect(() => {
        setIsHydrated(true);
    }, []);

    useEffect(() => {
        if (!user?.uid) return;

        const userRef = doc(db, "kloner_users", user.uid);
        let unsub: null | (() => void) = null;

        try {
            unsub = onSnapshot(
                userRef,
                (snap) => {
                    const data = snap.exists() ? (snap.data() as any) : null;
                    const bucket = data?.["credits.aiEdits"] || data?.credits?.aiEdits || null;
                    const remaining = typeof bucket?.remaining === "number" ? bucket.remaining : null;
                    setAiCreditsRemaining(Number.isFinite(remaining) ? remaining : null);
                },
                (err) => {
                    console.error("Firestore listener error (ai edits credits)", err);
                    // If Firestore read fails (rules/offline), don't block usage.
                    setAiCreditsRemaining(null);
                },
            );
        } catch (err) {
            console.error("Failed to subscribe to ai edits credits (Firestore)", err);
            setAiCreditsRemaining(null);
        }

        return () => {
            if (!unsub) return;
            try {
                unsub();
            } catch (err) {
                console.warn("Firestore unsubscribe error (ai edits credits)", err);
            }
        };
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

    const dispatchAiAgentEvent = useCallback((kind: string, detail?: Record<string, any>) => {
        if (typeof window === "undefined") return;
        try {
            window.dispatchEvent(
                new CustomEvent("kloner:ai-agent-event", {
                    detail: {
                        kind,
                        ts: Date.now(),
                        ...(detail || {}),
                    },
                }),
            );
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const onCompileFix = (event: Event) => {
            const detail = (event as CustomEvent<any>)?.detail || {};
            const code = typeof detail?.code === "string" ? detail.code.trim() : "";
            const actionType = String(detail?.actionType || "").toLowerCase();
            const summary = typeof detail?.compileError?.summary === "string" ? detail.compileError.summary.trim() : "";
            const detailText = typeof detail?.compileError?.detail === "string" ? detail.compileError.detail : "";
            const fingerprint = typeof detail?.compileError?.fingerprint === "string" ? detail.compileError.fingerprint.trim() : "";
            if (!code || actionType !== "quick_fix_compile" || !summary || !fingerprint) return;

            const ctx: CompileErrorQuickFixContext = {
                appId: String(detail?.appId || appId),
                code,
                actionType: "quick_fix_compile",
                fixAction: typeof detail?.fixAction === "string" ? detail.fixAction : undefined,
                compileError: {
                    summary,
                    detail: detailText,
                    fingerprint,
                },
            };

            const prefill = buildCompileFixPrefill(ctx);
            setFreeCompileFixContext(ctx);
            setInput(prefill);
            setMessages((prev) => [
                ...prev,
                {
                    id: `compile_fix_ready_${Date.now()}`,
                    role: "assistant",
                    content: "Free compile-fix context is prepared and locked. Send as-is to use free mode.",
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
        };

        window.addEventListener("kloner:compile-error-fix-request", onCompileFix as EventListener);
        return () => {
            window.removeEventListener("kloner:compile-error-fix-request", onCompileFix as EventListener);
        };
    }, [appId]);

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

    useEffect(() => {
        if (typeof window === "undefined") return;

        const onTopupMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;

            const payload = (event.data || {}) as any;
            if (payload?.type !== "kloner:credit-topup") return;

            const status = typeof payload?.status === "string" ? payload.status : "";
            if (status === "success") {
                const credits = typeof payload?.credits === "number" ? payload.credits : null;
                void showAlert(
                    credits ? `Added ${credits.toLocaleString()} AI credits to your account.` : "Top-up confirmed.",
                    "Credits added",
                );
                return;
            }

            if (status === "cancel") {
                void showAlert("Checkout canceled.", "Top up");
                return;
            }

            const errorMessage =
                typeof payload?.error === "string" && payload.error
                    ? payload.error
                    : "Could not confirm your top-up yet. If you were charged, credits should apply shortly.";
            void showAlert(errorMessage, "Top up");
        };

        window.addEventListener("message", onTopupMessage);
        return () => window.removeEventListener("message", onTopupMessage);
    }, [showAlert]);

    const startCreditTopup = useCallback(async (credits: number) => {
        if (topupBusy) return;
        if (typeof window === "undefined") return;

        const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

        const creditsInt = Number.isFinite(credits) ? Math.max(1, Math.floor(credits)) : 0;
        if (!creditsInt) return;

        setTopupBusy(true);
        try {
            await ensureSessionAndCsrf().catch(() => null);
            const headers = await withCsrfHeaders();
            const res = await fetch("/api/billing/create-credit-topup-session", {
                method: "POST",
                headers,
                credentials: "include",
                body: JSON.stringify({ credits: creditsInt, next: nextPath }),
            });

            if (res.status === 401) {
                const loginUrl = `/login?next=${encodeURIComponent(nextPath)}`;
                await showAlert("Your session expired. Please sign in again to continue checkout.", "Sign in required");
                const loginWindow = window.open(loginUrl, "_blank", "noopener,noreferrer");
                if (!loginWindow) {
                    window.location.href = loginUrl;
                }
                return;
            }

            const data = (await res.json().catch(() => ({}))) as any;
            const url = typeof data?.url === "string" ? data.url : "";
            if (!res.ok || !url) {
                await showAlert(data?.error || "Unable to start top-up checkout. Please try again.", "Top up");
                return;
            }

            const popup = window.open(
                url,
                "kloner-credit-topup",
                "width=520,height=760,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes,status=no",
            );

            if (popup) {
                popup.focus();
                return;
            }

            await showAlert("Popup was blocked by your browser. Opening checkout in this tab.", "Top up");
            window.location.href = url;
        } finally {
            setTopupBusy(false);
        }
    }, [showAlert, topupBusy, withCsrfHeaders]);

    const checkSupabaseDbHealth = useCallback(async (opts?: { silent?: boolean }) => {
        if (!user?.uid) {
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText(null);
            setSupabaseDbLastCheckedAt(null);
            return { connected: false, reachable: false, reason: "no_user" as const };
        }

        if (!isSupabaseConnectedRef.current) {
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText(null);
            setSupabaseDbLastCheckedAt(null);
            return { connected: false, reachable: false, reason: "not_connected" as const };
        }

        if (supabaseDbHealthInFlightRef.current) {
            return { connected: true, reachable: supabaseDbReachable === true, reason: "in_flight" as const };
        }

        const now = Date.now();
        if (now - lastSupabaseDbHealthAtRef.current < 10_000) {
            return { connected: true, reachable: supabaseDbReachable === true, reason: "throttled" as const };
        }

        lastSupabaseDbHealthAtRef.current = now;
        supabaseDbHealthInFlightRef.current = true;

        try {
            const headers = await withCsrfHeaders();
            const res = await fetch("/api/supabase/db-health", {
                method: "POST",
                headers,
                body: JSON.stringify({ cleanupIfDeleted: true, appId: appId || undefined }),
                cache: "no-store",
            });

            const data: any = await res.json().catch(() => null);
            setSupabaseDbLastCheckedAt(Date.now());

            if (!res.ok || !data?.ok) {
                setSupabaseDbReachable(null);
                setSupabaseDbReason(null);
                setSupabaseDbStatusText("Could not verify database reachability");
                return { connected: true, reachable: false, reason: "request_failed" as const };
            }

            if (data.connected === false) {
                setSupabaseDbReachable(false);
                setSupabaseDbReason(data?.reason || null);
                setSupabaseDbStatusText(
                    data?.reason === "project_deleted"
                        ? "Supabase project was deleted"
                        : data?.reason === "unauthorized"
                          ? "Supabase access unauthorized"
                          : "Supabase not connected",
                );
                setIsSupabaseConnected(false);
                setSupabaseProjectName(null);
                setSupabaseProjectRef(null);

                if (!opts?.silent) {
                    await showAlert(
                        data?.reason === "project_deleted"
                            ? "Your Supabase project no longer exists (it looks like it was deleted). Kloner removed the stale connection."
                            : "Supabase is not reachable right now. Please reconnect.",
                        "Database",
                    );
                }

                return { connected: false, reachable: false, reason: data?.reason || "disconnected" };
            }

            const reachable = Boolean(data.reachable);
            setSupabaseDbReachable(reachable);
            const reason = typeof data?.reason === "string" ? data.reason : "";
            setSupabaseDbReason(reachable ? null : reason || null);
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
            return { connected: true, reachable, reason: reason || (reachable ? "ok" : "unreachable"), error: (typeof data?.error === "string" && data.error.trim()) ? data.error.trim() : undefined };
        } catch (e: any) {
            setSupabaseDbLastCheckedAt(Date.now());
            setSupabaseDbReachable(null);
            setSupabaseDbReason(null);
            setSupabaseDbStatusText("Could not verify database reachability");
            return { connected: true, reachable: false, reason: "client_error" as const, error: typeof e?.message === "string" ? e.message : undefined };
        } finally {
            supabaseDbHealthInFlightRef.current = false;
        }
    }, [showAlert, supabaseDbReachable, user?.uid, withCsrfHeaders]);

    useEffect(() => {
        if (!isSupabaseConnected) return;
        void checkSupabaseDbHealth({ silent: true });
        const id = window.setInterval(() => {
            void checkSupabaseDbHealth({ silent: true });
        }, 60_000);
        return () => window.clearInterval(id);
    }, [checkSupabaseDbHealth, isSupabaseConnected]);

    useEffect(() => {
        if (!migrationReviewMessageId) return;
        void checkSupabaseDbHealth({ silent: true });
    }, [checkSupabaseDbHealth, migrationReviewMessageId]);

    useEffect(() => {
        // Only sync envs after preview is ready
        if (!appId) return;
        if (!isSupabaseConnected) return;
        if (didSyncSupabasePreviewEnvRef.current) return;
        didSyncSupabasePreviewEnvRef.current = true;

    }, [appId, isSupabaseConnected, previewReady, withCsrfHeaders]);

    const bootstrapAppScope = useCallback(async (): Promise<boolean> => {
        // The app-scope cookie can be missing on fresh sessions (or expire ~30 min),
        // so we (re-)issue it before calling app-scoped routes.
        try {
            await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/scope`, {
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

    const scopeBootstrappedForAppIdRef = useRef<string | null>(null);

    // Proactively issue the scope cookie once per appId to avoid noisy 403s.
    useEffect(() => {
        if (!user?.uid || !appId) return;
        if (scopeBootstrappedForAppIdRef.current === appId) return;
        scopeBootstrappedForAppIdRef.current = appId;
        void bootstrapAppScope();
    }, [appId, bootstrapAppScope, user?.uid]);

    // Load chat history from server (firebase-admin) and migrate any legacy localStorage once.
    useEffect(() => {
        if (loadedFromRemoteRef.current) return;
        if (!user?.uid || !appId) return;

        let cancelled = false;
        (async () => {
            try {
                await ensureSessionAndCsrf().catch(() => null);
                const res = await fetchWithScopeRetry(
                    `/api/app-builder/${appId}/ai-chat`,
                    { method: "GET" },
                    { retryLabel: "load ai chat" },
                );
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
                                    await fetchWithScopeRetry(
                                        `/api/app-builder/${appId}/ai-chat`,
                                        {
                                            method: "POST",
                                            headers,
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
                                        },
                                        { retryLabel: "migrate legacy chat" },
                                    ).catch(() => null);
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
    }, [appId, debugChatIo, fetchWithScopeRetry, user?.uid, withCsrfHeaders]);

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

    const buildChatPayload = useCallback((input: Message[]) => {
        // Keep a reasonable tail to prevent doc bloat.
        const tailMax = 120;
        const base = input.slice(-tailMax).map((m) => ({
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

        return payload;
    }, []);

    const saveChatNow = useCallback(
        async (nextMessages: Message[]) => {
            if (!isHydrated) return;
            if (!initialLoadCompletedRef.current) return;
            if (!user?.uid || !appId) return;

            try {
                const payload = buildChatPayload(nextMessages);
                const raw = JSON.stringify(payload);

                // Skip writes if nothing changed since last successful save.
                if (lastSavedPayloadRef.current === raw) {
                    if (debugChatIo()) console.log("[AIAgentChat] chat save skipped (unchanged)", { appId });
                    return;
                }

                await ensureSessionAndCsrf().catch(() => null);
                const headers = await withCsrfHeaders();
                const res = await fetchWithScopeRetry(
                    `/api/app-builder/${appId}/ai-chat`,
                    { method: "POST", headers, body: JSON.stringify({ messages: payload }) },
                    { retryLabel: "save ai chat now" },
                );
                if (!res.ok) {
                    throw new Error(`Chat save failed: ${res.status}`);
                }

                lastSavedPayloadRef.current = raw;
                if (debugChatIo()) console.log("[AIAgentChat] chat saved", { appId, messages: payload.length });
            } catch (e) {
                console.warn("Failed to save chat history", e);
                if (debugChatIo()) {
                    console.log("[AIAgentChat] chat save failed", {
                        appId,
                        uid: user?.uid || null,
                        path: `kloner_users/${user?.uid || "<no-uid>"}/kloner_apps/${appId}/ai_chat/default`,
                    });
                }
            }
        },
        [appId, buildChatPayload, debugChatIo, fetchWithScopeRetry, isHydrated, user?.uid, withCsrfHeaders],
    );

    const dismissMessage = useCallback(
        (messageId: string) => {
            if (!messageId) return;

            // Cancel pending debounce and persist immediately.
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }

            setMessages((prev) => {
                const next = prev.filter((m) => m.id !== messageId);
                void saveChatNow(next);
                return next;
            });
        },
        [saveChatNow],
    );

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
                const payload = buildChatPayload(messages);

                // Skip writes if nothing changed since last successful save.
                const raw = JSON.stringify(payload);
                if (lastSavedPayloadRef.current === raw) {
                    if (debugChatIo()) console.log("[AIAgentChat] chat save skipped (unchanged)", { appId });
                    return;
                }

                await ensureSessionAndCsrf().catch(() => null);
                const headers = await withCsrfHeaders();
                const res = await fetchWithScopeRetry(
                    `/api/app-builder/${appId}/ai-chat`,
                    { method: "POST", headers, body: JSON.stringify({ messages: payload }) },
                    { retryLabel: "save ai chat debounced" },
                );
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
    }, [appId, buildChatPayload, debugChatIo, fetchWithScopeRetry, isHydrated, messages, user?.uid, withCsrfHeaders]);

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

    const applyStagedBundle = useCallback((bundleId: string, options?: { unsafe?: boolean }) => {
        setStagedBundles((prev) => {
            const bundle = prev.find((b) => b.id === bundleId);
            if (!bundle) return prev;

            // Always create a local checkpoint right before applying.
            createCheckpoint(bundle.label || "Apply staged edits");

            // Apply edits (this persists to Firebase via the parent).
            for (const edit of bundle.fileEdits) {
                try {
                    onFileEdit(edit.path, edit.content, bundle.creditRequestId);
                } catch {
                    // ignore; individual edits are handled by the parent save path
                }
            }

            // Clear linkage so the modal doesn't keep showing staged actions.
            setMessages((msgs) =>
                msgs.map((m) => (m.stagedBundleId === bundleId ? { ...m, stagedBundleId: undefined } : m))
            );

            // Emit a small chat note.
            setMessages((msgs) => [
                ...msgs,
                {
                    id: `staged_applied_${Date.now()}`,
                    role: "assistant",
                    content: options?.unsafe
                        ? "Applied the staged code changes (without waiting for the database update). If something breaks, you can undo via the restore point/checkpoint."
                        : "Applied the staged code changes now that the database update is applied.",
                    timestamp: new Date(),
                    type: "text",
                },
            ]);

            return prev.filter((b) => b.id !== bundleId);
        });
    }, [createCheckpoint, onFileEdit]);

    const discardStagedBundle = useCallback((bundleId: string) => {
        setStagedBundles((prev) => prev.filter((b) => b.id !== bundleId));
        setMessages((msgs) => msgs.map((m) => (m.stagedBundleId === bundleId ? { ...m, stagedBundleId: undefined } : m)));
        setMessages((msgs) => [
            ...msgs,
            {
                id: `staged_discarded_${Date.now()}`,
                role: "assistant",
                content: "Discarded the staged code changes. Your app will keep using the last working version.",
                timestamp: new Date(),
                type: "text",
            },
        ]);
    }, []);

    const markMigrationApplied = useCallback((proposalId: string) => {
        setStagedBundles((prev) => {
            if (!proposalId) return prev;
            const next = prev.map((b) =>
                b.proposalIds.includes(proposalId)
                    ? { ...b, appliedProposalIds: { ...b.appliedProposalIds, [proposalId]: true } }
                    : b
            );

            // Auto-apply any bundle that is now fully satisfied.
            const ready = next.filter((b) => b.proposalIds.length > 0 && b.proposalIds.every((id) => b.appliedProposalIds[id]));
            if (ready.length === 0) return next;

            // Apply outside of this setter tick.
            queueMicrotask(() => {
                for (const b of ready) {
                    applyStagedBundle(b.id);
                }
            });

            // Keep bundles until applyStagedBundle removes them.
            return next;
        });
    }, [applyStagedBundle]);

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
                body: JSON.stringify({ appId }),
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

            const rebuildPreviewAfterSupabase = async (): Promise<{ ok: boolean; error?: string }> => {
                try {
                    await ensureSessionAndCsrf().catch(() => null);
                    // Pull the latest files from Firestore so the rebuild starts with the updated `.env.local`.
                    await syncFilesFromServer({ applyToState: true }).catch(() => null);

                    if (typeof window !== "undefined") {
                        window.dispatchEvent(
                            new CustomEvent("kloner:preview-force-fresh", {
                                detail: { appId, reason: "supabase" },
                            }),
                        );
                    }

                    return { ok: true };
                } catch (e) {
                    const msg = e instanceof Error ? e.message : "Failed to start preview rebuild";
                    console.warn("Failed to start preview rebuild after Supabase connect", e);
                    return { ok: false, error: msg };
                }
            };

            const promptRestartAfterSupabase = async () => {
                const confirmed = await showConfirm(
                    "Supabase is connected.\n\nTo finish setup, we need to restart your environment. This can take a minute or two. Restart now?",
                    "Restart preview to load Supabase?",
                );

                if (!confirmed) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `supabase_restart_skipped_${Date.now()}`,
                            role: "assistant",
                            content:
                                "⚠️ **Supabase is connected, but your preview is still running with the old env vars.**\n\nWhen you’re ready, click **Rebuild app** so it restarts on a fresh machine and loads the new `.env.local` values.",
                            timestamp: new Date(),
                            type: "text",
                        },
                    ]);
                    return;
                }

                setMessages((prev) => [
                    ...prev,
                    {
                        id: `supabase_restart_start_${Date.now()}`,
                        role: "assistant",
                        content: "🧱 Rebuilding preview from scratch so your new database can take effect…",
                        timestamp: new Date(),
                        type: "text",
                    },
                ]);

                const result = await rebuildPreviewAfterSupabase();
                if (!result.ok) {
                    await showAlert(
                        `Supabase is connected, but starting a fresh rebuild failed.\n\n${result.error || "unknown_error"}\n\nTry clicking **Rebuild app** in the editor header.`,
                        "Rebuild failed",
                    );

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `supabase_restart_failed_${Date.now()}`,
                            role: "assistant",
                            content:
                                `❌ **Couldn’t start a fresh rebuild automatically.**\n\n${result.error || "unknown_error"}\n\nClick **Rebuild app** to restart on a fresh machine and load the Supabase env vars.`,
                            timestamp: new Date(),
                            type: "text",
                        },
                    ]);
                    return;
                }

                setMessages((prev) => [
                    ...prev,
                    {
                        id: `supabase_restart_ok_${Date.now()}`,
                        role: "assistant",
                        content: "✅ Rebuild started. You should see the preview reload; once it’s back up, your database should be fully connected and receive for your next request.",
                        timestamp: new Date(),
                        type: "text",
                    },
                ]);
            };

            const onMessage = async (event: MessageEvent) => {
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

                        await promptRestartAfterSupabase();
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
                    const statusResponse = await fetch(`/api/supabase/project-status?appId=${encodeURIComponent(appId)}`, {
                        method: 'GET',
                        credentials: "include",
                        cache: "no-store",
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
                                content: "**Project created successfully!**\n\nEverything is ready to use. Your new system is set up and connected so I can help you manage it automatically.\n\n**What’s ready for you:**\n- A secure place to store your data\n- User access and sign-in support\n- Ready to start adding information\n\nYou can now ask me to add information, organize it, or help with anything you want to build!",
                                timestamp: new Date(),
                                type: "text"
                            }]);

                            await promptRestartAfterSupabase();
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
    }, [appId, showAlert, showConfirm, withCsrfHeaders]);

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
                    // Bind to this specific Kloner app (1:1 guarantee).
                    appId: appId || undefined,
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
        if (chatDisabled) return;
        if (!input.trim() || isLoading) return;

        const compileFixPrefill = freeCompileFixContext ? buildCompileFixPrefill(freeCompileFixContext) : "";
        const isFreeCompileFixMode = Boolean(freeCompileFixContext && input === compileFixPrefill);

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

                const health = await checkSupabaseDbHealth({ silent: true });
                if (!health.reachable) {
                    const detail = health?.error || supabaseDbStatusText || "Database not reachable";
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `mig_blocked_${Date.now()}`,
                            role: "assistant",
                            content:
                                `I can’t apply that migration right now because Supabase isn’t reachable.\n\n${detail}\n\nOpen **Connect Database** and reconnect Supabase (your project may have been paused/deleted).`,
                            timestamp: new Date(),
                            type: "text",
                            migrationProposalId: proposalId,
                            migrationStatus: "FAILED",
                        },
                    ]);
                    return;
                }

                setApplyingMigrationIds((prev) => ({ ...prev, [proposalId]: true }));

                const res = await fetch("/api/supabase/migrations/apply", {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ proposalId, confirm: `APPLY ${proposalId}`, appId }),
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

                // If we staged code edits behind this migration, apply them now.
                markMigrationApplied(proposalId);
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
        if (!isFreeCompileFixMode && typeof aiCreditsRemaining === "number" && aiCreditsRemaining < AI_EDIT_COST) {
            const topup = "/price#topup";
            const errorMessage: Message = {
                id: `error_${Date.now()}`,
                role: "assistant",
                content:
                    `You have used all AI edit credits for this month.\nAdd credits: ${topup}`,
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

            dispatchAiAgentEvent("request", {
                appId,
                userId: user?.uid || null,
                messageLen: input.length,
                messagePreview: input.slice(0, 280),
                historyCount: Math.min(messages.length + 1, 11),
                freeCompileFixMode: isFreeCompileFixMode,
            });

            if (isFreeCompileFixMode && freeCompileFixContext) {
                dispatchAiAgentEvent("compile_error_fix_sent", {
                    appId,
                    code: freeCompileFixContext.code,
                    fingerprint: freeCompileFixContext.compileError.fingerprint,
                    actionType: freeCompileFixContext.actionType,
                    fixAction: freeCompileFixContext.fixAction || null,
                });
            }

            const res = await fetch("/api/ai-agent", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    message: input,
                    appId,
                    conversationHistory: [...messages.slice(-10), userMessage],
                    databaseConnections,
                    quickActionContext: isFreeCompileFixMode && freeCompileFixContext
                        ? {
                            type: freeCompileFixContext.actionType,
                            fixAction: freeCompileFixContext.fixAction || null,
                            code: freeCompileFixContext.code,
                            compileErrorFingerprint: freeCompileFixContext.compileError.fingerprint,
                            compileErrorSummary: freeCompileFixContext.compileError.summary,
                            compileErrorDetail: freeCompileFixContext.compileError.detail,
                            noCreditRequested: true,
                          }
                        : null,
                }),
            });

            if (!res.ok) {
                dispatchAiAgentEvent("response_error", {
                    appId,
                    userId: user?.uid || null,
                    status: res.status,
                });
                throw new Error("Failed to get AI response");
            }

            const data = await res.json();

            dispatchAiAgentEvent("response_ok", {
                appId,
                userId: user?.uid || null,
                hasFileEdits: Array.isArray(data?.fileEdits) && data.fileEdits.length > 0,
                fileEditsCount: Array.isArray(data?.fileEdits) ? data.fileEdits.length : 0,
                hasDbMigrations: Array.isArray(data?.dbMigrations) && data.dbMigrations.length > 0,
                dbMigrationsCount: Array.isArray(data?.dbMigrations) ? data.dbMigrations.length : 0,
                restorePointId: typeof data?.restorePointId === "string" ? data.restorePointId : null,
                responseLen: typeof data?.response === "string" ? data.response.length : null,
            });

            // If the AI response or context indicates a restart is required, suggest the Rebuild app button
            let aiContent = data.response;
            if (typeof aiContent === "string" && /restart|server.*restart|refresh.*server|database credentials|should work in a moment/i.test(aiContent)) {
                aiContent +=
                    "\n\nIf you just updated your database credentials or made a major config change, you may need to click the **Rebuild app** button (formerly 'Start fresh') in the editor to fully restart your app server.";
            }
            const aiMessage: Message = {
                id: `ai_${Date.now()}`,
                role: "assistant",
                content: aiContent,
                timestamp: new Date(),
                type: "text"
            };

            setMessages(prev => [...prev, aiMessage]);

            const hasDbMigrations = Array.isArray(data.dbMigrations) && data.dbMigrations.length > 0;

            // Handle database migrations (propose -> ask user -> apply)
            const proposalIdsForThisResponse: string[] = [];
            if (hasDbMigrations) {
                const headers2 = await withCsrfHeaders();
                for (const mig of data.dbMigrations as Array<any>) {
                    const sql = typeof mig?.sql === "string" ? mig.sql : "";
                    const messageText = typeof mig?.message === "string" ? mig.message : "Database schema change";
                    const destructive = Boolean(mig?.destructive);

                    if (!sql.trim()) continue;

                    const proposeRes = await fetch("/api/supabase/migrations/propose", {
                        method: "POST",
                        headers: headers2,
                        body: JSON.stringify({ sql, message: messageText, destructive, appId }),
                    });

                    const proposeJson = await proposeRes.json().catch(() => ({} as any));
                    if (!proposeRes.ok || proposeJson?.ok === false) {
                        const msg = typeof proposeJson?.error === "string" ? proposeJson.error : "Failed to create migration proposal.";
                        if (msg.toLowerCase().includes("supabase is not connected")) {
                            if (!isSupabaseConnectedRef.current) {
                                setShowDatabaseSetup(true);
                            }
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

                    if (proposalId) proposalIdsForThisResponse.push(proposalId);

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
                    if (isSupabaseConnectedRef.current) return;
                    setShowDatabaseSetup(true);
                }, 1000); // Small delay for better UX
            }

            // Handle file edits if any
            if (data.fileEdits && data.fileEdits.length > 0) {
                dispatchAiAgentEvent("file_edits_received", {
                    appId,
                    userId: user?.uid || null,
                    count: Array.isArray(data?.fileEdits) ? data.fileEdits.length : 0,
                    creditRequestId:
                        (typeof data?.restorePointId === "string" && data.restorePointId) ||
                        `ai_agent_${appId}_${userMessage.id}`,
                });
                const creditRequestId =
                    (typeof data?.restorePointId === "string" && data.restorePointId) ||
                    `ai_agent_${appId}_${userMessage.id}`;

                // Safety: if the agent also proposed DB changes, don't persist/apply code changes yet.
                // This prevents the preview from breaking on missing schema until the user confirms the migration.
                if (hasDbMigrations) {
                    const bundleId = `staged_${Date.now()}`;
                    const label = `AI edit (staged): ${input.slice(0, 50)}...`;
                    const fileEdits = (data.fileEdits as Array<any>)
                        .filter((e) => e && typeof e.path === "string" && typeof e.content === "string")
                        .map((e) => ({ path: e.path, content: e.content }));

                    setStagedBundles((prev) => [
                        ...prev,
                        {
                            id: bundleId,
                            createdAt: Date.now(),
                            label,
                            proposalIds: proposalIdsForThisResponse,
                            appliedProposalIds: {},
                            fileEdits,
                            creditRequestId,
                        },
                    ]);

                    // Link the staged code bundle to one migration message so we keep a single DB confirmation modal.
                    if (proposalIdsForThisResponse.length > 0) {
                        const attachTo = proposalIdsForThisResponse[0];
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.migrationProposalId === attachTo
                                    ? {
                                        ...m,
                                        stagedBundleId: bundleId,
                                        content: `${m.content}\n\n(Your related code changes are staged and will apply automatically after this database update.)`,
                                    }
                                    : m
                            )
                        );
                    } else {
                        // Fallback: no proposal ID to attach to (e.g. DB not connected). Keep a single message with actions.
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: `staged_note_${Date.now()}`,
                                role: "assistant",
                                content:
                                    "I staged the code changes for this request because it requires a database update, but I couldn’t create a migration proposal yet. Connect your database and ask me to retry, or discard the staged code changes.",
                                timestamp: new Date(),
                                type: "text",
                                stagedBundleId: bundleId,
                            },
                        ]);
                    }

                    const rid = typeof data?.restorePointId === "string" ? data.restorePointId : null;
                    if (rid) {
                        setLastRestorePointId(rid);
                        setMessages((prev) => [
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

                } else {
                    createCheckpoint(`AI edit: ${input.slice(0, 50)}...`);

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
            }

            if (isFreeCompileFixMode) {
                setFreeCompileFixContext(null);
            }
        } catch (err: any) {
            dispatchAiAgentEvent("client_error", {
                appId,
                userId: user?.uid || null,
                error: err?.message || String(err),
            });
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
            if (!chatDisabled) sendMessage();
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
                {messages.length === 0 && !isLoading ? (
                    <div className="text-center text-sm text-gray-500 py-10">
                        No chat messages yet.
                    </div>
                ) : null}

                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                        <div
                            className={`group relative max-w-[80%] rounded-lg p-3 ${message.role === "user"
                                ? "bg-purple-50 border border-purple-200 text-gray-900"
                                : "bg-orange-50 border border-orange-200"
                                }`}
                        >
                            <button
                                type="button"
                                onClick={() => dismissMessage(message.id)}
                                className="absolute top-1.5 right-1.5 rounded p-1 text-gray-500 hover:text-gray-900 hover:bg-black/5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                title="Dismiss message"
                                aria-label="Dismiss message"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>

                            <div className="whitespace-pre-wrap break-words text-sm">{renderTextWithLinks(message.content)}</div>

                            {message.stagedBundleId ? (
                                <div className="mt-2 text-[11px] text-gray-600">
                                    Code changes are staged (not saved) and will apply after the database update.
                                </div>
                            ) : null}
                            {/* Prominent warning/info for risky or pending migrations */}
                            {message.migrationProposalId && message.migrationSql && (message.migrationStatus === "PENDING" || message.migrationStatus === "APPLYING") && (
                                <div className={`my-3 flex items-center gap-2 ${message.migrationDestructive ? "text-amber-700" : "text-blue-700"}`}>
                                    {message.migrationDestructive ? (
                                        <AlertTriangle className="h-5 w-5" />
                                    ) : (
                                        <Database className="h-5 w-5" />
                                    )}
                                    <span className="font-bold text-base">
                                        Database update required
                                    </span>
                                </div>
                            )}

                            {message.migrationProposalId && message.migrationSql ? (
                                <div className="mt-3 space-y-2">
                                    <div className="rounded border border-gray-200 bg-white/70 p-3">
                                        {/* <div className="flex items-center justify-between gap-3"> */}
                                        {/* <div className="min-w-0"> */}
                                        {/* <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                                                    {message.migrationDestructive ? (
                                                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                                                    ) : null}
                                                    <span>
                                                        Database update
                                                    </span>
                                                </div> */}
                                        {/* </div> */}
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
                                        {/* </div> */}

                                        {showMigrationSqlByMessageId[message.id] && (
                                            <pre className="mt-2 max-h-56 overflow-auto rounded bg-white border border-gray-200 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                                                {message.migrationSql}
                                            </pre>
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
                                if (isSupabaseConnected) return;
                                setShowSupabaseAdvanced(false);
                                setShowSupabaseSetup(true);
                            }}
                            disabled={isSupabaseConnected}
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
                                <div className="text-xs text-gray-600">
                                    {isSupabaseConnected
                                        ? (
                                            <>
                                                <span className={supabaseDbReachable === false ? "text-red-600" : supabaseDbReachable === true ? "text-green-700" : "text-gray-600"}>
                                                    {supabaseDbReachable === false ? "Unreachable" : supabaseDbReachable === true ? "Healthy" : "Connected"}
                                                </span>
                                                {(supabaseProjectName || supabaseProjectRef) ? (
                                                    <span className="ml-1 font-medium text-gray-800">
                                                        &mdash; {supabaseProjectName || supabaseProjectRef}
                                                    </span>
                                                ) : null}
                                            </>
                                        )
                                        : "PostgreSQL with auth & real-time"}
                                </div>
                            </div>
                        </button>
                    </div>
                </div>
            )}

            {/* Supabase Setup Modal */}
            {allowDatabaseSetupUi && showSupabaseSetup && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl border border-black/10 shadow-xl p-6 max-w-md w-full mx-4">
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
                            <div className="rounded-xl border border-black/10 bg-white p-3">
                                <div className="text-sm font-semibold text-gray-900">Recommended</div>
                                <div className="text-sm text-gray-700 mt-1">
                                    Create a new Supabase project via OAuth. This is the safest setup and enables the guarded database migration flow.
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={handleCreateSupabaseProject}
                                    className="flex-1 bg-[#F55F2A] text-white py-2 px-4 rounded-full hover:bg-[#E04E1B] text-sm transition-colors"
                                >
                                    Create New Supabase Project
                                </button>
                                <a
                                    href="https://supabase.com/dashboard"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 px-3 py-2 rounded-full border border-black/10 hover:bg-gray-50 text-sm text-gray-700 flex items-center gap-2"
                                >
                                    Dashboard <ExternalLink className="w-4 h-4" />
                                </a>
                            </div>

                            <button
                                onClick={() => setShowSupabaseAdvanced((v) => !v)}
                                className="w-full text-left px-3 py-2 rounded-xl border border-black/10 hover:bg-gray-50 text-sm text-gray-800 flex items-center justify-between"
                            >
                                <span className="font-semibold">Advanced options</span>
                                {showSupabaseAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>

                            {showSupabaseAdvanced ? (
                                <div className="space-y-3 rounded-xl border border-black/10 bg-white p-3">
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
                            const dbBlocksApply = isSupabaseConnected && supabaseDbReachable === false;
                            const canApply = Boolean(proposalId) && migrationAcknowledge && typedOk && !isApplying && !dbBlocksApply;

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
                                                    This may change your database schema or data. Proceed carefully.
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

                                    {isSupabaseConnected ? (
                                        supabaseDbReachable === false ? (
                                            <div className={`mt-4 rounded-md border p-3 text-sm ${
                                                supabaseDbReason === "project_paused" || supabaseDbReason === "timeout_or_network"
                                                    ? "border-amber-200 bg-amber-50 text-amber-900"
                                                    : "border-red-200 bg-red-50 text-red-800"
                                            }`}>
                                                <div className="font-semibold">
                                                    {supabaseDbReason === "project_paused"
                                                        ? "Supabase project is paused"
                                                        : supabaseDbReason === "timeout_or_network"
                                                          ? "Database still resuming…"
                                                          : "Supabase is connected, but the database is unreachable"}
                                                </div>
                                                <div className={`mt-1 text-sm whitespace-pre-wrap ${
                                                    supabaseDbReason === "project_paused" || supabaseDbReason === "timeout_or_network"
                                                        ? "text-amber-800"
                                                        : "text-red-700"
                                                }`}>
                                                    {supabaseDbStatusText || "Database not reachable (project may be paused or deleted)."}
                                                </div>
                                                <div className="mt-2 flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => void checkSupabaseDbHealth({ silent: true })}
                                                        className={`px-2 py-1 text-xs bg-white rounded ${
                                                            supabaseDbReason === "project_paused" || supabaseDbReason === "timeout_or_network"
                                                                ? "border border-amber-200 hover:bg-amber-50"
                                                                : "border border-red-200 hover:bg-red-50"
                                                        }`}
                                                    >
                                                        Re-check
                                                    </button>
                                                    {supabaseDbLastCheckedAt ? (
                                                        <span className={`text-[11px] ${
                                                            supabaseDbReason === "project_paused" || supabaseDbReason === "timeout_or_network"
                                                                ? "text-amber-700/80"
                                                                : "text-red-700/80"
                                                        }`}>
                                                            Last checked {Math.max(1, Math.round((Date.now() - supabaseDbLastCheckedAt) / 1000))}s ago
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : supabaseDbReachable === null ? (
                                            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
                                                Checking Supabase database reachability…
                                            </div>
                                        ) : null
                                    ) : null}

                                    {/* <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
                                        <div className="font-semibold">What this is for</div>
                                        <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">
                                            {msg?.content || "Database update"}
                                        </div>
                                        <div className="mt-2 text-xs text-gray-600">
                                            Note: App “restore points” do not automatically undo database changes.
                                        </div>
                                    </div> */}
                                    {msg?.stagedBundleId ? (
                                        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
                                            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                                                <div className="text-sm font-semibold text-amber-900">Code changes are staged</div>
                                                <div className="mt-1 text-xs text-amber-900/80">
                                                    These code changes have not been saved yet to avoid breaking the app before the database update.
                                                    After you apply this migration, the code changes will apply automatically.
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const ok = window.confirm(
                                                                "Discard the staged code changes?\n\nThis will keep your app on the last working version."
                                                            );
                                                            if (!ok) return;
                                                            discardStagedBundle(msg.stagedBundleId!);
                                                        }}
                                                        className="px-3 py-1.5 text-xs font-semibold rounded border border-amber-200 bg-white text-amber-900 hover:bg-amber-100/60"
                                                    >
                                                        Discard staged code
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const ok = window.confirm(
                                                                "Apply the staged code changes now (without waiting for the database update)?\n\nThis can break the app if the schema isn’t updated yet."
                                                            );
                                                            if (!ok) return;
                                                            applyStagedBundle(msg.stagedBundleId!, { unsafe: true });
                                                        }}
                                                        className="px-3 py-1.5 text-xs font-semibold rounded border border-amber-200 bg-white text-amber-900 hover:bg-amber-100/60"
                                                        title="Unsafe: apply code before DB update"
                                                    >
                                                        Apply staged code (unsafe)
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}

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
                                                    const health = await checkSupabaseDbHealth({ silent: true });
                                                    if (!health.reachable) {
                                                        const detail = health?.error || supabaseDbStatusText || "Database not reachable";
                                                        setMessages((prev) =>
                                                            prev.map((m) =>
                                                                m.id === migrationReviewMessageId
                                                                    ? { ...m, migrationStatus: "FAILED", content: `${m.content}\n\nMigration failed: Supabase is unreachable.\n${detail}` }
                                                                    : m
                                                            )
                                                        );
                                                        return;
                                                    }

                                                    const headers = await withCsrfHeaders();
                                                    const res = await fetch("/api/supabase/migrations/apply", {
                                                        method: "POST",
                                                        headers,
                                                        body: JSON.stringify({ proposalId, confirm: `APPLY ${proposalId}`, appId }),
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

                                                    // If we staged code edits behind this migration, apply them now.
                                                    markMigrationApplied(proposalId);
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
                                            className={`flex-1 text-white py-2 px-4 rounded-md transition-colors disabled:opacity-50 ${destructive ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"
                                                }`}
                                        >
                                            {isApplying ? "Applying…" : "Apply"}
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
                        className="px-3 py-1 text-xs font-semibold bg-accent text-white rounded-full hover:bg-accent-dark disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                        onClick={() => {
                            if (topupBusy) return;
                            setTopupModalOpen(true);
                        }}
                        disabled={topupBusy}
                    >
                        <span>{topupBusy ? "Opening checkout…" : "Add credits"}</span>
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                </div>

                {topupModalOpen ? (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                        <div className="w-full max-w-lg rounded-2xl border border-black/10 bg-white shadow-xl">
                            <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
                                <div>
                                    <div className="text-lg font-semibold text-neutral-900">Top up AI credits</div>
                                    <div className="mt-0.5 text-xs text-neutral-600">
                                        1 AI edit costs {AI_EDIT_COST} credits.
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setTopupModalOpen(false)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                                    aria-label="Close"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="px-6 py-5">
                                {TOPUP_COMING_SOON ? (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                        Credit top-ups are currently disabled.
                                    </div>
                                ) : null}

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-[11px] font-semibold text-neutral-600">Credits</label>
                                        <select
                                            value={topupCredits}
                                            onChange={(e) => setTopupCredits(Number(e.target.value))}
                                            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-black/5"
                                            disabled={TOPUP_COMING_SOON || topupBusy}
                                        >
                                            {topupOptions.map((n) => (
                                                <option key={n} value={n}>
                                                    {n.toLocaleString()} credits
                                                </option>
                                            ))}
                                        </select>

                                        <div className="mt-2 text-[12px] text-neutral-700">
                                            ≈ {Math.max(1, Math.floor(topupCredits / AI_EDIT_COST)).toLocaleString()} AI edits
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                                            Total
                                        </div>
                                        <div className="mt-2 text-2xl font-semibold text-neutral-900">
                                            {(() => {
                                                const unit = topupConfig?.unitPriceCents ?? 3;
                                                const currency = (topupConfig?.currency ?? "usd").toLowerCase();
                                                const amount = ((topupCredits * unit) / 100).toFixed(2);
                                                return currency === "usd" ? `$${amount}` : `${currency.toUpperCase()} ${amount}`;
                                            })()}
                                        </div>
                                        <div className="mt-2 text-[11px] text-neutral-600">
                                            Top-ups never expire. Applied after Stripe confirms payment.
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-5 flex flex-col gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTopupModalOpen(false);
                                            void startCreditTopup(topupCredits);
                                        }}
                                        className="w-full rounded-full bg-accent text-white px-4 py-3 text-sm font-semibold hover:bg-accent-dark disabled:opacity-60 disabled:cursor-not-allowed"
                                        disabled={TOPUP_COMING_SOON || topupBusy}
                                    >
                                        Continue to Stripe
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTopupModalOpen(false);
                                            window.location.href = "/price#topup";
                                        }}
                                        className="w-full rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
                                    >
                                        View pricing
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {chatDisabled ? (
                    <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                        Preview is still loading. Chat will unlock once the preview renders.
                    </div>
                ) : null}

                {freeCompileFixContext ? (
                    <div className="mb-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
                        Free compile-fix mode is active. Keep the payload unchanged to send a free quick fix.
                    </div>
                ) : null}

                <div className="flex items-stretch overflow-hidden rounded-xl border border-gray-300 bg-white">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => {
                            const nextValue = e.target.value;
                            if (freeCompileFixContext) {
                                const lockedValue = buildCompileFixPrefill(freeCompileFixContext);
                                if (nextValue !== lockedValue) {
                                    const notice = "Free compile-fix mode was disabled because the immutable context was edited. This request now uses normal billed mode.";
                                    setFreeCompileFixContext(null);
                                    setInput(nextValue);
                                    setMessages((prev) => [
                                        ...prev,
                                        {
                                            id: `compile_fix_unlocked_${Date.now()}`,
                                            role: "assistant",
                                            content: notice,
                                            timestamp: new Date(),
                                            type: "text",
                                        },
                                    ]);
                                    return;
                                }
                            }
                            setInput(nextValue);
                        }}
                        onKeyPress={handleKeyPress}
                        placeholder="Ask me to build something..."
                        className="flex-1 resize-none bg-transparent p-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                        rows={3}
                        disabled={isLoading || chatDisabled}
                    />
                    <button
                        type="button"
                        onClick={sendMessage}
                        disabled={!input.trim() || isLoading || chatDisabled}
                        className="flex w-14 items-center justify-center border-l border-gray-200 bg-white text-accent transition hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Send message"
                    >
                        <Send className="h-6 w-6" />
                    </button>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                    Press Enter to send, Shift+Enter for new line
                </div>
            </div>
        </div>
    );
}
