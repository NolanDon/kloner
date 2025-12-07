"use client";

import React from "react";
import {
    Square,
    Copy,
    Trash2,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Plus,
    Minus,
    Type as TypeIcon,
    Link2,
    Image as ImageIcon,
    Layers as LayersIcon,
    Undo2,
    Redo2,
} from "lucide-react";
import type { SelectionMeta } from "@/components/PreviewEditor";

type FloatingBlockToolbarProps = {
    iframeRef: React.RefObject<HTMLIFrameElement>;
    wrapperRef: React.RefObject<HTMLDivElement>;
    selectionMeta: SelectionMeta | null;
    uiScale: number;
};

function BlockToolbar({
    style,
    callApi,
}: {
    style: React.CSSProperties;
    callApi: (method: string) => void;
}) {
    return (
        <div
            style={style}
            className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white/95 px-2 py-1 text-[13px] text-slate-800 shadow-xl"
        >
            {/* Selection / core actions */}
            <div className="flex items-center gap-0.5">
                {/* Whole page select */}
                <button
                    type="button"
                    onClick={() => callApi("selectAll")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Select entire page"
                >
                    <Square className="h-5 w-5" />
                    <span className="sr-only">Select entire page</span>
                </button>

                {/* Duplicate block */}
                <button
                    type="button"
                    onClick={() => callApi("blockDuplicate")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Duplicate block"
                >
                    <Copy className="h-5 w-5" />
                    <span className="sr-only">Duplicate block</span>
                </button>

                {/* Clear selection */}
                <button
                    type="button"
                    onClick={() => callApi("clear")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Clear selection"
                >
                    <span className="text-[10px] font-semibold">CL</span>
                    <span className="sr-only">Clear selection</span>
                </button>

                {/* Delete block */}
                <button
                    type="button"
                    onClick={() => callApi("blockDelete")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-50 text-red-600 hover:bg-red-100"
                    title="Delete block"
                >
                    <Trash2 className="h-5 w-5" />
                    <span className="sr-only">Delete block</span>
                </button>
            </div>

            {/* Layout movement: up / down / left / right */}
            <div className="ml-1 flex items-center gap-0.5 border-l border-slate-200 pl-1">
                <button
                    type="button"
                    onClick={() => callApi("blockMoveUp")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Move block up"
                >
                    <ArrowUp className="h-5 w-5" />
                    <span className="sr-only">Move block up</span>
                </button>
                <button
                    type="button"
                    onClick={() => callApi("blockMoveDown")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Move block down"
                >
                    <ArrowDown className="h-5 w-5" />
                    <span className="sr-only">Move block down</span>
                </button>
                <button
                    type="button"
                    onClick={() => callApi("blockMoveLeft")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Move block left"
                >
                    <ArrowLeft className="h-5 w-5" />
                    <span className="sr-only">Move block left</span>
                </button>
                <button
                    type="button"
                    onClick={() => callApi("blockMoveRight")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Move block right"
                >
                    <ArrowRight className="h-5 w-5" />
                    <span className="sr-only">Move block right</span>
                </button>
            </div>

            {/* Padding: Pad | − / + */}
            <div className="ml-1 flex items-center gap-0.5 border-l border-slate-200 pl-1">
                <span className="rounded-full bg-slate-900/90 px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-100">
                    Pad
                </span>
                <button
                    type="button"
                    onClick={() => callApi("padLess")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Reduce padding"
                >
                    <Minus className="h-5 w-5" />
                    <span className="sr-only">Reduce padding</span>
                </button>
                <button
                    type="button"
                    onClick={() => callApi("padMore")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Increase padding"
                >
                    <Plus className="h-5 w-5" />
                    <span className="sr-only">Increase padding</span>
                </button>
            </div>

            {/* Block size: Size | − / + */}
            <div className="ml-1 flex items-center gap-0.5 border-l border-slate-200 pl-1">
                <span className="rounded-full bg-slate-900/90 px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-100">
                    Size
                </span>
                <button
                    type="button"
                    onClick={() => callApi("blockShrink")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Shrink block"
                >
                    <Minus className="h-5 w-5" />
                    <span className="sr-only">Shrink block</span>
                </button>
                <button
                    type="button"
                    onClick={() => callApi("blockGrow")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Grow block"
                >
                    <Plus className="h-5 w-5" />
                    <span className="sr-only">Grow block</span>
                </button>
            </div>

            {/* Text / link helpers: Txt | + , Link */}
            <div className="ml-1 flex items-center gap-0.5 border-l border-slate-200 pl-1">
                <span className="rounded-full bg-slate-900/90 px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-100">
                    Txt
                </span>
                <button
                    type="button"
                    onClick={() => callApi("textboxAdd")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Add overlay text box"
                >
                    <TypeIcon className="h-5 w-5" />
                    <span className="sr-only">Add text box</span>
                </button>
                <button
                    type="button"
                    onClick={() => callApi("linkEdit")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Edit link"
                >
                    <Link2 className="h-5 w-5" />
                    <span className="sr-only">Edit link</span>
                </button>
            </div>

            {/* Image group: Img | + / BG / × / − / + */}
            <div className="ml-1 flex items-center gap-0.5 border-l border-slate-200 pl-1">
                <span className="rounded-full bg-slate-900/90 px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-100">
                    Img
                </span>

                {/* Insert image */}
                <button
                    type="button"
                    onClick={() => callApi("imgInsert")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Insert image"
                >
                    <ImageIcon className="h-5 w-5" />
                    <span className="sr-only">Insert image</span>
                </button>

                {/* Background image */}
                <button
                    type="button"
                    onClick={() => callApi("imgBg")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Set block background image"
                >
                    <LayersIcon className="h-5 w-5" />
                    <span className="sr-only">Set background image</span>
                </button>

                {/* Delete image */}
                <button
                    type="button"
                    onClick={() => callApi("imgDelete")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-50 text-red-600 hover:bg-red-100"
                    title="Delete image"
                >
                    <Trash2 className="h-5 w-5" />
                    <span className="sr-only">Delete image</span>
                </button>

                {/* Image size − / + */}
                <button
                    type="button"
                    onClick={() => callApi("imgShrink")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Shrink image"
                >
                    <Minus className="h-5 w-5" />
                    <span className="sr-only">Shrink image</span>
                </button>
                <button
                    type="button"
                    onClick={() => callApi("imgGrow")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Grow image"
                >
                    <Plus className="h-5 w-5" />
                    <span className="sr-only">Grow image</span>
                </button>
            </div>

            {/* Image z-index layering: Fwd / Back */}
            <div className="ml-1 flex items-center gap-0.5 border-l border-slate-200 pl-1">
                <button
                    type="button"
                    onClick={() => callApi("bringImageForward")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Bring image forward"
                >
                    <ArrowUp className="h-5 w-5" />
                    <span className="sr-only">Bring image forward</span>
                </button>
                <button
                    type="button"
                    onClick={() => callApi("sendImageBackward")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Send image backward"
                >
                    <ArrowDown className="h-5 w-5" />
                    <span className="sr-only">Send image backward</span>
                </button>
            </div>

            {/* History: undo / redo */}
            <div className="ml-1 flex items-center gap-0.5 border-l border-slate-200 pl-1">
                <button
                    type="button"
                    onClick={() => callApi("historyUndo")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Undo"
                >
                    <Undo2 className="h-5 w-5" />
                    <span className="sr-only">Undo</span>
                </button>
                <button
                    type="button"
                    onClick={() => callApi("historyRedo")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-100"
                    title="Redo"
                >
                    <Redo2 className="h-5 w-5" />
                    <span className="sr-only">Redo</span>
                </button>
            </div>
        </div>
    );
}

export function FloatingBlockToolbar({
    iframeRef,
    wrapperRef,
    selectionMeta,
    uiScale,
}: FloatingBlockToolbarProps) {
    if (!selectionMeta || !selectionMeta.has || !(selectionMeta as any).rect) return null;

    const iframeEl = iframeRef.current;
    const wrapperEl = wrapperRef.current;
    if (!iframeEl || !wrapperEl) return null;

    const r = (selectionMeta as any).rect as {
        top: number;
        left: number;
        width: number;
        height: number;
        bottom: number;
    };
    const scale = uiScale || 1;

    const iframeBox = iframeEl.getBoundingClientRect();
    const wrapperBox = wrapperEl.getBoundingClientRect();

    // position based on block bottom instead of top
    const blockViewportBottom = iframeBox.top + r.bottom * scale;
    const blockViewportLeft = iframeBox.left + r.left * scale;
    const blockViewportCenterX = blockViewportLeft + (r.width * scale) / 2;

    // toolbar 8px below the block
    let top =
        blockViewportBottom - wrapperBox.top + wrapperEl.scrollTop + 8;
    let left =
        blockViewportCenterX - wrapperBox.left + wrapperEl.scrollLeft;

    const PADDING = 8;
    const maxLeft = wrapperEl.scrollWidth - PADDING;
    const minLeft = PADDING;

    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;

    const style: React.CSSProperties = {
        position: "absolute",
        top,
        left,
        transform: "translateX(-50%)",
        zIndex: 120,
        pointerEvents: "auto",
    };

    function callApi(method: string, ...args: any[]) {
        const win = iframeRef.current?.contentWindow as any;
        const api = win?.__klonerApi;
        if (!api || typeof api[method] !== "function") return;
        try {
            api[method](...args);
        } catch {
            // ignore
        }
    }

    return <BlockToolbar style={style} callApi={callApi} />;
}

export default FloatingBlockToolbar;
