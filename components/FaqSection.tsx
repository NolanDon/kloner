// components/FAQSection.tsx
'use client';

import React, { useId, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';

type QA = { q: string; a: string };
type Group = { heading: string; items: QA[] };

const GROUPS: Group[] = [
    {
        heading: 'How it works',
        items: [
            { q: 'What should I expect during a blood draw?', a: 'A licensed phlebotomist collects your sample in a quick appointment (typically under 15 minutes). Hydrate, bring ID, and wear sleeves you can roll up.' },
            { q: 'How do I prepare for a blood draw?', a: 'Unless your order specifies fasting, eat normally and stay hydrated. Avoid heavy exercise 24 hours prior and follow any kit-specific instructions.' },
            { q: 'What should I do after my blood draw?', a: 'Apply gentle pressure for a few minutes, keep the bandage on for several hours, and avoid strenuous arm activity for the rest of the day.' },
            { q: 'How do I book a blood draw with Superpower?', a: 'Choose a nearby partner location during checkout or from your dashboard. You’ll receive a confirmation with directions and prep notes.' },
            { q: 'Where can I take my blood test?', a: 'We partner with 2,000+ locations nationwide. Enter your ZIP code during booking to find the closest site.' },
        ],
    },
    {
        heading: 'Our testing',
        items: [
            { q: 'Does Superpower replace my primary care provider?', a: 'No. We provide advanced testing and insights that complement your PCP’s care. Bring your report to your clinician for ongoing management.' },
            { q: 'How fast are blood test results and how do I read them?', a: 'Most panels return within 3–7 business days. Your dashboard highlights out-of-range markers and includes plain-language explanations.' },
            { q: 'Does Superpower accept health insurance?', a: 'Membership is cash-pay. Some members use HSA/FSA funds; check with your plan administrator for eligibility.' },
            { q: 'What if I want more than 1 blood test per year?', a: 'You can add additional panels at member pricing anytime from your dashboard.' },
        ],
    },
];

function QAItem({ item, groupKey }: { item: QA; groupKey: string }) {
    const [open, setOpen] = useState(false);
    const contentId = useId();

    return (
        <li className="border-t border-neutral-200 first:border-t-0">
            <button
                type="button"
                className="w-full flex items-center justify-between py-4 text-left"
                aria-expanded={open}
                aria-controls={`${groupKey}-${contentId}`}
                onClick={() => setOpen((v) => !v)}
            >
                <span className="text-neutral-800">{item.q}</span>
                {/* small + at far right, no circle */}
                <Plus
                    aria-hidden
                    className={`h-4 w-4 shrink-0 transition-transform text-neutral-400 ${open ? 'rotate-45' : ''}`}
                />
            </button>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        id={`${groupKey}-${contentId}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        className="overflow-hidden"
                    >
                        <div className="pb-4 pr-10 text-sm leading-relaxed text-neutral-600">
                            {item.a}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </li>
    );
}

export default function FAQSection() {
    return (
        <section className="bg-white text-neutral-900 pt-40">
            <div className="container-soft">
                {/* Header */}
                <div className="mb-10 md:mb-12 flex items-start justify-between">
                    <h2 className="text-5xl tracking-tight">
                        Frequently Asked Questions
                    </h2>
                    <a
                        href="#faq-all"
                        className="hidden md:inline-flex items-center rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                    >
                        Read more
                    </a>
                </div>

                {/* Layout: left labels, right list (no card borders) */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12">
                    {/* Left labels */}
                    <div className="md:col-span-3">
                        <div className="space-y-24">
                            {GROUPS.map((g) => (
                                <div key={g.heading} className="text-2xl font-medium text-neutral-900">
                                    {g.heading}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right groups */}
                    <div className="md:col-span-9 max-w-3xl">
                        {GROUPS.map((g, gi) => (
                            <div key={g.heading} className={gi > 0 ? 'mt-12 md:mt-16' : ''}>
                                {/* mobile-only group title */}
                                <div className="md:hidden mb-2 text-base font-semibold">{g.heading}</div>
                                <ul>
                                    {g.items.map((it) => (
                                        <QAItem key={it.q} item={it} groupKey={`g${gi}`} />
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Mobile read more */}
                <div className="mt-8 md:hidden">
                    <a
                        href="#faq-all"
                        className="inline-flex items-center rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-700"
                    >
                        Read more
                    </a>
                </div>
            </div>
        </section>
    );
}
