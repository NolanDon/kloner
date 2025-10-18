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
function RotatingCards() {
    // You can swap these for any 4:3 images under /public
    const slides = useMemo(
        () => [
            '/images/membership/membership-card.jpg',
            '/images/membership/addons.jpg',
            '/images/membership/concierge.jpg',
            '/images/membership/action-plan.jpg',
        ],
        []
    );
    const [i, setI] = useState(0);
    const reduce = useReducedMotion();

    useEffect(() => {
        if (reduce) return; // respect prefers-reduced-motion
        const id = setInterval(() => setI((v) => (v + 1) % slides.length), 3000);
        return () => clearInterval(id);
    }, [slides.length, reduce]);

    return (
        <div className="rounded-3xl border border-neutral-200 bg-white p-3 md:p-4 shadow-sm">
            {/* stage */}
            <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-neutral-100">
                <AnimatePresence initial={false} mode="popLayout">
                    <motion.div
                        key={slides[i]}
                        initial={{ opacity: 0, scale: 1.02 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        className="absolute inset-0"
                    >
                        <Image
                            src={slides[i]}
                            alt=""
                            fill
                            className="object-cover"
                            sizes="(min-width:1024px) 40vw, 100vw"
                            priority
                        />
                    </motion.div>
                </AnimatePresence>

                {/* $17 chip */}
                <div className="absolute bottom-3 left-3 md:bottom-4 md:left-4 rounded-xl px-2.5 py-1 bg-white/90 text-neutral-900 text-xs md:text-sm font-semibold shadow">
                    $17<span className="font-normal"> /month</span>
                </div>
            </div>

            {/* thumbnails — scrollable on mobile, clickable to jump */}
            <div className="mt-3 flex items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {slides.map((src, idx) => (
                    <button
                        key={src}
                        onClick={() => setI(idx)}
                        className={`h-12 w-16 shrink-0 rounded-lg border transition hover:border-neutral-400 ${i === idx ? 'border-neutral-900' : 'border-neutral-200'
                            } bg-white overflow-hidden`}
                        aria-label={`Show preview ${idx + 1}`}
                        aria-current={i === idx}
                    >
                        <div className="relative h-full w-full">
                            <Image src={src} alt="" fill className="object-cover" sizes="64px" />
                        </div>
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
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 opacity-70">
                            <span className="text-lg md:text-2xl font-semibold">Stanford</span>
                            <span className="text-lg md:text-2xl font-semibold">Harvard</span>
                            <span className="text-lg md:text-2xl font-semibold">UCLA</span>
                        </div>
                    </div>

                    {/* Doctors grid — 2 cols on mobile, 4 cols on md+ */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                        {DOCTORS.map((d, i) => (
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
                        ))}
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
