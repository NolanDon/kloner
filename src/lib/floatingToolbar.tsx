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
    Check,
    ChevronDown,
    Type as TypeIcon,
} from "lucide-react";
import type { SelectionMeta } from "@/components/editor/PreviewEditor";

type FloatingBlockToolbarProps = {
    iframeRef: React.RefObject<HTMLIFrameElement>;
    wrapperRef: React.RefObject<HTMLDivElement>;
    selectionMeta: SelectionMeta | null;
    uiScale: number;
    bottomBarRef?: React.RefObject<HTMLElement>;
};

type ToolbarPos = { top: number; left: number } | null;

type BlockHrefInfo =
    | {
        hasLink: boolean;
        href: string;
    }
    | null;

const FONTS = [
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
] as const;

/**
 * Compact dropdown: closed by default, opens on click, closes on outside/Escape.
 */
function FontFamilyDropdown({
    initialFontFamily,
    onApply,
    onPreview,
    onRevertPreview,
}: {
    initialFontFamily?: string;
    onApply: (family: string) => void;
    onPreview?: (family: string) => void;
    onRevertPreview?: () => void;
}) {
    const fonts = useMemo(() => [...FONTS], []);
    const [open, setOpen] = useState(false);
    const [applied, setApplied] = useState<string>((initialFontFamily || "").trim() || fonts[0]?.value || "");
    const [hovered, setHovered] = useState<string>("");
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const next = (initialFontFamily || "").trim();
        if (!next) return;
        if (!open) setApplied(next);
    }, [initialFontFamily, open]);

    useEffect(() => {
        if (!open) {
            setHovered("");
            return;
        }

        const onDown = (e: MouseEvent) => {
            const el = rootRef.current;
            if (!el) return;
            if (el.contains(e.target as Node)) return;
            setOpen(false);
            setHovered("");
            onRevertPreview?.();
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
                setHovered("");
                onRevertPreview?.();
            }
        };

        window.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("keydown", onKey);
        };
    }, [open, onRevertPreview]);

    const activeLabel = fonts.find((f) => f.value === applied)?.label || "Font";

    const stopWheel = (e: React.WheelEvent) => e.stopPropagation();

    return (
        <div ref={rootRef} className="relative" onMouseDown={(e) => e.stopPropagation()}>
            <button
                type="button"
                title="Font"
                onClick={() => {
                    setOpen((v) => {
                        const next = !v;
                        if (!next) {
                            setHovered("");
                            onRevertPreview?.();
                        }
                        return next;
                    });
                }}
                className={[
                    "inline-flex h-7 w-full items-center justify-between rounded-lg border border-neutral-200 bg-white px-2",
                    "text-[10px] font-semibold text-neutral-800 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition",
                ].join(" ")}
            >
                <span className="truncate">{activeLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>

            {open ? (
                <div
                    className="absolute left-0 top-full z-50 mt-1 w-[210px] rounded-xl border border-black/10 bg-white shadow-[0_18px_50px_rgba(0,0,0,0.18)]"
                    role="menu"
                    onMouseDown={(e) => e.stopPropagation()}
                    onWheel={stopWheel}
                >
                    <div
                        className="p-1"
                        style={{
                            maxHeight: 220,
                            overflowY: "auto",
                            WebkitOverflowScrolling: "touch",
                            overscrollBehavior: "contain",
                        }}
                        onWheel={stopWheel}
                        onMouseLeave={() => {
                            if (hovered) {
                                setHovered("");
                                onRevertPreview?.();
                            }
                        }}
                    >
                        {fonts.map((f) => {
                            const isApplied = f.value === applied;
                            const isPreviewing = hovered === f.value;

                            return (
                                <button
                                    key={f.label}
                                    type="button"
                                    role="menuitem"
                                    className={[
                                        "w-full rounded-lg px-2 py-1.5 text-left text-[10px] leading-tight",
                                        "focus:outline-none",
                                        isPreviewing ? "bg-black/10 ring-1 ring-black/10" : "hover:bg-black/5 focus:bg-black/5",
                                        isApplied && !isPreviewing ? "bg-black/5" : "",
                                    ].join(" ")}
                                    style={{ fontFamily: f.value }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onWheel={stopWheel}
                                    onMouseEnter={() => {
                                        setHovered(f.value);
                                        onPreview?.(f.value);
                                    }}
                                    onFocus={() => {
                                        setHovered(f.value);
                                        onPreview?.(f.value);
                                    }}
                                    onClick={() => {
                                        setApplied(f.value);
                                        setHovered("");
                                        onApply(f.value);
                                        setOpen(false);
                                    }}
                                >
                                    <span className="flex items-center justify-between gap-2">
                                        <span className="truncate">{f.label}</span>
                                        {isApplied ? <Check className="h-3 w-3 opacity-70" /> : null}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

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
    const tagName = selectionMeta.tagName?.toUpperCase?.() || (selectionMeta as any).tagName || "DIV";

    const [hasNavLink, setHasNavLink] = useState(false);
    const [navHref, setNavHref] = useState("");
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
            const candidates = ["fontFamilyGet", "blockGetFontFamily", "getCurrentFontFamily", "selectionGetFontFamily"] as const;
            for (const m of candidates) {
                try {
                    const v = callApi(m);
                    if (typeof v === "string" && v.trim()) return v.trim();
                    if (v && typeof v === "object") {
                        const s = (v.fontFamily as string) || (v.value as string) || (v.family as string) || "";
                        if (typeof s === "string" && s.trim()) return s.trim();
                    }
                } catch { }
            }
            return "";
        };
        setCurrentFontFamily(tryGet());
    }, [selectionMeta, callApi]);

    const commitNavHref = (value: string) => {
        const trimmed = (value || "").trim();
        callApi("blockSetHref", trimmed);
    };

    const handleNavInputChange = (e: React.ChangeEvent<HTMLInputElement>) => setNavHref(e.target.value);
    const handleNavInputBlur = () => commitNavHref(navHref);

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
            } catch { }
            (e.currentTarget as HTMLInputElement).blur();
        }
    };

    const tryCallFontApi = (method: string, family: string) => {
        try {
            const r1 = callApi(method, family);
            if (r1 !== undefined) return r1;
        } catch { }
        try {
            const r2 = callApi(method, { fontFamily: family });
            if (r2 !== undefined) return r2;
        } catch { }
        try {
            const r3 = callApi(method, { family });
            if (r3 !== undefined) return r3;
        } catch { }
        return;
    };

    const previewFont = (family: string) => {
        if (!family) return;
        tryCallFontApi("fontFamilyPreview", family);
    };

    const revertPreviewFont = () => {
        try {
            const r = callApi("fontFamilyPreviewClear");
            if (r !== undefined) return;
        } catch { }
        if (currentFontFamily) tryCallFontApi("fontFamilySet", currentFontFamily);
    };

    const MiniPill = ({
        title,
        onClick,
        children,
        danger,
        className,
    }: {
        title: string;
        onClick: () => void;
        children: React.ReactNode;
        danger?: boolean;
        className?: string;
    }) => (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className={[
                "inline-flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[9px] leading-none shadow-sm transition active:scale-[0.98]",
                danger
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                className || "",
            ].join(" ")}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {children}
        </button>
    );

    const IconBtn = ({
        title,
        onClick,
        children,
        danger,
        className,
    }: {
        title: string;
        onClick: () => void;
        children: React.ReactNode;
        danger?: boolean;
        className?: string;
    }) => (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className={[
                "inline-flex h-7 w-7 items-center justify-center rounded-lg border shadow-sm active:scale-[0.98] transition",
                danger
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                className || "",
            ].join(" ")}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {children}
        </button>
    );

    const MobileActionBtn = ({
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
                "inline-flex items-center justify-center rounded-xl border shadow-sm active:scale-[0.98] transition",
                "h-9 w-9",
                danger
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
            ].join(" ")}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {children}
        </button>
    );

    return (
        <div className="bg-transparent">
            <div
                style={style}
                className={[
                    "cursor-default overflow-visible border border-neutral-200 bg-white text-neutral-800 shadow-2xl",
                    "text-[10px] leading-tight",
                    "w-[260px] rounded-2xl",
                    "sm:w-[260px] sm:rounded-2xl",
                    "max-sm:w-[min(96vw,560px)] max-sm:rounded-2xl",
                ].join(" ")}
            >
                {/* MOBILE */}
                <div className="sm:hidden border-b border-neutral-200">
                    <div className="px-2 py-2">
                        <div className="flex items-center gap-2">
                            <div
                                className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-2 py-1.5 cursor-move select-none"
                                onMouseDown={onDragStart}
                            >
                                <Move className="h-4 w-4 text-neutral-600" />
                                <span className="text-[11px] font-semibold text-neutral-700">{tagName.toLowerCase()}</span>
                            </div>

                            <div className="ml-auto flex items-center gap-1">
                                <MobileActionBtn title="Undo" onClick={() => callApi("historyUndo")}>
                                    <Undo2 className="h-4 w-4" />
                                </MobileActionBtn>
                                <MobileActionBtn title="Redo" onClick={() => callApi("historyRedo")}>
                                    <Redo2 className="h-4 w-4" />
                                </MobileActionBtn>
                                <MobileActionBtn title="Add image" onClick={() => callApi("imgInsert")}>
                                    <ImageIcon className="h-4 w-4" />
                                </MobileActionBtn>
                                <MobileActionBtn title="Delete block" onClick={() => callApi("blockDelete")} danger>
                                    <Trash2 className="h-4 w-4" />
                                </MobileActionBtn>

                                <button
                                    type="button"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:bg-neutral-50 active:scale-[0.98] transition"
                                    title="Deselect block"
                                    onClick={() => callApi("clear")}
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <span className="text-[18px] leading-none">×</span>
                                </button>
                            </div>
                        </div>

                        {hasNavLink ? (
                            <div className="mt-2 flex items-center gap-2">
                                <div className="flex-1 min-w-0 rounded-xl border border-neutral-200 bg-white px-2 py-1.5 shadow-sm">
                                    <input
                                        type="text"
                                        className="w-full bg-transparent text-[12px] text-neutral-800 outline-none"
                                        placeholder="/about"
                                        value={navHref}
                                        onChange={handleNavInputChange}
                                        onBlur={handleNavInputBlur}
                                        onKeyDown={handleNavInputKeyDown}
                                        onMouseDown={(e) => e.stopPropagation()}
                                    />
                                </div>
                                <MobileActionBtn
                                    title="Clear link"
                                    onClick={() => {
                                        setNavHref("");
                                        commitNavHref("");
                                    }}
                                    danger
                                >
                                    <Trash2 className="h-4 w-4" />
                                </MobileActionBtn>
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* DESKTOP */}
                <div className="hidden sm:block">
                    <div
                        className="flex items-center justify-between border-b border-neutral-200 px-2 py-1.5 cursor-move select-none"
                        onMouseDown={onDragStart}
                    >
                        <div className="flex items-center gap-1.5 min-w-0">
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-500">
                                <Move className="h-3.5 w-3.5" />
                            </div>

                            <div className="min-w-0 leading-tight">
                                <div className="text-[9px] font-semibold tracking-[0.14em] text-neutral-500 uppercase">
                                    Selected
                                </div>
                                <div className="text-[11px] font-semibold text-neutral-800 truncate">
                                    &lt;{tagName.toLowerCase()}&gt;
                                </div>
                            </div>
                        </div>

                        <IconBtn title="Deselect block" onClick={() => callApi("clear")}>
                            <span className="text-[14px] leading-none">×</span>
                        </IconBtn>
                    </div>

                    {/* Link editor (only if link exists) */}
                    {hasNavLink ? (
                        <div className="border-b border-neutral-200 px-2 py-1.5">
                            <div className="flex items-center justify-between gap-1.5">
                                <div className="flex flex-col flex-1 min-w-0">
                                    <span className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                        <Link2 className="h-3 w-3" />
                                        Link
                                    </span>
                                    <input
                                        type="text"
                                        className="mt-0.5 w-full rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] text-neutral-800 shadow-sm outline-none focus:border-neutral-400 focus:ring-0"
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
                                    className="mt-4 inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"
                                    title="Clear link"
                                    onClick={() => {
                                        setNavHref("");
                                        commitNavHref("");
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {/* Body */}
                    <div className="mt-1 flex-1 space-y-2 overflow-y-auto px-2 py-2 text-[10px]">
                        {/* Danger */}
                        <div>
                            <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                Danger
                            </div>
                            <button
                                type="button"
                                onClick={() => callApi("blockDelete")}
                                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700 hover:bg-rose-100"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>Delete</span>
                            </button>
                        </div>

                        {/* Layout (block move) */}
                        <div>
                            <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                Layout
                            </div>
                            {/* PATCH: arrows horizontally aligned as a single row of 4 */}
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("blockMoveUp")}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Move block up"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowUp className="h-3 w-3" />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => callApi("blockMoveLeft")}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Move left"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowLeft className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockMoveRight")}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Move right"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowRight className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockMoveDown")}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Move block down"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowDown className="h-3 w-3" />
                                </button>
                            </div>
                        </div>

                        {/* Padding */}
                        <div>
                            <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                Padding
                            </div>
                            {/* PATCH: arrows horizontally aligned as a single row of 4 */}
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("blockPad", "top", 8)}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Pad top"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowUp className="h-3 w-3" />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => callApi("blockPad", "left", 8)}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Pad left"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowLeft className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockPad", "right", 8)}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Pad right"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowRight className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockPad", "bottom", 8)}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Pad bottom"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowDown className="h-3 w-3" />
                                </button>
                            </div>

                            <div className="mt-1 flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("blockPad", "all", -8)}
                                    className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    Less
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockPad", "all", 8)}
                                    className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    More
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockPadReset")}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Reset padding for this device"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <RotateCcw className="h-3 w-3" />
                                </button>
                            </div>
                        </div>

                        {/* Margin */}
                        <div>
                            <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                Margin
                            </div>
                            {/* PATCH: arrows horizontally aligned as a single row of 4 */}
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("blockMargin", "top", 8)}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Margin top"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowUp className="h-3 w-3" />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => callApi("blockMargin", "left", 8)}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Margin left"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowLeft className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockMargin", "right", 8)}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Margin right"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowRight className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockMargin", "bottom", 8)}
                                    className="flex h-6 flex-1 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Margin bottom"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowDown className="h-3 w-3" />
                                </button>
                            </div>

                            <div className="mt-1 flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("blockMargin", "all", -8)}
                                    className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    Less
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockMargin", "all", 8)}
                                    className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    More
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockMarginReset")}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Reset margin for this device"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <RotateCcw className="h-3 w-3" />
                                </button>
                            </div>
                        </div>

                        {/* Size */}
                        <div>
                            <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                Size
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("blockShrink")}
                                    className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    Shrink
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockGrow")}
                                    className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    Grow
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockWidthReset")}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Reset width for this device"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <RotateCcw className="h-3 w-3" />
                                </button>
                            </div>
                        </div>

                        {/* Corners */}
                        <div>
                            <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                Corners
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("blockRadius", -4)}
                                    className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    Straight
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockRadius", 4)}
                                    className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    Round
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("blockRadiusReset")}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Reset radius for this device"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <RotateCcw className="h-3 w-3" />
                                </button>
                            </div>
                        </div>

                        {/* Layering (block) */}
                        <div>
                            <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                Layer
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("bringBlockForward")}
                                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowUp className="h-3 w-3" />
                                    <span>Front</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => callApi("sendBlockBackward")}
                                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowDown className="h-3 w-3" />
                                    <span>Back</span>
                                </button>
                            </div>
                        </div>

                        {/* Text & links */}
                        <div>
                            <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                Text & links
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("textboxAdd")}
                                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <TypeIcon className="h-3.5 w-3.5" />
                                    <span>Text</span>
                                </button>
                            </div>
                        </div>

                        {/* Images */}
                        <div>
                            <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                Images
                            </div>

                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("imgInsert")}
                                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ImageIcon className="h-3.5 w-3.5" />
                                    <span>Add</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => callApi("imgBg")}
                                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <Layers className="h-3.5 w-3.5" />
                                    <span>BG</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => callApi("imgDelete")}
                                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-1 text-[10px] text-rose-700 hover:bg-rose-100"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    <span>Remove</span>
                                </button>
                            </div>

                            <div className="mt-1 flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => callApi("imgShrink")}
                                    className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    Smaller
                                </button>

                                <button
                                    type="button"
                                    onClick={() => callApi("imgGrow")}
                                    className="flex-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[10px] hover:bg-neutral-50"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    Larger
                                </button>

                                <button
                                    type="button"
                                    onClick={() => callApi("bringImageForward")}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Bring image forward"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowUp className="h-3 w-3" />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => callApi("sendImageBackward")}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                                    title="Send image backward"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <ArrowDown className="h-3 w-3" />
                                </button>
                            </div>
                        </div>

                        {/* Font */}
                        <div>
                            <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                Font
                            </div>
                            <FontFamilyDropdown
                                initialFontFamily={currentFontFamily || ""}
                                onPreview={(family) => previewFont(family)}
                                onRevertPreview={() => revertPreviewFont()}
                                onApply={(family) => {
                                    tryCallFontApi("fontFamilySet", family);
                                    setCurrentFontFamily(family);
                                }}
                            />
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
    bottomBarRef,
}: FloatingBlockToolbarProps) {
    const [toolbarPos, setToolbarPos] = useState<ToolbarPos>(null);
    const toolbarPosRef = useRef<ToolbarPos>(null);

    const [isDraggingToolbar, setIsDraggingToolbar] = useState(false);
    const iframePrevPointerEventsRef = useRef<string | null>(null);

    const [isMobile, setIsMobile] = useState(false);
    const [bottomBarH, setBottomBarH] = useState(72);

    const PANEL_W = 260;
    const PANEL_H = 520;

    useEffect(() => {
        if (!isMobile) return;
        const el = bottomBarRef?.current;
        if (!el) return;

        const read = () => setBottomBarH(Math.max(0, Math.round(el.getBoundingClientRect().height || 0)));
        read();

        const ro = new ResizeObserver(() => read());
        ro.observe(el);
        return () => ro.disconnect();
    }, [isMobile, bottomBarRef]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(max-width: 639px)");
        const apply = () => setIsMobile(!!mq.matches);
        apply();
        if (typeof mq.addEventListener === "function") {
            mq.addEventListener("change", apply);
            return () => mq.removeEventListener("change", apply);
        }
        mq.addListener(apply);
        return () => mq.removeListener(apply);
    }, []);

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
        if (isMobile) return;

        const iframe = iframeRef.current;
        const wrapper = wrapperRef.current;
        if (!selectionMeta?.has || !iframe || !wrapper) return;

        if (toolbarPosRef.current) return;

        const iframeBox = iframe.getBoundingClientRect();
        const wrapperBox = wrapper.getBoundingClientRect();

        const padding = 16;
        const rawTop = wrapper.scrollTop + (iframeBox.top - wrapperBox.top) + padding;

        const GUTTER = 20;
        const rawLeft = wrapper.scrollLeft + (iframeBox.right - wrapperBox.left) + GUTTER;

        const minTop = padding;
        const maxTop = wrapper.scrollHeight - PANEL_H - padding;
        const minLeft = padding;
        const maxLeft = wrapper.scrollWidth - PANEL_W - padding;

        const top = maxTop <= minTop ? Math.max(minTop, rawTop) : Math.max(minTop, Math.min(maxTop, rawTop));
        const left = maxLeft <= minLeft ? Math.max(minLeft, rawLeft) : Math.max(minLeft, Math.min(maxLeft, rawLeft));

        setToolbarPos({ top, left });
    }, [selectionMeta?.has, iframeRef, wrapperRef, isMobile]);

    if (!selectionMeta || !selectionMeta.has || !(selectionMeta as any).rect) return null;

    const wrapper = wrapperRef.current;
    if (!wrapper) return null;

    const APPLY_BAR_ESTIMATED_H = Math.max(56, bottomBarH || 0);

    const mobileFixedStyle: React.CSSProperties = {
        position: "fixed",
        left: "50%",
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${APPLY_BAR_ESTIMATED_H}px + 10px)`,
        transform: "translateX(-50%)",
        zIndex: 9999,
        pointerEvents: "auto",
    };

    const desktopStyle: React.CSSProperties =
        toolbarPos != null
            ? { position: "absolute", top: toolbarPos.top, left: toolbarPos.left, zIndex: 120, pointerEvents: "auto" }
            : { position: "absolute", top: wrapper.scrollTop + 72, left: wrapper.scrollLeft + 12, zIndex: 120, pointerEvents: "auto" };

    const baseStyle = isMobile ? mobileFixedStyle : desktopStyle;

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
        if (isMobile) return;

        e.preventDefault();
        const wrapperEl = wrapperRef.current as any;
        if (!wrapperEl) return;

        const startX = e.clientX;
        const startY = e.clientY;

        const start = toolbarPosRef.current || {
            top: wrapperEl.scrollTop + 72,
            left: wrapperEl.scrollLeft + 12,
        };

        const padding = 10;

        setIsDraggingToolbar(true);

        function onMove(ev: MouseEvent) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            let nextTop = start.top + dy;
            let nextLeft = start.left + dx;

            const minTop = padding;
            const maxTop = wrapperEl.scrollHeight - PANEL_H - padding;
            const minLeft = padding;
            const maxLeft = wrapperEl.scrollWidth - PANEL_W - padding;

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
            <BlockToolbar style={{}} callApi={callApi} selectionMeta={selectionMeta} onDragStart={handleDragStart} />
        </div>
    );
}

export default FloatingBlockToolbar;
