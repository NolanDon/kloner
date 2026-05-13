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
                       p-6 md:p-8 text-white"
                    >
                        <div className="flex justify-between items-start gap-4 mb-5">
                            <div>
                                <h2 className="text-xl md:text-2xl font-semibold tracking-tight mb-1">
                                    Drop a link
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
                            <div className="relative flex items-center bg-white/95 backdrop-blur-md p-2 pl-4 sm:pl-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)] ring-1 ring-white/20 transition-all duration-300 ease-out rounded-full h-[64px] sm:h-[72px]">
                                <span className="hidden sm:inline text-neutral-400 text-lg font-medium mr-1">
                                    https://
                                </span>

                                <input
                                    ref={inputRef}
                                    value={url}
                                    onChange={handleChange}
                                    onPaste={handlePaste}
                                    placeholder="example.com"
                                    onFocus={() => setSubmitting(false)}
                                    className="flex-1 bg-transparent outline-none text-neutral-700 text-base sm:text-lg placeholder:text-neutral-400 font-medium"
                                    autoComplete="off"
                                />

                                <button
                                    type="submit"
                                    disabled={!url || !!error}
                                    className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-[#f26522] px-4 text-white transition-all active:scale-95 hover:bg-[#ff7a3d] disabled:cursor-not-allowed disabled:opacity-60 md:px-6"
                                    aria-label="Clone website from URL"
                                >
                                    <span className="inline-flex items-center gap-2">
                                        <ArrowRightSquare className="h-4 w-4" />
                                        <span className="sr-only">Clone</span>
                                        <span className="hidden md:inline">Clone</span>
                                    </span>
                                </button>
                            </div>
                        </form>

                        <div className="mt-3 text-xs sm:text-sm text-white/80 min-h-[1.25rem]">
                            {error ?? "Clone any public website • No credit card required to preview"}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}