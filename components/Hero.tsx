"use client";
import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section
      className="relative flex items-center bg-white text-black"
      style={{
        height: "calc(100dvh - var(--header-h, 0px))",
        minHeight: 560,
        ["--hero-gutter" as any]:
          "max(env(safe-area-inset-left), clamp(12px, 4vw, 10px))", // a touch tighter on small screens
      }}
    >
      {/* Video frame */}
      <div className="absolute inset-0 p-[var(--hero-gutter)]">
        <div className="relative h-full w-full overflow-hidden rounded-2xl md:rounded-3xl ring-1 ring-black/10 shadow-2xl">
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src="/hero.webm"
            autoPlay
            loop
            muted
            playsInline
            poster="/images/hero-poster.jpg"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-white/10 via-transparent to-transparent" />
        </div>
      </div>

      {/* Copy */}
      <div className="container-soft relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="mx-auto max-w-2xl text-center"
        >
          <h1 className="pt-20 leading-tight font-semibold text-white/90 text-[10vw] sm:text-5xl md:text-7xl">
            Unlock your new <br />
            <span className="text-white/80">health intelligence</span>
          </h1>

          <p className="mt-4 md:mt-5 text-white/80 text-base sm:text-lg px-2">
            100+ lab tests. Every year. Detect early signs of 1,000+ conditions. <br />All for only $17/month.
          </p>

          {/* CTA */}
          <div className="mt-6 md:mt-8 flex flex-col items-center gap-2">
            <a
              href="#cta"
              className="mt-6 md:mt-10 mb-1 inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 md:px-7 md:py-4 bg-accent hover:bg-accent2 transition text-white w-full sm:w-auto"
            >
              Join Today <span aria-hidden>›</span>
            </a>
            <span className="text-white text-sm">HSA/FSA eligible</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
