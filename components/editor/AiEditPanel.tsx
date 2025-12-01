"use client";

import { useEffect, useState } from "react";

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
    renderId: string;
    getSelectedBlockHtml: () => string | null;
    selectionMeta?: SelectionMeta;

    // now also receives the targetPath
    onApplyBlockHtml: (blockHtml: string, targetPath?: string | null) => void;

    // optional hook so PreviewEditor can show loading on the block
    onAiEditingStateChange?: (isEditing: boolean, targetPath?: string | null) => void;
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

    // Single source of truth: “scoped” means selectionMeta.has is true
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
                const res = await fetch(
                    `/api/ai-edit?renderId=${encodeURIComponent(renderId)}`,
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

        setLoading(true);
        setError(null);

        // optional: tell PreviewEditor to show “editing” state on this block
        if (onAiEditingStateChange) {
            try {
                onAiEditingStateChange(true, targetPath);
            } catch {
                // ignore
            }
        }

        try {
            const res = await fetch("/api/ai-edit", {
                method: "POST",
                credentials: "include",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    renderId,
                    html: blockHtml,
                    prompt: prompt.trim(),
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

            applyCreditsMeta(j.meta);

            // pick the latest suggestion – prefer explicit `suggestion`, else newest in `suggestions`
            const latest: AiEditSuggestion | undefined =
                (j.suggestion as AiEditSuggestion | undefined) ||
                (Array.isArray(all) && all.length ? all[0] : undefined);

            if (latest && latest.afterHtml) {
                setActivePreviewId(latest.id);
                onApplyBlockHtml(latest.afterHtml, targetPath || undefined);
                setCollapsed(false); // auto-open the history rail when a new change arrives
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
            ? `Remaining this month: ${Math.max(creditsRemaining ?? 0, 0)} / ${creditsLimit}`
            : creditsLimit === 0
                ? "Your plan includes unlimited AI edits this month."
                : null;

    const atMaxChars =
        MAX_PROMPT_CHARS > 0 && prompt.length >= MAX_PROMPT_CHARS;

    return (
        <>
            {/* centered input bar above canvas */}
            <div className="mb-4 flex justify-center mt-2">
                <div className="w-full max-w-[820px]">
                    <div className="mb-1 flex items-center justify-between px-1">
                        <span className="ml-2 text-[13px] font-semibold uppercase tracking-wide text-neutral-700">
                            AI assist
                        </span>
                        {loading && (
                            <span className="text-[11px] text-neutral-500">
                                Thinking…
                            </span>
                        )}
                    </div>

                    {error && (
                        <p className="mt-1 px-1 text-[11px] text-red-600">
                            {error}
                        </p>
                    )}

                    <div className="flex items-center gap-1 rounded-full bg-neutral-900 px-3 py-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.35)] mt-2">
                        <input
                            type="text"
                            value={prompt}
                            onChange={(e) => {
                                const value = e.target.value.slice(0, MAX_PROMPT_CHARS);
                                setPrompt(value);
                                if (error) setError(null);
                            }}
                            maxLength={MAX_PROMPT_CHARS}
                            placeholder={placeholder}
                            className="px-2 h-[48px] w-full max-w-[820px] bg-transparent text-[16px] leading-[1.2] text-neutral-50 placeholder:text-neutral-400 focus:outline-none"
                            disabled={loading}
                        />

                        <button
                            type="button"
                            onClick={handleRun}
                            disabled={generateDisabled}
                            className={`inline-flex h-12 items-center whitespace-nowrap justify-center rounded-full px-3 text-[13px] font-semibold transition ${generateDisabled
                                ? "cursor-not-allowed bg-neutral-700 text-neutral-400"
                                : "bg-[var(--accent,#f55f2a)] text-white hover:brightness-110"
                                }`}
                        >
                            {loading ? "Generating…" : "Suggest for 5 credits"}
                        </button>
                    </div>

                    {atMaxChars ? (
                        <p className="mt-2 px-1 text-[14px] text-red-600">
                            Max {MAX_PROMPT_CHARS} characters reached.
                        </p>
                    ) : (
                        <div className="ml-4 mt-4 px-1 min-h-[22px] text-[14px]">
                            {(!hasScopedBlock && prompt.length > 0) && (
                                <p className="text-amber-600">
                                    No section is selected. Click a block in the preview
                                    before asking for a change.
                                </p>
                            )}

                            {(hasScopedBlock && prompt.length > 0) && (
                                <p className="text-emerald-600">
                                    Changes will only take affect on your selection below.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* history rail / dropdown on the right */}
            <aside className="pointer-events-none fixed top-10 ml-4 hidden w-72 lg:flex">
                {collapsed ? (
                    // collapsed: small dropdown-style pill
                    <button
                        type="button"
                        onClick={() => setCollapsed(false)}
                        className="pointer-events-auto inline-flex items-center justify-center gap-1 rounded-full border border-neutral-300 bg-white/95 px-3 py-1.5 text-[12px] font-medium text-neutral-700 shadow-md"
                    >
                        <span className="leading-none">Show AI history</span>
                        <span className="text-[11px] text-neutral-500 leading-none translate-y-[0.5px]">
                            ▼
                        </span>
                    </button>

                ) : (
                    // expanded: full aside panel
                    <div className="pointer-events-auto flex max-h-64 w-full flex-col rounded-xl border border-neutral-200 bg-white/95 px-3 py-3 text-[16px] shadow-md">
                        <div className="mb-2 flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className="font-semibold text-neutral-800">
                                    Recent AI suggestions
                                </span>
                                <span className="text-[12px] text-neutral-500">
                                    Last 5
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setCollapsed(true)}
                                className="ml-4 rounded-full bg-accent px-2 py-0.5 text-[12px] text-white"
                            >
                                Hide
                            </button>
                        </div>

                        <p className="mb-2 text-[11px] text-neutral-500">
                            History is for reference only. Use the main editor
                            controls to save or discard changes.
                        </p>

                        <div className="flex-1 space-y-2 overflow-y-auto">
                            {suggestions.length === 0 && (
                                <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-2 py-2 text-[11px] text-neutral-400">
                                    No suggestions yet. Ask for a change above.
                                </div>
                            )}

                            {suggestions.slice(0, 5).map((s) => {
                                const active = activePreviewId === s.id;
                                const createdLabel = formatCreatedAt(s.createdAt);

                                return (
                                    <div
                                        key={s.id}
                                        className={`flex flex-col gap-1 rounded-md border bg-white px-2 py-1.5 text-[11px] transition ${active
                                            ? "border-[rgba(245,95,42,0.8)] bg-[rgba(245,95,42,0.02)]"
                                            : "border-neutral-200 hover:border-neutral-300"
                                            }`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate font-medium text-neutral-900">
                                                    {s.summary || "Minimal edit"}
                                                </div>
                                                <div className="line-clamp-2 text-[11px] text-neutral-500">
                                                    {s.prompt}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-1 flex items-center justify-between">
                                            {createdLabel ? (
                                                <span className="text-[11px] text-neutral-400">
                                                    {createdLabel}
                                                </span>
                                            ) : (
                                                <span />
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleDismiss(s.id)}
                                                className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white"
                                            >
                                                Dismiss
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </aside>
        </>
    );
}
