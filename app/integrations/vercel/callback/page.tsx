// app/integrations/vercel/callback/page.tsx
import Link from "next/link";

const ACCENT = "#f55f2a";

type PageProps = {
    searchParams: { [key: string]: string | string[] | undefined };
};

export default function VercelIntegrationCallbackPage({ searchParams }: PageProps) {
    const statusParam = searchParams.status;
    const reasonParam = searchParams.reason;

    const status = Array.isArray(statusParam) ? statusParam[0] : statusParam ?? "success";
    const reason = Array.isArray(reasonParam) ? reasonParam[0] : null;
    const isSuccess = status === "success";

    const title = isSuccess
        ? "Vercel is now connected"
        : "We couldn’t finish connecting Vercel";

    const message = isSuccess
        ? "Your Vercel account is now linked to Kloner. You can jump back into your dashboard and start deploying cloned pages."
        : reason === "state"
            ? "The security check for this OAuth request failed. This usually happens if the link was reused or the session expired. Try connecting Vercel again from Kloner."
            : reason === "token"
                ? "Vercel returned an error while exchanging the authorization code. Try again from Kloner; if it keeps failing, check your Vercel OAuth app configuration."
                : "Something went wrong while talking to Vercel. Try reconnecting from Kloner.";

    return (
        <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
            <div className="max-w-lg w-full">
                <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900 to-black/60 px-6 sm:px-8 py-8 sm:py-10 shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
                    {/* animated badge */}
                    <div className="flex justify-center mb-6">
                        <div className="relative h-32 w-32 sm:h-36 sm:w-36 flex items-center justify-center">
                            {/* pulsing ring – only if success */}
                            {isSuccess && (
                                <>
                                    <span
                                        className="absolute inline-flex h-24 w-24 rounded-full opacity-60 animate-ping"
                                        style={{ backgroundColor: ACCENT }}
                                    />
                                    <span
                                        className="absolute inline-flex h-20 w-20 rounded-full opacity-40"
                                        style={{ boxShadow: `0 0 40px ${ACCENT}` }}
                                    />
                                </>
                            )}
                            {/* solid circle + icon */}
                            <span
                                className="relative inline-flex h-16 w-16 items-center justify-center rounded-full shadow-lg"
                                style={{
                                    backgroundColor: isSuccess ? ACCENT : "#ef4444",
                                    boxShadow: isSuccess
                                        ? `0 12px 30px ${ACCENT}88`
                                        : "0 12px 30px rgba(239,68,68,0.5)",
                                }}
                            >
                                {isSuccess ? (
                                    <svg
                                        viewBox="0 0 24 24"
                                        className="h-8 w-8 text-white"
                                        aria-hidden="true"
                                    >
                                        <path
                                            fill="currentColor"
                                            d="M9.55 16.6 5.4 12.45l1.4-1.4 2.75 2.75 7.65-7.65 1.4 1.4Z"
                                        />
                                    </svg>
                                ) : (
                                    <svg
                                        viewBox="0 0 24 24"
                                        className="h-8 w-8 text-white"
                                        aria-hidden="true"
                                    >
                                        <path
                                            fill="currentColor"
                                            d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm0 5a1 1 0 0 1 .993.883L13 8v6a1 1 0 0 1-1.993.117L11 14V8a1 1 0 0 1 1-1Zm0 10a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z"
                                        />
                                    </svg>
                                )}
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
