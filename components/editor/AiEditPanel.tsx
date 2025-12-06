"use client";

import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
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
    onApplyBlockHtml: (blockHtml: string, targetPath?: string | null) => void;
    onAiEditingStateChange?: (isEditing: boolean, targetPath?: string | null) => void;

    // NEW: push the full AI history up whenever it changes
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

    useEffect(() => {
        if (onAiHistoryChange) onAiHistoryChange(suggestions);
    }, [suggestions, onAiHistoryChange]);

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
            const csrf = await ensureSessionAndCsrf();

            const res = await fetch("/api/ai-edit", {
                method: "POST",
                credentials: "include",
                headers: {
                    "content-type": "application/json",
                    // adapt header name to whatever your guard expects
                    "x-kloner-csrf": csrf ?? "",
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
            ? `Remaining credits: ${Math.max(creditsRemaining ?? 0, 0)} / ${creditsLimit}`
            : creditsLimit === 0
                ? "Your plan includes unlimited AI edits this month."
                : null;

    const atMaxChars =
        MAX_PROMPT_CHARS > 0 && prompt.length >= MAX_PROMPT_CHARS;

    return (
        <>
            {/* centered input bar above canvas */}
            <div className="mb-4 flex justify-center mt-2 pt-8">
                <div className="w-full max-w-[820px]">
                    {/* <div className="mb-1 flex items-center justify-between px-1">
                        {loading && (
                            <span className="text-[11px] text-neutral-500">
                                Thinking…
                            </span>
                        )}
                    </div> */}

                    {error && (
                        <p className="mt-1 px-1 text-[11px] text-red-600">
                            {error}
                        </p>
                    )}


                    {/* NEW: credits indicator under the input */}
                    <div className="mt-1 px-2 min-h-[16px] text-[13px] text-neutral-800">
                        {creditsText
                            ? <>{creditsText}</>
                            : null}
                    </div>

                    {/* AI edit input bar */}
                    <div className="flex justify-center">
                        <div className="relative w-full max-w-[860px]">
                            {/* subtle accent glow */}
                            <div
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-0 -z-10 rounded-[999px] opacity-60 blur-xl"
                                style={{
                                    background:
                                        "radial-gradient(circle at 0% 0%, rgba(245,95,42,0.35), transparent 55%), radial-gradient(circle at 100% 100%, rgba(245,95,42,0.25), transparent 55%)",
                                }}
                            />

                            {/* header row above input */}
                            <div className="mb-2 flex items-center justify-between px-1">
                                {/* <div className="inline-flex items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--accent,#f55f2a)_15%,#020617)] px-3 py-1">
                                    <span className="h-2 w-2 rounded-full bg-[var(--accent,#f55f2a)] shadow-[0_0_0_3px_rgba(245,95,42,0.45)]" />
                                    <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-neutral-100">
                                        AI Edit Assistant
                                    </span>
                                </div> */}

                                {loading && (
                                    <span className="text-[11px] text-neutral-400">Generating an edit…</span>
                                )}
                            </div>

                            {/* main input pill */}
                            <div className="mt-2 flex items-center gap-2 rounded-[999px] border border-[color-mix(in_srgb,var(--accent,#f55f2a)_65%,#020617)] bg-[rgba(3,7,18,0.96)] px-3 py-2.5 ">
                                {/* left icon chip */}
                                <div className="hidden sm:flex h-9 w-11 items-center justify-center rounded-full border-2 border-[color-mix(in_srgb,var(--accent,#f55f2a)_70%,#0b1120)] bg-[radial-gradient(circle_at_30%_0%,rgba(255,255,255,0.15),transparent_55%),var(--accent,#f55f2a)] text-[12px] font-semibold text-white shadow-[0_0_0_1px_rgba(15,23,42,0.7)]">
                                    AI
                                </div>

                                <input
                                    type="text"
                                    value={prompt}
                                    onChange={(e) => {
                                        const value = e.target.value.slice(0, MAX_PROMPT_CHARS);
                                        setPrompt(value);
                                        if (error) setError(null);
                                    }}
                                    maxLength={MAX_PROMPT_CHARS}
                                    placeholder={placeholder || "Describe a small change to this block…"}
                                    className="h-[46px] w-full max-w-[820px] bg-transparent text-[15px] leading-[1.2] text-neutral-50 placeholder:text-neutral-500 focus:outline-none"
                                    disabled={loading}
                                />

                                <button
                                    type="button"
                                    onClick={handleRun}
                                    disabled={generateDisabled}
                                    className={`inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full px-4 text-[14px] font-semibold tracking-wide transition ${generateDisabled
                                        ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                                        : "bg-[var(--accent,#f55f2a)] text-white shadow-[0_0_0_1px_rgba(15,23,42,0.8),0_12px_30px_rgba(245,95,42,0.35)] hover:brightness-110 active:brightness-95"
                                        }`}
                                >
                                    {loading ? "Applying…" : "Apply edit"}
                                </button>
                            </div>

                            {/* helper + char counter */}
                            <div className="mt-2 flex items-center justify-between px-1 text-[14px]">
                                <div className="min-h-[22px]">
                                    {atMaxChars ? (
                                        <span className="text-red-500">
                                            Max {MAX_PROMPT_CHARS} characters reached.
                                        </span>
                                    ) : !hasScopedBlock && prompt.length > 0 ? (
                                        <span className="text-amber-500">
                                            No block is selected. Click a section in the preview, then describe the change.
                                        </span>
                                    ) : hasScopedBlock && prompt.length > 0 ? (
                                        <span className="text-emerald-700">
                                            This edit will only affect your selected block in the preview.
                                        </span>
                                    ) : (
                                        <span className="text-neutral-500">
                                            Keep requests specific for the best results.
                                        </span>
                                    )}
                                </div>

                                <span className="text-[11px] text-neutral-500">
                                    {prompt.length}/{MAX_PROMPT_CHARS}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
