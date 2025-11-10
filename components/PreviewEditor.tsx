// src/components/PreviewEditor.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Device = "desktop" | "tablet" | "mobile";
type ViewMode = "code" | "preview" | "screenshot";

type Props = {
    initialHtml: string;
    sourceImage?: string;
    onClose: () => void;
    onExport: (html: string, name?: string) => Promise<void>;
    draftId?: string;
    saveDraft?: (payload: {
        draftId?: string;
        html: string;
        meta: { nameHint?: string; device: Device; mode: ViewMode };
        version: number;
    }) => Promise<void>;
    onLiveHtml?: (html: string) => void; // updates card previews in parent immediately
};

const ACCENT = "#f55f2a";

/** sanitize: strip scripts for safety inside editable preview */
function stripScripts(html: string) {
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
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
    // Single source of truth for the document
    const [htmlCode, setHtmlCode] = useState<string>(stripScripts(initialHtml || ""));
    const [nameHint, setNameHint] = useState<string>("");
    const [version, setVersion] = useState<number>(1);

    const [mode, setMode] = useState<ViewMode>("code"); // Code | Preview | Screenshot
    const [device, setDevice] = useState<Device>("desktop");

    const iframeRef = useRef<HTMLIFrameElement>(null);

    // keep preview sized correctly
    const devicePx = device === "desktop" ? 1440 : device === "tablet" ? 768 : 390;

    // html used for rendering (scripts stripped for safety)
    const renderHtml = useMemo(() => stripScripts(htmlCode), [htmlCode]);

    // write into iframe on changes (Code or Preview)
    useEffect(() => {
        if (!iframeRef.current) return;
        if (mode === "screenshot") return;
        const doc = iframeRef.current.contentDocument;
        if (!doc) return;
        doc.open();
        doc.write(renderHtml || "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>");
        doc.close();

        if (mode === "preview") {
            injectEditableOverlay(doc, (updated) => {
                setHtmlCode(updated);
                onLiveHtml?.(updated);
            });
        }
    }, [renderHtml, mode]);

    // push live HTML upward whenever it changes
    useEffect(() => {
        onLiveHtml?.(renderHtml);
    }, [renderHtml, onLiveHtml]);

    // Save and Export actions
    async function doSave() {
        if (!saveDraft) return;
        await saveDraft({
            draftId,
            html: renderHtml,
            meta: { nameHint: nameHint || undefined, device, mode },
            version: version + 1,
        });
        setVersion((v) => v + 1);
    }
    async function doExport() {
        await onExport(renderHtml.trim(), nameHint || undefined);
    }

    return (
        <div className="fixed inset-0 z-[9999] bg-black/50">
            <div className="absolute inset-4 bg-white rounded-xl shadow-xl grid grid-cols-[320px,1fr] gap-4 p-4">
                {/* Left rail */}
                <aside className="flex flex-col min-w-0">
                    <input
                        className="border rounded px-2 py-1 text-sm w-full mb-3"
                        placeholder="Optional export name"
                        value={nameHint}
                        onChange={(e) => setNameHint(e.target.value)}
                    />

                    {/* Tabs */}
                    <div className="flex items-center gap-2 mb-3">
                        <div className="inline-flex rounded border overflow-hidden">
                            <button
                                className={`px-2 py-1 text-xs ${mode === "code" ? "bg-slate-900 text-white" : ""}`}
                                onClick={() => setMode("code")}
                            >
                                Code
                            </button>
                            <button
                                className={`px-2 py-1 text-xs ${mode === "preview" ? "bg-slate-900 text-white" : ""}`}
                                onClick={() => setMode("preview")}
                            >
                                Preview (editable)
                            </button>
                            <button
                                className={`px-2 py-1 text-xs ${mode === "screenshot" ? "bg-slate-900 text-white" : ""}`}
                                onClick={() => setMode("screenshot")}
                            >
                                Screenshot
                            </button>
                        </div>

                        {/* Device */}
                        <div className="inline-flex rounded border overflow-hidden ml-auto">
                            <button
                                className={`px-2 py-1 text-xs ${device === "desktop" ? "bg-slate-900 text-white" : ""}`}
                                onClick={() => setDevice("desktop")}
                            >
                                Desktop
                            </button>
                            <button
                                className={`px-2 py-1 text-xs ${device === "tablet" ? "bg-slate-900 text-white" : ""}`}
                                onClick={() => setDevice("tablet")}
                            >
                                Tablet
                            </button>
                            <button
                                className={`px-2 py-1 text-xs ${device === "mobile" ? "bg-slate-900 text-white" : ""}`}
                                onClick={() => setDevice("mobile")}
                            >
                                Mobile
                            </button>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mb-3">
                        <button
                            className="rounded px-3 py-1 text-sm border"
                            onClick={doSave}
                            title="Save Draft"
                        >
                            Save Draft
                        </button>
                        <button
                            className="rounded px-3 py-1 text-sm text-white"
                            style={{ backgroundColor: ACCENT }}
                            onClick={doExport}
                            title="Export to Vercel"
                        >
                            Export to Vercel
                        </button>
                        <button className="rounded px-3 py-1 text-sm border" onClick={onClose}>
                            Close
                        </button>
                        <span className="ml-auto text-xs text-slate-500">v{version}</span>
                    </div>

                    {/* Code editor */}
                    {mode === "code" && (
                        <textarea
                            className="h-full w-full border rounded p-2 font-mono text-xs leading-5"
                            value={htmlCode}
                            onChange={(e) => setHtmlCode(e.target.value)}
                            spellCheck={false}
                        />
                    )}

                    {/* Info for screenshot tab */}
                    {mode === "screenshot" && (
                        <div className="text-xs text-slate-600">
                            Reference screenshot is shown on the right. Use Preview to edit directly or Code to edit markup.
                        </div>
                    )}
                </aside>

                {/* Right canvas */}
                <section className="relative bg-slate-50 rounded-lg border overflow-hidden flex flex-col">
                    {sourceImage && mode !== "screenshot" && (
                        <img
                            src={sourceImage}
                            alt="reference"
                            className="absolute right-3 top-3 h-28 w-auto rounded border shadow"
                        />
                    )}

                    {/* Live preview (editable) + Code preview share the same iframe */}
                    {(mode === "preview" || mode === "code") && (
                        <div className="flex-1 overflow-auto p-6">
                            <div className="mx-auto bg-white border rounded-lg shadow-sm" style={{ width: devicePx }}>
                                <iframe
                                    ref={iframeRef}
                                    className="w-full h-[80vh] border-0 rounded"
                                    title="KlonerPreview"
                                    sandbox="allow-same-origin"
                                />
                            </div>
                        </div>
                    )}

                    {/* Screenshot viewer */}
                    {mode === "screenshot" && (
                        <div className="flex-1 overflow-auto p-6">
                            <div className="mx-auto" style={{ width: devicePx }}>
                                {sourceImage ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={sourceImage} alt="Reference" className="w-full h-auto rounded border bg-white" />
                                ) : (
                                    <div className="h-[60vh] grid place-items-center text-slate-500 text-sm">
                                        No reference screenshot
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

/**
 * Injects a lightweight edit layer into the iframe document:
 * - contentEditable on textual elements
 * - hover outline
 * - click to select, toolbar to Delete / Duplicate / Wrap link
 * - posts serialized HTML to parent on any change
 */
function injectEditableOverlay(
    doc: Document,
    onChange: (updatedHtml: string) => void
) {
    // idempotent
    if ((doc as any).__klonerInjected) return;
    (doc as any).__klonerInjected = true;

    const style = doc.createElement("style");
    style.textContent = `
  *{caret-color:auto}
  [data-kloner-sel]{outline: 2px dashed #4f46e5 !important; outline-offset: 2px !important;}
  .kloner-toolbar{position:fixed; z-index:2147483647; display:none; gap:6px; padding:6px 8px; background:#111827; color:#fff; border-radius:8px; font:12px/1 system-ui, -apple-system, Segoe UI, Roboto; box-shadow:0 10px 30px rgba(0,0,0,.25)}
  .kloner-btn{background:#1f2937; border:1px solid #374151; padding:4px 8px; border-radius:6px; cursor:pointer}
  .kloner-btn:hover{background:#374151}
  `;
    doc.head.appendChild(style);

    // mark texty elements editable
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    const textyTags = new Set(["P", "SPAN", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BUTTON", "A", "SMALL", "STRONG", "EM", "LABEL", "DIV"]);
    while (walker.nextNode()) {
        const el = walker.currentNode as HTMLElement;
        if (textyTags.has(el.tagName)) {
            el.contentEditable = "true";
        }
    }

    const toolbar = doc.createElement("div");
    toolbar.className = "kloner-toolbar";
    toolbar.innerHTML = `
    <button class="kloner-btn" data-act="del">Delete</button>
    <button class="kloner-btn" data-act="dup">Duplicate</button>
  `;
    doc.body.appendChild(toolbar);

    let selected: HTMLElement | null = null;

    function placeToolbar(target: HTMLElement) {
        const rect = target.getBoundingClientRect();
        toolbar.style.left = Math.max(8, rect.left + rect.width - 150) + "px";
        toolbar.style.top = Math.max(8, rect.top - 36) + "px";
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

    // click select
    doc.addEventListener(
        "click",
        (e) => {
            const t = e.target as HTMLElement;
            if (toolbar.contains(t)) return;
            select(t.closest("section, article, header, footer, main, div, li, p, h1, h2, h3, h4, h5") as HTMLElement);
            e.stopPropagation();
        },
        true
    );

    // toolbar actions
    toolbar.addEventListener("click", (e) => {
        const btn = e.target as HTMLElement;
        const act = btn.getAttribute("data-act");
        if (!selected) return;
        if (act === "del") {
            const parent = selected.parentElement;
            selected.remove();
            select(null);
            if (parent) parent.focus();
            notify();
        } else if (act === "dup") {
            const clone = selected.cloneNode(true) as HTMLElement;
            selected.insertAdjacentElement("afterend", clone);
            select(clone);
            notify();
        }
    });

    // reflect edits
    const notify = () => {
        // serialize full document (keep <!doctype>)
        const html = "<!doctype html>\n" + doc.documentElement.outerHTML;
        onChange(html);
    };

    // mutations and input => notify
    const mo = new MutationObserver(() => notify());
    mo.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true });

    doc.addEventListener("input", notify, true);

    // keyboard delete
    doc.addEventListener("keydown", (e) => {
        if ((e.key === "Backspace" || e.key === "Delete") && selected && !isTypingIn(selected, e)) {
            e.preventDefault();
            const parent = selected.parentElement;
            selected.remove();
            select(null);
            if (parent) parent.focus();
            notify();
        }
    });

    function isTypingIn(el: HTMLElement, ev: KeyboardEvent) {
        const t = ev.target as HTMLElement;
        return t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA");
    }
}
