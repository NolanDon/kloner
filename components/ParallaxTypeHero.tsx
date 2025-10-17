// components/ParallaxTypeHero.tsx
'use client';

import React, { useRef, useState } from 'react';
import { motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion';
import Image from 'next/image';
import holdup from '@/public/images/holdup.png';

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type Props = {
    headline?: string;
    subcopy?: string;
    parallaxStrength?: number;
    vignette?: number;
    typingStart?: number;
    typingEnd?: number;
};

export default function ParallaxTypeHero({
    headline = "Health is your greatest superpower. It's time to unlock it.",
    subcopy = 'Start testing',
    parallaxStrength = 440,
    vignette = 0.35,
    typingStart = -0.1,
    typingEnd = 0.15,
}: Props) {
    const sectionRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end start'] });

    // Give the image more headroom so edges never show
    const y = useTransform(scrollYProgress, [0, 1], [0, -parallaxStrength]);
    const scale = useTransform(scrollYProgress, [0, 1], [1.15, 1.05]); // ⬅️ larger than before

    const [typed, setTyped] = useState('');
    useMotionValueEvent(scrollYProgress, 'change', (v) => {
        const norm = clamp((v - typingStart) / (typingEnd - typingStart), 0, 1);
        const eased = easeOutCubic(norm);
        setTyped(headline.slice(0, Math.round(eased * headline.length)));
    });

    const subOpacity = useTransform(scrollYProgress, [typingEnd - 0.02, typingEnd + 0.14], [0, 1]);

    return (
        <section ref={sectionRef} className="relative w-full" style={{ height: '100vh' }}>
            {/* === Top cap (rounded, bordered, not full-width) === */}
            <div className="pointer-events-none absolute inset-x-0 -top-20 z-20 h-20">
                <div className="h-full rounded-b-[28px] border border-neutral-200 border-t-0 bg-white" />
            </div>

            {/* Background image (oversized + parallax) */}
            <motion.div aria-hidden className="absolute inset-0 z-0 overflow-hidden" style={{ y, scale }}>
                {/* Bleed beyond viewport to be extra safe */}
                <div className="absolute -inset-[6vh]">
                    <div className="relative h-full w-full">
                        <Image
                            src={holdup}
                            alt=""
                            fill
                            priority
                            sizes="100vw"
                            className="object-cover"
                        />
                    </div>
                </div>

                {/* (Optional) overlays */}
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
            <div className="relative z-10 sticky top-0 flex h-screen items-center">
                <div className="mx-auto w-full max-w-6xl px-6">
                    <h1 className="max-w-2xl text-5xl font-semibold leading-tight tracking-tight text-white md:text-6xl">
                        <span className="align-middle">{typed}</span>
                        <span className="ml-1 inline-block h-[1.1em] w-[0.06em] translate-y-[0.06em] bg-white opacity-80 animate-[blink_1s_steps(1)_infinite]" />
                    </h1>

                    <motion.div
                        className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-neutral-900 shadow-lg backdrop-blur"
                        initial={{ opacity: 0, y: 8 }}
                        style={{ opacity: subOpacity }}
                    >
                        {subcopy}
                        <svg width="18" height="18" viewBox="0 0 24 24" className="-mr-1">
                            <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                        </svg>
                    </motion.div>
                </div>
            </div>

            {/* Bottom white curve into next section */}
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 rounded-t-[24px] bg-white" />

            <style jsx global>{`
        @keyframes blink { 50% { opacity: 0; } }
        h1 { text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
      `}</style>
        </section>
    );
}
