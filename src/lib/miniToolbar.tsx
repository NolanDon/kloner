// components/MiniToolbar.tsx
"use client";

import React, {
    useState,
    useEffect,
    useCallback,
    type CSSProperties,
} from "react";
import {
    ArrowUp,
    ArrowDown,
    Plus,
    Sparkles,
    X,
    Image as ImageIcon,
} from "lucide-react";
import type { SelectionMeta } from "@/components/PreviewEditor";

type MiniToolbarProps = {
    iframeRef: React.RefObject<HTMLIFrameElement>;
    wrapperRef: React.RefObject<HTMLDivElement>;
    selectionMeta: SelectionMeta | null;
    uiScale: number;
    aiEditing: boolean;
    onAiEditRequest?: (prompt: string) => void;
};

function callApi(
    iframeRef: React.RefObject<HTMLIFrameElement>,
    method: string,
    ...args: any[]
) {
    const win = iframeRef.current?.contentWindow as any;
    const api = win?.__klonerApi;
    if (!api || typeof api[method] !== "function") return;
    try {
        api[method](...args);
    } catch {
        // ignore
    }
}

export function MiniToolbar({
    iframeRef,
    wrapperRef,
    selectionMeta,
    uiScale,
    aiEditing,
    onAiEditRequest,
}: MiniToolbarProps) {
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [aiOpen, setAiOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [imageFile, setImageFile] = useState<File | null>(null); // still allowed for UX, not sent to backend

    const hasSelection =
        !!selectionMeta && !!selectionMeta.has && !!(selectionMeta as any).rect;

    const computePosition = useCallback(() => {
        if (!hasSelection) {
            setPos(null);
            return;
        }

        const iframeEl = iframeRef.current;
        const wrapperEl = wrapperRef.current;
        if (!iframeEl || !wrapperEl) {
            setPos(null);
            return;
        }

        const rect = (selectionMeta as any).rect as {
            top: number;
            left: number;
            width: number;
            height: number;
        };

        const scale = uiScale || 1;

        const iframeBox = iframeEl.getBoundingClientRect();
        const wrapperBox = wrapperEl.getBoundingClientRect();

        const blockTopInWrapper =
            wrapperEl.scrollTop +
            (iframeBox.top - wrapperBox.top) +
            rect.top * scale -
            -180;

        const blockLeftInWrapper =
            wrapperEl.scrollLeft +
            (iframeBox.left - wrapperBox.left) +
            rect.left * scale -
            -105;

        let top = blockTopInWrapper - 26;
        let left = blockLeftInWrapper;

        const PADDING = 8;
        const maxTop = wrapperEl.scrollHeight - PADDING;
        const maxLeft = wrapperEl.scrollWidth - PADDING;

        if (top < PADDING) top = PADDING;
        if (top > maxTop) top = maxTop;
        if (left < PADDING) left = PADDING;
        if (left > maxLeft) left = maxLeft;

        setPos({ top, left });
    }, [hasSelection, iframeRef, wrapperRef, selectionMeta, uiScale]);

    useEffect(() => {
        computePosition();
    }, [computePosition]);

    useEffect(() => {
        const wrapperEl = wrapperRef.current;
        if (!wrapperEl) return;

        const handler = () => computePosition();
        wrapperEl.addEventListener("scroll", handler, { passive: true });
        window.addEventListener("resize", handler);

        return () => {
            wrapperEl.removeEventListener("scroll", handler);
            window.removeEventListener("resize", handler);
        };
    }, [computePosition, wrapperRef]);

    if (!hasSelection || !pos) return null;

    const containerStyle: CSSProperties = {
        position: "absolute",
        top: pos.top,
        left: pos.left,
        zIndex: 160,
        pointerEvents: "auto",
    };

    const disabled = aiEditing;

    const handleMoveUp = () => {
        if (disabled) return;
        callApi(iframeRef, "blockMoveUp");
    };

    const handleMoveDown = () => {
        if (disabled) return;
        callApi(iframeRef, "blockMoveDown");
    };

    const handleInsertBelowSimple = () => {
        if (disabled) return;
        const win = iframeRef.current?.contentWindow as any;
        const api = win?.__klonerApi;
        if (!api || typeof api.blockDuplicate !== "function") return;

        try {
            api.blockDuplicate();
        } catch {
            // swallow
        }
    };

    const handleAiSubmit = () => {
        const trimmed = prompt.trim();
        if (!trimmed) return;
        if (disabled) return;

        if (onAiEditRequest) {
            onAiEditRequest(trimmed);
        }

        setAiOpen(false);
        setPrompt("");
        setImageFile(null);
    };

    return (
        <div style={containerStyle} className="flex flex-col gap-2">
            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-white shadow-lg px-1.5 py-1">
                <button
                    type="button"
                    onClick={handleMoveUp}
                    disabled={disabled}
                    className={`bg-accent inline-flex h-6 min-w-[24px] items-center justify-center px-2 py-2 bg-accent/90 hover:bg-accent/80 ${disabled ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                    title="Move section up"
                >
                    <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={handleMoveDown}
                    disabled={disabled}
                    className={`bg-accent inline-flex h-6 min-w-[24px] items-center justify-center px-2 py-2 bg-accent/90 hover:bg-accent/80 ${disabled ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                    title="Move section down"
                >
                    <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={handleInsertBelowSimple}
                    disabled={disabled}
                    className={`bg-accent inline-flex h-6 min-w-[24px] items-center justify-center px-2 py-2 bg-emerald-500 hover:bg-emerald-400 text-[11px] ${disabled ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                    title="Duplicate this block"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (disabled) return;
                        setAiOpen((v) => !v);
                    }}
                    disabled={disabled}
                    className={`inline-flex h-6 min-w-[30px] items-center justify-center px-2 py-2 bg-white text-[10px] font-semibold text-accent hover:bg-neutral-100 gap-1 ${disabled ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                    title="Use AI to edit this block"
                >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>AI</span>
                </button>
            </div>

            {aiOpen && !disabled && (
                <div className="w-[260px] rounded-2xl border border-neutral-200 bg-white shadow-2xl p-3 text-[12px] text-neutral-800">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                            AI edit block
                        </div>
                        <button
                            type="button"
                            onClick={() => setAiOpen(false)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-100"
                            title="Close"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    <p className="mb-2 text-[11px] text-neutral-600">
                        Describe how this section should change. Small edits work best.
                    </p>

                    <textarea
                        rows={3}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="E.g. soften the headline, keep layout, make copy more benefit-focused…"
                        className="mb-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent/70"
                    />

                    <label className="mb-2 inline-flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-600 hover:bg-neutral-100">
                        <span className="inline-flex items-center gap-1.5">
                            <ImageIcon className="h-3.5 w-3.5" />
                            {imageFile ? (
                                <span className="truncate max-w-[150px]">
                                    {imageFile.name}
                                </span>
                            ) : (
                                <span>Attach reference image (optional)</span>
                            )}
                        </span>
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0] ?? null;
                                setImageFile(file);
                            }}
                        />
                    </label>

                    <button
                        type="button"
                        onClick={handleAiSubmit}
                        disabled={!prompt.trim() || disabled}
                        className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Apply AI edit</span>
                    </button>
                </div>
            )}
        </div>
    );
}

export default MiniToolbar;
