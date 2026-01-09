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

export default function Hero() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

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
    } catch { }
    router.push(`/login?mode=signup&u=${encodeURIComponent(normalized)}`);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cleaned = stripProtocol(e.target.value);
    setUrl(cleaned);
    setError(cleaned && !validateAndNormalize(cleaned) ? "Please enter a valid public http(s) URL." : null);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    e.preventDefault();
    const cleaned = stripProtocol(pasted);
    setUrl(cleaned);
    setError(!validateAndNormalize(cleaned) ? "Please enter a valid public http(s) URL." : null);
  }

  return (
    <section
      className="relative flex items-center bg-white text-neutral-800"
      style={{
        height: "calc(100dvh - var(--header-h, 0px))",
        minHeight: 560,
      }}
    >
      <div className="absolute inset-0 p-4">
        {/* Container */}
        <div className="relative h-full w-full overflow-hidden rounded-3xl ring-1 ring-black/10 shadow-2xl bg-[#2a1b3e]">
          <div className="absolute inset-0">
            {/* Background Image Texture */}
            <div
              className="absolute inset-0 bg-cover bg-center opacity-60"
              style={{
                backgroundImage:
                  "url('https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1974&auto=format&fit=crop')",
              }}
            />

            {/* ANIMATED BLOB 1: Pink/Magenta
               - Added 'initial' to prevent hydration mismatch
               - Sped up duration to 8s so movement is visible
               - Added will-change for performance
            */}
            <motion.div
              className="absolute -inset-[50%] blur-3xl opacity-60"
              style={{
                background: "radial-gradient(circle at center, rgba(236, 72, 153, 0.6) 0%, rgba(192, 38, 211, 0.3) 50%, transparent 80%)",
                willChange: "transform"
              }}
              initial={{ x: "-15%", y: "-10%", scale: 1 }}
              animate={{
                x: ["-15%", "15%", "-5%", "-15%"],
                y: ["-10%", "5%", "15%", "-10%"],
                scale: [1, 1.1, 0.9, 1]
              }}
              transition={{
                duration: 8,
                repeat: Infinity,
                repeatType: "mirror",
                ease: "easeInOut",
              }}
            />

            {/* ANIMATED BLOB 2: Purple/Violet
               - Added 'initial'
               - Sped up duration to 10s
               - Added will-change
            */}
            <motion.div
              className="absolute -inset-[50%] blur-3xl opacity-60"
              style={{
                background: "radial-gradient(circle at center, rgba(168, 85, 247, 0.6) 0%, rgba(124, 58, 237, 0.3) 50%, transparent 80%)",
                willChange: "transform"
              }}
              initial={{ x: "10%", y: "15%", scale: 0.9 }}
              animate={{
                x: ["10%", "-20%", "5%", "10%"],
                y: ["15%", "-5%", "-20%", "15%"],
                scale: [0.9, 1.2, 1, 0.9]
              }}
              transition={{
                duration: 10,
                repeat: Infinity,
                repeatType: "mirror",
                ease: "easeInOut",
              }}
            />
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-3xl text-center px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <h1
            className={`${display.className} pt-16 leading-[0.96] font-semibold text-[3.5rem] md:text-[5rem] tracking-[-0.015em] text-white`}
          >
            Clone, Customize & Deploy.
          </h1>

          <p className="mt-6 text-white/80 text-lg">
            Paste a URL. We generate a ready-to-ship project you can preview,
            customize, and deploy in minutes.
          </p>

          <div className="mt-12 flex justify-center">
            <a href="/community-builds" className="group inline-flex items-center gap-2 text-white/80 text-sm">
              <span className="relative">
                <span className="transition-colors group-hover:text-white">
                  Start from a template
                </span>
                <span className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 transition-transform group-hover:scale-x-100 bg-white/70" />
              </span>
              <ArrowRightSquare className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
          </div>

          <form onSubmit={onSubmit} className="mt-10 mx-2">
            <div className="mx-auto max-w-3xl rounded-full ring-1 ring-white/30 bg-white/90 backdrop-blur shadow-xl flex items-center gap-2 pl-6 pr-2 h-[72px]">
              <span className="hidden sm:inline text-neutral-500 text-lg">https://</span>
              <input
                ref={inputRef}
                value={url}
                onChange={handleChange}
                onPaste={handlePaste}
                placeholder="example.com"
                className="flex-1 bg-transparent outline-none text-neutral-700 text-lg placeholder:text-neutral-500"
              />
              <button
                type="submit"
                disabled={!url || !!error}
                className="h-[56px] px-6 rounded-full bg-accent text-white shadow-lg disabled:opacity-50"
              >
                Preview
              </button>
            </div>

            <div className="mt-2 text-sm text-white/80">
              {error ?? "Free preview • No card required to generate previews"}
            </div>
          </form>
        </motion.div>
      </div>
    </section>
  );
}