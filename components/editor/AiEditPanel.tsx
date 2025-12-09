"use client";

import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import { useEffect, useRef, useState } from "react";
import {
    Image as ImageIcon,
    Info,
    ArrowUpRight,
    Loader2,
} from "lucide-react";

export interface AiEditSuggestion {
    id: string;
    renderId: string;
    prompt: string;
    summary: string;
    beforeHtml: string;
    afterHtml: string;
    createdAt: string;
}

type SelectionMeta = {
    has: boolean;
    tagName?: string;
    path?: string | null;
};

interface AiEditPanelProps {
    renderId: string | undefined;
    getSelectedBlockHtml: () => string | null;
    selectionMeta?: SelectionMeta;
    onApplyBlockHtml: (blockHtml: string, targetPath?: string | null) => void;
    onAiEditingStateChange?: (isEditing: boolean, targetPath?: string | null) => void;
    onAiHistoryChange?: (items: AiEditSuggestion[]) => void;
}

const PLACEHOLDERS = [
    "Ask for revisions...",
    "Soften the hero headline.",
    "Make the CTA button more direct.",
    "Tighten spacing in this section.",
    "Shorten this copy to two sentences.",
    "Increase contrast on the hero text.",
];

const MAX_PROMPT_CHARS = 200;
const MAX_SELECTION_CHARS = 8000;

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

type CreditsMeta = {
    tier?: string;
    creditsRemaining: number | null;
    creditsLimit: number | null;
};

export default function AiEditPanel(props: AiEditPanelProps) {
    const {
        renderId,
        getSelectedBlockHtml,
        selectionMeta,
        onApplyBlockHtml,
        onAiEditingStateChange,
        onAiHistoryChange,
    } = props;

    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [suggestions, setSuggestions] = useState<AiEditSuggestion[]>([]);
    const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [placeholderIndex, setPlaceholderIndex] = useState(0);

    const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
    const [creditsLimit, setCreditsLimit] = useState<number | null>(null);
    const [tier, setTier] = useState<string | undefined>(undefined);

    const [attachedImage, setAttachedImage] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (onAiHistoryChange) onAiHistoryChange(suggestions);
    }, [suggestions, onAiHistoryChange]);

    const hasScopedBlock = !!selectionMeta?.has;
    const targetPath = selectionMeta?.path ?? null;

    useEffect(() => {
        const id = setInterval(
            () => setPlaceholderIndex((i) => (i + 1) % PLACEHOLDERS.length),
            4000
        );
        return () => clearInterval(id);
    }, []);

    function applyCreditsMeta(meta: any) {
        if (!meta) return;
        if (typeof meta.tier === "string") setTier(meta.tier);
        if (typeof meta.creditsLimit === "number") {
            setCreditsLimit(meta.creditsLimit);
        } else {
            setCreditsLimit(null);
        }
        if (typeof meta.creditsRemaining === "number") {
            setCreditsRemaining(meta.creditsRemaining);
        } else {
            setCreditsRemaining(null);
        }
    }

    // initial load of history + credit meta
    useEffect(() => {
        let cancelled = false;

        async function loadSuggestions() {
            if (!renderId) {
                setSuggestions([]);
                applyCreditsMeta(null);
                setHistoryError(null);
                return;
            }

            try {
                const res = await fetch(
                    `/api/ai-edit?renderId=${encodeURIComponent(renderId)}`,
                    { credentials: "include" }
                );

                let j: any = null;
                try {
                    j = await res.json();
                } catch {
                    // ignore JSON parse errors; will fall back to empty
                }

                if (cancelled) return;

                if (!res.ok) {
                    setHistoryError(
                        j?.error ||
                        `Failed to load AI edit history (status ${res.status}).`
                    );
                    if (Array.isArray(j?.suggestions)) {
                        setSuggestions(j.suggestions as AiEditSuggestion[]);
                    } else {
                        setSuggestions([]);
                    }
                    applyCreditsMeta(j?.meta);
                    return;
                }

                const all: AiEditSuggestion[] = j?.suggestions || [];
                setSuggestions(all);
                applyCreditsMeta(j?.meta);
                setHistoryError(null);
            } catch (err: any) {
                if (cancelled) return;
                setHistoryError(
                    "Failed to load AI edit history. It will update after your next edit."
                );
            }
        }

        loadSuggestions();
        return () => {
            cancelled = true;
        };
    }, [renderId]);

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
                "This selection is too large for a focused AI edit. Try selecting a smaller section."
            );
            return;
        }

        const basePrompt = prompt.trim();
        const promptForApi = attachedImage
            ? `${basePrompt}\n\n[Attached image: ${attachedImage.name}]`
            : basePrompt;

        setLoading(true);
        setError(null);

        if (onAiEditingStateChange) {
            try {
                onAiEditingStateChange(true, targetPath);
            } catch {
                // ignore
            }
        }

        try {
            const csrf = await ensureSessionAndCsrf();

            const res = await fetch("/api/ai-edit", {
                method: "POST",
                credentials: "include",
                headers: {
                    "content-type": "application/json",
                    "x-kloner-csrf": csrf ?? "",
                },
                body: JSON.stringify({
                    renderId,
                    html: blockHtml,
                    prompt: promptForApi,
                }),
            });

            const j = await res.json().catch(() => ({}));

            if (!res.ok) {
                setError(j.error || "AI edit failed");
                applyCreditsMeta(j.meta);
                return;
            }

            // ---- updated suggestions handling so panel updates immediately ----
            const suggestionsFromApi: AiEditSuggestion[] | null =
                Array.isArray(j.suggestions) ? (j.suggestions as AiEditSuggestion[]) : null;
            const suggestionFromApi: AiEditSuggestion | undefined =
                j.suggestion as AiEditSuggestion | undefined;

            // update suggestions state without requiring a reload
            setSuggestions((prev) => {
                if (suggestionsFromApi && suggestionsFromApi.length) {
                    return suggestionsFromApi;
                }
                if (suggestionFromApi) {
                    const exists = prev.some((s) => s.id === suggestionFromApi.id);
                    if (exists) {
                        return prev.map((s) =>
                            s.id === suggestionFromApi.id ? suggestionFromApi : s
                        );
                    }
                    return [...prev, suggestionFromApi];
                }
                return prev;
            });

            setPrompt("");
            setAttachedImage(null);

            applyCreditsMeta(j.meta);

            const latest: AiEditSuggestion | undefined =
                suggestionFromApi ||
                (suggestionsFromApi && suggestionsFromApi.length
                    ? suggestionsFromApi[0]
                    : undefined);

            if (latest && latest.afterHtml) {
                setActivePreviewId(latest.id);
                onApplyBlockHtml(latest.afterHtml, targetPath || undefined);
            }
        } catch {
            setError("Network error while calling AI edit");
        } finally {
            setLoading(false);
            if (onAiEditingStateChange) {
                try {
                    onAiEditingStateChange(false, targetPath);
                } catch {
                    // ignore
                }
            }
        }
    };

    const handleDismiss = (id: string) => {
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
        if (activePreviewId === id) {
            setActivePreviewId(null);
        }
    };

    const generateDisabled = loading || !prompt.trim() || !hasScopedBlock;
    const placeholder = prompt.length === 0 ? PLACEHOLDERS[placeholderIndex] : "";

    const creditsText =
        typeof creditsLimit === "number" && creditsLimit > 0
            ? `Credits: ${Math.max(creditsRemaining ?? 0, 0)} / ${creditsLimit}`
            : creditsLimit === 0
                ? "Your plan includes unlimited AI edits this month."
                : null;

    const atMaxChars =
        MAX_PROMPT_CHARS > 0 && prompt.length >= MAX_PROMPT_CHARS;

    const orderedSuggestions = [...suggestions].sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
    });

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (!generateDisabled) {
                handleRun();
            }
        }
    };

    return (
        <div className="flex h-full flex-col rounded-xl border border-neutral-200 bg-white/95 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
                <div className="space-y-0.5">
                    <div className="text-[14px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                        AI Edit Assistant
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-neutral-600">
                        <span>
                            Ask for small, focused changes to the selected block.
                        </span>
                        <Info className="h-3 w-3 text-neutral-400" />
                    </div>
                </div>
                {creditsText && (
                    <div
                        className="rounded-full whitespace-nowrap bg-orange-500 px-2 py-0.5 text-[14px] font-medium text-white shadow-sm"
                        title="Monthly AI edit credits for this account."
                    >
                        {creditsText}
                    </div>
                )}
            </div>

            {/* Chat log */}
            <div className="flex-1 space-y-2 overflow-y-auto bg-gradient-to-b from-white via-white to-neutral-50 px-3 py-3 text-[12px]">
                {error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                        {error}
                    </div>
                )}

                {historyError && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                        {historyError}
                    </div>
                )}

                {orderedSuggestions.length === 0 && !historyError ? (
                    <div className="flex h-30 items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 text-center">
                        <p className="text-[12px] text-neutral-500">
                            No AI edits yet for this page. Select a block in the preview,
                            describe a small change below, and your conversation will show
                            up here.
                        </p>
                    </div>
                ) : (
                    orderedSuggestions.map((s) => (
                        <div key={s.id} className="space-y-10">
                            {/* User bubble */}
                            <div className="flex justify-end">
                                <div className="max-w-[80%] rounded-2xl bg-[var(--accent,#f55f2a)] px-3 py-1.5 text-white shadow-sm">
                                    <div className="text-[20px]">{s.prompt}</div>
                                </div>
                            </div>

                            {/* AI bubble */}
                            <div className="flex justify-start">
                                <div className="max-w-[85%] rounded-2xl border border-neutral-200 bg-white px-3 py-1.5 text-neutral-900 shadow-sm">
                                    <div className="text-[20px] text-neutral-800">
                                        {s.summary ||
                                            "Updated the selected block based on your request."}
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-[20px] text-neutral-500">
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
                            </div>
                        </div>
                    ))
                )}

                {loading && (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-3 py-1.5 text-[11px] text-neutral-600 shadow-sm">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" />
                        <span>Thinking… This may take a while…</span>
                    </div>
                )}
            </div>

            {/* Input/footer */}
            <div className="border-t border-neutral-200 bg-white px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                    {prompt.length > 0 && (
                        <span className="text-[11px] text-neutral-400">
                            {prompt.length}/{MAX_PROMPT_CHARS}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex flex-1 items-center gap-2 rounded-2xl border border-neutral-300 bg-white px-3 py-1 shadow-sm">
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
                            placeholder={
                                placeholder ||
                                "Ask for a small, specific change to this block…"
                            }
                            className="h-[80px] w-full bg-transparent text-[15px] leading-tight text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
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
                        {loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <ArrowUpRight className="h-4 w-4" />
                        )}
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
                            <span
                                className="max-w-[160px] truncate text-[11px] text-neutral-500"
                                title={attachedImage.name}
                            >
                                {attachedImage.name}
                            </span>
                        )}
                    </div>

                    <div className="min-h-[18px] text-right text-[11px]">
                        {atMaxChars ? (
                            <span className="text-red-500">
                                Max {MAX_PROMPT_CHARS} characters reached.
                            </span>
                        ) : !hasScopedBlock && prompt.length > 0 ? (
                            <span className="text-amber-600">
                                No block selected. Click a section in the preview first.
                            </span>
                        ) : hasScopedBlock && prompt.length > 0 ? (
                            <span className="text-emerald-600">
                                This edit will only affect your current selection.
                            </span>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
