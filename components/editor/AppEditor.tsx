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
  sourceUrl?: string;
  onClose: () => Promise<void> | void;
  onCreateApp?: (mode: "clone" | "prompt", prompt?: string, renderId?: string) => Promise<void>;
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
  sourceUrl,
  onClose,
  onCreateApp,
  draftId,
}: Props): JSX.Element {
  const [mode, setMode] = useState<"clone" | "prompt">("clone");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    if (!onCreateApp) return;
    
    setBusy(true);
    try {
      await onCreateApp(mode, mode === "prompt" ? prompt : undefined, mode === "clone" ? draftId : undefined);
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
          <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-neutral-900">
                Create New App
              </div>
              <div className="text-xs text-neutral-600">
                Choose how to create your web application.
              </div>
            </div>

            <button
              type="button"
              onClick={() => void onClose()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200"
              title="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4 text-neutral-700"
              >
                <path
                  fillRule="evenodd"
                  d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          <div className={`flex items-stretch ${mode === "prompt" ? "flex-col" : ""}`}>
            {/* Left side - Preview/Info */}
            {mode === "clone" && (
              <div className="flex-1 border-r border-neutral-200 p-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-900 mb-2">What you&apos;ll get</h3>
                    <ul className="space-y-2 text-xs text-neutral-600">
                      <li className="flex items-start gap-2">
                        <svg className="h-4 w-4 text-[#f55f2a] mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>Live code editor with file tree</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <svg className="h-4 w-4 text-[#f55f2a] mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>Real-time preview with hot reload</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <svg className="h-4 w-4 text-[#f55f2a] mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>Full Next.js application structure</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <svg className="h-4 w-4 text-[#f55f2a] mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>Deploy to Vercel when ready</span>
                      </li>
                    </ul>
                  </div>
                  {sourceUrl && mode === "clone" && (
                    <div className="rounded-lg bg-neutral-50 p-3 border border-neutral-200">
                      <p className="text-xs text-neutral-600 mb-1 font-medium">Source Website:</p>
                      <p className="text-xs text-neutral-900 font-mono break-all">{sourceUrl}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Right side - Options */}
            <div className={`p-6 space-y-3 ${mode === "clone" ? "w-80" : "flex-1"}`}>
              <button
                type="button"
                onClick={() => setMode("clone")}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  mode === "clone"
                    ? "border-[#f55f2a] bg-[#f55f2a]/5 ring-2 ring-[#f55f2a]/20"
                    : "border-neutral-200 bg-white hover:border-neutral-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                    mode === "clone" ? "bg-[#f55f2a]/10" : "bg-neutral-100"
                  }`}>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className={`h-5 w-5 ${mode === "clone" ? "text-[#f55f2a]" : "text-neutral-600"}`}
                    >
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-neutral-900">
                      Start from this website
                    </div>
                    {sourceUrl && (
                      <div className="text-xs text-neutral-500 truncate mt-0.5">
                        {sourceUrl}
                      </div>
                    )}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode("prompt")}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  mode === "prompt"
                    ? "border-[#f55f2a] bg-[#f55f2a]/5 ring-2 ring-[#f55f2a]/20"
                    : "border-neutral-200 bg-white hover:border-neutral-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                    mode === "prompt" ? "bg-[#f55f2a]/10" : "bg-neutral-100"
                  }`}>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className={`h-5 w-5 ${mode === "prompt" ? "text-[#f55f2a]" : "text-neutral-600"}`}
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14,2 14,8 20,8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                      <polyline points="10,9 9,9 8,9"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-neutral-900">
                      From prompt
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      Describe what you want
                    </div>
                  </div>
                </div>
              </button>

              {mode === "prompt" && (
                <div className="pt-2">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={6}
                    autoFocus
                    className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-[#f55f2a]/20 resize-none"
                    placeholder="Describe the app you want to build... e.g., 'A todo list app with categories and due dates'"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-neutral-200 px-5 py-4">
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
  );
}
