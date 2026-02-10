// app/partners/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
    title: "Partnerships",
    description:
        "Explore Kloner partnerships for creators, affiliates, and agencies. Earn commissions or deliver faster by cloning and refining sites with an AI agent.",
    alternates: { canonical: "https://kloner.app/partners" },
    openGraph: { url: "https://kloner.app/partners" },
};

export default function PartnersPage(): JSX.Element {
    return (
        <main className="min-h-screen bg-neutral-50 text-neutral-900">
            <NavBar />

            <section className="pt-28 pb-20 px-4">
                <div className="mx-auto max-w-6xl">
                    <header className="mb-10 max-w-3xl">
                        <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                            <span>Kloner · Partnerships</span>
                        </div>

                        <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-7 sm:px-8 sm:py-9 shadow-sm">
                            <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                                Partnerships
                            </h1>
                            <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                                Ways to work with Kloner without touching internal systems. You (or your clients) keep ownership
                                of domains, URLs, exports, and campaigns.
                            </p>

                            <div className="mt-4 flex flex-wrap gap-2">
                                <a
                                    href="#creators"
                                    className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm hover:border-[rgba(245,95,42,0.35)]"
                                >
                                    Creators
                                </a>
                                <a
                                    href="#affiliates"
                                    className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm hover:border-[rgba(245,95,42,0.35)]"
                                >
                                    Affiliates
                                </a>
                                <a
                                    href="#business"
                                    className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm hover:border-[rgba(245,95,42,0.35)]"
                                >
                                    Agencies & businesses
                                </a>
                            </div>
                        </div>
                    </header>

                    <div className="grid gap-5">
                        <section
                            id="creators"
                            className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm"
                        >
                            <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
                                For creators
                            </h2>
                            <p className="mt-2 text-sm text-neutral-600 leading-6 max-w-3xl">
                                Use Kloner to spin up landing pages for products, launches, and sponsorships. You keep full control
                                of your domains, mailing lists, and analytics.
                            </p>
                        </section>

                        <section
                            id="affiliates"
                            className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm"
                        >
                            <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Affiliates</h2>
                            <p className="mt-2 text-sm text-neutral-600 leading-6 max-w-3xl">
                                Earn a recurring commission when teams you refer upgrade to paid plans. We provide tracking links and
                                simple, non-technical copy.
                            </p>
                        </section>

                        <section
                            id="business"
                            className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm"
                        >
                            <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
                                For agencies and businesses
                            </h2>
                            <p className="mt-2 text-sm text-neutral-600 leading-6 max-w-3xl">
                                Agencies can standardize on Kloner for capture and preview, then move exported code into their own
                                repos and CI. You own the client relationship end-to-end.
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                                <Link
                                    href="/contact"
                                    className="inline-flex items-center rounded-full border border-[rgba(245,95,42,0.22)] bg-[rgba(245,95,42,0.08)] px-3 py-1.5 text-xs font-semibold text-[rgba(245,95,42,1)]"
                                >
                                    Talk to us about custom usage
                                </Link>
                                <Link
                                    href="/login?mode=signup"
                                    className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm hover:border-[rgba(245,95,42,0.35)]"
                                >
                                    Create an account
                                </Link>
                            </div>
                        </section>
                    </div>
                </div>
            </section>
            <Footer />
        </main>
    );
}
