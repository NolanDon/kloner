"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        const body = {
            source: "frontend",
            severity: "critical",
            statusCode: 500,
            page: typeof window !== "undefined" ? window.location.pathname : "unknown",
            action: "next.global-error",
            message: error?.message || "Frontend global runtime error",
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
        <html>
            <body>
                <h2>Something went wrong.</h2>
                <button onClick={() => reset()}>Try again</button>
            </body>
        </html>
    );
}
