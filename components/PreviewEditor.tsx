// src/components/PreviewEditor.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";

type Device = "desktop" | "tablet" | "mobile";
type ViewMode = "code" | "preview" | "screenshot";

type Props = {
    initialHtml: string;
    sourceImage?: string;
    onClose: () => Promise<void> | void; // may be async; show "Saving…" state
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

function stripScripts(html: string) {
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

function rafDebounce(fn: () => void, ms = 300) {
    let t = 0 as unknown as number;
    let raf = 0 as unknown as number;
    return () => {
        window.clearTimeout(t);
        if (raf) cancelAnimationFrame(raf);
        t = window.setTimeout(() => {
            raf = requestAnimationFrame(fn);
        }, ms);
    };
}

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
        const fromLs = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY(draftId)) : null;
        return stripScripts(fromLs || initialHtml || "");
    });

    const [previewHtml, setPreviewHtml] = useState<string>(() => stripScripts(initialHtml || ""));
    const [nameHint, setNameHint] = useState<string>("");
    const [version, setVersion] = useState<number>(1);
    const [mode, setMode] = useState<ViewMode>("preview");
    const [device, setDevice] = useState<Device>("desktop");
    const [dirty, setDirty] = useState(false);

    // New UI feedback states
    const [savingDraft, setSavingDraft] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [applyingPreview, setApplyingPreview] = useState(false);

    // visual "saving/closing" state
    const [closing, setClosing] = useState(false);

    const iframeRef = useRef<HTMLIFrameElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const asideRef = useRef<HTMLDivElement>(null);
    const [iframeKey, setIframeKey] = useState<number>(0);

    const devicePx = device === "desktop" ? 1440 : device === "tablet" ? 768 : 390;
    const renderHtml = useMemo(() => stripScripts(previewHtml), [previewHtml]);

    // UI scale (kept)
    const [uiScale, setUiScale] = useState<number>(() => {
        const v = typeof window !== "undefined" ? Number(localStorage.getItem("kloner:uiScale")) : NaN;
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
    }, []);

    useEffect(() => {
        const el = asideRef.current;
        if (!el) return;
        const onDown = () => tryClearIframeSelection();
        el.addEventListener("pointerdown", onDown, { capture: true });
        return () => el.removeEventListener("pointerdown", onDown, { capture: true } as any);
    }, []);

    const tryClearIframeSelection = useCallback(() => {
        const win = iframeRef.current?.contentWindow as any;
        try {
            if (win?.__klonerApi?.clear) win.__klonerApi.clear();
            win?.getSelection?.()?.removeAllRanges?.();
            (win?.document?.activeElement as HTMLElement | null)?.blur?.();
        } catch { }
    }, []);

    const emitLive = useCallback((html: string) => onLiveHtml?.(html), [onLiveHtml]);

    function applyDraftToPreview() {
        setApplyingPreview(true);
        setPreviewHtml(htmlDraft);
        setDirty(false);
        // quick visual confirmation pulse
        window.setTimeout(() => setApplyingPreview(false), 450);
    }

    async function doSave() {
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
            setDirty(false);
        } finally {
            setSavingDraft(false);
        }
    }

    async function doExport() {
        if (exporting) return;
        setExporting(true);
        try {
            await onExport((previewHtml || "").trim(), nameHint || undefined);
        } finally {
            setExporting(false);
        }
    }

    // Close now auto-saves before calling onClose. Shows blocking overlay.
    const handleClose = useCallback(async () => {
        if (closing) return;
        setClosing(true);
        tryClearIframeSelection();
        try {
            if (dirty) {
                await doSave();
            }
            await onClose?.();
        } finally {
            setClosing(false);
        }
    }, [closing, dirty, onClose, tryClearIframeSelection]);

    return (
        <div ref={containerRef} tabIndex={-1} className="fixed inset-0 z-[9999] bg-black/50">
            <div className="absolute inset-4 overflow-auto">
                <div
                    className="bg-white rounded-xl shadow-xl grid grid-cols-[minmax(320px,360px),1fr] gap-4 p-4"
                    style={{
                        transform: `scale(${uiScale})`,
                        transformOrigin: "top left",
                        width: `${100 / uiScale}%`,
                        height: `${100 / uiScale}%`,
                    }}
                >
                    {/* Left: Controls */}
                    <aside ref={asideRef} className="flex flex-col min-w-0 overflow-auto pr-1">
                        {/* Name */}
                        <div className="mb-3">
                            <label className="block text-[11px] font-semibold text-neutral-500 mb-1">Export name</label>
                            <input
                                className="border rounded px-2 py-1 text-sm w-full outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-60"
                                placeholder="Optional"
                                value={nameHint}
                                onChange={(e) => setNameHint(e.target.value)}
                                disabled={closing}
                            />
                        </div>

                        {/* Mode */}
                        <div className="mb-3">
                            <div className="text-[11px] font-semibold text-neutral-500 mb-1">Mode</div>
                            <div className="flex flex-wrap gap-1">
                                <UiBtn pressed={mode === "code"} onClick={() => !closing && (setMode("code"), tryClearIframeSelection())} disabled={closing}>
                                    Code
                                </UiBtn>
                                <UiBtn pressed={mode === "preview"} onClick={() => !closing && (setMode("preview"), tryClearIframeSelection())} disabled={closing}>
                                    Preview (editable)
                                </UiBtn>
                                <UiBtn pressed={mode === "screenshot"} onClick={() => !closing && (setMode("screenshot"), tryClearIframeSelection())} disabled={closing}>
                                    Screenshot
                                </UiBtn>
                            </div>
                        </div>

                        {/* Device */}
                        <div className="mb-3">
                            <div className="text-[11px] font-semibold text-neutral-500 mb-1">Device</div>
                            <div className="flex flex-wrap gap-1">
                                <UiBtn pressed={device === "desktop"} onClick={() => setDevice("desktop")} disabled={closing}>
                                    Desktop
                                </UiBtn>
                                <UiBtn pressed={device === "tablet"} onClick={() => setDevice("tablet")} disabled={closing}>
                                    Tablet
                                </UiBtn>
                                <UiBtn pressed={device === "mobile"} onClick={() => setDevice("mobile")} disabled={closing}>
                                    Mobile
                                </UiBtn>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="mb-3">
                            <div className="text-[11px] font-semibold text-neutral-500 mb-1">Actions</div>
                            <div className="flex flex-wrap gap-2 items-center">
                                <UiBtn variant="outline" onClick={doSave} disabled={closing || savingDraft} ariaBusy={savingDraft}>
                                    {savingDraft ? "Saving…" : "Save Draft"}
                                </UiBtn>
                                <UiBtn variant="filled" onClick={doExport} disabled={closing || exporting} ariaBusy={exporting}>
                                    {exporting ? "Exporting…" : "Export to Vercel"}
                                </UiBtn>
                                <UiBtn variant="outline" onClick={handleClose} disabled={closing} ariaBusy={closing}>
                                    {closing ? "Saving…" : "Close"}
                                </UiBtn>
                                <span className="ml-auto text-xs text-slate-500 self-center">v{version}</span>
                                <div className="flex items-center gap-1 text-[11px] text-slate-500">
                                    <button
                                        className="px-1.5 py-0.5 border rounded hover:bg-neutral-50 active:scale-[.99] focus:outline-none focus:ring-2 focus:ring-neutral-300"
                                        onClick={() => setUiScale((s) => Math.max(0.5, +(s - 0.05).toFixed(2)))}
                                        disabled={closing}
                                    >
                                        -
                                    </button>
                                    <span className="w-10 text-center">{Math.round(uiScale * 100)}%</span>
                                    <button
                                        className="px-1.5 py-0.5 border rounded hover:bg-neutral-50 active:scale-[.99] focus:outline-none focus:ring-2 focus:ring-neutral-300"
                                        onClick={() => setUiScale((s) => Math.min(1.25, +(s + 0.05).toFixed(2)))}
                                        disabled={closing}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Preview control */}
                        <div className="mb-3">
                            <div className="text-[11px] font-semibold text-neutral-500 mb-1">Preview control</div>
                            <button
                                onClick={applyDraftToPreview}
                                disabled={closing || !dirty}
                                aria-busy={applyingPreview}
                                className={`rounded px-3 py-1 text-sm w-full transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-neutral-300 active:scale-[.99] ${dirty ? "bg-emerald-600 text-white hover:brightness-95" : "bg-emerald-100 text-emerald-700"
                                    }`}
                                title="Apply draft to preview"
                            >
                                {applyingPreview ? "Updating…" : dirty ? "Update Preview" : "Preview is up to date"}
                            </button>
                        </div>

                        {/* Code editor */}
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
                            <div className="text-xs text-slate-600">Use Preview to edit directly or Code to edit markup. Apply with “Update Preview”, then Save.</div>
                        )}
                    </aside>

                    {/* Right: Canvas */}
                    <section
                        className="relative bg-slate-50 rounded-lg border overflow-hidden flex flex-col"
                        onPointerDown={(e) => {
                            if (!(e.target as HTMLElement).closest("iframe")) tryClearIframeSelection();
                        }}
                    >
                        {sourceImage && mode !== "screenshot" && (
                            <img src={sourceImage} alt="reference" className="absolute right-3 top-3 h-28 w-auto rounded border shadow pointer-events-none" />
                        )}

                        {(mode === "preview" || mode === "code") && (
                            <div className="flex-1 overflow-auto p-6">
                                <div className="mx-auto bg-white border rounded-lg shadow-sm" style={{ width: devicePx, minWidth: 320 }}>
                                    <iframe
                                        key={iframeKey}
                                        ref={iframeRef}
                                        className="w-full h-[80vh] border-0 rounded"
                                        title="KlonerPreview"
                                        sandbox="allow-same-origin"
                                        srcDoc={renderHtml || "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"}
                                        onLoad={() => {
                                            const doc = iframeRef.current?.contentDocument;
                                            if (!doc) return;
                                            // purge persisted overlays from saved HTML (defensive)
                                            doc.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());
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
                                <div className="mx-auto" style={{ width: devicePx, minWidth: 320 }}>
                                    {sourceImage ? (
                                        <img src={sourceImage} alt="Reference" className="w-full h-auto rounded border bg-white" />
                                    ) : (
                                        <div className="h-[60vh] grid place-items-center text-slate-500 text-sm">No reference screenshot</div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Full-canvas saving overlay while closing */}
                        {closing && (
                            <div className="absolute inset-0 bg-white/80 grid place-items-center">
                                <div className="flex items-center gap-3 rounded border px-3 py-2 bg-white text-sm text-neutral-800">
                                    <Spinner /> Saving & closing…
                                </div>
                            </div>
                        )}
                    </section>
                </div>

                {/* local spinner keyframes */}
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
    variant?: "tab" | "outline" | "filled";
    disabled?: boolean;
    ariaBusy?: boolean;
}) {
    // unified interactive + feedback styling
    const base =
        "inline-flex items-center justify-center gap-2 transition active:scale-[.99] focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-60 disabled:cursor-not-allowed";
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
                className={`${base} rounded px-3 py-1 text-sm text-white hover:brightness-95`}
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
                className={`${base} rounded px-3 py-1 text-sm border hover:bg-neutral-50`}
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
            className={`${base} px-2 py-1 text-xs rounded border ${pressed ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-neutral-50"
                }`}
        >
            {withBusy}
        </button>
    );
}

/* ------------------------ in-iframe edit layer ------------------------ */
function injectEditableOverlay(doc: Document, onChange: (updatedHtml: string) => void) {
    // purge any persisted toolbars defensively
    doc.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());

    const style = doc.createElement("style");
    style.textContent = `
:root { --amber-50:#FFFBEB; --amber-200:#FDE68A; --amber-700:#B45309; --rose-50:#FFF1F2; --rose-200:#FECDD3; --rose-700:#BE123C; --slate-700:#334155; --slate-300:#cbd5e1; }
[data-kloner-sel]{ outline:2px dashed #10b981 !important; outline-offset:2px !important; }
.kloner-toolbar{ position:fixed; z-index:2147483647; display:none; gap:8px; padding:6px 8px; background:#111827; color:#fff; border-radius:10px; font:12px/1.2 system-ui,-apple-system,Segoe UI,Roboto; box-shadow:0 10px 30px rgba(0,0,0,.25) }
.kbtn{ display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:8px; border:1px solid transparent; cursor:pointer; font-weight:600; }
.kbtn-close{ background:#0f172a; color:#fff; border-color:#0f172a; }
.kbtn-edit{ background:var(--amber-50); color:var(--amber-700); border-color:var(--amber-200); }
.kbtn-del{  background:var(--rose-50);  color:var(--rose-700);  border-color:var(--rose-200); }
.kbtn-undo{ background:#e2e8f0; color:#111827; border-color:var(--slate-300); }
.kbtn-redo{ background:#e2e8f0; color:#111827; border-color:var(--slate-300); }
`;
    doc.head.appendChild(style);

    const texty = new Set(["P", "SPAN", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "SMALL", "STRONG", "EM", "LABEL", "BUTTON", "A", "DIV"]);
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
<button class="kbtn kbtn-close" data-act="close">close</button>
<button class="kbtn kbtn-edit" data-act="dup">✏️ Duplicate</button>
<button class="kbtn kbtn-del"  data-act="del">🗑️ Delete</button>
<button class="kbtn kbtn-undo" data-act="undo">↩ Undo</button>
<button class="kbtn kbtn-redo" data-act="redo">↪ Redo</button>
`;
    doc.body.appendChild(toolbar);

    let selected: HTMLElement | null = null;

    function serializeClean(): string {
        const docClone = doc.documentElement.cloneNode(true) as HTMLElement;
        const body = (docClone as HTMLHtmlElement).querySelector("body")!;
        body.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());
        body.querySelectorAll("[data-kloner-sel]").forEach((n) => (n as HTMLElement).removeAttribute("data-kloner-sel"));
        body.querySelectorAll("[contenteditable]").forEach((n) => (n as HTMLElement).removeAttribute("contenteditable"));
        return "<!doctype html>\n" + (docClone as any).outerHTML;
    }

    // history (clean)
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
        const u = toolbar.querySelector('[data-act="undo"]') as HTMLButtonElement;
        const r = toolbar.querySelector('[data-act="redo"]') as HTMLButtonElement;
        if (u) u.disabled = idx <= 0;
        if (r) r.disabled = idx >= hist.length - 1;
    }
    saveHistory();

    function placeToolbar(target: HTMLElement) {
        const r = target.getBoundingClientRect();
        const x = Math.min(Math.max(8, r.left), doc.defaultView!.innerWidth - 260);
        const y = Math.max(8, r.top - 44);
        toolbar.style.left = `${x}px`;
        toolbar.style.top = `${y}px`;
        toolbar.style.display = "flex";
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
    }

    (doc.defaultView as any).__klonerApi = {
        clear() {
            select(null);
            (doc.activeElement as HTMLElement | null)?.blur?.();
        },
    };

    doc.addEventListener(
        "click",
        (e) => {
            const t = e.target as HTMLElement;
            if (toolbar.contains(t)) return;
            const block = t.closest("section, article, header, footer, main, div, li, p, h1, h2, h3, h4, h5") as HTMLElement | null;
            if (block) select(block);
            else select(null);
        },
        true
    );

    toolbar.addEventListener("click", (e) => {
        const btn = e.target as HTMLElement;
        const act = btn.getAttribute("data-act");
        if (act === "close") {
            (doc.defaultView as any).__klonerApi?.clear();
            return;
        }
        if (act === "undo") {
            undo();
            return;
        }
        if (act === "redo") {
            redo();
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
        } else if (act === "dup") {
            const clone = selected.cloneNode(true) as HTMLElement;
            selected.insertAdjacentElement("afterend", clone);
            markEditable(clone);
            select(clone);
            saveHistory();
            notify();
        }
    });

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
            if (!active?.isContentEditable && active?.tagName !== "INPUT" && active?.tagName !== "TEXTAREA") {
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
    mo.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true });
    doc.addEventListener("input", notify, true);

    updateUndoRedoState();
}
