// components/UrlOverlay.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { auth } from "@/lib/firebase";
import { Send } from "lucide-react";
import { stripProtocol, validateAndNormalizePublicHttpUrl, getPublicHttpUrlRejectionReason } from "@/src/lib/publicHttpUrl";

const PROMPT_PLACEHOLDERS = [
    "Generate me a website for a yoga retreat",
    "Generate me a website for a dental clinic",
    "Generate me a website for a veterinary clinic",
    "Generate me a website for a coffee shop",
    "Generate me a website for a real estate team",
];

type UrlOverlayProps = {
    open: boolean;
    onClose: () => void;
};

/* ----------------- Overlay component ----------------- */

export default function UrlOverlay({ open, onClose }: UrlOverlayProps) {
    const router = useRouter();
    const [mode, setMode] = useState<"url" | "prompt">("url");
    const promptModeEnabled = false;
    const [url, setUrl] = useState("");
    const [prompt, setPrompt] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const [isFocused, setIsFocused] = useState(false);
    const [promptPlaceholderIdx, setPromptPlaceholderIdx] = useState(0);

    useEffect(() => {
        if (open) {
            setMode("url");
            setUrl("");
            setPrompt("");
            setError(null);
            setSubmitting(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        if (mode !== "prompt") return;
        const t = window.setInterval(() => {
            setPromptPlaceholderIdx((i) => (i + 1) % PROMPT_PLACEHOLDERS.length);
        }, 3200);
        return () => window.clearInterval(t);
    }, [open, mode]);

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
        if (!cleaned) {
            setError(null);
            return;
        }
        const ok = validateAndNormalizePublicHttpUrl(cleaned);
        setError(ok ? null : getPublicHttpUrlRejectionReason(cleaned));
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
        const ok = validateAndNormalizePublicHttpUrl(cleaned);
        setError(ok ? null : getPublicHttpUrlRejectionReason(cleaned));
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (submitting) return;

        if (mode === "prompt") {
            const p = (prompt || "").trim();
            if (p.length < 10) {
                setError("Please enter a short prompt.");
                return;
            }

            setError(null);
            setSubmitting(true);

            const user = auth.currentUser;
            if (user) {
                router.push(`/dashboard/view?wizard=1&source=prompt&prompt=${encodeURIComponent(p)}`);
                onClose();
                return;
            }

            try {
                localStorage.removeItem("kloner.pendingUrl");
                localStorage.setItem("kloner.pendingPrompt", p);
            } catch {
                // ignore
            }

            router.push(`/login?mode=signup&prompt=${encodeURIComponent(p)}`);
            onClose();
            return;
        }

        const stripped = stripProtocol(url);
        const normalized = validateAndNormalizePublicHttpUrl(stripped);

        if (!normalized) {
            setError(getPublicHttpUrlRejectionReason(stripped) || "Please enter a valid public http(s) URL.");
            return;
        }

        setError(null);
        setSubmitting(true);

        const user = auth.currentUser;
        if (user) {
            router.push(`/dashboard/view?u=${encodeURIComponent(normalized)}&start=1`);
            onClose();
            return;
        }

        try {
            localStorage.removeItem("kloner.pendingPrompt");
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
                                    Drop a link or enter a description
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

                        <div className="mb-4 flex items-center justify-start gap-2 text-xs text-white/80">
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

                        <form onSubmit={handleSubmit}>
                            <div
                                className={
                                    "ring-1 ring-white/25 bg-white/90 backdrop-blur\n" +
                                    "shadow-[0_8px_28px_rgba(0,0,0,0.25)]\n" +
                                    "focus-within:ring-2 focus-within:ring-white/70\n" +
                                    "transition flex gap-2 pl-5 pr-2 " +
                                    (mode === "prompt"
                                        ? "rounded-3xl items-stretch py-2 min-h-[112px]"
                                        : "rounded-[999px] items-center h-[56px] sm:h-[64px]")
                                }
                            >
                                {mode === "prompt" && !prompt ? (
                                    <div
                                        className={
                                            "pointer-events-none absolute left-0 right-0 top-0 pl-5 pr-[64px] pt-4 text-left " +
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
                                                className="block ml-[0.65ch] text-neutral-400/90 text-[15px] sm:text-[16px] leading-snug max-h-[4.4em] overflow-hidden"
                                            >
                                                {PROMPT_PLACEHOLDERS[promptPlaceholderIdx]}
                                            </motion.span>
                                        </AnimatePresence>
                                    </div>
                                ) : null}

                                {mode === "url" ? (
                                    <>
                                        <span className="hidden sm:inline text-neutral-500 text-lg">
                                            https://
                                        </span>
                                        <input
                                            ref={inputRef as any}
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
                                    </>
                                ) : (
                                    <textarea
                                        ref={inputRef as any}
                                        placeholder=""
                                        aria-label="Website description"
                                        aria-invalid={error ? "true" : "false"}
                                        value={prompt}
                                        onChange={handleChange}
                                        onPaste={handlePaste}
                                        rows={3}
                                        onFocus={() => setIsFocused(true)}
                                        onBlur={() => setIsFocused(false)}
                                        className="flex-1 bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400 text-[15px] sm:text-[16px] resize-none py-3 leading-snug"
                                    />
                                )}
                                <button
                                    type="submit"
                                    disabled={
                                        submitting ||
                                        !!error ||
                                        (mode === "prompt" ? !prompt.trim() : !url)
                                    }
                                    className={
                                        "shrink-0 rounded-full " +
                                        (mode === "prompt"
                                            ? "h-11 w-11 grid place-items-center"
                                            : "h-[44px] sm:h-[50px] px-5 sm:px-6") +
                                        "\n                             bg-accent text-white text-[14px] tracking-wide\n" +
                                        "                             shadow-[0_6px_18px_rgba(0,0,0,0.25)]\n" +
                                        "                             hover:bg-accent hover:shadow-[0_14px_40px_rgba(0,0,0,0.35)]\n" +
                                        "                             disabled:opacity-60 disabled:cursor-not-allowed transition"
                                    }
                                >
                                    {mode === "prompt" ? (
                                        <>
                                            <Send className="h-4 w-4" />
                                            <span className="sr-only">Send</span>
                                        </>
                                    ) : submitting ? (
                                        "Checking…"
                                    ) : (
                                        "Preview"
                                    )}
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
