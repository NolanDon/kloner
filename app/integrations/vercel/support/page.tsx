// app/integrations/vercel/support/page.tsx
"use client";

import NavBar from "@/components/NavBar";
import { Mail, MessageCircleMore, AlertTriangle } from "lucide-react";

const ACCENT = "#f55f2a";

export default function KlonerVercelSupport() {
    return (
        <>
            <NavBar />
            <main className="min-h-screen bg-white py-[120px]">
                <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-10 py-10 space-y-8">
                    <header className="space-y-2">
                        <p className="text-xs font-semibold tracking-[0.18em] text-neutral-500 uppercase">
                            Support • Kloner + Vercel
                        </p>
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-900">
                            Need help with the Kloner integration?
                        </h1>
                        <p className="text-sm text-neutral-600">
                            Use the channels below when something fails to deploy or you hit an unexpected error
                            while connecting Vercel.
                        </p>
                    </header>

                    <section className="space-y-3">
                        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                            <div className="flex items-start gap-3">
                                <div
                                    className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50"
                                    aria-hidden
                                >
                                    <Mail className="h-4 w-4" />
                                </div>
                                <div className="space-y-1">
                                    <h2 className="text-sm font-semibold text-neutral-900">Email support</h2>
                                    <p className="text-sm text-neutral-700">
                                        For deployment failures, include the Vercel project name, deployment ID, and the
                                        URL you attempted to clone.
                                    </p>
                                    <p className="text-sm">
                                        <a
                                            href="mailto:support@kloner.app"
                                            className="font-semibold text-neutral-900 underline"
                                        >
                                            support@kloner.app
                                        </a>
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                            <div className="flex items-start gap-3">
                                <div
                                    className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50"
                                    aria-hidden
                                >
                                    <MessageCircleMore className="h-4 w-4" />
                                </div>
                                <div className="space-y-1">
                                    <h2 className="text-sm font-semibold text-neutral-900">What to send</h2>
                                    <ul className="list-disc pl-5 text-sm text-neutral-700 space-y-1">
                                        <li>The URL you tried to clone.</li>
                                        <li>The Vercel team or account where you installed the integration.</li>
                                        <li>The timestamp of the failing deployment.</li>
                                        <li>Any error message shown in Kloner or Vercel.</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
                            <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5" />
                            <p className="text-xs text-amber-800">
                                Never share full environment variables, secrets, or API keys with support. If needed,
                                redact values and keep only the key names.
                            </p>
                        </div>
                    </section>
                </div>
            </main>
        </>
    );
}
