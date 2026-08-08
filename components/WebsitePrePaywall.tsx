"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import logo from "@/public/images/orange_logo.png";
import { TRIAL_CTA_LABEL } from "@/src/lib/billingAccess";

type WebsitePrePaywallProps = {
    open: boolean;
    onClose: () => void;
    onStartCheckout: () => void;
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

const websitePaywallShowcaseImages = [
    "/images/showcase/showcase1.jpg",
    "/images/showcase/showcase2.jpg",
    "/images/showcase/showcase3.jpg",
    "/images/showcase/showcase4.jpg",
    "/images/showcase/showcase5.jpg",
];

export function WebsitePrePaywall({
    open,
    onClose,
    onStartCheckout,
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
        "Subscriptions starting at only $29.99/mo.",
    ],
    primaryLabel = TRIAL_CTA_LABEL,
    secondaryLabel = "No thanks, continue with limited features",
    footerNote = "Cancel anytime before renewal.",
}: WebsitePrePaywallProps) {
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

    if (!open) return null;

    const modal = (
        <motion.div
            className={`website-paywall-overlay fixed inset-0 ${zIndexClassName}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.34, ease: "easeOut" }}
        >
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

                            <div className="mt-4 space-y-2.5">
                                {benefits.map((item) => (
                                    <div key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-neutral-800 sm:text-[14px]">
                                        <span className="mt-[1px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-accent">
                                            ✓
                                        </span>
                                        <span className={/starting at/i.test(item) ? "font-semibold text-neutral-900" : ""}>
                                            {item}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-5 flex flex-col gap-3">
                                <p className="text-center text-[11px] text-neutral-500 sm:text-xs">
                                    {footerNote}
                                </p>

                                <button
                                    type="button"
                                    onClick={onStartCheckout}
                                    className="inline-flex flex-1 items-center justify-center rounded-full bg-[#FF8D21] px-5 py-3.5 text-[15px] font-semibold tracking-tight text-white shadow-[0_14px_30px_rgba(255,141,33,0.22)] transition hover:translate-y-[-1px] hover:bg-[#D96E11] sm:px-6 sm:py-4 sm:text-[17px]"
                                    disabled={checkoutBusy}
                                >
                                    {checkoutBusy ? "Redirecting to Stripe…" : primaryLabel}
                                </button>

                                {secondaryLabel ? (
                                    <button
                                        type="button"
                                        onClick={onClose}
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

                                <div className="relative overflow-hidden rounded-[24px] border border-neutral-200 bg-white shadow-[0_14px_36px_rgba(0,0,0,0.08)]">
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
