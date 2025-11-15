// components/PreviewDashboard.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { Rocket, RefreshCw, Globe, CheckCircle2, Hand, ListChecks, TimerOff, MousePointer } from 'lucide-react';
import { ClickyCursor } from './ClickyCursor';

/**
 * Fixed-height canvas prevents reflow. Transitions shortened aggressively.
 */

type PageCard = { name: string; path: string; hint?: string };
const PAGES: PageCard[] = [
    { name: 'Home', path: '/' },
    { name: 'About', path: '/about', hint: 'Team • Mission' },
    { name: 'Pricing', path: '/price', hint: 'Plans • Tiers' },
] as const;

type Phase =
    | 'idle'
    | 'typing'
    | 'loading'
    | 'revealing'
    | 'highlight'
    | 'deploying'
    | 'success'
    | 'cooldown';

/* ------------------------------ Mini features strip (static) ----------------- */
function FeaturesStrip() {
    const items = [
        { icon: <TimerOff className="h-5 w-5 text-neutral-800" />, title: 'No setup', sub: 'Paste a URL, get a project' },
        { icon: <ListChecks className="h-5 w-5 text-neutral-800" />, title: 'Instant preview', sub: 'See the clone in seconds' },
        { icon: <Hand className="h-5 w-5 text-neutral-800" />, title: 'One-click deploy', sub: 'Vercel, Netlify, or zip' },
    ];

    return (
        <div className="mt-10 md:mt-20 mb-16 md:mb-40 px-1">
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
                            <div className="text-base md:text-xl font-semibold leading-tight text-neutral-800">{it.title}</div>
                            <div className="text-sm text-neutral-500 mt-1">{it.sub}</div>
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}

export default function PreviewDashboard({
    url = 'https://example.com',
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
        skeletonMs: timings.skeletonMs ?? 250,
        revealStaggerMs: timings.revealStaggerMs ?? 120,
        highlightMs: timings.highlightMs ?? 400,
        deployingMs: timings.deployingMs ?? 700,
        successMs: timings.successMs ?? 700,
        cooldownMs: timings.cooldownMs ?? 300,
    };

    const [phase, setPhase] = useState<Phase>('idle');
    const [typed, setTyped] = useState<string>('');
    const [visibleCount, setVisibleCount] = useState<number>(0);
    const [pulseDeploy, setPulseDeploy] = useState<boolean>(false);
    const [previewReadyFlash, setPreviewReadyFlash] = useState<boolean>(false);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // fixed height canvas
    const CANVAS_CLASS = 'relative overflow-hidden min-h-[500px] md:min-h-[500px] lg:min-h-[500px]';

    const runLoop = async () => {
        setPhase('idle');
        setTyped('');
        setVisibleCount(0);
        setPulseDeploy(false);
        setPreviewReadyFlash(false);

        await sleep(T.startDelayMs);

        setPhase('typing');
        for (let i = 1; i <= url.length; i++) {
            setTyped(url.slice(0, i));
            await sleep(T.typeMsPerChar);
        }

        setPreviewReadyFlash(true);
        await sleep(500);
        setPreviewReadyFlash(false);

        setPhase('loading');
        await sleep(T.skeletonMs);

        setPhase('revealing');
        for (let i = 1; i <= PAGES.length; i++) {
            setVisibleCount(i);
            await sleep(T.revealStaggerMs);
        }

        setPhase('highlight');
        setPulseDeploy(true);
        await sleep(T.highlightMs);
        setPulseDeploy(false);

        setPhase('deploying');
        await sleep(T.deployingMs);

        setPhase('success');
        setTyped('');
        await sleep(T.successMs);

        setPhase('cooldown');
        await sleep(T.cooldownMs);

        runLoop();
    };

    useEffect(() => {
        runLoop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url]);

    const headerHint = useMemo(() => {
        switch (phase) {
            case 'typing':
                return 'Typing…';
            case 'loading':
                return 'Building preview…';
            case 'revealing':
            case 'highlight':
                return 'Preview ready';
            case 'deploying':
                return 'Deploying to Vercel…';
            case 'success':
                return 'Deployed';
            default:
                return 'Ready';
        }
    }, [phase]);

    const gridVisible = phase === 'loading' || phase === 'revealing' || phase === 'highlight';
    const controls = useAnimation();

    useEffect(() => {
        controls.start({ opacity: 1, y: 0 });
    }, [controls]);

    const primaryLabel: 'Preview' | 'Deploy' =
        previewReadyFlash
            ? 'Preview'
            : ['loading', 'revealing', 'highlight', 'deploying', 'success'].includes(phase)
                ? 'Deploy'
                : 'Preview';

    const primaryDisabled: boolean = (() => {
        if (previewReadyFlash) return false;
        if (phase === 'typing') return true;
        if (phase === 'loading') return true;
        if (phase === 'revealing') return true;
        if (phase === 'highlight') return false;
        if (phase === 'deploying' || phase === 'success') return true;
        if (phase === 'idle' || phase === 'cooldown') return true;
        return true;
    })();

    const primaryBg = phase === 'highlight' ? 'bg-accent' : primaryDisabled ? 'bg-neutral-300' : 'bg-accent';

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
                    <div className="items-center gap-2">
                        <h2 className="text-4xl sm:text-5xl md:text-6xl text-neutral-950 mb-3 md:mb-5">
                            Generate your website in a few clicks
                        </h2>
                        <ClickyCursor size={30} />
                    </div>


                    <p className="text-neutral-600 mt-2 md:mt-3 max-w-2xl mx-auto text-base sm:text-lg">
                        Drop a link. We generate assets, normalize code, and spin up a live preview you can deploy in one click.
                    </p>
                    <a
                        href="#how"
                        className="group inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm text-white mt-4 whitespace-nowrap transition-[padding] duration-200 ease-out"
                    >
                        <span>Get started</span>

                        {/* Arrow container starts at zero width; grows on hover so the button expands */}
                        <span
                            className="ml-0 w-0 overflow-hidden inline-flex items-center transition-[width,margin] duration-200 ease-out
               group-hover:w-4 group-hover:ml-1"
                            aria-hidden="true"
                        >
                            <svg viewBox="0 0 20 20" className="h-4 w-4 -translate-x-1 opacity-0 transition-all duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100">
                                <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </span>
                    </a>

                </motion.div>

                {/* Fixed-height canvas. All changing content is absolutely positioned in here. */}
                <div className={CANVAS_CLASS}>
                    {/* Header / Address bar */}
                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className="absolute left-0 right-0 top-0 rounded-2xl border border-neutral-200 bg-white/90 backdrop-blur p-4 md:p-5 shadow-sm mx-auto max-w-5xl"
                    >
                        <div className="flex items-center gap-2 text-xs text-neutral-500">
                            <span className="text-neutral-800">{headerHint}</span>
                        </div>

                        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
                            <div className="flex-1 rounded-xl ring-1 ring-neutral-200 bg-neutral-50 px-3 py-2.5 md:py-3 text-sm text-neutral-700 overflow-hidden">
                                <span className="text-neutral-400 mr-1">URL:</span>
                                <AnimatedCaret text={typed} showCaret={phase === 'typing'} className="font-medium text-neutral-800 break-all" />
                            </div>

                            <div className="flex gap-2">
                                <button
                                    aria-disabled
                                    className="pointer-events-none inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-400"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                    Rescan
                                </button>
                                <button
                                    aria-disabled
                                    className={[
                                        'pointer-events-none relative inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm text-white',
                                        primaryBg,
                                        pulseDeploy ? 'ring-4 ring-neutral-900/10' : 'ring-0',
                                    ].join(' ')}
                                >
                                    <Rocket className="h-4 w-4" />
                                    {primaryLabel}
                                </button>
                            </div>
                        </div>
                    </motion.div>

                    {/* Deploying / Success overlay */}
                    <AnimatePresence>
                        {(phase === 'deploying' || phase === 'success') && (
                            <motion.div
                                key="overlay"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                className="absolute inset-x-0 top-40 md:top-35 mx-auto max-w-5xl rounded-2xl border border-neutral-200 bg-white p-10 md:p-14 shadow-sm grid place-items-center"
                            >
                                {phase === 'deploying' && (
                                    <div className="text-center">
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{ repeat: Infinity, ease: 'linear', duration: 1.1 }}
                                            className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-neutral-200 border-t-neutral-900"
                                        />
                                        <div className="text-lg font-medium">Deploying to Vercel…</div>
                                        <div className="text-sm text-neutral-500 mt-1">Building, optimizing, shipping</div>
                                    </div>
                                )}
                                {phase === 'success' && (
                                    <div className="text-center">
                                        <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto mb-3" />
                                        <div className="text-lg font-medium">Success! Your preview was deployed.</div>
                                        <div className="text-sm text-neutral-500 mt-1">Continuing in a moment…</div>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Grid */}
                    {gridVisible && (
                        <div className="absolute inset-x-0 top-40 md:top-28 mx-auto max-w-5xl">
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.25, delay: 0.02 }}
                                className="text-sm text-neutral-600 mt-5 mb-3 px-1"
                            >
                                Generated pages
                            </motion.div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                                {PAGES.map((p, i) => {
                                    const revealed = i < visibleCount && (phase === 'revealing' || phase === 'highlight');
                                    const loading = phase === 'loading' || (!revealed && phase !== 'highlight');
                                    return (
                                        <motion.div
                                            key={p.path}
                                            initial={{ opacity: 0, y: 8, scale: 0.99 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            transition={{ duration: 0.25, delay: 0.02 + i * 0.02 }}
                                            className="group rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow-sm"
                                        >
                                            <Thumb url={url} path={p.path} revealed={revealed} loading={loading} />
                                            <div className="p-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="min-w-0">
                                                        {revealed ? (
                                                            <>
                                                                <div className="text-sm font-medium text-neutral-800">{p.name}</div>
                                                                {p.hint && <div className="text-xs text-neutral-500 truncate">{p.hint}</div>}
                                                            </>
                                                        ) : (
                                                            <div className="h-6 w-24 rounded bg-neutral-200 animate-pulse" />
                                                        )}
                                                    </div>
                                                    <button
                                                        aria-disabled
                                                        className="pointer-events-none text-xs rounded-full px-3 py-1 border border-neutral-200 text-neutral-400"
                                                    >
                                                        Open
                                                    </button>
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}

/* ---------- subcomponents ---------- */

function AnimatedCaret({
    text,
    showCaret,
    className = '',
}: {
    text: string;
    showCaret?: boolean;
    className?: string;
}) {
    return (
        <span className={className}>
            {text}
            <span className={['inline-block w-[0.55ch] -mb-[2px]', showCaret ? 'opacity-100' : 'opacity-0'].join(' ')}>
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

function Thumb({
    url,
    path,
    revealed,
    loading,
}: {
    url: string;
    path: string;
    revealed: boolean;
    loading: boolean;
}) {
    const full = (url.replace(/\/+$/, '') || '') + path;

    return (
        <div className="relative aspect-[4/3] bg-gradient-to-br from-neutral-50 to-white">
            <div className="absolute left-0 right-0 top-0 h-8 border-b border-neutral-200 bg-white/90 flex items-center gap-1 px-3">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-400" />
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <div className="ml-2 text-[11px] text-neutral-500 truncate">{full}</div>
            </div>

            <div className="absolute inset-0 pt-8">
                <div className="p-3 md:p-4 relative h-full">
                    <AnimatePresence>
                        {loading && !revealed && (
                            <motion.div
                                key="sk"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                className="absolute inset-0 pt-8 p-3 md:p-4"
                            >
                                <div className="h-10 md:h-12 w-4/5 rounded-xl bg-neutral-200 animate-pulse" />
                                <div className="h-3 w-3/5 rounded-md bg-neutral-200 animate-pulse mt-2" />
                                <div className="grid grid-cols-3 gap-2 mt-2">
                                    <div className="h-20 rounded-xl bg-neutral-200 animate-pulse" />
                                    <div className="h-20 rounded-xl bg-neutral-200 animate-pulse" />
                                    <div className="h-20 rounded-xl bg-neutral-200 animate-pulse" />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {revealed && (
                        <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.22 }}
                        >
                            <div className="h-10 md:h-12 w-4/5 rounded-xl bg-neutral-400 ring-1 ring-neutral-200" />
                            <div className="h-3 w-3/5 rounded-md bg-neutral-400 ring-1 ring-neutral-200 mt-2" />
                            <div className="grid grid-cols-3 gap-2 mt-2">
                                <div className="h-20 rounded-xl bg-neutral-400 ring-1 ring-neutral-200" />
                                <div className="h-20 rounded-xl bg-neutral-400 ring-1 ring-neutral-200" />
                                <div className="h-20 rounded-xl bg-neutral-400 ring-1 ring-neutral-200" />
                            </div>
                        </motion.div>
                    )}
                </div>
            </div>
        </div>
    );
}
