"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { ArrowRightSquare } from "lucide-react";
import { getPublicHttpUrlRejectionReason, stripProtocol, validateAndNormalizePublicHttpUrl } from "@/src/lib/publicHttpUrl";

export default function HeroContent({
  displayClassName,
  eyebrow,
  heading,
  subhead,
}: {
  displayClassName: string;
  eyebrow?: string;
  heading?: React.ReactNode;
  subhead?: string;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hintId = "hero-url-hint";
  const errorId = "hero-url-error";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const user = auth.currentUser;

    const stripped = stripProtocol(url);
    const normalized = validateAndNormalizePublicHttpUrl(stripped);

    if (!normalized) {
      setError(getPublicHttpUrlRejectionReason(stripped) || "Please enter a valid public http(s) URL.");
      return;
    }

    setError(null);

    if (user) {
      router.replace(`/dashboard/view?u=${encodeURIComponent(normalized)}&focusUrl=1`);
      return;
    }

    try {
      localStorage.removeItem("kloner.pendingPrompt");
      localStorage.setItem("kloner.pendingUrl", normalized);
    } catch {
      // ignore
    }
    router.push(`/login?mode=signup&u=${encodeURIComponent(normalized)}`);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cleaned = stripProtocol(e.target.value);
    setUrl(cleaned);
    setError(
      cleaned && !validateAndNormalizePublicHttpUrl(cleaned)
        ? getPublicHttpUrlRejectionReason(cleaned) || "Please enter a valid public http(s) URL."
        : null
    );
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    e.preventDefault();

    const cleaned = stripProtocol(pasted);
    setUrl(cleaned);
    setError(
      !validateAndNormalizePublicHttpUrl(cleaned)
        ? getPublicHttpUrlRejectionReason(cleaned) || "Please enter a valid public http(s) URL."
        : null
    );
  }

  return (
    <div className="relative z-20 flex h-full w-full items-center justify-center px-4 pt-16 pb-[clamp(1.25rem,3.5vh,2.5rem)] sm:px-6 sm:py-[clamp(1.25rem,3.5vh,2.5rem)]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="w-full max-w-[1000px] text-center"
      >
        {eyebrow ? <div className="mb-5 hidden text-xs font-semibold uppercase tracking-[0.24em] text-white/75 sm:block" style={{ fontFamily: "var(--font-inter), Inter, sans-serif" }}>{eyebrow}</div> : null}
        <h1
          className={`hero-title ${displayClassName} mx-auto max-w-[1100px] whitespace-normal leading-[1.02] font-extrabold tracking-[-0.055em] text-[#fff8ed]`}
          style={{
            fontFamily: "var(--font-inter), Inter, ui-sans-serif, sans-serif",
            WebkitFontSmoothing: "antialiased",
            MozOsxFontSmoothing: "grayscale",
            textRendering: "optimizeLegibility",
          }}
        >
          {heading ?? <>AI Website Cloner</>}
        </h1>

        <p className="mt-[clamp(0.75rem,2.2vh,1.5rem)] text-white/90 text-base sm:text-lg md:text-xl max-w-xl mx-auto font-medium">
          {subhead ?? "Clone a website from a URL, customize it with AI, and launch your new site."}
        </p>

        <form onSubmit={onSubmit} className="mt-[clamp(1.5rem,4vh,3rem)] w-full max-w-2xl mx-auto space-y-3">
          <label htmlFor="hero-url-input" className="sr-only">
            Website URL
          </label>
          <div className="relative overflow-hidden rounded-full border border-white/35 bg-[rgba(32,25,22,0.68)] p-2 shadow-[0_22px_60px_rgba(22,14,9,0.45)] backdrop-blur-xl">
            <span aria-hidden="true" className="pointer-events-none absolute -left-10 top-1/2 h-32 w-64 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,191,112,0.46)_0%,rgba(255,141,33,0.2)_38%,rgba(255,141,33,0)_72%)] blur-2xl" />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-[42%] bg-gradient-to-r from-[#ffb366]/10 to-transparent" />
            <div className="flex items-stretch gap-2">
              <div className="relative flex min-h-[60px] flex-1 items-center rounded-full px-5 sm:px-6">
                <span className="hidden sm:inline text-white/60 text-lg font-medium mr-1">
                  https://
                </span>

                <input
                  id="hero-url-input"
                  ref={inputRef}
                  autoFocus
                  value={url}
                  onChange={handleChange}
                  onPaste={handlePaste}
                  placeholder="example.com"
                  inputMode="url"
                  autoCapitalize="none"
                  className="w-full bg-transparent outline-none text-[#fff8ed] text-base sm:text-lg placeholder:text-white/55 font-medium"
                  autoComplete="off"
                  aria-describedby={error ? errorId : hintId}
                  aria-invalid={Boolean(error)}
                />
              </div>

              <button
                type="submit"
                disabled={!url || !!error}
                className="inline-flex min-h-14 shrink-0 items-center justify-center rounded-full bg-[#FF8D21] px-7 text-base font-semibold text-white whitespace-nowrap shadow-sm transition-all duration-200 hover:scale-[1.04] hover:shadow-[0_10px_24px_rgba(255,141,33,0.28)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
                aria-label="Clone website from URL"
              >
                <span>Clone</span>
              </button>
            </div>
          </div>

          <div
            id={error ? errorId : hintId}
            className={error ? "mt-3 sm:mt-4 text-xs sm:text-sm text-white font-medium" : "sr-only"}
            aria-live="polite"
          >
            {error ?? "Clone a public website • Preview the result • Customize and launch"}
          </div>
        </form>
        <p className="mt-8 text-sm text-white/80">
          Limited free preview · <a href="/price" className="underline underline-offset-4">Pricing</a>
        </p>

        <div className="mt-[clamp(1rem,3.8vh,3rem)] flex justify-center">
          {/* <a
            href="/community-builds"
            className="group inline-flex items-center gap-2 text-white/80 hover:text-white transition-all"
          >
            <span className="text-sm border-b text-white border-white/90 pb-0.5 group-hover:border-white">
              Explore community clones
            </span>
            <ArrowRightSquare className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a> */}
        </div>
      </motion.div>
    </div>
  );
}
