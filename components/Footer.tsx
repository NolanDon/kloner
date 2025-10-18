// components/Footer.tsx
'use client';

import { useEffect, useId, useState } from 'react';

export default function Footer() {
  return (
    <footer className="relative bg-white text-neutral-900 overflow-visible">
      <div className="container-soft pt-10 md:pt-16 pb-8">
        {/* Big wordmark (no background/video) */}
        <div className="relative mx-[-4vw] md:mx-[-6vw]">
          <h2
            className="
              select-none leading-[0.9] pt-1 md:pt-3 font-black tracking-tight
              text-[clamp(3.75rem,12vw,22rem)] md:text-[clamp(5.5rem,14vw,22rem)]
              text-transparent bg-clip-text
            "
            style={{
              backgroundImage:
                'linear-gradient(90deg, #7a2e18 0%, #d44b1c 30%, #ff6f3d 60%, #ffb36b 100%)',
            }}
          >
            superpower
          </h2>
        </div>

        {/* Link columns */}
        <div className="mt-6 md:mt-8 grid gap-4 md:gap-10 md:grid-cols-5 text-sm">
          <Column
            title="Superpower"
            items={['How it Works', 'What’s Included', 'Membership Login', 'Gift Superpower']}
          />
          <Column
            title="Company"
            items={['Our Why', 'Join the Team', 'Superpower Labs', 'Contact Us', 'FAQs']}
            noteIndex={1}
            note="We’re hiring!"
          />
          <Column
            title="Compare"
            items={['Function Health', 'Mito Health', 'Marek Health', 'InsideTracker', 'Others']}
          />
          <Column
            title="Library"
            items={[
              'Immune System Biomarker',
              'Energy Biomarkers',
              'Kidney Health Biomarkers',
              'Liver Health Biomarkers',
              'Body Composition Biomarkers',
            ]}
          />
          <Column
            title="Partnerships"
            items={['For Creators', 'For Partners', 'For Business']}
            extraGroup={{ heading: 'Connect', items: ['X/Twitter', 'Instagram', 'LinkedIn'] }}
          />
        </div>

        <div className="mt-8 md:mt-10 text-xs text-neutral-500">
          © 2025 Superpower Health, Inc. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

/* ---------- Pieces ---------- */

function Column({
  title,
  items,
  noteIndex,
  note,
  extraGroup,
}: {
  title: string;
  items: string[];
  noteIndex?: number;
  note?: string;
  extraGroup?: { heading: string; items: string[] };
}) {
  const sectionId = useId();

  // Mobile accordion state; forced open on md+.
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 768px)');
    const apply = () => setIsDesktop(!!mq?.matches);
    apply();
    mq?.addEventListener?.('change', apply);
    return () => mq?.removeEventListener?.('change', apply);
  }, []);

  useEffect(() => {
    if (isDesktop) setOpen(true);
  }, [isDesktop]);

  return (
    <div className="border-b border-neutral-200/70 md:border-none">
      {/* Header row: acts as accordion trigger on mobile, static label on desktop */}
      <button
        type="button"
        className="
          w-full md:w-auto flex items-center justify-between gap-3
          py-3 md:py-0
          font-semibold text-neutral-800 md:text-neutral-700
          md:mb-3
        "
        aria-controls={sectionId}
        aria-expanded={open}
        onClick={() => !isDesktop && setOpen((v) => !v)}
      >
        <span className="text-base md:text-[inherit]">{title}</span>
        {/* Caret only on mobile */}
        <svg
          viewBox="0 0 24 24"
          className={`h-5 w-5 md:hidden transition-transform ${open ? 'rotate-180' : 'rotate-0'
            }`}
          stroke="currentColor"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Collapsible content on mobile; always open on desktop */}
      <div
        id={sectionId}
        className={`
          overflow-hidden transition-all
          md:overflow-visible
          ${open ? 'max-h-[1000px] opacity-100 pb-4 md:pb-0' : 'max-h-0 opacity-90 md:max-h-none'}
        `}
      >
        <ul className="space-y-3 pb-1 md:pb-0">
          {items.map((label, i) => (
            <li key={label} className="flex items-start gap-2">
              <Chevron />
              <a
                href="#"
                className="
                  hover:text-neutral-900 text-neutral-800
                  text-[15px] md:text-[inherit]
                  md:whitespace-nowrap
                "
              >
                {label}
              </a>
              {noteIndex === i && note ? (
                <span className="ml-2 text-[11px] md:text-[11px] text-[#ff6f3d]">[{note}]</span>
              ) : null}
            </li>
          ))}
        </ul>

        {extraGroup ? (
          <div className="pt-4 md:pt-7">
            <div className="mb-3 font-semibold text-neutral-800 md:text-neutral-700">
              {extraGroup.heading}
            </div>
            <ul className="space-y-3">
              {extraGroup.items.map((label) => (
                <li key={label} className="flex items-start gap-2">
                  <Chevron />
                  <a
                    href="#"
                    className="hover:text-neutral-900 text-neutral-800 text-[15px] md:text-[inherit]"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-[2px] h-4 w-4 text-[#ff6f3d] shrink-0"
      stroke="currentColor"
      fill="none"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 12h12" />
      <path d="M12 6l6 6-6 6" />
    </svg>
  );
}
