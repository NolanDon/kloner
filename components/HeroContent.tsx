"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { ArrowRightSquare, Send } from "lucide-react";
import { PROMPT_PLACEHOLDERS } from "@/src/lib/promptPlaceholders";
import { useRotatingPlaceholderIndex } from "@/src/hooks/useRotatingPlaceholderIndex";
import { getPublicHttpUrlRejectionReason, stripProtocol, validateAndNormalizePublicHttpUrl } from "@/src/lib/publicHttpUrl";


export default function HeroContent({
  displayClassName,
}: {
  displayClassName: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "prompt">("url");
  const promptModeEnabled = false;
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const promptPlaceholderIdx = useRotatingPlaceholderIndex({
    enabled: mode === "prompt",
    length: PROMPT_PLACEHOLDERS.length,
    intervalMs: 3200,
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const user = auth.currentUser;

    if (mode === "prompt") {
      const p = (prompt || "").trim();
      if (p.length < 10) {
        setError("Please enter a short prompt.");
        return;
      }
      setError(null);

      if (user) {
        router.push(`/dashboard/view?wizard=1&source=prompt&prompt=${encodeURIComponent(p)}`);
        return;
      }

      try {
        localStorage.removeItem("kloner.pendingUrl");
        localStorage.setItem("kloner.pendingPrompt", p);
      } catch {}
      router.push(`/login?mode=signup&prompt=${encodeURIComponent(p)}`);
      return;
    }

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
    } catch {}
    router.push(`/login?mode=signup&u=${encodeURIComponent(normalized)}`);
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    if (mode === "prompt") {
      const v = e.target.value;
      setPrompt(v);
      setError(v.trim().length > 0 && v.trim().length < 10 ? "Please enter a short prompt." : null);
      return;
    }

    const cleaned = stripProtocol(e.target.value);
    setUrl(cleaned);
    setError(
      cleaned && !validateAndNormalizePublicHttpUrl(cleaned)
        ? getPublicHttpUrlRejectionReason(cleaned) || "Please enter a valid public http(s) URL."
        : null
    );
  }

  function handlePaste(
    e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    e.preventDefault();
    if (mode === "prompt") {
      setPrompt(pasted);
      setError(pasted.trim().length > 0 && pasted.trim().length < 10 ? "Please enter a short prompt." : null);
      return;
    }

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
        <h1
          className={`${displayClassName} leading-[0.95] font-bold tracking-tight text-white`}
          style={{ fontSize: "clamp(3rem, min(12vw, 8.8vh), 5.5rem)" }}
        >
          Clone, Customize <br /> & Deploy.
        </h1>

        <p className="mt-[clamp(0.75rem,2.2vh,1.5rem)] text-white/90 text-base sm:text-lg md:text-xl max-w-xl mx-auto font-medium">
          Enter a description, or drop a link
          to generate your next ready-to-ship project.
        </p>

        <form onSubmit={onSubmit} className="mt-[clamp(1rem,3.2vh,2.5rem)] w-full max-w-2xl mx-auto">
          <div className="mb-3 flex items-center justify-center gap-2 text-xs text-white/80">
            <button
              type="button"
              onClick={() => {
                setMode("url");
                setError(null);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              className={`rounded-full px-3 py-1 ring-1 transition ${mode === "url" ? "bg-white/15 ring-white/30 text-white" : "bg-transparent ring-white/15 hover:bg-white/10"}`}
            >
              URL
            </button>
            <button
              type="button"
              onClick={() => {
                if (!promptModeEnabled) return;
                setMode("prompt");
                setError(null);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              disabled={!promptModeEnabled}
              className={`rounded-full px-3 py-1 ring-1 transition ${mode === "prompt" ? "bg-white/15 ring-white/30 text-white" : "bg-transparent ring-white/15 hover:bg-white/10"}`}
            >
              Prompt
            </button>
          </div>
          <div
            className={
              "relative flex items-center bg-white/95 backdrop-blur-md p-2 pl-4 sm:pl-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)] ring-1 ring-white/20 transition-all duration-300 ease-out " +
              (mode === "prompt"
                ? "rounded-3xl h-[116px] sm:h-[116px]"
                : "rounded-full h-[64px] sm:h-[72px]")
            }
          >
            {mode === "url" ? (
              <span className="hidden sm:inline text-neutral-400 text-lg font-medium mr-1">
                https://
              </span>
            ) : null}

            {mode === "prompt" ? (
              <textarea
                ref={inputRef as any}
                value={prompt}
                onChange={handleChange}
                onPaste={handlePaste}
                placeholder=""
                rows={3}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                className="flex-1 bg-transparent outline-none text-neutral-700 text-base sm:text-lg placeholder:text-neutral-400 font-medium resize-none h-full py-3 leading-snug"
              />
            ) : (
              <input
                ref={inputRef as any}
                value={url}
                onChange={handleChange}
                onPaste={handlePaste}
                placeholder="example.com"
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                className="flex-1 bg-transparent outline-none text-neutral-700 text-base sm:text-lg placeholder:text-neutral-400 font-medium"
              />
            )}

            {mode === "prompt" && !prompt ? (
              <div
                className={
                  "pointer-events-none absolute left-0 right-0 top-0 pl-4 sm:pl-6 pr-[72px] sm:pr-[80px] pt-4 text-left " +
                  (isFocused ? "opacity-60" : "opacity-100")
                }
                aria-hidden
              >
                <AnimatePresence mode="wait">
                  <motion.span
                    key={promptPlaceholderIdx}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="block ml-[0.65ch] text-neutral-400/90 text-base sm:text-lg font-medium leading-snug max-h-[4.4em] overflow-hidden"
                  >
                    {PROMPT_PLACEHOLDERS[promptPlaceholderIdx]}
                  </motion.span>
                </AnimatePresence>
              </div>
            ) : null}
            <button
              type="submit"
              disabled={mode === "prompt" ? !prompt.trim() || !!error : !url || !!error}
              className={
                "shrink-0 rounded-full bg-[#f26522] hover:bg-[#ff7a3d] text-white transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed " +
                (mode === "prompt"
                  ? "h-11 w-11 grid place-items-center"
                  : "h-full px-6 sm:px-10")
              }
              aria-label={mode === "prompt" ? "Create from prompt" : "Preview from URL"}
            >
              {mode === "prompt" ? (
                <>
                  <Send className="h-4 w-4" />
                  <span className="sr-only">Create</span>
                </>
              ) : (
                "Preview"
              )}
            </button>
          </div>

          <div className="mt-3 sm:mt-4 text-xs sm:text-sm text-white font-medium">
            {error ?? "Site cloning technology • No credit card required to generate previews"}
          </div>
        </form>

        <div className="mt-[clamp(1rem,3.8vh,3rem)] flex justify-center">
          <a
            href="/community-builds"
            className="group inline-flex items-center gap-2 text-white/80 hover:text-white transition-all"
          >
            <span className="text-sm border-b text-white border-white/90 pb-0.5 group-hover:border-white">
              Explore community clones
            </span>
            <ArrowRightSquare className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
        </div>
      </motion.div>
    </div>
  );
}
