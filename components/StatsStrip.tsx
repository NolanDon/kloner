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
    <div ref={ref} className="card p-6">
      <div className="text-5xl text-black/80 font-bold">
        {display}
        {suffix}
      </div>
      <div className="mt-3 text-black/70">{stat.label}</div>
      <div className="text-black/90 font-medium">{stat.sub}</div>
    </div>
  );
}

export default function StatsStrip() {
  const stats: Stat[] = [
    { value: "92%", label: "launch faster", sub: "from paste to preview under 120s" },
    { value: "70%", label: "ship cleaner code", sub: "less manual cleanup post-clone" },
    { value: "4×", label: "faster iterations", sub: "edit, preview, deploy on repeat" },
  ];

  return (
    <section className="section bg-white" id="stories">
      <div className="container-soft">
        <SectionReveal>
          <blockquote className="text-center text-2xl md:text-3xl font-semibold max-w-4xl mx-auto text-black/70">
            “I pasted a URL and had a deployable project before my coffee cooled. Zero setup. Instant preview. One click to Vercel.”
          </blockquote>
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
