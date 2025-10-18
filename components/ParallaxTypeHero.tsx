// components/ParallaxTypeHero.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useMotionValueEvent, useScroll, useTransform, useSpring } from 'framer-motion';
import Image from 'next/image';
import holdup from '@/public/images/holdup.png';

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type Props = {
    headline?: string;
    subcopy?: string;
    parallaxStrength?: number;
    vignette?: number;
    typingStart?: number; // section progress where typing begins
    typingEnd?: number;   // section progress where typing ends
};

export default function ParallaxTypeHero({
    headline = "Health is your greatest superpower. It's time to unlock it.",
    subcopy = 'Start testing',
    parallaxStrength = 440,
    vignette = 0.35,
    typingStart = -0.005,
    typingEnd = 0.10,
}: Props) {
    const sectionRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: sectionRef,
        offset: ['start start', 'end start'],
    });

    // parallax bg
    const y = useTransform(scrollYProgress, [0, 1], [0, -parallaxStrength]);
    const scale = useTransform(scrollYProgress, [0, 1], [1.15, 1.05]);

    // --- smoother typing ---
    // map scroll -> [0..1] within typing window, with easing
    const norm = useTransform(scrollYProgress, (v) =>
        clamp((v - typingStart) / (typingEnd - typingStart), 0, 1)
    );
    const eased = useTransform(norm, (v) => easeOutCubic(v));
    // spring smooth the eased progress for buttery typing
    const smooth = useSpring(eased, { stiffness: 120, damping: 20, mass: 0.25 });
    // convert to character count
    const charIndex = useTransform(smooth, (v) => Math.round(v * headline.length));

    const [typed, setTyped] = useState('');

    // initialize on mount to avoid flicker
    useEffect(() => {
        setTyped(headline.slice(0, Math.round(smooth.get() * headline.length)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useMotionValueEvent(charIndex, 'change', (i) => {
        setTyped(headline.slice(0, i));
    });

    const subOpacity = useTransform(scrollYProgress, [typingEnd - 0.02, typingEnd + 0.14], [0, 1]);

    return (
        // was: style={{ height: '100vh' }}
        // mobile uses 115svh (a bit taller), desktop remains 100vh
        <section ref={sectionRef} className="relative w-full h-[115svh] sm:h-[100vh]">
            {/* Top rounded cap stays the same */}

            {/* Background image */}
            <motion.div
                aria-hidden
                className="absolute inset-0 z-0 overflow-hidden"
                style={{ y, scale }}
            >
                {/* more overscan on mobile to avoid any edge showing */}
                <div className="absolute -inset-[12vh] sm:-inset-[6vh]">
                    <div className="relative h-full w-full">
                        <Image src={holdup} alt="" fill priority sizes="100vw" className="object-cover" />
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

            {/* Foreground */}
            {/* was: className="relative z-10 sticky top-0 flex h-screen items-center" */}
            {/* mobile uses 100svh so the text + button stay pinned over the image */}
            <div className="relative z-10 sticky top-0 flex h-[100svh] sm:h-screen items-center">
                <div className="mx-auto w-full max-w-6xl px-6">
                    <h1 className="max-w-2xl text-5xl font-semibold leading-tight tracking-tight text-white md:text-6xl">
                        <span className="align-middle">{typed}</span>
                        <span className="ml-1 inline-block h-[1.1em] w-[0.06em] translate-y-[0.06em] bg-white opacity-80 animate-[blink_1s_steps(1)_infinite]" />
                    </h1>

                    {/* CTA */}
                    <motion.div initial={{ opacity: 0, y: 8 }} style={{ opacity: subOpacity }}>
                        <div className="mt-5 md:mt-6">
                            <a
                                href="#start"
                                className="
        group relative inline-flex items-center gap-3 whitespace-nowrap
        h-12 px-7 rounded-full shrink-0
        text-white text-[15px]
        bg-accent hover:bg-accent2
        shadow-[0_6px_18px_rgba(0,0,0,0.25)]
        hover:shadow-[0_14px_40px_rgba(0,0,0,0.35)]
        transition-all duration-200
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60
      "
                                aria-label="Start testing"
                            >
                                {/* soft glow on hover */}
                                <span
                                    className="
          pointer-events-none absolute inset-0 rounded-full
          before:content-[''] before:absolute before:inset-0 before:rounded-full
          before:bg-white/10 before:opacity-0 before:blur-md
          before:transition-opacity before:duration-200
          group-hover:before:opacity-100
        "
                                />
                                <span className="relative">Start testing</span>
                                <svg
                                    viewBox="0 0 24 24"
                                    className="
          relative h-4 w-4
          transition-transform duration-200
          group-hover:translate-x-1
        "
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden
                                >
                                    <path d="M6 12h12" />
                                    <path d="M12 6l6 6-6 6" />
                                </svg>
                            </a>
                        </div>
                    </motion.div>

                </div>
            </div>

            {/* Bottom curve */}
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 rounded-t-[24px] bg-white" />

            <style jsx global>{`
        @keyframes blink { 50% { opacity: 0; } }
        h1 { text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
      `}</style>
        </section>
    );
}
