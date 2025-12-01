// src/components/editor/AiEditPanel.tsx
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

    // NEW: optional hook so PreviewEditor can show loading on the block
    onAiEditingStateChange?: (isEditing: boolean, targetPath?: string | null) => void;
}

const PLACEHOLDERS = [
    "Soften the hero headline.",
    "Make the CTA button more direct.",
    "Tighten spacing in this section.",
    "Shorten this copy to two sentences.",
    "Increase contrast on the hero text.",
];

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

export default function AiEditPanel(props: AiEditPanelProps) {
    const { renderId, getSelectedBlockHtml, selectionMeta, onApplyBlockHtml } = props;

    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [suggestions, setSuggestions] = useState<AiEditSuggestion[]>([]);
    const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const [collapsed, setCollapsed] = useState(true);

    // Single source of truth: “scoped” means selectionMeta.has is true
    const hasScopedBlock = !!selectionMeta?.has;

    useEffect(() => {
        const id = setInterval(
            () => setPlaceholderIndex((i) => (i + 1) % PLACEHOLDERS.length),
            4000
        );
        return () => clearInterval(id);
    }, []);

    // initial load of history
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
                if (cancelled) return;
                setSuggestions(j.suggestions || []);
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

        const blockHtml = getSelectedBlockHtml();
        if (!blockHtml || !blockHtml.trim()) {
            setError("Select a block in the preview first.");
            return;
        }

        setLoading(true);
        setError(null);

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

            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                setError(j.error || "AI edit failed");
                return;
            }

            const j = await res.json();

            const all: AiEditSuggestion[] = j.suggestions || [];
            setSuggestions(all);
            setPrompt("");

            // pick the latest suggestion – prefer explicit `suggestion`, else newest in `suggestions`
            const latest: AiEditSuggestion | undefined =
                (j.suggestion as AiEditSuggestion | undefined) ||
                (Array.isArray(all) && all.length ? all[0] : undefined);

            if (latest && latest.afterHtml) {
                setActivePreviewId(latest.id);
                // Auto-apply the new block HTML into the iframe + draft state
                onApplyBlockHtml(latest.afterHtml);
                // auto-open the history rail when a new change arrives
                setCollapsed(false);
            }
        } catch {
            setError("Network error while calling AI edit");
        } finally {
            setLoading(false);
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

    return (
        <>
            {/* centered input bar above canvas */}
            <div className="mb-4 flex justify-center">
                <div className="w-full max-w-xl">
                    <div className="mb-1 flex items-center justify-between px-1">
                        <span className="text-[13px] font-semibold uppercase tracking-wide text-neutral-700">
                            AI assist
                        </span>
                        {loading && (
                            <span className="text-[11px] text-neutral-500">
                                Thinking…
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-3 rounded-full bg-neutral-900 px-4 py-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.35)]">
                        <input
                            type="text"
                            value={prompt}
                            onChange={(e) => {
                                setPrompt(e.target.value);
                                if (error) setError(null);
                            }}
                            placeholder={placeholder}
                            className="h-[28px] flex-1 bg-transparent text-[13px] text-neutral-50 placeholder:text-neutral-400 focus:outline-none"
                            disabled={loading}
                        />
                        <button
                            type="button"
                            onClick={handleRun}
                            disabled={generateDisabled}
                            className={`inline-flex h-8 items-center justify-center rounded-full px-4 text-[11px] font-semibold transition ${generateDisabled
                                ? "cursor-not-allowed bg-neutral-700 text-neutral-400"
                                : "bg-[var(--accent,#f55f2a)] text-white hover:brightness-110"
                                }`}
                        >
                            {loading ? "Generating…" : "Suggest"}
                        </button>
                    </div>

                    {/* <p className="mt-3 px-1 text-[10px] text-neutral-500">
                        Edits apply to the block you clicked in the preview. Use the save
                        controls in the editor to keep or discard changes.
                    </p> */}

                    {!hasScopedBlock && (
                        <p className="mt-2 px-1 text-[10px] text-amber-600">
                            No section is scoped yet. Click a block in the preview to give AI
                            a clear target.
                        </p>
                    )}

                    {hasScopedBlock && (
                        <p className="mt-1 px-1 text-[13px] text-emerald-500">
                            This section is now selected. AI changes will only affect this.
                        </p>
                    )}

                    {error && (
                        <p className="mt-1 px-1 text-[11px] text-red-600">
                            {error}
                        </p>
                    )}
                </div>
            </div>

            {/* history rail / dropdown on the right */}
            <aside className="pointer-events-none fixed top-10 right-8 hidden w-72 lg:flex">
                {collapsed ? (
                    // collapsed: small dropdown-style pill
                    <button
                        type="button"
                        onClick={() => setCollapsed(false)}
                        className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-neutral-700 shadow-md"
                    >
                        <span>Show AI history</span>
                        <span className="text-[9px] text-neutral-500">▼</span>
                    </button>
                ) : (
                    // expanded: full aside panel
                    <div className="pointer-events-auto flex max-h-64 w-full flex-col rounded-xl border border-neutral-200 bg-white/95 px-3 py-3 text-[11px] shadow-md">
                        <div className="mb-2 flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className="font-semibold text-neutral-800">
                                    Recent AI suggestions
                                </span>
                                <span className="text-[10px] text-neutral-500">
                                    Last 5
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setCollapsed(true)}
                                className="ml-2 rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-100"
                            >
                                Hide
                            </button>
                        </div>

                        <p className="mb-2 text-[10px] text-neutral-500">
                            History is for reference only. Use the main editor controls to save
                            or discard changes.
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
                                        className={`flex flex-col gap-1 rounded-md border bg-white px-2 py-1.5 text-[10px] transition ${active
                                            ? "border-[rgba(245,95,42,0.8)] bg-[rgba(245,95,42,0.02)]"
                                            : "border-neutral-200 hover:border-neutral-300"
                                            }`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate font-medium text-neutral-900">
                                                    {s.summary || "Minimal edit"}
                                                </div>
                                                <div className="line-clamp-2 text-[10px] text-neutral-500">
                                                    {s.prompt}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-1 flex items-center justify-between">
                                            {createdLabel ? (
                                                <span className="text-[10px] text-neutral-400">
                                                    {createdLabel}
                                                </span>
                                            ) : (
                                                <span />
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleDismiss(s.id)}
                                                className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-100"
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
