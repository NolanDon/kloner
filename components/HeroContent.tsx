"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { ArrowRightSquare, Send } from "lucide-react";

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

function stripProtocol(input: string) {
  return input.replace(/^\s*https?:\/\//i, "").trim();
}

const DOMAIN_RE = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

const PROMPT_PLACEHOLDERS = [
  "Generate me a website for a dental clinic",
  "Generate me a website for a veterinary clinic",
  "Generate me a website for group sessions",
  "Generate me a website for a yoga retreat",
  "Generate me a website for a coffee shop",
];

function validateAndNormalize(u: string): string | null {
  const s = u.trim();
  if (!s) return null;
  if (s.length > 2083) return null;

  const lower = s.toLowerCase();
  if (lower === "http" || lower === "https") return null;

  const abs = toAbsolute(s);
  if (!abs) return null;

  try {
    const parsed = new URL(abs);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return null;

    const hostLower = parsed.hostname.toLowerCase();
    if (
      hostLower === "localhost" ||
      hostLower === "::1" ||
      hostLower === "0.0.0.0" ||
      /^127(?:\.\d{1,3}){0,3}$/.test(hostLower) ||
      /^10\./.test(hostLower) ||
      /^192\.168\./.test(hostLower) ||
      /^169\.254\./.test(hostLower) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostLower)
    ) {
      return null;
    }

    if (!DOMAIN_RE.test(hostLower)) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}

export default function HeroContent({
  displayClassName,
}: {
  displayClassName: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "prompt">("url");
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [promptPlaceholderIdx, setPromptPlaceholderIdx] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (mode !== "prompt") return;
    const t = window.setInterval(() => {
      setPromptPlaceholderIdx((i) => (i + 1) % PROMPT_PLACEHOLDERS.length);
    }, 3200);
    return () => window.clearInterval(t);
  }, [mode]);

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
        localStorage.setItem("kloner.pendingPrompt", p);
      } catch {}
      router.push(`/login?mode=signup&prompt=${encodeURIComponent(p)}`);
      return;
    }

    const stripped = stripProtocol(url);
    const normalized = validateAndNormalize(stripped);

    if (!normalized) {
      setError("Please enter a valid public http(s) URL.");
      return;
    }

    setError(null);

    if (user) {
      router.push(`/dashboard?u=${encodeURIComponent(normalized)}`);
      return;
    }

    try {
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
      cleaned && !validateAndNormalize(cleaned)
        ? "Please enter a valid public http(s) URL."
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
      !validateAndNormalize(cleaned)
        ? "Please enter a valid public http(s) URL."
        : null
    );
  }

  return (
    <div className="relative z-20 flex h-full w-full items-center justify-center px-4 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="w-full max-w-[720px] text-center pt-16 pb-20 sm:pt-0 sm:pb-0"
      >
        <h1
          className={`${displayClassName} leading-[0.95] font-bold text-[3rem] sm:text-[4.25rem] md:text-[5.5rem] tracking-tight text-white`}
        >
          Clone, Customize <br /> & Deploy.
        </h1>

        <p className="mt-5 sm:mt-6 text-white/90 text-base sm:text-lg md:text-xl max-w-xl mx-auto font-medium">
          The ingenuity of cloning, automated. Drop a link or enter a description
          to generate your next ready-to-ship project.
        </p>

        <form onSubmit={onSubmit} className="mt-8 sm:mt-10 w-full max-w-2xl mx-auto">
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
                setMode("prompt");
                setError(null);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
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
            {error ?? "Instant site cloning technology • No credit card required"}
          </div>
        </form>

        <div className="mt-10 sm:mt-12 flex justify-center">
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
