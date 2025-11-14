// app/contact/page.tsx
"use client";

import NavBar from "@/components/NavBar";
import { useState } from "react";

const ACCENT = "#f55f2a";

export default function ContactPage(): JSX.Element {
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState("");

    const submit: React.FormEventHandler<HTMLFormElement> = (e) => {
        e.preventDefault();
        setBusy(true);
        setTimeout(() => {
            setBusy(false);
            setMsg(
                "Message captured locally. Wire this form to your support inbox or ticketing tool."
            );
        }, 600);
    };

    return (
        <main className="min-h-screen bg-white text-neutral-900">
            <NavBar />
            <section className="pt-[calc(var(--header-h,56px)+40px)] pb-16 px-6">
                <div className="max-w-lg mx-auto">
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                        Contact
                    </h1>
                    <p className="mt-2 text-sm md:text-base text-neutral-600">
                        Use this form as a starting point for support or partnership
                        requests. Hook it up to your real support email or CRM when ready.
                    </p>

                    <form onSubmit={submit} className="mt-6 space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-neutral-600">
                                Email
                            </label>
                            <input
                                type="email"
                                required
                                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2"
                                placeholder="you@example.com"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-medium text-neutral-600">
                                How can we help?
                            </label>
                            <textarea
                                required
                                rows={5}
                                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2 resize-none"
                                placeholder="Describe your question, project, or issue."
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={busy}
                            className="w-full inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
                            style={{ backgroundColor: ACCENT }}
                        >
                            {busy ? "Sending…" : "Send message"}
                        </button>

                        {msg && (
                            <p className="text-xs text-neutral-500 mt-2">
                                {msg}
                            </p>
                        )}
                    </form>

                    <div className="mt-8 text-xs text-neutral-500">
                        Do not send passwords, API keys, or other sensitive credentials
                        through this form.
                    </div>
                </div>
            </section>
        </main>
    );
}
