function LoadingCard({ className = "" }: { className?: string }) {
    return (
        <div
            className={`rounded-3xl border border-neutral-200 bg-white/90 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur ${className}`}
        >
            <div className="animate-pulse space-y-3">
                <div className="h-4 w-24 rounded-full bg-neutral-200" />
                <div className="h-8 w-2/3 rounded-2xl bg-neutral-100" />
                <div className="h-4 w-full rounded-full bg-neutral-100" />
                <div className="h-4 w-5/6 rounded-full bg-neutral-100" />
            </div>
        </div>
    );
}

export default function Loading() {
    return (
        <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,141,33,0.12),transparent_34%),linear-gradient(180deg,#fff,#fffaf6_50%,#ffffff)] text-neutral-900">
            <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
                <div className="w-full">
                    <div className="mb-8 flex items-center justify-between gap-4">
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#FF8D21]">
                                Kloner
                            </div>
                            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                                Preparing your app
                            </h1>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">
                                We are loading the latest project state and files. This screen should appear immediately on first open, even while the editor finishes hydrating in the background.
                            </p>
                        </div>

                        <div className="hidden rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 shadow-sm sm:inline-flex">
                            Opening
                            <span className="ml-2 inline-flex items-center gap-1.5" aria-hidden="true">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF8D21]" />
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF8D21]" style={{ animationDelay: "150ms" }} />
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF8D21]" style={{ animationDelay: "300ms" }} />
                            </span>
                        </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                        <LoadingCard className="min-h-[320px]" />
                        <div className="grid gap-4">
                            <LoadingCard />
                            <LoadingCard />
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}
