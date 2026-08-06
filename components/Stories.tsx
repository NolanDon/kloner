// components/Stories.tsx
'use client';

import Image from 'next/image';
import SectionReveal from './SectionReveal';
import { BadgeDollarSign, Clock3, UserRound, UsersRound } from 'lucide-react';
import logo from "@/public/images/orange_logo.png";

type Metric = {
  value: string;
  title: string;
  metric: string;
  text: string;
  roles?: string[];
};

const metrics: Metric[] = [
  {
    value: '01',
    title: 'Save time',
    metric: 'avg 40 hrs',
    text: 'Start from templates instead of blank pages and cut the heavy setup work.',
  },
  {
    value: '02',
    title: 'Save money',
    metric: 'avg $1000',
    text: 'Ship polished sites without paying premium platform fees for every project.',
  },
  {
    value: '03',
    title: 'Boost your output',
    metric: '',
    text: 'Handle five roles from one place, without extra overhead.',
    roles: ['Designer', 'Marketer', 'Frontend dev', 'Backend dev', 'Product dev'],
  },
];

function CardIcon({ kind }: { kind: 'time' | 'money' | 'output' }) {
  const iconClassName = 'h-4 w-4';
  if (kind === 'time') return <Clock3 className={iconClassName} />;
  if (kind === 'money') return <BadgeDollarSign className={iconClassName} />;
  return <UsersRound className={iconClassName} />;
}

function TeamMap({ roles }: { roles: string[] }) {
  return (
    <div className="mt-4 flex w-full items-center justify-start gap-2.5 overflow-hidden whitespace-nowrap">
      <div className="flex shrink-0 items-center gap-2 text-[11px] font-semibold text-[rgba(255,141,33,1)] sm:text-[12px]">
        <UserRound className="h-4 w-4 shrink-0 text-[rgba(255,141,33,1)] sm:h-5 sm:w-5" />
        <span className="text-[14px]">1x Kloner User</span>
      </div>

      <span className="shrink-0 text-[11px] font-semibold text-neutral-500 sm:text-[12px]">
        =
      </span>

      <div className="flex items-center -space-x-1.5 sm:-space-x-2">
        {roles.map((role, index) => (
          <span
            key={role}
            title={role}
            className="relative grid h-4 w-4 shrink-0 place-items-center text-neutral-500 sm:h-5 sm:w-5"
            style={{ zIndex: roles.length - index }}
          >
            <UserRound className="h-4 w-4 sm:h-5 sm:w-5" />
          </span>
        ))}
      </div>
    </div>
  );
}

function MetricText({ metric }: { metric: string }) {
  const isAvg = metric.toLowerCase().startsWith('avg ');
  if (!isAvg) return <span>{metric}</span>;

  const rest = metric.slice(4);
  return (
    <span>
      <span className="text-[0.3em] font-semibold uppercase tracking-[0.22em] text-[rgba(255,141,33,1)] align-baseline mr-1.5">
        avg
      </span>
      <span>{rest}</span>
    </span>
  );
}

function MetricCard({ r, i }: { r: Metric; i: number }) {
  const kind = r.value === '01' ? 'time' : r.value === '02' ? 'money' : 'output';
  const metricSizeClass = 'text-[1.9rem] leading-[1.05] sm:text-[2.7rem]';

  return (
    <SectionReveal delay={i * 0.04}>
      <div className="flex h-full w-full max-w-[520px] flex-col justify-start space-y-5 rounded-2xl border border-black/10 bg-white p-5 shadow-md min-h-[200px] md:justify-between md:min-h-[200px]">
        <div className="flex items-center gap-2 mt-1 min-w-0">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(255,141,33,0.18)] bg-[rgba(255,141,33,0.08)] text-[rgba(255,141,33,1)]">
            <CardIcon kind={kind} />
          </span>
          <h3 className="min-w-0 text-left text-xl leading-tight text-black/80 sm:text-2xl md:text-[28px]">
            {r.title}
          </h3>
        </div>

        <div className="space-y-5 pt-1">
          <div className={`${metricSizeClass} max-w-full break-words font-semibold tracking-tight text-black/80`}>
            <MetricText metric={r.metric} />
            {r.roles ? <TeamMap roles={r.roles} /> : null}
          </div>
          <p className="text-black/70 text-sm leading-relaxed">
            {r.text}
          </p>
        </div>
      </div>
    </SectionReveal>
  );
}

export default function Stories() {
  return (
    <section className="section bg-white mt-20 mb-20 text-black" id="reviews">
      <div className="container-soft">
        <div className="mb-8 flex items-center justify-between gap-4 sm:mb-6">
          <h2 className="mt-1 flex flex-wrap items-center justify-start gap-x-3 gap-y-1 text-base text-neutral-600 sm:text-lg">
            <span className="block text-[16px] uppercase tracking-[0.1em] text-neutral-500">
              Join
              <span className="mx-1 text-[rgba(255,141,33,1)]">5,000+</span>
              Kloner members shipping sites in minutes
            </span>
            <span className="relative inline-block h-[72px] w-[72px] sm:h-[92px] sm:w-[92px]">
              <Image
                src={logo}
                alt="Kloner logo"
                fill
                sizes="(min-width: 640px) 92px, 72px"
                className="object-contain"
              />
            </span>
          </h2>

          {/* <a
            href="#all-reviews"
            className="hidden md:inline-flex items-center rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/70 hover:text-black hover:shadow-sm"
          >
            See more stories
          </a> */}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3 md:gap-6 md:[overflow:visible] items-stretch">
          <div className="col-span-1 -mx-4 md:mx-0 md:col-span-3">
            <div className="flex items-stretch gap-3 overflow-x-auto snap-x snap-mandatory px-4 md:grid md:grid-cols-3 md:gap-6 md:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {metrics.map((r, i) => (
                <div
                  key={r.value}
                  className="snap-center shrink-0 basis-[78%] sm:basis-[60%] md:basis-auto md:h-full md:shrink md:snap-none"
                >
                  <MetricCard r={r} i={i} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 md:hidden">
          {/* <a
            href="#all-reviews"
            className="inline-flex items-center rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/70 hover:text-black hover:shadow-sm"
          >
            See more stories
          </a> */}
        </div>
      </div>
    </section>
  );
}
