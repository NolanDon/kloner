"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowUpRight, ImageIcon, Info, X, Rocket } from "lucide-react";
import { ensureSessionAndCsrf } from "@/app/login/LoginForm";

export interface AiEditSuggestion {
    id: string;
    renderId: string;
    prompt: string;
    summary: string;
    beforeHtml: string;
    afterHtml: string;
    createdAt: string;
    requestId: string;
    changes?: {
        count: number;
        description: string;
        diff?: string;
    };
    status?: 'pending' | 'applied' | 'rejected';
}

type Props = {
    renderId: string | null;
    refreshNonce?: number;
    getSelectedBlockHtml: () => string | null;
    getFullPageHtml: () => string;
    selectionMeta: {
        has: boolean;
        tagName?: string;
        path?: string | null;
        rect?: any;
    };
    onAiHistoryChange?: (history: AiEditSuggestion[]) => void;
    onApplyBlockHtml: (html: string, targetPath?: string) => void;
    onAiEditingStateChange?: (isEditing: boolean, progress?: { stage: string; message: string }, targetPath?: string) => void;
};

const MAX_PROMPT_CHARS = 500;
const MAX_SELECTION_CHARS = 50000;

function makeRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function normalizeCreatedAt(createdAt: any): string {
    if (typeof createdAt === "string") return createdAt;
    if (createdAt instanceof Date) return createdAt.toISOString();
    return new Date().toISOString();
}

function formatCreatedAt(createdAt: string | undefined): string {
    if (!createdAt) return "";
    try {
        const d = new Date(createdAt);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;

        return d.toLocaleDateString();
    } catch {
        return "";
    }
}

export default function AiEditPanelV2({
    renderId,
    refreshNonce,
    getSelectedBlockHtml,
    getFullPageHtml,
    selectionMeta,
    onAiHistoryChange,
    onApplyBlockHtml,
    onAiEditingStateChange,
}: Props) {
    const [prompt, setPrompt] = useState("");
    const [suggestions, setSuggestions] = useState<AiEditSuggestion[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingPhase, setLoadingPhase] = useState<"idle" | "short" | "long">("idle");
    const [error, setError] = useState<string | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [attachedImage, setAttachedImage] = useState<File | null>(null);
    const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
    const [pendingSuggestionId, setPendingSuggestionId] = useState<string | null>(null);
    const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
    const [creditsLimit, setCreditsLimit] = useState<number | null>(null);
    const [currentProgress, setCurrentProgress] = useState<{ stage: string; message: string } | null>(null);
    const [currentPendingChanges, setCurrentPendingChanges] = useState<{
        id: string;
        beforeHtml: string;
        afterHtml: string;
        changes: { count: number; description: string; diff?: string };
        prompt: string;
    } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    const hasScopedBlock = selectionMeta.has;
    const targetPath = selectionMeta.path || undefined;

    // Enhanced prompt suggestions based on selection context
    const getSmartSuggestions = () => {
        const tagName = selectionMeta.tagName?.toLowerCase();
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

    const applyCreditsMeta = (meta: any) => {
        if (meta && typeof meta === "object") {
            if (typeof meta.creditsRemaining === "number") {
                setCreditsRemaining(meta.creditsRemaining);
            }
            if (typeof meta.creditsLimit === "number") {
                setCreditsLimit(meta.creditsLimit);
            }
        }
    };

    // Load AI edit history
    useEffect(() => {
        if (!renderId) return;

        const loadHistory = async () => {
            setHistoryLoading(true);
            setHistoryError(null);

            try {
                const csrf = await ensureSessionAndCsrf();
                const res = await fetch(`/api/ai-edit?renderId=${encodeURIComponent(renderId)}`, {
                    credentials: "include",
                    headers: {
                        "x-csrf": csrf ?? "",
                    },
                });

                if (!res.ok) {
                    throw new Error(`Failed to load history: ${res.status}`);
                }

                const j = await res.json();
                const history: AiEditSuggestion[] = Array.isArray(j.suggestions)
                    ? j.suggestions.map((s: any) => ({
                        ...s,
                        createdAt: normalizeCreatedAt(s.createdAt),
                    }))
                    : [];

                setSuggestions(history);
                if (onAiHistoryChange) {
                    onAiHistoryChange(history);
                }

                applyCreditsMeta(j.meta);
            } catch (err) {
                setHistoryError(err instanceof Error ? err.message : "Failed to load AI edit history");
            } finally {
                setHistoryLoading(false);
            }
        };

        loadHistory();
    }, [renderId, refreshNonce, onAiHistoryChange]);

    // Loading phase management
    useEffect(() => {
        if (!loading) {
            setLoadingPhase("idle");
            return;
        }

        setLoadingPhase("short");
        const timer = setTimeout(() => {
            setLoadingPhase((phase) => (phase === "short" ? "long" : phase));
        }, 8000);
        return () => clearTimeout(timer);
    }, [loading]);

    const handleRun = async () => {
        if (loading) return;

        if (!prompt.trim()) {
            setError("Please describe what changes you'd like to make.");
            return;
        }

        const fullPageHtml = getFullPageHtml();
        if (!fullPageHtml || !fullPageHtml.trim()) {
            setError("No page content available for editing.");
            return;
        }

        const basePrompt = prompt.trim();
        const promptForApi = attachedImage
            ? `${basePrompt}\n\n[Attached image reference: ${attachedImage.name}]`
            : basePrompt;

        const clientRequestId = makeRequestId();

        setLoading(true);
        setError(null);
        setCurrentPendingChanges(null);
        setCurrentProgress({ stage: "analyzing", message: "Analyzing your request..." });

        if (onAiEditingStateChange) {
            try {
                onAiEditingStateChange(true, { stage: "analyzing", message: "Analyzing your request..." });
            } catch { }
        }

        try {
            const csrf = await ensureSessionAndCsrf();

            const formData = new FormData();
            formData.append('renderId', renderId || '');
            formData.append('html', fullPageHtml);
            formData.append('prompt', promptForApi);
            formData.append('requestId', clientRequestId);
            formData.append('mode', 'agent'); // New mode for agent-like behavior

            if (attachedImage) {
                formData.append('image', attachedImage);
            }

            // Update progress: sending request
            setCurrentProgress({ stage: "processing", message: "AI is generating your changes..." });
            if (onAiEditingStateChange) {
                try {
                    onAiEditingStateChange(true, { stage: "processing", message: "AI is generating your changes..." });
                } catch { }
            }

            const res = await fetch("/api/ai-edit", {
                method: "POST",
                credentials: "include",
                headers: {
                    "x-csrf": csrf ?? "",
                },
                body: formData,
            });

            const j = await res.json().catch(() => ({}));

            if (!res.ok) {
                const msg =
                    j?.error ||
                    j?.userError ||
                    (j?.debug?.imageErrorMessage ? String(j.debug.imageErrorMessage) : "") ||
                    `AI edit failed (status ${res.status})`;

                // For 503 errors, provide a more user-friendly message
                if (res.status === 503) {
                    setError("AI service is currently unavailable. Please try again in a few minutes.");
                } else {
                    setError(msg);
                }
                applyCreditsMeta(j?.meta);
                return;
            }

            // Handle agent response with changes
            if (j.changes && j.afterHtml) {
                const pendingChanges = {
                    id: `pending-${Date.now()}`,
                    beforeHtml: fullPageHtml,
                    afterHtml: j.afterHtml,
                    changes: j.changes,
                    prompt: basePrompt,
                };

                setCurrentPendingChanges(pendingChanges);
                setPrompt("");
                setAttachedImage(null);
                applyCreditsMeta(j.meta);
            } else {
                setError("AI agent returned no changes. Please try a different prompt.");
            }
        } catch (err) {
            setError("Network error while processing your request. Please try again.");
        } finally {
            setLoading(false);
            setCurrentProgress(null);
            if (onAiEditingStateChange) {
                try {
                    onAiEditingStateChange(false);
                } catch { }
            }
        }
    };

    const handleDismiss = (id: string) => {
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
        if (activePreviewId === id) setActivePreviewId(null);
    };

    const handleRejectChanges = () => {
        setCurrentPendingChanges(null);
    };

    const handleAcceptChanges = () => {
        if (currentPendingChanges) {
            onApplyBlockHtml(currentPendingChanges.afterHtml);
            setCurrentPendingChanges(null);
        }
    };

    const handleSuggestionClick = (suggestion: string) => {
        setPrompt(suggestion);
        if (error) setError(null);
    };

    const generateDisabled = loading || !prompt.trim();
    const placeholder = "Describe the changes you want to make...";

    const creditsText =
        typeof creditsLimit === "number" && creditsLimit > 0
            ? `Credits: ${Math.max(creditsRemaining ?? 0, 0)} / ${creditsLimit}`
            : creditsLimit === 0
                ? "Unlimited AI edits this month"
                : null;

    const atMaxChars = MAX_PROMPT_CHARS > 0 && prompt.length >= MAX_PROMPT_CHARS;

    const orderedSuggestions = [...suggestions].sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return da - db;
    });

    useEffect(() => {
        if (scrollContainerRef.current) {
            const el = scrollContainerRef.current;
            el.scrollTop = el.scrollHeight;
        }
    }, [orderedSuggestions.length]);

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!generateDisabled) handleRun();
        }
    };

    const smartSuggestions = getSmartSuggestions();
    const loadingLabel = loadingPhase === "long"
        ? "AI is working on your request..."
        : "Processing your request...";

    return (
        <div className="flex h-full flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-6 bg-gradient-to-r from-accent/5 to-accent/10">
                <div className="flex items-center gap-4">
                    {/* Profile Avatar Placeholder */}
                    <div className="relative">
                        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-accent to-accent/80 flex items-center justify-center shadow-lg ring-2 ring-white">
                            <Rocket className="h-6 w-6 text-white" />
                        </div>
                        {/* Online indicator */}
                        <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-white"></div>
                    </div>

                    <div className="space-y-1">
                        <div className="text-xl font-bold text-neutral-900">
                            Maverick
                        </div>
                        <div className="text-sm text-neutral-600">
                            AI coding assistance for developers
                        </div>
                    </div>
                </div>
                {creditsText && (
                    <div className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm">
                        {creditsText}
                    </div>
                )}
            </div>

            {/* Chat History */}
            <div
                ref={scrollContainerRef}
                className="flex-1 min-h-0 space-y-5 overflow-y-auto px-5 py-5"
            >
                {historyError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        <div className="flex items-center gap-2">
                            <X className="h-4 w-4" />
                            {historyError}
                        </div>
                    </div>
                )}

                {historyLoading && orderedSuggestions.length === 0 ? (
                    <div className="flex h-32 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50">
                        <div className="flex items-center gap-3">
                            <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
                            <span className="text-sm text-neutral-600">Loading edit history...</span>
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
                                            onClick={() => handleSuggestionClick(suggestion)}
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
                            <div key={s.id} className="space-y-3">
                                {/* User Message */}
                                <div className="flex flex-col items-end gap-1">
                                    <div className="max-w-[85%] rounded-2xl bg-accent px-4 py-3 text-white shadow-sm">
                                        <div className="text-sm font-medium">{s.prompt}</div>
                                    </div>
                                    <div className="pr-2 text-xs text-neutral-400">
                                        {formatCreatedAt(s.createdAt)}
                                    </div>
                                </div>

                                {/* AI Response */}
                                {!isOptimistic && (
                                    <div className="flex flex-col items-start gap-1">
                                        <div className="max-w-[85%] rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
                                            <div className="text-sm text-neutral-800">
                                                {s.summary || "Applied your requested changes to the selected element."}
                                            </div>
                                            <div className="mt-2 flex items-center justify-between">
                                                <button
                                                    type="button"
                                                    onClick={() => handleDismiss(s.id)}
                                                    className="text-xs font-medium text-neutral-500 hover:text-red-500 transition-colors"
                                                    title="Remove this edit from history"
                                                >
                                                    Dismiss
                                                </button>
                                            </div>
                                        </div>
                                        <div className="pl-2 text-xs text-neutral-400">
                                            {formatCreatedAt(s.createdAt)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Loading Indicator */}
            {loadingPhase !== "idle" && (
                <div className="mx-4 mb-4 flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent/5 px-4 py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-neutral-800">
                            {currentProgress?.message || loadingLabel}
                        </span>
                        {currentProgress?.stage === "processing" && (
                            <span className="text-xs text-neutral-600 mt-0.5">
                                This may take a few moments...
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Input Area */}
            <div className="border-t border-neutral-200 bg-white px-5 py-4">
                {/* Character Count */}
                <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm text-neutral-500">
                        {prompt.length}/{MAX_PROMPT_CHARS}
                    </span>
                    {attachedImage && (
                        <span className="text-sm text-neutral-600">
                            📎 {attachedImage.name}
                        </span>
                    )}
                </div>

                {/* Input and Controls */}
                <div className="flex items-end gap-3">
                    <div className="flex-1">
                        <textarea
                            value={prompt}
                            onChange={(e) => {
                                const value = e.target.value.slice(0, MAX_PROMPT_CHARS);
                                setPrompt(value);
                                if (error) setError(null);
                            }}
                            onKeyDown={handleInputKeyDown}
                            maxLength={MAX_PROMPT_CHARS}
                            placeholder={placeholder}
                            className="w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm leading-relaxed text-neutral-900 placeholder:text-neutral-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
                            rows={2}
                            disabled={loading}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        {/* Image Attach Button */}
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50 hover:border-accent/40 transition-colors"
                            title="Attach an image reference"
                            disabled={loading}
                        >
                            <ImageIcon className="h-4 w-4" />
                        </button>

                        {/* Send Button */}
                        <button
                            type="button"
                            onClick={handleRun}
                            disabled={generateDisabled}
                            className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                                generateDisabled
                                    ? "cursor-not-allowed bg-neutral-200 text-neutral-500"
                                    : "bg-accent text-white shadow-sm hover:brightness-110 active:brightness-95"
                            }`}
                            title={
                                generateDisabled
                                    ? "Select an element and enter a prompt to apply changes"
                                    : "Send request to AI assistant"
                            }
                        >
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <ArrowUpRight className="h-4 w-4" />
                            )}
                        </button>
                    </div>
                </div>

                {/* Hidden File Input */}
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

                {/* Status Messages */}
                <div className="mt-4 min-h-[1.5rem] text-right text-sm">
                    {atMaxChars ? (
                        <span className="text-red-600">Maximum {MAX_PROMPT_CHARS} characters reached</span>
                    ) : prompt.length > 0 ? (
                        <span className="text-green-600">Ready to apply AI agent changes</span>
                    ) : null}
                </div>

                {/* Pending Changes */}
                {currentPendingChanges && (
                    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                        <div className="flex items-start gap-3">
                            <Rocket className="h-5 w-5 text-blue-600 mt-0.5" />
                            <div className="flex-1">
                                <h4 className="font-medium text-blue-900">AI Agent Changes Ready</h4>
                                <p className="text-sm text-blue-700 mt-1">
                                    {currentPendingChanges.changes.description}
                                </p>
                                <div className="mt-2 text-xs text-blue-600">
                                    {currentPendingChanges.changes.count} change{currentPendingChanges.changes.count !== 1 ? 's' : ''} detected
                                </div>
                                {currentPendingChanges.changes.diff && (
                                    <details className="mt-2">
                                        <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">
                                            View changes
                                        </summary>
                                        <pre className="mt-2 text-xs bg-blue-100 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                                            {currentPendingChanges.changes.diff}
                                        </pre>
                                    </details>
                                )}
                                <div className="mt-3 flex gap-2">
                                    <button
                                        onClick={handleAcceptChanges}
                                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                                    >
                                        Accept Changes
                                    </button>
                                    <button
                                        onClick={handleRejectChanges}
                                        className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 transition-colors"
                                    >
                                        Reject
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {error && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        <div className="flex items-center gap-2">
                            <X className="h-4 w-4" />
                            {error}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}