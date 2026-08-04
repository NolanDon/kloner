"use client";

import { Lock } from "lucide-react";

type AccessLockBadgeProps = {
    onClick: () => void;
    label?: string;
    hint?: string;
    className?: string;
    center?: boolean;
    dimmed?: boolean;
};

export function AccessLockBadge({
    onClick,
    label = "Unlock",
    hint = "Click to unlock",
    className = "",
    center = false,
    dimmed = true,
}: AccessLockBadgeProps) {
    return (
        <div
            className={`absolute inset-0 z-30 flex ${center ? "items-center justify-center" : "items-start justify-end"} ${className}`}
            aria-hidden="true"
        >
            {dimmed ? <div className="absolute inset-0 rounded-[inherit] bg-white/12" /> : null}
            <button
                type="button"
                onClick={onClick}
                className={[
                    "pointer-events-auto relative z-10 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 hover:text-neutral-900",
                    center ? "m-4" : "m-3",
                ].join(" ")}
                title={hint}
                aria-label={hint}
            >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(245,95,42,0.12)] text-[#f55f2a]">
                    <Lock className="h-3.5 w-3.5" />
                </span>
                <span className="flex min-w-0 flex-col items-start leading-tight">
                    <span>{label}</span>
                </span>
            </button>
        </div>
    );
}

export default AccessLockBadge;
