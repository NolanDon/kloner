// components/MembershipHero.tsx
'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { Check, Shield, Clock4, CreditCard } from 'lucide-react';
import React from 'react';

type Doctor = {
    name: string;
    role: string;
    src: string; // 1:1 headshot
    alt: string;
};

const DOCTORS: Doctor[] = [
    {
        name: 'Dr Anant Vinjamoori',
        role: 'Superpower Chief Longevity Officer, Harvard MD & MBA',
        src: '/images/doctors/anant.jpg',
        alt: 'Dr Anant Vinjamoori',
    },
    {
        name: 'Dr Leigh Erin Connealy',
        role: 'Clinician & Founder of The Centre for New Medicine',
        src: '/images/doctors/leigh.jpg',
        alt: 'Dr Leigh Erin Connealy',
    },
    {
        name: 'Dr Abe Malkin',
        role: 'Founder & Medical Director of Concierge MD',
        src: '/images/doctors/abe.jpg',
        alt: 'Dr Abe Malkin',
    },
    {
        name: 'Dr Robert Lufkin',
        role: 'UCLA Medical Professor, NYT Bestselling Author',
        src: '/images/doctors/robert.jpg',
        alt: 'Dr Robert Lufkin',
    },
];

const BULLETS = [
    'One appointment, one draw for your annual panel.',
    '100+ labs tested per year',
    'A personalized plan that evolves with you',
    'Get your biological age and track your health over a lifetime',
];

export default function MembershipHero() {
    return (
        <section className="bg-white text-neutral-900 pt-60">
            <div className="container-soft space-y-10 md:space-y-14">
                {/* Top: heading + logos + doctors */}
                <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                        <div>
                            <h2 className="text-3xl md:text-4xl">Developed by world-class medical<br /> professionals</h2>
                            <p className="text-neutral-600 my-4">
                                Supported by the world’s top longevity clinicians and MDs.
                            </p>
                        </div>
                        {/* logos (replace with your svgs/pngs) */}
                        <div className="flex items-center gap-6 opacity-70">
                            <span className="text-xl md:text-2xl font-semibold">Stanford</span>
                            <span className="text-xl md:text-2xl font-semibold">Harvard</span>
                            <span className="text-xl md:text-2xl font-semibold">Ucla</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                                    <Image src={d.src} alt={d.alt} fill className="object-cover" sizes="(min-width: 768px) 25vw, 50vw" />
                                </div>
                                <div className="p-3">
                                    <div className="font-semibold">{d.name}</div>
                                    <div className="text-xs text-neutral-600 mt-1">{d.role}</div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>

                {/* Pricing split */}
                <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-start">
                    {/* Left: big card with thumbnails */}
                    <div className="lg:col-span-5">
                        <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                            <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-neutral-100">
                                {/* Replace with your actual membership card image */}
                                <Image
                                    src="/images/membership/membership-card.jpg"
                                    alt="Superpower membership card"
                                    fill
                                    className="object-cover"
                                    sizes="(min-width: 1024px) 40vw, 100vw"
                                    priority
                                />
                                {/* Price slug overlay (optional) */}
                                <div className="absolute bottom-4 left-4 rounded-xl px-3 py-1.5 bg-white/90 text-neutral-900 text-sm font-semibold shadow">
                                    $17<span className="font-normal text-sm"> /month</span>
                                </div>
                            </div>

                            {/* Thumbnails */}
                            <div className="mt-3 flex items-center gap-2">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <button
                                        key={i}
                                        className={`h-12 w-16 rounded-lg border transition hover:border-neutral-400 ${i === 0 ? 'border-neutral-900' : 'border-neutral-200'
                                            } bg-white overflow-hidden`}
                                        aria-label={`Preview ${i + 1}`}
                                    >
                                        <div className="h-full w-full bg-neutral-100" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Right: copy + price + CTA */}
                    <div className="lg:col-span-7">
                        <div className="text-sm text-neutral-500">What could cost you $15,000 is $199</div>
                        <h3 className="text-4xl md:text-5xl mt-1">Superpower<br />Membership</h3>
                        <p className="text-neutral-600 mt-3 max-w-prose">
                            Your membership includes one comprehensive blood draw each year, covering 100+ biomarkers in a single collection
                        </p>

                        <ul className="mt-5 space-y-2">
                            {BULLETS.map((b) => (
                                <li key={b} className="flex gap-2">
                                    <Check className="h-5 w-5 mt-0.5 text-emerald-600" />
                                    <span className="text-neutral-800">{b}</span>
                                </li>
                            ))}
                        </ul>

                        {/* Price block */}
                        <div className="mt-6 flex items-baseline gap-2">
                            <div className="text-6xl text-neutral-900">$17</div>
                            <div className="text-neutral-600">/month · billed annually</div>
                        </div>

                        {/* Payment options */}
                        <div className="mt-3 flex items-center gap-2 text-xs text-neutral-600">
                            <span>Flexible payment options</span>
                            <span className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 bg-white">
                                <CreditCard className="h-3.5 w-3.5" />
                                <span>AMEX</span>
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 bg-white">
                                <CreditCard className="h-3.5 w-3.5" />
                                <span>VISA</span>
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 bg-white">
                                <CreditCard className="h-3.5 w-3.5" />
                                <span>Mastercard</span>
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 bg-white">
                                <CreditCard className="h-3.5 w-3.5" />
                                <span>HSA/FSA</span>
                            </span>
                        </div>

                        {/* CTA */}
                        <div className="mt-6">
                            <a
                                href="#start"
                                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full px-6 py-3 text-white bg-accent hover:bg-accent2 transition"
                            >
                                Start testing
                            </a>
                        </div>

                        {/* Guarantees row */}
                        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-neutral-600">
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
