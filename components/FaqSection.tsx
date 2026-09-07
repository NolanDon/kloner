// components/FAQSection.tsx
'use client';

import React, { useId, useState } from 'react';
import { Plus } from 'lucide-react';

type QA = { q: string; a: string };
type Group = { heading: string; items: QA[] };

const GROUPS: Group[] = [
    {
        heading: 'How to clone a website',
        items: [
            {
                q: 'Can I copy a website from a URL?',
                a: 'Yes. Paste a public URL and Kloner builds an editable website preview you can customize.'
            },
            {
                q: 'What is a website cloner?',
                a: 'A website cloner recreates a site’s supported structure, styling, assets, and interactions as an editable project. Kloner is designed to help you start from a public URL instead of a blank page.'
            },
            {
                q: 'How do I clone a website?',
                a: 'Paste a supported public URL into Kloner, review the generated preview, customize the editable project, and publish it when it is ready.'
            },
            {
                q: 'What is the difference between cloning and downloading a website?',
                a: 'Downloading or copying raw HTML gives you files from one page. Kloner turns a supported public page into a structured, editable project that you can refine and deploy.'
            },
            {
                q: 'Can I clone my own website?',
                a: 'Yes. Cloning your own site is a useful way to create a redesign baseline, prototype a migration, or preserve a starting point for a new project.'
            },
            {
                q: 'How do I make the cloned site my own?',
                a: 'Change the copy, colors, images, sections, and domain so the final site matches your brand.'
            },
            {
                q: 'How long does it take to copy a website?',
                a: 'Timing depends on the source site and the amount of content to process. Kloner shows the preview when it is ready.'
            },
            {
                q: 'What do I get after cloning?',
                a: 'An editable project preview that you can review, customize, and prepare for publishing.'
            },
            {
                q: 'Can I attach my own domain?',
                a: 'Yes, you can deploy to Vercel and connect your own domain once the cloned version is ready.'
            },
            {
                q: 'Will forms and internal links still work?',
                a: 'Review generated links and interactions in the preview. Forms, sign-in, payments, and other services may need configuration before publishing.'
            },
        ],
    },
    {
        heading: 'Pricing & access',
        items: [
            {
                q: 'Can I preview a website for free?',
                a: 'You can start with limited free preview access for supported public websites. Editing and publishing require a paid plan or eligible trial.'
            },
            {
                q: 'Is Kloner a free website cloner?',
                a: 'Kloner offers limited free preview access for supported public websites. Eligible new Pro customers can start a 7-day trial with a payment method; paid plans add higher usage limits and editing and publishing capabilities.'
            },
            {
                q: 'What can I do with Kloner for free?',
                a: 'You can use the available free preview credits to evaluate the cloning workflow for supported public websites. Your dashboard shows the limits that apply before you choose a paid plan.'
            },
            {
                q: 'What’s included in Pro?',
                a: 'Paid plans add higher usage limits, AI editing, project export, and publishing integrations. See the pricing page for current plan details.'
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
                a: 'Very large or app-heavy sites may need targeted capture. Available preview and export limits depend on your plan and the source site.'
            },
            {
                q: 'Are mobile apps available?',
                a: 'Mobile app generation is coming soon. Today, Kloner focuses on Next.js web experiences.'
            },
            {
                q: 'Does it support Routing?',
                a: 'Kloner can map supported pages and links into the generated project. Review the preview and adjust routes before publishing.'
            },
            {
                q: 'What about frameworks other than HTML?',
                a: 'Current generation is Next.js V2. Community templates are legacy V1 HTML templates, which are still usable but do not support the same integration and runtime functionality as V2 apps.'
            },
            {
                q: 'Is website cloning legal?',
                a: 'Kloner may be used to clone a website only when you own it or have the necessary rights and permission to capture and use it. You are responsible for using Kloner lawfully and confirming that you are authorized to reproduce the source site’s content, code, branding, and assets before publishing.'
            },
            {
                q: 'Can I clone another company’s website?',
                a: 'Only when you have permission and the rights needed for the content and design elements you use. A visual reference is not automatically permission to republish someone else’s site.'
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

            <div
                id={`${groupKey}-${contentId}`}
                hidden={!open}
                className="overflow-hidden"
            >
                <div className="pb-4 pr-10 text-sm leading-relaxed text-neutral-600">
                    {item.a}
                </div>
            </div>
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
