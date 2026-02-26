// components/HowItWorks.tsx
"use client";

import { motion, useScroll, useTransform, MotionValue } from "framer-motion";
import React, { useRef, useState, useEffect } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";

/* ----------------------------- Mini “modals” ----------------------------- */

function UrlInputModal() {
  return (
    <div className="w-full h-40 md:h-56 rounded-2xl border border-black/10 bg-white shadow-md p-4 md:p-5 min-h-60">
      <div className="text-xs text-neutral-500 mb-2 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <span>Drop a link or describe it</span>
      </div>
      <div className="rounded-xl ring-1 ring-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-700 flex items-center gap-2">
        <span className="text-neutral-400">URL:</span>
        <span className="font-medium text-neutral-800 truncate">
          https://example.com
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        {/* <button
          aria-disabled
          className="pointer-events-none inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-400"
        >
          Rescan
        </button> */}
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

const pages = [{ name: "Home" }, { name: "Services" }, { name: "About" }];

function PreviewGridModal() {
  return (
    <div className="w-full h-40 md:h-56 rounded-2xl border border-black/10 bg-white shadow-md p-4 md:p-5 min-h-60">
      <div className="text-xs text-neutral-500 mb-3">Preview pages</div>
      <div className="grid grid-cols-3 gap-2">
        {pages.map((page) => (
          <div
            key={page.name}
            className="rounded-xl border border-neutral-200 bg-neutral-50 p-2"
          >
            <div className="text-[10px] text-neutral-500 mb-1">
              {page.name}
            </div>
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
  const doneOpacity = useTransform(
    progress,
    [start, doneAt] as const,
    [0, 1] as const
  );
  const spinOpacity = useTransform(
    progress,
    [start, doneAt] as const,
    [1, 0] as const
  );

  return (
    <div className="w-full rounded-2xl border border-black/10 bg-white shadow-md p-4 md:p-5 grid place-items-center min-h-60">
      <div className="relative w-full h-full grid place-items-center">
        <motion.div style={{ opacity: spinOpacity }} className="text-center absolute">
          <div className="mx-auto mb-3 h-8 w-8 rounded-full border-2 border-neutral-200 border-t-neutral-900 animate-spin" />
          <div className="text-sm font-medium text-neutral-800">
            Deploying live…
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            Building, optimizing, shipping
          </div>
        </motion.div>
        <motion.div style={{ opacity: doneOpacity }} className="text-center absolute">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
          <div className="text-sm font-medium text-neutral-800">Deployed</div>
          <div className="text-xs text-neutral-500 mt-1">
            Your project is live
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ------------------------- EditBlocksModal (simple) ------------------------- */

function EditBlocksModal() {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

    let direction: 1 | -1 = 1;
    let rafId = 0;
    let lastTs = performance.now();
    const speedPxPerSec = 18;

    const tick = (ts: number) => {
      const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
      lastTs = ts;

      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll > 0) {
        el.scrollTop += direction * speedPxPerSec * dt;

        if (el.scrollTop >= maxScroll - 1) direction = -1;
        if (el.scrollTop <= 1) direction = 1;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="w-full h-40 md:h-56 min-w-[250px] rounded-2xl border border-black/10 bg-white shadow-md p-4 md:p-5 min-h-60 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-neutral-600">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span>AI Agent</span>
        </div>

        <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 shadow-sm">
          Live editing
        </span>
      </div>

      <div className="flex-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3 overflow-hidden flex flex-col">
        <div className="relative flex-1 overflow-hidden">
          <div ref={scrollerRef} className="h-full space-y-2 overflow-y-auto pr-1">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 h-6 w-6 rounded-full bg-neutral-900 text-white grid place-items-center text-[11px] font-semibold">
                U
              </div>
              <div className="flex-1 rounded-xl bg-white border border-neutral-200 px-3 py-2">
                <div className="text-[11px] font-semibold text-neutral-600">You</div>
                <div className="text-sm text-neutral-800 leading-5">
                  Make the hero headline shorter, add a pricing section, and connect the CTA to signup.
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <div className="mt-0.5 h-6 w-6 rounded-full bg-[rgba(245,95,42,1)] text-white grid place-items-center text-[11px] font-semibold">
                K
              </div>
              <div className="flex-1 rounded-xl bg-white border border-[rgba(245,95,42,0.22)] px-3 py-2">
                <div className="text-[11px] font-semibold text-[rgba(245,95,42,1)]">Kloner Agent</div>
                <div className="text-sm text-neutral-800 leading-5">
                  Done. I tightened the headline, generated a pricing section, and wired the primary CTA to your signup flow.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                    Updated copy
                  </span>
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                    Added section
                  </span>
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                    CTA linked
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <div className="mt-0.5 h-6 w-6 rounded-full bg-neutral-900 text-white grid place-items-center text-[11px] font-semibold">
                U
              </div>
              <div className="flex-1 rounded-xl bg-white border border-neutral-200 px-3 py-2">
                <div className="text-[11px] font-semibold text-neutral-600">You</div>
                <div className="text-sm text-neutral-800 leading-5">
                  Also add auth and a database, and make it look more premium.
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <div className="mt-0.5 h-6 w-6 rounded-full bg-[rgba(245,95,42,1)] text-white grid place-items-center text-[11px] font-semibold">
                K
              </div>
              <div className="flex-1 rounded-xl bg-white border border-[rgba(245,95,42,0.22)] px-3 py-2">
                <div className="text-[11px] font-semibold text-[rgba(245,95,42,1)]">Kloner Agent</div>
                <div className="text-sm text-neutral-800 leading-5">
                  Added login, a simple DB model, and updated the UI spacing/typography for a cleaner look.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                    Auth added
                  </span>
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                    DB connected
                  </span>
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                    UI refined
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-neutral-50 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-neutral-50 to-transparent" />
        </div>

        <div className="mt-3 rounded-xl border border-neutral-200 bg-white px-3 py-2">
          <div className="text-[11px] text-neutral-500">Ask the agent…</div>
          <div className="mt-1 h-4 w-5/6 rounded-md bg-neutral-200" />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Data ---------------------------------- */

type ModalWithProgress = React.ComponentType<{ progress: MotionValue<number> }>;
type ModalPlain = React.ComponentType;

const items = [
  {
    title: "Link or description",
    text: "Point us at any site. We'll analyze the structure and create you a base layout.",
    step: 1,
    Modal: UrlInputModal as ModalPlain,
    needsProgress: false,
  },
  {
    title: "Preview",
    text: "Choose to generate a simple html page or start from a sentence describing your ideal website.",
    step: 2,
    Modal: PreviewGridModal as ModalPlain,
    needsProgress: false,
  },
  {
    title: "Customize",
    text: "When your preview is complete, our agent will fine-tune it to your liking with your simple instruction.",
    step: 3,
    Modal: EditBlocksModal as ModalPlain,
    needsProgress: false,
  },
  {
    title: "Deploy",
    text: "Finally, name and deploy your website with just a few clicks to Vercel and view your live project within minutes.",
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
    <motion.div
      style={{ opacity, scale }}
      className="w-full max-w-[520px] space-y-4"
    >
      <div className="flex items-center gap-3 mt-5">
        <span className="inline-flex sm:flex-col items-center lg:text-center rounded-full px-2.5 py-1 text-[11px] font-semibold border border-black/15 text-black/70">
          {step}
        </span>
        <h3 className="text-2xl md:text-3xl whitespace-nowrap text-black my-5">
          {title}
        </h3>
      </div>
      <p className="text-black/70 text-sm min-h-[5rem] md:h-20 leading-relaxed">{text}</p>
      {/* @ts-expect-error conditional prop forwarding */}
      {needsProgress ? <Modal progress={progress} /> : <Modal />}
    </motion.div>
  );
}

/* ------------------------------- Component ------------------------------- */

export default function HowItWorks() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  // Intersection tracking to gate the scroll hint
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setInView(entry.isIntersecting);
      },
      {
        threshold: 0.1,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const T1 = 0.0;
  const T2 = 0.25;
  const T3 = 0.5;
  const T4 = 0.75;
  const ε = 0.02;

  const c1Opacity = useTransform(scrollYProgress, [0, T1, 1], [1, 1, 1]);
  const c2Opacity = useTransform(
    scrollYProgress,
    [0, T2 - ε, T2, 1],
    [0, 0, 1, 1]
  );
  const c3Opacity = useTransform(
    scrollYProgress,
    [0, T3 - ε, T3, 1],
    [0, 0, 1, 1]
  );
  const c4Opacity = useTransform(
    scrollYProgress,
    [0, T4 - ε, T4, 1],
    [0, 0, 1, 1]
  );

  const c1Scale = useTransform(scrollYProgress, [0, T1, T1 + ε], [1, 1, 1]);
  const c2Scale = useTransform(
    scrollYProgress,
    [0, T2 - ε, T2],
    [0.96, 0.96, 1]
  );
  const c3Scale = useTransform(
    scrollYProgress,
    [0, T3 - ε, T3],
    [0.96, 0.96, 1]
  );
  const c4Scale = useTransform(
    scrollYProgress,
    [0, T4 - ε, T4],
    [0.96, 0.96, 1]
  );

  const fill = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  const s1 = useTransform(scrollYProgress, [0, T1, 1], [1, 1, 1]);
  const s2 = useTransform(
    scrollYProgress,
    [0, T2 - ε, T2, 1],
    [0.35, 0.35, 1, 1]
  );
  const s3 = useTransform(
    scrollYProgress,
    [0, T3 - ε, T3, 1],
    [0.35, 0.35, 1, 1]
  );
  const s4 = useTransform(
    scrollYProgress,
    [0, T4 - ε, T4, 1],
    [0.35, 0.35, 1, 1]
  );

  // Scroll hint opacity: only when section is in view, fades near end
  const hintOpacity = useTransform(scrollYProgress, (v) => {
    if (!inView) return 0;
    if (v <= 0.1) return 1;
    if (v >= 0.9) return 0;
    // simple linear fade between 0.1 and 0.9
    const t = (v - 0.1) / 0.8; // 0 → 1
    return 1 - t; // 1 → 0
  });

  return (
    <section id="how" className="bg-white text-black">
      <div className="container-soft">
        <div ref={containerRef} className="relative h-auto md:h-[220vh]">
          {/* Scroll-to-continue bouncer */}
          <motion.div
            style={{ opacity: hintOpacity }}
            className="pointer-events-none fixed inset-x-0 bottom-6 z-40 hidden md:flex justify-center"
          >
            <div className="pointer-events-auto inline-flex items-center gap-1 border border-neutral-700 rounded-full px-3 py-2 text-xs text-neutral-800 shadow-lg sm:text-sm">
              <span>Scroll to continue</span>
              <motion.div
                animate={{ y: [0, 6, 0] }}
                transition={{
                  duration: 1.1,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5" />
              </motion.div>
            </div>
          </motion.div>

          <div className="md:sticky md:top-44">
            <h2 className="text-4xl md:text-6xl mb-10 text-black/80">
              How it works
            </h2>

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
