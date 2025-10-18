// components/HowItWorks.tsx
'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import React, { useRef } from 'react';

const items = [
  {
    title: 'Test your whole body',
    text:
      'Get a comprehensive blood draw at one of our 2,000+ partner labs or from the comfort of your own home.',
    img: '/images/works1.png',
    step: 1,
  },
  {
    title: 'An actionable plan',
    text:
      'Easy to understand results and a clear health plan with tailored recommendations on diet, lifestyle changes & supplements.',
    img: '/images/works2.png',
    step: 2,
  },
  {
    title: 'A connected ecosystem',
    text:
      'Book additional diagnostics, buy curated supplements, and track everything from your dashboard.',
    img: '/images/works3.png',
    step: 3,
  },
];

function Card({
  img,
  step,
  title,
  text,
  opacity,
  scale,
}: {
  img: string;
  step: number;
  title: string;
  text: string;
  opacity: any;
  scale: any;
}) {
  return (
    <motion.div
      style={{ opacity, scale }}
      className="w-full max-w-[520px] space-y-4"
    >
      <img
        src={img}
        alt=""
        className="w-full h-40 md:h-56 object-cover rounded-2xl border border-black/10 shadow-md"
      />
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border border-black/15 text-black/70">
          {step}
        </span>
        <h3 className="text-xl font-semibold text-black">{title}</h3>
      </div>
      <p className="text-black/70 text-sm leading-relaxed">{text}</p>
    </motion.div>
  );
}

export default function HowItWorks() {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  // thresholds (when each step/card should appear)
  const T1 = 0.0;   // card 1 visible immediately
  const T2 = 0.33;  // card 2 appears around one-third in
  const T3 = 0.66;  // card 3 appears around two-thirds in
  const ε = 0.02;   // small fade-in window

  // card opacities: 0 → 1 at threshold and then STAY 1
  const c1Opacity = useTransform(scrollYProgress, [0, T1, 1], [1, 1, 1]);
  const c2Opacity = useTransform(scrollYProgress, [0, T2 - ε, T2, 1], [0, 0, 1, 1]);
  const c3Opacity = useTransform(scrollYProgress, [0, T3 - ε, T3, 1], [0, 0, 1, 1]);

  // subtle scale-in at threshold (no movement)
  const c1Scale = useTransform(scrollYProgress, [0, T1, T1 + ε], [1, 1, 1]);
  const c2Scale = useTransform(scrollYProgress, [0, T2 - ε, T2], [0.96, 0.96, 1]);
  const c3Scale = useTransform(scrollYProgress, [0, T3 - ε, T3], [0.96, 0.96, 1]);

  // progress bar fill across the section
  const fill = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);

  // step badges: light up at threshold and stay on
  const s1 = useTransform(scrollYProgress, [0, T1, 1], [1, 1, 1]);
  const s2 = useTransform(scrollYProgress, [0, T2 - ε, T2, 1], [0.35, 0.35, 1, 1]);
  const s3 = useTransform(scrollYProgress, [0, T3 - ε, T3, 1], [0.35, 0.35, 1, 1]);

  return (
    <section id="how" className="bg-white text-black">
      <div className="container-soft">
        {/* Tall scroll container so we have room to reveal each card */}
        <div ref={containerRef} className="relative h-[180vh]">
          <div className="sticky top-44">
            {/* Title stays in place */}
            <h2 className="text-6xl mb-10 text-black/80">How it works</h2>

            {/* Static row of cards; they DO NOT move, only reveal */}
            <div className="relative">
              <div className="mx-auto flex w-full max-w-6xl items-start justify-between gap-8">
                <Card {...items[0]} opacity={c1Opacity} scale={c1Scale} />
                <Card {...items[1]} opacity={c2Opacity} scale={c2Scale} />
                <Card {...items[2]} opacity={c3Opacity} scale={c3Scale} />
              </div>
            </div>

            {/* Progress bar with accumulating step badges */}
            <div className="mt-10">
              <div className="relative mx-auto max-w-5xl">
                <div className="h-[3px] rounded bg-black/10" />
                <motion.div
                  className="absolute inset-y-0 left-0 rounded bg-accent"
                  style={{ width: fill }}
                />
                <div className="absolute -top-3 left-0 right-0 flex justify-between">
                  <motion.span
                    style={{ opacity: s1 }}
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-accent text-white text-xs font-semibold px-2"
                  >
                    1
                  </motion.span>
                  <motion.span
                    style={{ opacity: s2 }}
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-accent text-white text-xs font-semibold px-2"
                  >
                    2
                  </motion.span>
                  <motion.span
                    style={{ opacity: s3 }}
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-accent text-white text-xs font-semibold px-2"
                  >
                    3
                  </motion.span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
