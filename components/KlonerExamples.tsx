// components/KlonerExamples.tsx
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Image from "next/image";
import logo from "@/public/images/orange_logo.png";

type Slide = {
    src: string;
    alt?: string;
    label?: string;
    sublabel?: string;
};

const slides: Slide[] = [
    {
        src: "/images/showcase/showcase1.jpg",
        alt: "Dusk Til Dawn Carnival",
        label: "Dusk Til Dawn",
        sublabel: "Event Landing Page",
    },
    {
        src: "/images/showcase/showcase2.jpg",
        alt: "Therapy practice website",
        label: "Grounded Collective Therapy Group",
        sublabel: "Practice Website",
    },
    {
        src: "/images/showcase/showcase3.jpg",
        alt: "Wolfer SaaS landing page",
        label: "Wolfer",
        sublabel: "SaaS Landing Page",
    },
    {
        src: "/images/showcase/showcase4.jpg",
        alt: "Creative director portfolio",
        label: "ToyBox Productions",
        sublabel: "Portfolio Website",
    },
    {
        src: "/images/showcase/showcase5.jpg",
        alt: "Veristay rental platform",
        label: "Veristay",
        sublabel: "Short-term Rental Landing Page",
    },
];

type DeckImageCarouselProps = {
    items?: Slide[];
    autoPlayMs?: number;
};

function ChevronLeft({ className = "h-4 w-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                d="M14.5 5.5L8 12l6.5 6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function ChevronRight({ className = "h-4 w-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                d="M9.5 5.5L16 12l-6.5 6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export default function DeckImageCarousel({
    items,
    autoPlayMs = 6500,
}: DeckImageCarouselProps) {
    const data = items && items.length > 0 ? items : slides;
    const [activeIndex, setActiveIndex] = useState(0);

    const goPrev = useCallback(() => {
        setActiveIndex((prev) => (prev - 1 + data.length) % data.length);
    }, [data.length]);

    const goNext = useCallback(() => {
        setActiveIndex((prev) => (prev + 1) % data.length);
    }, [data.length]);

    // autoplay
    useEffect(() => {
        if (data.length <= 1) return;
        const id = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % data.length);
        }, autoPlayMs);
        return () => clearInterval(id);
    }, [data.length, autoPlayMs]);

    // keyboard support (minimal, no UI change)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") goPrev();
            if (e.key === "ArrowRight") goNext();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [goPrev, goNext]);

    // core layout logic: compute relative position in deck
    const layout = useMemo(() => {
        const len = data.length;
        return data.map((_, idx) => {
            let delta = (idx - activeIndex + len) % len;
            if (delta > len / 2) delta -= len;

            if (delta < -2 || delta > 2) {
                return {
                    translateX: 0,
                    translateY: 40,
                    scale: 0.86,
                    opacity: 0,
                    zIndex: 0,
                    blur: 3,
                    delta,
                };
            }

            if (delta === 0) {
                return {
                    translateX: 0,
                    translateY: 0,
                    scale: 1,
                    opacity: 1,
                    zIndex: 40,
                    blur: 0,
                    delta,
                };
            }

            const sign = delta > 0 ? 1 : -1;
            const abs = Math.abs(delta);

            const translateX = sign * (abs === 1 ? 40 : 70);
            const translateY = abs === 1 ? 10 : 24;
            const scale = abs === 1 ? 0.96 : 0.92;
            const opacity = abs === 1 ? 0.9 : 0.7;
            const zIndex = abs === 1 ? 30 : 20;
            const blur = abs === 1 ? 0 : 2;

            return {
                translateX,
                translateY,
                scale,
                opacity,
                zIndex,
                blur,
                delta,
            };
        });
    }, [data, activeIndex]);

    return (
        <section className="w-full py-10 sm:py-12">
            <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 sm:px-6 lg:px-8">
                <div className="mb-6 flex w-full items-center gap-4">
                    {/* Left: "Built With" + logo */}
                    <div className="flex items-center gap-4">
                        <h2 className="mt-1 flex items-center justify-center text-lg text-neutral-600">
                            <span className="text-[16px] uppercase tracking-[0.1em] text-neutral-500">
                                Built With
                            </span>
                            <span className="relative inline-block h-[120px] w-[120px]">
                                <Image
                                    src={logo}
                                    alt="Kloner logo"
                                    fill
                                    className="object-contain"
                                />
                            </span>
                        </h2>
                    </div>

                    {/* Middle: desktop dots */}
                    <div className="hidden items-center gap-2 sm:flex">
                        {data.map((_, idx) => {
                            const isActive = idx === activeIndex;
                            return (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setActiveIndex(idx)}
                                    className={[
                                        "h-1.5 rounded-full transition-all duration-500 ease-out",
                                        isActive
                                            ? "w-6 bg-white"
                                            : "w-2 bg-white/30 hover:bg-white/60",
                                    ].join(" ")}
                                    aria-label={`Go to slide ${idx + 1}`}
                                />
                            );
                        })}
                    </div>

                    {/* Right: community builds link */}
                    <a
                        href="/community-builds"
                        className="ml-auto hidden md:inline-flex items-center rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/70 hover:text-black hover:shadow-sm"
                    >
                        Explore all community builds
                    </a>
                </div>

                <div className="relative flex w-full items-center justify-center">
                    <div className="relative h-[22rem] w-full max-w-4xl sm:h-[26rem] md:h-[30rem]">
                        {/* subtle backdrop */}
                        <div className="pointer-events-none absolute inset-0 -z-10">
                            <div className="absolute inset-x-10 bottom-0 h-32 rounded-full bg-white blur-3xl" />
                        </div>

                        {/* subtle left/right arrows */}
                        {data.length > 1 ? (
                            <>
                                <button
                                    type="button"
                                    onClick={goPrev}
                                    aria-label="Previous card"
                                    className={[
                                        "absolute left-0 top-1/2 z-50 -translate-y-1/2",
                                        "h-9 w-9 rounded-full",
                                        "bg-white/90 text-black/90 backdrop-blur",
                                        "shadow-[0_10px_24px_rgba(0,0,0,0.35)]",
                                        "transition-transform duration-150 ease-out hover:-translate-x-[2px]",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900",
                                    ].join(" ")}
                                >
                                    <ChevronLeft className="mx-auto h-4 w-4" />
                                </button>

                                <button
                                    type="button"
                                    onClick={goNext}
                                    aria-label="Next card"
                                    className={[
                                        "absolute right-0 top-1/2 z-50 -translate-y-1/2",
                                        "h-9 w-9 rounded-full",
                                        "bg-white/90 text-black/90 backdrop-blur",
                                        "shadow-[0_10px_24px_rgba(0,0,0,0.35)]",
                                        "transition-transform duration-150 ease-out hover:translate-x-[2px]",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900",
                                    ].join(" ")}
                                >
                                    <ChevronRight className="mx-auto h-4 w-4" />
                                </button>
                            </>
                        ) : null}

                        {data.map((item, idx) => {
                            const state = layout[idx];
                            if (!state) return null;
                            if (state.opacity === 0) return null;

                            // only center card is clickable now
                            const isCenter = state.delta === 0;

                            return (
                                <div
                                    key={idx}
                                    className={[
                                        "absolute inset-0 mx-auto flex h-full max-w-[96%] items-stretch justify-center",
                                        "rounded-[28px] border border-white/6 bg-gradient-to-br from-neutral-900 via-neutral-950 to-black",
                                        "shadow-[0_24px_60px_rgba(0,0,0,0.5)]",
                                        "transition-[transform,opacity] duration-[1300ms]",
                                        "ease-[cubic-bezier(0.25,0.8,0.3,1)] will-change-transform",
                                        "overflow-hidden",
                                    ].join(" ")}
                                    style={{
                                        transform: `translate3d(${state.translateX}px, ${state.translateY}px, 0) scale(${state.scale})`,
                                        opacity: state.opacity,
                                        zIndex: state.zIndex,
                                        pointerEvents: state.opacity < 0.15 ? "none" : "auto",
                                        filter: state.blur ? `blur(${state.blur}px)` : undefined,
                                    }}
                                    aria-hidden={!isCenter}
                                >
                                    <div className="flex w-full flex-col">
                                        <div className="relative h-3/4 w-full">
                                            <Image
                                                src={item.src}
                                                alt={item.alt || item.label || "Showcase image"}
                                                fill
                                                priority={idx === 0}
                                                className="object-cover object-top"
                                            />
                                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/80" />
                                            <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[10px] font-medium text-neutral-800 sm:left-6 sm:top-5 sm:text-[11px]">
                                                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                                Live preview
                                            </div>
                                        </div>

                                        <div className="flex flex-1 items-center bg-white justify-between gap-4 px-5 py-2">
                                            <div className="min-w-0">
                                                {item.sublabel && (
                                                    <p className="text-[10px] uppercase tracking-[0.28em] text-neutral-800 sm:text-[11px]">
                                                        {item.sublabel}
                                                    </p>
                                                )}
                                                {item.label && (
                                                    <p className="mt-1 truncate text-[14px] font-semibold text-neutral-800 sm:text-[15px] md:text-base">
                                                        {item.label}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* center-only click target (keeps “card is clickable” behavior without bring-forward) */}
                                        {isCenter ? (
                                            <button
                                                type="button"
                                                onClick={goNext}
                                                className="absolute inset-0"
                                                aria-label="Next card"
                                            />
                                        ) : null}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* mobile dots */}
                <div className="mt-5 flex w-full items-center justify-center gap-2 sm:hidden">
                    {data.map((_, idx) => {
                        const isActive = idx === activeIndex;
                        return (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => setActiveIndex(idx)}
                                className={[
                                    "h-1.5 rounded-full transition-all duration-500 ease-out",
                                    isActive
                                        ? "w-6 bg-white"
                                        : "w-2 bg-white/30 hover:bg-white/60",
                                ].join(" ")}
                                aria-label={`Go to slide ${idx + 1}`}
                            />
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
