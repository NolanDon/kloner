"use client";

import React from "react";
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
            className="flex items-center gap-1 rounded-full border border-slate-800 bg-black/90 px-2 py-1
                       text-[11px] shadow-xl bg-white/90 text-slate-800"
        >
            {/* Whole page select */}
            <button
                type="button"
                onClick={() => callApi("selectAll")}
                className="px-1.5 py-0.5 rounded-full hover:bg-slate-800 text-[11px] font-medium"
                title="Select entire page"
            >
                All
            </button>

            {/* Core selection actions */}
            <button
                type="button"
                onClick={() => callApi("clear")}
                className="px-1.5 py-0.5 rounded-full hover:bg-slate-800 text-[11px] font-medium"
            >
                Clear
            </button>
            <button
                type="button"
                onClick={() => callApi("blockDuplicate")}
                className="px-1.5 py-0.5 rounded-full hover:bg-slate-800 text-[11px] font-medium"
            >
                Dup
            </button>
            <button
                type="button"
                onClick={() => callApi("blockDelete")}
                className="px-1.5 py-0.5 rounded-full hover:bg-red-900/70 text-[11px] font-medium text-red-200"
            >
                Delete
            </button>

            {/* Layout movement: up / down / left / right */}
            <div className="flex gap-0.5 pl-1 border-l border-slate-700/70 ml-1">
                <button
                    type="button"
                    onClick={() => callApi("blockMoveUp")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[20px]"
                    title="Move block up"
                >
                    ↑
                </button>
                <button
                    type="button"
                    onClick={() => callApi("blockMoveDown")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[20px]"
                    title="Move block down"
                >
                    ↓
                </button>
                <button
                    type="button"
                    onClick={() => callApi("blockMoveLeft")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[20px]"
                    title="Move block left"
                >
                    ←
                </button>
                <button
                    type="button"
                    onClick={() => callApi("blockMoveRight")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[20px]"
                    title="Move block right"
                >
                    →
                </button>
            </div>

            {/* Padding controls */}
            <div className="flex gap-0.5 pl-1 border-l border-slate-700/70 ml-1">
                <button
                    type="button"
                    onClick={() => callApi("padLess")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Reduce padding"
                >
                    Pad –
                </button>
                <button
                    type="button"
                    onClick={() => callApi("padMore")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Increase padding"
                >
                    Pad +
                </button>
            </div>

            {/* Block size (grow / shrink) */}
            <div className="flex gap-0.5 pl-1 border-l border-slate-700/70 ml-1">
                <button
                    type="button"
                    onClick={() => callApi("blockShrink")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Shrink block"
                >
                    Size –
                </button>
                <button
                    type="button"
                    onClick={() => callApi("blockGrow")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Grow block"
                >
                    Size +
                </button>
            </div>

            {/* Text / link helpers */}
            <div className="flex gap-0.5 pl-1 border-l border-slate-700/70 ml-1">
                <button
                    type="button"
                    onClick={() => callApi("textboxAdd")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Add overlay text box"
                >
                    Txt +
                </button>
                <button
                    type="button"
                    onClick={() => callApi("linkEdit")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Edit link"
                >
                    Link
                </button>
            </div>

            {/* Image actions */}
            <div className="flex gap-0.5 pl-1 border-l border-slate-700/70 ml-1">
                <button
                    type="button"
                    onClick={() => callApi("imgInsert")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Insert image"
                >
                    Img +
                </button>
                <button
                    type="button"
                    onClick={() => callApi("imgDelete")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Delete image"
                >
                    Img ×
                </button>
                <button
                    type="button"
                    onClick={() => callApi("imgBg")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Set block background image"
                >
                    BG
                </button>
                <button
                    type="button"
                    onClick={() => callApi("imgShrink")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Shrink image"
                >
                    Img –
                </button>
                <button
                    type="button"
                    onClick={() => callApi("imgGrow")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Grow image"
                >
                    Img +
                </button>
            </div>

            {/* Image z-index layering */}
            <div className="flex gap-0.5 pl-1 border-l border-slate-700/70 ml-1">
                <button
                    type="button"
                    onClick={() => callApi("bringImageForward")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Bring image forward"
                >
                    Fwd
                </button>
                <button
                    type="button"
                    onClick={() => callApi("sendImageBackward")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[11px]"
                    title="Send image backward"
                >
                    Back
                </button>
            </div>

            {/* History */}
            <div className="flex gap-0.5 pl-1 border-l border-slate-700/70 ml-1">
                <button
                    type="button"
                    onClick={() => callApi("historyUndo")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[20px]"
                    title="Undo"
                >
                    ⤺
                </button>
                <button
                    type="button"
                    onClick={() => callApi("historyRedo")}
                    className="px-1 py-0.5 rounded-full hover:bg-slate-800 text-[20px]"
                    title="Redo"
                >
                    ⤼
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
        bottom: number; // use bottom from iframe meta
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
