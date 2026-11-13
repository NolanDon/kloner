"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import KlonerWordmark from "@/components/KlonerWordmark";
import CoinLottieBadge from "@/components/tools/CoinLottieBadge";
import { STRIPE_TRIAL_DAYS, TRIAL_CTA_LABEL } from "@/src/lib/billingAccess";

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
    showTrialChoice?: boolean;
    onStartCheckoutWithChoice?: (useTrial: boolean) => void;
    onTrialChoiceChange?: (useTrial: boolean) => void;
};

const paywallCardHeightPx = 280;
const paywallBenefitIcons = [
    "/images/paywall-icons/website.webp",
    "/images/paywall-icons/publish.webp",
    "/images/paywall-icons/ai.webp",
    "/images/paywall-icons/priority.webp",
    "/images/paywall-icons/support.webp",
];

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
    confirmExit = false,
    checkoutBusy = false,
    zIndexClassName = "z-[2147483647]",
    dismissible = true,
    title = "Don't slow down, keep building",
    description = "Build websites with databases, products, and AI integrations, access way more features, then publish them from the same dashboard.",
    benefits = [
        "Deploy 40+ websites per month",
        "Unlocks one-click publishing",
        "Manual customization editor",
        "AI chat customization editor",
        "Higher queue priority for faster outputs",
        "Human support included",
        "Tokens for AI customization",
    ],
    primaryLabel = TRIAL_CTA_LABEL,
    secondaryLabel = "No thanks, continue with limited features",
    footerNote = "Cancel anytime before renewal.",
    showTrialChoice = false,
    onStartCheckoutWithChoice,
    onTrialChoiceChange,
}: WebsitePrePaywallProps) {
    const carouselSlides = [{ kind: "checklist" as const, title: "What you unlock" }];
    const activeSlide = 0;
    const [showExitConfirmation, setShowExitConfirmation] = useState(false);
    const [useTrial, setUseTrial] = useState(true);
    const [notIncludedExpanded, setNotIncludedExpanded] = useState(false);
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

    if (!open) return null;

    const startCheckout = () => onStartCheckoutWithChoice ? onStartCheckoutWithChoice(useTrial) : onStartCheckout();
    const updateTrialChoice = (checked: boolean) => {
        setUseTrial(checked);
        onTrialChoiceChange?.(checked);
    };
    const checkoutLabel = showTrialChoice
        ? (useTrial ? TRIAL_CTA_LABEL : "Subscribe now — full access")
        : primaryLabel;
    const trialRestrictedBenefits = [
        { text: "Deploy 40+ websites per month", icon: paywallBenefitIcons[0], coin: false },
        { text: "Unlocks one-click deployments", icon: paywallBenefitIcons[1], coin: false },
        { text: "Download your website code", icon: paywallBenefitIcons[2], coin: false },
    ];
    const normalizedBenefits = benefits.flatMap((text) =>
        /AI task force/i.test(text)
            ? ["Manual customization editor", "AI chat customization editor"]
            : [text],
    );
    const includedBenefits = showTrialChoice
        ? normalizedBenefits.slice(2).map((text) => ({
            text: text.replace("24/7 Human support included", "Human support included"),
            coin: /tokens for AI customization/i.test(text),
            icon: /AI chat customization/i.test(text)
                ? paywallBenefitIcons[2]
                : /manual customization/i.test(text)
                    ? paywallBenefitIcons[0]
                    : /queue priority/i.test(text)
                        ? paywallBenefitIcons[3]
                        : /human support/i.test(text)
                            ? paywallBenefitIcons[4]
                            : paywallBenefitIcons[0],
            restricted: false,
        }))
        : normalizedBenefits.map((text, index) => ({
            text,
            coin: /tokens for AI customization/i.test(text),
            icon: paywallBenefitIcons[index % paywallBenefitIcons.length],
            restricted: false,
        }));
    const displayedBenefits = showTrialChoice && !useTrial
        ? [...includedBenefits, ...trialRestrictedBenefits.map((benefit) => ({ ...benefit, restricted: false }))]
        : includedBenefits;
    const checklistHeightPx = Math.max(
        paywallCardHeightPx,
        displayedBenefits.length * 36 + 120 + (showTrialChoice && useTrial ? 16 : 0),
    );

    const modal = (
        <motion.div
            className={`website-paywall-overlay fixed inset-0 ${zIndexClassName}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
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
                className="m-auto w-[calc(100%-1.5rem)] max-w-lg rounded-2xl border border-neutral-200 bg-white p-8 text-neutral-900 shadow-2xl backdrop:bg-black/50 sm:p-9"
            >
                <h3 id={exitTitleId} className="text-2xl font-semibold">Leave your project?</h3>
                <p id={exitDescriptionId} className="mt-3 text-base leading-relaxed text-neutral-600">
                    Unlock your project to keep editing. {STRIPE_TRIAL_DAYS > 0 ? "You can start for free today!" : "Choose a plan to keep building."}
                </p>
                <div className="mt-7 flex flex-col gap-4">
                    <button
                        type="button"
                        onClick={startCheckout}
                        disabled={checkoutBusy}
                        className="min-h-14 rounded-full bg-[#FF8D21] px-6 py-4 text-base font-semibold text-white shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_8px_20px_rgba(255,141,33,0.28)] active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 disabled:hover:scale-100"
                    >
                        {checkoutBusy ? "Redirecting to Stripe…" : confirmExit ? "Unlock my project →" : checkoutLabel}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setShowExitConfirmation(false);
                            onClose();
                        }}
                        disabled={checkoutBusy}
                        className="py-2 text-sm text-neutral-600 underline underline-offset-4 disabled:opacity-70"
                    >
                        Yes, exit editor
                    </button>
                </div>
            </dialog>
            <motion.div
                className="absolute inset-0 bg-black/55 backdrop-blur-2xl backdrop-saturate-150"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            />

            <div className="website-paywall-scroll absolute inset-0 flex items-start justify-center overflow-y-auto px-3 py-4 sm:items-center sm:px-5 sm:py-6">
                <motion.div
                    className="relative w-full max-w-[520px] overflow-hidden rounded-[28px] border border-neutral-200 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:max-w-[580px]"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 3 }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.04 }}
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

                    <div className="website-paywall-scroll max-h-[calc(100dvh-2.25rem)] overflow-y-auto overscroll-contain sm:max-h-[calc(100dvh-3rem)]">
                        <div className="p-4 sm:p-6 lg:p-7">
                            <div className="mx-auto max-w-xl px-4 text-center sm:px-8">
                                <h3 className="text-[1.75rem] leading-tight tracking-tight text-neutral-900 sm:text-[2.35rem]">
                                    {title}
                                </h3>
                                <p className="mt-5 text-sm leading-relaxed text-neutral-600 sm:text-[15px]">
                                    {description}
                                </p>
                            </div>

                            <div className="mt-6 border-t border-neutral-200 pt-4">
                                <div style={{ height: checklistHeightPx }} className="relative bg-transparent">
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
                                                <>
                                                    <div style={{ height: checklistHeightPx }} className="flex flex-col justify-start gap-3 px-2 py-5 sm:px-7 sm:py-8">
                                                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FF8D21]">
                                                            {slide.title}
                                                        </div>
                                                        <div className="flex flex-col gap-3">
                                                            {displayedBenefits.map(({ text: item, icon, coin, restricted }, itemIndex) => (
                                                                <div key={item} className={`flex items-center gap-3 text-[13px] leading-snug text-neutral-800 sm:text-sm ${restricted ? "opacity-65" : ""}`}>
                                                                    {coin ? (
                                                                        <CoinLottieBadge className="paywall-benefit-icon-orange h-[27px] w-[27px] shrink-0" />
                                                                    ) : (
                                                                        <Image src={icon} alt="" width={27} height={27} className="paywall-benefit-icon-orange h-[27px] w-[27px] shrink-0 object-contain" />
                                                                    )}
                                                                    <span className={`${/starting at/i.test(item) ? "font-semibold text-neutral-900" : ""} ${restricted ? "text-neutral-500" : ""}`}>
                                                                        {item}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                            {showTrialChoice && useTrial ? (
                                                                <div className="relative">
                                                                    <button
                                                                        type="button"
                                                                        aria-expanded={notIncludedExpanded}
                                                                        onClick={() => setNotIncludedExpanded((expanded) => !expanded)}
                                                                        className="flex w-fit items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500"
                                                                    >
                                                                        <span>Not included</span>
                                                                        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${notIncludedExpanded ? "rotate-180" : ""}`} />
                                                                    </button>
                                                                    {notIncludedExpanded ? (
                                                                        <div className="website-paywall-not-included-menu absolute left-0 top-full z-30 mt-2 flex w-full flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-xl">
                                                                            {trialRestrictedBenefits.map(({ text: item, icon }) => (
                                                                                <div key={item} className="flex items-center gap-3 text-[13px] leading-snug text-neutral-600 sm:text-sm">
                                                                                    <Image src={icon} alt="" width={27} height={27} className="h-[27px] w-[27px] shrink-0 object-contain" />
                                                                                    <span>{item}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    ) : null}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </>
                                            </div>
                                        ))}
                                    </motion.div>

                                </div>
                            </div>

                            <div className="mt-5 flex flex-col gap-3">
                                {showTrialChoice ? (
                                    <div className="website-paywall-trial-choice flex items-center justify-end gap-2 text-xs text-neutral-600">
                                        <span>{STRIPE_TRIAL_DAYS}-day free trial</span>
                                        <button
                                            type="button"
                                            role="switch"
                                            className={`website-paywall-trial-switch relative inline-flex h-5 w-9 shrink-0 items-center overflow-hidden rounded-full transition-colors ${useTrial ? "bg-[#FF8D21]" : "bg-neutral-300"}`}
                                            aria-checked={useTrial}
                                            aria-label="Use free trial"
                                            onClick={() => updateTrialChoice(!useTrial)}
                                        >
                                            <span className={`website-paywall-trial-thumb absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${useTrial ? "translate-x-4" : "translate-x-0"}`} />
                                        </button>
                                    </div>
                                ) : null}

                                <p className="text-center text-[11px] text-neutral-500 sm:text-xs">
                                    {STRIPE_TRIAL_DAYS > 0 && primaryLabel === TRIAL_CTA_LABEL && (!showTrialChoice || useTrial)
                                        ? `${STRIPE_TRIAL_DAYS}-day free trial. `
                                        : null}
                                    {footerNote}
                                </p>

                                <button
                                    type="button"
                                    onClick={startCheckout}
                                    className="inline-flex min-h-16 w-full items-center justify-center rounded-full bg-[#FF8D21] px-6 py-4 text-xl font-bold tracking-tight text-white shadow-[0_14px_30px_rgba(255,141,33,0.22)] transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_18px_36px_rgba(255,141,33,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8D21] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 disabled:hover:scale-100 sm:min-h-[72px] sm:px-8 sm:py-5 sm:text-2xl"
                                    disabled={checkoutBusy}
                                >
                                    {checkoutBusy ? "Redirecting to Stripe…" : checkoutLabel}
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
                                <div className="mb-2.5 text-center leading-tight">
                                    <div className="flex items-baseline justify-center gap-1.5">
                                        <span className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 sm:text-[11px]">
                                            See what <span className="text-[15px] font-bold text-[rgba(255,141,33,1)]">5000+</span> Kloner members have built with
                                        </span>
                                        <KlonerWordmark className="text-[18px] normal-case sm:text-[20px]" />
                                    </div>
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
