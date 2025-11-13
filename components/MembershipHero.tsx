// components/MembershipHero.tsx
'use client';

import Image from 'next/image';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Shield, Clock4, CreditCard } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { AnimatedCreditCard } from './AnimatedCreditCard';

const BULLETS = [
    'Includes 100 preview credits / month',
    'Clean & Secure codebase with assets captured',
    'One-click deploy to our trusted hosts',
    'Edit text, images, and meta before export',
];

function RotatingCards() {
    const reduce = useReducedMotion();
    const [i, setI] = useState(0);

    const CardShell = ({ children }: { children: React.ReactNode }) => (
        <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-neutral-100">
            {children}
            <div className="absolute bottom-3 left-3 md:bottom-4 md:left-4 rounded-xl px-2.5 py-1 bg-white/90 text-neutral-900 text-xs md:text-sm font-semibold shadow">
                $29<span className="font-normal"> /month</span>
            </div>
        </div>
    );

    const PricePulse = () => (
        <CardShell>
            <div className="absolute inset-0 grid place-content-center">
                <motion.div
                    className="rounded-2xl bg-accent text-white font-semibold text-lg md:text-xl px-5 py-3 shadow-lg"
                    animate={{ scale: [1, 1.06, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.4 }}
                >
                    One-click deploy
                </motion.div>
            </div>
        </CardShell>
    );

    const AddonsMarquee = () => {
        const items = ['HTML → React', 'Image optimization', 'Route mapping', 'SEO tags', 'Font capture'];
        return (
            <CardShell>
                <div className="absolute inset-0 overflow-hidden">
                    <motion.div
                        className="absolute left-0 top-1/2 -translate-y-1/2 flex gap-4 px-4"
                        animate={{ x: ['0%', '-55%'] }}
                        transition={{ duration: 12, ease: 'linear', repeat: Infinity }}
                    >
                        {[...items, ...items].map((k, idx) => (
                            <motion.div
                                key={idx}
                                whileHover={{ rotate: -1.5, y: -4 }}
                                className="shrink-0 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-xs md:text-sm font-medium shadow-sm"
                            >
                                {k}
                            </motion.div>
                        ))}
                    </motion.div>
                </div>
            </CardShell>
        );
    };

    const ConciergeTyping = () => (
        <CardShell>
            <div className="absolute inset-0 flex flex-col justify-end gap-2 p-4">
                <motion.div
                    className="mb-1 inline-flex w-36 items-center justify-center gap-1 self-start rounded-full border border-neutral-200 bg-white/90 px-2 py-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                >
                    <span className="text-[11px] text-neutral-700">1 credit used</span>
                </motion.div>
                <div className="max-w-[72%] rounded-2xl px-3 py-2 text-sm shadow-sm bg-white text-neutral-800 border border-neutral-200">
                    Swap headline and images before export
                </div>
                <div className="max-w-[72%] ml-auto rounded-2xl px-3 py-2 text-sm shadow-sm bg-neutral-900 text-white">
                    Done. Rebuilding preview.
                </div>
            </div>
        </CardShell>
    );

    const PlanChecks = () => {
        const Row = ({ text, delay }: { text: string; delay: number }) => (
            <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white/95 px-3 py-2 shadow-sm">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-600">
                    <motion.path
                        d="M20 6 9 17l-5-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: [0, 1] }}
                        transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1.2, delay }}
                    />
                </svg>
                <span className="text-sm font-medium text-neutral-800">{text}</span>
            </div>
        );

        return (
            <CardShell>
                <div className="absolute inset-0 flex flex-col justify-center gap-3 p-5">
                    <Row text="100 preview credits / month" delay={0.05} />
                    <Row text="Clean export" delay={0.25} />
                    <Row text="One-click deploy" delay={0.45} />
                    <Row text="Keep full control" delay={0.65} />
                </div>
            </CardShell>
        );
    };

    const slides = useMemo(
        () => [
            { key: 'price', label: 'Deploy', node: <PricePulse /> },
            { key: 'addons', label: 'Features', node: <AddonsMarquee /> },
            { key: 'concierge', label: 'Preview', node: <ConciergeTyping /> },
            { key: 'plan', label: 'Export', node: <PlanChecks /> },
        ],
        []
    );

    useEffect(() => {
        if (reduce) return;
        const id = setInterval(() => setI((v) => (v + 1) % slides.length), 3000);
        return () => clearInterval(id);
    }, [slides.length, reduce]);

    return (
        <div className="rounded-3xl border border-neutral-200 bg-white p-3 md:p-4 shadow-sm">
            <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-neutral-100">
                <AnimatePresence initial={false} mode="popLayout">
                    <motion.div
                        key={slides[i].key}
                        initial={{ opacity: 0, scale: 1.02 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        className="absolute inset-0"
                    >
                        {slides[i].node}
                    </motion.div>
                </AnimatePresence>
            </div>

            <div className="mt-3 flex items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {slides.map((s, idx) => (
                    <button
                        key={s.key}
                        onClick={() => setI(idx)}
                        className={`h-8 px-3 shrink-0 rounded-full border text-xs font-medium transition
              ${i === idx ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400'}`}
                        aria-label={`Show ${s.label}`}
                        aria-current={i === idx}
                    >
                        {s.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** ----------------------- Section ----------------------- */
export default function MembershipHero() {
    return (
        <section
            className="
        bg-white text-neutral-900
        pt-[calc(var(--header-h,56px)+20px)]
        md:pt-60
      "
            id="pricing"
        >
            <div className="container-soft space-y-8 md:space-y-14">
                {/* Top: heading */}
                <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 md:gap-4">
                        <div>
                            <h2 className="text-2xl sm:text-3xl md:text-4xl">
                                Built for instant cloning, <br className="hidden sm:block" /> live preview, and one-click deploy
                            </h2>
                            <p className="text-neutral-600 my-3 md:my-4">
                                Credits-based previews with full-code export. Turn any public site into your project in minutes.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Pricing split */}
                <div className="grid lg:grid-cols-12 gap-6 md:gap-12 items-start">
                    {/* Left: rotating cards */}
                    <div className="lg:col-span-5">
                        <AnimatedCreditCard />
                    </div>

                    {/* Right: copy + price + CTA */}
                    <div className="lg:col-span-7">
                        <div className="text-xs md:text-sm text-neutral-500">
                            Preview free, pay when you export
                        </div>
                        <h3 className="text-3xl sm:text-4xl md:text-5xl mt-1 leading-tight">
                            Pro Membership
                        </h3>
                        <p className="text-neutral-600 mt-3 max-w-prose text-[15px] md:text-base">
                            Everything you need to clone, preview, and deploy. Keep full control of your code and hosting.
                        </p>

                        <ul className="mt-4 md:mt-5 space-y-2">
                            {BULLETS.map((b) => (
                                <li key={b} className="flex gap-2">
                                    <Check className="h-5 w-5 mt-0.5 text-emerald-600" />
                                    <span className="text-neutral-800 text-sm md:text-base">{b}</span>
                                </li>
                            ))}
                        </ul>

                        {/* Price + credits */}
                        <div className="mt-5 md:mt-6 flex items-center gap-3">
                            <div className="text-5xl md:text-6xl text-neutral-900">$29</div>
                            <div className="text-neutral-600 text-sm md:text-base">
                                /month · billed monthly or annually
                            </div>
                            <span className="ml-2 inline-flex items-center rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-800">
                                100 preview credits / mo
                            </span>
                        </div>

                        {/* Payment options */}
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                            <span>Flexible payment options</span>
                            {['AMEX', 'VISA', 'Mastercard'].map((label) => (
                                <span
                                    key={label}
                                    className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 bg-white"
                                >
                                    <CreditCard className="h-3.5 w-3.5" />
                                    <span>{label}</span>
                                </span>
                            ))}
                        </div>

                        {/* CTA */}
                        <div className="mt-5 md:mt-6">
                            <a
                                href="#start"
                                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full px-6 py-3 text-white bg-accent hover:bg-accent2 transition"
                            >
                                Start for free today
                            </a>
                        </div>

                        {/* Guarantees row */}
                        <div className="mt-4 flex flex-wrap items-center gap-3 md:gap-4 text-sm text-neutral-600">
                            <span className="inline-flex items-center gap-1.5">
                                <Shield className="h-4 w-4" /> Cancel anytime
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <CreditCard className="h-4 w-4" /> No card for preview
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <Clock4 className="h-4 w-4" /> Deploy in seconds
                            </span>
                        </div>

                        <div className="mt-2 text-xs text-neutral-500">
                            5 credits = 1 preview render. Credits reset monthly. Export includes code, assets, and routes.
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
