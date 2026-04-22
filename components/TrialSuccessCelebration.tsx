"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Lottie from "lottie-react";
import { CheckCircle2, X } from "lucide-react";

const CONFETTI_URL = "/lotties/confetti.json";

let confettiAnimationPromise: Promise<any> | null = null;
let confettiAnimationCache: any | null = null;

type TrialSuccessCelebrationProps = {
    open: boolean;
    onDismiss: () => void;
};

export default function TrialSuccessCelebration({ open, onDismiss }: TrialSuccessCelebrationProps) {
    const [animationData, setAnimationData] = useState<any>(null);
    const [animationError, setAnimationError] = useState(false);
    const [isClosing, setIsClosing] = useState(false);

    useEffect(() => {
        if (!open) return;

        setIsClosing(false);

        let cancelled = false;
        setAnimationError(false);

        if (confettiAnimationCache) {
            setAnimationData(confettiAnimationCache);
            return () => {
                cancelled = true;
            };
        }

        setAnimationData(null);

        if (!confettiAnimationPromise) {
            confettiAnimationPromise = fetch(CONFETTI_URL, { cache: "force-cache" })
                .then((res) => {
                    if (!res.ok) throw new Error("missing confetti animation");
                    return res.json();
                })
                .then((json) => {
                    confettiAnimationCache = json;
                    return json;
                })
                .catch((err) => {
                    confettiAnimationPromise = null;
                    throw err;
                });
        }

        void confettiAnimationPromise
            .then((json) => {
                if (!cancelled) setAnimationData(json);
            })
            .catch(() => {
                if (!cancelled) setAnimationError(true);
            });

        return () => {
            cancelled = true;
        };
    }, [open]);

    if (!open || isClosing || typeof document === "undefined") return null;

    const handleDismiss = () => {
        setIsClosing(true);
        onDismiss();
    };

    return createPortal(
        <div className="fixed inset-0 z-[26000] simple-fade-in">
            <div
                className="absolute inset-0 bg-white/72 backdrop-blur-[8px] simple-fade-in"
                onMouseDown={(e) => {
                    e.preventDefault();
                    handleDismiss();
                }}
                onClick={handleDismiss}
            />
            {animationData && !animationError ? (
                <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
                    <Lottie
                        animationData={animationData}
                        loop={true}
                        autoplay={true}
                        className="absolute inset-0 h-full w-full opacity-70"
                    />
                </div>
            ) : null}
            <div className="relative z-20 flex h-full items-center justify-center px-4 py-8 simple-fade-in">
                <div
                    className="pointer-events-auto relative w-full max-w-lg overflow-hidden rounded-[28px] border border-neutral-200 bg-white text-neutral-900 shadow-[0_28px_120px_rgba(15,23,42,0.16)] simple-fade-in"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDismiss();
                        }}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDismiss();
                        }}
                        className="absolute right-4 top-4 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-800"
                        aria-label="Close celebration"
                    >
                        <X className="h-4 w-4" />
                    </button>

                    <div className="relative px-6 pb-6 pt-8 sm:px-8 sm:pb-8">
                        <div className="relative flex flex-col items-center text-center">
                            <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-emerald-600">
                                <CheckCircle2 className="h-6 w-6" />
                            </div>

                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#f55f2a]">
                                Welcome
                            </p>
                            <h3 className="mt-2 text-3xl font-normal tracking-tight text-neutral-900 sm:text-4xl">
                                Your Kloner account is ready.
                            </h3>
                            <div className="mt-3 max-w-md rounded-[22px] border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm">
                                <p className="text-sm font-semibold text-neutral-900">What to do next:</p>
                                <ol className="mt-2 space-y-2 text-sm leading-6 text-neutral-700">
                                    <li>After closing this modal, click <span className="font-semibold">Generate Website</span> and choose the following:</li>
                                    <li>Pick <span className="font-semibold text-[#f55f2a]">Website (NextJS)</span> for AI, databases, or user accounts.</li>
                                    {/* <li>Try <span className="font-semibold text-[#f55f2a]">Start from template</span> if you want inspiration from the community.</li> */}
                                </ol>
                            </div>

                            <p className="mt-4 max-w-md px-1 text-sm leading-6 text-neutral-600">
                                You&apos;re in the right place now. Kloner is built to help you move from idea to launch quickly.
                            </p>

                            <div className="mt-4 flex justify-center">
                                <button
                                    type="button"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleDismiss();
                                    }}
                                    onClick={handleDismiss}
                                    className="inline-flex items-center justify-center rounded-full bg-[#f55f2a] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(245,95,42,0.24)] transition hover:bg-[#f3602c]"
                                >
                                    Let&apos;s go!
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
