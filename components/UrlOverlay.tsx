// components/UrlOverlay.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { auth } from "@/lib/firebase";
import { ArrowRightSquare } from "lucide-react";
import { stripProtocol, validateAndNormalizePublicHttpUrl, getPublicHttpUrlRejectionReason } from "@/src/lib/publicHttpUrl";

type UrlOverlayProps = {
    open: boolean;
    onClose: () => void;
};

/* ----------------- Overlay component ----------------- */

export default function UrlOverlay({ open, onClose }: UrlOverlayProps) {
    const router = useRouter();
    const [url, setUrl] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const hintId = "url-overlay-hint";
    const errorId = "url-overlay-error";

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
        const ok = validateAndNormalizePublicHttpUrl(cleaned);
        setError(ok ? null : getPublicHttpUrlRejectionReason(cleaned));
    }

    function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
        const pasted = e.clipboardData.getData("text");
        if (!pasted) return;
        e.preventDefault();

        const cleaned = stripProtocol(pasted);
        setUrl(cleaned);
        const ok = validateAndNormalizePublicHttpUrl(cleaned);
        setError(ok ? null : getPublicHttpUrlRejectionReason(cleaned));
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (submitting) return;

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
                       p-4 sm:p-6 md:p-8 text-white"
                    >
                        <div className="flex justify-between items-start gap-4 mb-4 sm:mb-5">
                            <div>
                                <h2 className="text-lg sm:text-xl md:text-2xl font-semibold tracking-tight mb-1">
                                    Drop a link
                                </h2>
                                <p className="text-xs sm:text-sm text-white/70 max-w-[28ch] sm:max-w-none">
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

                        <form onSubmit={handleSubmit} className="space-y-3">
                            <label htmlFor="url-overlay-input" className="sr-only">
                                Website URL
                            </label>
                            <div className="rounded-full bg-white/95 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.3)] ring-1 ring-white/20 backdrop-blur-md">
                                <div className="flex items-stretch gap-2">
                                    <div className="flex min-h-[48px] flex-1 items-center rounded-full px-4 sm:px-6">
                                        <span className="hidden sm:inline text-neutral-400 text-lg font-medium mr-1">
                                            https://
                                        </span>

                                        <input
                                            id="url-overlay-input"
                                            ref={inputRef}
                                            value={url}
                                            onChange={handleChange}
                                            onPaste={handlePaste}
                                            placeholder="example.com"
                                            inputMode="url"
                                            autoCapitalize="none"
                                            onFocus={() => setSubmitting(false)}
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
                                        <span className="hidden text-sm font-semibold sm:inline sm:text-base">Clone</span>
                                    </button>
                                </div>
                            </div>
                        </form>

                        <div
                            id={error ? errorId : hintId}
                            className="mt-3 text-xs sm:text-sm text-white/80 min-h-[1.25rem] max-w-[28ch] sm:max-w-none"
                            aria-live="polite"
                        >
                            {error ?? "Clone any public website • No credit card required to preview"}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
