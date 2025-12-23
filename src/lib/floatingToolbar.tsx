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
    bottomBarRef?: React.RefObject<HTMLElement>; // add
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

function FontFamilyPicker({
    compact,
    initialFontFamily,
    onApply,
    onPreview,
    onRevertPreview,
    Btn,
}: {
    compact?: boolean;
    initialFontFamily?: string;
    onApply: (family: string) => void;
    onPreview?: (family: string) => void;
    onRevertPreview?: () => void;
    Btn: React.ComponentType<{
        title: string;
        onClick: () => void;
        className?: string;
        children: React.ReactNode;
        danger?: boolean;
        compact?: boolean;
    }>;
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

        window.addEventListener("mousedown", onDown);
        return () => window.removeEventListener("mousedown", onDown);
    }, [open, onRevertPreview]);

    useEffect(() => {
        if (!open) return;

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
                setHovered("");
                onRevertPreview?.();
            }
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onRevertPreview]);

    const activeLabel = fonts.find((f) => f.value === applied)?.label || "Font";

    const stopWheel = (e: React.WheelEvent) => e.stopPropagation();

    return (
        <div ref={rootRef} className="relative inline-flex" onMouseDown={(e) => e.stopPropagation()}>
            <Btn
                title="Font"
                compact={!!compact}
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
                                        "w-full rounded-xl px-3 py-2 text-left text-sm",
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
                                    }}
                                >
                                    <span className="flex items-center justify-between gap-3">
                                        <span className="truncate">{f.label}</span>
                                        {isApplied ? <Check className="h-4 w-4 opacity-70" /> : null}
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
                danger ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" : "border-neutral-200 bg-white hover:bg-neutral-50",
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
                danger ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
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
                danger ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
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
                    "cursor-default overflow-hidden border border-neutral-200 bg-white text-neutral-800 shadow-2xl",
                    "w-[268px] rounded-3xl",
                    "sm:w-[268px] sm:rounded-3xl",
                    "max-sm:w-[min(96vw,560px)] max-sm:rounded-2xl",
                ].join(" ")}
            >
                {/* MOBILE: fixed-position horizontal bar content */}
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
                                <MobileActionBtn title="Edit link" onClick={() => callApi("linkEdit")}>
                                    <Link2 className="h-4 w-4" />
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

                {/* DESKTOP: original panel */}
                <div className="hidden sm:block">
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
                                Btn={Btn}
                                onPreview={(family) => previewFont(family)}
                                onRevertPreview={() => revertPreviewFont()}
                                onApply={(family) => {
                                    tryCallFontApi("fontFamilySet", family);
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
                                className="inline-flex h-9 items-center justify-center rounded-xl bg-accent px-3 text-white shadow-sm active:scale-[0.98] transition"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <Undo2 className="h-4 w-4 mr-1" />
                                Undo
                            </button>
                            <button
                                type="button"
                                title="Redo"
                                onClick={() => callApi("historyRedo")}
                                className="inline-flex h-9 items-center justify-center rounded-xl bg-accent px-3 text-white shadow-sm active:scale-[0.98] transition"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <Redo2 className="h-4 w-4 mr-1" />
                                Redo
                            </button>
                        </div>
                    </div>

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

    // CRITICAL FIX: on mobile, ignore absolute wrapper math entirely and pin the toolbar to the viewport
    const [isMobile, setIsMobile] = useState(false);
    const [bottomBarH, setBottomBarH] = useState(72);

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
        // Safari fallback
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

        const panelWidth = 268;
        const panelHeight = 520;
        const padding = 30;

        const rawTop = wrapper.scrollTop + (iframeBox.top - wrapperBox.top) + padding;

        const GUTTER = 32;
        const rawLeft = wrapper.scrollLeft + (iframeBox.right - wrapperBox.left) + GUTTER;

        const minTop = padding;
        const maxTop = wrapper.scrollHeight - panelHeight - padding;
        const minLeft = padding;
        const maxLeft = wrapper.scrollWidth - panelWidth - padding;

        const top =
            maxTop <= minTop ? Math.max(minTop, rawTop) : Math.max(minTop, Math.min(maxTop, rawTop));

        const left =
            maxLeft <= minLeft
                ? Math.max(minLeft, rawLeft)
                : Math.max(minLeft, Math.min(maxLeft, rawLeft));

        setToolbarPos({ top, left });
    }, [selectionMeta?.has, iframeRef, wrapperRef, isMobile]);

    if (!selectionMeta || !selectionMeta.has || !(selectionMeta as any).rect) return null;

    const wrapper = wrapperRef.current;
    if (!wrapper) return null;

    const panelWidth = 268;

    const APPLY_BAR_ESTIMATED_H = 72; // tune: 64–96 depending on your Apply/Close bar height

    const mobileFixedStyle: React.CSSProperties = {
        position: "fixed",
        left: "50%",
        // was: bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${APPLY_BAR_ESTIMATED_H}px + 10px)`,
        transform: "translateX(-50%)",
        zIndex: 9999,
        pointerEvents: "auto",
    };

    const desktopStyle: React.CSSProperties =
        toolbarPos != null
            ? { position: "absolute", top: toolbarPos.top, left: toolbarPos.left, zIndex: 120, pointerEvents: "auto" }
            : { position: "absolute", top: wrapper.scrollTop + 80, left: wrapper.scrollLeft + 14, zIndex: 120, pointerEvents: "auto" };

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
