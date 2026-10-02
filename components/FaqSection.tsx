// components/FAQSection.tsx
'use client';

import React, { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { WEBSITE_CLONER_FAQ, type WebsiteClonerFaqItem } from '@/lib/websiteClonerFaq';

type QA = WebsiteClonerFaqItem;
function QAItem({ item }: { item: QA }) {
    const [open, setOpen] = useState(false);
    const contentId = useId();

    return (
        <li className="border-t border-neutral-200 first:border-t-0">
            <button
                type="button"
                className="w-full flex items-center justify-between py-4 text-left"
                aria-expanded={open}
                aria-controls={contentId}
                onClick={() => setOpen((v) => !v)}
            >
                <span className="text-neutral-800">{item.q}</span>
                <Plus
                    aria-hidden
                    className={`h-4 w-4 shrink-0 transition-transform text-neutral-400 ${open ? 'rotate-45' : ''}`}
                />
            </button>

            <div
                id={contentId}
                hidden={!open}
                className="overflow-hidden"
            >
                <div className="pb-4 pr-10 text-sm leading-relaxed text-neutral-600">
                    {item.a}
                    {item.href && (
                        <> <a href={item.href} className="underline underline-offset-4 hover:text-neutral-900">View pricing</a>.</>
                    )}
                </div>
            </div>
        </li>
    );
}

export default function FAQSection() {
    return (
        <section id="faqs" className="bg-white text-neutral-800 pt-40 pb-24 md:pb-40">
            <div className="container-soft">
                {/* Header */}
                <div className="mx-auto max-w-4xl mb-10 md:mb-12 flex items-start justify-between gap-6">
                    <h2 className="text-4xl md:text-5xl tracking-tight">Frequently Asked Questions</h2>
                    <a
                        href="/dashboard/docs"
                        className="hidden whitespace-nowrap md:inline-flex items-center rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                    >
                        View documentation
                    </a>
                </div>

                <ul className="mx-auto max-w-4xl">
                    {WEBSITE_CLONER_FAQ.map((item) => (
                        <QAItem key={item.q} item={item} />
                    ))}
                </ul>

                {/* Mobile read more */}
                <div className="mx-auto max-w-4xl mt-8 md:hidden">
                    <a
                        href="/dashboard/docs"
                        className="inline-flex items-center rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-700"
                    >
                        View docs
                    </a>
                </div>
            </div>
        </section>
    );
}
