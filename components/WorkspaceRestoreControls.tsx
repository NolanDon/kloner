"use client";

import { useRef, useState } from "react";
import { WorkspaceAgentLoader } from "./WorkspaceAgentActivity";

export type WorkspaceRestoreState = { pointId: string; undone?: boolean; kept?: boolean };

export default function WorkspaceRestoreControls({ state, disabled, restore, onChange }: {
    state: WorkspaceRestoreState;
    disabled: boolean;
    restore: (pointId: string) => Promise<string>;
    onChange: (state: WorkspaceRestoreState) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const inFlight = useRef(false);
    const run = async () => {
        if (inFlight.current || disabled) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
            const inverse = await restore(state.pointId);
            onChange({ pointId: inverse, undone: !state.undone, kept: false });
        } catch (e) {
            setError(e instanceof Error ? e.message : "I couldn't restore that change. Please try again.");
        } finally { inFlight.current = false; setBusy(false); }
    };
    return <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || disabled} onClick={() => void run()} className="rounded-full border border-orange-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 disabled:opacity-50">
                {state.undone ? "Reapply" : "Undo"}
            </button>
            {!state.undone && <button type="button" disabled={busy || disabled || state.kept} onClick={() => onChange({ ...state, kept: true })} className="rounded-full bg-[#FF8D21] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{state.kept ? "Kept" : "Keep"}</button>}
            {state.undone && <span className="text-xs text-neutral-500">Change undone</span>}
        </div>
        {busy && <WorkspaceAgentLoader />}
        {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>;
}
