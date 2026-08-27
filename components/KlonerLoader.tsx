"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

const ACCENT = "#FF8D21";

type KlonerLoaderProps = {
    inline?: boolean;
    icon?: boolean;
    label?: string;
    sublabel?: string;
    progress?: number | null;
    milestones?: number[];
    showMilestones?: boolean;
};

type HydrationDotsLoaderProps = {
    label?: string;
    className?: string;
};

type WorkspaceLoadingPanelProps = {
    title: string;
    className?: string;
    progressItems?: Array<{
        label: string;
        detail?: string;
        done: boolean;
    }>;
};

type WorkspaceLoadingScreenProps = WorkspaceLoadingPanelProps & {
    timeoutMs?: number;
    timeoutTitle?: string;
    timeoutMessage?: string;
    timeoutActionLabel?: string;
    onTimeoutAction?: () => void;
};

const DEFAULT_WORKSPACE_LOADING_TIMEOUT_MS = 5 * 60 * 1000;

function clampProgress(value: number | null | undefined) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}

export function MilestoneProgress({
    progress,
    milestones = [20, 40, 60, 80, 100],
    className = "",
}: {
    progress?: number | null;
    milestones?: number[];
    className?: string;
}) {
    const current = clampProgress(progress);
    const safeMilestones = milestones.length ? milestones : [20, 40, 60, 80, 100];

    return (
        <div className={className}>
            <div className="text-center text-4xl tracking-tight text-neutral-900 sm:text-5xl">
                {current}%
            </div>
            <div className="mt-1 text-center text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                {current >= 100 ? "complete" : "loading"}
            </div>
            <div className="relative mt-8 w-full py-2">
                <div className="absolute left-[7%] right-[7%] top-1/2 -translate-y-1/2" aria-hidden="true">
                    <div className="h-[2px] w-full rounded-full bg-neutral-200" />
                    <div
                        className="absolute left-0 top-0 h-[2px] rounded-full bg-[#FF8D21] transition-[width] duration-300 ease-out"
                        style={{ width: `${current}%` }}
                    />
                </div>
                <div className="relative flex w-full items-center justify-between gap-2">
                    {safeMilestones.map((milestone) => {
                        const reached = current >= milestone;
                        return (
                            <div key={milestone} className="relative flex min-w-0 flex-1 items-center justify-center">
                                <span
                                    className={`relative z-10 h-4 w-4 rounded-full border-2 transition-all ${
                                        reached
                                            ? "border-[#FF8D21] bg-[#FF8D21] shadow-[0_0_0_5px_rgba(255,141,33,0.12)]"
                                            : "border-neutral-300 bg-white"
                                    }`}
                                    aria-hidden="true"
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export function HydrationDotsLoader({
    label = "Hydrating project…",
    className = "",
}: HydrationDotsLoaderProps) {
    return (
        <div className={`flex flex-col items-center text-center ${className}`}>
            <div className="kloner-dots" aria-hidden="true">
                <span className="kloner-dot" />
                <span className="kloner-dot" />
                <span className="kloner-dot" />
            </div>
            <div className="mt-3 text-sm leading-5 tracking-[-0.01em] text-neutral-900">
                {label}
            </div>
        </div>
    );
}

export function WorkspaceLoadingPanel({
    title,
    className = "",
    progressItems,
}: WorkspaceLoadingPanelProps) {
    const doneCount = progressItems?.filter((item) => item.done).length || 0;
    const totalCount = progressItems?.length || 0;
    const progressListRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const list = progressListRef.current;
        if (!list || !progressItems?.length) return;
        list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }, [doneCount, progressItems?.length]);

    return (
        <motion.div
            className={`flex flex-col items-center text-center ${className}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
        >
            <div className="kloner-dots" aria-hidden="true">
                <span className="kloner-dot" />
                <span className="kloner-dot" />
                <span className="kloner-dot" />
            </div>
            <div className="mt-3 text-sm leading-5 tracking-[-0.01em] text-neutral-900">
                {title}
            </div>
            {progressItems?.length ? (
                <div className="mt-5 w-full max-w-md rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm">
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-neutral-400">
                        <span>Preview files</span>
                        <span>{doneCount}/{totalCount}</span>
                    </div>
                    <div ref={progressListRef} className="mt-3 max-h-44 space-y-2 overflow-auto pr-1">
                        {progressItems.map((item) => (
                            <div
                                key={`${item.label}-${item.detail || "item"}`}
                                className="flex items-start gap-3 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2"
                            >
                                <span
                                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                                        item.done
                                            ? "bg-emerald-500 text-white"
                                            : "bg-neutral-200 text-neutral-500"
                                    }`}
                                    aria-hidden="true"
                                >
                                    {item.done ? "✓" : "…"}
                                </span>
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-neutral-900">
                                        {item.label}
                                    </div>
                                    {item.detail ? (
                                        <div className="truncate text-[11px] leading-5 text-neutral-500">
                                            {item.detail}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </motion.div>
    );
}

export function WorkspaceLoadingScreen({
    title,
    className = "",
    timeoutMs = DEFAULT_WORKSPACE_LOADING_TIMEOUT_MS,
    timeoutTitle = "Loading is taking longer than expected",
    timeoutMessage = "We’re still trying to open your workspace. You can reload to try again.",
    timeoutActionLabel = "Reload",
    onTimeoutAction,
}: WorkspaceLoadingScreenProps) {
    const [timedOut, setTimedOut] = useState(false);

    useEffect(() => {
        setTimedOut(false);
        if (!timeoutMs || timeoutMs <= 0) return;

        const timeoutId = window.setTimeout(() => {
            setTimedOut(true);
        }, timeoutMs);

        return () => window.clearTimeout(timeoutId);
    }, [timeoutMs]);

    return (
        <motion.div
            className={`fixed inset-0 z-[9999] grid place-items-center px-4 ${className}`}
            role="status"
            aria-live="polite"
            aria-busy={timedOut ? "false" : "true"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
        >
            {timedOut ? (
                <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white px-6 py-6 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
                    <div className="kloner-dots mx-auto" aria-hidden="true">
                        <span className="kloner-dot" />
                        <span className="kloner-dot" />
                        <span className="kloner-dot" />
                    </div>
                    <div className="mt-3 text-[11px] uppercase tracking-[0.22em] text-neutral-400">
                        {title}
                    </div>
                    <div className="mt-2 text-[22px] font-normal leading-tight tracking-[-0.03em] text-neutral-900">
                        {timeoutTitle}
                    </div>
                    <div className="mt-3 text-sm leading-6 text-neutral-600">
                        {timeoutMessage}
                    </div>
                    <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
                        <button
                            type="button"
                            onClick={() => {
                                if (onTimeoutAction) {
                                    onTimeoutAction();
                                    return;
                                }
                                window.location.reload();
                            }}
                            className="inline-flex items-center justify-center rounded-full bg-[#FF8D21] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e77810]"
                        >
                            {timeoutActionLabel}
                        </button>
                    </div>
                </div>
            ) : (
                <WorkspaceLoadingPanel title={title} />
            )}
        </motion.div>
    );
}

export default function KlonerLoader({
    inline = false,
    icon = false,
    label,
    sublabel,
    progress,
    milestones = [20, 40, 60, 80, 100],
    showMilestones = false,
}: KlonerLoaderProps = {}) {
    const spinner = (
        <motion.div
            className={icon ? "relative h-8 w-8" : "relative h-10 w-10"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
        >
            <motion.span
                className={`absolute inset-0 rounded-full border-2 border-t-transparent ${icon ? "border-neutral-300 border-t-neutral-700" : ""}`}
                style={icon ? undefined : {
                    borderColor: ACCENT,
                    borderTopColor: "transparent",
                }}
                initial={{ rotate: 0 }}
                animate={{ rotate: 360 }}
                transition={{
                    duration: 1.1,
                    repeat: Infinity,
                    repeatType: "loop",
                    ease: "linear",
                }}
            />
        </motion.div>
    );

    if (icon) {
        return spinner;
    }

    if (inline) {
        return (
            <div className="mt-2 sm:mt-3 mb-4 mx-2 sm:mx-3 md:mx-4 min-h-[160px] rounded-2xl border border-neutral-200 bg-white px-6 py-8 shadow-sm grid place-items-center">
                {showMilestones ? (
                    <div className="w-full max-w-md">
                        <MilestoneProgress progress={progress} milestones={milestones} />
                        {(label || sublabel) ? (
                            <div className="mt-4 text-center">
                                {label ? <div className="text-sm leading-5 tracking-[-0.01em] text-neutral-900">{label}</div> : null}
                                {sublabel ? <div className="mt-1 text-xs leading-5 text-neutral-500">{sublabel}</div> : null}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <>
                        {spinner}
                        {(label || sublabel) ? (
                            <div className="mt-3 text-center">
                                {label ? <div className="text-sm text-neutral-900">{label}</div> : null}
                                {sublabel ? <div className="mt-1 text-xs leading-5 text-neutral-500">{sublabel}</div> : null}
                            </div>
                        ) : null}
                    </>
                )}
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-white">
            {spinner}
        </div>
    );
}
