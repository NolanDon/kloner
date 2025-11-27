// app/integrations/vercel/callback/VercelIntegrationCallbackClient.tsx
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const ACCENT = "#f55f2a";

export function VercelIntegrationCallbackClient() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const statusParam = searchParams.get("status");
    const reasonParam = searchParams.get("reason");

    const status = statusParam ?? "success";
    const reason = reasonParam;
    const isSuccess = status === "success";

    useEffect(() => {
        if (!isSuccess) return;

        try {
            window.localStorage.setItem("kloner_vercel_connected", "1");
        } catch {
            // ignore
        }

        router.replace("/dashboard/view?vercel=connected");
    }, [isSuccess, router]);

    if (isSuccess) {
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
                <div className="max-w-md w-full text-center space-y-3">
                    <p className="text-[11px] font-semibold tracking-[0.25em] uppercase text-zinc-400">
                        Vercel integration
                    </p>
                    <h1 className="text-xl font-semibold tracking-tight">
                        Finishing connection…
                    </h1>
                    <p className="text-sm text-zinc-300/90 leading-relaxed">
                        Redirecting you back to your Kloner dashboard. If nothing happens,
                        click the button below.
                    </p>
                    <div className="mt-4">
                        <Link
                            href="/dashboard/view?vercel=connected"
                            className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-transform hover:-translate-y-0.5"
                            style={{
                                backgroundColor: ACCENT,
                                boxShadow: `0 12px 30px ${ACCENT}55`,
                            }}
                        >
                            Return to dashboard
                        </Link>
                    </div>
                </div>
            </main>
        );
    }

    const title = "We couldn’t finish connecting Vercel";

    const message =
        reason === "state"
            ? "The security check for this OAuth request failed. This usually happens if the link was reused or the session expired. Try connecting Vercel again from Kloner."
            : reason === "token"
                ? "Vercel returned an error while exchanging the authorization code. Try again from Kloner; if it keeps failing, check your Vercel OAuth app configuration."
                : reason === "auth"
                    ? "We couldn’t confirm your Kloner session while handling the Vercel callback. Sign in again on Kloner, then reconnect Vercel from the dashboard."
                    : reason === "db"
                        ? "We connected to Vercel but couldn’t save the integration in your Kloner account. Nothing was linked. Try again in a moment."
                        : "Something went wrong while talking to Vercel. Try reconnecting from Kloner.";

    return (
        <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
            <div className="max-w-lg w-full">
                <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900 to-black/60 px-6 sm:px-8 py-8 sm:py-10 shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
                    <div className="flex justify-center mb-6">
                        <div className="relative h-32 w-32 sm:h-36 sm:w-36 flex items-center justify-center">
                            <span
                                className="relative inline-flex h-16 w-16 items-center justify-center rounded-full shadow-lg"
                                style={{
                                    backgroundColor: "#ef4444",
                                    boxShadow: "0 12px 30px rgba(239,68,68,0.5)",
                                }}
                            >
                                <svg viewBox="0 0 24 24" className="h-8 w-8 text-white" aria-hidden="true">
                                    <path
                                        fill="currentColor"
                                        d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm0 5a1 1 0 0 1 .993.883L13 8v6a1 1 0 0 1-1.993.117L11 14V8a1 1 0 0 1 1-1Zm0 10a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z"
                                    />
                                </svg>
                            </span>
                        </div>
                    </div>

                    <div className="space-y-3 text-center">
                        <p className="text-[11px] font-semibold tracking-[0.25em] uppercase text-zinc-400">
                            Vercel integration
                        </p>
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                            {title}
                        </h1>
                        <p className="text-sm sm:text-[15px] text-zinc-300/90 leading-relaxed">
                            {message}
                        </p>
                    </div>

                    <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                        <Link
                            href="/dashboard/view"
                            className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-transform hover:-translate-y-0.5"
                            style={{
                                backgroundColor: ACCENT,
                                boxShadow: `0 12px 30px ${ACCENT}55`,
                            }}
                        >
                            Return to Kloner dashboard
                        </Link>
                        <Link
                            href="/"
                            className="text-xs sm:text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                        >
                            Go to homepage
                        </Link>
                    </div>

                    <div className="mt-5 border-t border-white/5 pt-4 text-[11px] text-zinc-500 text-center">
                        <p>If this window was opened automatically by Vercel, you can now close it.</p>
                    </div>
                </div>
            </div>
        </main>
    );
}
