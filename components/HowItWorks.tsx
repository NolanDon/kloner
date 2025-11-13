// components/HowItWorks.tsx
'use client';

import { motion, useScroll, useTransform, MotionValue } from 'framer-motion';
import React, { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

/* ----------------------------- Mini “modals” ----------------------------- */

function UrlInputModal() {
  return (
    <div className="w-full h-40 md:h-56 rounded-2xl border border-black/10 bg-white shadow-md p-4 md:p-5 min-h-60 ">
      <div className="text-xs text-neutral-500 mb-2 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <span>Paste a URL</span>
      </div>
      <div className="rounded-xl ring-1 ring-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-700 flex items-center gap-2">
        <span className="text-neutral-400">URL:</span>
        <span className="font-medium text-neutral-800 truncate">https://example.com</span>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          aria-disabled
          className="pointer-events-none inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-400"
        >
          Rescan
        </button>
        <button
          aria-disabled
          className="pointer-events-none inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm text-white"
        >
          Clone
        </button>
      </div>
    </div>
  );
}

function PreviewGridModal() {
  return (
    <div className="w-full h-40 md:h-56 rounded-2xl border border-black/10 bg-white shadow-md p-4 md:p-5 min-h-60 ">
      <div className="text-xs text-neutral-500 mb-3">Preview pages</div>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-neutral-200 bg-neutral-50 p-2">
            <div className="h-4 w-5/6 rounded-md bg-neutral-200 mb-2" />
            <div className="grid grid-cols-2 gap-1">
              <div className="h-8 rounded-md bg-neutral-200" />
              <div className="h-8 rounded-md bg-neutral-200" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-2">
          <button
            aria-disabled
            className="pointer-events-none whitespace-nowrap inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-xs text-neutral-400"
          >
            Rebuild preview
          </button>
          <button
            aria-disabled
            className="pointer-events-none inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs text-white"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- Deploy modal ---------------------------- */

function DeployModal({
  progress,
  doneAt = 0.9,
}: {
  progress: MotionValue<number>;
  doneAt?: number;
}) {
  const start = Math.max(0, doneAt - 0.02);
  const doneOpacity = useTransform(progress, [start, doneAt] as const, [0, 1] as const);
  const spinOpacity = useTransform(progress, [start, doneAt] as const, [1, 0] as const);

  return (
    <div className="w-full rounded-2xl border border-black/10 bg-white shadow-md p-4 md:p-5 grid place-items-center min-h-60">
      <div className="relative w-full h-full grid place-items-center">
        <motion.div style={{ opacity: spinOpacity }} className="text-center absolute">
          <div className="mx-auto mb-3 h-8 w-8 rounded-full border-2 border-neutral-200 border-t-neutral-900 animate-spin" />
          <div className="text-sm font-medium text-neutral-800">Deploying to Vercel…</div>
          <div className="text-xs text-neutral-500 mt-1">Building, optimizing, shipping</div>
        </motion.div>
        <motion.div style={{ opacity: doneOpacity }} className="text-center absolute">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
          <div className="text-sm font-medium text-neutral-800">Deployed</div>
          <div className="text-xs text-neutral-500 mt-1">Your project is live</div>
        </motion.div>
      </div>
    </div>
  );
}

/* ------------------------- EditBlocksModal (simple) ------------------------- */

function EditBlocksModal() {
  return (
    <div className="w-full min-w-[250px] rounded-2xl border border-black/10 bg-white shadow-md p-4 md:p-5 min-h-60 ">
      <div className="flex items-center justify-between mb-3">
        {/* <div className="text-xs text-neutral-500">Editor</div> */}
        <div className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
          <CheckCircle2 className="h-4 w-4" />
          Changes saved
        </div>
      </div>

      <div>
        {[0].map((i) => (
          <div key={i} className="rounded-xl border border-neutral-200 bg-neutral-50 p-2 mb-6">
            <div className="h-4 w-5/6 rounded-md bg-neutral-200 mb-2" />
            <div className="grid grid-cols-2 gap-1">
              <div className="h-8 rounded-md bg-neutral-200" />
              <div className="h-8 rounded-md bg-neutral-200" />
            </div>
          </div>
        ))}

        <div className="flex my-2 gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200 pointer-events-none"
            aria-label="Edit block"
          >
            <span>✏️</span>
            <span>Edit</span>
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium bg-rose-50 text-rose-700 ring-1 ring-rose-200 pointer-events-none"
            aria-label="Delete block"
          >
            <span>🗑️</span>
            <span>Delete</span>
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
      </div>
    </div>
  );
}

/* --------------------------------- Data ---------------------------------- */

type ModalWithProgress = React.ComponentType<{ progress: MotionValue<number> }>;
type ModalPlain = React.ComponentType;

const items = [
  {
    title: 'Paste a URL',
    text: 'Point us at any site. We\'ll fetch the page structure and begin creating a snapshot.',
    step: 1,
    Modal: UrlInputModal as ModalPlain,
    needsProgress: false,
  },
  {
    title: 'Preview',
    text: 'Once complete, begin generating previews from the snapshot we capture.',
    step: 2,
    Modal: PreviewGridModal as ModalPlain,
    needsProgress: false,
  },
  {
    title: 'Customize',
    text: 'After choosing a final preview, open it in our editor to modify blocks, or add assets.',
    step: 3,
    Modal: EditBlocksModal as ModalPlain,
    needsProgress: false,
  },
  {
    title: 'Deploy',
    text: 'Finally, deploy with just a few clicks to Vercel and view your live project within minutes.',
    step: 4,
    Modal: DeployModal as ModalWithProgress,
    needsProgress: true,
  },
] as const;

/* --------------------------------- Card ---------------------------------- */

function Card({
  step,
  title,
  text,
  opacity,
  scale,
  Modal,
  progress,
  needsProgress,
}: {
  step: number;
  title: string;
  text: string;
  opacity: any;
  scale: any;
  Modal: ModalPlain | ModalWithProgress;
  progress: MotionValue<number>;
  needsProgress: boolean;
}) {
  return (
    <motion.div style={{ opacity, scale }} className="w-full max-w-[520px] space-y-4">
      <div className="flex items-center gap-3 mt-5">
        <span className="inline-flex sm:flex-col items-center lg:text-center rounded-full px-2.5 py-1 text-[11px] font-semibold border border-black/15 text-black/70">
          {step}
        </span>
        <h3 className="text-2xl md:text-3xl whitespace-nowrap text-black my-5">{title}</h3>
      </div>
      <p className="text-black/70 text-sm h-20 leading-relaxed">{text}</p>
      {/* @ts-expect-error conditional prop forwarding */}
      {needsProgress ? <Modal progress={progress} /> : <Modal />}
    </motion.div>
  );
}

/* ------------------------------- Component ------------------------------- */

export default function HowItWorks() {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  const T1 = 0.0;
  const T2 = 0.25;
  const T3 = 0.5;
  const T4 = 0.75;
  const ε = 0.02;

  const c1Opacity = useTransform(scrollYProgress, [0, T1, 1], [1, 1, 1]);
  const c2Opacity = useTransform(scrollYProgress, [0, T2 - ε, T2, 1], [0, 0, 1, 1]);
  const c3Opacity = useTransform(scrollYProgress, [0, T3 - ε, T3, 1], [0, 0, 1, 1]);
  const c4Opacity = useTransform(scrollYProgress, [0, T4 - ε, T4, 1], [0, 0, 1, 1]);

  const c1Scale = useTransform(scrollYProgress, [0, T1, T1 + ε], [1, 1, 1]);
  const c2Scale = useTransform(scrollYProgress, [0, T2 - ε, T2], [0.96, 0.96, 1]);
  const c3Scale = useTransform(scrollYProgress, [0, T3 - ε, T3], [0.96, 0.96, 1]);
  const c4Scale = useTransform(scrollYProgress, [0, T4 - ε, T4], [0.96, 0.96, 1]);

  const fill = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);

  const s1 = useTransform(scrollYProgress, [0, T1, 1], [1, 1, 1]);
  const s2 = useTransform(scrollYProgress, [0, T2 - ε, T2, 1], [0.35, 0.35, 1, 1]);
  const s3 = useTransform(scrollYProgress, [0, T3 - ε, T3, 1], [0.35, 0.35, 1, 1]);
  const s4 = useTransform(scrollYProgress, [0, T4 - ε, T4, 1], [0.35, 0.35, 1, 1]);

  return (
    <section className="bg-white text-black">
      <div className="container-soft">
        <div ref={containerRef} className="relative h-[220vh]">
          <div className="sticky top-44">
            <h2 className="text-4xl md:text-6xl mb-10 text-black/80">How it works</h2>

            <div className="relative">
              <div className="flex flex-col xl:flex-row w-full max-w-6xl md:mx-auto items-stretch xl:items-start justify-start xl:justify-between gap-8">
                <Card
                  step={items[0].step}
                  title={items[0].title}
                  text={items[0].text}
                  opacity={c1Opacity}
                  scale={c1Scale}
                  Modal={items[0].Modal}
                  progress={scrollYProgress}
                  needsProgress={false}
                />
                <Card
                  step={items[1].step}
                  title={items[1].title}
                  text={items[1].text}
                  opacity={c2Opacity}
                  scale={c2Scale}
                  Modal={items[1].Modal}
                  progress={scrollYProgress}
                  needsProgress={false}
                />
                <Card
                  step={items[2].step}
                  title={items[2].title}
                  text={items[2].text}
                  opacity={c3Opacity}
                  scale={c3Scale}
                  Modal={items[2].Modal}
                  progress={scrollYProgress}
                  needsProgress={false}
                />
                <Card
                  step={items[3].step}
                  title={items[3].title}
                  text={items[3].text}
                  opacity={c4Opacity}
                  scale={c4Scale}
                  Modal={items[3].Modal}
                  progress={scrollYProgress}
                  needsProgress={true}
                />
              </div>
            </div>

            <div className="hidden md:block mt-10">
              <div className="relative mx-auto max-w-5xl">
                <div className="h-[3px] rounded bg-black/10" />
                <motion.div className="absolute inset-y-0 left-0 rounded bg-accent" style={{ width: fill }} />
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
                  <motion.span
                    style={{ opacity: s4 }}
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-accent text-white text-xs font-semibold px-2"
                  >
                    4
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
