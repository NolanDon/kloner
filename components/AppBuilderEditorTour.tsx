"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TourStep = {
    target: string;
    title: string;
    content: string;
};

export const TOUR_KEY = "kloner_builder_tour_done";

function getTourStorage(): Storage | null {
    if (typeof window === "undefined") return null;
    try {
        return process.env.NODE_ENV !== "production" ? window.sessionStorage : window.localStorage;
    } catch {
        return null;
    }
}

function hasSeenTour(): boolean {
    if (process.env.NODE_ENV !== "production") return false;
    return getTourStorage()?.getItem(TOUR_KEY) === "1";
}

function markTourSeen(): void {
    if (process.env.NODE_ENV !== "production") return;
    try {
        getTourStorage()?.setItem(TOUR_KEY, "1");
    } catch {
        // ignore storage failures
    }
}

const desktopSteps: TourStep[] = [
    {
        target: "[data-tour-builder-preview]",
        title: "Live preview",
        content: "Your preview, when ready, will load here.",
    },
    {
        target: "[data-tour-ui-scale]",
        title: "UI scale",
        content: "Use these controls to zoom the editor UI in or out.",
    },
    {
        target: "[data-tour-refresh]",
        title: "Refresh",
        content: "Refresh reconnects to the current machine without a full restart.",
    },
    {
        target: "[data-tour-rebuild]",
        title: "Rebuild",
        content: "Rebuild starts a fresh machine if preview state gets stuck.",
    },
    {
        target: "[data-tour-chat-tab]",
        title: "Chat",
        content: "Use Chat to request layout, style, and feature changes.",
    },
    {
        target: "[data-tour-chat-panel]",
        title: "Your AI assistant",
        content: "Type your request here — ask for layout tweaks, copy edits, or new features.",
    },
    {
        target: "[data-tour-images-tab]",
        title: "Images",
        content: "Use Images to place and manage visual assets quickly.",
    },
    {
        target: "[data-tour-custom-tab]",
        title: "Custom",
        content: "Use Custom for quick visual tweaks and short text rewrites.",
    },
    {
        target: "[data-tour-deploy]",
        title: "Deploy",
        content: "When you are ready, deploy your latest changes to a live site.",
    },
];

const mobileSteps: TourStep[] = [
    {
        target: "[data-tour-builder-preview]",
        title: "Preview area",
        content: "Your live preview will appear here as changes are generated.",
    },
    {
        target: "[data-tour-mobile-prompt]",
        title: "Chat",
        content: "Switch to Prompt to chat with the AI and request updates.",
    },
    {
        target: "[data-tour-mobile-controls]",
        title: "Controls",
        content: "Open Controls for quick actions like refresh, rebuild, and other recovery options.",
    },
    {
        target: "[data-tour-deploy]",
        title: "Deploy",
        content: "When you are ready, deploy your latest changes to a live site.",
    },
];

function isDevBuild() {
    return process.env.NODE_ENV !== "production";
}

function isChatIntroTarget(target: string | undefined) {
    return target === "[data-tour-chat-panel]" || target === "[data-tour-mobile-prompt]";
}

export function AppBuilderEditorTour({
    startToken,
    enabled = true,
    onEnd,
}: {
    startToken: number;
    enabled?: boolean;
    onEnd?: () => void;
}) {
    const [running, setRunning] = useState(false);
    const [index, setIndex] = useState(0);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [mask, setMask] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const [isMobile, setIsMobile] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const highlightRef = useRef<HTMLDivElement | null>(null);
    const isDev = useMemo(() => isDevBuild(), []);
    const steps = isMobile ? mobileSteps : desktopSteps;

    const broadcastChatHighlightForStep = useCallback((stepIndex: number) => {
        if (typeof window === "undefined") return;
        if (!isChatIntroTarget(steps[stepIndex]?.target)) return;
        window.postMessage({ type: "kloner:builder-tour-chat-highlighted" }, "*");
    }, [steps]);

    const clearHighlight = () => {
        if (highlightRef.current) {
            highlightRef.current.style.display = "none";
        }
        setMask(null);
    };

    const updatePosition = useCallback(() => {
        if (!running) return;
        const step = steps[index];
        if (!step || typeof window === "undefined") return;
        const isMobilePreviewStep = isMobile && index === 0;

        const target = document.querySelector(step.target) as HTMLElement | null;
        if (!target) {
            clearHighlight();
            setPos({ top: window.innerHeight / 2 - 90, left: window.innerWidth / 2 - 180 });
            return;
        }

        const rect = target.getBoundingClientRect();
        const popup = containerRef.current?.querySelector('[role="dialog"]') as HTMLElement | null;
        const popupW = popup?.getBoundingClientRect().width || 340;
        const popupH = popup?.getBoundingClientRect().height || 180;

        const preferAbove = rect.top > 180;
        const rawTop = isMobilePreviewStep
            ? rect.bottom - popupH - 20
            : preferAbove
                ? rect.top - popupH - 12
                : rect.bottom + 12;
        const rawLeft = isMobilePreviewStep ? rect.left - 18 : rect.left;
        const top = Math.min(Math.max(rawTop, 12), window.innerHeight - popupH - 12);
        const left = Math.min(Math.max(rawLeft, 12), window.innerWidth - popupW - 12);
        setPos({ top, left });

        if (highlightRef.current) {
            const pad = 8;
            const leftShift = isMobilePreviewStep ? 18 : pad;
            const box = highlightRef.current;
            box.style.display = "block";
            box.style.top = `${Math.max(rect.top - pad, 8)}px`;
            box.style.left = `${Math.max(rect.left - leftShift, 8)}px`;
            box.style.width = `${Math.max(rect.width + pad * 2, 36)}px`;
            box.style.height = `${Math.max(rect.height + pad * 2, 24)}px`;
            box.style.borderRadius = "10px";
        }

        const pad = 8;
        setMask({
            left: Math.max(rect.left - (isMobilePreviewStep ? 18 : pad), 0),
            top: Math.max(rect.top - pad, 0),
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
        });
    }, [index, isMobile, running, steps]);

    const finish = () => {
        setRunning(false);
        setIndex(0);
        clearHighlight();
        markTourSeen();
        onEnd?.();
    };

    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(max-width: 767px)");
        const update = () => setIsMobile(mq.matches);
        update();
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        if (!enabled) {
            setRunning(false);
            setIndex(0);
            return;
        }

        if (typeof window === "undefined") return;
        if (startToken <= 0) return;
        if (hasSeenTour()) return;

        markTourSeen();
        setIndex(0);
        setRunning(true);
    }, [enabled, isDev, startToken]);

    useEffect(() => {
        if (!running) return;

        broadcastChatHighlightForStep(index);

        updatePosition();
        const retries = [100, 260, 520].map((ms) => window.setTimeout(updatePosition, ms));
        const onResize = () => updatePosition();
        const onScroll = () => updatePosition();

        window.addEventListener("resize", onResize);
        window.addEventListener("scroll", onScroll, true);

        return () => {
            retries.forEach((id) => window.clearTimeout(id));
            window.removeEventListener("resize", onResize);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [broadcastChatHighlightForStep, index, running, updatePosition]);

    useEffect(() => {
        if (running || !enabled) return;
        clearHighlight();
    }, [enabled, running]);

    if (!running || !steps[index]) return null;

    return (
        <div ref={containerRef} className="pointer-events-none fixed inset-0 z-[999999]">
            {mask ? (
                <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
                    <defs>
                        <mask id="kloner-builder-tour-mask">
                            <rect x="0" y="0" width="100%" height="100%" fill="white" />
                            <rect
                                x={mask.left}
                                y={mask.top}
                                width={mask.width}
                                height={mask.height}
                                rx="10"
                                ry="10"
                                fill="black"
                            />
                        </mask>
                    </defs>
                    <rect x="0" y="0" width="100%" height="100%" fill="rgba(17,24,39,0.38)" mask="url(#kloner-builder-tour-mask)" />
                </svg>
            ) : null}

            <div
                ref={highlightRef}
                className="absolute hidden border-2 border-[#FF8D21] shadow-[0_14px_30px_rgba(255,141,33,0.28)]"
                aria-hidden="true"
            />

            {pos ? (
                <div
                    role="dialog"
                    className="pointer-events-auto absolute w-[min(92vw,360px)] rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-2xl"
                    style={{ top: pos.top, left: pos.left }}
                >
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Builder tour</div>
                    <div className="mt-1 text-base font-semibold">{steps[index].title}</div>
                    <p className="mt-2 text-sm text-neutral-700">{steps[index].content}</p>

                    <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="text-xs text-black/50 mr-2">{index + 1}/{steps.length}</div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={finish}
                                className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                            >
                                Skip
                            </button>
                            {index > 0 ? (
                                <button
                                    type="button"
                                    onClick={() => setIndex((i) => Math.max(0, i - 1))}
                                    className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                                >
                                    Back
                                </button>
                            ) : null}
                            <button
                                type="button"
                                onClick={() => {
                                    if (index >= steps.length - 1) {
                                        finish();
                                        return;
                                    }
                                    const nextIndex = Math.min(steps.length - 1, index + 1);
                                    broadcastChatHighlightForStep(nextIndex);
                                    setIndex(nextIndex);
                                }}
                                className="px-4 py-2 rounded-xl text-sm font-semibold bg-accent text-white shadow-sm pointer-events-auto inline-flex items-center gap-2"
                            >
                                <span>{index >= steps.length - 1 ? "Done" : "Next"}</span>
                                {index > 0 ? (
                                    <kbd className="bg-black/5 text-xs px-2 py-0.5 rounded" aria-hidden>
                                        Enter
                                    </kbd>
                                ) : null}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
