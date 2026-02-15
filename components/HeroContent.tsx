"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { ArrowRightSquare } from "lucide-react";

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
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const stripped = stripProtocol(url);
    const normalized = validateAndNormalize(stripped);

    if (!normalized) {
      setError("Please enter a valid public http(s) URL.");
      return;
    }

    setError(null);
    const user = auth.currentUser;
    if (user) {
      router.push(`/dashboard?u=${encodeURIComponent(normalized)}`);
      return;
    }

    try {
      localStorage.setItem("kloner.pendingUrl", normalized);
    } catch {}
    router.push(`/login?mode=signup&u=${encodeURIComponent(normalized)}`);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cleaned = stripProtocol(e.target.value);
    setUrl(cleaned);
    setError(
      cleaned && !validateAndNormalize(cleaned)
        ? "Please enter a valid public http(s) URL."
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
          The ingenuity of cloning, automated — a website clone AI. Paste a URL
          to generate your next ready-to-ship project.
        </p>

        <form onSubmit={onSubmit} className="mt-8 sm:mt-10 w-full max-w-2xl mx-auto">
          <div className="flex items-center bg-white/95 backdrop-blur-md rounded-full p-2 pl-4 sm:pl-6 h-[64px] sm:h-[72px] shadow-[0_20px_50px_rgba(0,0,0,0.3)] ring-1 ring-white/20">
            <span className="hidden sm:inline text-neutral-400 text-lg font-medium mr-1">
              https://
            </span>
            <input
              ref={inputRef}
              value={url}
              onChange={handleChange}
              onPaste={handlePaste}
              placeholder="example.com"
              className="flex-1 bg-transparent outline-none text-neutral-800 text-base sm:text-lg placeholder:text-neutral-400 font-medium"
            />
            <button
              type="submit"
              disabled={!url || !!error}
              className="h-full px-6 sm:px-10 rounded-full bg-[#f26522] hover:bg-[#ff7a3d] text-white transition-all active:scale-95"
            >
              Preview
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
