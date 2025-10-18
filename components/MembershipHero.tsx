'use client';

import Image from 'next/image';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Shield, Clock4, CreditCard } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

type Doctor = {
    name: string;
    role: string;
    src: string;
    alt: string;
};

const DOCTORS: Doctor[] = [
    { name: 'Dr Anant Vinjamoori', role: 'Superpower Chief Longevity Officer, Harvard MD & MBA', src: '/images/doctors/anant.jpg', alt: 'Dr Anant Vinjamoori' },
    { name: 'Dr Leigh Erin Connealy', role: 'Clinician & Founder of The Centre for New Medicine', src: '/images/doctors/leigh.jpg', alt: 'Dr Leigh Erin Connealy' },
    { name: 'Dr Abe Malkin', role: 'Founder & Medical Director of Concierge MD', src: '/images/doctors/abe.jpg', alt: 'Dr Abe Malkin' },
    { name: 'Dr Robert Lufkin', role: 'UCLA Medical Professor, NYT Bestselling Author', src: '/images/doctors/robert.jpg', alt: 'Dr Robert Lufkin' },
];

const BULLETS = [
    'One appointment, one draw for your annual panel.',
    '100+ labs tested per year',
    'A personalized plan that evolves with you',
    'Get your biological age and track your health over a lifetime',
];

/** ----------------------- Auto-rotating cards (left) ----------------------- */
/** ----------------------- Auto-rotating animated cards (left) ----------------------- */
function RotatingCards() {
    const reduce = useReducedMotion();
    const [i, setI] = useState(0);

    // mini cards (each loops on its own)
    const CardShell = ({ children }: { children: React.ReactNode }) => (
        <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-neutral-100">
            {children}
            {/* $17 chip */}
            <div className="absolute bottom-3 left-3 md:bottom-4 md:left-4 rounded-xl px-2.5 py-1 bg-white/90 text-neutral-900 text-xs md:text-sm font-semibold shadow">
                $17<span className="font-normal"> /month</span>
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
                    Annual panel included
                </motion.div>
            </div>
        </CardShell>
    );

    const AddonsMarquee = () => {
        const items = ['Gut Microbiome', 'Toxins', 'Cancer Screens', 'Sleep', 'Hormones'];
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
                    className="mb-1 inline-flex w-16 items-center justify-center gap-1 self-start rounded-full border border-neutral-200 bg-white/90 px-2 py-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                >
                    {[0, 1, 2].map((d) => (
                        <motion.span
                            key={d}
                            className="h-1.5 w-1.5 rounded-full bg-neutral-500"
                            animate={{ y: [0, -3, 0] }}
                            transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.12 }}
                        />
                    ))}
                </motion.div>
                <div className="max-w-[72%] rounded-2xl px-3 py-2 text-sm shadow-sm bg-white text-neutral-800 border border-neutral-200">
                    Is magnesium OK with vitamin D?
                </div>
                <div className="max-w-[72%] ml-auto rounded-2xl px-3 py-2 text-sm shadow-sm bg-neutral-900 text-white">
                    Yes, and I’ll add a reminder to your plan.
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
                    <Row text="Diet" delay={0.05} />
                    <Row text="Lifestyle" delay={0.25} />
                    <Row text="Supplements" delay={0.45} />
                    <Row text="Rx" delay={0.65} />
                </div>
            </CardShell>
        );
    };

    const slides = useMemo(
        () => [
            { key: 'price', label: 'Membership', node: <PricePulse /> },
            { key: 'addons', label: 'Add-ons', node: <AddonsMarquee /> },
            { key: 'concierge', label: 'Concierge', node: <ConciergeTyping /> },
            { key: 'plan', label: 'Plan', node: <PlanChecks /> },
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
            {/* stage */}
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

            {/* thumbnails — small pills you can tap to jump */}
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
        >
            <div className="container-soft space-y-8 md:space-y-14">
                {/* Top: heading + logos + doctors */}
                <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 md:gap-4">
                        <div>
                            <h2 className="text-2xl sm:text-3xl md:text-4xl">
                                Developed by world-class medical
                                <br className="hidden sm:block" /> professionals
                            </h2>
                            <p className="text-neutral-600 my-3 md:my-4">
                                Supported by the world’s top longevity clinicians and MDs.
                            </p>
                        </div>
                        {/* logos */}
                        {/* <div className="flex flex-wrap items-center gap-x-5 gap-y-2 opacity-70">
                            <span className="text-lg md:text-2xl font-semibold">Stanford</span>
                            <span className="text-lg md:text-2xl font-semibold">Harvard</span>
                            <span className="text-lg md:text-2xl font-semibold">UCLA</span>
                        </div> */}
                    </div>

                    {/* Doctors grid — 2 cols on mobile, 4 cols on md+ */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                        {/* {DOCTORS.map((d, i) => (
                            <motion.div
                                key={d.name}
                                initial={{ opacity: 0, y: 8 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, amount: 0.4 }}
                                transition={{ duration: 0.4, delay: i * 0.05 }}
                                className="rounded-2xl border border-neutral-200 overflow-hidden bg-white shadow-sm"
                            >
                                <div className="relative aspect-square">
                                    <Image
                                        src={d.src}
                                        alt={d.alt}
                                        fill
                                        className="object-cover"
                                        sizes="(min-width:768px) 25vw, 50vw"
                                    />
                                </div>
                                <div className="p-3">
                                    <div className="font-semibold text-sm md:text-base">{d.name}</div>
                                    <div className="text-[11px] md:text-xs text-neutral-600 mt-1">{d.role}</div>
                                </div>
                            </motion.div>
                        ))} */}
                    </div>
                </div>

                {/* Pricing split */}
                <div className="grid lg:grid-cols-12 gap-6 md:gap-12 items-start">
                    {/* Left: rotating cards */}
                    <div className="lg:col-span-5">
                        <RotatingCards />
                    </div>

                    {/* Right: copy + price + CTA */}
                    <div className="lg:col-span-7">
                        <div className="text-xs md:text-sm text-neutral-500">
                            What could cost you $15,000 is $199
                        </div>
                        <h3 className="text-3xl sm:text-4xl md:text-5xl mt-1 leading-tight">
                            Superpower
                            <br className="hidden sm:block" /> Membership
                        </h3>
                        <p className="text-neutral-600 mt-3 max-w-prose text-[15px] md:text-base">
                            Your membership includes one comprehensive blood draw each year, covering
                            100+ biomarkers in a single collection
                        </p>

                        <ul className="mt-4 md:mt-5 space-y-2">
                            {BULLETS.map((b) => (
                                <li key={b} className="flex gap-2">
                                    <Check className="h-5 w-5 mt-0.5 text-emerald-600" />
                                    <span className="text-neutral-800 text-sm md:text-base">{b}</span>
                                </li>
                            ))}
                        </ul>

                        {/* Price block */}
                        <div className="mt-5 md:mt-6 flex items-baseline gap-2">
                            <div className="text-5xl md:text-6xl text-neutral-900">$17</div>
                            <div className="text-neutral-600 text-sm md:text-base">
                                /month · billed annually
                            </div>
                        </div>

                        {/* Payment options */}
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                            <span>Flexible payment options</span>
                            {['AMEX', 'VISA', 'Mastercard', 'HSA/FSA'].map((label) => (
                                <span
                                    key={label}
                                    className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 bg-white"
                                >
                                    <CreditCard className="h-3.5 w-3.5" />
                                    <span>{label}</span>
                                </span>
                            ))}
                        </div>

                        {/* CTA — full-width on mobile, auto on sm+ */}
                        <div className="mt-5 md:mt-6">
                            <a
                                href="#start"
                                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full px-6 py-3 text-white bg-accent hover:bg-accent2 transition"
                            >
                                Start testing
                            </a>
                        </div>

                        {/* Guarantees row */}
                        <div className="mt-4 flex flex-wrap items-center gap-3 md:gap-4 text-sm text-neutral-600">
                            <span className="inline-flex items-center gap-1.5">
                                <Shield className="h-4 w-4" /> Cancel anytime
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <CreditCard className="h-4 w-4" /> HSA/FSA eligible
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <Clock4 className="h-4 w-4" /> Results in a week
                            </span>
                        </div>

                        <div className="mt-2 text-xs text-neutral-500">
                            Pricing may vary for members in New York and New Jersey **
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
