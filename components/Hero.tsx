"use client";
import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section className="relative h-[88vh] min-h-[560px] flex items-center bg-white text-black">
      {/* Rounded video frame */}
      <div className="absolute inset-0 px-5 py-5">
        <div className="relative w-full h-full rounded-3xl overflow-hidden ring-1 ring-black/10 shadow-2xl">
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
          className="max-w-2xl mx-auto text-center"
        >
          <h1 className="text-5xl md:text-6xl font-extrabold text-white leading-tight">
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
