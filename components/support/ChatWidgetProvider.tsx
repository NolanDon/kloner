// components/support/ChatWidgetProvider.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = {
    id: string;
    sender: "user" | "ai" | "agent" | "system";
    text: string;
    createdAt: string;
};

type ChatMode = "ai" | "agent";

type ApiSendResponse = {
    ok: boolean;
    chatId: string;
    mode: ChatMode;
    messages: ChatMessage[];
};

const STORAGE_KEY = "kloner_support_chat_id";

export default function ChatWidgetProvider() {
    const [open, setOpen] = useState(false);
    const [chatId, setChatId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [mode, setMode] = useState<ChatMode>("ai");
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [escalating, setEscalating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    // Restore chatId from localStorage
    useEffect(() => {
        if (typeof window === "undefined") return;
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
            setChatId(saved);
            void fetchExisting(saved);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!bottomRef.current) return;
        bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages, open]);

    async function fetchExisting(existingChatId: string) {
        try {
            const res = await fetch("/api/support/chat?chatId=" + existingChatId, {
                method: "GET",
            });

            if (res.status === 404) {
                console.warn(
                    "[support] chat not found, clearing stored chatId",
                    existingChatId,
                );
                if (typeof window !== "undefined") {
                    window.localStorage.removeItem(STORAGE_KEY);
                }
                setChatId(null);
                setMessages([]);
                setMode("ai");
                return;
            }

            if (!res.ok) {
                console.warn(
                    "[support] failed to fetch existing chat",
                    existingChatId,
                    res.status,
                );
                return;
            }

            const data: ApiSendResponse = await res.json();
            setMessages(data.messages);
            setMode(data.mode);
            setChatId(data.chatId);
        } catch (err) {
            console.warn("[support] fetchExisting threw", err);
        }
    }

    // Poll for new messages while in agent mode so the user sees agent replies
    useEffect(() => {
        if (!chatId || mode !== "agent") return;

        let cancelled = false;
        let timeoutId: NodeJS.Timeout | null = null;

        const tick = async () => {
            if (cancelled) return;
            try {
                const res = await fetch(
                    "/api/support/chat?chatId=" + encodeURIComponent(chatId),
                    { method: "GET" },
                );

                if (res.status === 404) {
                    if (typeof window !== "undefined") {
                        window.localStorage.removeItem(STORAGE_KEY);
                    }
                    setChatId(null);
                    setMessages([]);
                    setMode("ai");
                    return;
                }

                if (!res.ok) return;

                const data: ApiSendResponse = await res.json();
                setMessages(data.messages);
                setMode(data.mode);
                setChatId(data.chatId);
            } catch {
                // ignore transient errors
            } finally {
                if (!cancelled) {
                    timeoutId = setTimeout(tick, 4000);
                }
            }
        };

        tick();

        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [chatId, mode]);

    async function handleSend() {
        const text = input.trim();
        if (!text || loading) return;

        setError(null);
        setLoading(true);

        const tempId = `local-${Date.now()}`;
        const optimistic: ChatMessage = {
            id: tempId,
            sender: "user",
            text,
            createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimistic]);
        setInput("");

        try {
            const res = await fetch("/api/support/chat", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    chatId,
                    text,
                }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body?.error || "Failed to send message");
            }

            const data: ApiSendResponse = await res.json();
            setChatId(data.chatId);
            setMessages(data.messages);
            setMode(data.mode);

            if (typeof window !== "undefined") {
                window.localStorage.setItem(STORAGE_KEY, data.chatId);
            }
        } catch (err: any) {
            setError(err.message || "Something went wrong");
        } finally {
            setLoading(false);
        }
    }

    async function handleEscalate() {
        if (!chatId || mode === "agent" || escalating) return;
        setEscalating(true);
        setError(null);

        try {
            const res = await fetch("/api/support/escalate", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chatId }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body?.error || "Failed to escalate");
            }

            const data: { ok: boolean; mode: ChatMode } = await res.json();
            setMode(data.mode);

            setMessages((prev) => [
                ...prev,
                {
                    id: `sys-${Date.now()}`,
                    sender: "system",
                    text:
                        "You will be connected to a human. You can keep typing while we notify someone on the team.",
                    createdAt: new Date().toISOString(),
                },
            ]);
        } catch (err: any) {
            setError(err.message || "Failed to escalate");
        } finally {
            setEscalating(false);
        }
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="fixed bottom-6 right-6 z-50 rounded-full bg-accent text-white px-4 py-2 text-sm shadow-lg hover:brightness-80 focus:outline-none"
            >
                {open ? "Close chat" : "Chat with us"}
            </button>

            {open && (
                <div className="fixed bottom-16 right-6 z-50 w-[320px] max-w-[90vw] rounded-2xl border border-neutral-200 bg-white shadow-xl flex flex-col overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                Support
                            </div>
                            <div className="text-sm font-medium text-neutral-900">
                                {mode === "ai" ? "AI assistant" : "Live agent"}
                            </div>
                        </div>
                        {mode === "ai" && (
                            <button
                                type="button"
                                onClick={handleEscalate}
                                disabled={!chatId || escalating}
                                className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-60"
                            >
                                Talk to human
                            </button>
                        )}
                    </div>

                    <div className="flex-1 min-h-[180px] max-h-[340px] overflow-y-auto px-3 py-2 space-y-2 text-sm">
                        {messages.length === 0 && (
                            <div className="text-xs text-neutral-500 mt-2">
                                Ask anything about cloning, editing, or deploying a site. An AI
                                assistant will answer first and you can switch to a human if you
                                need.
                            </div>
                        )}

                        {messages.map((m) => (
                            <div
                                key={m.id}
                                className={
                                    m.sender === "user"
                                        ? "flex justify-end"
                                        : "flex justify-start"
                                }
                            >
                                <div
                                    className={`max-w-[80%] rounded-2xl px-3 py-2 ${m.sender === "user"
                                            ? "bg-accent text-white"
                                            : m.sender === "system"
                                                ? "bg-neutral-100 text-neutral-700 text-xs"
                                                : "bg-neutral-100 text-neutral-900"
                                        }`}
                                >
                                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                                </div>
                            </div>
                        ))}

                        {loading && (
                            <div className="flex justify-start">
                                <div className="max-w-[80%] rounded-2xl px-3 py-2 bg-neutral-100 text-neutral-700 text-xs">
                                    Typing…
                                </div>
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>

                    {error && (
                        <div className="px-3 py-1 text-[11px] text-red-600 border-t border-neutral-200">
                            {error}
                        </div>
                    )}

                    <form
                        className="flex items-center gap-2 px-3 py-2 border-t border-neutral-200"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void handleSend();
                        }}
                    >
                        <input
                            className="flex-1 text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-400"
                            placeholder={
                                mode === "ai"
                                    ? "Ask anything about Kloner"
                                    : "Write to the team"
                            }
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={loading}
                        />
                        <button
                            type="submit"
                            disabled={loading || !input.trim()}
                            className="text-sm font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                        >
                            Send
                        </button>
                    </form>
                </div>
            )}
        </>
    );
}
