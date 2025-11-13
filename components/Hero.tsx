"use client";

import { motion } from "framer-motion";
import { Outfit } from "next/font/google";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";

const display = Outfit({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});

function toAbsolute(u: string) {
  const s = u.trim();
  if (!s) return "";
  try {
    return new URL(s).toString();
  } catch {
    try {
      return new URL(`https://${s}`).toString();
    } catch {
      return "";
    }
  }
}

export default function Hero() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const abs = toAbsolute(url);
    if (!abs) return;

    const user = auth.currentUser;
    if (user) {
      router.push(`/dashboard?u=${encodeURIComponent(abs)}`);
      return;
    }

    try {
      localStorage.setItem("kloner.pendingUrl", abs);
    } catch { }
    router.push(`/login?mode=signup&u=${encodeURIComponent(abs)}`);
  }

  return (
    <section
      className="relative flex items-center bg-white text-neutral-800"
      style={{
        height: "calc(100dvh - var(--header-h, 0px))",
        minHeight: 560,
        ["--hero-gutter" as any]:
          "max(env(safe-area-inset-left), clamp(12px, 4vw, 10px))",
      }}
    >
      {/* Background video / poster */}
      <div className="absolute inset-0 p-[var(--hero-gutter)]">
        <div className="relative h-full w-full overflow-hidden rounded-2xl md:rounded-3xl ring-1 ring-black/10 shadow-2xl">
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src="/hero.webm"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            poster="/images/hero-poster.png"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/15 to-transparent" />
        </div>
      </div>

      {/* Copy + gigantic URL input */}
      <div className="container-soft relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="mx-auto max-w-3xl text-center"
        >
          <h1
            className={`${display.className} pt-20 leading-[0.96] font-semibold text-white text-[clamp(2.6rem,7.6vw,5rem)] tracking-[-0.015em]`}
            style={{
              textWrap: "balance" as any,
              WebkitFontSmoothing: "antialiased",
              MozOsxFontSmoothing: "grayscale",
            }}
          >
            Click, Clone, Customize & Deploy.
          </h1>

          <p className="mt-4 md:mt-5 text-white/80 text-base sm:text-lg px-2 pb-10 md:pb-20">
            Paste a URL. We generate a ready-to-ship project you can <br />
            preview, customize, and deploy in minutes.
          </p>

          <form onSubmit={onSubmit} className="mt-6 md:mt-15 px-2" aria-label="Start by pasting a URL">
            <div
              className="
                mx-auto max-w-3xl
                rounded-[999px] ring-1 ring-white/25 bg-white/90 backdrop-blur
                shadow-[0_8px_28px_rgba(0,0,0,0.25)]
                focus-within:ring-2 focus-within:ring-white/70
                transition
                flex items-center gap-2
                pl-5 pr-2
                h-[64px] sm:h-[74px]
              "
            >
              <label htmlFor="hero-url" className="sr-only">Website URL</label>
              <span className="hidden sm:inline text-neutral-500 text-lg">https://</span>
              <input
                id="hero-url"
                name="u"
                inputMode="url"
                autoComplete="url"
                placeholder="example.com"
                aria-label="Paste a website URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                ref={inputRef}
                className="flex-1 bg-transparent outline-none text-neutral-600 placeholder:text-neutral-400 text-[16px] sm:text-[18px]"
              />
              <button
                type="submit"
                className="
                  shrink-0 rounded-full
                  h-[48px] sm:h-[56px] px-5 sm:px-6
                  bg-accent
                  text-white text-[15px] tracking-wide
                  shadow-[0_6px_18px_rgba(0,0,0,0.25)]
                  hover:bg-accent
                  hover:shadow-[0_14px_40px_rgba(0,0,0,0.35)]
                  transition
                "
                aria-label="Generate preview"
              >
                Preview
              </button>
            </div>
            <div className="mt-6 text-white/80 text-xs sm:text-sm">Free preview • No card required</div>
          </form>
        </motion.div>
      </div>
    </section>
  );
}
