"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type ObsEvent = {
    id: string;
    source?: string;
    severity?: string;
    statusCode?: number;
    method?: string;
    route?: string;
    page?: string;
    action?: string;
    userId?: string;
    requestId?: string;
    message?: string;
    errorName?: string;
    stack?: string;
    url?: string;
    service?: string;
    environment?: string;
    createdAt?: string | null;
    occurredAt?: string | null;
    extra?: Record<string, unknown>;
};

function formatTs(ts?: string | null): string {
    if (!ts) return "n/a";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
}

function statusBadgeClass(code?: number): string {
    if (!code) return "bg-neutral-100 text-neutral-700";
    if (code >= 500) return "bg-red-100 text-red-700";
    if (code >= 400) return "bg-amber-100 text-amber-700";
    return "bg-emerald-100 text-emerald-700";
}

export default function DashboardObservabilityPage() {
    const searchParams = useSearchParams();
    const focusEventId = (searchParams.get("event") || "").trim();

    const [events, setEvents] = useState<ObsEvent[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>("");
    const [selectedEventId, setSelectedEventId] = useState<string>(focusEventId);
    const [stackExpanded, setStackExpanded] = useState<boolean>(false);
    const [extraExpanded, setExtraExpanded] = useState<boolean>(false);

    useEffect(() => {
        setSelectedEventId(focusEventId);
    }, [focusEventId]);

    useEffect(() => {
        setStackExpanded(false);
        setExtraExpanded(false);
    }, [selectedEventId]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError("");

        fetch("/api/admin/observability/events?limit=100", {
            method: "GET",
            cache: "no-store",
        })
            .then(async (res) => {
                const json = await res.json().catch(() => ({}));
                if (!res.ok || !json?.ok) {
                    throw new Error(json?.error || `Request failed (${res.status})`);
                }
                if (active) {
                    setEvents(Array.isArray(json.events) ? json.events : []);
                }
            })
            .catch((err: any) => {
                if (active) setError(String(err?.message || "Failed to load observability events"));
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    const selected = useMemo(
        () => events.find((event) => event.id === selectedEventId) || null,
        [events, selectedEventId],
    );

    return (
        <div className="space-y-4 p-4 md:p-6">
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
                <h1 className="text-lg font-semibold text-neutral-900">Observability</h1>
                <p className="mt-1 text-sm text-neutral-600">
                    Critical 4xx/5xx events from Vercel + Fly consolidated for review.
                </p>
            </div>

            {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-neutral-200 bg-white p-3 lg:col-span-1">
                    <div className="mb-2 text-sm font-medium text-neutral-700">Recent events</div>

                    {loading ? (
                        <div className="text-sm text-neutral-500">Loading events…</div>
                    ) : events.length === 0 ? (
                        <div className="text-sm text-neutral-500">No events found.</div>
                    ) : (
                        <div className="max-h-[65vh] space-y-2 overflow-auto pr-1">
                            {events.map((event) => {
                                const active = selectedEventId === event.id;
                                return (
                                    <button
                                        key={event.id}
                                        type="button"
                                        onClick={() => setSelectedEventId(event.id)}
                                        className={`w-full rounded-lg border p-3 text-left ${
                                            active
                                                ? "border-neutral-900 bg-neutral-50"
                                                : "border-neutral-200 hover:border-neutral-300"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span
                                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                                                    event.statusCode,
                                                )}`}
                                            >
                                                {event.statusCode || "n/a"}
                                            </span>
                                            <span className="text-xs text-neutral-500">{formatTs(event.createdAt)}</span>
                                        </div>
                                        <div className="mt-2 line-clamp-2 text-sm font-medium text-neutral-800">
                                            {event.message || "No message"}
                                        </div>
                                        <div className="mt-1 text-xs text-neutral-500">
                                            {event.source || "unknown"} • {event.route || event.page || "n/a"}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="rounded-xl border border-neutral-200 bg-white p-4 lg:col-span-2">
                    {!selected ? (
                        <div className="text-sm text-neutral-500">Select an event to inspect details.</div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                                        selected.statusCode,
                                    )}`}
                                >
                                    {selected.statusCode || "n/a"}
                                </span>
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                                    {selected.severity || "unknown"}
                                </span>
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                                    {selected.source || "unknown"}
                                </span>
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                                    {selected.service || "service:n/a"}
                                </span>
                            </div>

                            <div className="text-sm font-semibold text-neutral-900">
                                {selected.message || "No message"}
                            </div>

                            <div className="grid grid-cols-1 gap-2 text-sm text-neutral-700 md:grid-cols-2">
                                <div>Event: {selected.id}</div>
                                <div>User: {selected.userId || "anonymous"}</div>
                                <div>Action: {selected.action || "n/a"}</div>
                                <div>Method: {selected.method || "n/a"}</div>
                                <div>Route/Page: {selected.route || selected.page || "n/a"}</div>
                                <div>Req ID: {selected.requestId || "n/a"}</div>
                                <div>Occurred: {formatTs(selected.occurredAt || selected.createdAt)}</div>
                                <div>Captured: {formatTs(selected.createdAt)}</div>
                            </div>

                            {selected.url ? (
                                <a
                                    href={selected.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-neutral-900 underline"
                                >
                                    Open URL
                                </a>
                            ) : null}

                            {selected.stack ? (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Stack</div>
                                        <button
                                            type="button"
                                            onClick={() => setStackExpanded((v) => !v)}
                                            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                                        >
                                            {stackExpanded ? "Collapse" : "Expand"}
                                        </button>
                                    </div>
                                    <pre
                                        className={`${stackExpanded ? "max-h-[72vh]" : "max-h-[32vh]"} overflow-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700`}
                                    >
                                        {selected.stack}
                                    </pre>
                                </div>
                            ) : null}

                            {selected.extra ? (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Debug</div>
                                        <button
                                            type="button"
                                            onClick={() => setExtraExpanded((v) => !v)}
                                            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                                        >
                                            {extraExpanded ? "Collapse" : "Expand"}
                                        </button>
                                    </div>
                                    <pre
                                        className={`${extraExpanded ? "max-h-[60vh]" : "max-h-[24vh]"} overflow-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700`}
                                    >
                                        {JSON.stringify(selected.extra, null, 2)}
                                    </pre>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
