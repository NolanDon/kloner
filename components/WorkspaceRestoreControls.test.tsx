/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import WorkspaceRestoreControls from "./WorkspaceRestoreControls";

jest.mock("./WorkspaceAgentActivity", () => ({ WorkspaceAgentLoader: () => <div>Restoring</div> }));

test("failed persistence shows a retryable undo error without claiming success or offering a paid AI repair", async () => {
    const restore = jest.fn().mockRejectedValueOnce(Object.assign(new Error("HTML file was empty before persistence: public/article/index.html"), { code: "HTML_FILE_EMPTY_BEFORE_PERSIST", requestId: "restore-request" })).mockResolvedValueOnce("inverse");
    const onChange = jest.fn();
    render(<WorkspaceRestoreControls state={{ pointId: "original" }} disabled={false} restore={restore} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Undo couldn’t safely restore");
    expect(alert.textContent).toContain("restore-request");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Fix with AI/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ pointId: "inverse", undone: true, kept: false }));
});
