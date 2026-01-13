"use client";

import { useState, useCallback } from "react";
import type { User } from "firebase/auth";
import type { UserTier } from "@/src/lib/credits";
import AIAgentChat from "../AIAgentChat";

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
  const [currentHtml, setCurrentHtml] = useState(initialHtml);
  const [isCreating, setIsCreating] = useState(false);

  // Generate a temporary app ID for the AI chat
  const appId = draftId || `temp_${Date.now()}`;

  // Prepare files object for AIAgentChat
  const files = {
    "index.html": {
      content: currentHtml,
      lastModified: Date.now(),
    },
  };

  const handleFileEdit = useCallback((path: string, content: string) => {
    if (path === "index.html") {
      setCurrentHtml(content);
    }
  }, []);

  const handleServerRefresh = useCallback(async () => {
    // When the AI makes changes, we could auto-create the app
    // For now, just update the preview
    console.log("Server refresh triggered");
  }, []);

  const handleCreateApp = async () => {
    if (!onCreateApp) return;

    setIsCreating(true);
    try {
      // Use the current HTML content to create the app
      await onCreateApp("clone", undefined, draftId);
    } catch (error) {
      console.error("Failed to create app:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[16000] bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
        <div className="space-y-1">
          <div className="text-lg font-semibold text-neutral-900">
            AI App Builder
          </div>
          <div className="text-sm text-neutral-600">
            Chat with AI to build your web application
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCreateApp}
            disabled={isCreating}
            className="px-4 py-2 text-sm font-medium text-white bg-[#f55f2a] rounded-lg hover:bg-[#ff8a4c] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? "Creating..." : "Create App"}
          </button>
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
      </div>

      {/* AI Chat Interface */}
      <div className="h-[calc(100vh-80px)]">
        <AIAgentChat
          appId={appId}
          files={files}
          onFileEdit={handleFileEdit}
          onServerRefresh={handleServerRefresh}
        />
      </div>
    </div>
  );
}
