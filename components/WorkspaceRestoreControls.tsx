"use client";

import { useEffect, useRef, useState } from "react";

export type WorkspaceRestoreState = { pointId: string; undone?: boolean; kept?: boolean };

const restoreProgressMessages = [
    "I’m bringing back the version from before that change.",
    "I’m restoring your earlier version now.",
    "I’m putting the previous version back in place.",
    "I’m checking that your earlier version is back in the preview.",
];

export default function WorkspaceRestoreControls({ state, disabled, restore, onChange, onProgress }: {
    state: WorkspaceRestoreState;
    disabled: boolean;
    restore: (pointId: string) => Promise<string>;
    onChange: (state: WorkspaceRestoreState) => void;
    onProgress?: (phase: "progress" | "success" | "failure", content: string, operationId: string) => void;
}) {
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => () => {
        if (progressTimer.current) clearInterval(progressTimer.current);
    }, []);

    const run = async () => {
        if (inFlight.current || disabled) return;
        inFlight.current = true;
        setBusy(true);
        const operationId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : String(Date.now());
        onProgress?.("progress", restoreProgressMessages[0], operationId);
        let progressIndex = 0;
        progressTimer.current = setInterval(() => {
            progressIndex = (progressIndex + 1) % restoreProgressMessages.length;
            onProgress?.("progress", restoreProgressMessages[progressIndex], operationId);
        }, 2600);
        try {
            const inverse = await restore(state.pointId);
            onChange({ pointId: inverse, undone: !state.undone, kept: false });
            onProgress?.("success", state.undone
                ? "I’ve put that change back. Your preview is ready to review."
                : "I’ve restored the earlier version. Your preview is ready to review.", operationId);
        } catch {
            onProgress?.("failure", "I couldn’t finish restoring the earlier version. Your saved project is still here; please try Undo again.", operationId);
        } finally {
            if (progressTimer.current) clearInterval(progressTimer.current);
            progressTimer.current = null;
            inFlight.current = false;
            setBusy(false);
        }
    };
    return <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || disabled} onClick={() => void run()} className={state.undone
                ? "rounded-full bg-[#FF8D21] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                : "rounded-full border border-orange-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 disabled:opacity-50"}>
                {busy ? (state.undone ? "Restoring change…" : "Undoing…") : state.undone ? "Reapply" : "Undo"}
            </button>
            {!state.undone && <button type="button" disabled={busy || disabled || state.kept} onClick={() => onChange({ ...state, kept: true })} className="rounded-full bg-[#FF8D21] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{state.kept ? "Kept" : "Keep"}</button>}
            {state.undone && <span className="text-xs text-neutral-500">Change undone</span>}
        </div>
    </div>;
}
