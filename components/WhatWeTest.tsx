// components/WhatWeTest.tsx
'use client';

import SectionReveal from './SectionReveal';
import {
  HeartPulse,
  Droplets,
  Activity,
  Flame,
  Zap,
  Scale,
  Beaker,
  FlaskConical,
  Apple,
  Thermometer,
  Shield,
  Dna,
} from 'lucide-react';
import React from 'react';

type Category = { label: string; icon: React.ComponentType<any> };

const categories: Category[] = [
  { label: 'Heart & Vascular Health', icon: HeartPulse },
  { label: 'Kidney Health', icon: Droplets },
  { label: 'Metabolic Health', icon: Activity },
  { label: 'Inflammation', icon: Flame },
  { label: 'Energy', icon: Zap },
  { label: 'Body Composition', icon: Scale },
  { label: 'Liver Health', icon: Beaker },
  { label: 'Sex Hormones', icon: FlaskConical },
  { label: 'Nutrients', icon: Apple },
  { label: 'Thyroid Health', icon: Thermometer },
  { label: 'Immune System', icon: Shield },
  { label: 'DNA Health', icon: Dna },
];

// biomarker columns (right side)
const biomarkers = [
  'Lp(a)',
  'ADMA',
  'Lipoprotein fractionation',
  'Uric Acid / HDL-C',
  'TG / ApoB',
  'Atherogenic Coefficient',
  'Triglyceride / HDL Cholesterol (Molar Ratio)',
  'VLDL Size',
  'Large VLDL P',
  'HDL Size',
  'Small LDL P',
  'LDL P',
  'SDMA',
  'Cystatin C (with eGFR)',
  'Non-HDL Cholesterol / Apolipoprotein B',
  'LDL-C / ApoB',
  'Neutrophil-to-HDL Cholesterol Ratio (NHR)',
  'Atherogenic Index of Plasma (AIP)',
  'Non-HDL Cholesterol / Total Cholesterol',
  'LDL Cholesterol / Total Cholesterol (Mass Ratio)',
  'Large HDL P',
  'LDL Size',
  'HDL P',
  'Lipoprotein (a)',
];

const advancedSet = new Set([
  'VLDL Size',
  'Large VLDL P',
  'HDL Size',
  'Small LDL P',
  'LDL P',
  'Large HDL P',
  'LDL Size',
  'HDL P',
  'Lipoprotein (a)',
]);

/**
 * Soft, subtle palettes (from -> to) with matching ring/icon.
 * Keep these light so the UI stays clinical/clean.
 */
const softPalettes = [
  {
    bgFrom: 'from-rose-50',
    bgTo: 'to-rose-100',
    ring: 'ring-rose-200/80',
    icon: 'text-rose-600',
  },
  {
    bgFrom: 'from-sky-50',
    bgTo: 'to-sky-100',
    ring: 'ring-sky-200/80',
    icon: 'text-sky-700',
  },
  {
    bgFrom: 'from-emerald-50',
    bgTo: 'to-emerald-100',
    ring: 'ring-emerald-200/80',
    icon: 'text-emerald-700',
  },
  {
    bgFrom: 'from-amber-50',
    bgTo: 'to-amber-100',
    ring: 'ring-amber-200/80',
    icon: 'text-amber-700',
  },
  {
    bgFrom: 'from-indigo-50',
    bgTo: 'to-indigo-100',
    ring: 'ring-indigo-200/80',
    icon: 'text-indigo-700',
  },
  {
    bgFrom: 'from-teal-50',
    bgTo: 'to-teal-100',
    ring: 'ring-teal-200/80',
    icon: 'text-teal-700',
  },
] as const;

function pickPalette(idx: number) {
  return softPalettes[idx % softPalettes.length];
}

function IconPill({
  Icon,
  active = false,
  paletteIdx = 0,
}: {
  Icon: React.ComponentType<any>;
  active?: boolean;
  paletteIdx?: number;
}) {
  const pal = pickPalette(paletteIdx);

  // Active row = slightly darker icon + stronger ring
  const ringClass = active ? `ring-neutral-300` : pal.ring;
  const iconClass = active ? `text-neutral-900` : pal.icon;

  return (
    <span
      className={[
        'inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 shadow-sm',
        // subtle diagonal gradient shader
        'bg-gradient-to-br',
        pal.bgFrom,
        pal.bgTo,
        ringClass,
      ].join(' ')}
    >
      <Icon className={`h-5 w-5 ${iconClass}`} strokeWidth={2} />
    </span>
  );
}

export default function WhatWeTest() {
  const activeIndex = 0; // visually emphasize the first row like the reference

  return (
    <section id="test" className="mt-40 mb-20 relative bg-white text-neutral-900">
      {/* centered, non–full-width top rule */}
      <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-px w-[72%] md:w-[62%] bg-neutral-200 rounded-full" />

      <div className="container-soft py-14 md:py-20">
        <SectionReveal>
          <h2 className="text-5xl md:text-6xl tracking-tight">See everything we test</h2>
          <p className="mt-3 mb-10 max-w-2xl text-lg text-neutral-600">
            The following 100+ biomarkers are included with your annual Overdrive membership.
          </p>
        </SectionReveal>

        {/* 4 columns overall: two for categories, two for biomarkers */}
        <div className="grid gap-10 md:grid-cols-4">
          {/* Left column A */}
          <div className="space-y-4">
            {categories.slice(0, 6).map((c, i) => {
              const Icon = c.icon;
              const active = i === activeIndex;
              return (
                <SectionReveal key={c.label} delay={i * 0.025}>
                  <div className={`flex items-center gap-3 ${active ? 'text-neutral-900' : 'text-neutral-600'}`}>
                    <IconPill Icon={Icon} active={active} paletteIdx={i} />
                    <span className="text-base md:text-[17px] font-medium">{c.label}</span>
                  </div>
                </SectionReveal>
              );
            })}
          </div>

          {/* Left column B */}
          <div className="space-y-4">
            {categories.slice(6).map((c, i) => {
              const Icon = c.icon;
              // shift index so the second column continues the palette rotation
              const paletteIdx = i + 6;
              return (
                <SectionReveal key={c.label} delay={i * 0.025}>
                  <div className="flex items-center gap-3 text-neutral-600">
                    <IconPill Icon={Icon} paletteIdx={paletteIdx} />
                    <span className="text-base md:text-[17px] font-medium">{c.label}</span>
                  </div>
                </SectionReveal>
              );
            })}
          </div>

          {/* Right: biomarker list (no card box) */}
          <div className="md:col-span-2">
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-y-4 md:gap-x-12">
              {biomarkers.map((name) => {
                const isAdv = advancedSet.has(name);
                return (
                  <li key={name} className="flex text-xs items-start whitespace-nowrap justify-between">
                    <span className="text-neutral-800">{name}</span>
                    {isAdv && (
                      <span className="ml-3 shrink-0 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 py-1 text-[11px] leading-none text-neutral-600">
                        Advanced panel
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
