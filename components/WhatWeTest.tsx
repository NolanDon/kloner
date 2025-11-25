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
import { useUrlOverlay } from './UrlOverlayProvider';

type Category = { label: string; icon: React.ComponentType<any> };

const categories: Category[] = [
  { label: 'DOM & Styles Capture', icon: HeartPulse },
  { label: 'Assets & Fonts', icon: Droplets },
  { label: 'Routing & Links', icon: Activity },
  { label: 'Forms & Scripts', icon: Flame },
  { label: 'Generative Images & Media', icon: Zap },
  { label: 'Performance Passes', icon: Scale },
  { label: 'Meta & SEO', icon: Beaker },
  { label: 'Framework Convert', icon: FlaskConical },
  { label: 'Copy Editing', icon: Apple },
  { label: 'Analytics Hooks', icon: Thermometer },
  { label: 'Auth Stubs', icon: Shield },
  { label: 'Edge-ready Output', icon: Dna },
];

const items = [
  'Performance focused architecture',
  'Vercel deployments',
  'Default Security Implementations',
  'HTML snapshot with modern CSS',
  'Route mapping',
  'Generative Designs',
  'Link rewriting',
  'Form detection with warnings',
  'Script isolation and toggles',
  'Font discovery and subsetting',
  'Title/description extraction',
  'Open Graph & Twitter tags',
  'Robots & sitemap hints',
  'HTML project scaffold',
  'Layout and partials',
  'Reusable components pass',
  'Lighthouse sanity check',
  'Type-safe config',
  'Inline AI Code Helpers',
  'Responsive image generation',
  'Team Collaberation',
  'URL to Mobile Application Generation',
  'Automated AI Developers',
  'AWS / Netlify Deployments'
];

const advancedSet = new Set([
  'Vercel deployments',
]);

const comingSoonSet = new Set([
  'Responsive image generation',
  'Team Collaberation',
  'Inline AI Code Helpers',
  'URL to Mobile Application Generation',
  'NextJS project scaffold',
  'Automated AI Developers',
  'AWS / Netlify Deployments',
  'Lighthouse sanity check',
  'Type-safe config',
]);


const softPalettes = [
  { bgFrom: 'from-rose-50', bgTo: 'to-rose-100', ring: 'ring-rose-200/80', icon: 'text-rose-600' },
  { bgFrom: 'from-sky-50', bgTo: 'to-sky-100', ring: 'ring-sky-200/80', icon: 'text-sky-700' },
  { bgFrom: 'from-emerald-50', bgTo: 'to-emerald-100', ring: 'ring-emerald-200/80', icon: 'text-emerald-700' },
  { bgFrom: 'from-amber-50', bgTo: 'to-amber-100', ring: 'ring-amber-200/80', icon: 'text-amber-700' },
  { bgFrom: 'from-indigo-50', bgTo: 'to-indigo-100', ring: 'ring-indigo-200/80', icon: 'text-indigo-700' },
  { bgFrom: 'from-teal-50', bgTo: 'to-teal-100', ring: 'ring-teal-200/80', icon: 'text-teal-700' },
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
  const ringClass = active ? `ring-neutral-300` : pal.ring;
  const iconClass = active ? `text-neutral-800` : pal.icon;

  return (
    <span
      className={[
        'inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 shadow-sm',
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
  const { openUrlOverlay } = useUrlOverlay();

  const activeIndex = 0;

  return (
    <section
      id="test"
      className="z-40 relative bg-white text-neutral-800 rounded-b-[3rem] overflow-hidden py-40"
    >
      <div className="flex items-center justify-center">
        <a
          onClick={openUrlOverlay}
          className="bg-accent hover:bg-accent2 items-center gap-2 rounded-full px-6 py-4 text-white"
        >
          Start your project <span aria-hidden>›</span>

        </a>
      </div>
      <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-px w-[72%] md:w-[62%] bg-neutral-200 rounded-full" />

      <div className="container-soft py-14 md:py-20">
        <SectionReveal>
          <h2 className="text-5xl md:text-6xl tracking-tight">What we capture for you</h2>
          <p className="mt-3 mb-10 max-w-2xl text-lg text-neutral-600">
            Everything needed to turn a live site into a clean project you control.
          </p>
        </SectionReveal>

        <div className="grid gap-10 md:grid-cols-4">
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

          <div className="space-y-4">
            {categories.slice(6).map((c, i) => {
              const Icon = c.icon;
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

          <div className="md:col-span-2">
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-y-4 md:gap-x-12">
              {items.map((name) => {
                const isAdv = advancedSet.has(name);
                const isBeta = comingSoonSet.has(name);
                return (
                  <li key={name} className="flex text-xs items-start justify-between">
                    <span className="text-neutral-800">{name}</span>
                    {isAdv && (
                      <span className="ml-3 shrink-0 rounded-full bg-amber-100 ring-amber-200/80 text-amber-700 px-2.5 py-1 text-[11px] leading-none">
                        Pro
                      </span>
                    )}
                    {isBeta && (
                      <span className="ml-3 shrink-0 rounded-full  px-2.5 py-1 text-[11px] leading-none bg-emerald-50 ring-emerald-200/80 text-emerald-700">
                        Coming Soon
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
