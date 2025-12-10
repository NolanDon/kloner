"use client";

import React, { useEffect, useRef, useState } from "react";
import {
    Trash2,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Type as TypeIcon,
    Link2,
    Image as ImageIcon,
    Undo2,
    Redo2,
    RotateCcw,
    Layers,
} from "lucide-react";
import type { SelectionMeta } from "@/components/PreviewEditor";

type FloatingBlockToolbarProps = {
    iframeRef: React.RefObject<HTMLIFrameElement>;
    wrapperRef: React.RefObject<HTMLDivElement>;
    selectionMeta: SelectionMeta | null;
    uiScale: number;
};

type ToolbarPos = { top: number; left: number } | null;

type BlockHrefInfo = {
    hasLink: boolean;
    href: string;
} | null;

function BlockToolbar({
    style,
    callApi,
    selectionMeta,
    onDragStart,
}: {
    style: React.CSSProperties;
    callApi: (method: string, ...args: any[]) => any;
    selectionMeta: SelectionMeta;
    onDragStart: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
    const tagName =
        selectionMeta.tagName?.toUpperCase?.() || (selectionMeta as any).tagName || "DIV";

    const [hasNavLink, setHasNavLink] = useState(false);
    const [navHref, setNavHref] = useState("");

    // Fetch current href when selection changes
    useEffect(() => {
        try {
            const info = callApi("blockGetHref") as BlockHrefInfo;
            if (info && typeof info === "object") {
                setHasNavLink(!!info.hasLink);
                setNavHref(info.href || "");
            } else {
                setHasNavLink(false);
                setNavHref("");
            }
        } catch {
            setHasNavLink(false);
            setNavHref("");
        }
    }, [selectionMeta, callApi]);

    const commitNavHref = (value: string) => {
        const trimmed = (value || "").trim();
        callApi("blockSetHref", trimmed);
    };

    const handleNavInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setNavHref(e.target.value);
    };

    const handleNavInputBlur = () => {
        commitNavHref(navHref);
    };

    const handleNavInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            commitNavHref(navHref);
            (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
            e.preventDefault();
            try {
                const info = callApi("blockGetHref") as BlockHrefInfo;
                if (info && typeof info === "object") {
                    setHasNavLink(!!info.hasLink);
                    setNavHref(info.href || "");
                }
            } catch {
                // swallow
            }
            (e.currentTarget as HTMLInputElement).blur();
        }
    };

    return (
        <div className="bg-neutral-100">
            <div
                style={style}
                className="cursor-default flex h-[560px] w-[380px] p-4 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white text-[12px] text-neutral-800 shadow-2xl"
            >
                {/* Header – drag handle (ONLY header is draggable) */}
                <div
                    className="flex items-center justify-between border-b border-neutral-200 px-3.5 py-2.5 cursor-move"
                    onMouseDown={onDragStart}
                >
                    <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                                Selected block
                            </span>
                            <span className="text-[20px] font-semibold text-neutral-500 my-2">
                                &lt;{tagName.toLowerCase()}&gt;
                            </span>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="m-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm hover:bg-neutral-100 pb-1"
                        title="Deselect block"
                        onClick={() => callApi("clear")}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <span className="text-[20px] leading-none">×</span>
                    </button>
                </div>

                {/* Navigation link editor (only when a link exists on this block) */}
                {hasNavLink && (
                    <div className="border-b border-neutral-200 px-3.5 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-col flex-1">
                                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                                    <Link2 className="h-3 w-3" />
                                    Navigation link
                                </span>
                                <input
                                    type="text"
                                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] text-neutral-800 shadow-sm outline-none focus:border-neutral-400 focus:ring-0"
                                    placeholder="/about or /pricing"
                                    value={navHref}
                                    onChange={handleNavInputChange}
                                    onBlur={handleNavInputBlur}
                                    onKeyDown={handleNavInputKeyDown}
                                    onMouseDown={(e) => e.stopPropagation()}
                                />
                            </div>
                            <button
                                type="button"
                                className="mt-5 inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] text-neutral-500 hover:bg-neutral-50"
                                title="Clear link"
                                onClick={() => {
                                    setNavHref("");
                                    commitNavHref("");
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Body scroll area */}
                <div className="mt-2 flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5 text-[12px]">
                    {/* Danger */}
                    <div>
                        <div className="my-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            Danger
                        </div>
                        <button
                            type="button"
                            onClick={() => callApi("blockDelete")}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700 hover:bg-rose-100"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete block</span>
                        </button>
                    </div>

                    {/* Layout */}
                    <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            Layout
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("blockMoveUp")}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockMoveDown")}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockMoveLeft")}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockMoveRight")}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Padding */}
                    <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            Padding
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("blockPad", "top", 8)}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockPad", "bottom", 8)}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockPad", "left", 8)}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockPad", "right", 8)}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("blockPad", "all", -8)}
                                className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] hover:bg-neutral-50"
                            >
                                Less
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockPad", "all", 8)}
                                className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] hover:bg-neutral-50"
                            >
                                More
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockPadReset")}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                                title="Reset padding for this device"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Margin */}
                    <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            Margin
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("blockMargin", "top", 8)}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockMargin", "bottom", 8)}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockMargin", "left", 8)}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockMargin", "right", 8)}
                                className="flex h-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("blockMargin", "all", -8)}
                                className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] hover:bg-neutral-50"
                            >
                                Less
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockMargin", "all", 8)}
                                className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] hover:bg-neutral-50"
                            >
                                More
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockMarginReset")}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                                title="Reset margin for this device"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Size */}
                    <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            Size
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("blockShrink")}
                                className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                Shrink
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockGrow")}
                                className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                Grow
                            </button>
                        </div>
                    </div>

                    {/* Corners */}
                    <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            Corners
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("blockRadius", -4)}
                                className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                Straighter
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockRadius", 4)}
                                className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                Rounder
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("blockRadiusReset")}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                                title="Reset radius for this device"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Layering */}
                    <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            Layering
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("bringBlockForward")}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowUp className="h-3.5 w-3.5" />
                                <span>Bring forward</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("sendBlockBackward")}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                <ArrowDown className="h-3.5 w-3.5" />
                                <span>Send backward</span>
                            </button>
                        </div>
                    </div>

                    {/* Text & links */}
                    <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            Text & links
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("textboxAdd")}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                <TypeIcon className="h-3.5 w-3.5" />
                                <span>Add text</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("linkEdit")}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                <Link2 className="h-3.5 w-3.5" />
                                <span>Edit link</span>
                            </button>
                        </div>
                    </div>

                    {/* Images */}
                    <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            Images
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("imgInsert")}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                <ImageIcon className="h-3.5 w-3.5" />
                                <span>Add</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("imgBg")}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                <Layers className="h-3.5 w-3.5" />
                                <span>As background</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("imgDelete")}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700 hover:bg-rose-100"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>Remove</span>
                            </button>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("imgShrink")}
                                className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                Smaller
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("imgGrow")}
                                className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                Larger
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("bringImageForward")}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                                title="Bring forward"
                            >
                                <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("sendImageBackward")}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-[11px] hover:bg-neutral-50"
                                title="Send backward"
                            >
                                <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* History */}
                    <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            History
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => callApi("historyUndo")}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                <Undo2 className="h-3.5 w-3.5" />
                                <span>Undo</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => callApi("historyRedo")}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[11px] hover:bg-neutral-50"
                            >
                                <Redo2 className="h-3.5 w-3.5" />
                                <span>Redo</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function FloatingBlockToolbar({
    iframeRef,
    wrapperRef,
    selectionMeta,
}: FloatingBlockToolbarProps) {
    const [toolbarPos, setToolbarPos] = useState<ToolbarPos>(null);
    const toolbarPosRef = useRef<ToolbarPos>(null);

    const [isDraggingToolbar, setIsDraggingToolbar] = useState(false);
    const iframePrevPointerEventsRef = useRef<string | null>(null);

    useEffect(() => {
        toolbarPosRef.current = toolbarPos;
    }, [toolbarPos]);

    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        if (isDraggingToolbar) {
            if (iframePrevPointerEventsRef.current === null) {
                iframePrevPointerEventsRef.current = iframe.style.pointerEvents;
            }
            iframe.style.pointerEvents = "none";
        } else {
            if (iframePrevPointerEventsRef.current !== null) {
                iframe.style.pointerEvents = iframePrevPointerEventsRef.current;
                iframePrevPointerEventsRef.current = null;
            }
        }
    }, [isDraggingToolbar, iframeRef]);

    // Dock to the right of iframe on first selection
    useEffect(() => {
        const iframe = iframeRef.current;
        const wrapper = wrapperRef.current;
        if (!selectionMeta?.has || !iframe || !wrapper) return;

        if (toolbarPosRef.current) return;

        const iframeBox = iframe.getBoundingClientRect();
        const wrapperBox = wrapper.getBoundingClientRect();

        const panelWidth = 380;
        const panelHeight = 560;
        const padding = 16;

        const rawTop =
            wrapper.scrollTop + (iframeBox.top - wrapperBox.top) + padding;
        const rawLeft =
            wrapper.scrollLeft + (iframeBox.right - wrapperBox.left) + padding;

        const minTop = padding;
        const maxTop = wrapper.scrollHeight - panelHeight - padding;
        const minLeft = padding;
        const maxLeft = wrapper.scrollWidth - panelWidth - padding;

        const top =
            maxTop <= minTop
                ? Math.max(minTop, rawTop)
                : Math.max(minTop, Math.min(maxTop, rawTop));

        const left =
            maxLeft <= minLeft
                ? Math.max(minLeft, rawLeft)
                : Math.max(minLeft, Math.min(maxLeft, rawLeft));

        setToolbarPos({ top, left });
    }, [selectionMeta?.has, iframeRef, wrapperRef]);

    if (!selectionMeta || !selectionMeta.has || !(selectionMeta as any).rect) {
        return null;
    }

    const wrapper = wrapperRef.current;
    if (!wrapper) return null;

    const baseStyle: React.CSSProperties =
        toolbarPos != null
            ? {
                position: "absolute",
                top: toolbarPos.top,
                left: toolbarPos.left,
                zIndex: 120,
                pointerEvents: "auto",
            }
            : {
                position: "absolute",
                top: wrapper.scrollTop + 80,
                left: wrapper.scrollLeft + wrapper.clientWidth - 380 - 16,
                zIndex: 120,
                pointerEvents: "auto",
            };

    function callApi(method: string, ...args: any[]) {
        const win = iframeRef.current?.contentWindow as any;
        const api = win?.__klonerApi;
        if (!api || typeof api[method] !== "function") return;
        try {
            return api[method](...args);
        } catch {
            return;
        }
    }

    const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        const wrapperEl = wrapperRef.current;
        if (!wrapperEl) return;

        const wrapper = wrapperEl;

        const startX = e.clientX;
        const startY = e.clientY;

        const start = toolbarPosRef.current || {
            top: wrapper.scrollTop + 80,
            left: wrapper.scrollLeft + wrapper.clientWidth - 380 - 16,
        };

        const padding = 8;
        const panelWidth = 380;
        const panelHeight = 560;

        setIsDraggingToolbar(true);

        function onMove(ev: MouseEvent) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            let nextTop = start.top + dy;
            let nextLeft = start.left + dx;

            const minTop = padding;
            const maxTop = wrapper.scrollHeight - panelHeight - padding;
            const minLeft = padding;
            const maxLeft = wrapper.scrollWidth - panelWidth - padding;

            if (maxTop <= minTop) {
                nextTop = Math.max(minTop, nextTop);
            } else {
                nextTop = Math.max(minTop, Math.min(maxTop, nextTop));
            }

            if (maxLeft <= minLeft) {
                nextLeft = Math.max(minLeft, nextLeft);
            } else {
                nextLeft = Math.max(minLeft, Math.min(maxLeft, nextLeft));
            }

            setToolbarPos({ top: nextTop, left: nextLeft });
        }

        function onUp() {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            setIsDraggingToolbar(false);
        }

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    return (
        <div style={baseStyle}>
            <BlockToolbar
                style={{}}
                callApi={callApi}
                selectionMeta={selectionMeta}
                onDragStart={handleDragStart}
            />
        </div>
    );
}

export default FloatingBlockToolbar;
