// components/PreviewEditorTour.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { getFirestore, doc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/src/hooks/useAuth";

const steps = [
    {
        target: "#kloner-home",
        title: "Live preview",
        content: "This is your live editable preview. Feel free to drag it around.",
    },
    {
        target: "#kloner-page-switcher",
        title: "Page switcher",
        content: "Jump between pages like Home, Pricing, and About. Generate a new page using the plus button, simply describe your page and let AI do the work.",
    },
    {
        target: "#kloner-history",
        title: "History",
        content: "Made a mistake? Revert back by clicking previous versions in this history section.",
    },
    {
        target: "#kloner-style-sidebar",
        title: "Style & AI Edit",
        content: "Use AI Edit to rewrite, generate images, or refine copy and layout.",
    },
    {
        target: "#kloner-apply-changes",
        title: "Apply",
        content: "Apply your changes to update the live preview.",
    },
    {
        target: "#kloner-device-toggle",
        title: "Device views",
        content: "Switch between desktop, tablet, and mobile views. Ensure your design looks great on all devices.",
    },
    {
        target: "#kloner-selection-style",
        title: "Block styling",
        content: "Fine-tune typography, spacing, alignment, and colors for selected blocks.",
    },
    {
        target: "#kloner-meta-toggle",
        title: "Page metadata",
        content: "Control page-level SEO: titles, descriptions, and favicons.",
    },
    {
        target: "#kloner-ai-image-library",
        title: "AI images",
        content: "Store and reuse AI-generated images. Drag to insert into blocks.",
    },
    {
        target: "#kloner-actions-row",
        title: "Deploy",
        content: "Deploy your edits to a live website when ready.",
    },
];

const LOCAL_KEY = "kloner_preview_tour_done";

const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export function PreviewEditorTour() {
    const SKIP_LOCK = 2; // number of initial steps that cannot be skipped
    const [running, setRunning] = useState(false);
    const [index, setIndex] = useState(0);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const { user } = useAuth();
    const db = getFirestore();
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;

        if (!user) {
            const seenLocal = window.localStorage.getItem(LOCAL_KEY) === "1";
            if (!seenLocal) setRunning(true);
            return;
        }

        // if (isLocalhost) {
        //     setRunning(true);
        //     return;
        // }

        const seenLocal = window.localStorage.getItem(LOCAL_KEY) === "1";
        if (!seenLocal) setRunning(true);
    }, [user]);

    useEffect(() => {
        if (!running) return;
        updatePosition();

        const onScroll = () => updatePosition();
        const onResize = () => updatePosition();
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onResize);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running, index]);

    const updatePosition = () => {
        const step = steps[index];
        if (!step || typeof window === "undefined") {
            setPos(null);
            return;
        }

        // Try to find the target in the main document first
        let foundRect: DOMRect | null = null;

        const el = document.querySelector(step.target) as HTMLElement | null;
        if (el) {
            foundRect = el.getBoundingClientRect();
        } else {
            // Search inside same-origin iframes (if the preview renders inside an iframe)
            const iframes = Array.from(document.querySelectorAll("iframe"));
            for (const iframe of iframes) {
                try {
                    const doc = iframe.contentDocument;
                    if (!doc) continue;
                    const inner = doc.querySelector(step.target) as HTMLElement | null;
                    if (!inner) continue;
                    const innerRect = inner.getBoundingClientRect();
                    const frameRect = iframe.getBoundingClientRect();
                    // convert to viewport coordinates
                    foundRect = new DOMRect(
                        frameRect.left + innerRect.left,
                        frameRect.top + innerRect.top,
                        innerRect.width,
                        innerRect.height
                    );
                    break;
                } catch (e) {
                    // cross-origin iframe — ignore
                }
            }
        }

        if (!foundRect) {
            // center if no target
            setPos({ top: window.innerHeight / 2 - 80, left: window.innerWidth / 2 - 180 });
            removeHighlight();
            setOverlayMask(null);
            return;
        }

        const rect = foundRect;

        // prefer placing popover above the element if there's room
        const spaceAbove = rect.top;
        const preferAbove = spaceAbove > 160;
        const desiredTop = preferAbove ? rect.top - 140 : rect.bottom + 12;
        const desiredLeft = Math.min(Math.max(rect.left, 16), window.innerWidth - 360 - 16);

        // Attempt to measure the popover so we can clamp it inside the viewport
        const container = containerRef.current;
        let popupWidth = 340;
        let popupHeight = 160;
        if (container) {
            const popup = container.querySelector('[role="dialog"]') as HTMLElement | null;
            if (popup) {
                const pRect = popup.getBoundingClientRect();
                popupWidth = pRect.width || popupWidth;
                popupHeight = pRect.height || popupHeight;
            }
        }

        let clampedLeft = Math.min(Math.max(desiredLeft, 12), window.innerWidth - popupWidth - 12);
        const clampedTop = Math.min(Math.max(desiredTop, 12), window.innerHeight - popupHeight - 12);

        // If the target is on the far left, nudge the popover right a bit so the icon remains visible
        try {
            const leftEdgeThreshold = 160;
            if (rect.left < leftEdgeThreshold) {
                const nudge = Math.max(56, rect.width / 2 + 12);
                clampedLeft = Math.min(Math.max(rect.left + nudge, 12), window.innerWidth - popupWidth - 12);
            }
        } catch (e) {
            // ignore
        }

        setPos({ top: clampedTop, left: clampedLeft });
        showHighlightRect(rect);
        const padding = 8;
        setOverlayMask({
            left: Math.max(rect.left - padding, 0),
            top: Math.max(rect.top - padding, 0),
            width: rect.width + padding * 2,
            height: rect.height + padding * 2,
        });
    };

    const highlightBoxRef = useRef<HTMLDivElement | null>(null);
    const [overlayMask, setOverlayMask] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const maskIdRef = useRef<string>(`kloner-tour-mask-${Math.random().toString(36).slice(2)}`);

    const showHighlightRect = (rect: DOMRect) => {
        const box = highlightBoxRef.current;
        if (!box) return;
        const padding = 8;
        box.style.display = "block";
        box.style.top = `${Math.max(rect.top - padding, 8)}px`;
        box.style.left = `${Math.max(rect.left - padding, 8)}px`;
        box.style.width = `${Math.max(rect.width + padding * 2, 32)}px`;
        box.style.height = `${Math.max(rect.height + padding * 2, 24)}px`;
        box.style.borderRadius = "6px";
        box.style.boxShadow = "0 14px 32px rgba(0,0,0,0.22), 0 0 0 6px rgba(245,95,42,0.08)";
        box.style.zIndex = "999998";
    };

    const removeHighlight = () => {
        const box = highlightBoxRef.current;
        if (!box) return;
        box.style.display = "none";
        setOverlayMask(null);
    };

    useEffect(() => {
        return () => {
            removeHighlight();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const finish = async (persist = true) => {
        if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_KEY, "1");
        if (persist && !isLocalhost && user?.uid) {
            try {
                await updateDoc(doc(db, "kloner_users", user.uid), { hasSeenPreviewTour: true });
            } catch {
                // ignore
            }
        }
        setRunning(false);
        setIndex(0);
    };

    const next = () => {
        if (index >= steps.length - 1) return finish();
        setIndex((i) => i + 1);
    };

    const prev = () => setIndex((i) => Math.max(0, i - 1));

    if (!running) return null;

    // (Enter key behavior already works via native handling; no extra key listener needed)

    const step = steps[index];

    // overlayMask is now rectangular: { left, top, width, height }

    return (
        <div ref={containerRef} className="fixed inset-0 z-[999999] pointer-events-none">
            {/* overlay */}
            <div className="absolute inset-0 pointer-events-auto" onClick={() => finish(false)} style={{ zIndex: 999996 }}>
                {/* SVG mask to cut a rectangular hole so target is visible */}
                {overlayMask ? (
                    <svg className="absolute inset-0 w-full h-full" style={{ position: "absolute", inset: 0 }} aria-hidden>
                        <defs>
                            <mask id={maskIdRef.current} x="0" y="0" width="100%" height="100%">
                                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                                <rect
                                    x={overlayMask.left}
                                    y={overlayMask.top}
                                    width={overlayMask.width}
                                    height={overlayMask.height}
                                    fill="black"
                                    rx="6"
                                    ry="6"
                                />
                            </mask>
                        </defs>
                        <rect width="100%" height="100%" fill="rgba(0,0,0,0.44)" mask={`url(#${maskIdRef.current})`} />
                    </svg>
                ) : (
                    <div className="absolute inset-0 bg-black/44 backdrop-blur-sm" />
                )}
            </div>

            {/* highlight box (positioned over the target) */}
            <div
                ref={highlightBoxRef}
                style={{ display: "none", position: "fixed", pointerEvents: "none", transition: "all 220ms ease", zIndex: 999998 }}
            />

            {/* popover */}
            <div
                role="dialog"
                aria-modal="true"
                style={{
                    top: pos?.top ?? 120,
                    left: pos?.left ?? 40,
                    fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
                    zIndex: 999999,
                }}
                className="pointer-events-auto absolute w-[340px] max-w-[90vw] bg-white border border-black/5 rounded-2xl shadow-lg p-5 transition-transform duration-200 ease-out transform opacity-100"
            >
                <div className="flex items-start gap-3">
                    <div className="flex-1">
                        <h3 className="text-sm font-medium text-ink mb-1">{step.title}</h3>
                        <p className="text-sm text-black/75 leading-relaxed">{step.content}</p>
                    </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={prev}
                            disabled={index === 0}
                            className="px-3 py-1.5 rounded-md text-sm font-semibold border border-black/10 bg-white text-accent pointer-events-auto disabled:opacity-40"
                        >
                            Back
                        </button>
                        <button
                            onClick={() => {
                                if (index < SKIP_LOCK) return;
                                finish(true);
                            }}
                            disabled={index < SKIP_LOCK}
                            aria-disabled={index < SKIP_LOCK}
                            className="px-3 py-1.5 rounded-md text-sm font-semibold bg-white border border-black/10 text-black/70 pointer-events-auto disabled:opacity-40"
                        >
                            Skip
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="text-xs text-black/50 mr-2">{index + 1}/{steps.length}</div>
                        <button
                            onClick={next}
                            className="px-4 py-2 rounded-xl text-sm font-semibold bg-accent text-white shadow-sm pointer-events-auto inline-flex items-center gap-2"
                        >
                            <span>{index === steps.length - 1 ? "Done" : "Next"}</span>
                            {index > 0 && (
                                <kbd className="bg-black/5 text-xs px-2 py-0.5 rounded" aria-hidden>
                                    Enter
                                </kbd>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
