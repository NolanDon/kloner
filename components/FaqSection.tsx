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
                q: 'Will it copy entire web applications, or mobile applications?',
                a: 'No, Kloner is specifically for users looking to create high-performing, secure, single or mulit-page websites without strict database requirements'
            },
            {
                q: 'How can I customize or change fonts, colors after generating a preview?',
                a: 'Kloner has it\'s own editor, after generating a website you can fine-tune fonts, colors, images, seo data, and much more.'
            },
            {
                q: 'How long does the process take from entering a URL to deployment?',
                a: 'Your site can be generated and live in as little as 5 minutes.'
            },
            {
                q: 'What exactly gets exported?',
                a: 'A clean, secure and well-structured HTML project, componentized layouts, optimized images, subset fonts.'
            },
            {
                q: 'Can I attach my own domain?',
                a: 'Yes, Kloner deploys to Vercel, and from Vercel you can manage custom domains, analytics and much more.'
            },
            {
                q: 'Will forms and client scripts work?',
                a: 'We preserve markup and isolate scripts. Full form integration is currently in development'
            },
            {
                q: 'Do internal links keep working?',
                a: 'Links are rewritten to local routes. External links stay external. We warn on dead links and provide a mapping file so you can review any edge cases.'
            },
            {
                q: 'Can I run the exported project anywhere?',
                a: 'Yes. The output is standard HTML. It runs on Vercel, Netlify, or any Node/Edge host. However Kloner strictly deploys to Vercel only'
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
                a: '40 website generations per month for any domain, clean HTML export, image/SEO/route setup, font subsetting, and one-click deploy integrations.'
            },
            {
                q: 'Can I cancel anytime?',
                a: 'Yes. Billing is month-to-month (or annually with savings). Cancel from your account dashboard and your plan ends at the current period.'
            },
            {
                q: 'Is there a team plan?',
                a: 'This feature is currently in development. Team support will allow you to share previews, export approvals, and environment-specific deploys. Contact us if you need SSO or custom limits.'
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
                q: 'Are mobile apps available?',
                a: 'URL to mobile app is currently in development and will be available for pro members soon.'
            },
            {
                q: 'Does it support Routing?',
                a: 'Yes. You can choose pages/ or app/ output. We scaffold route groups where appropriate.'
            },
            {
                q: 'What about frameworks other than HTML?',
                a: 'Exporters for Remix, SvelteKit, and Astro are in development and will be available soon. You can still export raw assets and wire your framework of choice.'
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
        <section id="faqs" className="bg-white text-neutral-800 pt-40">
            <div className="container-soft">
                {/* Header */}
                <div className="mb-10 md:mb-12 flex items-start justify-between md:px-40">
                    <h2 className="text-5xl mb-12 tracking-tight">Frequently Asked Questions</h2>
                    <a
                        href="/dashboard/docs"
                        className="hidden whitespace-nowrap md:inline-flex items-center rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                    >
                        View documentation
                    </a>
                </div>

                {/* Groups: render each group as a responsive row so heading aligns with its items */}
                <div className="space-y-12">
                    {GROUPS.map((g, gi) => (
                        <div
                            key={g.heading}
                            className={`grid grid-cols-1 md:grid-cols-12 gap-6 lg:gap-12 items-start ${gi > 0 ? 'pt-6 md:pt-8 border-t border-neutral-100' : ''}`}
                        >
                            {/* Left heading on md+ */}
                            <div className="hidden md:block md:col-span-3">
                                <div className="text-2xl font-medium text-neutral-800 sticky top-28">
                                    {g.heading}
                                </div>
                            </div>

                            {/* Right: items (and mobile heading) */}
                            <div className="md:col-span-9 max-w-3xl">
                                {/* mobile-only group title */}
                                <div className="md:hidden mb-2 text-base font-semibold">{g.heading}</div>
                                <ul>
                                    {g.items.map((it) => (
                                        <QAItem key={it.q} item={it} groupKey={`g${gi}`} />
                                    ))}
                                </ul>
                            </div>
                        </div>
                    ))}
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
