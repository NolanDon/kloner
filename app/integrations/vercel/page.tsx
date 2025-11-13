// app/integrations/vercel/page.tsx
"use client";

import NavBar from "@/components/NavBar";
import { Rocket, MonitorSmartphone, Wand2, ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

const ACCENT = "#f55f2a";

export default function KlonerVercelLanding() {
    return (
        <>
        <NavBar />
            <main className="min-h-screen bg-white py-[120px]">
                <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-10 py-10 space-y-10">
                    {/* Hero */}
                    <section className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                        <div className="max-w-xl space-y-4">
                            <p className="text-xs font-semibold tracking-[0.18em] text-neutral-500 uppercase">
                                Integration • Vercel
                            </p>
                            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-neutral-800">
                                Turn any live page into a Vercel project in minutes.
                            </h1>
                            <p className="text-sm sm:text-base text-neutral-600">
                                Kloner captures a live URL, produces clean editable HTML, and ships it straight
                                to your own Vercel account. No repo scaffolding, no manual copying, no setup drag.
                            </p>
                            <div className="flex flex-wrap gap-3 pt-2">
                                <Link
                                    href="https://vercel.com/integrations" // replace with actual marketplace URL
                                    className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm"
                                    style={{ background: ACCENT }}
                                >
                                    Add Kloner to Vercel
                                    <Rocket className="h-4 w-4" />
                                </Link>
                                <Link
                                    href="/integrations/vercel/docs"
                                    className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                                >
                                    View integration docs
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                            </div>
                        </div>

                        <div className="mt-6 md:mt-0 w-full max-w-sm mx-auto">
                            <div className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-950 text-white shadow-sm">
                                <div className="flex items-center justify-between px-4 pt-3 pb-2 text-xs text-neutral-400">
                                    <span>kloner.app</span>
                                    <span className="flex items-center gap-1">
                                        <MonitorSmartphone className="h-3 w-3" />
                                        Live page → Vercel
                                    </span>
                                </div>
                                <div className="px-4 pb-4 space-y-3">
                                    <div className="rounded-xl bg-neutral-900/80 border border-neutral-800 px-4 py-3 text-xs">
                                        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                                            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                            <span>Step 1</span>
                                        </div>
                                        <p className="mt-1 text-sm font-medium text-white">
                                            Paste a URL inside Kloner and capture a pixel-perfect snapshot.
                                        </p>
                                    </div>
                                    <div className="rounded-xl bg-neutral-900/60 border border-neutral-800 px-4 py-3 text-xs">
                                        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                                            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-400" />
                                            <span>Step 2</span>
                                        </div>
                                        <p className="mt-1 text-sm font-medium text-white">
                                            Tweak HTML visually, then deploy directly to a new Vercel project.
                                        </p>
                                    </div>
                                    <p className="text-[11px] text-neutral-500">
                                        Vercel stays the source of truth. Kloner only pushes deployments on your
                                        behalf, using the scopes you approve.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Feature cards */}
                    <section className="space-y-4">
                        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-800">
                            What the Kloner + Vercel integration does
                        </h2>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <FeatureCard
                                icon={<Wand2 className="h-5 w-5" />}
                                title="Clone live pages"
                                body="Capture an existing website, strip the noise, and generate editable HTML in Kloner."
                            />
                            <FeatureCard
                                icon={<Rocket className="h-5 w-5" />}
                                title="One-click deploy"
                                body="Create a Vercel project from your Kloner preview and publish in a few clicks."
                            />
                            <FeatureCard
                                icon={<ShieldCheck className="h-5 w-5" />}
                                title="Scoped access"
                                body="Only the minimal deployment, project, and domain scopes required to push your sites."
                            />
                        </div>
                    </section>

                    {/* Links */}
                    <section className="space-y-2">
                        <h3 className="text-sm font-semibold text-neutral-800">Helpful links</h3>
                        <div className="flex flex-wrap gap-3 text-sm">
                            <Link href="/integrations/vercel/docs" className="text-neutral-700 hover:text-neutral-800 underline">
                                Documentation
                            </Link>
                            <Link href="/integrations/vercel/support" className="text-neutral-700 hover:text-neutral-800 underline">
                                Support
                            </Link>
                            <Link href="/privacy" className="text-neutral-700 hover:text-neutral-800 underline">
                                Privacy
                            </Link>
                        </div>
                    </section>
                </div>
            </main>
        </>
    );
}

function FeatureCard(props: { icon: React.ReactNode; title: string; body: string }) {
    return (
        <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50"
                aria-hidden
            >
                {props.icon}
            </div>
            <h4 className="text-sm font-semibold text-neutral-800">{props.title}</h4>
            <p className="text-xs text-neutral-600">{props.body}</p>
        </div>
    );
}
