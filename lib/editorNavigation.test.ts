/** @jest-environment jsdom */
import { shouldBypassEditorNavigationGuard } from "./editorNavigation";

test("ZIP download clicks reach the browser without a leave confirmation", () => {
    const link = document.createElement("a");
    link.href = "blob:http://localhost/project";
    link.download = "project.zip";
    expect(shouldBypassEditorNavigationGuard(link)).toBe(true);
    link.setAttribute("download", "");
    expect(shouldBypassEditorNavigationGuard(link)).toBe(true);
});

test("regular navigation still requires the editor guard", () => {
    const link = document.createElement("a");
    link.href = "/dashboard";
    expect(shouldBypassEditorNavigationGuard(link)).toBe(false);
    link.target = "_self";
    expect(shouldBypassEditorNavigationGuard(link)).toBe(false);
    link.target = "_blank";
    expect(shouldBypassEditorNavigationGuard(link)).toBe(true);
    link.target = "_self";
    link.dataset.klonerNavigationBypass = "true";
    expect(shouldBypassEditorNavigationGuard(link)).toBe(true);
});
