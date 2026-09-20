"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";

type Attempt = {
    id: string;
    uid?: string;
    tier?: string;
    url?: string;
    status?: string;
    scannedAt?: string | null;
    httpStatus?: number | null;
    backendCode?: string | null;
    backendRequestId?: string | null;
    backendSource?: string | null;
    rawError?: string | null;
    rawResponse?: string | null;
    totalPlanned?: number | null;
    requestId?: string | null;
};

type Report = {
    dateKey: string;
    counts: { success: number; failure: number; queued: number };
    emailSentAt?: string | null;
    emailError?: string | null;
    attempts: Attempt[];
};

function copyText(item: Attempt): string {
    return [
        `status=${item.status || "unknown"}`,
        `url=${item.url || ""}`,
        `uid=${item.uid || "unknown"}`,
        `tier=${item.tier || "unknown"}`,
        `scannedAt=${item.scannedAt || "unknown"}`,
        `httpStatus=${item.httpStatus ?? "n/a"}`,
        `backendCode=${item.backendCode || "n/a"}`,
        `backendRequestId=${item.backendRequestId || item.requestId || "n/a"}`,
        `backendSource=${item.backendSource || "n/a"}`,
        `totalPlanned=${item.totalPlanned ?? "n/a"}`,
        `rawError=${item.rawError || "none"}`,
        `rawResponse=${item.rawResponse || "none"}`,
    ].join("\n");
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
            onClick={async () => {
                await navigator.clipboard.writeText(value);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
            }}
        >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : label}
        </button>
    );
}

export default function AdminUrlScanReportsClient() {
    const [date, setDate] = useState("");
    const [report, setReport] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const query = date ? `?date=${encodeURIComponent(date)}` : "";
            const response = await fetch(`/api/admin/url-scan-reports${query}`, { cache: "no-store" });
            const json = await response.json().catch(() => ({}));
            if (!response.ok || !json.ok) throw new Error(json.error || "Could not load the report");
            setReport(json);
        } catch (err: any) {
            setError(err?.message || "Could not load the report");
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => { void load(); }, [load]);

    const allText = useMemo(() => (report?.attempts || []).map(copyText).join("\n\n"), [report]);

    return (
        <div className="pb-20">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-5">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Admin only</p>
                    <h1 className="mt-1 text-2xl font-semibold">Daily URL scan reports</h1>
                    <p className="mt-1 text-sm text-neutral-600">Verify which URLs were reachable and inspect the raw backend diagnostic.</p>
                </div>
                <div className="flex items-center gap-2">
                    <input className="rounded border border-neutral-300 px-3 py-2 text-sm" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    <button type="button" className="inline-flex items-center gap-2 rounded border border-neutral-300 px-3 py-2 text-sm" onClick={() => void load()}><RefreshCw size={14} />Refresh</button>
                    {report && <CopyButton value={allText} label="Copy all" />}
                </div>
            </div>

            {loading && <p className="py-8 text-sm text-neutral-500">Loading report…</p>}
            {error && <p className="py-8 text-sm text-red-600">{error}</p>}

            {report && !loading && (
                <>
                    <div className="grid gap-3 py-5 sm:grid-cols-4">
                        <Stat label="Total" value={report.attempts.length} />
                        <Stat label="Successful" value={report.counts.success} tone="green" />
                        <Stat label="Failed" value={report.counts.failure} tone="red" />
                        <Stat label="Queued" value={report.counts.queued} tone="amber" />
                    </div>
                    <div className="mb-4 text-xs text-neutral-500">
                        UTC day: {report.dateKey} · Email: {report.emailSentAt ? `sent ${new Date(report.emailSentAt).toLocaleString()}` : report.emailError ? `failed: ${report.emailError}` : "not sent"}
                    </div>
                    <div className="space-y-3">
                        {report.attempts.map((item) => (
                            <article key={item.id} className="rounded-lg border border-neutral-200 p-4 shadow-sm">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                                            <span className={item.status === "success" ? "text-green-700" : item.status === "failure" ? "text-red-700" : "text-amber-700"}>{item.status}</span>
                                            <span className="text-neutral-400">{item.httpStatus || "n/a"}</span>
                                            <span className="font-normal normal-case text-neutral-500">{item.scannedAt ? new Date(item.scannedAt).toLocaleString() : ""}</span>
                                        </div>
                                        <p className="mt-2 break-all font-mono text-sm">{item.url}</p>
                                    </div>
                                    <CopyButton value={copyText(item)} />
                                </div>
                                <div className="mt-3 grid gap-x-6 gap-y-1 text-xs text-neutral-600 sm:grid-cols-3">
                                    <span>UID: <code>{item.uid || "n/a"}</code></span>
                                    <span>Tier: {item.tier || "n/a"}</span>
                                    <span>Code: <code>{item.backendCode || "n/a"}</code></span>
                                    <span>Request: <code>{item.backendRequestId || item.requestId || "n/a"}</code></span>
                                    <span>Source: {item.backendSource || "n/a"}</span>
                                    <span>Planned: {item.totalPlanned ?? "n/a"}</span>
                                </div>
                                {item.rawError && <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded bg-red-50 p-3 text-xs text-red-900">{item.rawError}</pre>}
                            </article>
                        ))}
                        {!report.attempts.length && <p className="rounded border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">No URL scans recorded for this UTC day.</p>}
                    </div>
                </>
            )}
        </div>
    );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: string }) {
    const toneClass = tone === "green" ? "text-green-700" : tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-neutral-900";
    return <div className="rounded-lg border border-neutral-200 p-4"><p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p><p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p></div>;
}
