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
        className="w-full max-w-[1400px] text-center"
      >
        {eyebrow ? <div className="mb-6 hidden text-sm font-semibold uppercase tracking-[0.24em] text-white/80 sm:block md:mb-8" style={{ fontFamily: "var(--font-inter), Inter, sans-serif" }}>{eyebrow}</div> : null}
        <h1
          className={`hero-title ${displayClassName} mx-auto max-w-[1400px] whitespace-normal leading-[1.02] font-extrabold tracking-[-0.055em] text-[#fff8ed]`}
          style={{
            fontFamily: "var(--font-inter), Inter, ui-sans-serif, sans-serif",
            WebkitFontSmoothing: "antialiased",
            MozOsxFontSmoothing: "grayscale",
            textRendering: "optimizeLegibility",
          }}
        >
          {heading ?? <>AI Website Cloner</>}
        </h1>

        <p className="mx-auto mt-[clamp(1rem,2.2vh,1.75rem)] max-w-4xl text-lg font-medium text-white/90 sm:text-xl md:text-2xl lg:text-[1.8rem]">
          {subhead ?? "Clone a website from a URL, customize it with AI, and launch your new site."}
        </p>

        <form onSubmit={onSubmit} className="mx-auto mt-[clamp(1.75rem,4vh,3rem)] w-full max-w-[800px] space-y-3">
          <label htmlFor="hero-url-input" className="sr-only">
            Website URL
          </label>
          <div className="hero-url-shell relative isolate overflow-hidden rounded-full p-2 backdrop-blur-xl">
            <div className="flex items-stretch gap-2">
              <div className="relative z-10 flex min-h-[68px] flex-1 items-center rounded-full px-5 sm:px-7">
                <span className="mr-1 hidden text-lg font-medium text-white/65 sm:inline md:text-xl">
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
                  className="w-full bg-transparent text-lg font-medium text-[#fff8ed] outline-none placeholder:text-white/55 sm:text-xl md:text-2xl"
                  autoComplete="off"
                  aria-describedby={error ? errorId : hintId}
                  aria-invalid={Boolean(error)}
                />
              </div>

              <button
                type="submit"
                disabled={!url || !!error}
                className="inline-flex min-h-16 shrink-0 items-center justify-center rounded-full bg-[#FF8D21] px-8 text-lg font-semibold whitespace-nowrap text-white shadow-[0_6px_24px_rgba(255,141,33,0.32)] transition-all duration-200 hover:scale-[1.04] hover:shadow-[0_10px_28px_rgba(255,141,33,0.48)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 md:px-10 md:text-xl"
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
