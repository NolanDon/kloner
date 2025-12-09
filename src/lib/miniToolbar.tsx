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
}: MiniToolbarProps) {
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [aiOpen, setAiOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [imageFile, setImageFile] = useState<File | null>(null);

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

        // Position inside the scrollable wrapper so it scrolls with the block.
        const blockTopInWrapper =
            wrapperEl.scrollTop +
            (iframeBox.top - wrapperBox.top) +
            rect.top * scale - (-80);

        const blockLeftInWrapper =
            wrapperEl.scrollLeft +
            (iframeBox.left - wrapperBox.left) +
            rect.left * scale - (-130);

        let top = blockTopInWrapper - 26; // just above the block
        let left = blockLeftInWrapper;

        const PADDING = 8;
        const maxTop =
            wrapperEl.scrollHeight - PADDING; // loose clamp, mostly safety
        const maxLeft =
            wrapperEl.scrollWidth - PADDING;

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

    // IMPORTANT: this is absolute inside the wrapper, so make sure
    // the wrapper div has `relative` on its className.
    const containerStyle: CSSProperties = {
        position: "absolute",
        top: pos.top,
        left: pos.left,
        zIndex: 160,
        pointerEvents: "auto",
    };

    const handleMoveUp = () => callApi(iframeRef, "blockMoveUp");
    const handleMoveDown = () => callApi(iframeRef, "blockMoveDown");
    function handleInsertBelowSimple() {
        const win = iframeRef.current?.contentWindow as any;
        const api = win?.__klonerApi;
        if (!api || typeof api.blockDuplicate !== "function") return;

        try {
            api.blockDuplicate();
        } catch {
            // swallow
        }
    }


    const handleAiSubmit = () => {
        const trimmed = prompt.trim();
        if (!trimmed && !imageFile) return;

        callApi(
            iframeRef,
            "insertSectionBelowWithAi",
            trimmed || null,
            imageFile || null
        );

        setAiOpen(false);
        setPrompt("");
        setImageFile(null);
    };

    return (
        <div style={containerStyle} className="flex flex-col gap-2">
            {/* mini pill pinned to same corner as selection box */}
            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-white shadow-lg px-1.5 py-1">
                <button
                    type="button"
                    onClick={handleMoveUp}
                    className="bg-accent inline-flex h-6 min-w-[24px] items-center justify-center px-2 py-2 bg-accent/90 hover:bg-accent/80"
                    title="Move section up"
                >
                    <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={handleMoveDown}
                    className="bg-accent inline-flex h-6 min-w-[24px] items-center justify-center px-2 py-2 bg-accent/90 hover:bg-accent/80"
                    title="Move section down"
                >
                    <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={handleInsertBelowSimple}
                    className="bg-accent inline-flex h-6 min-w-[24px] items-center justify-center px-2 py-2 bg-emerald-500 hover:bg-emerald-400 text-[11px]"
                    title="Duplicate this block"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => setAiOpen((v) => !v)}
                    className="inline-flex h-6 min-w-[30px] items-center justify-center px-2 py-2 bg-white text-[10px] font-semibold text-accent hover:bg-neutral-100 px-2 gap-1"
                    title="Use AI to add next section"
                >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>AI</span>
                </button>
            </div>

            {aiOpen && (
                <div className="w-[260px] rounded-2xl border border-neutral-200 bg-white shadow-2xl p-3 text-[12px] text-neutral-800">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                            AI next section
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
                        Describe what should come next. You can attach a reference
                        image for layout or style.
                    </p>

                    <textarea
                        rows={3}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Tell Kloner what to add below this section…"
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
                        disabled={!prompt.trim() && !imageFile}
                        className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-60"
                    >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Add section with AI</span>
                    </button>
                </div>
            )}
        </div>
    );
}

export default MiniToolbar;
