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
   1) Clean capture  → placeholder image
------------------------------------------------------------------*/
function MiniData() {
  return (
    <CardShell>
      <img
        src="/images/included-section/5.jpg"
        alt="Clean capture preview"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   2) (Unused in CARDS) Import + map routes — left intact
------------------------------------------------------------------*/
function MiniUpload() {
  return (
    <CardShell>
      <img
        src="/images/included-section/2.jpg"
        alt="Import and route mapping"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   3) Export-ready  → placeholder image
------------------------------------------------------------------*/
function MiniPlan() {
  return (
    <CardShell>
      <img
        src="/images/included-section/1.jpg"
        alt="Export-ready checklist"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   4) Live preview edits  → placeholder image
------------------------------------------------------------------*/
function MiniConcierge() {
  return (
    <CardShell>
      <img
        src="/images/included-section/4.jpg"
        alt="Live preview edits"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   5) Add-ons  → placeholder image
------------------------------------------------------------------*/
function MiniAddons() {
  return (
    <CardShell>
      <img
        src="/images/included-section/3.jpg"
        alt="Add-ons marketplace"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </CardShell>
  );
}

/* ----------------------------------------------------------------
   6) One-click deploy  → placeholder image
------------------------------------------------------------------*/
function MiniClinic() {
  return (
    <CardShell>
      <img
        src="/images/included-section/6.jpg"
        alt="One-click deploy providers"
        className="absolute inset-0 h-full w-full object-cover"
      />
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
  { title: 'Clean dashboard', sub: 'All your URLs organized in one simple view.', Mini: MiniPlan },
  { title: 'Accuracy', sub: 'Pixel-perfect captures, ready to ship for any business type.', Mini: MiniData },
  { title: 'Capture Engine', sub: 'Built by strong engineers with the power to capture long, multi-section pages.', Mini: MiniConcierge },
  { title: 'Quick actions', sub: 'Jump straight to deployment or customization with instant tools.', Mini: MiniAddons },
  { title: 'Customization', sub: 'Full creative control at your fingertips.', Mini: MiniClinic },
  { title: 'Fail safety', sub: 'Rescan anytime until the result feels right.', Mini: MiniUpload },
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
              <h2 className="text-3xl md:text-4xl leading-tight">What’s included</h2>
              <p className="mt-3 max-w-md text-neutral-600">
                Capture any public site, edit in a live preview, export a clean Next.js project, and deploy with one click.
              </p>
              <a
                href="#join"
                className="mt-6 inline-flex bg-accent hover:bg-accent2 items-center gap-2 rounded-full px-6 py-4 text-white"
              >
                Start free preview <span aria-hidden>›</span>
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
