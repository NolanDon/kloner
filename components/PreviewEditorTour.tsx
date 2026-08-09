// components/PreviewEditorTour.tsx
"use client";

import { createPortal } from "react-dom";
import { useState, useEffect, useLayoutEffect, useRef, useCallback, type ReactNode } from "react";

const PREVIEW_TOUR_SEEN_KEY = "kloner_preview_editor_tour_seen";
const PREVIEW_TOUR_SUPPRESS_KEY = "kloner_preview_editor_tour_dont_show_again";

function readTourFlag(key: string): boolean {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

export function hasPreviewEditorTourSeen(): boolean {
    return readTourFlag(PREVIEW_TOUR_SEEN_KEY);
}

export function hasPreviewEditorTourDontShowAgain(): boolean {
    return readTourFlag(PREVIEW_TOUR_SUPPRESS_KEY);
}

function markPreviewEditorTourSeen(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(PREVIEW_TOUR_SEEN_KEY, "1");
    } catch {
        // ignore storage failures
    }
}

function markPreviewEditorTourDontShowAgain(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(PREVIEW_TOUR_SUPPRESS_KEY, "1");
    } catch {
        // ignore storage failures
    }
}

type TourStep = {
    target: string | null;
    title: string;
    content: ReactNode;
    action: string;
};

const mobileSteps: TourStep[] = [
    // {
    //     target: "#kloner-page-switcher",
    //     title: "Page switcher",
    //     content: "Jump between pages like Home, Pricing, and About. Generate a new page using the plus button, simply describe your page and let AI do the work.",
    //     action: "none"
    // },
        {
            target: "#kloner-page-switcher",
            title: "Page switcher",
            content: "Jump between pages like Home, Pricing, and About using the dropdown in the toolbar.",
            action: "none"
        },
        {
            target: "[data-tour-chat-tab]",
            title: "Chat with AI",
            content: "Use Chat to ask AI for visual tweaks, like adjusting spacing, typography, colors, section layout, and component styling without hunting through files.",
            action: "none"
        },
    {
        target: "#kloner-style-sidebar",
        title: "Style Panel",
        content: "Use the beautifully redesigned style panel to customize typography, colors, and layout. Fine-tune the visual appearance of your website.",
        action: "showStylePanel"
    },
    {
        target: "#kloner-apply-changes",
        title: "Save & Apply",
        content: "Your changes auto-save as you work. Click Apply to update the live preview.",
        action: "none"
    },
    {
        target: "#kloner-device-toggle",
        title: "Device views",
        content: "Use these tools to switch between modes, refine desktop, tablet, and mobile designs by swithing through various resolutions.",
        action: "none"
    },
    {
        target: "#kloner-home",
        title: "Live preview",
        content: "This is your live editable preview. Feel free to drag it around.",
        action: "none"
    },
    {
        target: "[data-tour-deploy]",
        title: "Deploy your website",
        content: "When you're ready, deploy your edits to a live website. This will export your current preview and trigger a deployment.",
        action: "none"
    },
];

const desktopSteps: TourStep[] = [
    {
        target: null,
        title: "Quick tour",
        content: (
            <>
                Fast tour, minimal suffering. When you&apos;re ready click below, then tap{" "}
                <kbd className="inline-flex items-center rounded-md border border-black/10 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-700 shadow-sm">
                    spacebar
                </kbd>{" "}
                on your keyboard to continue through.
            </>
        ),
        action: "none",
    },
    ...mobileSteps.slice(1),
];

type PreviewEditorTourProps = {
    startToken?: number;
    autoStart?: boolean;
    onComplete?: () => void;
    onDontShowAgain?: () => void;
    onEnd?: () => void;
};

function isDevBuild() {
    return process.env.NODE_ENV !== "production";
}

export function PreviewEditorTour({ startToken = 0, autoStart = true, onComplete, onDontShowAgain, onEnd }: PreviewEditorTourProps) {
    const [running, setRunning] = useState(false);
    const [index, setIndex] = useState(0);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [isDesktop, setIsDesktop] = useState(true);
    const [hasSeenTourBefore, setHasSeenTourBefore] = useState(() => hasPreviewEditorTourSeen());
    const containerRef = useRef<HTMLDivElement | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const scrollStateRef = useRef<{
        htmlOverflow: string;
        bodyOverflow: string;
        htmlOverscrollBehavior: string;
        bodyOverscrollBehavior: string;
    } | null>(null);
    const steps = isDesktop ? desktopSteps : mobileSteps;
    const isDesktopIntroStep = isDesktop && index === 0;

    // Function to trigger panel actions
    const triggerStepAction = (action: string) => {
        if (typeof window === "undefined") return;
        
        switch (action) {
            case "showStylePanel":
                // Trigger style panel to show
                window.postMessage({ type: "kloner:tour-show-style-panel" }, "*");
                break;
            default:
                break;
        }
    };

    useEffect(() => {
        if (typeof window === "undefined") return;

        const mq = window.matchMedia("(min-width: 768px)");
        const update = () => setIsDesktop(mq.matches);

        update();
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        if (!autoStart) return;
        if (typeof window === "undefined") return;

        setRunning(true);
    }, [autoStart]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const devAutoStart = isDevBuild() && autoStart;
        if (startToken <= 0 && !devAutoStart) return;
        setIndex(0);
        setRunning(true);
    }, [autoStart, startToken]);

    useEffect(() => {
        if (!running) return;
        
        // Trigger action for current step
        const currentStep = steps[index];
        if (currentStep && currentStep.action && currentStep.action !== "none") {
            triggerStepAction(currentStep.action);
        }
        
        // Initial placement + a few delayed retries so action-driven UI changes
        // (like opening the AI sidebar) have time to mount before targeting.
        updatePosition();
        const retryTimers = [80, 220, 500, 900].map((delay) =>
            window.setTimeout(() => {
                updatePosition();
            }, delay)
        );

        const onScroll = () => updatePosition();
        const onResize = () => updatePosition();
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onResize);
        return () => {
            retryTimers.forEach((t) => window.clearTimeout(t));
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

        if (!step.target) {
            setPos({ top: Math.max(window.innerHeight / 2 - 120, 24), left: Math.max(window.innerWidth / 2 - 170, 24) });
            removeHighlight();
            setOverlayMask(null);
            return;
        }

        // Try to find the target in the main document first
        let foundRect: DOMRect | null = null;

        // Handle multiple selectors separated by comma
        const selectors = step.target.split(',').map(s => s.trim());
        let el: HTMLElement | null = null;
        
        for (const selector of selectors) {
            el = document.querySelector(selector) as HTMLElement | null;
            if (el) break;
        }

        if (el) {
            foundRect = el.getBoundingClientRect();
        } else {
            // Search inside same-origin iframes (if the preview renders inside an iframe)
            const iframes = Array.from(document.querySelectorAll("iframe"));
            for (const iframe of iframes) {
                try {
                    const doc = iframe.contentDocument;
                    if (!doc) continue;
                    for (const selector of selectors) {
                        const inner = doc.querySelector(selector) as HTMLElement | null;
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
                    }
                    if (foundRect) break;
                } catch {
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
        const isRightSidebarStep = step.target.includes("#kloner-right-sidebar");
        const isSaveApplyStep = step.target.includes("#kloner-apply-changes");
        const desiredLeft = isRightSidebarStep
            ? rect.left - 360 - 20
            : isSaveApplyStep
                ? Math.max(rect.left - 360 - 20, 16)
            : Math.min(Math.max(rect.left, 16), window.innerWidth - 360 - 16);

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
        } catch {
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
        box.style.boxShadow = "0 14px 32px rgba(0,0,0,0.22), 0 0 0 6px rgba(255,141,33,0.08)";
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
    }, []);

    useEffect(() => {
        if (!running) return;
        if (typeof document === "undefined") return;

        const html = document.documentElement;
        const body = document.body;
        scrollStateRef.current = {
            htmlOverflow: html.style.overflow,
            bodyOverflow: body.style.overflow,
            htmlOverscrollBehavior: html.style.overscrollBehavior,
            bodyOverscrollBehavior: body.style.overscrollBehavior,
        };

        html.style.overflow = "hidden";
        body.style.overflow = "hidden";
        html.style.overscrollBehavior = "none";
        body.style.overscrollBehavior = "none";

        return () => {
            const prev = scrollStateRef.current;
            if (!prev) return;
            html.style.overflow = prev.htmlOverflow;
            body.style.overflow = prev.bodyOverflow;
            html.style.overscrollBehavior = prev.htmlOverscrollBehavior;
            body.style.overscrollBehavior = prev.bodyOverscrollBehavior;
            scrollStateRef.current = null;
        };
    }, [running]);

    useLayoutEffect(() => {
        if (!running) return;

        try {
            dialogRef.current?.focus({ preventScroll: true });
        } catch {
            dialogRef.current?.focus();
        }
    }, [index, running]);

    const finish = useCallback(async () => {
        setRunning(false);
        setIndex(0);
        onEnd?.();
    }, [onEnd]);

    const complete = useCallback(async () => {
        onComplete?.();
        await finish();
    }, [finish, onComplete]);

    const handleDontShowAgain = useCallback(async () => {
        markPreviewEditorTourDontShowAgain();
        markPreviewEditorTourSeen();
        setHasSeenTourBefore(true);
        onDontShowAgain?.();
        await finish();
    }, [finish, onDontShowAgain]);

    const next = useCallback(() => {
        if (index >= steps.length - 1) return complete();
        const nextIndex = index + 1;
        const nextStep = steps[nextIndex];
        if (nextStep && nextStep.action && nextStep.action !== "none") {
            triggerStepAction(nextStep.action);
        }
        setIndex(nextIndex);
    }, [complete, index, steps]);

    const handleStartIntro = useCallback(() => {
        if (!hasSeenTourBefore) {
            markPreviewEditorTourSeen();
            setHasSeenTourBefore(true);
        }
        next();
    }, [hasSeenTourBefore, next]);

    const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

    useLayoutEffect(() => {
        if (!running) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== " " && event.key !== "Spacebar" && event.code !== "Space") return;
            if (isDesktop && index === 0) return;
            event.preventDefault();
            event.stopPropagation();

            if (index >= steps.length - 1) {
                void complete();
                return;
            }

            next();
        };

        window.addEventListener("keydown", handleKeyDown, true);
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            document.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [complete, index, next, running, steps.length, isDesktop]);

    if (!running) return null;

    const step = steps[index];

    // overlayMask is now rectangular: { left, top, width, height }

    return createPortal(
        <div ref={containerRef} className="fixed inset-0 z-[999999] pointer-events-none">
            <style jsx global>{`
                @keyframes kloner-spacebar-press {
                    0%,
                    100% {
                        transform: translateY(0) scale(1);
                        box-shadow: inset 0 -2px 0 rgba(255, 141, 33, 0.12), 0 10px 22px rgba(255, 141, 33, 0.14);
                        opacity: 0.78;
                    }
                    28% {
                        transform: translateY(2px) scale(0.995);
                        box-shadow: inset 0 3px 10px rgba(0, 0, 0, 0.08), 0 4px 10px rgba(0, 0, 0, 0.08);
                        opacity: 1;
                    }
                    42% {
                        transform: translateY(2px) scale(0.994);
                        box-shadow: inset 0 3px 10px rgba(0, 0, 0, 0.08), 0 4px 10px rgba(0, 0, 0, 0.08);
                        opacity: 1;
                    }
                    58% {
                        transform: translateY(0) scale(1);
                        box-shadow: inset 0 -2px 0 rgba(255, 141, 33, 0.12), 0 10px 22px rgba(255, 141, 33, 0.14);
                        opacity: 0.82;
                    }
                }

                @keyframes kloner-spacebar-glow {
                    0%,
                    100% {
                        opacity: 0.18;
                        transform: scaleX(0.98);
                    }
                    28%,
                    42% {
                        opacity: 0.44;
                        transform: scaleX(1);
                    }
                    58% {
                        opacity: 0.22;
                        transform: scaleX(0.99);
                    }
                }
            `}</style>
            {/* overlay */}
            <div className="absolute inset-0 pointer-events-auto" style={{ zIndex: 2147483645 }}>
                <div
                    className={`absolute inset-0 ${isDesktopIntroStep ? "bg-black/10 backdrop-blur-[6px] backdrop-saturate-125" : "bg-black/44"}`}
                    aria-hidden="true"
                />
                {overlayMask ? (
                    <div
                        aria-hidden="true"
                        className="absolute bg-transparent"
                        style={{
                            top: overlayMask.top,
                            left: overlayMask.left,
                            width: overlayMask.width,
                            height: overlayMask.height,
                            borderRadius: 10,
                            boxShadow: "0 0 0 9999px rgba(0,0,0,0.44)",
                        }}
                    />
                ) : null}
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
                tabIndex={-1}
                ref={dialogRef}
                style={{
                    top: pos?.top ?? 120,
                    left: pos?.left ?? 40,
                    fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
                    zIndex: 2147483647,
                }}
                className="pointer-events-auto absolute w-[340px] max-w-[90vw] bg-white border border-black/5 rounded-2xl shadow-lg p-5 transition-transform duration-200 ease-out transform opacity-100"
            >
                <div className="flex items-start gap-3">
                    <div className="flex-1">
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
                            Preview tour
                        </div>
                        <h3 className="mt-1 text-[1.25rem] leading-tight font-semibold tracking-tight text-neutral-900 sm:text-[1.35rem]">
                            {step.title}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-neutral-700">{step.content}</p>
                    </div>
                </div>

                {isDesktopIntroStep ? (
                    <div className="mt-6 flex items-center justify-center gap-4">
                        {hasSeenTourBefore ? (
                            <button
                                type="button"
                                onClick={() => {
                                    void handleDontShowAgain();
                                }}
                                className="inline-flex items-center text-[11px] font-medium text-neutral-400 underline underline-offset-4 decoration-neutral-300 transition hover:text-neutral-600 hover:decoration-neutral-400"
                            >
                                Don&apos;t show again
                            </button>
                        ) : null}

                        <button
                            type="button"
                            data-tour-next
                            onClick={handleStartIntro}
                            className="inline-flex w-fit shrink-0 items-center justify-center rounded-full bg-[#FF8D21] px-10 py-3.5 text-base font-semibold text-white shadow-none transition-colors duration-200 ease-out hover:bg-[#d97717] active:translate-y-0 pointer-events-auto"
                        >
                            Start
                        </button>
                    </div>
                ) : (
                    <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={prev}
                                disabled={index === 0}
                                className="px-3 py-1.5 rounded-md text-sm font-semibold border border-black/10 bg-white text-accent pointer-events-auto disabled:opacity-40"
                                >
                                    Back
                            </button>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="text-xs text-black/50 mr-2">{index + 1}/{steps.length}</div>
                            {index === steps.length - 1 ? (
                                <button
                                    type="button"
                                    data-tour-complete
                                    onClick={complete}
                                    className="inline-flex w-fit shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm pointer-events-auto"
                                >
                                    <span>Complete</span>
                                    <kbd className="shrink-0 rounded bg-black/5 px-2 py-0.5 text-xs" aria-hidden>
                                        Spacebar
                                    </kbd>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    data-tour-next
                                    onClick={next}
                                    className="inline-flex w-fit shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm pointer-events-auto"
                                >
                                    <span>Next</span>
                                    <kbd className="shrink-0 rounded bg-black/5 px-2 py-0.5 text-xs" aria-hidden>
                                        Spacebar
                                    </kbd>
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
