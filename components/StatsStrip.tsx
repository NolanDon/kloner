// components/StatsStrip.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import SectionReveal from "./SectionReveal";

type Stat = {
  value: string;
  label: string;
  sub: string;
};

function StatCard({ stat, delay = 0 }: { stat: Stat; delay?: number }) {
  const [display, setDisplay] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Parse "92%", "70%", "4×" -> numeric part + suffix
  const raw = stat.value;
  const match = raw.match(/^(\d+)(.*)$/);
  const target = match ? Number(match[1]) : 0;
  const suffix = match ? match[2] : "";

  // Visibility observer
  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.4 }
    );

    observer.observe(ref.current);

    return () => observer.disconnect();
  }, []);

  // Count-up once when visible
  useEffect(() => {
    if (!isVisible || hasAnimated || !target) return;

    let frame: number;
    const duration = 1200; // ms
    const delayMs = (delay || 0) * 1000;
    const startTime = performance.now() + delayMs;

    const tick = (now: number) => {
      if (now < startTime) {
        frame = requestAnimationFrame(tick);
        return;
      }

      const progress = Math.min((now - startTime) / duration, 1);
      const next = Math.round(target * progress);
      setDisplay(next);

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setHasAnimated(true);
      }
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [target, delay, isVisible, hasAnimated]);

  return (
    <div ref={ref} className="stats-strip-card group relative isolate min-h-[270px] overflow-visible rounded-[1.6rem] border px-7 pb-8 pt-28 transition duration-300 hover:-translate-y-1 md:px-8">
      <div className="pointer-events-none absolute left-0 top-0 z-0 -translate-x-[20%] -translate-y-[28%] select-none text-[10rem] font-black leading-none tracking-[-0.1em] text-[#9ca3af]/[0.34] drop-shadow-[0_5px_0_rgba(15,23,42,0.08)] transition-transform duration-300 group-hover:-translate-y-[32%] md:text-[11rem]" aria-hidden="true">
        {display}{suffix}
      </div>
      <div className="relative z-10 text-sm font-medium uppercase tracking-[0.16em] text-neutral-600">{stat.label}</div>
      <div className="relative z-10 mt-2 max-w-[23rem] text-lg font-semibold leading-relaxed text-neutral-900">{stat.sub}</div>
      <div className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" aria-hidden="true" />
    </div>
  );
}

export default function StatsStrip() {
  const stats: Stat[] = [
    { value: "1", label: "Start from a URL", sub: "Use a supported public website as your starting point" },
    { value: "2", label: "Edit the result", sub: "Refine the generated website preview with AI" },
    { value: "3", label: "Deploy when ready", sub: "Publish your finished website through the available integrations" },
  ];

  return (
    <section className="section bg-white py-20 md:py-80" id="stories">
      <div className="container-soft">
        <SectionReveal>
          <blockquote className="text-center text-2xl md:text-3xl font-semibold max-w-4xl mx-auto text-black/70">
            “I pasted a URL, cloned the layout, and had my own version live the same day. Zero setup. Instant preview. One click deployment.”
          </blockquote>
          <div className="mt-5 flex items-center justify-center gap-1.5" role="img" aria-label="5 out of 5 stars">
            <span className="text-2xl leading-none tracking-[0.12em] text-[#D6A94F] drop-shadow-[0_1px_0_rgba(110,66,24,0.45)]" aria-hidden="true">★★★★★</span>
            <span className="text-2xl font-semibold leading-none text-[#D6A94F]">5/5</span>
          </div>
        </SectionReveal>
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          {stats.map((s, i) => (
            <SectionReveal key={i} delay={i * 0.05}>
              <StatCard stat={s} delay={i * 0.05} />
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
