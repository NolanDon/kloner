// app/compare/page.tsx
"use client";

import NavBar from "@/components/NavBar";

const ACCENT = "#f55f2a";

export default function ComparePage(): JSX.Element {
    return (
        <main className="min-h-screen bg-white text-neutral-900">
            <NavBar />
            <section className="pt-[calc(var(--header-h,56px)+40px)] pb-16 px-6">
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight">
                        Compare Kloner
                    </h1>
                    <p className="mt-3 text-sm md:text-base text-neutral-600 max-w-prose">
                        High-level comparisons to help you decide whether cloning, a full
                        rebuild, or another hosting stack is right for a given project.
                        This page stays non-technical and focuses on tradeoffs, not
                        implementation details.
                    </p>

                    {/* Cloning vs Rebuild */}
                    <section id="cloning-vs-rebuild" className="mt-10 space-y-3">
                        <h2 className="text-xl md:text-2xl font-semibold">
                            Cloning vs rebuild
                        </h2>
                        <p className="text-sm md:text-base text-neutral-600">
                            Use Kloner when you want to start from an existing public layout
                            and refine it. Choose a full rebuild when you need a new visual
                            language, complex product flows, or heavy backend logic.
                        </p>
                    </section>

                    {/* Vercel vs Netlify */}
                    <section id="vercel-vs-netlify" className="mt-10 space-y-3">
                        <h2 className="text-xl md:text-2xl font-semibold">
                            Vercel vs Netlify
                        </h2>
                        <p className="text-sm md:text-base text-neutral-600">
                            Kloner exports neutral code. You decide where to host it. Both
                            Vercel and Netlify work well for static or hybrid frontends; your
                            choice comes down to pricing, geography, and team preference.
                        </p>
                    </section>

                    {/* Static vs SSR */}
                    <section id="static-vs-ssr" className="mt-10 space-y-3">
                        <h2 className="text-xl md:text-2xl font-semibold">
                            Static vs SSR
                        </h2>
                        <p className="text-sm md:text-base text-neutral-600">
                            Static export is usually enough for marketing sites and landing
                            pages. Server rendering makes sense when you need per-request
                            personalization, auth-heavy pages, or dynamic dashboards.
                        </p>
                    </section>

                    {/* Export Options */}
                    <section id="export-options" className="mt-10 space-y-3">
                        <h2 className="text-xl md:text-2xl font-semibold">Export options</h2>
                        <p className="text-sm md:text-base text-neutral-600">
                            Kloner supports clean export with captured assets. You own the
                            code, are responsible for how it is used, and you control any
                            additional libraries, frameworks, or hosting providers.
                        </p>
                        <a
                            href="/docs#export-options"
                            className="inline-flex mt-2 text-sm font-medium"
                            style={{ color: ACCENT }}
                        >
                            View export guidance in Docs
                        </a>
                    </section>
                </div>
            </section>
        </main>
    );
}
