"use client";
import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section
      // Fill the available viewport, but not smaller than 560px
      className="relative flex items-center bg-white text-black"
      style={{
        height: "calc(100dvh - var(--header-h, 0px))",
        minHeight: 560,
        // Responsive gutter the video will respect (and safe-areas on iOS)
        // 16px → 40px depending on viewport width
        // You can tweak the clamp values to taste.
        // We also add safe-area insets so it never sits under the notch.
        ["--hero-gutter" as any]:
          "max(env(safe-area-inset-left), clamp(16px, 3vw, 10px))",
      }}
    >
      {/* Video frame obeys the gutter, so it's never truly full-bleed */}
      <div className="absolute inset-0 p-[var(--hero-gutter)]">
        <div className="relative h-full w-full overflow-hidden rounded-3xl ring-1 ring-black/10 shadow-2xl">
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src="/hero.webm"
            autoPlay
            loop
            muted
            playsInline
            poster="/images/hero-poster.jpg"
          />
          {/* subtle legibility fade; remove if you want totally clean */}
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
          <h1 className="text-5xl md:text-6xl font-extrabold text-white/90 leading-tight">
            Unlock your new <br />
            <span className="text-white/80">health intelligence</span>
          </h1>
          <p className="mt-5 text-white/80">
            100+ lab tests. Every year. Detect early signs of 1,000+ conditions. All for only $17/month.
          </p>

          {/* CTA */}
          <div className="mt-8 flex flex-col items-center gap-2">
            <a
              href="#cta"
              className="mt-10 mb-2 inline-flex items-center gap-2 rounded-full px-7 py-4 bg-accent hover:bg-accent2 transition text-white"
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
