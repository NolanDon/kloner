/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createPortal } from "react-dom";
import { ModalProvider, useModal } from "./ModalContext";

function Editor({ onLeave }: { onLeave: () => void }) {
  const { showConfirm } = useModal();
  return createPortal(
    <div data-testid="paywall" style={{ position: "fixed", inset: 0, zIndex: 1000000 }}>
      <button onClick={async () => {
        if (await showConfirm("Leave this editor?", "Leave App Builder")) onLeave();
      }}>Manage subscription in Settings</button>
    </div>,
    document.body,
  );
}

function renderEditor(onLeave: () => void) {
  return render(<div style={{ transform: "scale(0.73)", overflow: "hidden" }}>
    <ModalProvider><Editor onLeave={onLeave} /></ModalProvider>
  </div>);
}

test("leave confirmation mounts above the paywall outside the scaled editor and confirms navigation", async () => {
  const onLeave = jest.fn();
  const { container } = renderEditor(onLeave);
  fireEvent.click(screen.getByText("Manage subscription in Settings"));
  const dialog = await screen.findByRole("dialog", { name: "Leave App Builder" });
  const root = dialog.parentElement!;
  const paywall = screen.getByTestId("paywall");
  expect(root.parentElement).toBe(document.body);
  expect(container.contains(dialog)).toBe(false);
  expect(Number(root.style.zIndex)).toBeGreaterThan(Number(paywall.style.zIndex));
  expect(root.style.pointerEvents).toBe("auto");
  expect(paywall.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  expect(document.body.contains(root)).toBe(false);
});

test("cancel keeps the editor open and allows the confirmation to open again", async () => {
  const onLeave = jest.fn();
  renderEditor(onLeave);
  fireEvent.click(screen.getByText("Manage subscription in Settings"));
  await screen.findByRole("dialog", { name: "Leave App Builder" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onLeave).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("Manage subscription in Settings"));
  await screen.findByRole("dialog", { name: "Leave App Builder" });
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
});
