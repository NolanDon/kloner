// components/UrlOverlay.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { auth } from "@/lib/firebase";

type UrlOverlayProps = {
    open: boolean;
    onClose: () => void;
};

/* -------- shared URL helpers (same logic as Hero) -------- */

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

        const host = parsed.hostname || "";
        if (!host) return null;

        const hostLower = host.toLowerCase();

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

        parsed.hash = "";
        return parsed.toString();
    } catch {
        return null;
    }
}

/* ----------------- Overlay component ----------------- */

export default function UrlOverlay({ open, onClose }: UrlOverlayProps) {
    const router = useRouter();
    const [url, setUrl] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (open) {
            setUrl("");
            setError(null);
            setSubmitting(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
        const cleaned = stripProtocol(e.target.value);
        setUrl(cleaned);
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

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (submitting) return;

        const stripped = stripProtocol(url);
        const normalized = validateAndNormalize(stripped);

        if (!normalized) {
            setError("Please enter a valid public http(s) URL (no localhost or private IPs).");
            return;
        }

        setError(null);
        setSubmitting(true);

        const user = auth.currentUser;
        if (user) {
            router.push(`/dashboard?u=${encodeURIComponent(normalized)}`);
            onClose();
            return;
        }

        try {
            localStorage.setItem("kloner.pendingUrl", normalized);
        } catch {
            // ignore
        }

        router.push(`/login?mode=signup&u=${encodeURIComponent(normalized)}`);
        onClose();
    }

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="url-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-xl"
                >
                    <motion.div
                        initial={{ y: 20, opacity: 0, scale: 0.97 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 10, opacity: 0, scale: 0.97 }}
                        transition={{ duration: 0.25 }}
                        className="w-full max-w-lg mx-4 rounded-3xl bg-white/10 border border-white/15
                       backdrop-blur-2xl backdrop-saturate-150 shadow-[0_24px_80px_rgba(0,0,0,0.65)]
                       p-6 md:p-8 text-white"
                    >
                        <div className="flex justify-between items-start gap-4 mb-5">
                            <div>
                                <h2 className="text-xl md:text-2xl font-semibold tracking-tight mb-1">
                                    Paste a URL to get started
                                </h2>
                                <p className="text-xs sm:text-sm text-white/70">
                                    We’ll generate a ready-to-ship project you can customize and deploy.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="text-xs text-white/60 hover:text-white/95 underline underline-offset-4"
                            >
                                Close
                            </button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div
                                className="rounded-[999px] ring-1 ring-white/25 bg-white/90 backdrop-blur
                           shadow-[0_8px_28px_rgba(0,0,0,0.25)]
                           focus-within:ring-2 focus-within:ring-white/70
                           transition flex items-center gap-2 pl-5 pr-2 h-[56px] sm:h-[64px]"
                            >
                                <span className="hidden sm:inline text-neutral-500 text-lg">
                                    https://
                                </span>
                                <input
                                    ref={inputRef}
                                    inputMode="url"
                                    autoComplete="url"
                                    placeholder="example.com"
                                    aria-label="Website URL"
                                    aria-invalid={error ? "true" : "false"}
                                    value={url}
                                    onChange={handleChange}
                                    onPaste={handlePaste}
                                    className="flex-1 bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400 text-[15px] sm:text-[16px]"
                                />
                                <button
                                    type="submit"
                                    disabled={!url || !!error || submitting}
                                    className="shrink-0 rounded-full h-[44px] sm:h-[50px] px-5 sm:px-6
                             bg-accent text-white text-[14px] tracking-wide
                             shadow-[0_6px_18px_rgba(0,0,0,0.25)]
                             hover:bg-accent hover:shadow-[0_14px_40px_rgba(0,0,0,0.35)]
                             disabled:opacity-60 disabled:cursor-not-allowed transition"
                                >
                                    {submitting ? "Checking…" : "Continue"}
                                </button>
                            </div>

                            <div className="mt-2">
                                {error ? (
                                    <div role="alert" className="text-yellow-200 text-xs sm:text-sm">
                                        {error}
                                    </div>
                                ) : (
                                    <div className="text-white/75 text-xs sm:text-sm">
                                        Free preview • No card required to generate previews
                                    </div>
                                )}
                            </div>
                        </form>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
