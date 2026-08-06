export default function Loading() {
    return (
        <main className="min-h-screen bg-white text-neutral-900">
            <div className="fixed inset-0 grid place-items-center px-4" role="status" aria-live="polite" aria-busy="true">
                <div className="w-full max-w-[320px] rounded-2xl border border-neutral-200 bg-white px-6 py-8 shadow-sm">
                    <div className="flex flex-col items-center justify-center text-center">
                        <div className="text-sm font-semibold leading-5 tracking-[-0.01em] text-neutral-900">
                            Loading workspace
                        </div>
                        <div className="kloner-dots" aria-hidden="true">
                            <span className="kloner-dot" />
                            <span className="kloner-dot" />
                            <span className="kloner-dot" />
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}
