"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, X } from "lucide-react";

type UrlProcessingPopupProps = {
    open: boolean;
    title?: string;
    message?: string;
    error?: string | null;
    onDismiss?: () => void;
    archiveZipUrl?: string | null;
    archiveZipBytes?: number | null;
    stage?: "submitting" | "processing" | "creating" | "finishing" | "ready" | "navigating" | "error";
};

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function formatBytes(bytes: number | null): string | null {
    if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
}

function estimateDurationMs(bytes: number | null): number {
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) {
        const mb = bytes / (1024 * 1024);
        return clamp(60_000 + Math.round(mb * 22_000), 60_000, 8 * 60_000);
    }
    return 180_000;
}

function parseVerifyDomainMessage(text: string): { prefix: string; domain: string; suffix: string } | null {
    const prefix = "Please verify your domain ";
    const trimmed = text.trim();
    if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return null;

    const remainder = trimmed.slice(prefix.length).trim();
    if (!remainder) return null;

    const firstToken = remainder.split(/\s+/)[0] || "";
    const domain = firstToken.replace(/[).,!?]+$/g, "");
    if (!domain) return null;

    const suffix = remainder.slice(firstToken.length).trim();
    return { prefix, domain, suffix };
}

export default function UrlProcessingPopup({
    open,
    title = "Processing your URL",
    message = "This can take a few minutes.",
    error = null,
    onDismiss,
    archiveZipUrl = null,
    archiveZipBytes = null,
    stage = "processing",
}: UrlProcessingPopupProps) {
    const [remoteBytes, setRemoteBytes] = useState<number | null>(null);
    const [tick, setTick] = useState(() => Date.now());
    const startedAtRef = useRef<number>(0);

    const resolvedBytes = typeof archiveZipBytes === "number" && Number.isFinite(archiveZipBytes)
        ? archiveZipBytes
        : remoteBytes;

    useEffect(() => {
        if (!open) {
            startedAtRef.current = 0;
            return;
        }
        if (!startedAtRef.current) {
            startedAtRef.current = Date.now();
        }
        setTick(Date.now());
    }, [open]);

    useEffect(() => {
        if (!open || resolvedBytes || !archiveZipUrl) return;

        let cancelled = false;
        const controller = new AbortController();

        void (async () => {
            try {
                const response = await fetch(archiveZipUrl, {
                    method: "HEAD",
                    mode: "cors",
                    credentials: "omit",
                    signal: controller.signal,
                });

                const length = response.headers.get("content-length");
                const parsed = Number(length || "");
                if (!cancelled && Number.isFinite(parsed) && parsed > 0) {
                    setRemoteBytes(parsed);
                }
            } catch {
                // Best effort only.
            }
        })();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [open, archiveZipUrl, resolvedBytes]);

    const isProgressActive = open && !error && stage !== "error";

    useEffect(() => {
        if (!isProgressActive) return;

        const intervalId = window.setInterval(() => {
            setTick(Date.now());
        }, 250);

        return () => window.clearInterval(intervalId);
    }, [isProgressActive]);

    const progress = useMemo(() => {
        if (!open) return 0;
        if (error || stage === "error" || stage === "ready" || stage === "navigating") return 100;

        const elapsed = Math.max(0, tick - startedAtRef.current);
        const duration = estimateDurationMs(resolvedBytes);
        const base = elapsed / duration;
        const stageFloor =
            stage === "submitting" ? 0.08 :
            stage === "creating" ? 0.18 :
            stage === "finishing" ? 0.72 :
            0.12;
        const stageCeiling =
            stage === "finishing" ? 0.98 :
            0.94;

        const value = stageFloor + (base * (stageCeiling - stageFloor));
        return clamp(Math.round(value * 100), 0, 98);
    }, [open, error, tick, resolvedBytes, stage]);

    const percentLabel = error ? "100%" : `${progress}%`;
    const helperText = error ? error : message;
    const byteLabel = formatBytes(resolvedBytes);
    const displayTitle = useMemo(() => {
        if (error) return title || "URL processing failed";
        if (stage === "ready") return "Ready";
        if (stage === "navigating") return "Opening editor";

        if (progress >= 92) return "Opening editor";
        if (progress >= 80) return "Preparing editor";
        if (progress >= 55) return "Building your site";
        if (progress >= 25) return "Gathering content";
        return "Processing your URL";
    }, [error, progress, stage, title]);
    const verifyDomainMessage = useMemo(
        () => (error ? parseVerifyDomainMessage(error) : null),
        [error],
    );

    return (
        <AnimatePresence>
            {open ? (
                <motion.div
                    key="url-processing-popup"
                    className="fixed inset-0 z-[18000] flex min-h-screen items-center justify-center bg-white/85 px-4 backdrop-blur-[8px]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: "easeOut" }}
                    role="dialog"
                    aria-modal="true"
                    aria-label="URL processing"
                >
                    <motion.div
                        className="flex w-full max-w-4xl flex-col justify-center"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.45, ease: "easeOut" }}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1 pr-4">
                                <div className="text-[10px] uppercase tracking-[0.24em] text-neutral-400">
                                    {error ? "Error" : stage === "navigating" ? "Opening" : stage === "ready" ? "Ready" : "Working"}
                                </div>
                                <div className="relative mt-1 min-h-[2.25rem] sm:min-h-[2.5rem]">
                                    <AnimatePresence mode="wait" initial={false}>
                                        <motion.div
                                            key={displayTitle}
                                            className="absolute inset-0 whitespace-nowrap text-[22px] font-normal leading-tight tracking-[-0.03em] text-neutral-900 sm:text-[26px]"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.18, ease: "easeOut" }}
                                        >
                                            {displayTitle}
                                        </motion.div>
                                    </AnimatePresence>
                                </div>
                            </div>

                            <div className="shrink-0 min-h-[3.25rem] text-right pt-1">
                                {onDismiss ? (
                                    <button
                                        type="button"
                                        onClick={onDismiss}
                                        className="mb-2 inline-flex h-8 w-8 items-center justify-center self-end text-neutral-600 transition hover:text-neutral-950"
                                        aria-label={error ? "Close and stop scan" : "Stop scan"}
                                        title={error ? "Close and stop scan" : "Stop scan"}
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                ) : null}
                                <motion.div
                                    className="text-[11px] font-normal tracking-[0.18em] text-neutral-500"
                                    initial={{ opacity: 0, y: -2 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.18 }}
                                >
                                    {percentLabel}
                                </motion.div>
                                <div className={`mt-1 text-[10px] tracking-[0.12em] ${!error && byteLabel ? "text-neutral-400" : "invisible"}`}>
                                    {byteLabel || "0 KB"}
                                </div>
                            </div>
                        </div>

                        <div className="mt-5 flex flex-col items-start">
                            <div className="flex items-center gap-2" aria-hidden="true">
                                <span className={error ? "kloner-dot !animate-none" : "kloner-dot"} />
                                <span className={error ? "kloner-dot !animate-none" : "kloner-dot"} />
                                <span className={error ? "kloner-dot !animate-none" : "kloner-dot"} />
                            </div>
                            <div className="mt-3 text-sm font-normal leading-5 tracking-[-0.01em] text-neutral-900">
                                {verifyDomainMessage ? (
                                    <>
                                        {verifyDomainMessage.prefix}
                                        <a
                                            href={`https://${verifyDomainMessage.domain}`}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            className="inline-flex items-center gap-1 font-semibold underline decoration-current underline-offset-2 transition hover:text-neutral-700"
                                        >
                                            {verifyDomainMessage.domain}
                                            <ExternalLink className="h-3.5 w-3.5" />
                                        </a>
                                        {verifyDomainMessage.suffix ? ` ${verifyDomainMessage.suffix}` : ""}
                                    </>
                                ) : (
                                    helperText
                                )}
                            </div>
                        </div>

                        {!error ? (
                            <div className="mt-8 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                                <motion.div
                                    className="h-full rounded-full bg-[#FF8D21]"
                                    initial={{ width: "0%" }}
                                    animate={{ width: `${progress}%` }}
                                    transition={{ duration: 0.3, ease: "easeOut" }}
                                />
                            </div>
                        ) : null}
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
