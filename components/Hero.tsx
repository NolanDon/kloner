"use client";

import { motion } from "framer-motion";
import { Outfit } from "next/font/google";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { ArrowRightSquare } from "lucide-react";

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

/**
 * Normalize user input by stripping leading protocols (http:// or https://)
 * and trimming whitespace.
 */
function stripProtocol(input: string) {
  return input.replace(/^\s*https?:\/\//i, "").trim();
}

/**
 * Validate and normalize a candidate URL string.
 * Returns a normalized absolute URL string (with protocol) or null if invalid.
 * Security checks:
 *  - Only allows http/https schemes.
 *  - Rejects obvious loopback/private IP hosts (localhost, 127.*, 10.*, 172.16-31.*, 192.168.*, ::1).
 *  - Rejects empty hostnames and non-URL values.
 *  - Enforces a reasonable max length.
 */
const DOMAIN_RE = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

function validateAndNormalize(u: string): string | null {
  const s = u.trim();
  if (!s) return null;
  if (s.length > 2083) return null; // avoid extremely long inputs

  const lower = s.toLowerCase();

  // Reject obvious garbage / bare schemes
  if (lower === "http" || lower === "https") return null;

  const abs = toAbsolute(s);
  if (!abs) return null;

  try {
    const parsed = new URL(abs);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return null;

    const host = parsed.hostname || "";
    if (!host) return null;

    const hostLower = host.toLowerCase();

    // Block common local/private addresses to reduce SSRF/localhost attacks
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

    // Require proper domain structure: at least one dot, valid labels, letter TLD ≥ 2 chars
    if (!DOMAIN_RE.test(hostLower)) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export default function Hero() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Detect mobile on the client and only render the small video on mobile.
  // This ensures the large video is never requested on mobile devices.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Strip protocol if the user included it (requirement)
    const stripped = stripProtocol(url);
    const normalized = validateAndNormalize(stripped);

    if (!normalized) {
      setError("Please enter a valid public http(s) URL (no localhost or private IPs).");
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
    } catch {
      // ignore storage failures
    }
    router.push(`/login?mode=signup&u=${encodeURIComponent(normalized)}`);
  }

  // Keep input free of leading protocol while typing/pasting
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cleaned = stripProtocol(e.target.value);
    setUrl(cleaned);
    // live-validate lightly
    if (!cleaned) {
      setError(null);
      return;
    }
    const ok = validateAndNormalize(cleaned);
    setError(ok ? null : "Please enter a valid public http(s) URL.");
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    const cleaned = stripProtocol(pasted);
    e.preventDefault();
    setUrl(cleaned);
    const ok = validateAndNormalize(cleaned);
    setError(ok ? null : "Please enter a valid public http(s) URL.");
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
          {/* Only one video element is rendered, chosen by isMobile so the other file is never requested */}
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src={isMobile ? "/hero_mobile.mp4" : "/hero.webm"}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            poster="/images/hero-poster.jpg"
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
            className={`${display.className} pt-20 leading-[0.96] font-semibold text-white text-[3.5rem] md:text-[5rem] tracking-[-0.015em]`}
            style={{
              textWrap: "balance" as any,
              WebkitFontSmoothing: "antialiased",
              MozOsxFontSmoothing: "grayscale",
            }}
          >
            Clone, Customize & Deploy.
          </h1>

          <p className="block md:hidden mt-4 md:mt-5 text-white/80 text-base sm:text-lg px-2 pb-10 md:pb-20">
            Paste a URL. We generate a ready-to-ship project you can
            preview, customize, and deploy in minutes.
          </p>


          <p className="hidden md:block mt-4 md:mt-5 text-white/80 text-base sm:text-lg px-2 pb-10 md:pb-20">
            Paste a URL. We generate a ready-to-ship project you can <br />
            preview, customize, and deploy in minutes.
          </p>

          {/* "How it works" link */}
          <div className="mt-12 flex justify-center">
            <a
              href="#how-it-works"
              className="group inline-flex items-center gap-2 text-white/80 text-xs sm:text-sm"
            >
              <span className="relative">
                <span className="transition-colors group-hover:text-white">
                  See how it works
                </span>
                <span className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-white/70 transition-transform group-hover:scale-x-100" />
              </span>
              <ArrowRightSquare
                className="h-4 w-4 transform transition-transform duration-200 group-hover:translate-x-1 mt-0.5"
              />
            </a>
          </div>


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
                aria-invalid={error ? "true" : "false"}
                value={url}
                onChange={handleChange}
                onPaste={handlePaste}
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
                disabled={!url || !!error}
              >
                Preview
              </button>
            </div>
            <div className="mt-2">
              {error ? (
                <div role="alert" className="text-yellow-200 text-xs sm:text-sm">
                  {error}
                </div>
              ) : (
                <div className="text-white/80 text-xs sm:text-sm">Free preview • No card required to generate previews</div>
              )}
            </div>
          </form>
        </motion.div>
      </div>
    </section>
  );
}
