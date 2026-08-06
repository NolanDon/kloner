"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { ArrowRightSquare } from "lucide-react";
import { getPublicHttpUrlRejectionReason, stripProtocol, validateAndNormalizePublicHttpUrl } from "@/src/lib/publicHttpUrl";

export default function HeroContent({
  displayClassName,
}: {
  displayClassName: string;
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
      router.push(`/dashboard/view?u=${encodeURIComponent(normalized)}&start=1`);
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
    <div className="relative z-20 flex h-full w-full items-center justify-center px-4 sm:px-6 py-[clamp(1.25rem,3.5vh,2.5rem)]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="w-full max-w-[720px] text-center"
      >
        <div className="mb-3 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/85 backdrop-blur-sm">
          Website cloner
        </div>
        <h1
          className={`${displayClassName} leading-[0.95] font-bold tracking-tight text-white`}
          style={{ fontSize: "clamp(3rem, min(12vw, 8.8vh), 5.5rem)" }}
        >
          Clone any website <br /> instantly.
        </h1>

        <p className="mt-[clamp(0.75rem,2.2vh,1.5rem)] text-white/90 text-base sm:text-lg md:text-xl max-w-xl mx-auto font-medium">
          Use Kloner as a website cloner to copy a website, preview the layout,
          and make it your own without starting from scratch.
        </p>

        <form onSubmit={onSubmit} className="mt-[clamp(1rem,3.2vh,2.5rem)] w-full max-w-2xl mx-auto space-y-3">
          <label htmlFor="hero-url-input" className="sr-only">
            Website URL
          </label>
          <div className="rounded-full bg-white/95 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.3)] ring-1 ring-white/20 backdrop-blur-md">
            <div className="flex items-stretch gap-2">
              <div className="flex min-h-[48px] flex-1 items-center rounded-full px-4 sm:px-6">
                <span className="hidden sm:inline text-neutral-400 text-lg font-medium mr-1">
                  https://
                </span>

                <input
                  id="hero-url-input"
                  ref={inputRef}
                  value={url}
                  onChange={handleChange}
                  onPaste={handlePaste}
                  placeholder="example.com"
                  inputMode="url"
                  autoCapitalize="none"
                  className="w-full bg-transparent outline-none text-neutral-700 text-base sm:text-lg placeholder:text-neutral-400 font-medium"
                  autoComplete="off"
                  aria-describedby={error ? errorId : hintId}
                  aria-invalid={Boolean(error)}
                />
              </div>

              <button
                type="submit"
                disabled={!url || !!error}
                className="inline-flex min-h-[48px] w-12 shrink-0 items-center justify-center rounded-full bg-[#FF8D21] text-white transition-all active:scale-95 hover:bg-[#D96E11] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-5"
                aria-label="Clone website from URL"
              >
                <ArrowRightSquare className="h-5 w-5 sm:hidden" aria-hidden />
                <span className="hidden text-sm sm:inline sm:text-base">Clone</span>
              </button>
            </div>
          </div>

          <div
            id={error ? errorId : hintId}
            className="mt-3 sm:mt-4 text-xs sm:text-sm text-white font-medium"
            aria-live="polite"
          >
            {error ?? "Clone your public website • Instant preview • Customize and launch"}
          </div>
        </form>

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
