// components/support/ChatWidgetProvider.tsx
"use client";

import { MessagesSquare, SquareX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/src/hooks/useAuth";

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
    status?: "open" | "pending" | "closed";
    messages: ChatMessage[];
};

const STORAGE_KEY = "kloner_support_chat_id";
const CONNECTING_TEXT = "__CONNECTING__";

function sanitizeUserFacingError(message: unknown): string {
    const raw = typeof message === "string" ? message : "";
    const lower = raw.toLowerCase();

    // Allowlist: these are already written as user-facing copy.
    const allowlist = [
        "sign in required",
        "missing message text",
        "chat not found",
        "failed to send message",
        "failed to load chat",
        "this conversation has been closed",
        "please start a new chat",
    ];
    if (allowlist.some((s) => lower.includes(s))) return raw;

    // Provider/internal errors we never want to show verbatim.
    if (
        lower.includes("googlegenerativeai") ||
        lower.includes("candidate was blocked") ||
        lower.includes("recitation") ||
        lower.includes("stack") ||
        lower.includes("internal server error")
    ) {
        return "That request couldn’t be completed. Try rephrasing, or contact support.";
    }

    // Default: avoid leaking raw server/provider details.
    return "Something went wrong. Please try again.";
}

function ConnectingDots() {
    return (
        <div className="flex items-center gap-1.5">
            <span className="sr-only">Connecting</span>
            <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[klDot_1.1s_ease-in-out_infinite]" />
            <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[klDot_1.1s_ease-in-out_0.18s_infinite]" />
            <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[klDot_1.1s_ease-in-out_0.36s_infinite]" />
        </div>
    );
}

export default function ChatWidgetProvider() {
    const { user, loading: authLoading } = useAuth();
    const [open, setOpen] = useState(false);
    const [chatId, setChatId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [mode, setMode] = useState<ChatMode>("ai");
    const [status, setStatus] = useState<"open" | "pending" | "closed">("open");
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [escalating, setEscalating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [chatClosed, setChatClosed] = useState(false);
    const bottomRef = useRef<HTMLDivElement | null>(null);

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
                if (typeof window !== "undefined") {
                    window.localStorage.removeItem(STORAGE_KEY);
                }
                setChatId(null);
                setMessages([]);
                setMode("ai");
                setStatus("open");
                setChatClosed(false);
                return;
            }

            if (!res.ok) return;

            const data: ApiSendResponse = await res.json();
            setMessages(data.messages || []);
            setMode(data.mode);
            setStatus(data.status || "open");
            setChatId(data.chatId);
            setChatClosed((data.status || "open") === "closed");
        } catch {
            // ignore
        }
    }

    useEffect(() => {
        if (!open || !chatId || status === "closed") return;

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
                    setStatus("open");
                    setChatClosed(false);
                    return;
                }

                if (!res.ok) return;

                const data: ApiSendResponse = await res.json();

                setMessages((prev) => {
                    // Never "shrink" during polling if the server temporarily returns fewer rows.
                    const incoming = data.messages || [];
                    if (incoming.length >= prev.length) return incoming;
                    // If it shrunk, keep prev and append any truly new messages by id.
                    const seen = new Set(prev.map((m) => m.id));
                    const extras = incoming.filter((m) => !seen.has(m.id));
                    return extras.length ? [...prev, ...extras] : prev;
                });

                setMode(data.mode);
                setStatus(data.status || "open");
                setChatId(data.chatId);
                setChatClosed((data.status || "open") === "closed");
            } catch {
                // ignore
            } finally {
                if (!cancelled) timeoutId = setTimeout(tick, 2500);
            }
        };

        tick();

        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [open, chatId, status]);

    function pushClosedSystemMessage() {
        const sys: ChatMessage = {
            id: `sys-closed-${Date.now()}`,
            sender: "system",
            text:
                "This conversation has been closed. To start a new chat, click “Leave chat” above and then open Chat with us again.",
            createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, sys]);
    }

    async function handleSend() {
        const text = input.trim();
        if (!text || loading) return;

        setError(null);

        if (chatClosed) {
            setInput("");
            pushClosedSystemMessage();
            return;
        }

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
                body: JSON.stringify({ chatId, text }),
            });

            if (res.status === 409) {
                const body = await res.json().catch(() => ({} as any));
                setChatClosed(true);
                setStatus("closed");

                setMessages((prev) => {
                    const withoutTemp = prev.filter((m) => m.id !== tempId);
                    const sys: ChatMessage = {
                        id: `sys-closed-${Date.now()}`,
                        sender: "system",
                        text:
                            body?.error ||
                            "This conversation has been closed. To start a new chat, click “Leave chat” above and then open Chat with us again.",
                        createdAt: new Date().toISOString(),
                    };
                    return [...withoutTemp, sys];
                });
                return;
            }

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body?.error || "Failed to send message");
            }

            const data: ApiSendResponse = await res.json();

            setChatId(data.chatId);
            setMode(data.mode);
            setStatus(data.status || "open");
            setChatClosed((data.status || "open") === "closed");
            setMessages(data.messages || []);

            if (typeof window !== "undefined") {
                window.localStorage.setItem(STORAGE_KEY, data.chatId);
            }
        } catch (err: any) {
            setError(sanitizeUserFacingError(err?.message));
        } finally {
            setLoading(false);
        }
    }

    async function handleEscalate() {
        if (!user || authLoading) {
            setError("Sign in required to talk to a human");
            return;
        }

        if (!chatId || mode === "agent" || escalating || chatClosed) return;

        setEscalating(true);
        setError(null);

        try {
            const token = await user.getIdToken().catch(() => null);
            const res = await fetch("/api/support/escalate", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ chatId }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body?.error || "Failed to escalate");
            }

            const data: { ok: boolean; mode: ChatMode; status?: "pending" | "open" | "closed" } =
                await res.json();

            setMode(data.mode);
            setStatus(data.status || "pending");
        } catch (err: any) {
            setError(sanitizeUserFacingError(err?.message) || "Failed to escalate");
        } finally {
            setEscalating(false);
        }
    }

    async function handleLeaveChat() {
        if (!chatId) {
            setMessages([]);
            setMode("ai");
            setStatus("open");
            setChatClosed(false);
            if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
            return;
        }

        try {
            await fetch("/api/support/close", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chatId, by: "user" }),
            });
        } catch {
            // ignore
        }

        setMessages([]);
        setMode("ai");
        setStatus("open");
        setChatId(null);
        setChatClosed(false);
        if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
    }

    const isConnectingToHuman = mode === "agent" && status === "pending";
    const canRequestHuman = !!user && !authLoading;

    return (
        <>
            <style jsx global>{`
                @keyframes klDot {
                    0% {
                        opacity: 0.25;
                        transform: translateY(0);
                    }
                    50% {
                        opacity: 1;
                        transform: translateY(-2px);
                    }
                    100% {
                        opacity: 0.25;
                        transform: translateY(0);
                    }
                }
            `}</style>

            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-label={open ? "Close chat" : "Open chat"}
                aria-expanded={open}
                className="fixed bottom-6 right-6 z-[2147483647] rounded-full bg-accent text-white px-4 py-2 text-sm shadow-lg hover:brightness-80 focus:outline-none"
            >
                {open ? <SquareX aria-hidden="true" focusable="false" /> : <MessagesSquare aria-hidden="true" focusable="false" />}
            </button>


            {open && (
                <div className="fixed bottom-16 right-6 z-[2147483647] w-[320px] max-w-[90vw] rounded-2xl border border-neutral-200 bg-white shadow-xl flex flex-col overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                Support
                            </div>
                            <div className="text-sm font-medium text-neutral-900">
                                {mode === "ai" ? "AI assistant" : "Live agent"}
                                {chatClosed ? " · Closed" : isConnectingToHuman ? " · Connecting" : ""}
                            </div>
                        </div>

                        {chatId && (
                            <button
                                type="button"
                                onClick={handleLeaveChat}
                                className="text-[11px] font-medium text-neutral-400 hover:text-neutral-600"
                            >
                                Leave chat
                            </button>
                        )}

                        {mode === "ai" && !chatClosed && canRequestHuman && (
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

                        {messages.map((m) => {
                            const isUser = m.sender === "user";
                            const isSystem = m.sender === "system";
                            const isConnecting = isSystem && m.text === CONNECTING_TEXT;

                            return (
                                <div
                                    key={m.id}
                                    className={isUser ? "flex justify-end" : "flex justify-start"}
                                >
                                    <div
                                        className={`max-w-[80%] rounded-2xl px-3 py-2 ${isUser
                                            ? "bg-accent text-white"
                                            : isSystem
                                                ? "bg-neutral-100 text-neutral-700 text-xs"
                                                : "bg-neutral-100 text-neutral-900"
                                            }`}
                                    >
                                        {isConnecting ? (
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] text-neutral-600">
                                                    Connecting to a human
                                                </span>
                                                <ConnectingDots />
                                            </div>
                                        ) : (
                                            <p className="whitespace-pre-wrap break-words">{m.text}</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

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
                            className="flex-1 placeholder:text-[16px] md:placeholder:text-[11px] text-[16px] md:text-sm border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-neutral-400"
                            placeholder={
                                chatClosed
                                    ? "Chat closed. Click Leave chat to start a new one."
                                    : mode === "ai"
                                        ? "Ask anything about Kloner"
                                        : isConnectingToHuman
                                            ? "You can keep typing while we connect you"
                                            : "Write to the team"
                            }
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={loading || chatClosed}
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
