"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import logo from "@/public/images/orange_logo.png";

type WebsitePrePaywallProps = {
    open: boolean;
    onClose: () => void;
    onStartCheckout: () => void;
    checkoutBusy?: boolean;
    zIndexClassName?: string;
    title?: string;
    description?: string;
    benefits?: string[];
    primaryLabel?: string;
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
    zIndexClassName = "z-[12049]",
    title = "Don't slow down, keep building",
    description = "Build websites with databases, products, and AI integrations, access way more features, then publish them from the same dashboard.",
    benefits = [
        "Deploy 40+ websites per month",
        "One-click publishing",
        "AI task force to build and design your websites",
        "Higher queue priority for faster outputs",
        "24/7 Human support included",
        "Subscriptions starting at only $4.99/wk.",
    ],
    primaryLabel = "Start generating websites →",
    footerNote = "Cancel anytime before renewal.",
}: WebsitePrePaywallProps) {
    if (!open) return null;

    return (
        <motion.div
            className={`website-paywall-overlay fixed inset-0 ${zIndexClassName}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        >
            <motion.div
                className="absolute inset-0 bg-black/70"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            />

            <div className="absolute inset-0 flex items-start justify-center overflow-y-auto px-4 py-6 sm:items-center sm:px-6 sm:py-8">
                <motion.div
                    className="relative w-full max-w-2xl overflow-hidden rounded-[32px] border border-neutral-200 bg-white shadow-[0_30px_120px_rgba(0,0,0,0.24)]"
                    initial={{ opacity: 0, y: 14, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.985 }}
                    transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1], delay: 0.04 }}
                >
                    <button
                        type="button"
                        onClick={onClose}
                        className="absolute right-4 top-4 z-10 inline-flex h-12 w-12 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="Close"
                        title="Close"
                        disabled={checkoutBusy}
                    >
                        <X className="h-5 w-5" />
                    </button>

                    <div className="max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain sm:max-h-[calc(100dvh-4rem)]">
                    <div className="p-5 sm:p-8 lg:p-10">
                        <div className="max-w-xl pr-16">
                            <h3 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                                {title}
                            </h3>
                            <p className="mt-6 text-sm sm:text-base leading-relaxed text-neutral-600">
                                {description}
                            </p>
                        </div>

                        <div className="mt-5 space-y-3">
                            {benefits.map((item) => (
                                <div key={item} className="flex items-start gap-3 text-sm leading-relaxed text-neutral-800">
                                    <span className="mt-[1px] inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold text-accent shrink-0">
                                        ✓
                                    </span>
                                    <span className={/starting at/i.test(item) ? "font-semibold text-neutral-900" : ""}>
                                        {item}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className="mt-7 flex flex-col gap-4">
                            <p className="text-[11px] text-neutral-500 sm:text-xs">
                                {footerNote}
                            </p>

                            <button
                                type="button"
                                onClick={() => {
                                    onStartCheckout();
                                }}
                                className="inline-flex flex-1 items-center justify-center rounded-full bg-[#f55f2a] px-5 py-4 text-[17px] font-semibold tracking-tight text-white shadow-[0_18px_44px_rgba(245,95,42,0.24)] transition hover:translate-y-[-1px] hover:bg-[#f3602c] sm:px-6 sm:py-5 sm:text-[20px]"
                                disabled={checkoutBusy}
                            >
                                {checkoutBusy ? "Redirecting to Stripe…" : primaryLabel}
                            </button>
                        </div>

                        <div className="mt-8 border-t border-neutral-200 pt-6">
                            <div className="mb-3 flex items-center justify-center gap-3 text-center">
                                <span className="text-[12px] uppercase tracking-[0.1em] text-neutral-500 sm:text-[12px]">
                                    See what <span className="text-[15px] font-bold text-[rgba(245,95,42,1)]">5000+</span> Kloner members have built with
                                </span>
                                <span className="relative inline-block h-[48px] w-[48px] sm:h-[72px] sm:w-[72px]">
                                    <Image
                                        src={logo}
                                        alt="Kloner logo"
                                        fill
                                        sizes="(max-width: 640px) 56px, 72px"
                                        className="object-contain"
                                    />
                                </span>
                            </div>

                            <div className="relative overflow-hidden rounded-[28px] border border-neutral-200 bg-white shadow-[0_18px_48px_rgba(0,0,0,0.08)]">
                                <div className="overflow-hidden py-4 sm:py-5">
                                    <div className="website-paywall-carousel flex w-max items-stretch gap-4 px-4">
                                        {[...websitePaywallShowcaseImages, ...websitePaywallShowcaseImages].map((src, index) => (
                                            <div
                                                key={`${src}-${index}`}
                                                className="relative h-[170px] w-[220px] shrink-0 overflow-hidden rounded-[24px] border border-neutral-200 bg-neutral-100 shadow-[0_16px_36px_rgba(0,0,0,0.12)] sm:h-[250px] sm:w-[300px]"
                                            >
                                                <Image
                                                    src={src}
                                                    alt={`Showcase ${index + 1}`}
                                                    fill
                                                    sizes="(min-width: 640px) 300px, 220px"
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
}

export default WebsitePrePaywall;
