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
    title: 'Track improvement',
    text:
      'See your superpower score and biological age improve with each draw and habit change.',
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
}: {
  img: string;
  step: number;
  title: string;
  text: string;
  opacity: number;
}) {
  return (
    <motion.div
      style={{ opacity }}
      className="absolute inset-0 flex items-start justify-center"
    >
      <div className="w-full max-w-3xl space-y-5">
        <img
          src={img}
          alt=""
          className="w-full rounded-2xl border border-black/10 shadow-xl"
        />
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border border-black/15 text-black/70">
            {step}
          </span>
          <h3 className="text-2xl font-semibold text-black">{title}</h3>
        </div>
        <p className="text-black/70">{text}</p>
      </div>
    </motion.div>
  );
}

export default function HowItWorks() {
  // make the whole section tall so the user can scroll while we keep content pinned
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  // split the scroll into 3 equal windows (one per card)
  const o0 = useTransform(scrollYProgress, [0.00, 0.15, 0.32], [1, 1, 0]); // card 1 fades out
  const o1 = useTransform(scrollYProgress, [0.18, 0.35, 0.52], [0, 1, 0]); // card 2 fades in then out
  const o2 = useTransform(scrollYProgress, [0.40, 0.65, 0.90], [0, 1, 1]); // card 3 fades in and stays

  return (
    <section id="how" className="bg-white text-black">
      <div className="container-soft">
        <div className="py-14 py-10">

          <h2 className="text-6xl mb-10 text-black/80"></h2>

          {/* Tall scroll area with sticky content */}
          <div ref={containerRef} className="relative h-[220vh]">
            <div className="sticky top-44">
          <h2 className="text-6xl mb-10 text-black/80">How it works</h2>
              <div className="relative h-[70vh]">
                <Card {...items[0]} opacity={o0 as unknown as number} />
                <Card {...items[1]} opacity={o1 as unknown as number} />
                <Card {...items[2]} opacity={o2 as unknown as number} />
              </div>

              {/* optional progress dots */}
              <div className="flex items-center justify-center gap-2">
                <span className="h-2 w-2 rounded-full bg-black/70" />
                <span className="h-2 w-2 rounded-full bg-black/40" />
                <span className="h-2 w-2 rounded-full bg-black/20" />
              </div>
            </div>
          </div>

          {/* subtle divider to the next section */}
          <div className="mt-12 h-px bg-black/10" />
        </div>
      </div>
    </section>
  );
}
