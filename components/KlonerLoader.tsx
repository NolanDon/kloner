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
            <div className="text-center text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
                {current}%
            </div>
            <div className="mt-1 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
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
        <div className={className}>
            <div
                className="rounded-[28px] p-[1px]"
                style={{
                    backgroundImage: "linear-gradient(90deg, rgba(255,141,33,0.35), rgba(255,141,33,0.85), rgba(255,141,33,0.35))",
                    backgroundSize: "220% 220%",
                    animation: "kloner-accent-move 2.8s linear infinite",
                }}
            >
                <div className="flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-1.5 text-[15px] text-neutral-900 shadow-[0_10px_30px_rgba(0,0,0,0.10)] ring-[0.5] ring-black/5 backdrop-blur">
                    <span
                        className="bg-clip-text text-transparent font-semibold tracking-tight"
                        style={{
                            backgroundImage: "linear-gradient(90deg, rgba(255,141,33,0.6), rgba(255,141,33,1), rgba(255,141,33,0.6))",
                            backgroundSize: "220% 220%",
                            animation: "kloner-accent-move 2.8s linear infinite",
                        }}
                    >
                        {label}
                    </span>
                    <span className="inline-flex items-center gap-1 leading-none" aria-hidden="true">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#FF8D21] kloner-dot" />
                        <span
                            className="h-1.5 w-1.5 rounded-full bg-[#FF8D21] kloner-dot"
                            style={{ opacity: 0.75, animationDelay: "0.15s" }}
                        />
                        <span
                            className="h-1.5 w-1.5 rounded-full bg-[#FF8D21] kloner-dot"
                            style={{ opacity: 0.45, animationDelay: "0.30s" }}
                        />
                    </span>
                    <style jsx>{`
                        @keyframes kloner-accent-move {
                            0% {
                                background-position: 0% 50%;
                            }
                            50% {
                                background-position: 100% 50%;
                            }
                            100% {
                                background-position: 0% 50%;
                            }
                        }

                        @keyframes klonerDots {
                            0%,
                            80%,
                            100% {
                                transform: translateY(0);
                                opacity: 0.25;
                            }
                            40% {
                                transform: translateY(-3px);
                                opacity: 1;
                            }
                        }

                        .kloner-dot {
                            animation: klonerDots 0.9s ease-in-out infinite;
                        }
                    `}</style>
                </div>
            </div>
        </div>
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
            <div className="mt-2 sm:mt-3 mb-4 mx-2 sm:mx-3 md:mx-4 rounded-2xl bg-white p-5 sm:p-6 grid place-items-center min-h-[160px] shadow-sm">
                {showMilestones ? (
                    <div className="w-full max-w-md">
                        <MilestoneProgress progress={progress} milestones={milestones} />
                        {(label || sublabel) ? (
                            <div className="mt-4 text-center">
                                {label ? <div className="text-sm font-semibold text-neutral-900">{label}</div> : null}
                                {sublabel ? <div className="mt-1 text-xs leading-5 text-neutral-500">{sublabel}</div> : null}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <>
                        {spinner}
                        {(label || sublabel) ? (
                            <div className="mt-3 text-center">
                                {label ? <div className="text-sm font-semibold text-neutral-900">{label}</div> : null}
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
