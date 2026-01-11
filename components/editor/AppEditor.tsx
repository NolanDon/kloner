"use client";

import { useState } from "react";
import type { User } from "firebase/auth";
import type { UserTier } from "@/src/lib/credits";

type Props = {
  firebaseUser?: User | null;
  userTier?: UserTier;
  startProCheckout?: () => Promise<void>;
  initialHtml: string;
  sourceImage?: string;
  onClose: () => Promise<void> | void;
  onExport: (html: string, name?: string, skipBuildFinalExport?: boolean) => Promise<void>;
  draftId?: string;
};

function buildPlaceholderHtml(type: "clone" | "prompt", prompt?: string): string {
  const title = type === "clone" ? "Cloned Website App" : `App from Prompt: ${prompt?.slice(0, 50) || "New App"}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #333; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <p>This is a placeholder for the app builder. Coming soon!</p>
    ${type === "prompt" ? `<p><strong>Prompt:</strong> ${prompt || "No prompt provided"}</p>` : ""}
  </div>
</body>
</html>`;
}

export default function AppEditor({
  firebaseUser,
  userTier,
  startProCheckout,
  initialHtml,
  onClose,
  onExport,
}: Props): JSX.Element {
  const [mode, setMode] = useState<"clone" | "prompt">("clone");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    setBusy(true);
    try {
      const html = buildPlaceholderHtml(mode, mode === "prompt" ? prompt : undefined);
      await onExport(html, mode === "clone" ? "Cloned App" : "New App", false);
    } catch (error) {
      console.error("Failed to create app:", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[16000]">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => void onClose()} />

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">App Builder</p>
              <p className="text-sm font-semibold text-neutral-900">Turn Websites into Apps</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onClose()}
                className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
              >
                Close
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div>
              <p className="text-sm font-medium text-neutral-700 mb-3">Choose how to create your app:</p>
              
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 border border-neutral-200 rounded-lg cursor-pointer hover:bg-neutral-50">
                  <input
                    type="radio"
                    name="mode"
                    value="clone"
                    checked={mode === "clone"}
                    onChange={() => setMode("clone")}
                    className="text-orange-500"
                  />
                  <div>
                    <p className="font-medium text-neutral-900">Clone Selected Website</p>
                    <p className="text-sm text-neutral-600">Convert the current website into a dynamic app</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border border-neutral-200 rounded-lg cursor-pointer hover:bg-neutral-50">
                  <input
                    type="radio"
                    name="mode"
                    value="prompt"
                    checked={mode === "prompt"}
                    onChange={() => setMode("prompt")}
                    className="text-orange-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-neutral-900">Create from Prompt</p>
                    <p className="text-sm text-neutral-600">Describe your app and we&apos;ll build it from scratch</p>
                    {mode === "prompt" && (
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={3}
                        className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-orange-200"
                        placeholder="Describe the app you want to build..."
                      />
                    )}
                  </div>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => void onClose()}
                className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={busy || (mode === "prompt" && !prompt.trim())}
                className="px-4 py-2 text-sm font-medium text-white bg-[#f55f2a] rounded-lg hover:bg-[#ff8a4c] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? "Creating..." : "Create App"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
