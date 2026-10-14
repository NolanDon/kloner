"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import logo from "@/public/images/orange_logo.png";
import { BASIC_MONTHLY_PRICE_USD, STRIPE_TRIAL_DAYS, TRIAL_CTA_LABEL } from "@/src/lib/billingAccess";

type WebsitePrePaywallProps = {
    open: boolean;
    onClose: () => void;
    onStartCheckout: () => void;
    confirmExit?: boolean;
    checkoutBusy?: boolean;
    zIndexClassName?: string;
    dismissible?: boolean;
    title?: string;
    description?: ReactNode;
    benefits?: string[];
    primaryLabel?: string;
    secondaryLabel?: string;
    footerNote?: string;
};

const carouselAutoAdvanceMs = [7200, 5600, 5600];
const paywallCardHeightPx = 280;

const websitePaywallShowcaseImages = [
    "/images/showcase/showcase1.jpg",
    "/images/showcase/showcase2.jpg",
    "/images/showcase/showcase3.jpg",
    "/images/showcase/showcase4.jpg",
    "/images/showcase/showcase5.jpg",
];

const testimonialSlides = [
    {
        name: "RJ",
        title: "Product Manager @ Stealth",
        avatar: "/images/avatars/portfolio1.jpg",
        quote:
            "the manual editing saved me a ridiculous amount of time. I like the prompt feature but for small quick edits i love that i can just go in and type new copywrite",
    },
    {
        name: "Jordan B",
        title: "Solopreneur",
        avatar: "/images/avatars/portfolio2.jpg",
        quote:
            "the whole app has been a legit LIFESAVER for me. I run a small team and were burning money waiting on revisions and now I can get client sites out way faster than i expected",
    },
];

export function WebsitePrePaywall({
    open,
    onClose,
    onStartCheckout,
    confirmExit = false,
    checkoutBusy = false,
    zIndexClassName = "z-[2147483647]",
    dismissible = true,
    title = "Don't slow down, keep building",
    description = "Build websites with databases, products, and AI integrations, access way more features, then publish them from the same dashboard.",
    benefits = [
        "Deploy 40+ websites per month",
        "One-click publishing",
        "AI task force to build and design your websites",
        "Higher queue priority for faster outputs",
        "24/7 Human support included",
        `Subscriptions starting at only $${BASIC_MONTHLY_PRICE_USD.toFixed(2)}/mo.`,
    ],
    primaryLabel = TRIAL_CTA_LABEL,
    secondaryLabel = "No thanks, continue with limited features",
    footerNote = "Cancel anytime before renewal.",
}: WebsitePrePaywallProps) {
    const carouselSlides = useMemo(
        () => [
            {
                kind: "checklist" as const,
                title: "What you unlock",
            },
            ...testimonialSlides.map((slide) => ({
            kind: "testimonial" as const,
            ...slide,
            })),
        ],
        [],
    );
    const [activeSlide, setActiveSlide] = useState(0);
    const [showExitConfirmation, setShowExitConfirmation] = useState(false);
    const exitDialogRef = useRef<HTMLDialogElement>(null);
    const exitTitleId = useId();
    const exitDescriptionId = useId();

    useEffect(() => {
        const dialog = exitDialogRef.current;
        if (open && showExitConfirmation) {
            if (dialog && !dialog.open) dialog.showModal();
        } else {
            dialog?.close();
            setShowExitConfirmation(false);
        }
    }, [open, showExitConfirmation]);

    useEffect(() => {
        if (!open) return;

        const docEl = document.documentElement;
        const body = document.body;
        const prevHtmlOverflow = docEl.style.overflow;
        const prevBodyOverflow = body.style.overflow;

        docEl.style.overflow = "hidden";
        body.style.overflow = "hidden";

        return () => {
            docEl.style.overflow = prevHtmlOverflow;
            body.style.overflow = prevBodyOverflow;
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const currentDuration = carouselAutoAdvanceMs[activeSlide] ?? 5200;
        const timer = window.setTimeout(() => {
            setActiveSlide((current) => (current + 1) % carouselSlides.length);
        }, currentDuration);

        return () => window.clearTimeout(timer);
    }, [activeSlide, carouselSlides.length, open]);

    useEffect(() => {
        if (!open) return;
        setActiveSlide(0);
    }, [open]);

    if (!open) return null;

    const modal = (
        <motion.div
            className={`website-paywall-overlay fixed inset-0 ${zIndexClassName}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.34, ease: "easeOut" }}
        >
            <dialog
                ref={exitDialogRef}
                aria-labelledby={exitTitleId}
                aria-describedby={exitDescriptionId}
                onKeyDown={(event) => event.stopPropagation()}
                onCancel={(event) => {
                    event.preventDefault();
                    if (!checkoutBusy) setShowExitConfirmation(false);
                }}
                className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl backdrop:bg-black/50"
            >
                <h3 id={exitTitleId} className="text-xl font-semibold">Leave your project?</h3>
                <p id={exitDescriptionId} className="mt-2 text-sm leading-relaxed text-neutral-600">
                    Unlock your project to keep editing. {STRIPE_TRIAL_DAYS > 0 ? "You can start for free today!" : "Choose a plan to keep building."}
                </p>
                <div className="mt-5 flex flex-col gap-3">
                    <button
                        type="button"
                        onClick={onStartCheckout}
                        disabled={checkoutBusy}
                        className="min-h-12 rounded-full bg-[#FF8D21] px-5 py-3 font-semibold text-white hover:bg-[#D96E11] disabled:cursor-wait disabled:opacity-70"
                    >
                        {checkoutBusy ? "Redirecting to Stripe…" : primaryLabel}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setShowExitConfirmation(false);
                            onClose();
                        }}
                        disabled={checkoutBusy}
                        className="py-1 text-sm text-neutral-600 underline underline-offset-4 disabled:opacity-70"
                    >
                        Exit editor
                    </button>
                </div>
            </dialog>
            <motion.div
                className="absolute inset-0 bg-black/55 backdrop-blur-2xl backdrop-saturate-150"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.34, ease: "easeOut" }}
            />

            <div className="absolute inset-0 flex items-start justify-center overflow-y-auto px-3 py-4 sm:items-center sm:px-5 sm:py-6">
                <motion.div
                    className="relative w-full max-w-[520px] overflow-hidden rounded-[28px] border border-neutral-200 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:max-w-[580px]"
                    initial={{ opacity: 0, y: 10, scale: 0.975 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.38, ease: "easeOut", delay: 0.02 }}
                >
                    {dismissible ? (
                        <button
                            type="button"
                            onClick={onClose}
                            className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border-0 bg-transparent p-0 text-neutral-500 transition hover:bg-transparent hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Close"
                            title="Close"
                            disabled={checkoutBusy}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    ) : null}

                    <div className="max-h-[calc(100dvh-2.25rem)] overflow-y-auto overscroll-contain sm:max-h-[calc(100dvh-3rem)]">
                        <div className="p-4 sm:p-6 lg:p-7">
                            <div className="max-w-lg pr-14">
                                <h3 className="text-2xl tracking-tight text-neutral-900 sm:text-[2.15rem]">
                                    {title}
                                </h3>
                                <p className="mt-4 text-sm leading-relaxed text-neutral-600 sm:text-[15px]">
                                    {description}
                                </p>
                            </div>

                            <div className="mt-6 border-t border-neutral-200 pt-4">
                                <div style={{ height: paywallCardHeightPx }} className="relative overflow-hidden rounded-[24px] border border-transparent bg-white shadow-[0_18px_42px_rgba(0,0,0,0.13)]">
                                    <motion.div
                                        animate={{ x: `${-activeSlide * 100}%` }}
                                        transition={{ type: "spring", stiffness: 120, damping: 22, mass: 0.9 }}
                                        className="flex w-full items-start"
                                    >
                                        {carouselSlides.map((slide, index) => (
                                            <div
                                                key={`${slide.kind}-${index}`}
                                                className={`w-full shrink-0 ${index === activeSlide ? "" : "h-0 overflow-hidden"}`}
                                                aria-hidden={index !== activeSlide}
                                            >
                                                {slide.kind === "checklist" ? (
                                                    <div style={{ height: paywallCardHeightPx }} className="grid grid-cols-2 content-center gap-x-5 gap-y-4 px-5 py-7 sm:gap-x-8 sm:px-8 sm:py-8">
                                                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#FF8D21]">
                                                            {slide.title}
                                                        </div>
                                                        <div className="col-span-2 grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2 sm:gap-x-8">
                                                            {benefits.map((item) => (
                                                                <div
                                                                    key={item}
                                                                    className="flex items-start gap-2 text-[13px] leading-relaxed text-neutral-800 sm:text-sm"
                                                                >
                                                                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base font-semibold text-[#FF8D21]">
                                                                        ✓
                                                                    </span>
                                                                    <span className={/starting at/i.test(item) ? "font-semibold text-neutral-900" : ""}>
                                                                        {item}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ height: paywallCardHeightPx }} className="flex items-center px-6 pb-7 pt-4 sm:px-10 sm:pb-8 sm:pt-5">
                                                        <div className="w-full rounded-[24px]">
                                                            <div className="mb-3 flex items-center gap-3">
                                                                <div className="relative h-11 w-11 overflow-hidden rounded-full border border-neutral-200 bg-neutral-100">
                                                                    <Image
                                                                        src={slide.avatar}
                                                                        alt={`${slide.name} profile photo`}
                                                                        fill
                                                                        sizes="44px"
                                                                        className="object-cover"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <div className="text-sm font-semibold text-neutral-900">{slide.name}</div>
                                                                    <div className="text-xs text-neutral-500">{slide.title}</div>
                                                                </div>
                                                            </div>
                                                            <p className="text-[15px] leading-6 text-neutral-700 sm:text-[16px] sm:leading-7">
                                                                “{slide.quote}”
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </motion.div>

                                </div>
                                <div className="mt-4 flex items-center justify-center gap-3 pb-1">
                                    {carouselSlides.map((slide, index) => (
                                        <button
                                            key={`${slide.kind}-dot-${index}`}
                                            type="button"
                                            onClick={() => setActiveSlide(index)}
                                            className={`h-3 rounded-full transition-all shadow-sm ${index === activeSlide ? "w-8 bg-[#FF8D21]" : "w-3 bg-neutral-300 hover:bg-neutral-400"}`}
                                            aria-label={`Show slide ${index + 1}`}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="mt-5 flex flex-col gap-3">
                                <p className="text-center text-[11px] text-neutral-500 sm:text-xs">
                                    {STRIPE_TRIAL_DAYS > 0 && primaryLabel === TRIAL_CTA_LABEL
                                        ? `${STRIPE_TRIAL_DAYS}-day free trial. `
                                        : null}
                                    {footerNote}
                                </p>

                                <button
                                    type="button"
                                    onClick={onStartCheckout}
                                    className="inline-flex min-h-16 w-full items-center justify-center rounded-full bg-[#FF8D21] px-6 py-4 text-xl font-bold tracking-tight text-white shadow-[0_14px_30px_rgba(255,141,33,0.22)] transition hover:translate-y-[-1px] hover:bg-[#D96E11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D96E11] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 sm:min-h-[72px] sm:px-8 sm:py-5 sm:text-2xl"
                                    disabled={checkoutBusy}
                                >
                                    {checkoutBusy ? "Redirecting to Stripe…" : primaryLabel}
                                </button>

                                {secondaryLabel ? (
                                    <button
                                        type="button"
                                        onClick={() => confirmExit ? setShowExitConfirmation(true) : onClose()}
                                        className="inline-flex items-center justify-center px-1 py-0 text-[13px] font-semibold tracking-tight text-neutral-600 underline underline-offset-4 transition hover:text-neutral-900 sm:text-sm"
                                        disabled={checkoutBusy}
                                    >
                                        {secondaryLabel}
                                    </button>
                                ) : null}

                            </div>

                            <div className="mt-6 border-t border-neutral-200 pt-4">
                                <div className="mb-2.5 flex items-center justify-center gap-3 text-center">
                                    <span className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 sm:text-[11px]">
                                        See what <span className="text-[15px] font-bold text-[rgba(255,141,33,1)]">5000+</span> Kloner members have built with
                                    </span>
                                    <span className="relative inline-block h-[40px] w-[40px] sm:h-[56px] sm:w-[56px]">
                                        <Image
                                            src={logo}
                                            alt="Kloner logo"
                                            fill
                                            sizes="(max-width: 640px) 40px, 56px"
                                            className="object-contain"
                                        />
                                    </span>
                                </div>

                                <div className="relative overflow-hidden rounded-[24px] shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                                    <div className="overflow-hidden py-3 sm:py-4">
                                        <div className="website-paywall-carousel flex w-max items-stretch gap-3 px-3">
                                            {[...websitePaywallShowcaseImages, ...websitePaywallShowcaseImages].map((src, index) => (
                                                <div
                                                    key={`${src}-${index}`}
                                                    className="relative h-[132px] w-[180px] shrink-0 overflow-hidden rounded-[20px] border border-neutral-200 bg-neutral-100 shadow-[0_12px_28px_rgba(0,0,0,0.10)] sm:h-[180px] sm:w-[240px]"
                                                >
                                                    <Image
                                                        src={src}
                                                        alt={`Showcase ${index + 1}`}
                                                        fill
                                                        sizes="(min-width: 640px) 240px, 180px"
                                                        className="object-cover"
                                                        priority={index < 2}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </motion.div>
    );

    if (typeof window === "undefined") {
        return modal;
    }

    return createPortal(modal, document.body);
}

export default WebsitePrePaywall;
