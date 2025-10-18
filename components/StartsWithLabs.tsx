'use client';

import { motion, useAnimation, useInView, useSpring, useTransform } from 'framer-motion';
import React, { useEffect, useRef } from 'react';
import { TimerOff, ListChecks, Hand } from 'lucide-react';

/* ------------------------------ Counter ------------------------------ */
function Counter({
    from = 0,
    to = 100,
    duration = 1.4,
    className = '',
}: {
    from?: number;
    to?: number;
    duration?: number;
    className?: string;
}) {
    const controls = useSpring(from, { stiffness: 90, damping: 18 });
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        controls.set(from);
        const t = setTimeout(() => controls.set(to), 100);
        return () => clearTimeout(t);
    }, [from, to]);
    const rounded = useTransform(controls, (v) => Math.round(v));
    return <motion.span className={className}>{rounded}</motion.span>;
}

/* ------------------------------ Sparkline --------------------------- */
function Sparkline({ color = '#111111' }: { color?: string }) {
    const path = 'M5,35 C60,10 110,55 165,22';
    return (
        <svg viewBox="0 0 180 60" className="w-full h-10 md:h-12">
            <motion.path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth="3"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: [0, 1, 0] }}
                transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
            />
        </svg>
    );
}

/* ------------------------------ Row with bar ------------------------ */
function MetricRow({
    name,
    status,
    value,
    unit,
    bar,
    delay = 0,
}: {
    name: string;
    status: 'Optimal' | 'Normal' | 'Out of Range';
    value: number;
    unit: string;
    bar: number; // 0..100
    delay?: number;
}) {
    const color =
        status === 'Optimal'
            ? 'bg-emerald-500'
            : status === 'Normal'
                ? 'bg-sky-500'
                : 'bg-rose-500';
    const pill =
        status === 'Optimal'
            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
            : status === 'Normal'
                ? 'text-sky-700 bg-sky-50 border-sky-200'
                : 'text-rose-700 bg-rose-50 border-rose-200';

    const rowRef = useRef<HTMLDivElement>(null);
    const seen = useInView(rowRef, { amount: 0.5 });

    return (
        <motion.div
            ref={rowRef}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ amount: 0.5 }}
            transition={{ delay, duration: 0.45 }}
            className="py-3 border-b border-neutral-200 last:border-none"
        >
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="font-medium text-neutral-900">{name}</div>
                    <div className="text-xs text-neutral-500">Heart health</div>
                </div>

                {/* status pill hidden on small screens (keeps desktop as-is) */}
                <div className="shrink-0 hidden md:block">
                    <span className={`badge border ${pill}`}>{status}</span>
                </div>

                <div className="w-28 sm:w-40 md:w-56">
                    <div className="h-2 rounded-full bg-neutral-200 overflow-hidden">
                        <motion.div
                            animate={seen ? { width: ['0%', `${bar}%`, '0%'] } : { width: '0%' }}
                            transition={{
                                duration: 2.2,
                                ease: 'easeInOut',
                                times: [0, 0.6, 1],
                                repeat: seen ? Infinity : 0,
                                repeatDelay: 0.4,
                                delay: delay + 0.1,
                            }}
                            className={`h-full ${color}`}
                        />
                    </div>
                </div>
                <div className="w-20 sm:w-24 text-right">
                    <div className="font-semibold text-neutral-900">
                        <Counter from={0} to={value} duration={1.2} />
                        <span className="text-neutral-500 text-xs sm:text-sm ml-1">{unit}</span>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

/* ------------------------------ Mini features strip ----------------- */
function FeaturesStrip() {
    const items = [
        {
            icon: <TimerOff className="h-5 w-5 text-neutral-900" />,
            title: 'No wait times',
            sub: 'less than 15 minute lab visit',
        },
        {
            icon: <ListChecks className="h-5 w-5 text-neutral-900" />,
            title: 'Fast results',
            sub: 'Get your result in 5 business days',
        },
        {
            icon: <Hand className="h-5 w-5 text-neutral-900" />,
            title: 'Simple and convenient',
            sub: 'Book your test at over 2,000+ locations',
        },
    ];

    return (
        <div className="mt-10 md:mt-20 mb-16 md:mb-40 px-1">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-10">
                {items.map((it, i) => (
                    <motion.div
                        key={it.title}
                        initial={{ opacity: 0, y: 8 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.5 }}
                        transition={{ duration: 0.45, delay: i * 0.05 }}
                        className="flex md:justify-center items-start gap-3"
                    >
                        <div className="mt-0.5 shrink-0">{it.icon}</div>
                        <div>
                            <div className="text-base md:text-xl font-semibold leading-tight text-neutral-900">
                                {it.title}
                            </div>
                            <div className="text-sm text-neutral-500 mt-1">{it.sub}</div>
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}

/* ------------------------------ Monitor frame ----------------------- */
function Monitor() {
    return (
        <div className="relative w-full max-w-[940px] md:max-w-none">
            {/* frame shadow */}
            <div className="absolute inset-0 rounded-[22px] md:rounded-[28px] shadow-[0_18px_60px_rgba(0,0,0,.10)] md:shadow-[0_30px_100px_rgba(0,0,0,.12)] pointer-events-none" />

            {/* side panels (desktop only) */}
            <div className="hidden lg:block absolute -left-80 top-6 w-72 h-[480px] rounded-3xl bg-neutral-50 border border-neutral-200 shadow-sm" />
            <div className="hidden lg:block absolute -right-80 top-6 w-80 h-[520px] rounded-3xl bg-neutral-50 border border-neutral-200 p-4 shadow-sm" />

            {/* monitor */}
            <div className="relative rounded-[22px] md:rounded-[28px] border-2 border-neutral-300 bg-neutral-900">
                {/* inner bezel */}
                <div className="rounded-[18px] md:rounded-[22px] m-[8px] md:m-[10px] bg-white text-neutral-900">
                    {/* top bar */}
                    <div className="px-3 md:px-5 py-2.5 md:py-3 border-b border-neutral-200 flex items-center justify-between gap-2">
                        <div className="font-extrabold tracking-tight text-neutral-900 text-sm md:text-base">
                            superpower
                        </div>
                        <div className="hidden sm:flex gap-2 text-[11px] md:text-xs">
                            {['Home', 'Data', 'Protocol', 'Concierge', 'Services'].map((t, i) => (
                                <span
                                    key={t}
                                    className={`px-2.5 md:px-3 py-1 rounded-full ${i === 1 ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
                                        }`}
                                >
                                    {t}
                                </span>
                            ))}
                        </div>
                        <div className="text-[11px] md:text-xs text-neutral-500">Invite Friend • 🙂</div>
                    </div>

                    {/* header stats */}
                    <div className="p-4 md:p-5 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ amount: 0.5 }}
                            transition={{ duration: 0.6 }}
                            className="rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white p-4"
                        >
                            <div className="text-xs/relaxed text-white/85">superpower score</div>
                            <div className="text-2xl md:text-3xl font-bold mt-1">
                                <Counter from={55} to={70} /> <span className="text-white/85 text-sm md:text-base">On Track</span>
                            </div>
                            <Sparkline color="#FFFFFF" />
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ amount: 0.5 }}
                            transition={{ duration: 0.6, delay: 0.05 }}
                            className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white p-4"
                        >
                            <div className="text-xs/relaxed text-white/85">Biological age</div>
                            <div className="text-2xl md:text-3xl font-bold mt-1">
                                <Counter from={30} to={25} />{' '}
                                <span className="text-white/90 text-sm md:text-base">2.5 years younger</span>
                            </div>
                            <Sparkline color="#FFFFFF" />
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ amount: 0.5 }}
                            transition={{ duration: 0.6, delay: 0.1 }}
                            className="rounded-2xl border border-neutral-200 p-4 bg-white"
                        >
                            <div className="text-xs text-neutral-500">Biomarkers</div>
                            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                                {[
                                    { k: 'Total', v: 106 },
                                    { k: 'Optimal', v: 80 },
                                    { k: 'In range', v: 21 },
                                    { k: 'Out of range', v: 5 },
                                ].map((s) => (
                                    <div key={s.k}>
                                        <div className="text-xl md:text-2xl font-bold text-neutral-900">
                                            <Counter from={0} to={s.v} />
                                        </div>
                                        <div className="text-[10px] md:text-[11px] text-neutral-500">{s.k}</div>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    </div>

                    {/* table */}
                    <div className="px-4 md:px-5 pb-5 md:pb-6">
                        {[
                            { name: 'LDL Cholesterol', status: 'Out of Range' as const, value: 103, unit: 'mg/dL', bar: 86 },
                            { name: 'Apolipoprotein B (ApoB)', status: 'Optimal' as const, value: 42, unit: 'mg/dL', bar: 45 },
                            { name: 'Vitamin D', status: 'Normal' as const, value: 42.3, unit: 'ng/mL', bar: 62 },
                            { name: 'Ferritin', status: 'Normal' as const, value: 88, unit: 'ng/mL', bar: 58 },
                        ].map((r, i) => (
                            <MetricRow key={r.name} {...r} delay={i * 0.05} />
                        ))}
                    </div>
                </div>

                {/* little tube on bottom right */}
                <div className="absolute -right-2 md:-right-3 bottom-8 md:bottom-10 h-24 md:h-32 w-5 md:w-6 rounded-full bg-gradient-to-b from-orange-300 to-orange-600 shadow-[0_8px_24px_rgba(245,95,42,.30)] md:shadow-[0_10px_30px_rgba(245,95,42,.35)] border-2 border-neutral-400" />
            </div>
        </div>
    );
}

/* ------------------------------ Section wrapper --------------------- */
export default function StartsWithLabs() {
    const ref = useRef<HTMLDivElement>(null);
    const inView = useInView(ref, { amount: 0.35 });
    const controls = useAnimation();

    useEffect(() => {
        if (inView) controls.start({ opacity: 1, y: 0 });
    }, [inView, controls]);

    return (
        <section className="section bg-white text-neutral-900" ref={ref} id="labs">
            <div className="container-soft">
                {/* mini component at the very top */}
                <FeaturesStrip />

                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={controls}
                    transition={{ duration: 0.6 }}
                    className="text-center px-2"
                >
                    <h2 className="text-4xl sm:text-5xl md:text-6xl text-neutral-950 mb-3 md:mb-5">
                        It starts with 100+ labs
                    </h2>
                    <p className="text-neutral-600 mt-2 md:mt-3 max-w-2xl mx-auto text-base sm:text-lg">
                        From heart health to hormone balance our comprehensive test panels detect early signs of over 1,000 conditions.
                    </p>
                    <a
                        href="#test"
                        className="inline-flex items-center gap-2 text-sm mt-4 text-neutral-700 hover:text-neutral-900"
                    >
                        Explore all biomarkers <span aria-hidden>›</span>
                    </a>
                </motion.div>

                {/* center monitor */}
                <div className="mt-8 md:mt-12 flex justify-center px-2">
                    <Monitor />
                </div>
            </div>
        </section>
    );
}
