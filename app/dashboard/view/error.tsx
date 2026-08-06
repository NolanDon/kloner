"use client";

import { useEffect } from "react";

export default function DashboardViewError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        const body = {
            source: "frontend",
            severity: "error",
            statusCode: 500,
            page: typeof window !== "undefined" ? window.location.pathname : "/dashboard/view",
            action: "dashboard.view.error-boundary",
            message: error?.message || "Dashboard view runtime error",
            errorName: error?.name || "Error",
            stack: error?.stack || "",
            url: typeof window !== "undefined" ? window.location.href : "",
            service: "next-frontend",
            extra: {
                digest: error?.digest || null,
            },
        };

        fetch("/api/internal/observability/ingest", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify(body),
            keepalive: true,
        }).catch(() => {});
    }, [error]);

    return (
        <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
            <h2 className="text-2xl font-semibold text-neutral-900">Dashboard temporarily unavailable</h2>
            <p className="mt-2 max-w-xl text-sm text-neutral-600">
                A temporary client error interrupted this view. Your data is safe and you can retry now.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                    type="button"
                    onClick={() => reset()}
                    className="rounded-lg bg-[#FF8D21] px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                >
                    Retry
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (typeof window !== "undefined") {
                            window.location.reload();
                        }
                    }}
                    className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                >
                    Reload page
                </button>
            </div>
        </div>
    );
}
