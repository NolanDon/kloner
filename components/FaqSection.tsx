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
            {
                q: 'What does the preview do?',
                a: 'We crawl the target URL, capture HTML, CSS, JS, images, and fonts, then render a sandboxed preview so you can edit copy and images before exporting.'
            },
            {
                q: 'What exactly gets exported?',
                a: 'A clean Next.js project with pages or app routes, componentized layouts, optimized images, subset fonts, and extracted SEO tags (title, meta, Open Graph, Twitter).'
            },
            {
                q: 'Will forms and client scripts work?',
                a: 'We preserve markup and isolate scripts. Forms are kept but may require hooking to your backend. Third-party widgets are bridged where possible or flagged if manual wiring is needed.'
            },
            {
                q: 'Do internal links keep working?',
                a: 'Links are rewritten to local routes. External links stay external. We warn on dead links and provide a mapping file so you can review any edge cases.'
            },
            {
                q: 'Can I run the exported project anywhere?',
                a: 'Yes. The output is standard Next.js. It runs on Vercel, Netlify, or any Node/Edge host. You can also export static and serve on S3/CloudFront.'
            },
        ],
    },
    {
        heading: 'Membership & billing',
        items: [
            {
                q: 'Do I need a card to try the preview?',
                a: 'No. Preview is free without a card. You pay only when you export.'
            },
            {
                q: 'What’s included in Pro?',
                a: 'Unlimited previews on your domain, clean Next.js export, image/SEO/route setup, font subsetting, and one-click deploy integrations.'
            },
            {
                q: 'Can I cancel anytime?',
                a: 'Yes. Billing is month-to-month (or annually with savings). Cancel from your account dashboard and your plan ends at the current period.'
            },
            {
                q: 'Is there a team plan?',
                a: 'Yes. Team seats support shared previews, export approvals, and environment-specific deploys. Contact us if you need SSO or custom limits.'
            },
        ],
    },
    {
        heading: 'Limits & compatibility',
        items: [
            {
                q: 'Are there site size limits?',
                a: 'Pro handles most marketing sites. We show a page and asset count before export. Very large or app-heavy sites may need targeted capture.'
            },
            {
                q: 'Does it support App Router?',
                a: 'Yes. You can choose pages/ or app/ output. We scaffold layout.tsx and route groups where appropriate.'
            },
            {
                q: 'What about frameworks other than Next.js?',
                a: 'Exporters for Remix, SvelteKit, and Astro are in beta as add-ons. You can still export raw assets and wire your framework of choice.'
            },
            {
                q: 'SEO fidelity guarantees?',
                a: 'We extract titles, descriptions, canonical, robots, OG/Twitter, and JSON-LD blocks when present. A diff report highlights anything missing.'
            },
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
                <div className="mb-10 md:mb-12 flex items-start justify-between md:px-40">
                    <h2 className="text-5xl mb-12 tracking-tight">Frequently Asked Questions</h2>
                    <a
                        href="#faq-all"
                        className="hidden whitespace-nowrap md:inline-flex items-center rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                    >
                        Read more
                    </a>
                </div>

                {/* Layout */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12">
                    {/* Left labels */}
                    <div className="hidden sm:block md:col-span-3">
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
