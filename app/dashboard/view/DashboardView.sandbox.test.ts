import fs from "node:fs";
import path from "node:path";

describe("DashboardView preview iframe sandbox", () => {
  it("includes allow-scripts and allow-same-origin", () => {
    const filePath = path.join(process.cwd(), "app/dashboard/view/DashboardView.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain('sandbox="allow-same-origin allow-scripts"');
  });

  it("prefers src URL mode and falls back to srcDoc", () => {
    const filePath = path.join(process.cwd(), "app/dashboard/view/DashboardView.tsx");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).toContain("src={previewFrameSrc || undefined}");
    expect(source).toContain("srcDoc={previewFrameSrc ? undefined : srcDoc}");
  });
});
