"use client";

import { useMemo, useState } from "react";
import { X, ChevronDown } from "lucide-react";
import type { AppEmbeddingEditPlanOp, AppEmbeddingEditPlanResponse } from "@/src/lib/appEmbeddingsClient";

function opLabel(op: AppEmbeddingEditPlanOp): string {
    const action = String(op.op || "replace").toLowerCase();
    if (action === "insert_before") return "Insert before";
    if (action === "insert_after") return "Insert after";
    if (action === "delete") return "Delete";
    return "Replace";
}

function formatLineRange(target: AppEmbeddingEditPlanOp["target"]): string | null {
    if (!target) return null;
    const start = typeof target.lineStart === "number" && Number.isFinite(target.lineStart) ? target.lineStart : null;
    const end = typeof target.lineEnd === "number" && Number.isFinite(target.lineEnd) ? target.lineEnd : null;
    if (start == null && end == null) return null;
    if (start != null && end != null) return `lines ${start}-${end}`;
    if (start != null) return `line ${start}`;
    return `line ${end}`;
}

function formatTargetSummary(op: AppEmbeddingEditPlanOp): string {
    const target = op.target;
    if (!target) return "Backend did not provide anchor details.";

    const parts: string[] = [];
    const lineRange = formatLineRange(target);
    const anchor = typeof target.anchorText === "string" && target.anchorText.trim() ? target.anchorText.trim() : null;
    const beforeText = typeof target.beforeText === "string" && target.beforeText.trim() ? target.beforeText.trim() : null;
    const afterText = typeof target.afterText === "string" && target.afterText.trim() ? target.afterText.trim() : null;

    if (target.chunkId) parts.push(`chunk ${target.chunkId}`);
    if (target.chunkHash) parts.push(`chunk hash ${target.chunkHash}`);
    if (target.fileHash) parts.push(`file hash ${target.fileHash}`);
    if (lineRange) parts.push(lineRange);
    if (anchor) parts.push(`anchor: ${anchor}`);
    if (beforeText) parts.push(`before: ${beforeText}`);
    if (afterText) parts.push(`after: ${afterText}`);

    return parts.length ? parts.join(" · ") : "No anchor metadata provided.";
}

function jsonPreview(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

interface EditPlanReviewModalProps {
    open: boolean;
    plan: AppEmbeddingEditPlanResponse | null;
    applying?: boolean;
    applyError?: string | null;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function EditPlanReviewModal({ open, plan, applying = false, applyError, onConfirm, onCancel }: EditPlanReviewModalProps) {
    const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

    const ops = useMemo(() => (Array.isArray(plan?.ops) ? plan.ops : []), [plan?.ops]);
    const rawJson = useMemo(() => jsonPreview(plan), [plan]);

    if (!open || !plan) return null;

    const needsMoreContext = Boolean(plan.needsMoreContext);
    const canConfirm = !needsMoreContext && ops.length > 0 && !applying;

    return (
        <div className="fixed inset-0 z-[22000] flex items-center justify-center bg-black/45 p-4">
            <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)]">
                <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
                    <div className="min-w-0 space-y-1">
                        <div className="text-sm font-semibold text-neutral-900">Review edit plan</div>
                        <div className="text-xs text-neutral-500">Backend plan is shown as received. Nothing is applied until you confirm.</div>
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200"
                        aria-label="Close review modal"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="max-h-[72vh] overflow-auto px-5 py-4">
                    {needsMoreContext ? (
                        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                            The backend needs more context before it can produce a safe apply plan.
                        </div>
                    ) : null}

                    {applyError ? (
                        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950 whitespace-pre-wrap">
                            {applyError}
                        </div>
                    ) : null}

                    <div className="space-y-3">
                        {(ops || []).map((op, index) => (
                            <div key={`${op.path}-${index}`} className="rounded-2xl border border-neutral-200 bg-neutral-50/70 px-4 py-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-neutral-900">{op.path}</div>
                                        <div className="mt-1 text-xs text-neutral-500">{opLabel(op)}</div>
                                    </div>
                                    <div className="text-right text-xs text-neutral-500">
                                        {op.encoding ? <div>encoding: {op.encoding}</div> : null}
                                        {op.baseFileHash ? <div>base hash: {op.baseFileHash}</div> : null}
                                    </div>
                                </div>

                                <div className="mt-3 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700">
                                    <div className="font-medium text-neutral-900">Anchor</div>
                                    <div className="mt-1 whitespace-pre-wrap break-words">{formatTargetSummary(op)}</div>
                                </div>

                                {op.reason ? (
                                    <div className="mt-3 text-xs text-neutral-600">
                                        <span className="font-medium text-neutral-900">Reason:</span> {op.reason}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>

                    <details className="mt-4 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-neutral-700">
                            <span>Technical details</span>
                            <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500" />
                        </summary>
                        <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-neutral-950 px-4 py-3 text-[11px] leading-5 text-neutral-100">
                            {rawJson}
                        </pre>
                    </details>
                </div>

                <div className="flex flex-col gap-2 border-t border-neutral-200 px-5 py-4 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50"
                        disabled={applying}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={!canConfirm}
                        className="inline-flex items-center justify-center rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#e14f1c] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {applying ? "Applying…" : needsMoreContext ? "Need more context" : "Apply changes"}
                    </button>
                </div>
            </div>
        </div>
    );
}
