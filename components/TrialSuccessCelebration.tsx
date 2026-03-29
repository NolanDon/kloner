"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Lottie from "lottie-react";
import { CheckCircle2, X } from "lucide-react";
import Image from "next/image";
import logo from "@/public/images/orange_logo.png";

const CONFETTI_URL = "/lotties/confetti.json";

type TrialSuccessCelebrationProps = {
    open: boolean;
    onDismiss: () => void;
};

export default function TrialSuccessCelebration({ open, onDismiss }: TrialSuccessCelebrationProps) {
    const [animationData, setAnimationData] = useState<any>(null);
    const [animationError, setAnimationError] = useState(false);

    useEffect(() => {
        if (!open) return;

        let cancelled = false;
        setAnimationError(false);
        setAnimationData(null);

        void fetch(CONFETTI_URL, { cache: "no-store" })
            .then((res) => {
                if (!res.ok) throw new Error("missing confetti animation");
                return res.json();
            })
            .then((json) => {
                if (!cancelled) setAnimationData(json);
            })
            .catch(() => {
                if (!cancelled) setAnimationError(true);
            });

        return () => {
            cancelled = true;
        };
    }, [open, onDismiss]);

    if (!open || typeof document === "undefined") return null;

    return createPortal(
        <div className="fixed inset-0 z-[26000]">
            <div className="absolute inset-0 bg-white/72 backdrop-blur-[8px]" onClick={onDismiss} />
            <div className="relative flex h-full items-center justify-center px-4 py-8">
                <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-neutral-200 bg-white text-neutral-900 shadow-[0_28px_120px_rgba(15,23,42,0.16)]">
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-800"
                        aria-label="Close celebration"
                    >
                        <X className="h-4 w-4" />
                    </button>

                    <div className="relative px-6 pb-6 pt-8 sm:px-8 sm:pb-8">
                        <div className="relative flex flex-col items-center text-center">
                            <div className="mb-0.5">
                                <Image
                                    src={logo}
                                    alt="Kloner"
                                    width={120}
                                    height={36}
                                    className="h-auto w-[120px] object-contain"
                                    priority
                                />
                            </div>

                            <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full border border-sky-100 bg-sky-50 text-sky-600">
                                <CheckCircle2 className="h-6 w-6" />
                            </div>

                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#f55f2a]">
                                Trial active
                            </p>
                            <h3 className="mt-2 text-3xl font-normal tracking-tight text-neutral-900 sm:text-4xl">
                                Your Kloner trial is ready.
                            </h3>
                            <p className="mt-3 max-w-md text-sm leading-6 text-neutral-600">
                                Start from the dashboard, use Generate website for a landing page, or describe the app in the top prompt if you want a Next.js build.
                            </p>

                            <div className="mt-5 w-full max-w-md rounded-[24px] border border-neutral-200 bg-neutral-50 px-4 py-4">
                                {animationData && !animationError ? (
                                    <div className="pointer-events-none relative h-40 overflow-hidden rounded-[18px] border border-neutral-200 bg-white">
                                        <Lottie
                                            animationData={animationData}
                                            loop={true}
                                            autoplay={true}
                                            className="absolute inset-0 h-full w-full opacity-80"
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
