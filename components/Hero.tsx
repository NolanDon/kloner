// components/Hero.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Outfit } from "next/font/google";

const display = Outfit({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});

export default function Hero() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // Try to ensure autoplay on mobile
    const tryPlay = () => v.play().catch(() => { });
    // Wait for first decoded frame before showing
    const onLoaded = () => {
      // For Chrome mobile, ensure a painted frame before revealing
      if ("requestVideoFrameCallback" in v) {
        // @ts-ignore
        v.requestVideoFrameCallback?.(() => setReady(true));
      } else {
        requestAnimationFrame(() => setReady(true));
      }
      tryPlay();
    };

    const onError = () => {
      // Retry play (may switch to mp4 fallback)
      tryPlay();
    };

    const onVisibility = () => {
      if (document.hidden) v.pause();
      else tryPlay();
    };

    v.addEventListener("loadeddata", onLoaded, { once: true });
    v.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibility);

    // Kick off early in case loadeddata already fired
    tryPlay();

    return () => {
      v.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <section
      className="relative flex items-center bg-white text-black"
      style={{
        height: "calc(100dvh - var(--header-h, 0px))",
        minHeight: 560,
        ["--hero-gutter" as any]:
          "max(env(safe-area-inset-left), clamp(12px, 4vw, 10px))",
      }}
    >
      {/* Video frame */}
      <div className="absolute inset-0 p-[var(--hero-gutter)]">
        <div
          className="
            relative h-full w-full overflow-hidden rounded-2xl md:rounded-3xl
            ring-0 md:ring-1 md:ring-black/10          /* drop ring on mobile */
            shadow-lg md:shadow-2xl                    /* lighter shadow on mobile */
          "
        >
          <video
            ref={videoRef}
            className={`
              absolute inset-0 h-full w-full object-cover
              transform-gpu will-change-transform backface-hidden
              transition-opacity duration-300
              ${ready ? "opacity-100" : "opacity-0"}
            `}
            // Keep these first for mobile autoplay rules
            muted
            playsInline
            autoPlay
            loop
            preload="metadata"
            // poster="/images/hero-poster.png"
            disablePictureInPicture
            controlsList="nodownload noplaybackrate noremoteplayback"
            // Extra GPU/compositing hints
            style={{
              WebkitBackfaceVisibility: "hidden",
              backfaceVisibility: "hidden",
              contain: "layout paint size style",
              translate: "0 0 0",
            }}
          >
            <source src="/hero.webm" type="video/webm" />
          </video>

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
          <h1
            className={`${display.className} pt-20 leading-[0.96] font-semibold text-white
                        text-[clamp(2.6rem,8.2vw,5rem)] tracking-[-0.015em]`}
            style={{
              textWrap: "balance" as any,
              WebkitFontSmoothing: "antialiased",
              MozOsxFontSmoothing: "grayscale",
            }}
          >
            Unlock your new <br />
            <span className="text-white/85">health intelligence</span>
          </h1>

          <p className="mt-4 md:mt-5 text-white/80 text-base sm:text-lg px-2">
            100+ lab tests. Every year. Detect early signs of 1,000+ conditions. <br />
            All for only $17/month.
          </p>

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
