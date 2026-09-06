/** @jest-environment jsdom */
import React, { useState } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import WorkspaceRestoreControls, { type WorkspaceRestoreState } from "./WorkspaceRestoreControls";
import { WorkspaceAgentLoader } from "./WorkspaceAgentActivity";
import { useWorkspacePreviewRefresh } from "@/src/hooks/useWorkspacePreviewRefresh";
import { requestWorkspacePreviewRefresh } from "./previewRefresh";
import { stripWorkspaceInternalSummaryMetadata } from "@/src/lib/workspaceAgentSummary";

test("undo and reapply use inverse snapshots and prevent duplicate restore requests", async () => {
    let resolveRestore!: (id: string) => void;
    const restore = jest.fn(() => new Promise<string>((resolve) => { resolveRestore = resolve; }));
    function Harness() {
        const [state, setState] = useState<WorkspaceRestoreState>({ pointId: "original" });
        return <WorkspaceRestoreControls state={state} disabled={false} restore={restore} onChange={setState} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByText("Keep"));
    expect(screen.getByText("Kept")).toBeDisabled();
    fireEvent.click(screen.getByText("Undo"));
    fireEvent.click(screen.getByText("Undo"));
    expect(restore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeVisible();
    await act(async () => resolveRestore("inverse"));
    fireEvent.click(screen.getByText("Reapply"));
    expect(restore).toHaveBeenLastCalledWith("inverse");
});

test("failed restore preserves the undo control and shows the error", async () => {
    const change = jest.fn();
    render(<WorkspaceRestoreControls state={{ pointId: "original" }} disabled={false} restore={async () => { throw new Error("There are newer changes."); }} onChange={change} />);
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("newer changes"));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByText("Undo")).toBeEnabled();
});

test("V3 loader is text-free and contains three animated dots", () => {
    render(<WorkspaceAgentLoader />);
    expect(screen.getByRole("status").querySelectorAll("span")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("");
});

test("preview revision reloads once per revision after attachment", () => {
    const reload = jest.fn();
    const { rerender } = renderHook(({ revision, ready }) => useWorkspacePreviewRefresh(revision, ready, reload), { initialProps: { revision: "job:1", ready: false } });
    expect(reload).not.toHaveBeenCalled();
    rerender({ revision: "job:1", ready: true });
    rerender({ revision: "job:1", ready: true });
    rerender({ revision: "restore:1", ready: true });
    expect(reload).toHaveBeenCalledTimes(2);
});

test("workspace refresh event preserves app scope without requesting a rebuild", () => {
    const event = jest.fn();
    const rebuild = jest.fn();
    window.addEventListener("kloner:workspace-preview-updated", event);
    window.addEventListener("kloner:preview-force-fresh", rebuild);
    requestWorkspacePreviewRefresh("owned-app", "job:1");
    expect(event.mock.calls[0]?.[0]?.detail).toEqual({ appId: "owned-app", revision: "job:1" });
    expect(rebuild).not.toHaveBeenCalled();
    window.removeEventListener("kloner:workspace-preview-updated", event);
    window.removeEventListener("kloner:preview-force-fresh", rebuild);
});

test("V3 completion summaries hide internal health and restore metadata", () => {
    expect(stripWorkspaceInternalSummaryMetadata(
        "The background color changed.\n\nChanged 1 file. Health checks passed. Preview restart completed.\n\nRestore point: 36aa9467-a887-4960-a0c4-ffda8beaf18e",
    )).toBe("The background color changed.");
});
