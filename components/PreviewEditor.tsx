// src/components/PreviewEditor.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";

type Device = "desktop" | "tablet" | "mobile";
type ViewMode = "code" | "preview" | "screenshot";

type Props = {
    initialHtml: string;
    sourceImage?: string;
    onClose: () => Promise<void> | void;
    onExport: (html: string, name?: string) => Promise<void>;
    draftId?: string;
    saveDraft?: (payload: {
        draftId?: string;
        html: string;
        meta: { nameHint?: string; device: Device; mode: ViewMode };
        version: number;
    }) => Promise<void>;
    onLiveHtml?: (html: string) => void;
};

const ACCENT = "#f55f2a";
const STORAGE_KEY = (id?: string) => `kloner:draft:${id || "default"}`;

type SelectionMeta = {
    has: boolean;
    tagName?: string;
};

const FONT_OPTIONS = [
    {
        id: "system-sans",
        label: "System Sans",
        css: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    {
        id: "system-serif",
        label: "System Serif",
        css: 'Georgia, "Times New Roman", Times, serif',
    },
    {
        id: "inter",
        label: "Inter",
        css: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    {
        id: "roboto",
        label: "Roboto",
        css: '"Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    {
        id: "poppins",
        label: "Poppins",
        css: '"Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    {
        id: "space-grotesk",
        label: "Space Grotesk",
        css: '"Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    {
        id: "playfair",
        label: "Playfair Display",
        css: '"Playfair Display", Georgia, "Times New Roman", Times, serif',
    },
    {
        id: "mono",
        label: "Monospace",
        css: '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
];

const TEXT_COLOR_SWATCHES = [
    "#020617",
    "#0f172a",
    "#111827",
    "#334155",
    "#64748b",
    "#f55f2a",
    "#16a34a",
    "#2563eb",
    "#f97316",
    "#e11d48",
];

const BG_COLOR_SWATCHES = [
    "#ffffff",
    "#f9fafb",
    "#f3f4f6",
    "#e5e7eb",
    "#111827",
    "#020617",
    "#fef3c7",
    "#fee2e2",
];

const FONT_SIZE_PRESETS = [
    { id: "xs", label: "XS", px: 12 },
    { id: "sm", label: "S", px: 14 },
    { id: "md", label: "M", px: 16 },
    { id: "lg", label: "L", px: 20 },
    { id: "xl", label: "XL", px: 28 },
];

function stripScripts(html: string) {
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

type StyleCmd =
    | { kind: "fontFamily"; value: string }
    | { kind: "fontSizePx"; value: number }
    | { kind: "align"; value: "left" | "center" | "right" }
    | { kind: "textColor"; value: string }
    | { kind: "bgColor"; value: string }
    | { kind: "transform"; value: "none" | "uppercase" }
    | { kind: "weight"; value: string | number }
    | { kind: "letterSpacing"; value: string };

export default function PreviewEditor({
    initialHtml,
    sourceImage,
    onClose,
    onExport,
    draftId,
    saveDraft,
    onLiveHtml,
}: Props) {
    const [htmlDraft, setHtmlDraft] = useState<string>(() => {
        const fromLs =
            typeof window !== "undefined"
                ? localStorage.getItem(STORAGE_KEY(draftId))
                : null;
        return stripScripts(fromLs || initialHtml || "");
    });

    const [previewHtml, setPreviewHtml] = useState<string>(() =>
        stripScripts(initialHtml || "")
    );
    const [nameHint, setNameHint] = useState<string>("");
    const [version, setVersion] = useState<number>(1);
    const [mode, setMode] = useState<ViewMode>("preview");
    const [device, setDevice] = useState<Device>("desktop");
    const [dirty, setDirty] = useState(false);

    const [savingDraft, setSavingDraft] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportNote, setExportNote] = useState<string>("");
    const [applyingPreview, setApplyingPreview] = useState(false);
    const [closing, setClosing] = useState(false);
    const [closePrompt, setClosePrompt] = useState(false);
    const [exportPrompt, setExportPrompt] = useState(false);

    const [selectionMeta, setSelectionMeta] = useState<SelectionMeta>({
        has: false,
    });

    const iframeRef = useRef<HTMLIFrameElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const asideRef = useRef<HTMLDivElement>(null);
    const [iframeKey, setIframeKey] = useState<number>(0);

    const devicePx = device === "desktop" ? 1440 : device === "tablet" ? 768 : 390;
    const renderHtml = useMemo(() => stripScripts(previewHtml), [previewHtml]);

    const [uiScale, setUiScale] = useState<number>(() => {
        const v =
            typeof window !== "undefined"
                ? Number(localStorage.getItem("kloner:uiScale"))
                : NaN;
        return Number.isFinite(v) && v >= 0.5 && v <= 1.25 ? v : 0.85;
    });
    useEffect(() => {
        localStorage.setItem("kloner:uiScale", String(uiScale));
    }, [uiScale]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (e.key === "-" || e.key === "_") {
                e.preventDefault();
                setUiScale((s) => Math.max(0.5, +(s - 0.05).toFixed(2)));
            } else if (e.key === "=" || e.key === "+") {
                e.preventDefault();
                setUiScale((s) => Math.min(1.25, +(s + 0.05).toFixed(2)));
            } else if (e.key === "0") {
                e.preventDefault();
                setUiScale(1);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY(draftId), htmlDraft);
        setDirty(true);
    }, [htmlDraft, draftId]);

    useEffect(() => {
        if (mode === "screenshot") return;
        setIframeKey((k) => k + 1);
    }, [renderHtml, mode]);

    const tryClearIframeSelection = useCallback(() => {
        const win = iframeRef.current?.contentWindow as any;
        try {
            if (win?.__klonerApi?.clear) win.__klonerApi.clear();
            win?.getSelection?.()?.removeAllRanges?.();
            (win?.document?.activeElement as HTMLElement | null)?.blur?.();
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        const esc = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                (document.activeElement as HTMLElement | null)?.blur?.();
                containerRef.current?.focus?.();
                tryClearIframeSelection();
            }
        };
        window.addEventListener("keydown", esc);
        return () => window.removeEventListener("keydown", esc);
    }, [tryClearIframeSelection]);

    const emitLive = useCallback((html: string) => onLiveHtml?.(html), [onLiveHtml]);

    function applyDraftToPreview() {
        setApplyingPreview(true);
        setPreviewHtml(htmlDraft);
        setDirty(false);
        window.setTimeout(() => setApplyingPreview(false), 450);
    }

    async function doSave(options?: { applyToPreview?: boolean }) {
        if (savingDraft) return;
        setSavingDraft(true);
        try {
            if (!saveDraft) {
                setPreviewHtml(htmlDraft);
                setDirty(false);
                return;
            }
            await saveDraft({
                draftId,
                html: htmlDraft,
                meta: { nameHint: nameHint || undefined, device, mode },
                version: version + 1,
            });
            setVersion((v) => v + 1);
            if (options?.applyToPreview) {
                setPreviewHtml(htmlDraft);
            }
            setDirty(false);
        } finally {
            setSavingDraft(false);
        }
    }

    async function doExport() {
        if (exporting) return;
        setExportNote("");
        setExporting(true);
        try {
            if (dirty) {
                await doSave({ applyToPreview: true });
            }
            const finalHtml = (htmlDraft || previewHtml || "").trim();
            await onExport(finalHtml, nameHint || undefined);
        } catch (e: any) {
            const msg = String(e?.message || "");
            if (/401|403|unauth/i.test(msg)) {
                setExportNote(
                    "Export blocked. Connect your Vercel account in Settings, then retry."
                );
            } else {
                setExportNote("Export failed. Retry shortly.");
            }
            throw e;
        } finally {
            setExporting(false);
        }
    }

    async function getClientUploadUrl(
        filename: string,
        type: string
    ): Promise<{ uploadUrl: string; url: string }> {
        const res = await fetch("/api/user-blob/upload-url", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ filename, contentType: type }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "upload_url_failed");
        return j;
    }
    async function uploadDirect(uploadUrl: string, file: File | Blob) {
        const r = await fetch(uploadUrl, { method: "PUT", body: file });
        if (!r.ok) throw new Error("upload_failed");
    }
    function sanitizeName(name: string) {
        const base = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
        return base.slice(-64) || "image";
    }

    // iframe messages: uploads + selection meta
    useEffect(() => {
        const onMsg = async (e: MessageEvent) => {
            const data = e.data || {};

            if (data?.type === "kloner:upload") {
                const { id, filename, contentType } = data;
                const buf: ArrayBuffer | undefined = data.buffer;
                try {
                    if (!buf || !filename || !contentType) {
                        throw new Error("bad_payload");
                    }
                    const file = new File(
                        [new Uint8Array(buf)],
                        sanitizeName(filename),
                        {
                            type: contentType,
                        }
                    );
                    const { uploadUrl, url } = await getClientUploadUrl(
                        file.name,
                        contentType
                    );
                    await uploadDirect(uploadUrl, file);
                    iframeRef.current?.contentWindow?.postMessage(
                        { type: "kloner:upload:done", id, ok: true, url },
                        "*"
                    );
                } catch (err: any) {
                    iframeRef.current?.contentWindow?.postMessage(
                        {
                            type: "kloner:upload:done",
                            id,
                            ok: false,
                            error: String(err?.message || "upload_failed"),
                        },
                        "*"
                    );
                }
                return;
            }

            if (data?.type === "kloner:selection") {
                const meta = data.meta as SelectionMeta | undefined;
                setSelectionMeta(
                    meta && typeof meta.has === "boolean"
                        ? meta
                        : { has: false }
                );
            }
        };
        window.addEventListener("message", onMsg);
        return () => window.removeEventListener("message", onMsg);
    }, []);

    const sendStyleCommand = useCallback(
        (cmd: StyleCmd) => {
            const win = iframeRef.current?.contentWindow as any;
            try {
                win?.__klonerApi?.style?.(cmd);
            } catch {
                // ignore
            }
        },
        []
    );

    const performClose = useCallback(
        async (mode: "save" | "discard") => {
            if (closing) return;
            setClosing(true);
            tryClearIframeSelection();
            try {
                if (mode === "save" && dirty) {
                    await doSave();
                }
                setClosePrompt(false);
                await onClose?.();
            } finally {
                setClosing(false);
            }
        },
        [closing, dirty, doSave, onClose, tryClearIframeSelection]
    );

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            className="fixed inset-0 z-[9999] bg-black/50"
        >
            <div className="absolute inset-4 overflow-auto">
                <div
                    className="bg-white rounded-xl shadow-xl grid grid-cols-[minmax(320px,360px),1fr] gap-4 p-4 max-lg:grid-cols-1"
                    style={{
                        transform: `scale(${uiScale})`,
                        transformOrigin: "top left",
                        width: `${100 / uiScale}%`,
                        height: `${100 / uiScale}%`,
                    }}
                >
                    {/* Left panel */}
                    <aside
                        ref={asideRef}
                        className="flex flex-col min-w-0 overflow-auto pr-1 max-lg:order-2"
                    >
                        <div className="mb-3">
                            <label className="block text-[11px] font-semibold text-neutral-500 mb-1">
                                Site name
                            </label>
                            <input
                                className="border rounded px-2 py-1 text-sm w-full outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-60"
                                placeholder="Optional"
                                value={nameHint}
                                onChange={(e) => setNameHint(e.target.value)}
                                disabled={closing}
                            />
                        </div>

                        <div className="mb-3">
                            <div className="text-[11px] font-semibold text-neutral-500 mb-1">
                                View
                            </div>
                            <div className="flex flex-wrap gap-1">
                                <UiBtn
                                    pressed={mode === "code"}
                                    onClick={() =>
                                        !closing &&
                                        (setMode("code"), tryClearIframeSelection())
                                    }
                                    disabled={closing}
                                >
                                    Code
                                </UiBtn>
                                <UiBtn
                                    pressed={mode === "preview"}
                                    onClick={() =>
                                        !closing &&
                                        (setMode("preview"), tryClearIframeSelection())
                                    }
                                    disabled={closing}
                                >
                                    Editable preview
                                </UiBtn>
                                <UiBtn
                                    pressed={mode === "screenshot"}
                                    onClick={() =>
                                        !closing &&
                                        (setMode("screenshot"), tryClearIframeSelection())
                                    }
                                    disabled={closing}
                                >
                                    Screenshot
                                </UiBtn>
                            </div>
                        </div>

                        <div className="mb-3">
                            <div className="text-[11px] font-semibold text-neutral-500 mb-1">
                                Device
                            </div>
                            <div className="flex flex-wrap gap-1">
                                <UiBtn
                                    pressed={device === "desktop"}
                                    onClick={() => setDevice("desktop")}
                                    disabled={closing}
                                >
                                    Desktop
                                </UiBtn>
                                <UiBtn
                                    pressed={device === "tablet"}
                                    onClick={() => setDevice("tablet")}
                                    disabled={closing}
                                >
                                    Tablet
                                </UiBtn>
                                <UiBtn
                                    pressed={device === "mobile"}
                                    onClick={() => setDevice("mobile")}
                                    disabled={closing}
                                >
                                    Mobile
                                </UiBtn>
                            </div>
                        </div>

                        <div className="mb-3">
                            <div className="text-[11px] font-semibold text-neutral-500 mb-1">
                                Actions
                            </div>
                            <div className="flex flex-wrap gap-2 items-center">
                                <UiBtn
                                    variant="outline"
                                    onClick={() => doSave()}
                                    disabled={closing || savingDraft}
                                    ariaBusy={savingDraft}
                                >
                                    {savingDraft ? "Saving…" : "Save draft"}
                                </UiBtn>
                                <UiBtn
                                    variant="filled"
                                    onClick={() => setExportPrompt(true)}
                                    disabled={closing || exporting}
                                    ariaBusy={exporting}
                                >
                                    {exporting ? "Exporting…" : "Export to Vercel"}
                                </UiBtn>
                                <UiBtn
                                    variant="outline-quiet"
                                    onClick={() => {
                                        if (dirty) setClosePrompt(true);
                                        else performClose("discard");
                                    }}
                                    disabled={closing}
                                    ariaBusy={closing}
                                >
                                    Close
                                </UiBtn>
                                <span className="ml-auto text-xs text-slate-500 self-center">
                                    v{version}
                                </span>
                                <div className="flex items-center gap-1 text-[11px] text-slate-500">
                                    <button
                                        className="px-1.5 py-0.5 border rounded hover:bg-neutral-50 active:scale-[.99] focus:outline-none focus:ring-2 focus:ring-neutral-300"
                                        onClick={() =>
                                            setUiScale((s) =>
                                                Math.max(0.5, +(s - 0.05).toFixed(2))
                                            )
                                        }
                                        disabled={closing}
                                    >
                                        -
                                    </button>
                                    <span className="w-10 text-center">
                                        {Math.round(uiScale * 100)}%
                                    </span>
                                    <button
                                        className="px-1.5 py-0.5 border rounded hover:bg-neutral-50 active:scale-[.99] focus:outline-none focus:ring-2 focus:ring-neutral-300"
                                        onClick={() =>
                                            setUiScale((s) =>
                                                Math.min(1.25, +(s + 0.05).toFixed(2))
                                            )
                                        }
                                        disabled={closing}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                            {exportNote && (
                                <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] text-amber-800">
                                    {exportNote}
                                </div>
                            )}
                        </div>

                        <div className="mb-3">
                            <div className="text-[11px] font-semibold text-neutral-500 mb-1">
                                Preview sync
                            </div>
                            <button
                                onClick={applyDraftToPreview}
                                disabled={closing || !dirty}
                                aria-busy={applyingPreview}
                                className={`rounded px-3 py-1.5 text-sm w-full transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-neutral-300 active:scale-[.99] ${
                                    dirty
                                        ? "bg-emerald-600 text-white hover:brightness-95"
                                        : "bg-emerald-50 text-emerald-700"
                                }`}
                                title="Apply current draft to the live preview"
                            >
                                {applyingPreview
                                    ? "Updating preview…"
                                    : dirty
                                    ? "Apply changes to preview"
                                    : "Preview is up to date"}
                            </button>
                        </div>

                        {/* Selection styling sidebar */}
                        {mode === "preview" && (
                            <div className="mb-3 border-t pt-3 mt-2">
                                <div className="flex items-center justify-between mb-1">
                                    <div className="text-[11px] font-semibold text-neutral-500">
                                        Selection style
                                    </div>
                                    <div className="text-[10px] text-neutral-400">
                                        {selectionMeta.has
                                            ? selectionMeta.tagName || "Element"
                                            : "Click any block to style it"}
                                    </div>
                                </div>

                                <div className="space-y-2 text-[11px]">
                                    {/* Font family */}
                                    <div>
                                        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                            Font
                                        </div>
                                        <select
                                            className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-50"
                                            disabled={closing}
                                            onChange={(e) => {
                                                const opt = FONT_OPTIONS.find(
                                                    (f) => f.id === e.target.value
                                                );
                                                if (!opt) return;
                                                sendStyleCommand({
                                                    kind: "fontFamily",
                                                    value: opt.css,
                                                });
                                            }}
                                            defaultValue=""
                                        >
                                            <option value="" disabled>
                                                Choose font
                                            </option>
                                            {FONT_OPTIONS.map((f) => (
                                                <option key={f.id} value={f.id}>
                                                    {f.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Font size */}
                                    <div>
                                        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                            Size
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {FONT_SIZE_PRESETS.map((s) => (
                                                <button
                                                    key={s.id}
                                                    type="button"
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                    disabled={closing}
                                                    onClick={() =>
                                                        sendStyleCommand({
                                                            kind: "fontSizePx",
                                                            value: s.px,
                                                        })
                                                    }
                                                >
                                                    {s.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Align */}
                                    <div>
                                        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                            Align
                                        </div>
                                        <div className="flex gap-1">
                                            {[
                                                { id: "left", label: "L" },
                                                { id: "center", label: "C" },
                                                { id: "right", label: "R" },
                                            ].map((a) => (
                                                <button
                                                    key={a.id}
                                                    type="button"
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                    disabled={closing}
                                                    onClick={() =>
                                                        sendStyleCommand({
                                                            kind: "align",
                                                            value: a.id as
                                                                | "left"
                                                                | "center"
                                                                | "right",
                                                        })
                                                    }
                                                >
                                                    {a.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Weight / transform */}
                                    <div className="flex flex-wrap gap-1">
                                        <button
                                            type="button"
                                            className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                            disabled={closing}
                                            onClick={() =>
                                                sendStyleCommand({
                                                    kind: "weight",
                                                    value: "600",
                                                })
                                            }
                                        >
                                            Semi-bold
                                        </button>
                                        <button
                                            type="button"
                                            className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                            disabled={closing}
                                            onClick={() =>
                                                sendStyleCommand({
                                                    kind: "weight",
                                                    value: "400",
                                                })
                                            }
                                        >
                                            Normal
                                        </button>
                                        <button
                                            type="button"
                                            className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                            disabled={closing}
                                            onClick={() =>
                                                sendStyleCommand({
                                                    kind: "transform",
                                                    value: "uppercase",
                                                })
                                            }
                                        >
                                            UPPERCASE
                                        </button>
                                        <button
                                            type="button"
                                            className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                            disabled={closing}
                                            onClick={() =>
                                                sendStyleCommand({
                                                    kind: "transform",
                                                    value: "none",
                                                })
                                            }
                                        >
                                            Aa
                                        </button>
                                    </div>

                                    {/* Text color */}
                                    <div>
                                        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                            Text color
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {TEXT_COLOR_SWATCHES.map((c) => (
                                                <button
                                                    key={c}
                                                    type="button"
                                                    className="w-6 h-6 rounded-full border border-black/10 shadow-sm hover:scale-105 active:scale-95 disabled:opacity-40"
                                                    style={{ background: c }}
                                                    disabled={closing}
                                                    onClick={() =>
                                                        sendStyleCommand({
                                                            kind: "textColor",
                                                            value: c,
                                                        })
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    {/* Background color */}
                                    <div>
                                        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                            Background
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {BG_COLOR_SWATCHES.map((c) => (
                                                <button
                                                    key={c}
                                                    type="button"
                                                    className="w-6 h-6 rounded-full border border-black/10 shadow-sm hover:scale-105 active:scale-95 disabled:opacity-40"
                                                    style={{ background: c }}
                                                    disabled={closing}
                                                    onClick={() =>
                                                        sendStyleCommand({
                                                            kind: "bgColor",
                                                            value: c,
                                                        })
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    {/* Spacing */}
                                    <div>
                                        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                            Spacing
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            <button
                                                type="button"
                                                className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                disabled={closing}
                                                onClick={() =>
                                                    sendStyleCommand({
                                                        kind: "letterSpacing",
                                                        value: "-0.02em",
                                                    })
                                                }
                                            >
                                                Tight
                                            </button>
                                            <button
                                                type="button"
                                                className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                disabled={closing}
                                                onClick={() =>
                                                    sendStyleCommand({
                                                        kind: "letterSpacing",
                                                        value: "0",
                                                    })
                                                }
                                            >
                                                Normal
                                            </button>
                                            <button
                                                type="button"
                                                className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                disabled={closing}
                                                onClick={() =>
                                                    sendStyleCommand({
                                                        kind: "letterSpacing",
                                                        value: "0.08em",
                                                    })
                                                }
                                            >
                                                Wide
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {mode === "code" && (
                            <div className="min-h-0 flex-1">
                                <textarea
                                    className="h-full w-full border rounded p-2 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-60"
                                    value={htmlDraft}
                                    onChange={(e) => setHtmlDraft(e.target.value)}
                                    spellCheck={false}
                                    disabled={closing}
                                />
                            </div>
                        )}

                        {mode === "screenshot" && (
                            <div className="text-xs text-slate-600">
                                Edit in Preview or Code, apply with “Apply changes to
                                preview”, then save or export.
                            </div>
                        )}
                    </aside>

                    {/* Right / canvas */}
                    <section
                        className="relative bg-slate-50 rounded-lg border overflow-hidden flex flex-col max-lg:order-1"
                        onPointerDown={(e) => {
                            if (!(e.target as HTMLElement).closest("iframe"))
                                tryClearIframeSelection();
                        }}
                    >
                        {sourceImage && mode !== "screenshot" && (
                            <img
                                src={sourceImage}
                                alt="reference"
                                className="absolute right-3 top-3 h-28 w-auto rounded border shadow pointer-events-none max-sm:hidden"
                            />
                        )}

                        {(mode === "preview" || mode === "code") && (
                            <div className="flex-1 overflow-auto p-3 sm:p-6">
                                <div
                                    className="mx-auto bg-white border rounded-lg shadow-sm"
                                    style={{
                                        width: devicePx,
                                        minWidth: 320,
                                        maxWidth: "100%",
                                    }}
                                >
                                    <iframe
                                        key={iframeKey}
                                        ref={iframeRef}
                                        className="w-full h-[70vh] sm:h-[80vh] border-0 rounded"
                                        title="KlonerPreview"
                                        sandbox="allow-same-origin"
                                        srcDoc={
                                            renderHtml ||
                                            "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
                                        }
                                        onLoad={() => {
                                            const doc =
                                                iframeRef.current?.contentDocument;
                                            if (!doc) return;
                                            doc
                                                .querySelectorAll(".kloner-toolbar")
                                                .forEach((n) => n.remove());
                                            doc
                                                .querySelectorAll(".kloner-style-panel")
                                                .forEach((n) => n.remove());
                                            if (mode === "preview") {
                                                injectEditableOverlay(doc, (updated) => {
                                                    setHtmlDraft(updated);
                                                    emitLive(updated);
                                                });
                                                iframeRef.current?.contentWindow?.focus();
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                        )}

                        {mode === "screenshot" && (
                            <div className="flex-1 overflow-auto p-6">
                                <div
                                    className="mx-auto"
                                    style={{ width: devicePx, minWidth: 320 }}
                                >
                                    {sourceImage ? (
                                        <img
                                            src={sourceImage}
                                            alt="Reference"
                                            className="w-full h-auto rounded border bg-white"
                                        />
                                    ) : (
                                        <div className="h-[60vh] grid place-items-center text-slate-500 text-sm">
                                            No reference screenshot
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {closing && (
                            <div className="absolute inset-0 bg-white/80 grid place-items-center">
                                <div className="flex items-center gap-3 rounded border px-3 py-2 bg-white text-sm text-neutral-800">
                                    <Spinner /> Saving & closing…
                                </div>
                            </div>
                        )}
                    </section>
                </div>

                {/* close/save/discard prompt */}
                {closePrompt && (
                    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
                        <div className="bg-white rounded-lg shadow-xl p-4 w-full max-w-sm border border-neutral-200">
                            <div className="text-sm font-semibold text-neutral-900 mb-2">
                                Close editor?
                            </div>
                            <p className="text-xs text-neutral-600 mb-3">
                                You have unsaved changes. Save them before closing, or
                                discard this draft.
                            </p>
                            <div className="flex justify-end gap-2 text-xs">
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-50 active:scale-[.98]"
                                    onClick={() => setClosePrompt(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 active:scale-[.98]"
                                    onClick={() => performClose("discard")}
                                >
                                    Discard
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-transparent bg-neutral-900 text-white hover:brightness-110 active:scale-[.98]"
                                    onClick={() => performClose("save")}
                                >
                                    Save & close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* export confirmation */}
                {exportPrompt && (
                    <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/40">
                        <div className="bg-white rounded-lg shadow-xl p-4 w-full max-w-sm border border-neutral-200">
                            <div className="text-sm font-semibold text-neutral-900 mb-2">
                                Deploy to Vercel?
                            </div>
                            <p className="text-xs text-neutral-600 mb-2">
                                This will export your current preview and trigger a
                                deployment to your connected Vercel project.
                            </p>
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
                                Warning: these changes can reach your live site once the
                                deployment finishes.
                            </p>
                            <div className="flex justify-end gap-2 text-xs">
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-50 active:scale-[.98] disabled:opacity-60"
                                    onClick={() => setExportPrompt(false)}
                                    disabled={exporting}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-transparent bg-neutral-900 text-white hover:brightness-110 active:scale-[.98] disabled:opacity-60 flex items-center gap-2"
                                    onClick={async () => {
                                        setExportPrompt(false);
                                        await doExport();
                                    }}
                                    disabled={exporting}
                                >
                                    {exporting && <Spinner size={14} />} Deploy now
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
        </div>
    );
}

function Spinner({ size = 18 }: { size?: number }) {
    return (
        <span
            className="inline-block rounded-full border-2 border-neutral-300 border-t-transparent"
            style={{ width: size, height: size, animation: "spin .8s linear infinite" }}
            aria-hidden
        />
    );
}

function UiBtn({
    children,
    pressed,
    onClick,
    variant = "tab",
    disabled,
    ariaBusy,
}: {
    children: React.ReactNode;
    pressed?: boolean;
    onClick?: () => void;
    variant?: "tab" | "outline" | "outline-quiet" | "filled";
    disabled?: boolean;
    ariaBusy?: boolean;
}) {
    const base =
        "inline-flex items-center justify-center gap-2 transition active:scale-[.99] focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-60 disabled:cursor-not-allowed text-sm";

    const withBusy = (
        <>
            {ariaBusy && <Spinner size={14} />}
            <span>{children}</span>
        </>
    );

    if (variant === "filled") {
        return (
            <button
                onClick={onClick}
                disabled={disabled}
                aria-busy={ariaBusy}
                className={`${base} rounded-md px-3 py-1.5 font-semibold text-white shadow-sm hover:brightness-95`}
                style={{ backgroundColor: ACCENT }}
            >
                {withBusy}
            </button>
        );
    }
    if (variant === "outline") {
        return (
            <button
                onClick={onClick}
                disabled={disabled}
                aria-busy={ariaBusy}
                className={`${base} rounded-md px-3 py-1.5 border border-neutral-300 bg-white hover:bg-neutral-50`}
            >
                {withBusy}
            </button>
        );
    }
    if (variant === "outline-quiet") {
        return (
            <button
                onClick={onClick}
                disabled={disabled}
                aria-busy={ariaBusy}
                className={`${base} rounded-md px-3 py-1.5 border border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100`}
            >
                {withBusy}
            </button>
        );
    }
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            aria-busy={ariaBusy}
            className={`${base} px-2.5 py-1 rounded-full border text-xs ${
                pressed
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-50"
            }`}
        >
            {withBusy}
        </button>
    );
}

/* ------------------------ in-iframe edit layer ------------------------ */
function injectEditableOverlay(doc: Document, onChange: (updatedHtml: string) => void) {
    doc.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());
    doc.querySelectorAll(".kloner-style-panel").forEach((n) => n.remove());

    const style = doc.createElement("style");
    style.textContent = `
    :root { --amber-50:#FFFBEB; --amber-200:#FDE68A; --amber-700:#B45309; --rose-50:#FFF1F2; --rose-200:#FECDD3; --rose-700:#BE123C; --slate-700:#334155; --slate-300:#cbd5e1; }
    [data-kloner-sel]{ outline:2px dashed #10b981 !important; outline-offset:2px !important; }
    .kloner-toolbar{
      position:fixed;
      z-index:2147483647;
      display:none;
      flex-wrap:wrap;
      gap:6px;
      padding:6px 8px;
      background:#020617;
      color:#e5e7eb;
      border-radius:10px;
      font:11px/1.2 system-ui,-apple-system,Segoe UI,Roboto;
      box-shadow:0 10px 30px rgba(0,0,0,.25);
      max-width:calc(100vw - 16px);
    }
    .kbtn{
      display:inline-flex;
      align-items:center;
      gap:4px;
      padding:4px 6px;
      border-radius:7px;
      border:1px solid transparent;
      cursor:pointer;
      font-weight:600;
      font-size:11px;
      background:#111827;
      color:#e5e7eb;
      white-space:nowrap;
    }
    .kbtn-close{ background:#0f172a; color:#fff; border-color:#0f172a; }
    .kbtn-edit{ background:var(--amber-50); color:var(--amber-700); border-color:var(--amber-200); }
    .kbtn-del{  background:var(--rose-50);  color:var(--rose-700);  border-color:var(--rose-200); }
    .kbtn-img { background:#ecfeff; color:#155e75; border-color:#a5f3fc; }
    .khint {
      position:fixed;
      z-index:2147483646;
      padding:6px 8px;
      background:#111827;
      color:#fff;
      border-radius:8px;
      font:12px/1.2 system-ui;
      max-width:320px;
    }
  `;
    doc.head.appendChild(style);

    const fileInput = doc.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    doc.body.appendChild(fileInput);

    const hint = doc.createElement("div");
    hint.className = "khint";
    hint.style.display = "none";
    doc.body.appendChild(hint);

    function showHint(text: string, near: HTMLElement) {
        hint.textContent = text;
        const r = near.getBoundingClientRect();
        hint.style.left = `${Math.min(r.left, doc.defaultView!.innerWidth - 340)}px`;
        hint.style.top = `${r.bottom + 8}px`;
        hint.style.display = "block";
        setTimeout(() => (hint.style.display = "none"), 4000);
    }

    function cssBox(el: HTMLElement) {
        const cs = doc.defaultView!.getComputedStyle(el);
        return {
            w: el.getBoundingClientRect().width,
            h: el.getBoundingClientRect().height,
            fontSize: (cs as any).fontSize as string,
            textAlign: (cs as any).textAlign as string,
            fontFamily: (cs as any).fontFamily as string,
            color: (cs as any).color as string,
            backgroundColor: (cs as any).backgroundColor as string,
        };
    }

    const texty = new Set([
        "P",
        "SPAN",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "LI",
        "SMALL",
        "STRONG",
        "EM",
        "LABEL",
        "BUTTON",
        "A",
        "DIV",
    ]);
    function markEditable(root: ParentNode) {
        const w = doc.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT);
        while (w.nextNode()) {
            const el = w.currentNode as HTMLElement;
            if (texty.has(el.tagName)) el.contentEditable = "true";
        }
    }
    markEditable(doc.body);

    const toolbar = doc.createElement("div");
    toolbar.className = "kloner-toolbar";
    toolbar.innerHTML = `
    <button class="kbtn kbtn-close" data-act="close">Close</button>
    <button class="kbtn kbtn-edit" data-act="dup">Duplicate</button>
    <button class="kbtn kbtn-del"  data-act="del">Delete block</button>
    <button class="kbtn kbtn-img"  data-act="img-insert">Insert image</button>
    <button class="kbtn kbtn-img"  data-act="img-replace">Replace image</button>
    <button class="kbtn kbtn-img"  data-act="img-alt">ALT text</button>
    <button class="kbtn kbtn-img"  data-act="link">Link</button>
  `;
    doc.body.appendChild(toolbar);

    let selected: HTMLElement | null = null;

    function serializeClean(): string {
        const docClone = doc.documentElement.cloneNode(true) as HTMLElement;
        const body = (docClone as HTMLHtmlElement).querySelector("body")!;
        body.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());
        body.querySelectorAll(".kloner-style-panel").forEach((n) => n.remove());
        body.querySelectorAll("[data-kloner-sel]").forEach((n) =>
            (n as HTMLElement).removeAttribute("data-kloner-sel")
        );
        body.querySelectorAll("[contenteditable]").forEach((n) =>
            (n as HTMLElement).removeAttribute("contenteditable")
        );
        return "<!doctype html>\n" + (docClone as any).outerHTML;
    }

    let hist: string[] = [];
    let idx = -1;
    function saveHistory() {
        const snap = serializeClean();
        if (idx >= 0 && hist[idx] === snap) return;
        hist = hist.slice(0, idx + 1);
        hist.push(snap);
        idx = hist.length - 1;
        updateUndoRedoState();
    }
    function restoreHistory(nextIndex: number) {
        if (nextIndex < 0 || nextIndex >= hist.length) return;
        idx = nextIndex;
        const parser = new DOMParser();
        const doc2 = parser.parseFromString(hist[idx], "text/html");
        doc.body.replaceWith(doc.importNode(doc2.body, true));
        doc.body.appendChild(toolbar);
        markEditable(doc.body);
        select(null);
        updateUndoRedoState();
        notify();
    }
    function undo() {
        restoreHistory(idx - 1);
    }
    function redo() {
        restoreHistory(idx + 1);
    }
    function updateUndoRedoState() {
        // reserved for future undo/redo UI
    }
    saveHistory();

    function publishSelection() {
        const payload = selected
            ? {
                  has: true,
                  tagName: selected.tagName,
              }
            : { has: false };
        doc.defaultView?.parent?.postMessage(
            { type: "kloner:selection", meta: payload },
            "*"
        );
    }

    function placeToolbar(target: HTMLElement) {
        const r = target.getBoundingClientRect();
        toolbar.style.display = "flex";
        toolbar.style.visibility = "hidden";
        toolbar.style.left = "0px";
        toolbar.style.top = "0px";

        const tbRect = toolbar.getBoundingClientRect();
        const vw = doc.defaultView!.innerWidth;
        const vh = doc.defaultView!.innerHeight;

        let x = Math.min(Math.max(8, r.left), vw - tbRect.width - 8);
        if (x < 8) x = 8;

        const spaceAbove = r.top;
        const spaceBelow = vh - r.bottom;
        let y: number;

        if (spaceAbove >= tbRect.height + 8) {
            y = r.top - tbRect.height - 8;
        } else if (spaceBelow >= tbRect.height + 8) {
            y = r.bottom + 8;
        } else {
            y = Math.max(8, r.bottom + 8);
            if (y + tbRect.height > vh) y = vh - tbRect.height - 8;
        }

        toolbar.style.left = `${x}px`;
        toolbar.style.top = `${y}px`;
        toolbar.style.visibility = "visible";
    }

    function select(el: HTMLElement | null) {
        if (selected) selected.removeAttribute("data-kloner-sel");
        selected = el;
        if (selected) {
            selected.setAttribute("data-kloner-sel", "1");
            placeToolbar(selected);
        } else {
            toolbar.style.display = "none";
        }
        publishSelection();
    }

    function applyStyleCommand(cmd: any) {
        if (!selected || !cmd || typeof cmd.kind !== "string") return;

        if (cmd.kind === "fontFamily" && typeof cmd.value === "string") {
            selected.style.fontFamily = cmd.value;
        } else if (cmd.kind === "fontSizePx" && typeof cmd.value === "number") {
            selected.style.fontSize = `${cmd.value}px`;
        } else if (cmd.kind === "align") {
            if (
                cmd.value === "left" ||
                cmd.value === "center" ||
                cmd.value === "right"
            ) {
                selected.style.textAlign = cmd.value;
            }
        } else if (cmd.kind === "textColor" && typeof cmd.value === "string") {
            selected.style.color = cmd.value;
        } else if (cmd.kind === "bgColor" && typeof cmd.value === "string") {
            selected.style.backgroundColor = cmd.value;
        } else if (cmd.kind === "transform") {
            if (cmd.value === "uppercase") {
                selected.style.textTransform = "uppercase";
            } else if (cmd.value === "none") {
                selected.style.textTransform = "none";
            }
        } else if (cmd.kind === "weight") {
            if (
                typeof cmd.value === "string" ||
                typeof cmd.value === "number"
            ) {
                (selected.style as any).fontWeight = String(cmd.value);
            }
        } else if (cmd.kind === "letterSpacing" && typeof cmd.value === "string") {
            (selected.style as any).letterSpacing = cmd.value;
        } else {
            return;
        }

        saveHistory();
        notify();
        publishSelection();
    }

    const api: any = (doc.defaultView as any).__klonerApi || {};
    api.clear = () => {
        select(null);
        (doc.activeElement as HTMLElement | null)?.blur?.();
    };
    api.style = (cmd: any) => applyStyleCommand(cmd);
    (doc.defaultView as any).__klonerApi = api;

    doc.addEventListener(
        "click",
        (e) => {
            const t = e.target as HTMLElement;
            if (toolbar.contains(t)) return;
            const block = t.closest(
                "section, article, header, footer, main, button, a, div, li, p, h1, h2, h3, h4, h5"
            ) as HTMLElement | null;
            if (block) select(block);
            else select(null);
        },
        true
    );

    async function requestParentUpload(file: File): Promise<{ url: string }> {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const buf = await file.arrayBuffer();
        return new Promise((resolve, reject) => {
            const onMsg = (ev: MessageEvent) => {
                const d = ev.data || {};
                if (d?.type !== "kloner:upload:done" || d?.id !== id) return;
                doc.defaultView?.removeEventListener("message", onMsg as any);
                if (d.ok) resolve({ url: d.url as string });
                else reject(new Error(String(d.error || "upload_failed")));
            };
            doc.defaultView?.addEventListener("message", onMsg as any);
            doc.defaultView?.parent?.postMessage(
                {
                    type: "kloner:upload",
                    id,
                    filename: file.name,
                    contentType: file.type,
                    buffer: buf,
                },
                "*"
            );
        });
    }

    async function pickFileAndUpload(
        anchor: HTMLElement
    ): Promise<{ url: string; file: File }> {
        return new Promise((resolve, reject) => {
            fileInput.onchange = async () => {
                const f = (fileInput.files && fileInput.files[0]) || null;
                fileInput.value = "";
                if (!f) return reject(new Error("no_file"));
                if (f.size > 8 * 1024 * 1024) {
                    showHint("Image too large (8MB max).", anchor);
                    return reject(new Error("too_large"));
                }
                if (!/^image\//.test(f.type)) {
                    showHint("Unsupported type.", anchor);
                    return reject(new Error("bad_type"));
                }
                try {
                    const { url } = await requestParentUpload(f);
                    resolve({ url, file: f });
                } catch (e) {
                    showHint("Upload failed.", anchor);
                    reject(e as any);
                }
            };
            fileInput.click();
        });
    }

    async function insertImageIntoBlock(block: HTMLElement) {
        const { url } = await pickFileAndUpload(block);

        const img = doc.createElement("img");
        img.src = url;
        img.alt = "";
        img.style.display = "block";

        const box = cssBox(block);
        if (box.w > 4) img.setAttribute("width", String(Math.round(box.w)));
        if (box.h > 4) img.setAttribute("height", String(Math.round(box.h)));

        if (block.firstChild) block.insertBefore(img, block.firstChild);
        else block.appendChild(img);
        saveHistory();
        notify();
        showHint("Image inserted.", block);
    }

    async function replaceImage(el: HTMLImageElement) {
        const box = cssBox(el);
        const { url } = await pickFileAndUpload(el);
        if (!el.getAttribute("width") && !el.style.width)
            el.setAttribute("width", `${Math.round(box.w)}`);
        if (!el.getAttribute("height") && !el.style.height)
            el.setAttribute("height", `${Math.round(box.h)}`);
        el.src = url;
        saveHistory();
        notify();
        showHint("Image replaced.", el);
    }

    function editLink(target: HTMLElement) {
        let linkEl: HTMLAnchorElement | null = null;
        if (target.tagName === "A") {
            linkEl = target as HTMLAnchorElement;
        } else {
            linkEl = target.closest("a") as HTMLAnchorElement | null;
        }
        if (!linkEl) {
            showHint("No link found here.", target);
            return;
        }
        const current = linkEl.getAttribute("href") || "";
        const next = prompt("Link URL (href):", current);
        if (next === null) return;
        if (next.trim() === "") {
            linkEl.removeAttribute("href");
            showHint("Link cleared.", linkEl);
        } else {
            linkEl.setAttribute("href", next.trim());
            showHint("Link updated.", linkEl);
        }
        saveHistory();
        notify();
    }

    function handleAction(act: string | null, sourceEl: HTMLElement) {
        if (!act) return;

        if (act === "close") {
            (doc.defaultView as any).__klonerApi?.clear();
            return;
        }
        if (!selected) return;

        if (act === "del") {
            const parent = selected.parentElement;
            selected.remove();
            select(null);
            parent?.focus?.();
            saveHistory();
            notify();
            return;
        }
        if (act === "dup") {
            const clone = selected.cloneNode(true) as HTMLElement;
            selected.insertAdjacentElement("afterend", clone);
            markEditable(clone);
            select(clone);
            saveHistory();
            notify();
            return;
        }
        if (act === "img-insert") {
            insertImageIntoBlock(selected).catch(() => {});
            return;
        }
        if (act === "img-replace") {
            const img =
                (selected.tagName === "IMG"
                    ? (selected as HTMLImageElement)
                    : (selected.querySelector("img") as HTMLImageElement | null)) ??
                null;
            if (!img) {
                showHint("No <img> here. Use Insert image.", selected);
                return;
            }
            replaceImage(img);
            return;
        }
        if (act === "img-alt") {
            const img =
                (selected.tagName === "IMG"
                    ? (selected as HTMLImageElement)
                    : (selected.querySelector("img") as HTMLImageElement | null)) ??
                null;
            if (!img) {
                showHint("Select a block with an <img>.", selected);
                return;
            }
            const next = prompt("Alt text:", img.getAttribute("alt") || "");
            if (next !== null) {
                img.setAttribute("alt", next);
                saveHistory();
                notify();
                showHint("ALT updated.", img);
            }
            return;
        }
        if (act === "link") {
            editLink(selected);
            return;
        }
    }

    const actionListener = (e: Event) => {
        const target = e.target as HTMLElement;
        const btn = target.closest("[data-act]") as HTMLElement | null;
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        e.preventDefault();
        e.stopPropagation();
        handleAction(act, btn);
    };

    toolbar.addEventListener("click", actionListener);

    doc.addEventListener("keydown", (e) => {
        const key = e.key.toLowerCase();
        const mod = e.metaKey || e.ctrlKey;
        if (mod && key === "z") {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
        }
        if (e.key === "Escape") (doc.defaultView as any).__klonerApi?.clear();
        if ((key === "backspace" || key === "delete") && selected) {
            const active = doc.activeElement as HTMLElement | null;
            if (
                !active?.isContentEditable &&
                active?.tagName !== "INPUT" &&
                active?.tagName !== "TEXTAREA"
            ) {
                e.preventDefault();
                const parent = selected.parentElement;
                selected.remove();
                (doc.defaultView as any).__klonerApi?.clear();
                parent?.focus?.();
                saveHistory();
                notify();
            }
        }
    });

    const notify = (() => {
        let t = 0 as unknown as number;
        let raf = 0 as unknown as number;
        return () => {
            clearTimeout(t as any);
            if (raf) cancelAnimationFrame(raf as any);
            t = window.setTimeout(() => {
                raf = requestAnimationFrame(() => {
                    saveHistory();
                    onChange(serializeClean());
                });
            }, 250);
        };
    })();

    const mo = new MutationObserver(() => notify());
    mo.observe(doc.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
    });
    doc.addEventListener("input", notify, true);

    updateUndoRedoState();
    publishSelection();
}
