export default function Loading() {
    return (
        <main className="min-h-screen bg-white text-neutral-900">
            <div className="fixed inset-0 grid place-items-center px-4" role="status" aria-live="polite" aria-busy="true">
                <div className="flex flex-col items-center justify-center text-center">
                    <div className="kloner-dots" aria-hidden="true">
                        <span className="kloner-dot" />
                        <span className="kloner-dot" style={{ animationDelay: "0.15s", opacity: 0.75 }} />
                        <span className="kloner-dot" style={{ animationDelay: "0.30s", opacity: 0.45 }} />
                    </div>
                    <div className="mt-4 text-sm text-neutral-700">
                        Loading workspace
                    </div>
                </div>
            </div>
        </main>
    );
}
