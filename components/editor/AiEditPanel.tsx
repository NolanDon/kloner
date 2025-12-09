"use client";

import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Info } from "lucide-react";

export interface AiEditSuggestion {
    id: string;
    renderId: string;
    prompt: string;
    summary: string;
    beforeHtml: string; // original block HTML
    afterHtml: string;  // AI-edited block HTML
    createdAt: string;  // ISO string from API (or may be missing / invalid)
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

    // push the full AI history up whenever it changes
    onAiHistoryChange?: (items: AiEditSuggestion[]) => void;
}

const PLACEHOLDERS = [
    "Soften the hero headline.",
    "Make the CTA button more direct.",
    "Tighten spacing in this section.",
    "Shorten this copy to two sentences.",
    "Increase contrast on the hero text.",
];

// hard cap for user prompt text
const MAX_PROMPT_CHARS = 200;

// max size for selected HTML block before we reject it
const MAX_SELECTION_CHARS = 8000;

// Safe formatter so we never show "Invalid Date"
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
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const [collapsed, setCollapsed] = useState(true);

    const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
    const [creditsLimit, setCreditsLimit] = useState<number | null>(null);
    const [tier, setTier] = useState<string | undefined>(undefined);

    const [attachedImage, setAttachedImage] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (onAiHistoryChange) onAiHistoryChange(suggestions);
    }, [suggestions, onAiHistoryChange]);

    // “scoped” means selectionMeta.has is true
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
            try {
                const rid = renderId ?? "";
                const res = await fetch(
                    `/api/ai-edit${rid ? `?renderId=${encodeURIComponent(rid)}` : ""}`,
                    { credentials: "include" }
                );
                if (!res.ok) return;
                const j = await res.json();
                if (!cancelled) {
                    const all: AiEditSuggestion[] = j.suggestions || [];
                    setSuggestions(all);
                    applyCreditsMeta(j.meta);
                }
            } catch {
                // ignore
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

            const all: AiEditSuggestion[] = j.suggestions || [];
            setSuggestions(all);
            setPrompt("");
            setAttachedImage(null);

            applyCreditsMeta(j.meta);

            const latest: AiEditSuggestion | undefined =
                (j.suggestion as AiEditSuggestion | undefined) ||
                (Array.isArray(all) && all.length ? all[0] : undefined);

            if (latest && latest.afterHtml) {
                setActivePreviewId(latest.id);
                onApplyBlockHtml(latest.afterHtml, targetPath || undefined);
                setCollapsed(false);
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

    // History items no longer affect the editor; they can only be dismissed
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

    return (
        <div className="flex h-full flex-col rounded-xl border border-neutral-200 bg-white/95 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
                <div className="space-y-0.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                        AI Edit Assistant
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-neutral-600">
                        <span>
                            Ask for small, focused changes to the selected block.
                        </span>
                        <span title="AI edits only affect the block you have selected in the preview." />
                    </div>
                </div>
                {creditsText && (
                    <div
                        className="rounded-full whitespace-nowrap bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-white"
                        title="Monthly AI edit credits for this account."
                    >
                        {creditsText}
                    </div>
                )}
            </div>

            {/* Chat log */}
            <div className="flex-1 space-y-3 overflow-y-auto bg-gradient-to-b from-white via-white to-neutral-50 px-3 py-3 text-[12px]">
                {error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                        {error}
                    </div>
                )}

                {orderedSuggestions.length === 0 ? (
                    <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 text-center">
                        <p className="text-[12px] text-neutral-500">
                            No AI edits yet for this page. Select a block in the preview,
                            describe a small change below, and your conversation will show
                            up here.
                        </p>
                    </div>
                ) : (
                    orderedSuggestions.map((s) => (
                        <div key={s.id} className="space-y-1">
                            {/* User bubble */}
                            <div className="flex justify-end">
                                <div className="max-w-[80%] rounded-2xl bg-[var(--accent,#f55f2a)] px-3 py-1.5 text-white shadow-sm">
                                    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80">
                                        You
                                    </div>
                                    <div className="text-[12px]">{s.prompt}</div>
                                </div>
                            </div>

                            {/* AI bubble */}
                            <div className="flex justify-start">
                                <div className="max-w-[85%] rounded-2xl border border-neutral-200 bg-white px-3 py-1.5 text-neutral-900 shadow-sm">
                                    <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-neutral-400">
                                        <span>AI edit</span>
                                        <span>{formatCreatedAt(s.createdAt)}</span>
                                    </div>
                                    <div className="text-[12px] text-neutral-800">
                                        {s.summary ||
                                            "Updated the selected block based on your request."}
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-[10px] text-neutral-500">
                                        <span>
                                            This change has been applied to your selected block.
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleDismiss(s.id)}
                                            className="text-[10px] font-medium text-neutral-500 hover:text-red-500"
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
            </div>

            {/* Input/footer */}
            <div className="border-t border-neutral-200 bg-white px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] text-neutral-600">
                        Tell our AI what you want changed or fixed in the selected block.
                        The more specific you are, the better the result.
                    </span>
                    {prompt.length > 0 && (
                        <span className="text-[11px] text-neutral-400">
                            {prompt.length}/{MAX_PROMPT_CHARS}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Attach image + small icons */}
                    <div className="flex items-center gap-1">
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
                                className="truncate text-[11px] text-neutral-500 max-w-[120px]"
                                title={attachedImage.name}
                            >
                                {attachedImage.name}
                            </span>
                        )}
                    </div>

                    {/* Text input */}
                    <div className="flex flex-1 items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 shadow-sm">
                        <span className="hidden h-7 w-7 items-center justify-center rounded-full bg-[var(--accent,#f55f2a)] text-[11px] font-semibold text-white sm:inline-flex">
                            AI
                        </span>
                        <input
                            type="text"
                            value={prompt}
                            onChange={(e) => {
                                const value = e.target.value.slice(0, MAX_PROMPT_CHARS);
                                setPrompt(value);
                                if (error) setError(null);
                            }}
                            maxLength={MAX_PROMPT_CHARS}
                            placeholder={
                                placeholder ||
                                "Ask for a small, specific change to this block…"
                            }
                            className="h-8 w-full bg-transparent text-[13px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
                            disabled={loading}
                        />
                    </div>

                    {/* Send button */}
                    <button
                        type="button"
                        onClick={handleRun}
                        disabled={generateDisabled}
                        className={`inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition ${generateDisabled
                            ? "cursor-not-allowed bg-neutral-200 text-neutral-500"
                            : "bg-[var(--accent,#f55f2a)] text-white shadow-sm hover:brightness-110 active:brightness-95"
                            }`}
                        title={
                            generateDisabled
                                ? "Select a block and enter a prompt to apply an edit."
                                : "Send this request to the AI editor."
                        }
                    >
                        {loading ? "Applying…" : "Apply"}
                    </button>
                </div>

                <div className="mt-1 min-h-[18px] text-[11px]">
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
    );
}
