"use client";

import { useState, useRef, useEffect } from "react";
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

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

const ACCENT = "#f55f2a";

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
  const [activeTab, setActiveTab] = useState<"chat" | "code">("chat");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hello! I'm your AI assistant for building web applications. I can help you create interactive features, add authentication, integrate databases, and much more. What would you like to build?",
      timestamp: new Date(),
    },
    {
      id: "2",
      role: "assistant",
      content: "Here are some suggestions to get started:\n\n• Add a user login system\n• Create a contact form with email notifications\n• Build a dashboard with data visualization\n• Add a shopping cart and payment processing\n• Implement real-time chat features\n\nJust tell me what you have in mind!",
      timestamp: new Date(),
    },
  ]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!currentMessage.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: currentMessage,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setCurrentMessage("");
    setIsTyping(true);

    // Simulate AI response (replace with actual AI integration later)
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "That's a great idea! I'm ready to help you implement that feature. For now, this is a placeholder response. The actual AI integration will be connected soon to provide real assistance with your web app development.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiResponse]);
      setIsTyping(false);
    }, 2000);
  };

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
    <div className="fixed inset-0 z-[16000] bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 bg-white">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-neutral-900">App Builder</h1>
          <div className="flex rounded-lg border border-neutral-200 p-1">
            <button
              onClick={() => setActiveTab("chat")}
              className={`px-3 py-1 text-sm font-medium rounded-md transition ${
                activeTab === "chat"
                  ? `bg-[${ACCENT}] text-white`
                  : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              AI Chat
            </button>
            <button
              onClick={() => setActiveTab("code")}
              className={`px-3 py-1 text-sm font-medium rounded-md transition ${
                activeTab === "code"
                  ? `bg-[${ACCENT}] text-white`
                  : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              Code Editor
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void onClose()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200 transition"
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

      {/* Content */}
      <div className="flex h-[calc(100vh-73px)]">
        {activeTab === "chat" ? (
          <div className="flex-1 flex flex-col">
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                      message.role === "user"
                        ? `bg-[${ACCENT}] text-white`
                        : "bg-neutral-100 text-neutral-900"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    <p className={`text-xs mt-2 ${
                      message.role === "user" ? "text-white/70" : "text-neutral-500"
                    }`}>
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-neutral-100 rounded-2xl px-4 py-3">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                      <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <div className="border-t border-neutral-200 p-6">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={currentMessage}
                  onChange={(e) => setCurrentMessage(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                  placeholder="Describe what you want to build..."
                  className="flex-1 rounded-full border border-neutral-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!currentMessage.trim() || isTyping}
                  className={`rounded-full px-6 py-3 text-sm font-medium text-white transition ${
                    !currentMessage.trim() || isTyping
                      ? "bg-neutral-300 cursor-not-allowed"
                      : `bg-[${ACCENT}] hover:bg-opacity-90`
                  }`}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Code Editor Placeholder */}
            <div className="flex-1 flex items-center justify-center bg-neutral-50">
              <div className="text-center">
                <div className="text-6xl mb-4">⚡</div>
                <h3 className="text-xl font-semibold text-neutral-900 mb-2">Code Editor Coming Soon</h3>
                <p className="text-neutral-600 max-w-md">
                  The interactive code editor will allow you to directly edit your app&apos;s files,
                  see live previews, and deploy changes instantly.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Sidebar with Create Options */}
        <div className="w-80 border-l border-neutral-200 bg-neutral-50 p-6">
          <h2 className="text-lg font-semibold text-neutral-900 mb-4">Create New App</h2>

          <div className="space-y-4">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMode("clone")}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  mode === "clone"
                    ? `border-[${ACCENT}] bg-[${ACCENT}]/5`
                    : "border-neutral-200 bg-white hover:bg-neutral-50 hover:border-neutral-300"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    mode === "clone" ? `bg-[${ACCENT}]/10` : "bg-neutral-100"
                  }`}>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className={`h-5 w-5 ${
                        mode === "clone" ? `text-[${ACCENT}]` : "text-neutral-600"
                      }`}
                    >
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-neutral-900">
                        Clone Selected Website
                      </div>
                    </div>
                    {sourceUrl && (
                      <div className="text-xs text-neutral-600 bg-neutral-50 px-2 py-1 rounded border truncate">
                        <span className="font-medium">Source:</span> {sourceUrl}
                      </div>
                    )}
                    <div className="text-xs text-neutral-600">
                      Convert the current website into a dynamic web application.
                    </div>
                  </div>
                  {mode === "clone" && (
                    <div className={`flex items-center text-[${ACCENT}]`}>
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
              </button>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMode("prompt")}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    mode === "prompt"
                      ? `border-[${ACCENT}] bg-[${ACCENT}]/5`
                      : "border-neutral-200 bg-white hover:bg-neutral-50 hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      mode === "prompt" ? `bg-[${ACCENT}]/10` : "bg-neutral-100"
                    }`}>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className={`h-5 w-5 ${
                          mode === "prompt" ? `text-[${ACCENT}]` : "text-neutral-600"
                        }`}
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14,2 14,8 20,8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10,9 9,9 8,9"/>
                      </svg>
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="text-sm font-semibold text-neutral-900">
                        Create from Prompt
                      </div>
                      <div className="text-xs text-neutral-600">
                        Describe your app and we&apos;ll build it from scratch.
                      </div>
                      {mode === "prompt" && (
                        <textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          rows={3}
                          className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Describe the app you want to build..."
                        />
                      )}
                    </div>
                    {mode === "prompt" && (
                      <div className={`flex items-center text-[${ACCENT}]`}>
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy || (mode === "prompt" && !prompt.trim())}
              className={`w-full rounded-xl px-4 py-3 text-sm font-medium text-white transition ${
                busy || (mode === "prompt" && !prompt.trim())
                  ? "bg-neutral-300 cursor-not-allowed"
                  : `bg-[${ACCENT}] hover:bg-opacity-90`
              }`}
            >
              {busy ? "Creating..." : "Create App"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
