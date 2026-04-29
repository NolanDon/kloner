
import { ChevronDown, Info } from "lucide-react";
import { type AppEmbeddingEditPlanJobStatus } from "@/src/lib/appEmbeddingsClient";

function formatSeconds(value: number | null | undefined): string | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    if (value < 60) return `${Math.round(value)}s`;
    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

interface EditPlanJobStatusCardProps {
    job: AppEmbeddingEditPlanJobStatus;
    onDismiss?: () => void;
    onRetry?: () => void;
    applyStatusMessage?: string | null;
}

export default function EditPlanJobStatusCard({ job, onDismiss, onRetry }: EditPlanJobStatusCardProps) {
    const status = String(job.status || "queued").toLowerCase();
    const retryAfterSeconds = typeof (job.error as any)?.retryAfterSeconds === "number"
        ? (job.error as any).retryAfterSeconds
        : null;
    const errorCode = typeof (job.error as any)?.code === "string" ? (job.error as any).code : null;
    const errorMessage = typeof (job.error as any)?.message === "string"
        ? (job.error as any).message
        : typeof job.error === "string"
            ? job.error
            : null;
    const showDevDetails = process.env.NODE_ENV !== "production";
    const proposal = job.result?.proposal ?? null;
    const proposalFiles = Array.isArray(proposal?.files) ? proposal.files : [];
    const proposalFileCount = typeof proposal?.fileCount === "number" && Number.isFinite(proposal.fileCount) ? proposal.fileCount : proposalFiles.length;
    const linesAdded = typeof proposal?.totalEstimatedLinesAdded === "number" && Number.isFinite(proposal.totalEstimatedLinesAdded) ? proposal.totalEstimatedLinesAdded : null;
    const linesRemoved = typeof proposal?.totalEstimatedLinesRemoved === "number" && Number.isFinite(proposal.totalEstimatedLinesRemoved) ? proposal.totalEstimatedLinesRemoved : null;
    const filesAddedTotal = proposalFiles.reduce((sum, file) => sum + (typeof file.estimatedLinesAdded === "number" && Number.isFinite(file.estimatedLinesAdded) ? file.estimatedLinesAdded : 0), 0);
    const filesRemovedTotal = proposalFiles.reduce((sum, file) => sum + (typeof file.estimatedLinesRemoved === "number" && Number.isFinite(file.estimatedLinesRemoved) ? file.estimatedLinesRemoved : 0), 0);
    const totalAdded = linesAdded !== null ? linesAdded : filesAddedTotal;
    const totalRemoved = linesRemoved !== null ? linesRemoved : filesRemovedTotal;
    const proposalSummary = String(proposal?.summary || "").trim();
    const proposalModel = String(proposal?.model || "").trim();
    const proposalNeedsRebuild = proposal?.needsRebuild === true;
    const proposalNeedsMoreContext = proposal?.needsMoreContext === true;
    const proposalAutoApplyAllowed = proposal?.autoApplyAllowed !== false;

    const proposalSection = proposal && status === "completed" ? (
        <div className="space-y-4 text-neutral-700 w-full">
            <details className="group w-full rounded-3xl border border-neutral-200 bg-white/90 shadow-lg shadow-black/5">
                <summary className="flex w-full cursor-pointer list-none items-center gap-3 px-4 py-4">
                    <div className="min-w-0 flex-1">
                        <div className="font-medium text-neutral-900">{proposalFileCount} files changed</div>
                        {/* <div className="text-[11px] text-neutral-500">Open to review the file list.</div> */}
                    </div>
                    <div className="flex items-center gap-3 text-xs font-semibold tabular-nums">
                        <span className="text-emerald-600">+{totalAdded}</span>
                        <span className="text-rose-600">-{totalRemoved}</span>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500 transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-neutral-200 bg-neutral-50/40 px-4 py-4 space-y-4">
                    {proposalFiles.length > 0 ? (
                        <div className="space-y-3">
                            {proposalFiles.map((file) => renderFilePreview(file))}
                        </div>
                    ) : null}
                </div>
            </details>
        </div>
    ) : null;

    function renderPreviewSection(label: string, tone: "added" | "deleted", content: string | null | undefined) {
        if (!content || !content.trim()) return null;
        const toneClasses = tone === "added"
            ? "border-emerald-200 bg-emerald-50/60 text-emerald-700"
            : "border-rose-200 bg-rose-50/60 text-rose-700";

        return (
            <div className={`space-y-2 rounded-2xl border px-4 py-4 ${toneClasses}`}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em]">{label}</div>
                <pre className="max-h-[28rem] overflow-auto whitespace-pre font-mono text-[12px] leading-6 text-neutral-900 rounded-xl border border-white/70 bg-white/95 px-4 py-4 shadow-sm">
                    {content}
                </pre>
            </div>
        );
    }

    function renderFilePreview(file: (typeof proposalFiles)[number]) {
        const beforeLineCount = typeof file.beforeLineCount === "number" && Number.isFinite(file.beforeLineCount) ? file.beforeLineCount : null;
        const afterLineCount = typeof file.afterLineCount === "number" && Number.isFinite(file.afterLineCount) ? file.afterLineCount : null;
        const estimatedLinesAdded = typeof file.estimatedLinesAdded === "number" && Number.isFinite(file.estimatedLinesAdded) ? file.estimatedLinesAdded : null;
        const estimatedLinesRemoved = typeof file.estimatedLinesRemoved === "number" && Number.isFinite(file.estimatedLinesRemoved) ? file.estimatedLinesRemoved : null;
        const lineStart = typeof file.target?.lineStart === "number" && Number.isFinite(file.target.lineStart) ? file.target.lineStart : null;
        const lineEnd = typeof file.target?.lineEnd === "number" && Number.isFinite(file.target.lineEnd) ? file.target.lineEnd : null;
        const addedPreview = file.afterPreview || file.content || null;
        const deletedPreview = file.beforePreview || null;

        return (
            <details key={file.path} className="group w-full rounded-3xl border border-neutral-200 bg-white shadow-lg shadow-black/5">
                <summary className="flex w-full cursor-pointer list-none items-center gap-3 px-4 py-4">
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-neutral-900">{file.path}</div>
                        <div className="text-[11px] text-neutral-500">
                            {String(file.op || "replace").replace(/_/g, " ")}
                            {file.delete ? " · delete" : ""}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-semibold tabular-nums">
                        <span className="text-emerald-600">+{estimatedLinesAdded !== null ? estimatedLinesAdded : 0}</span>
                        <span className="text-rose-600">-{estimatedLinesRemoved !== null ? estimatedLinesRemoved : 0}</span>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500 transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-neutral-200 bg-neutral-50/40 px-4 py-4 space-y-4">
                    <div className="grid gap-2 text-xs text-neutral-600 sm:grid-cols-2">
                        <div>Before lines: {beforeLineCount !== null ? beforeLineCount : "unknown"}.</div>
                        <div>After lines: {afterLineCount !== null ? afterLineCount : "unknown"}.</div>
                        {lineStart !== null || lineEnd !== null ? (
                            <div className="sm:col-span-2">Target lines: {lineStart !== null ? lineStart : "?"} to {lineEnd !== null ? lineEnd : "?"}.</div>
                        ) : null}
                    </div>
                    <div className="space-y-3">
                        {file.delete ? renderPreviewSection("Deleted", "deleted", deletedPreview) : null}
                        {!file.delete && deletedPreview ? renderPreviewSection("Before", "deleted", deletedPreview) : null}
                        {renderPreviewSection(file.delete ? "Deleted" : "Added", "added", addedPreview)}
                    </div>
                </div>
            </details>
        );
    }

    return (
        <div className="space-y-4 text-sm leading-relaxed text-neutral-700">
            <div className="min-w-0 space-y-3">
                {proposalSection}
            </div>

            {showDevDetails ? (
                <details className="pt-1">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-neutral-700">
                        <span className="inline-flex items-center gap-1.5">
                            <span>View details</span>
                            <span
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-600"
                                aria-label="Development-only details"
                                title="Development-only details"
                            >
                                <Info className="h-2.5 w-2.5" aria-hidden="true" />
                            </span>
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500" />
                    </summary>
                    <div className="mt-3 space-y-2 text-xs text-neutral-600">
                        <div>Job status: {job.status}.</div>
                        {job.stage ? <div>Job stage: {job.stage}.</div> : null}
                        {job.statusUrl ? <div className="break-all">Status URL: {job.statusUrl}.</div> : null}
                        <div>Request ID: {job.requestId || "unknown"}.</div>
                        <div>Job ID: {job.jobId || "unknown"}.</div>
                        <div>Files: {proposalFileCount}.</div>
                        <div>Estimated lines added: {linesAdded !== null ? linesAdded : totalAdded}.</div>
                        <div>Estimated lines removed: {linesRemoved !== null ? linesRemoved : totalRemoved}.</div>
                        <div>Needs rebuild: {proposalNeedsRebuild ? "yes" : "no"}.</div>
                        <div>Needs more context: {proposalNeedsMoreContext ? "yes" : "no"}.</div>
                        {proposalModel ? <div>Model: {proposalModel}.</div> : null}
                        {proposalSummary ? <div>Summary: {proposalSummary}.</div> : null}
                        {typeof job.queueAgeSeconds === "number" && Number.isFinite(job.queueAgeSeconds) ? <div>Waiting time: {formatSeconds(job.queueAgeSeconds)}.</div> : null}
                        {typeof job.queuedForSeconds === "number" && Number.isFinite(job.queuedForSeconds) ? <div>Queued for: {formatSeconds(job.queuedForSeconds)}.</div> : null}
                        {typeof job.runningForSeconds === "number" && Number.isFinite(job.runningForSeconds) ? <div>Running for: {formatSeconds(job.runningForSeconds)}.</div> : null}
                        {typeof job.attemptCount === "number" && Number.isFinite(job.attemptCount) ? <div>Attempt number: {job.attemptCount}.</div> : null}
                        {typeof job.leaseRemainingSeconds === "number" && Number.isFinite(job.leaseRemainingSeconds) ? <div>Lease remaining: {formatSeconds(job.leaseRemainingSeconds)}.</div> : null}
                        {status === "failed" || status === "expired" ? (
                            <div className="space-y-1 pt-1 text-neutral-700">
                                <div>{errorMessage || "The edit plan job stopped before it could finish."}.</div>
                                {errorCode ? <div>Error code: {errorCode}.</div> : null}
                                {typeof retryAfterSeconds === "number" ? <div>Retry after: {retryAfterSeconds}s.</div> : null}
                            </div>
                        ) : null}
                    </div>
                </details>
            ) : null}
        </div>
    );
}