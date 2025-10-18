// components/Hero.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import Image from "next/image";
import { Outfit } from "next/font/google";

const display = Outfit({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});

export default function Hero() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);

  // Desktop video behavior only (mobile shows image via CSS)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const tryPlay = () => v.play().catch(() => { });
    const onLoaded = () => {
      // Ensure a painted frame before revealing
      // @ts-ignore
      if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback?.(() => setReady(true));
      else requestAnimationFrame(() => setReady(true));
      tryPlay();
    };
    const onError = () => { tryPlay(); };
    const onVisibility = () => { document.hidden ? v.pause() : tryPlay(); };

    v.addEventListener("loadeddata", onLoaded, { once: true });
    v.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibility);
    tryPlay();

    return () => {
      v.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Parallax for the mobile image
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [-20, 20]);

  return (
    <section
      ref={sectionRef}
      className="relative flex items-center bg-white text-black"
      style={{
        height: "calc(100dvh - var(--header-h, 0px))",
        minHeight: 560,
        ["--hero-gutter" as any]:
          "max(env(safe-area-inset-left), clamp(12px, 4vw, 10px))",
      }}
    >
      {/* Media frame */}
      <div className="absolute inset-0 p-[var(--hero-gutter)]">
        <div
          className="
            relative h-full w-full overflow-hidden rounded-2xl md:rounded-3xl
            ring-0 md:ring-1 md:ring-black/10
            shadow-lg md:shadow-2xl
            bg-neutral-900               /* prevents white flash under media */
          "
        >
          {/* MOBILE: parallax image */}
          <motion.div
            style={{ y }}
            className="absolute inset-0 block md:hidden"
          >
            <Image
              src="/images/hero-poster.png"   // ensure this exists at /public/images/hero-poster.png
              alt="Overdrive hero"
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
          </motion.div>

          {/* DESKTOP: video */}
          <video
            ref={videoRef}
            className={`
              absolute inset-0 h-full w-full object-cover
              transform-gpu will-change-transform backface-hidden
              transition-opacity duration-300
              hidden md:block
              ${ready ? "opacity-100" : "opacity-0"}
            `}
            muted
            playsInline
            autoPlay
            loop
            preload="metadata"
            disablePictureInPicture
            controlsList="nodownload noplaybackrate noremoteplayback"
            style={{
              WebkitBackfaceVisibility: "hidden",
              backfaceVisibility: "hidden",
              contain: "layout paint size style",
              translate: "0 0 0",
            }}
          >
            <source src="/hero.webm" type="video/webm" />
          </video>

          {/* Soft gradient overlay so white text pops */}
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
