"use client";

import { ChevronDown, X } from "lucide-react";
import type { AppEmbeddingEditPlanJobStatus } from "@/src/lib/appEmbeddingsClient";

function statusLabel(status: string | null | undefined): string {
    switch (String(status || "").toLowerCase()) {
        case "queued":
            return "Waiting in queue";
        case "picked_up":
            return "Picked up by worker";
        case "working":
            return "Generating edit plan";
        case "completed":
            return "Edit plan ready";
        case "failed":
            return "Edit plan failed";
        case "expired":
            return "Edit plan expired";
        default:
            return String(status || "Working").replace(/_/g, " ");
    }
}

function statusTone(status: string | null | undefined): string {
    switch (String(status || "").toLowerCase()) {
        case "queued":
            return "bg-amber-50 text-amber-800 border-amber-200";
        case "picked_up":
        case "working":
            return "bg-sky-50 text-sky-800 border-sky-200";
        case "completed":
            return "bg-emerald-50 text-emerald-800 border-emerald-200";
        case "failed":
        case "expired":
            return "bg-rose-50 text-rose-800 border-rose-200";
        default:
            return "bg-neutral-50 text-neutral-700 border-neutral-200";
    }
}

function formatSeconds(value: number | null | undefined): string | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    if (value < 60) return `${Math.round(value)}s`;
    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function clampProgress(value: number | null | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}

interface EditPlanJobStatusCardProps {
    job: AppEmbeddingEditPlanJobStatus;
    onDismiss?: () => void;
}

export default function EditPlanJobStatusCard({ job, onDismiss }: EditPlanJobStatusCardProps) {
    const status = String(job.status || "queued").toLowerCase();
    const label = statusLabel(status);
    const tone = statusTone(status);
    const progress = clampProgress(job.progress);
    const ageText = formatSeconds(job.queueAgeSeconds ?? job.queuedForSeconds ?? job.runningForSeconds);
    const retryAfterSeconds = typeof (job.error as any)?.retryAfterSeconds === "number"
        ? (job.error as any).retryAfterSeconds
        : null;
    const errorCode = typeof (job.error as any)?.code === "string" ? (job.error as any).code : null;
    const errorMessage = typeof (job.error as any)?.message === "string"
        ? (job.error as any).message
        : typeof job.error === "string"
            ? job.error
            : null;
    const isBacklogged = status === "queued" && typeof job.queueAgeSeconds === "number" && job.queueAgeSeconds >= 30;

    return (
        <div className="rounded-3xl border border-neutral-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
            <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-4 py-3">
                <div className="min-w-0 space-y-1">
                    <div className="text-sm font-semibold text-neutral-900">Edit plan job</div>
                    <div className="text-sm text-neutral-600">The editor stays usable while this runs in the background.</div>
                </div>
                {onDismiss ? (
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200"
                        aria-label="Dismiss edit plan job"
                    >
                        <X className="h-4 w-4" />
                    </button>
                ) : null}
            </div>

            <div className="space-y-4 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
                        {label}
                    </span>
                    {job.stage ? (
                        <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-600">
                            {job.stage.replace(/_/g, " ")}
                        </span>
                    ) : null}
                    {typeof job.workerId === "string" && job.workerId.trim() ? (
                        <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-600">
                            Worker {job.workerId}
                        </span>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-neutral-500">
                        <span>{progress >= 100 ? "Done" : `${progress}%`}</span>
                        <span>{status === "failed" || status === "expired" ? "Stopped" : label}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                        <div
                            className={`h-full rounded-full transition-all ${status === "failed" || status === "expired" ? "bg-rose-500" : status === "completed" ? "bg-emerald-500" : "bg-[#f55f2a]"}`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                <div className="flex flex-wrap gap-3 text-xs text-neutral-600">
                    {ageText ? <span>Age {ageText}</span> : null}
                    {typeof job.leaseRemainingSeconds === "number" && Number.isFinite(job.leaseRemainingSeconds) ? <span>Lease {formatSeconds(job.leaseRemainingSeconds)}</span> : null}
                    {typeof job.attemptCount === "number" && Number.isFinite(job.attemptCount) ? <span>Attempt {job.attemptCount}</span> : null}
                </div>

                <div className="grid gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-xs text-neutral-700 sm:grid-cols-2">
                    <div>
                        <div className="font-medium text-neutral-900">Request ID</div>
                        <div className="mt-1 break-all">{job.requestId || "unknown"}</div>
                    </div>
                    <div>
                        <div className="font-medium text-neutral-900">Job ID</div>
                        <div className="mt-1 break-all">{job.jobId || "unknown"}</div>
                    </div>
                    {typeof job.queueAgeSeconds === "number" && Number.isFinite(job.queueAgeSeconds) ? (
                        <div>
                            <div className="font-medium text-neutral-900">Queue age</div>
                            <div className="mt-1">{formatSeconds(job.queueAgeSeconds)}</div>
                        </div>
                    ) : null}
                    {typeof job.queuedForSeconds === "number" && Number.isFinite(job.queuedForSeconds) ? (
                        <div>
                            <div className="font-medium text-neutral-900">Queued for</div>
                            <div className="mt-1">{formatSeconds(job.queuedForSeconds)}</div>
                        </div>
                    ) : null}
                </div>

                {isBacklogged ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                        This job has been waiting longer than usual. The queue may be backed up, but it is still active.
                    </div>
                ) : null}

                {status === "failed" || status === "expired" ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-950 whitespace-pre-wrap">
                        {errorMessage || "The edit plan job stopped before it could finish."}
                        {errorCode ? `\nError code: ${errorCode}` : ""}
                        {typeof retryAfterSeconds === "number" ? `\nRetry after: ${retryAfterSeconds}s` : ""}
                    </div>
                ) : null}

                <details className="rounded-2xl border border-neutral-200 bg-white px-3 py-2">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-neutral-700">
                        <span>Debug details</span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500" />
                    </summary>
                    <div className="mt-3 space-y-2 text-xs text-neutral-600">
                        <div><span className="font-medium text-neutral-900">Status:</span> {job.status}</div>
                        {job.stage ? <div><span className="font-medium text-neutral-900">Stage:</span> {job.stage}</div> : null}
                        {job.statusUrl ? <div className="break-all"><span className="font-medium text-neutral-900">Status URL:</span> {job.statusUrl}</div> : null}
                        {typeof job.runningForSeconds === "number" && Number.isFinite(job.runningForSeconds) ? <div><span className="font-medium text-neutral-900">Running for:</span> {formatSeconds(job.runningForSeconds)}</div> : null}
                        {typeof job.leaseRemainingSeconds === "number" && Number.isFinite(job.leaseRemainingSeconds) ? <div><span className="font-medium text-neutral-900">Lease remaining:</span> {formatSeconds(job.leaseRemainingSeconds)}</div> : null}
                    </div>
                </details>
            </div>
        </div>
    );
}