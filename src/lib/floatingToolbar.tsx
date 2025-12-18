"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Trash2,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Link2,
    Image as ImageIcon,
    Undo2,
    Redo2,
    RotateCcw,
    Layers,
    Move,
    ChevronsUp,
    Check,
    ChevronDown,
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
        selectionMeta.tagName?.toUpperCase?.() ||
        (selectionMeta as any).tagName ||
        "DIV";

    const [hasNavLink, setHasNavLink] = useState(false);
    const [navHref, setNavHref] = useState("");
    const [expanded, setExpanded] = useState(false);

    const [currentFontFamily, setCurrentFontFamily] = useState<string>("");

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

    useEffect(() => {
        const tryGet = () => {
            const candidates = [
                "fontFamilyGet",
                "blockGetFontFamily",
                "getCurrentFontFamily",
                "selectionGetFontFamily",
            ] as const;

            for (const m of candidates) {
                try {
                    const v = callApi(m);
                    if (typeof v === "string" && v.trim()) return v.trim();
                    if (v && typeof v === "object") {
                        const s =
                            (v.fontFamily as string) ||
                            (v.value as string) ||
                            (v.family as string) ||
                            "";
                        if (typeof s === "string" && s.trim()) return s.trim();
                    }
                } catch {
                    // keep trying
                }
            }
            return "";
        };

        setCurrentFontFamily(tryGet());
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

    const Btn = ({
        title,
        onClick,
        className,
        children,
        danger,
        compact,
    }: {
        title: string;
        onClick: () => void;
        className?: string;
        children: React.ReactNode;
        danger?: boolean;
        compact?: boolean;
    }) => (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className={[
                "inline-flex items-center justify-center rounded-xl border text-neutral-700 shadow-sm",
                compact ? "h-9 w-9" : "h-9 px-3",
                danger
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "border-neutral-200 bg-white hover:bg-neutral-50",
                "active:scale-[0.98] transition",
                className || "",
            ].join(" ")}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {children}
        </button>
    );

    const SectionTitle = ({ children }: { children: React.ReactNode }) => (
        <div className="mt-3 mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            {children}
        </div>
    );

    function FontFamilyPicker({
        compact,
        initialFontFamily,
        onApply,
    }: {
        compact?: boolean;
        initialFontFamily?: string;
        onApply: (family: string) => void;
    }) {
        const fonts = useMemo(
            () => [
                { label: "Inter", value: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "Plus Jakarta Sans", value: '"Plus Jakarta Sans", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' },
                { label: "Manrope", value: "Manrope, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "DM Sans", value: '"DM Sans", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' },
                { label: "Space Grotesk", value: '"Space Grotesk", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' },
                { label: "Outfit", value: "Outfit, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "Sora", value: "Sora, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "Urbanist", value: "Urbanist, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "Rubik", value: "Rubik, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "Work Sans", value: '"Work Sans", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' },
                { label: "Noto Sans", value: '"Noto Sans", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' },

                { label: "Poppins", value: "Poppins, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "Montserrat", value: "Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "Raleway", value: "Raleway, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "Nunito Sans", value: '"Nunito Sans", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' },
                { label: "Figtree", value: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "Lexend", value: "Lexend, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },

                { label: "Playfair Display", value: '"Playfair Display", Georgia, "Times New Roman", serif' },
                { label: "Cormorant Garamond", value: '"Cormorant Garamond", Georgia, "Times New Roman", serif' },
                { label: "DM Serif Display", value: '"DM Serif Display", Georgia, "Times New Roman", serif' },
                { label: "Libre Baskerville", value: '"Libre Baskerville", Georgia, "Times New Roman", serif' },
                { label: "Crimson Pro", value: '"Crimson Pro", Georgia, "Times New Roman", serif' },
                { label: "EB Garamond", value: '"EB Garamond", Georgia, "Times New Roman", serif' },
                { label: "Merriweather", value: "Merriweather, Georgia, 'Times New Roman', serif" },
                { label: "Lora", value: "Lora, Georgia, 'Times New Roman', serif" },
                { label: "Spectral", value: "Spectral, Georgia, 'Times New Roman', serif" },
                { label: "Source Serif 4", value: '"Source Serif 4", Georgia, "Times New Roman", serif' },

                { label: "Orbitron", value: "Orbitron, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
                { label: "Space Mono", value: '"Space Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
                { label: "IBM Plex Sans", value: '"IBM Plex Sans", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' },
                { label: "IBM Plex Serif", value: '"IBM Plex Serif", Georgia, "Times New Roman", serif' },
                { label: "IBM Plex Mono", value: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
                { label: "JetBrains Mono", value: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
                { label: "Fira Code", value: '"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },

                { label: "Atkinson Hyperlegible", value: '"Atkinson Hyperlegible", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' },
                { label: "Source Sans 3", value: '"Source Sans 3", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' },

                { label: "Roboto", value: "Roboto, system-ui, -apple-system, Segoe UI, Arial, sans-serif" },
                { label: "System UI", value: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
            ],
            []
        );

        const [open, setOpen] = useState(false);

        const [applied, setApplied] = useState<string>(
            (initialFontFamily || "").trim() || fonts[0]?.value || ""
        );

        const rootRef = useRef<HTMLDivElement | null>(null);

        useEffect(() => {
            const next = (initialFontFamily || "").trim();
            if (!next) return;
            if (!open) setApplied(next);
        }, [initialFontFamily, open]);

        useEffect(() => {
            if (!open) return;

            const onDown = (e: MouseEvent) => {
                const el = rootRef.current;
                if (!el) return;
                if (el.contains(e.target as Node)) return;
                setOpen(false);
            };

            window.addEventListener("mousedown", onDown);
            return () => window.removeEventListener("mousedown", onDown);
        }, [open]);

        useEffect(() => {
            if (!open) return;

            const onKey = (e: KeyboardEvent) => {
                if (e.key === "Escape") setOpen(false);
            };

            window.addEventListener("keydown", onKey);
            return () => window.removeEventListener("keydown", onKey);
        }, [open]);

        const activeLabel =
            fonts.find((f) => f.value === applied)?.label || "Font";

        const stopWheel = (e: React.WheelEvent) => {
            // prevent the wrapper/toolbar area from eating scroll and closing/dragging
            e.stopPropagation();
        };

        return (
            <div
                ref={rootRef}
                className="relative inline-flex"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <Btn
                    title="Font"
                    compact={!!compact}
                    onClick={() => setOpen((v) => !v)}
                >
                    <span className="inline-flex items-center gap-2">
                        <span className="truncate text-left">{activeLabel}</span>
                        <ChevronDown className="h-4 w-4 opacity-70" />
                    </span>
                </Btn>

                {open && (
                    <div
                        className="
                            absolute left-0 top-full z-50 mt-2
                            w-[280px] rounded-2xl border border-black/10 bg-white
                            shadow-[0_18px_50px_rgba(0,0,0,0.18)]
                        "
                        role="menu"
                        onMouseDown={(e) => e.stopPropagation()}
                        onWheel={stopWheel}
                    >
                        <div
                            className="p-1"
                            style={{
                                maxHeight: 360,
                                overflowY: "auto",
                                WebkitOverflowScrolling: "touch",
                                overscrollBehavior: "contain",
                            }}
                            onWheel={stopWheel}
                        >
                            {fonts.map((f) => {
                                const isActive = f.value === applied;
                                return (
                                    <button
                                        key={f.label}
                                        type="button"
                                        role="menuitem"
                                        className={[
                                            "w-full rounded-xl px-3 py-2 text-left text-sm",
                                            "hover:bg-black/5 focus:bg-black/5 focus:outline-none",
                                            isActive ? "bg-black/5" : "bg-transparent",
                                        ].join(" ")}
                                        style={{ fontFamily: f.value }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onWheel={stopWheel}
                                        onClick={() => {
                                            setApplied(f.value);
                                            onApply(f.value);
                                            // keep menu open
                                        }}
                                    >
                                        <span className="flex items-center justify-between gap-3">
                                            <span className="truncate">{f.label}</span>
                                            {isActive ? (
                                                <Check className="h-4 w-4 opacity-70" />
                                            ) : null}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    const MiniPill = ({
        title,
        onClick,
        children,
        danger,
    }: {
        title: string;
        onClick: () => void;
        children: React.ReactNode;
        danger?: boolean;
    }) => (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className={[
                "inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[10px] shadow-sm transition active:scale-[0.98]",
                danger
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
            ].join(" ")}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {children}
        </button>
    );

    const PadGrid = ({
        onTop,
        onBottom,
        onLeft,
        onRight,
        titleTop,
        titleBottom,
        titleLeft,
        titleRight,
    }: {
        onTop: () => void;
        onBottom: () => void;
        onLeft: () => void;
        onRight: () => void;
        titleTop: string;
        titleBottom: string;
        titleLeft: string;
        titleRight: string;
    }) => (
        <div className="grid grid-cols-3 grid-rows-3 gap-1.5 place-items-center">
            <div aria-hidden />
            <button
                type="button"
                title={titleTop}
                onClick={onTop}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <ArrowUp className="h-4 w-4" />
            </button>
            <div aria-hidden className="h-9 w-9" />

            <button
                type="button"
                title={titleLeft}
                onClick={onLeft}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-500">
                <Move className="h-4 w-4" />
            </div>
            <button
                type="button"
                title={titleRight}
                onClick={onRight}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <ArrowRight className="h-4 w-4" />
            </button>

            <div aria-hidden className="h-9 w-9" />
            <button
                type="button"
                title={titleBottom}
                onClick={onBottom}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <ArrowDown className="h-4 w-4" />
            </button>
            <div aria-hidden className="h-9 w-9" />
        </div>
    );

    return (
        <div className="bg-transparent">
            <div
                style={style}
                className={[
                    "cursor-default flex flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white text-neutral-800 shadow-2xl",
                    "w-[268px]",
                ].join(" ")}
            >
                <div
                    className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 cursor-move select-none"
                    onMouseDown={onDragStart}
                >
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-neutral-500">
                            <Move className="h-4 w-4" />
                        </div>
                        <div className="flex flex-col leading-tight">
                            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                                Selected
                            </span>
                            <span className="text-[13px] font-semibold text-neutral-700">
                                &lt;{tagName.toLowerCase()}&gt;
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                            title={expanded ? "Collapse" : "Expand"}
                            onClick={() => setExpanded((v) => !v)}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <ChevronsUp
                                className={[
                                    "h-4 w-4 transition-transform",
                                    expanded ? "rotate-0" : "rotate-180",
                                ].join(" ")}
                            />
                        </button>

                        <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                            title="Deselect block"
                            onClick={() => callApi("clear")}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <span className="text-[18px] leading-none">×</span>
                        </button>
                    </div>
                </div>

                <div className="px-3 pt-3">
                    <div className="grid grid-cols-4 gap-1.5">
                        <FontFamilyPicker
                            compact={false}
                            initialFontFamily={currentFontFamily || ""}
                            onApply={(family) => {
                                callApi("fontFamilySet", { fontFamily: family });
                                setCurrentFontFamily(family);
                            }}
                        />

                        <button
                            type="button"
                            title="Edit link"
                            onClick={() => callApi("linkEdit")}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <Link2 className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            title="Add image"
                            onClick={() => callApi("imgInsert")}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <ImageIcon className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            title="Background image"
                            onClick={() => callApi("imgBg")}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <Layers className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                        <button
                            type="button"
                            title="Undo"
                            onClick={() => callApi("historyUndo")}
                            className="inline-flex h-9 items-center justify-center rounded-xl bg-accent px-3 text-white shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <Undo2 className="h-4 w-4 mr-1" />
                            Undo
                        </button>
                        <button
                            type="button"
                            title="Redo"
                            onClick={() => callApi("historyRedo")}
                            className="inline-flex h-9 items-center justify-center rounded-xl bg-accent px-3 text-white shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <Redo2 className="h-4 w-4 mr-1" />
                            Redo
                        </button>
                    </div>
                </div>

                {hasNavLink && expanded && (
                    <div className="mt-3 border-t border-neutral-200 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col flex-1">
                                <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                                    <Link2 className="h-3 w-3" />
                                    Link
                                </span>
                                <input
                                    type="text"
                                    className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-2 py-1.5 text-[11px] text-neutral-800 shadow-sm outline-none focus:border-neutral-400 focus:ring-0"
                                    placeholder="/about"
                                    value={navHref}
                                    onChange={handleNavInputChange}
                                    onBlur={handleNavInputBlur}
                                    onKeyDown={handleNavInputKeyDown}
                                    onMouseDown={(e) => e.stopPropagation()}
                                />
                            </div>
                            <button
                                type="button"
                                title="Clear link"
                                onClick={() => {
                                    setNavHref("");
                                    commitNavHref("");
                                }}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-3">
                    <SectionTitle>Padding</SectionTitle>
                    <PadGrid
                        titleTop="Pad top"
                        titleBottom="Pad bottom"
                        titleLeft="Pad left"
                        titleRight="Pad right"
                        onTop={() => callApi("blockPad", "top", 8)}
                        onBottom={() => callApi("blockPad", "bottom", 8)}
                        onLeft={() => callApi("blockPad", "left", 8)}
                        onRight={() => callApi("blockPad", "right", 8)}
                    />
                    <div className="mt-2 flex items-center justify-between gap-1.5">
                        <MiniPill title="Less padding" onClick={() => callApi("blockPad", "all", -8)}>
                            Less
                        </MiniPill>
                        <MiniPill title="More padding" onClick={() => callApi("blockPad", "all", 8)}>
                            More
                        </MiniPill>
                        <button
                            type="button"
                            title="Reset padding for this device"
                            onClick={() => callApi("blockPadReset")}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <RotateCcw className="h-4 w-4" />
                        </button>
                    </div>

                    <SectionTitle>Margin</SectionTitle>
                    <PadGrid
                        titleTop="Margin top"
                        titleBottom="Margin bottom"
                        titleLeft="Margin left"
                        titleRight="Margin right"
                        onTop={() => callApi("blockMargin", "top", 8)}
                        onBottom={() => callApi("blockMargin", "bottom", 8)}
                        onLeft={() => callApi("blockMargin", "left", 8)}
                        onRight={() => callApi("blockMargin", "right", 8)}
                    />
                    <div className="mt-2 flex items-center justify-between gap-1.5">
                        <MiniPill title="Less margin" onClick={() => callApi("blockMargin", "all", -8)}>
                            Less
                        </MiniPill>
                        <MiniPill title="More margin" onClick={() => callApi("blockMargin", "all", 8)}>
                            More
                        </MiniPill>
                        <button
                            type="button"
                            title="Reset margin for this device"
                            onClick={() => callApi("blockMarginReset")}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <RotateCcw className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {expanded && (
                    <div className="flex-1 overflow-y-auto px-3 pb-3">
                        <SectionTitle>Size</SectionTitle>
                        <div className="flex items-center gap-1.5">
                            <MiniPill title="Shrink" onClick={() => callApi("blockShrink")}>
                                Shrink
                            </MiniPill>
                            <MiniPill title="Grow" onClick={() => callApi("blockGrow")}>
                                Grow
                            </MiniPill>
                        </div>

                        <SectionTitle>Corners</SectionTitle>
                        <div className="flex items-center gap-1.5">
                            <MiniPill title="Straighter corners" onClick={() => callApi("blockRadius", -4)}>
                                Straight
                            </MiniPill>
                            <MiniPill title="Rounder corners" onClick={() => callApi("blockRadius", 4)}>
                                Round
                            </MiniPill>
                            <button
                                type="button"
                                title="Reset radius for this device"
                                onClick={() => callApi("blockRadiusReset")}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <RotateCcw className="h-4 w-4" />
                            </button>
                        </div>

                        <SectionTitle>Layer</SectionTitle>
                        <div className="flex items-center gap-1.5">
                            <MiniPill title="Bring forward" onClick={() => callApi("bringBlockForward")}>
                                <ArrowUp className="h-3.5 w-3.5" />
                                Front
                            </MiniPill>
                            <MiniPill title="Send backward" onClick={() => callApi("sendBlockBackward")}>
                                <ArrowDown className="h-3.5 w-3.5" />
                                Back
                            </MiniPill>
                        </div>

                        <SectionTitle>Images</SectionTitle>
                        <div className="grid grid-cols-2 gap-1.5">
                            <MiniPill title="Smaller image" onClick={() => callApi("imgShrink")}>
                                Smaller
                            </MiniPill>
                            <MiniPill title="Larger image" onClick={() => callApi("imgGrow")}>
                                Larger
                            </MiniPill>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                            <button
                                type="button"
                                title="Bring image forward"
                                onClick={() => callApi("bringImageForward")}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                title="Send image backward"
                                onClick={() => callApi("sendImageBackward")}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <ArrowDown className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                title="Remove image"
                                onClick={() => callApi("imgDelete")}
                                className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700 shadow-sm hover:bg-rose-100 active:scale-[0.98] transition"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>

                        <SectionTitle>Danger</SectionTitle>
                        <button
                            type="button"
                            onClick={() => callApi("blockDelete")}
                            className="inline-flex w-full items-center justify-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700 shadow-sm hover:bg-rose-100 active:scale-[0.98] transition"
                            onMouseDown={(e) => e.stopPropagation()}
                            title="Delete block"
                        >
                            <Trash2 className="h-4 w-4" />
                            Delete block
                        </button>
                    </div>
                )}
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

    useEffect(() => {
        const iframe = iframeRef.current;
        const wrapper = wrapperRef.current;
        if (!selectionMeta?.has || !iframe || !wrapper) return;

        if (toolbarPosRef.current) return;

        const iframeBox = iframe.getBoundingClientRect();
        const wrapperBox = wrapper.getBoundingClientRect();

        const panelWidth = 268;
        const panelHeight = 520;
        const padding = 14;

        const rawTop =
            wrapper.scrollTop + (iframeBox.top - wrapperBox.top) + padding;
        const rawLeft =
            wrapper.scrollLeft +
            (iframeBox.left - wrapperBox.left) -
            panelWidth -
            padding;

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

    const panelWidth = 268;

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
                  left: wrapper.scrollLeft + 14,
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
            left: wrapper.scrollLeft + 14,
        };

        const padding = 10;
        const panelHeightClamp = 520;

        setIsDraggingToolbar(true);

        function onMove(ev: MouseEvent) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            let nextTop = start.top + dy;
            let nextLeft = start.left + dx;

            const minTop = padding;
            const maxTop = wrapper.scrollHeight - panelHeightClamp - padding;
            const minLeft = padding;
            const maxLeft = wrapper.scrollWidth - panelWidth - padding;

            if (maxTop <= minTop) nextTop = Math.max(minTop, nextTop);
            else nextTop = Math.max(minTop, Math.min(maxTop, nextTop));

            if (maxLeft <= minLeft) nextLeft = Math.max(minLeft, nextLeft);
            else nextLeft = Math.max(minLeft, Math.min(maxLeft, nextLeft));

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
