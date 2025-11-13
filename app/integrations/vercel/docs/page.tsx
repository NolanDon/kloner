// app/integrations/vercel/docs/page.tsx
"use client";

import Link from "next/link";
import { ListChecks, Rocket, Hammer } from "lucide-react";
import NavBar from "@/components/NavBar";

const ACCENT = "#f55f2a";

export default function KlonerVercelDocs() {
    return (
        <>
            <NavBar />
            <main className="min-h-screen bg-white py-[120px]">
                <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-10 py-10 space-y-8">
                    <header className="space-y-2">
                        <p className="text-xs font-semibold tracking-[0.18em] text-neutral-500 uppercase">
                            Docs • Kloner + Vercel
                        </p>
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-900">
                            Using the Kloner integration with Vercel
                        </h1>
                        <p className="text-sm text-neutral-600">
                            This page describes how Kloner connects to your Vercel account and what it does with
                            the permissions you grant.
                        </p>
                    </header>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-neutral-900">Flow overview</h2>
                        <ol className="space-y-3 text-sm text-neutral-700">
                            <li className="flex gap-3">
                                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-[11px]">
                                    1
                                </span>
                                <div>
                                    <p className="font-medium text-neutral-900">Install the integration from Vercel.</p>
                                    <p className="text-xs text-neutral-600">
                                        You approve access to deployments, projects, and domains for the selected team or
                                        personal account. Vercel then redirects you to Kloner&apos;s setup page.
                                    </p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-[11px]">
                                    2
                                </span>
                                <div>
                                    <p className="font-medium text-neutral-900">
                                        Capture and edit a page inside the Kloner dashboard.
                                    </p>
                                    <p className="text-xs text-neutral-600">
                                        You paste a URL, Kloner captures screenshots and generates editable HTML. No code
                                        is pushed to Vercel until you explicitly hit Deploy.
                                    </p>
                                </div>
                            </li>
                            <li className="flex gap-3">
                                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-[11px]">
                                    3
                                </span>
                                <div>
                                    <p className="font-medium text-neutral-900">
                                        Deploy a new project in your chosen Vercel account.
                                    </p>
                                    <p className="text-xs text-neutral-600">
                                        Kloner sends the generated files and metadata to Vercel using the Integration API.
                                        The project appears under your team with the same limits and billing as your
                                        existing Vercel usage.
                                    </p>
                                </div>
                            </li>
                        </ol>
                    </section>

                    <section className="space-y-3">
                        <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
                            <ListChecks className="h-4 w-4" />
                            Permissions used
                        </h2>
                        <ul className="space-y-2 text-sm text-neutral-700">
                            <li>
                                <strong className="font-semibold">Deployments:</strong> create deployments from
                                HTML/CSS/JS generated in Kloner.
                            </li>
                            <li>
                                <strong className="font-semibold">Projects:</strong> create and update the project
                                created for each cloned site.
                            </li>
                            <li>
                                <strong className="font-semibold">Project environment variables:</strong> optionally
                                sync basic environment values you configure inside Kloner.
                            </li>
                            <li>
                                <strong className="font-semibold">Domains (optional):</strong> attach a domain you
                                select inside Kloner to the created Vercel project.
                            </li>
                        </ul>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-neutral-900">Uninstalling</h2>
                        <p className="text-sm text-neutral-700">
                            Removing the integration in Vercel revokes Kloner&apos;s access immediately. Existing
                            deployments and projects remain in your Vercel account; Kloner simply stops pushing new
                            deployments on your behalf.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-neutral-900">Support</h2>
                        <p className="text-sm text-neutral-700">
                            If something does not deploy as expected, capture the deployment ID from your Vercel
                            dashboard and include it in your message to support.
                        </p>
                        <div className="flex flex-wrap gap-3 text-sm">
                            <Link
                                href="/integrations/vercel/support"
                                className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2 font-semibold text-neutral-800 hover:bg-neutral-50"
                            >
                                <Hammer className="h-4 w-4" />
                                Contact support
                            </Link>
                            <Link
                                href="mailto:support@kloner.app"
                                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 font-semibold text-white"
                                style={{ background: ACCENT }}
                            >
                                <Rocket className="h-4 w-4" />
                                Email support@kloner.app
                            </Link>
                        </div>
                    </section>
                </div>
            </main>
        </>
    );
}
