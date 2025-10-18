// components/MembershipSticky.tsx
'use client';

import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

/* ----------------------------------------------------------------
   Shared bits
------------------------------------------------------------------*/
const spring = { type: 'spring', stiffness: 260, damping: 22 };
const soft = { duration: 0.6, ease: 'easeOut' };

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-b-xl bg-neutral-50">
      {children}
    </div>
  );
}

function FeatureFrame({
  i,
  title,
  sub,
  children,
}: {
  i: number;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35, once: true });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ ...soft, delay: i * 0.05 }}
      className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"
    >
      {children}
      <div className="p-4">
        <div className="font-semibold text-neutral-900">{title}</div>
        <div className="mt-1 text-sm text-neutral-500">{sub}</div>
      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------
   1) All your data in one place
   - Unique: staggered stack-in + metric counters pulsing
------------------------------------------------------------------*/
function MiniData() {
  const Stat = ({ label, value, delay }: { label: string; value: string; delay: number }) => (
    <motion.div
      initial={{ y: 24, opacity: 0 }}
      whileInView={{ y: 0, opacity: 1 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ ...spring, delay }}
      className="relative mx-auto h-14 w-[85%] rounded-xl border border-neutral-200 bg-white shadow-sm"
    >
      <div className="flex h-full items-center justify-between px-4 text-sm">
        <div className="font-medium text-neutral-800">{label}</div>
        <motion.div
          className="rounded-md bg-neutral-900 px-2 py-0.5 text-xs font-semibold text-white"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.6 }}
        >
          {value}
        </motion.div>
      </div>
    </motion.div>
  );

  return (
    <CardShell>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <Stat label="Biological Age" value="31.8" delay={0.05} />
        <Stat label="ApoB (mg/dL)" value="78" delay={0.15} />
        <Stat label="VO₂ est." value="44" delay={0.25} />
      </div>
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   2) Upload past lab data
   - Unique: file flies in → progress bar fills → sparkline draws
------------------------------------------------------------------*/
function MiniUpload() {
  return (
    <CardShell>
      <div className="absolute inset-0 p-4">
        {/* upload icon flying to a tray */}
        <motion.div
          initial={{ x: -40, y: -20, rotate: -8, opacity: 0 }}
          whileInView={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ ...spring, delay: 0.05 }}
          className="mx-auto mb-3 h-8 w-6 rounded-sm border border-neutral-300 bg-white shadow-sm"
        />
        {/* progress bar */}
        <div className="mx-auto mb-4 h-2 w-3/4 overflow-hidden rounded bg-neutral-200">
          <motion.div
            className="h-full bg-emerald-500"
            initial={{ width: '0%' }}
            whileInView={{ width: '100%' }}
            viewport={{ once: true }}
            transition={{ duration: 1.2, ease: 'easeInOut', delay: 0.15 }}
          />
        </div>
        {/* sparkline drawing */}
        <svg viewBox="0 0 320 120" className="mx-auto block h-24 w-3/4">
          <motion.path
            d="M8,90 C38,76 58,66 88,74 C118,82 132,50 168,56 C198,60 212,44 240,50 C268,56 292,32 312,36"
            fill="none"
            stroke="#10b981"
            strokeWidth="3"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.1, delay: 0.35, ease: 'easeOut' }}
          />
        </svg>
      </div>
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   3) Your personalized health plan
   - Unique: cards swipe-in + checkmark path draws
------------------------------------------------------------------*/
function MiniPlan() {
  const Row = ({ text, d, delay }: { text: string; d: string; delay: number }) => (
    <motion.div
      initial={{ x: -16, opacity: 0, rotate: -1 }}
      whileInView={{ x: 0, opacity: 1, rotate: 0 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ ...spring, delay }}
      className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white/95 px-3 py-2 shadow-sm"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-600">
        <motion.path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: delay + 0.15 }}
        />
      </svg>
      <span className="text-sm font-medium text-neutral-800">{text}</span>
    </motion.div>
  );

  return (
    <CardShell>
      <div className="absolute inset-0 flex flex-col justify-center gap-3 p-5">
        <Row text="Diet" d="M20 6 9 17l-5-5" delay={0.05} />
        <Row text="Lifestyle" d="M20 6 9 17l-5-5" delay={0.15} />
        <Row text="Supplements" d="M20 6 9 17l-5-5" delay={0.25} />
        <Row text="Rx" d="M20 6 9 17l-5-5" delay={0.35} />
      </div>
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   4) Unlimited concierge messaging
   - Unique: typing indicator → agent reply → user reply
------------------------------------------------------------------*/
function MiniConcierge() {
  const Bubble = ({
    me,
    children,
    delay,
  }: {
    me?: boolean;
    children: React.ReactNode;
    delay: number;
  }) => (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ ...soft, delay }}
      className={`max-w-[72%] rounded-2xl px-3 py-2 text-sm shadow-sm ${me ? 'ml-auto bg-neutral-900 text-white' : 'bg-white text-neutral-800 border border-neutral-200'
        }`}
    >
      {children}
    </motion.div>
  );

  return (
    <CardShell>
      <div className="absolute inset-0 flex flex-col justify-end gap-2 p-4">
        {/* typing dots */}
        <motion.div
          className="mb-1 inline-flex w-16 items-center justify-center gap-1 self-start rounded-full border border-neutral-200 bg-white/90 px-2 py-1"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
        >
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-neutral-500"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 0.9, repeat: 2, delay: i * 0.12 }}
            />
          ))}
        </motion.div>

        <Bubble delay={0.45}>Is magnesium OK with vitamin D?</Bubble>
        <Bubble me delay={0.8}>Yes — and I’ll add a reminder to your plan.</Bubble>
        <Bubble delay={1.1}>Perfect, thanks!</Bubble>
      </div>
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   5) Add-on testing anytime
   - Unique: auto-scrolling carousel + card tilt on hover
------------------------------------------------------------------*/
function MiniAddons() {
  const kits = ['Gut Microbiome', 'Toxins', 'Cancer Screens', 'Sleep', 'Hormones'];
  return (
    <CardShell>
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute left-0 top-1/2 -translate-y-1/2 flex gap-4 px-4"
          animate={{ x: ['0%', '-55%'] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
        >
          {[...kits, ...kits].map((k, i) => (
            <motion.div
              key={i}
              whileHover={{ rotate: -1.5, y: -4 }}
              className="shrink-0 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-xs font-medium shadow-sm"
            >
              {k}
            </motion.div>
          ))}
        </motion.div>
      </div>
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   6) Access to Overdrive Clinic
   - Unique: liquid fill animation + glow pulse
------------------------------------------------------------------*/
function MiniClinic() {
  const Bottle = ({ delay, height }: { delay: number; height: number }) => (
    <div className="relative h-20 w-10">
      <div className="absolute inset-0 rounded-md border border-amber-600/50 bg-amber-200/60 shadow-[0_8px_30px_rgba(245,158,11,0.25)]" />
      <motion.div
        className="absolute bottom-0 left-0 right-0 rounded-b-md bg-amber-500/80"
        initial={{ height: 0 }}
        whileInView={{ height }}
        viewport={{ once: true }}
        transition={{ duration: 1, delay, ease: 'easeOut' }}
      />
      <motion.div
        className="absolute inset-0 rounded-md"
        animate={{ boxShadow: ['0 0 0 rgba(245,158,11,0)', '0 0 24px rgba(245,158,11,0.35)', '0 0 0 rgba(245,158,11,0)'] }}
        transition={{ duration: 2.4, repeat: Infinity, delay }}
      />
    </div>
  );

  return (
    <CardShell>
      <div className="absolute inset-0 grid place-content-center">
        <div className="flex items-end gap-5">
          <Bottle delay={0.1} height={40} />
          <Bottle delay={0.35} height={60} />
          <Bottle delay={0.6} height={52} />
        </div>
      </div>
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   Data + Renderer
------------------------------------------------------------------*/
type CardData = {
  title: string;
  sub: string;
  Mini: React.ComponentType;
};

const CARDS: CardData[] = [
  { title: 'All your data in one place', sub: '100+ labs, your biological age & health report.', Mini: MiniData },
  { title: 'Upload past lab data', sub: 'Visualize past Quest or Labcorp results.', Mini: MiniUpload },
  { title: 'Your personalized health plan', sub: 'Lifestyle, diet, supplement & Rx recommendations.', Mini: MiniPlan },
  { title: 'Unlimited concierge messaging', sub: 'Ask questions and get answers from our care team.', Mini: MiniConcierge },
  { title: 'Add-on testing anytime', sub: 'Advanced gut microbiome, toxins & cancer screens.', Mini: MiniAddons },
  { title: 'Access to Overdrive Clinic', sub: 'Curated solutions available after medical evaluation.', Mini: MiniClinic },
];

/* ----------------------------------------------------------------
   Section
------------------------------------------------------------------*/
export default function MembershipSticky() {
  return (
    <section className="bg-white text-neutral-900 pt-60">
      <div className="container-soft">
        <div className="relative grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
          {/* LEFT (sticky) */}
          <div className="lg:col-span-4">
            <div className="sticky top-24">
              <h2 className="text-3xl md:text-4xl leading-tight">What’s included in your membership</h2>
              <p className="mt-3 max-w-md text-neutral-600">
                Overdrive is more than a blood test. Access an ecosystem of diagnostics and
                doctor-trusted solutions personalized to you.
              </p>
              <a
                href="#join"
                className="mt-6 inline-flex bg-accent hover:bg-accent2 items-center gap-2 rounded-full px-6 py-4 text-white"
              >
                Join Today <span aria-hidden>›</span>
              </a>
            </div>
          </div>

          {/* RIGHT (scrolling cards) */}
          <div className="lg:col-span-8">
            <div className="grid gap-6 sm:grid-cols-2 lg:gap-8">
              {CARDS.map((c, i) => (
                <FeatureFrame key={c.title} i={i} title={c.title} sub={c.sub}>
                  <c.Mini />
                </FeatureFrame>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
