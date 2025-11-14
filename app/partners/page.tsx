// app/partners/page.tsx
"use client";

import NavBar from "@/components/NavBar";

const ACCENT = "#f55f2a";

export default function PartnersPage(): JSX.Element {
    return (
        <main className="min-h-screen bg-white text-neutral-900">
            <NavBar />
            <section className="pt-[calc(var(--header-h,56px)+40px)] pb-16 px-6">
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight">
                        Partnerships
                    </h1>
                    <p className="mt-3 text-sm md:text-base text-neutral-600 max-w-prose">
                        Ways to work with Kloner without touching internal systems. All
                        programs keep ownership and responsibility for URLs, exports, and
                        campaigns with you or your clients.
                    </p>

                    <section id="creators" className="mt-10 space-y-3">
                        <h2 className="text-xl md:text-2xl font-semibold">For creators</h2>
                        <p className="text-sm md:text-base text-neutral-600">
                            Use Kloner to spin up landing pages for products, launches, and
                            sponsorships. You keep full control of your domains, mailing
                            lists, and analytics.
                        </p>
                    </section>

                    <section id="affiliates" className="mt-10 space-y-3">
                        <h2 className="text-xl md:text-2xl font-semibold">Affiliates</h2>
                        <p className="text-sm md:text-base text-neutral-600">
                            Earn a recurring commission when teams you refer upgrade to paid
                            plans. We provide tracking links and simple, non-technical
                            marketing copy.
                        </p>
                    </section>

                    <section id="business" className="mt-10 space-y-3">
                        <h2 className="text-xl md:text-2xl font-semibold">
                            For agencies and businesses
                        </h2>
                        <p className="text-sm md:text-base text-neutral-600">
                            Agencies can standardize on Kloner for capture and preview, then
                            move exported code into their own repos and CI. You own the client
                            relationship end-to-end.
                        </p>
                        <a
                            href="/contact"
                            className="inline-flex mt-2 text-sm font-medium"
                            style={{ color: ACCENT }}
                        >
                            Talk to us about custom usage
                        </a>
                    </section>
                </div>
            </section>
        </main>
    );
}
