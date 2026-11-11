"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Palette, X, Check, RotateCcw } from "lucide-react";
import { ensureSessionAndCsrf } from "@/lib/auth-client";
import {
    EDITOR_COLOR_PRESETS,
    paletteTokens,
    type EditorPalette,
    type PalettePreviewChange,
} from "@/src/lib/editorColorPresets";

type PopupPosition = { top: number; right: number };

export default function EditorColorSchemes({ appId, ready }: { appId: string; ready: boolean }) {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<EditorPalette | null>(null);
    const [changes, setChanges] = useState<PalettePreviewChange[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [agentBusy, setAgentBusy] = useState(false);
    const [position, setPosition] = useState<PopupPosition>({ top: 16, right: 16 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const request = useRef("");
    const acknowledged = useRef("");

    const updatePosition = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPosition({
            top: Math.max(8, Math.min(rect.bottom + 12, window.innerHeight - 180)),
            right: Math.max(8, window.innerWidth - rect.right),
        });
    };

    const send = (data: Record<string, unknown>) => {
        document.querySelectorAll("iframe").forEach((frame) => {
            if (!frame.getBoundingClientRect().width || !frame.getBoundingClientRect().height) return;
            const post = () => frame.contentWindow?.postMessage(data, "*");
            try {
                const doc = frame.contentDocument;
                if (doc && !doc.querySelector("[data-kloner-palette-bridge]")) {
                    const script = doc.createElement("script");
                    script.src = `${location.origin}/proxy/editor-color-preview.js`;
                    script.dataset.klonerPaletteBridge = "1";
                    script.onload = post;
                    doc.head.appendChild(script);
                } else {
                    post();
                }
            } catch {
                post();
            }
        });
    };

    useEffect(() => {
        const busy = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail?.appId === appId) setAgentBusy(Boolean(detail.busy));
        };
        const handler = (event: MessageEvent) => {
            if (
                event.data?.type === "kloner:palette-result" &&
                event.data.requestId === request.current &&
                Array.from(document.querySelectorAll("iframe")).some((frame) => frame.contentWindow === event.source)
            ) {
                acknowledged.current = request.current;
                setChanges(event.data.changes || []);
                setError(null);
            }
        };
        window.addEventListener("message", handler);
        window.addEventListener("kloner:agent-busy", busy);
        return () => {
            window.removeEventListener("message", handler);
            window.removeEventListener("kloner:agent-busy", busy);
        };
    }, [appId]);

    useEffect(() => {
        const onBuilderTourStep = (event: Event) => {
            const detail = (event as CustomEvent<{ open?: boolean }>).detail;
            const desktop = !window.matchMedia("(max-width: 767px)").matches;
            setOpen(Boolean(detail?.open && desktop));
        };
        window.addEventListener("kloner:builder-tour-color-schemes", onBuilderTourStep);
        return () => window.removeEventListener("kloner:builder-tour-color-schemes", onBuilderTourStep);
    }, []);

    useEffect(() => {
        if (!open) return;
        updatePosition();
        const reposition = () => updatePosition();
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!popupRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", reposition, true);
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    const reset = () => {
        request.current = "";
        acknowledged.current = "";
        setSelected(null);
        setChanges([]);
        setError(null);
        send({ type: "kloner:palette-reset" });
    };

    useEffect(() => () => {
        document.querySelectorAll("iframe").forEach((frame) =>
            frame.contentWindow?.postMessage({ type: "kloner:palette-reset" }, "*"),
        );
    }, [appId]);

    const preview = (palette: EditorPalette) => {
        const id = crypto.randomUUID();
        request.current = id;
        acknowledged.current = "";
        setSelected(palette);
        setChanges([]);
        setError(null);
        send({ type: "kloner:palette-preview", requestId: id, tokens: paletteTokens(palette) });
        window.setTimeout(() => {
            if (request.current === id && acknowledged.current !== id) {
                setError("Your preview has not connected yet. Wait for it to load, then try again.");
            }
        }, 8000);
    };

    const save = async () => {
        if (!selected || !changes.length || saving || agentBusy) return;
        setSaving(true);
        setError(null);
        try {
            await fetch(`/api/app-builder/${appId}/scope`, { credentials: "include" });
            const csrf = await ensureSessionAndCsrf();
            const response = await fetch(`/api/app-builder/${appId}/palette-change`, {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json", "x-csrf": csrf || "" },
                body: JSON.stringify({ presetId: selected.id, changes }),
            });
            const result = await response.json();
            if (!response.ok) throw Error(result.error || "The color scheme could not be saved.");
            window.dispatchEvent(new CustomEvent("kloner:palette-apply", {
                detail: { appId, paletteChangeId: result.id, summary: result.summary },
            }));
            setOpen(false);
        } catch (error) {
            setError(error instanceof Error ? error.message : "The color scheme could not be saved.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="relative shrink-0">
            <button
                ref={triggerRef}
                type="button"
                data-tour-color-schemes
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label="Preview color schemes"
                title="Preview color schemes"
                onClick={() => setOpen((current) => !current)}
                className="inline-flex items-center gap-1.5 rounded-full border p-2 text-xs font-medium hover:opacity-80"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)", background: "var(--surface)" }}
            >
                <Palette className="h-4 w-4" />
            </button>
            {open && typeof document !== "undefined" ? createPortal(
                <div
                    ref={popupRef}
                    role="dialog"
                    aria-label="Color schemes"
                    className="fixed z-[2147483647] max-h-[calc(100dvh-1rem)] w-[min(340px,85vw)] overflow-y-auto rounded-2xl border p-4 shadow-2xl"
                    style={{
                        top: position.top,
                        right: position.right,
                        background: "var(--surface)",
                        color: "var(--text-primary)",
                        borderColor: "var(--border-subtle)",
                    }}
                >
                    <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold">Find your color scheme</h3>
                        <button type="button" aria-label="Close color schemes" onClick={() => setOpen(false)}>
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                        Try a look instantly. Save it when it feels right.
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                        {EDITOR_COLOR_PRESETS.map((palette) => (
                            <button
                                key={palette.id}
                                type="button"
                                disabled={!ready || saving}
                                aria-pressed={selected?.id === palette.id}
                                onClick={() => preview(palette)}
                                className="rounded-xl border p-2 text-left transition hover:-translate-y-0.5 disabled:opacity-50"
                                style={{ borderColor: selected?.id === palette.id ? "#FF8D21" : "var(--border-subtle)" }}
                            >
                                <span className="flex h-6 overflow-hidden rounded-md">
                                    {[palette.background, palette.surface, palette.primary, palette.accent].map((color, index) => (
                                        <span key={index} className="flex-1" style={{ background: color }} />
                                    ))}
                                </span>
                                <span className="mt-1.5 block text-xs">{palette.name}</span>
                            </button>
                        ))}
                    </div>
                    {!ready ? <p className="mt-3 text-sm">Your preview will be ready shortly.</p> : null}
                    {selected ? (
                        <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                            {changes.length ? "Preview only — your saved project has not changed." : "Connecting to your preview…"}
                        </p>
                    ) : null}
                    {error ? <p role="alert" className="mt-2 text-sm text-red-500">{error}</p> : null}
                    <div className="mt-4 flex gap-2">
                        <button onClick={reset} disabled={!selected || saving} className="flex items-center gap-1 rounded-full border px-3 py-2 text-sm disabled:opacity-40">
                            <RotateCcw className="h-3 w-3" />Reset
                        </button>
                        <button onClick={() => void save()} disabled={!changes.length || saving || agentBusy} className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                            <Check className="h-4 w-4" />{saving ? "Saving…" : agentBusy ? "Agent working…" : "Save scheme"}
                        </button>
                    </div>
                </div>,
                document.body,
            ) : null}
        </div>
    );
}
