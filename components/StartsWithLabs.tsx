// components/PreviewDashboard.tsx
"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import Image from "next/image";
import {
    Rocket,
    CheckCircle2,
    Hand,
    ListChecks,
    TimerOff,
    MousePointer,
    ArrowRight,
} from "lucide-react";
import { ClickyCursor } from "./ClickyCursor";
import { useUrlOverlay } from "./UrlOverlayProvider";

/**
 * Responsive, alignment-safe layout:
 * - Removes fragile absolute top offsets (top-40/top-45/etc).
 * - Uses a single flow layout inside BrowserFrame.
 * - Header panel is sticky within the browser viewport.
 * - Grid sits below header with consistent spacing on all breakpoints.
 */


type Phase =
    | "idle"
    | "typing"
    | "loading"
    | "revealing"
    | "highlight"
    | "deploying"
    | "success"
    | "cooldown";

/* ------------------------------ Mini features strip (static) ----------------- */
function FeaturesStrip() {
    const items = [
        {
            icon: <TimerOff className="h-5 w-5 text-neutral-800" />,
            title: "No setup",
            sub: "Paste a URL, get a project",
        },
        {
            icon: <ListChecks className="h-5 w-5 text-neutral-800" />,
            title: "Instant preview",
            sub: "See the clone in seconds",
        },
        {
            icon: <Hand className="h-5 w-5 text-neutral-800" />,
            title: "One-click deploy",
            sub: "Live hosting",
        },
    ];

    return (
        <div className="mt-10 md:mt-20 mb-10 md:mb-20 px-1">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-10">
                {items.map((it, i) => (
                    <motion.div
                        key={it.title}
                        initial={{ opacity: 0, y: 6 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.5 }}
                        transition={{ duration: 0.25, delay: i * 0.02 }}
                        className="flex md:justify-center items-start gap-3"
                    >
                        <div className="mt-0.5 shrink-0">{it.icon}</div>
                        <div>
                            <div className="text-base md:text-xl font-semibold leading-tight text-neutral-800">
                                {it.title}
                            </div>
                            <div className="text-sm text-neutral-500 mt-1">{it.sub}</div>
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}

export default function PreviewDashboard({
    url = "https://bettertherapy.ca",
    timings = {
        startDelayMs: 300,
        typeMsPerChar: 18,
        skeletonMs: 1250,
        revealStaggerMs: 1020,
        highlightMs: 1000,
        deployingMs: 1500,
        successMs: 3000,
        cooldownMs: 5000,
    },
}: {
    url?: string;
    timings?: Partial<{
        startDelayMs: number;
        typeMsPerChar: number;
        skeletonMs: number;
        revealStaggerMs: number;
        highlightMs: number;
        deployingMs: number;
        successMs: number;
        cooldownMs: number;
    }>;
}) {
    const T = {
        startDelayMs: timings.startDelayMs ?? 300,
        typeMsPerChar: timings.typeMsPerChar ?? 18,
        skeletonMs: timings.skeletonMs ?? 1250,
        revealStaggerMs: timings.revealStaggerMs ?? 1020,
        highlightMs: timings.highlightMs ?? 1000,
        deployingMs: timings.deployingMs ?? 1500,
        successMs: timings.successMs ?? 3000,
        cooldownMs: timings.cooldownMs ?? 5000,
    };

    const [phase, setPhase] = useState<Phase>("idle");
    const [typed, setTyped] = useState<string>("");
    const [pulseDeploy, setPulseDeploy] = useState<boolean>(false);
    const [previewReadyFlash, setPreviewReadyFlash] = useState<boolean>(false);
    const { openUrlOverlay } = useUrlOverlay();

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // stable viewport sizing for the browser content area
    const CANVAS_CLASS =
        "relative overflow-hidden " +
        "min-h-[560px] sm:min-h-[600px] lg:min-h-[640px] " +
        "max-h-[720px] md:max-h-[760px]";

    const runLoop = async () => {
        setPhase("idle");
        setTyped("");
        setPulseDeploy(false);
        setPreviewReadyFlash(false);

        await sleep(T.startDelayMs);

        setPhase("typing");
        for (let i = 1; i <= url.length; i++) {
            setTyped(url.slice(0, i));
            await sleep(T.typeMsPerChar);
        }

        setPreviewReadyFlash(true);
        await sleep(500);
        setPreviewReadyFlash(false);

        setPhase("loading");
        await sleep(T.skeletonMs);

        setPhase("revealing");
        await sleep(T.revealStaggerMs);

        setPhase("highlight");
        setPulseDeploy(true);
        await sleep(T.highlightMs);
        setPulseDeploy(false);

        setPhase("deploying");
        await sleep(T.deployingMs);

        setPhase("success");
        setTyped("");
        await sleep(T.successMs);

        setPhase("cooldown");
        await sleep(T.cooldownMs);

        runLoop();
    };

    useEffect(() => {
        runLoop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url]);

    const showcaseVisible =
        phase === "success" || phase === "cooldown";

    const controls = useAnimation();
    useEffect(() => {
        controls.start({ opacity: 1, y: 0 });
    }, [controls]);

    const isDeployedState = phase === "cooldown";
    const deployCtaLabel = isDeployedState ? "Deployed" : "Deploy";

    return (
        <section className="section bg-white text-neutral-800">
            <div className="container-soft">
                <FeaturesStrip />

                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={controls}
                    transition={{ duration: 0.35 }}
                    className="text-center px-2 pb-8"
                >
                    <div className="flex flex-col items-center gap-3">
                        <h2 className="text-4xl sm:text-5xl md:text-6xl text-neutral-950 leading-[1.05]">
                            Generate your website in a few clicks
                        </h2>
                        <ClickyCursor size={30} />
                    </div>

                    <p className="text-neutral-600 mt-3 max-w-2xl mx-auto text-base sm:text-lg leading-relaxed">
                        Drop a link. We generate assets, normalize code, and spin up a live
                        preview you can deploy in one click.
                    </p>

                    <button
                        type="button"
                        onClick={openUrlOverlay}
                        className="group inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm text-white mt-5 whitespace-nowrap transition-[padding] duration-200 ease-out"
                    >
                        <span>Get started</span>

                        <span
                            className="ml-0 w-0 overflow-hidden inline-flex items-center transition-[width,margin] duration-200 ease-out group-hover:w-4 group-hover:ml-1"
                            aria-hidden="true"
                        >
                            <svg
                                viewBox="0 0 20 20"
                                className="h-4 w-4 -translate-x-1 opacity-0 transition-all duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100"
                            >
                                <path
                                    d="M7 4l6 6-6 6"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </span>
                    </button>
                </motion.div>

                {/* Showcase area with browser frame + faded side demos */}
                <div className="relative">
                    {/* soft background behind everything */}
                    <div className="pointer-events-none absolute inset-0 -z-10 rounded-[36px] bg-white" />
                    <div className="pointer-events-none absolute inset-0 -z-10 rounded-[36px] ring-1 ring-neutral-200/60" />

                    {/* Side faded demos */}
                    <SideFadedDemo side="left" />
                    <SideFadedDemo side="right" />

                    {/* Center browser */}
                    <div className="mx-auto max-w-6xl px-2 sm:px-3 md:px-0">
                        <BrowserFrame
                            // urlDisplay={url}
                            className="mx-auto"
                            contentClassName={CANVAS_CLASS}
                        >
                            {/* Inner app layout (flow-based, no absolute offsets) */}
                            <div className="relative">
                                <SequenceCursor phase={phase} showcaseVisible={showcaseVisible} />

                                {/* In-app header panel (sticky) */}
                                {!showcaseVisible && (
                                    <div className="sticky top-0 z-20">
                                    <div className="px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 min-h-[220px] flex items-center justify-center">
                                        <div className="w-full max-w-5xl px-4 sm:px-5 py-4 sm:py-5">
                                                <div className="mt-1 flex items-center justify-center gap-2 text-xs text-neutral-700">
                                                    <button
                                                        type="button"
                                                        aria-disabled
                                                        className="pointer-events-none rounded-full px-3 py-1 ring-1 transition bg-neutral-100 ring-neutral-300 text-neutral-800"
                                                    >
                                                        URL
                                                    </button>
                                                    <button
                                                        type="button"
                                                        aria-disabled
                                                        className="pointer-events-none rounded-full px-3 py-1 ring-1 transition bg-transparent ring-neutral-300 text-neutral-500"
                                                    >
                                                        Prompt
                                                    </button>
                                                </div>

                                                <div className="mt-3 relative flex items-center bg-white/95 backdrop-blur-md p-2 pl-4 sm:pl-6 shadow-[0_20px_50px_rgba(0,0,0,0.08)] ring-1 ring-neutral-200 transition-all duration-300 ease-out rounded-full h-[64px] sm:h-[72px]">
                                                    <input
                                                        readOnly
                                                        value={typed || "https://bettertherapy.ca"}
                                                        className="flex-1 bg-transparent outline-none text-neutral-700 text-base sm:text-lg placeholder:text-neutral-400 font-medium pr-16 sm:pr-18 md:pr-0"
                                                        placeholder="bettertherapy.ca"
                                                        aria-label="URL preview"
                                                    />

                                                    <motion.button
                                                        aria-disabled
                                                        className="pointer-events-none absolute inset-y-2 right-2 h-auto w-10 rounded-full bg-[#f26522] text-white px-0 inline-flex items-center justify-center gap-2 sm:static sm:h-full sm:w-auto sm:inset-y-auto sm:px-10"
                                                        animate={{
                                                            scale: phase === "highlight" ? 0.94 : 1,
                                                            y: phase === "highlight" ? 1 : 0,
                                                        }}
                                                        transition={{ duration: 0.14, ease: "easeOut" }}
                                                    >
                                                        <ArrowRight className="h-4.5 w-4.5 sm:hidden" />
                                                        <span className="hidden sm:inline">Preview</span>
                                                    </motion.button>
                                                </div>
                                        </div>
                                    </div>

                                    {/* subtle fade separator under sticky header */}
                                    <div className="pointer-events-none h-6 bg-gradient-to-b from-white/80 to-transparent" />
                                    </div>
                                )}

                                {/* Content area */}
                                <div className="px-3 sm:px-4 md:px-6 pb-6 sm:pb-8">
                                    {phase === "deploying" && <InlineKlonerLoader />}

                                    <AnimatePresence>
                                        {showcaseVisible && (
                                            <motion.div
                                                key="showcase2"
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: 8 }}
                                                transition={{ duration: 0.22 }}
                                                className="relative mt-2 sm:mt-3 mx-2 sm:mx-3 md:mx-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"
                                            >
                                                <div className="flex items-center justify-between p-3 border-b border-neutral-200 bg-gray-50/95">
                                                    <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-2 py-1 shadow-sm">
                                                        <div className="px-1.5 text-[11px] font-semibold text-neutral-700 whitespace-nowrap">
                                                            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
                                                            Machine: Ready
                                                        </div>
                                                    </div>

                                                    <motion.button
                                                        type="button"
                                                        aria-disabled
                                                        className={[
                                                            "pointer-events-none inline-flex h-8 w-8 md:w-auto items-center justify-center gap-1.5 rounded-full px-0 md:px-3 py-1 text-[13px] font-semibold text-white transition",
                                                            isDeployedState
                                                                ? "border border-emerald-600 bg-emerald-600"
                                                                : "border border-[#f55f2a] bg-[#f55f2a]",
                                                        ].join(" ")}
                                                        animate={{
                                                            scale: phase === "success" ? 0.94 : 1,
                                                            y: phase === "success" ? 1 : 0,
                                                        }}
                                                        transition={{ duration: 0.14, ease: "easeOut" }}
                                                    >
                                                        {isDeployedState ? (
                                                            <CheckCircle2 className="h-3.5 w-3.5 md:mr-1" />
                                                        ) : (
                                                            <Rocket className="h-3.5 w-3.5 md:mr-1" />
                                                        )}
                                                        <span className="hidden md:inline">{deployCtaLabel}</span>
                                                    </motion.button>
                                                </div>

                                                <div className="relative w-full aspect-[3/4] md:aspect-[16/9] bg-neutral-100 md:bg-transparent">
                                                    <Image
                                                        src="/images/showcase/mobile_showcase2.jpg"
                                                        alt="Website showcase"
                                                        fill
                                                        sizes="100vw"
                                                        className="object-cover object-top md:hidden"
                                                        priority
                                                    />
                                                    <Image
                                                        src="/images/showcase/showcase2.jpg"
                                                        alt="Website showcase"
                                                        fill
                                                        sizes="(max-width: 768px) 100vw, 1100px"
                                                        className="hidden object-cover md:block"
                                                        priority
                                                    />
                                                    <div className="absolute inset-0 hidden bg-black/10 md:block" />
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </BrowserFrame>
                    </div>
                </div>
            </div>
        </section>
    );
}

/* ---------- subcomponents ---------- */

function InlineKlonerLoader() {
    return (
        <div className="mt-2 sm:mt-3 mb-4 mx-2 sm:mx-3 md:mx-4 rounded-2xl bg-white p-8 sm:p-10 grid place-items-center min-h-[220px]">
            <motion.div
                className="relative h-20 w-20"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
            >
                <motion.span
                    className="absolute inset-0 rounded-full border-2 border-t-transparent"
                    style={{
                        borderColor: "#f55f2a",
                        borderTopColor: "transparent",
                    }}
                    initial={{ rotate: 0 }}
                    animate={{ rotate: 360 }}
                    transition={{
                        duration: 1.1,
                        repeat: Infinity,
                        repeatType: "loop",
                        ease: "linear",
                    }}
                />
            </motion.div>
        </div>
    );
}

function SequenceCursor({
    phase,
    showcaseVisible,
}: {
    phase: Phase;
    showcaseVisible: boolean;
}) {
    const clickPhase = phase === "highlight" || phase === "success";
    const isPreviewClick = phase === "highlight";

    const previewTarget = { x: 85.2, y: 49.1 };
    const previewSpawnTarget = { x: 75.2, y: 70.2 };
    const deployTarget = { x: 90.5, y: 6.4 };
    const isResetting = phase === "idle";

    const target = (() => {
        if (phase === "success" || phase === "cooldown") {
            return { ...deployTarget, click: phase === "success" };
        }
        if (phase === "highlight" || phase === "deploying") {
            return { ...previewTarget, click: phase === "highlight" };
        }
        if (!showcaseVisible) {
            return { ...previewSpawnTarget, click: false };
        }
        return { ...previewSpawnTarget, click: false };
    })();

    return (
        <motion.div
            className="pointer-events-none absolute z-30 will-change-transform"
            initial={false}
            animate={{
                left: `${target.x}%`,
                top: `${target.y}%`,
                opacity: isResetting ? 0 : 1,
            }}
            transition={{
                left: {
                    duration: isResetting ? 0 : 0.62,
                    ease: [0.25, 0.1, 0.25, 1],
                },
                top: {
                    duration: isResetting ? 0 : 0.62,
                    ease: [0.25, 0.1, 0.25, 1],
                },
                opacity: { duration: isResetting ? 0.12 : 0.2, ease: "easeOut" },
            }}
            style={{ transform: "translate3d(-50%, -50%, 0)" }}
        >
            <motion.div
                key={clickPhase ? `click-${phase}` : "idle"}
                className="relative"
                animate={
                    target.click
                        ? { scale: [1, 0.92, 1], y: [0, 1, 0] }
                        : { scale: 1, y: 0 }
                }
                transition={
                    target.click
                        ? {
                              duration: 0.3,
                              ease: "easeOut",
                              delay: isPreviewClick ? 0.5 : 0,
                          }
                        : { duration: 0.2, ease: "easeOut" }
                }
            >
                <MousePointer className="h-7 w-7 text-neutral-900 drop-shadow-[0_1px_1px_rgba(255,255,255,0.55)]" />
                {target.click ? (
                    <>
                        <motion.span
                            className="absolute -left-1 -top-1 h-4 w-4 rounded-full"
                            style={{ boxShadow: "0 0 0 2px rgba(0,0,0,0.3)" }}
                            animate={{ opacity: [0.8, 0], scale: [0.55, 2.2] }}
                            transition={{ duration: 0.55, ease: "easeOut" }}
                        />
                    </>
                ) : null}
            </motion.div>
        </motion.div>
    );
}

function AnimatedCaret({
    text,
    showCaret,
    className = "",
}: {
    text: string;
    showCaret?: boolean;
    className?: string;
}) {
    return (
        <span className={className}>
            {text}
            <span
                className={[
                    "inline-block w-[0.55ch] -mb-[2px]",
                    showCaret ? "opacity-100" : "opacity-0",
                ].join(" ")}
            >
                <motion.span
                    aria-hidden
                    className="inline-block h-[1.05em] w-[1px] align-middle bg-neutral-800"
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                />
            </span>
        </span>
    );
}

/* ---------- browser chrome + side demos ---------- */

function BrowserFrame({
    children,
    // urlDisplay,
    className = "",
    contentClassName = "",
}: {
    children: React.ReactNode;
    // urlDisplay: string;
    className?: string;
    contentClassName?: string;
}) {
    return (
        <div
            className={[
                "relative rounded-[34px] border border-neutral-200 bg-white shadow-[0_20px_70px_rgba(0,0,0,0.08)]",
                className,
            ].join(" ")}
        >
            {/* outer glow */}
            <div className="pointer-events-none absolute -inset-[1px] rounded-[36px] ring-1 ring-neutral-200/50" />

            {/* chrome */}
            <div className="h-12 flex items-center gap-3 px-4 border-b border-neutral-200 bg-white rounded-t-[34px]">
                <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </div>

                <div className="flex-1">
                    <div className="mx-auto max-w-[820px]">
                        <div className="h-8 rounded-full bg-neutral-50 border border-neutral-200 px-4 flex items-center">
                            <div className="text-[12px] text-neutral-500 truncate">
                                https://kloner.app
                            </div>
                        </div>
                    </div>
                </div>

                <div className="hidden sm:flex items-center gap-2">
                    <span className="h-7 w-7 rounded-full bg-neutral-100 border border-neutral-200" />
                </div>
            </div>

            {/* content viewport */}
            <div
                className={[
                    "relative rounded-b-[34px] overflow-hidden",
                    contentClassName,
                ].join(" ")}
            >
                <div className="absolute inset-0 bg-white" />
                <div className="relative">{children}</div>
            </div>
        </div>
    );
}

function SideFadedDemo({ side }: { side: "left" | "right" }) {
    return (
        <div
            className={[
                "pointer-events-none hidden lg:block absolute top-10 bottom-10",
                side === "left"
                    ? "left-0 -translate-x-[20%]"
                    : "right-0 translate-x-[20%]",
            ].join(" ")}
            aria-hidden="true"
        >
            <div
                className={[
                    "relative h-full w-[420px] xl:w-[480px]",
                    "opacity-[0.22] blur-[0.2px]",
                ].join(" ")}
                style={{
                    maskImage:
                        side === "left"
                            ? "linear-gradient(to right, transparent, black 22%, black 78%, transparent)"
                            : "linear-gradient(to left, transparent, black 22%, black 78%, transparent)",
                    WebkitMaskImage:
                        side === "left"
                            ? "linear-gradient(to right, transparent, black 22%, black 78%, transparent)"
                            : "linear-gradient(to left, transparent, black 22%, black 78%, transparent)",
                }}
            >
                <div
                    className={[
                        "absolute inset-0",
                        side === "left" ? "rotate-[-1.25deg]" : "rotate-[1.25deg]",
                    ].join(" ")}
                >
                    <div className="h-full rounded-[28px] border border-neutral-200 bg-white shadow-sm overflow-hidden">
                        <div className="h-10 border-b border-neutral-200 bg-white flex items-center gap-2 px-3">
                            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                            <div className="ml-2 h-6 w-[70%] rounded-full bg-neutral-50 border border-neutral-200" />
                        </div>

                        <div className="h-full grid grid-cols-[160px,1fr]">
                            <DemoSidebar />
                            <DemoContent />
                        </div>
                    </div>
                </div>

                {/* extra fade wash so it stays subtle */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-transparent to-white/40" />
            </div>
        </div>
    );
}

function DemoSidebar() {
    const items = [
        "Home",
        "Dashboard",
        "Builder",
        "Deployments",
        "Community templates",
        "Settings",
        "Docs",
    ];

    return (
        <div className="border-r border-neutral-200 bg-white">
            <div className="p-4 border-b border-neutral-200">
                <div className="h-8 w-24 rounded-lg bg-neutral-200" />
            </div>
            <div className="p-3 space-y-2">
                {items.map((t, idx) => (
                    <div
                        key={t}
                        className={[
                            "h-9 rounded-xl border border-neutral-200 bg-white flex items-center px-3",
                            idx === 1 ? "bg-neutral-50" : "",
                        ].join(" ")}
                    >
                        <div className="h-5 w-5 rounded-md bg-neutral-200 mr-2" />
                        <div className="h-3 w-[70%] rounded bg-neutral-200" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function DemoContent() {
    return (
        <div className="bg-white">
            <div className="p-4 border-b border-neutral-200">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="h-4 w-40 rounded bg-neutral-200" />
                        <div className="h-3 w-64 rounded bg-neutral-200 mt-2" />
                    </div>
                    <div className="h-9 w-28 rounded-full bg-neutral-200" />
                </div>
            </div>

            <div className="p-4">
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
                        <div className="h-20 bg-neutral-200" />
                        <div className="p-3">
                            <div className="h-3 w-24 rounded bg-neutral-200" />
                            <div className="h-3 w-40 rounded bg-neutral-200 mt-2" />
                        </div>
                    </div>
                    <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
                        <div className="h-20 bg-neutral-200" />
                        <div className="p-3">
                            <div className="h-3 w-24 rounded bg-neutral-200" />
                            <div className="h-3 w-40 rounded bg-neutral-200 mt-2" />
                        </div>
                    </div>
                </div>

                <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                        <div className="h-3 w-44 rounded bg-neutral-200" />
                        <div className="h-7 w-20 rounded-full bg-neutral-200" />
                    </div>
                    <div className="mt-3 space-y-2">
                        <div className="h-3 w-[92%] rounded bg-neutral-200" />
                        <div className="h-3 w-[86%] rounded bg-neutral-200" />
                        <div className="h-3 w-[74%] rounded bg-neutral-200" />
                    </div>
                </div>
            </div>
        </div>
    );
}
