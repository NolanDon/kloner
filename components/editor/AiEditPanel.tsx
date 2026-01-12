"use client";

import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Info, ArrowUpRight, Loader2, Rocket } from "lucide-react";

export interface AiEditSuggestion {
    id: string;
    renderId: string;
    prompt: string;
    summary: string;
    beforeHtml: string;
    afterHtml: string;
    createdAt: string;
    requestId?: string;
}

type SelectionMeta = {
    has: boolean;
    tagName?: string;
    path?: string | null;
};

interface AiEditPanelProps {
    renderId: string | undefined;
    refreshNonce?: number;
    getSelectedBlockHtml: () => string | null;
    selectionMeta?: SelectionMeta;
    onApplyBlockHtml: (blockHtml: string, targetPath?: string | null) => void;
    onAiEditingStateChange?: (isEditing: boolean, targetPath?: string | null) => void;
    onAiHistoryChange?: (items: AiEditSuggestion[]) => void;
}

const MAX_PROMPT_CHARS = 200;
const MAX_SELECTION_CHARS = 16000;

type CreditsMeta = {
    tier?: string;
    creditsRemaining: number | null;
    creditsLimit: number | null;
};

type HistoryFetchResult = {
    res: Response;
    json: any;
};

type LoadingPhase = "idle" | "short" | "long";

function normalizeCreatedAt(raw: any): string {
    if (!raw) return "";
    if (typeof raw === "string") return raw;
    if (raw instanceof Date) return raw.toISOString();
    if (typeof raw === "number") {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? "" : d.toISOString();
    }
    if (typeof raw === "object" && typeof raw._seconds === "number") {
        const ms =
            raw._seconds * 1000 +
            (typeof raw._nanoseconds === "number" ? Math.floor(raw._nanoseconds / 1e6) : 0);
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? "" : d.toISOString();
    }
    return "";
}

function formatCreatedAt(value: string | undefined | null): string {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

const GLOBAL_HISTORY_CACHE_KEY = "__kloner_ai_history_fetch__";

async function getHistoryFetchOnce(renderId: string): Promise<HistoryFetchResult> {
    if (typeof window === "undefined") {
        return fetch(`/api/ai-edit?renderId=${encodeURIComponent(renderId)}`, {
            credentials: "include",
        }).then(async (res) => {
            const json = await res.json().catch(() => null);
            return { res, json };
        });
    }

    const win = window as any;
    if (!win[GLOBAL_HISTORY_CACHE_KEY]) {
        win[GLOBAL_HISTORY_CACHE_KEY] = {};
    }
    const cache: Record<string, Promise<HistoryFetchResult>> = win[GLOBAL_HISTORY_CACHE_KEY];

    if (await cache[renderId]) {
        return cache[renderId];
    }

    const p: Promise<HistoryFetchResult> = fetch(
        `/api/ai-edit?renderId=${encodeURIComponent(renderId)}`,
        { credentials: "include" }
    )
        .then(async (res) => {
            const json = await res.json().catch(() => null);
            return { res, json };
        })
        .finally(() => {
            delete cache[renderId];
        });

    cache[renderId] = p;
    return p;
}

async function getHistoryFetchForce(renderId: string): Promise<HistoryFetchResult> {
    const res = await fetch(`/api/ai-edit?renderId=${encodeURIComponent(renderId)}`, {
        credentials: "include",
        cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    return { res, json };
}

function makeRequestId(): string {
    try {
        // modern browsers
        // eslint-disable-next-line no-undef
        return crypto.randomUUID();
    } catch {
        return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
}

export default function AiEditPanel(props: AiEditPanelProps) {
    const {
        renderId,
        refreshNonce,
        getSelectedBlockHtml,
        selectionMeta,
        onApplyBlockHtml,
        onAiEditingStateChange,
        onAiHistoryChange,
    } = props;

    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("idle");
    const [historyLoading, setHistoryLoading] = useState(false);
    const [suggestions, setSuggestions] = useState<AiEditSuggestion[]>([]);
    const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [historyError, setHistoryError] = useState<string | null>(null);

    const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
    const [creditsLimit, setCreditsLimit] = useState<number | null>(null);
    const [tier, setTier] = useState<string | undefined>(undefined);

    const [attachedImage, setAttachedImage] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const hasScopedBlock = !!selectionMeta?.has;
    const targetPath = selectionMeta?.path ?? null;

    const [pendingSuggestionId, setPendingSuggestionId] = useState<string | null>(null);

    useEffect(() => {
        if (onAiHistoryChange) onAiHistoryChange(suggestions);
    }, [suggestions, onAiHistoryChange]);

    function applyCreditsMeta(meta: CreditsMeta | any) {
        if (!meta) return;
        if (typeof meta.tier === "string") setTier(meta.tier);
        if (typeof meta.creditsLimit === "number") setCreditsLimit(meta.creditsLimit);
        else setCreditsLimit(null);

        if (typeof meta.creditsRemaining === "number") setCreditsRemaining(meta.creditsRemaining);
        else setCreditsRemaining(null);
    }

    useEffect(() => {
        let cancelled = false;

        async function loadSuggestions() {
            if (!renderId) {
                setSuggestions([]);
                applyCreditsMeta(null);
                setHistoryError(null);
                setHistoryLoading(false);
                return;
            }

            setHistoryLoading(true);

            try {
                const isForced = typeof refreshNonce === "number" && refreshNonce > 0;
                const { res, json: j } = isForced
                    ? await getHistoryFetchForce(renderId)
                    : await getHistoryFetchOnce(renderId);

                if (cancelled) return;

                if (!res.ok) {
                    setHistoryError(j?.error || `Failed to load AI edit history (status ${res.status}).`);

                    const rawSuggestions: any[] = Array.isArray(j?.suggestions) ? j.suggestions : [];
                    const normalized: AiEditSuggestion[] = rawSuggestions.map((s) => ({
                        ...s,
                        createdAt: normalizeCreatedAt((s as any).createdAt),
                    }));

                    setSuggestions(normalized);
                    applyCreditsMeta(j?.meta);
                    setHistoryLoading(false);
                    return;
                }

                const rawAll: any[] = Array.isArray(j?.suggestions) ? j.suggestions : [];
                const all: AiEditSuggestion[] = rawAll.map((s) => ({
                    ...s,
                    createdAt: normalizeCreatedAt((s as any).createdAt),
                }));

                setSuggestions(all);
                applyCreditsMeta(j?.meta);
                setHistoryError(null);
                setHistoryLoading(false);
            } catch {
                if (cancelled) return;
                setHistoryError("Failed to load AI edit history. It will update after your next edit.");
                setHistoryLoading(false);
            }
        }

        loadSuggestions();

        return () => {
            cancelled = true;
        };
    }, [renderId, refreshNonce]);

    useEffect(() => {
        if (!loading) {
            setLoadingPhase("idle");
            return;
        }
        setLoadingPhase("short");
        const timer = setTimeout(() => {
            setLoadingPhase((phase) => (phase === "short" ? "long" : phase));
        }, 7000);
        return () => clearTimeout(timer);
    }, [loading]);

    const handleRun = async () => {
        if (loading) return;

        if (!prompt.trim()) {
            setError("Describe one small change you want.");
            return;
        }

        if (!hasScopedBlock) {
            setError("Select a block in the preview first.");
            return;
        }

        const blockHtmlRaw = getSelectedBlockHtml();
        if (!blockHtmlRaw || !blockHtmlRaw.trim()) {
            setError("Select a block in the preview first.");
            return;
        }

        const blockHtml = blockHtmlRaw.trim();

        if (blockHtml.length > MAX_SELECTION_CHARS) {
            setError(
                `This selection is too large for a focused AI edit. Try selecting a smaller section. \n ${blockHtml.length}`
            );
            return;
        }

        const basePrompt = prompt.trim();
        const promptForApi = attachedImage
            ? `${basePrompt}\n\n[Attached image: ${attachedImage.name}]`
            : basePrompt;

        const clientRequestId = makeRequestId();

        const optimisticId = `pending-${Date.now()}`;
        const optimisticCreatedAt = new Date().toISOString();
        setPendingSuggestionId(optimisticId);
        setSuggestions((prev) => [
            ...prev,
            {
                id: optimisticId,
                renderId: renderId ?? "",
                prompt: basePrompt,
                summary: "",
                beforeHtml: blockHtml,
                afterHtml: "",
                createdAt: optimisticCreatedAt,
                requestId: clientRequestId,
            },
        ]);

        setLoading(true);
        setError(null);

        if (onAiEditingStateChange) {
            try {
                onAiEditingStateChange(true, targetPath);
            } catch { }
        }

        try {
            const csrf = await ensureSessionAndCsrf();

            const res = await fetch("/api/ai-edit", {
                method: "POST",
                credentials: "include",
                headers: {
                    "content-type": "application/json",
                    "x-csrf": csrf ?? "",
                },
                body: JSON.stringify({
                    renderId,
                    html: blockHtml,
                    prompt: promptForApi,
                    requestId: clientRequestId,
                }),
            });

            const j = await res.json().catch(() => ({}));

            if (!res.ok) {
                const msg =
                    j?.error ||
                    (j?.debug?.imageErrorMessage ? String(j.debug.imageErrorMessage) : "") ||
                    `AI edit failed (status ${res.status})`;

                setError(msg);
                applyCreditsMeta(j?.meta);

                // remove optimistic entry on error
                setSuggestions((prev) => prev.filter((s) => s.id !== optimisticId));
                setPendingSuggestionId(null);
                return;
            }

            const rawSuggestionsFromApi: any[] | null = Array.isArray(j.suggestions) ? j.suggestions : null;
            const rawSuggestionFromApi: any | undefined = j.suggestion;

            const suggestionsFromApi: AiEditSuggestion[] | null =
                rawSuggestionsFromApi &&
                rawSuggestionsFromApi.map((s) => ({
                    ...s,
                    createdAt: normalizeCreatedAt(s.createdAt),
                }));

            const suggestionFromApi: AiEditSuggestion | undefined =
                rawSuggestionFromApi && {
                    ...rawSuggestionFromApi,
                    createdAt: normalizeCreatedAt(rawSuggestionFromApi.createdAt),
                };

            setSuggestions((prev) => {
                const baseList = prev.filter((s) => s.id !== optimisticId);
                if (suggestionsFromApi && suggestionsFromApi.length) return suggestionsFromApi;

                if (suggestionFromApi) {
                    const exists = baseList.some((s) => s.id === suggestionFromApi.id);
                    if (exists) return baseList.map((s) => (s.id === suggestionFromApi.id ? suggestionFromApi : s));
                    return [...baseList, suggestionFromApi];
                }

                return baseList;
            });

            setPrompt("");
            setAttachedImage(null);
            setPendingSuggestionId(null);

            applyCreditsMeta(j.meta);

            const latest: AiEditSuggestion | undefined =
                suggestionFromApi ||
                (suggestionsFromApi && suggestionsFromApi.length ? suggestionsFromApi[0] : undefined);

            if (latest && latest.afterHtml) {
                setActivePreviewId(latest.id);
                onApplyBlockHtml(latest.afterHtml, targetPath || undefined);
            } else {
                // server should not return 200 without afterHtml, but fail-safe:
                setError("AI edit returned no changes. No credits should have been consumed.");
            }
        } catch (err) {
            setError("Network error while calling AI edit");
            setSuggestions((prev) => prev.filter((s) => s.id !== optimisticId));
            setPendingSuggestionId(null);
        } finally {
            setLoading(false);
            if (onAiEditingStateChange) {
                try {
                    onAiEditingStateChange(false, targetPath);
                } catch { }
            }
        }
    };

    const handleDismiss = (id: string) => {
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
        if (activePreviewId === id) setActivePreviewId(null);
    };

    const generateDisabled = loading || !prompt.trim() || !hasScopedBlock;
    const placeholder = "Ask for revisions...";

    const creditsText =
        typeof creditsLimit === "number" && creditsLimit > 0
            ? `Credits: ${Math.max(creditsRemaining ?? 0, 0)} / ${creditsLimit}`
            : creditsLimit === 0
                ? "Your plan includes unlimited AI edits this month."
                : null;

    const atMaxChars = MAX_PROMPT_CHARS > 0 && prompt.length >= MAX_PROMPT_CHARS;

    const orderedSuggestions = [...suggestions].sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return da - db;
    });

    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (scrollContainerRef.current) {
            const el = scrollContainerRef.current;
            el.scrollTop = el.scrollHeight;
        }
    }, [orderedSuggestions.length]);

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (!generateDisabled) handleRun();
        }
    };

    const loadingLabel = "Thinking… this may take a while…";

    // Example quick prompts shown in the welcome card
    // Enhanced prompt suggestions based on selection context
    const getSmartSuggestions = () => {
        const tagName = selectionMeta?.tagName?.toLowerCase();
        const baseSuggestions = [
            "Make this section more visually appealing",
            "Improve the typography and spacing",
            "Add a subtle animation or hover effect",
            "Enhance the color scheme",
        ];

        if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
            return [
                "Make this heading more impactful",
                "Change the font style and size",
                "Add a gradient text effect",
                "Improve the heading hierarchy",
            ];
        }

        if (tagName === 'button' || tagName?.includes('button')) {
            return [
                "Make this button more prominent",
                "Add hover and click animations",
                "Change the button style and colors",
                "Improve button accessibility",
            ];
        }

        if (tagName === 'img' || tagName?.includes('image')) {
            return [
                "Add a border or shadow to this image",
                "Make the image responsive",
                "Add a hover zoom effect",
                "Optimize image presentation",
            ];
        }

        return baseSuggestions;
    };

    const smartSuggestions = getSmartSuggestions();

    useEffect(() => {
        // If there is no history and AI hasn't loaded anything, ensure the panel
        // visually shows a helpful welcome message. We keep prompt empty until
        // the user clicks an example.
    }, []);

    return (
        <>
            <div className="flex h-full flex-col">
                <div ref={scrollContainerRef} className="flex-1 min-h-0 space-y-4 overflow-y-auto px-3 py-3 text-sm">
                    {historyError && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                            {historyError}
                        </div>
                    )}

                    {historyLoading && !historyError && orderedSuggestions.length === 0 ? (
                        <div className="flex h-30 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 px-4 text-center text-sm text-neutral-500">
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin text-neutral-400 py-4" />
                                <span>Loading AI edit history…</span>
                            </div>
                        </div>
                    ) : orderedSuggestions.length === 0 && !historyError ? (
                        <div className="rounded-xl border border-neutral-200 bg-gradient-to-br from-accent/5 to-accent/10 px-4 py-6">
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-accent flex items-center justify-center text-white shadow-md">
                                    <Rocket className="h-5 w-5" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="mb-2 text-lg font-semibold text-neutral-900">
                                        Welcome to Maverick
                                    </h3>
                                    <p className="mb-4 text-sm text-neutral-600">
                                        Select any element in your preview and describe the changes you want to make.
                                        Here are some suggestions based on your current selection:
                                    </p>

                                <div className="flex flex-wrap gap-2">
                                    {smartSuggestions.map((suggestion) => (
                                        <button
                                            key={suggestion}
                                            type="button"
                                            onClick={() => setPrompt(suggestion)}
                                            className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-white px-3 py-2 text-xs font-medium text-accent shadow-sm hover:bg-accent/5 hover:border-accent/40 transition-colors"
                                        >
                                            <Rocket className="h-3 w-3" />
                                            {suggestion}
                                        </button>
                                    ))}
                                </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        orderedSuggestions.map((s) => {
                            const isOptimistic = s.id.startsWith("pending-");
                            return (
                                <div key={s.id} className="space-y-10">
                                    <div className="flex flex-col items-end gap-1">
                                        <div className="max-w-[80%] rounded-2xl bg-[var(--accent,#f55f2a)] px-3 py-1.5 text-white shadow-sm">
                                            <div className="text-[16px]">{s.prompt}</div>
                                        </div>
                                        <div className="pr-2 text-[10px] text-neutral-400">{formatCreatedAt(s.createdAt)}</div>
                                    </div>

                                    {!isOptimistic && (
                                        <div className="flex flex-col items-start gap-1">
                                            <div className="max-w-[85%] rounded-2xl border border-neutral-200 bg-white px-3 py-1.5 text-neutral-900 shadow-sm">
                                                <div className="text-[16px] text-neutral-800">
                                                    {s.summary || "Updated the selected block based on your request."}
                                                </div>
                                                <div className="mt-1 flex items-center justify-between text-[16px] text-neutral-500">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDismiss(s.id)}
                                                        className="text-[14px] font-medium text-neutral-500 hover:text-red-500"
                                                        title="Remove this entry from the chatlog."
                                                    >
                                                        Dismiss
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="pl-2 text-[10px] text-neutral-400">{formatCreatedAt(s.createdAt)}</div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {loadingPhase !== "idle" && (
                    <div className="mr-auto my-10 mx-2 inline-flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white/95 px-3 py-1 text-[16px] text-neutral-700 shadow-sm">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                        <span
                            className="bg-clip-text text-transparent"
                            style={{
                                backgroundImage: "linear-gradient(90deg,#4f46e5,#ec4899,#f97316)",
                                backgroundSize: "200% 200%",
                                animation: "kloner-ai-gradient-move 3s linear infinite",
                            }}
                        >
                            {loadingLabel}
                        </span>
                    </div>
                )}

                <div className="sticky bottom-0 border-t border-neutral-200 bg-white px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-neutral-400">
                            {prompt.length}/{MAX_PROMPT_CHARS}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-accent bg-white px-3 py-1 shadow-sm">
                            <input
                                type="text"
                                value={prompt}
                                onChange={(e) => {
                                    const value = e.target.value.slice(0, MAX_PROMPT_CHARS);
                                    setPrompt(value);
                                    if (error) setError(null);
                                }}
                                onKeyDown={handleInputKeyDown}
                                maxLength={MAX_PROMPT_CHARS}
                                placeholder={placeholder}
                                className="h-[50px] w-full bg-transparent text-[16px] leading-tight text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
                                disabled={loading}
                            />
                        </div>

                        <button
                            type="button"
                            onClick={handleRun}
                            disabled={generateDisabled}
                            className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold transition ${generateDisabled
                                ? "cursor-not-allowed bg-neutral-200 text-neutral-500"
                                : "bg-[var(--accent,#f55f2a)] text-white shadow-sm hover:brightness-110 active:brightness-95"
                                }`}
                            title={
                                generateDisabled
                                    ? "Select a block and enter a prompt to apply an edit."
                                    : "Send this request to the AI editor."
                            }
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                        </button>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-100"
                                title="Attach an image reference to this request."
                            >
                                <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                <span className="sr-only">Attach image</span>
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    setAttachedImage(file);
                                }}
                            />
                            {attachedImage && (
                                <span className="max-w-[160px] truncate text-[11px] text-neutral-500" title={attachedImage.name}>
                                    {attachedImage.name}
                                </span>
                            )}
                        </div>


                        <div className="min-h-[18px] text-right text-[11px]">
                            {atMaxChars ? (
                                <span className="text-red-500">Max {MAX_PROMPT_CHARS} characters reached.</span>
                            ) : !hasScopedBlock && prompt.length > 0 ? (
                                <span className="text-amber-600">No block selected. Click a section in the preview first.</span>
                            ) : hasScopedBlock && prompt.length > 0 ? (
                                <span className="text-neutral-600">This edit will only affect your current selection.</span>
                            ) : null}
                        </div>
                    </div>

                    {error && (
                        <div className="flex justify-center mt-2 rounded-md text-[11px] text-red-700">
                            {error}
                        </div>
                    )}
                </div>
            </div>

            <style jsx global>{`
                @keyframes kloner-ai-gradient-move {
                    0% {
                        background-position: 0% 50%;
                    }
                    50% {
                        background-position: 100% 50%;
                    }
                    100% {
                        background-position: 0% 50%;
                    }
                }
            `}</style>
        </>
    );
}
