// components/ParallaxTypeHero.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useMotionValueEvent, useScroll, useTransform, useSpring } from 'framer-motion';
import Image from 'next/image';
import { ArrowRightSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { getPublicHttpUrlRejectionReason, stripProtocol, validateAndNormalizePublicHttpUrl } from '@/src/lib/publicHttpUrl';

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type Props = {
    headline?: string;
    subcopy?: string;
    parallaxStrength?: number;
    vignette?: number;
    typingStart?: number;
    typingEnd?: number;
    showUrlInput?: boolean;
};

export default function ParallaxTypeHero({
    headline = 'Clone a website from a URL.',
    subcopy = 'Start a limited free preview',
    parallaxStrength = 0,
    vignette = 0.35,
    typingStart = -0.005,
    typingEnd = 0.10,
    showUrlInput = false,
}: Props) {
    const sectionRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const [url, setUrl] = useState('');
    const [error, setError] = useState<string | null>(null);
    const { scrollYProgress } = useScroll({
        target: sectionRef,
        offset: ['start start', 'end start'],
    });

    const y = useTransform(scrollYProgress, [0, 1], [0, -parallaxStrength]);
    const scale = useTransform(scrollYProgress, [0, 1], [1.15, 1.05]);

    const norm = useTransform(scrollYProgress, (v) =>
        clamp((v - typingStart) / (typingEnd - typingStart), 0, 1)
    );
    const eased = useTransform(norm, (v) => easeOutCubic(v));
    const smooth = useSpring(eased, { stiffness: 120, damping: 20, mass: 0.25 });
    const charIndex = useTransform(smooth, (v) => Math.round(v * (headline?.length ?? 0)));

    const [typed, setTyped] = useState('');

    useEffect(() => {
        setTyped(headline.slice(0, Math.round(smooth.get() * headline.length)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useMotionValueEvent(charIndex, 'change', (i) => {
        setTyped(headline.slice(0, i));
    });

    const subOpacity = useTransform(scrollYProgress, [typingEnd - 0.10, typingEnd + 0.10], [0, 1]);

    return (
        <section ref={sectionRef} className="relative w-full overflow-clip border-b rounded-xl" style={{ height: '100vh' }}>
            <motion.div aria-hidden className="absolute inset-0 z-0 overflow-hidden" style={{ y, scale }}>
                <div className="absolute -inset-[6vh]">
                    <div className="relative h-full w-full">
                        <Image
                            src="/images/hero_bg.png"
                            alt="Hero background"
                            fill
                            priority={false}
                            sizes="100vw"
                            className="absolute inset-0 h-full w-full object-cover select-none pointer-events-none"
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-black/10" />
                        <div className="absolute inset-0 bg-gradient-to-tr from-black/25 via-transparent to-black/15" />
                    </div>
                </div>
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            'radial-gradient(120% 140% at 20% 20%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0) 70%)',
                        opacity: vignette,
                    }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background: 'linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0.15) 35%, rgba(0,0,0,0))',
                        opacity: 0.9,
                    }}
                />
            </motion.div>

            <div className="relative z-10 sticky top-0 flex h-screen items-center">
                <div className="mx-auto w-full max-w-6xl px-6">
                    <h2 className="max-w-2xl text-5xl font-semibold leading-tight tracking-tight text-white md:text-6xl">
                        <span className="align-middle">{typed}</span>
                        <span className="ml-1 inline-block h-[1.1em] w-[0.06em] translate-y-[0.06em] bg-white opacity-80 animate-[blink_1s_steps(1)_infinite]" />
                    </h2>

                    <motion.div initial={{ opacity: 0, y: 8 }} style={{ opacity: subOpacity }}>
                        <div className="mt-5 md:mt-6">
                            {showUrlInput ? (
                                <form
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        const normalized = validateAndNormalizePublicHttpUrl(stripProtocol(url));
                                        if (!normalized) {
                                            setError(getPublicHttpUrlRejectionReason(stripProtocol(url)) || 'Please enter a valid public http(s) URL.');
                                            return;
                                        }
                                        setError(null);
                                        if (auth.currentUser) {
                                            router.replace(`/dashboard/view?u=${encodeURIComponent(normalized)}&focusUrl=1`);
                                        } else {
                                            try { localStorage.setItem('kloner.pendingUrl', normalized); } catch { /* ignore */ }
                                            router.push(`/login?mode=signup&u=${encodeURIComponent(normalized)}`);
                                        }
                                    }}
                                    className="w-full max-w-2xl space-y-3"
                                >
                                    <div className="rounded-full bg-white/95 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.3)] ring-1 ring-white/20 backdrop-blur-md">
                                        <div className="flex items-stretch gap-2">
                                            <div className="flex min-h-[48px] flex-1 items-center rounded-full px-4 sm:px-6">
                                                <span className="hidden sm:inline text-neutral-400 text-lg font-medium mr-1">https://</span>
                                                <input
                                                    value={url}
                                                    onChange={(event) => { const value = stripProtocol(event.target.value); setUrl(value); setError(value && !validateAndNormalizePublicHttpUrl(value) ? 'Please enter a valid public http(s) URL.' : null); }}
                                                    placeholder="example.com"
                                                    inputMode="url"
                                                    autoCapitalize="none"
                                                    autoComplete="off"
                                                    aria-label="Website URL"
                                                    className="w-full bg-transparent outline-none text-neutral-700 text-base sm:text-lg placeholder:text-neutral-400 font-medium"
                                                />
                                            </div>
                                            <button type="submit" disabled={!url || !!error} className="inline-flex min-h-[48px] w-12 shrink-0 items-center justify-center rounded-full bg-[#FF8D21] text-white transition-all hover:bg-[#D96E11] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-5" aria-label="Clone website from URL">
                                                <ArrowRightSquare className="h-5 w-5 sm:hidden" aria-hidden />
                                                <span className="hidden text-sm sm:inline sm:text-base">Clone</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="text-xs sm:text-sm text-white font-medium" aria-live="polite">{error ?? 'Clone a public website • Preview the result • Customize and launch'}</div>
                                </form>
                            ) : (
                                <div onClick={() => router.push('/login?mode=signup')} className="group relative inline-flex items-center gap-3 whitespace-nowrap h-12 px-7 rounded-full shrink-0 text-white text-[15px] bg-accent hover:bg-accent2 shadow-[0_6px_18px_rgba(0,0,0,0.25)] hover:shadow-[0_14px_40px_rgba(0,0,0,0.35)] transition-all duration-200" aria-label={subcopy}>
                                    <span className="relative px-2 py-5">{subcopy}</span>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </div>
            </div>
            <style jsx global>{`
        @keyframes blink { 50% { opacity: 0; } }
        h1 { text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
      `}</style>
        </section>
    );
}
