// components/DeckImageCarousel.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import logo from "@/public/favicon.ico";

// replace your existing h2 with:
type Slide = {
    src: string;
    alt?: string;
    label?: string;
    sublabel?: string;
};

const slides: Slide[] = [
    {
        src: "/images/showcase/showcase1.jpg",
        alt: "Neo SaaS Landing",
        label: "Neo SaaS Landing",
        sublabel: "SaaS Landing Page",
    },
    {
        src: "/images/showcase/showcase2.jpg",
        alt: "Creative Studio Grid",
        label: "Creative Studio Grid",
        sublabel: "Agency Website",
    },
    {
        src: "/images/showcase/showcase3.jpg",
        alt: "Productized Services",
        label: "Productized Services",
        sublabel: "Founder Stack",
    },
    {
        src: "/images/showcase/showcase4.jpg",
        alt: "Course Creator Hub",
        label: "Course Creator Hub",
        sublabel: "Creator Landing",
    },
    {
        src: "/images/showcase/showcase5.jpg",
        alt: "Launch Template",
        label: "Launch Template",
        sublabel: "Launch Page",
    },
];

type DeckImageCarouselProps = {
    items?: Slide[];
    autoPlayMs?: number;
};

export default function DeckImageCarousel({
    items,
    autoPlayMs = 6500,
}: DeckImageCarouselProps) {
    const data = items && items.length > 0 ? items : slides;
    const [activeIndex, setActiveIndex] = useState(0);

    // autoplay
    useEffect(() => {
        if (data.length <= 1) return;
        const id = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % data.length);
        }, autoPlayMs);
        return () => clearInterval(id);
    }, [data.length, autoPlayMs]);

    // core layout logic: compute relative position in deck
    const layout = useMemo(() => {
        const len = data.length;
        return data.map((_, idx) => {
            // normalize distance on circular track to a signed delta (-floor(len/2) .. +floor(len/2))
            let delta = (idx - activeIndex + len) % len;
            if (delta > len / 2) delta -= len;

            // clamp to at most 2 cards to each side for visuals
            if (delta < -2 || delta > 2) {
                return {
                    translateX: 0,
                    translateY: 40,
                    scale: 0.86,
                    opacity: 0,
                    zIndex: 0,
                    blur: 3,
                };
            }

            // center card
            if (delta === 0) {
                return {
                    translateX: 0,
                    translateY: 0,
                    scale: 1,
                    opacity: 1,
                    zIndex: 40,
                    blur: 0,
                };
            }

            // side cards
            const sign = delta > 0 ? 1 : -1;
            const abs = Math.abs(delta);

            // position and depth falloff
            const translateX = sign * (abs === 1 ? 40 : 70); // px
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
            };
        });
    }, [data, activeIndex]);

    return (
        <section className="w-full py-10 sm:py-12">
            <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 sm:px-6 lg:px-8">
                <div className="mb-6 flex w-full items-center justify-between gap-4">
                    <div className="min-w-0">
                        {/* <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-500">
                            LIVE
                        </p> */}

                        <h2 className="mt-1 flex items-center justify-center gap-2 text-lg text-neutral-600">
                            <span className="relative inline-block h-8 w-8">
                                <Image
                                    src={logo}
                                    alt="Kloner logo"
                                    fill
                                    className="object-contain"
                                />
                            </span>
                            <span className="text-[16px] uppercase tracking-[0.1em] text-neutral-500">
                                Built With Kloner
                            </span>
                        </h2>

                    </div>
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
                </div>

                <div className="relative flex w-full items-center justify-center">
                    <div className="relative h-[22rem] w-full max-w-4xl sm:h-[26rem] md:h-[30rem]">
                        {/* subtle backdrop */}
                        <div className="pointer-events-none absolute inset-0 -z-10">
                            <div className="absolute inset-x-10 bottom-0 h-32 rounded-full bg-white blur-3xl" />
                        </div>

                        {data.map((item, idx) => {
                            const state = layout[idx];

                            return (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setActiveIndex(idx)}
                                    className={[
                                        "absolute inset-0 mx-auto flex h-full max-w-[96%] items-stretch justify-center",
                                        "rounded-[28px] border border-white/6 bg-gradient-to-br from-neutral-900 via-neutral-950 to-black",
                                        "shadow-[0_26px_80px_rgba(0,0,0,0.65)]",
                                        "transition-all duration-[1300ms]",
                                        "ease-[cubic-bezier(0.25,0.8,0.3,1)] will-change-transform will-change-opacity",
                                        "overflow-hidden",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900",
                                    ].join(" ")}
                                    style={{
                                        transform: `translate3d(${state.translateX}px, ${state.translateY}px, 0) scale(${state.scale})`,
                                        opacity: state.opacity,
                                        zIndex: state.zIndex,
                                        filter: state.blur ? `blur(${state.blur}px)` : "none",
                                        pointerEvents: state.opacity < 0.15 ? "none" : "auto",
                                    }}
                                >
                                    <div className="flex w-full flex-col">
                                        <div className="relative h-3/4 w-full">
                                            <Image
                                                src={item.src}
                                                alt={item.alt || item.label || "Showcase image"}
                                                fill
                                                priority={idx === activeIndex}
                                                className="object-cover object-top"
                                            />
                                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/80" />
                                            <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[10px] font-medium text-neutral-800 sm:left-6 sm:top-5 sm:text-[11px]">
                                                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                                Live preview
                                            </div>
                                        </div>

                                        <div className="flex flex-1 items-center bg-white justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5">
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
                                            <div className="flex flex-col items-end gap-1">
                                                <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-medium text-neutral-600 ring-1 ring-white/15 sm:px-4 sm:text-[11px]">
                                                    Slow card snap
                                                </span>
                                                <span className="text-[10px] text-neutral-500 sm:text-[11px]">
                                                    Click to bring forward
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
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
