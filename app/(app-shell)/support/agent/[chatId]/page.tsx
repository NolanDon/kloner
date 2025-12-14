// app/support/agent/[chatId]/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    addDoc,
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    Timestamp,
    where,
    deleteDoc,
    getDocs,
} from "firebase/firestore";
import { onAuthStateChanged, getIdTokenResult } from "firebase/auth";
import { db, auth } from "@/lib/firebase";

async function markAgentConnected(chatId: string, assignedTo: string | null) {
    if (!chatId) return;

    const chatRef = doc(db, "support_chats", chatId);
    const msgsRef = collection(chatRef, "messages");

    // 1) remove any lingering CONNECTING system message
    const q = query(
        msgsRef,
        where("sender", "==", "system"),
        where("text", "==", "__CONNECTING__")
    );

    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));

    // 2) flip chat state
    await updateDoc(chatRef, {
        status: "open",
        mode: "agent",
        updatedAt: serverTimestamp(),
        agentConnectedAt: serverTimestamp(),
        assignedTo: assignedTo || null,
        inactivityPromptAt: null,
        pendingAutoCloseAt: null,
    } as any);
}


type Sender = "user" | "ai" | "agent" | "system";

type Message = {
    id: string;
    sender: Sender;
    text: string;
    createdAt: Date | null;
};

type ChatMeta = {
    id: string;
    userId: string | null;
    status: "open" | "waiting_agent" | "assigned" | "closed";
    assignedTo: string | null;
    assignedToEmail: string | null;
    lastMessageFrom: Sender | null;
    updatedAt: Date | null;
    userTyping: boolean;
};

type AgentSession = {
    uid: string;
    email: string | null;
    isSupportAgent: boolean;
};

export default function AgentChatPage() {

    const params = useParams();
    const router = useRouter();
    const chatId = params?.chatId as string | undefined;

    useEffect(() => {
        if (!chatId) return;
        const ref = doc(db, "support_inbox", chatId);
        // fire-and-forget; ignore errors
        updateDoc(ref, { unreadCount: 0 }).catch(() => { });
    }, [chatId]);

    const [agent, setAgent] = useState<AgentSession | null>(null);
    const [loadingAuth, setLoadingAuth] = useState(true);

    const [meta, setMeta] = useState<ChatMeta | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loadingChat, setLoadingChat] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [assigning, setAssigning] = useState(false);

    const bottomRef = useRef<HTMLDivElement | null>(null);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Auth + claim
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                setAgent(null);
                setLoadingAuth(false);
                setError("Not authenticated");
                return;
            }

            try {
                const tokenResult = await getIdTokenResult(user, true);
                const isSupportAgent = !!tokenResult.claims.supportAgent;

                if (!isSupportAgent) {
                    setAgent(null);
                    setLoadingAuth(false);
                    setError("You do not have supportAgent access.");
                    return;
                }

                setAgent({
                    uid: user.uid,
                    email: user.email,
                    isSupportAgent,
                });
                setLoadingAuth(false);
                setError(null);
            } catch (err) {
                console.error("Failed to read auth claims", err);
                setError("Failed to read auth claims");
                setLoadingAuth(false);
            }
        });

        return () => unsub();
    }, []);

    // Scroll to bottom on new messages
    useEffect(() => {
        if (!bottomRef.current) return;
        bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages.length]);

    // Subscribe to chat meta + messages
    useEffect(() => {
        if (!agent || !agent.isSupportAgent) return;
        if (!chatId) return;

        const chatRef = doc(db, "support_chats", chatId);
        const msgsRef = collection(chatRef, "messages");

        const unsubMeta = onSnapshot(
            chatRef,
            (snap) => {
                if (!snap.exists()) {
                    setError("Chat not found");
                    setLoadingChat(false);
                    return;
                }
                const data = snap.data() as any;
                const ts: Timestamp | null = data.updatedAt || null;

                setMeta({
                    id: snap.id,
                    userId: data.userId || null,
                    status:
                        (data.status as ChatMeta["status"]) || "open",
                    assignedTo: data.assignedTo || null,
                    assignedToEmail: data.assignedToEmail || null,
                    lastMessageFrom:
                        (data.lastMessageFrom as Sender | null) || null,
                    updatedAt: ts ? ts.toDate() : null,
                    userTyping: !!data.userTyping,
                });
                setLoadingChat(false);

                // Clear unreadForAgent when agent opens the chat
                setDoc(
                    doc(db, "support_inbox", snap.id),
                    {
                        unreadForAgent: 0,
                    },
                    { merge: true }
                ).catch((err) =>
                    console.warn("Failed to clear unreadForAgent", err)
                );
            },
            (err) => {
                console.error("support/agent chat meta onSnapshot failed", err);
                setError("Failed to load chat meta");
                setLoadingChat(false);
            }
        );

        const q = query(msgsRef, orderBy("createdAt", "asc"));
        const unsubMsgs = onSnapshot(
            q,
            (snap) => {
                const list: Message[] = snap.docs.map((d) => {
                    const data = d.data() as any;
                    const ts: Timestamp | null = data.createdAt || null;
                    return {
                        id: d.id,
                        sender: data.sender as Sender,
                        text: data.text || "",
                        createdAt: ts ? ts.toDate() : null,
                    };
                });
                setMessages(list);
            },
            (err) => {
                console.error("support/agent chat messages onSnapshot failed", err);
                setError("Failed to load messages");
            }
        );

        return () => {
            unsubMeta();
            unsubMsgs();
        };
    }, [agent, chatId]);

    async function handleAssignToMe() {
        if (!agent || !chatId) return;
        setAssigning(true);

        try {
            const chatRef = doc(db, "support_chats", chatId);

            // 1) mark connected FIRST (kills pending autoclose + flips status to open)
            await markAgentConnected(chatId, agent.uid);

            // 2) keep your assignment fields (agent console can still show "assigned" if you want)
            await updateDoc(chatRef, {
                assignedTo: agent.uid,
                assignedToEmail: agent.email || null,
                updatedAt: serverTimestamp(),
            });

            await setDoc(
                doc(db, "support_inbox", chatId),
                {
                    assignedTo: agent.uid,
                    assignedToEmail: agent.email || null,
                    status: "open",
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );
        } catch (err) {
            console.error("Assign to me failed", err);
        } finally {
            setAssigning(false);
        }
    }

    const handleSend = async (e?: React.FormEvent<HTMLFormElement>) => {
        e?.preventDefault();
        if (sending || !input.trim()) return;
        if (!agent || !chatId) return;
        const trimmed = input.trim();
        if (!trimmed) return;

        setSending(true);
        try {
            const chatRef = doc(db, "support_chats", chatId);
            const msgsRef = collection(chatRef, "messages");

            await addDoc(msgsRef, {
                sender: "agent",
                text: trimmed,
                createdAt: serverTimestamp(),
            });

            const baseUpdate = {
                updatedAt: serverTimestamp(),
                lastMessageFrom: "agent",
                status: "open",     // ✅ consistent
                assignedTo: agent.uid,
            };


            await updateDoc(chatRef, baseUpdate as any).catch((err) =>
                console.warn("Failed to update chat meta", err)
            );

            await setDoc(
                doc(db, "support_inbox", chatId),
                {
                    ...baseUpdate,
                    lastMessage: `Agent: ${trimmed}`,
                    unreadForUser: (window as any).firebase?.firestore?.FieldValue?.increment
                        ? (window as any).firebase.firestore.FieldValue.increment(1)
                        : 1,
                } as any,
                { merge: true }
            ).catch((err) =>
                console.warn("Failed to update support_inbox on agent send", err)
            );

            setInput("");
        } catch (err) {
            console.error("Agent send failed", err);
        } finally {
            setSending(false);
        }
    }

    function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
        const value = e.target.value;
        setInput(value);

        if (!agent || !chatId) return;

        // Light "agent is typing" indicator for user widget
        const chatRef = doc(db, "support_chats", chatId);

        // Immediately mark typing
        updateDoc(chatRef, {
            agentTyping: true,
            agentTypingAt: serverTimestamp(),
        }).catch(() => { });

        // Debounce clearing
        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
        }
        typingTimeoutRef.current = setTimeout(() => {
            updateDoc(chatRef, { agentTyping: false }).catch(() => { });
        }, 2500);
    }

    if (!chatId) {
        return (
            <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
                Missing chatId
            </div>
        );
    }

    if (loadingAuth || loadingChat) {
        return (
            <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
                Loading conversation…
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-screen items-center justify-center text-sm text-red-500">
                {error}
            </div>
        );
    }

    if (!agent || !meta) {
        return (
            <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
                No access
            </div>
        );
    }

    const statusLabel =
        meta.status === "waiting_agent"
            ? "Waiting for agent"
            : meta.status === "assigned"
                ? "Assigned"
                : meta.status === "closed"
                    ? "Closed"
                    : "Open";

    const statusColor =
        meta.status === "closed"
            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
            : meta.status === "assigned"
                ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                : meta.status === "waiting_agent"
                    ? "bg-amber-50 text-amber-700 border border-amber-100"
                    : "bg-neutral-50 text-neutral-700 border border-neutral-100";

    const isAssignedToMe = meta.assignedTo === agent.uid;

    async function handleCloseAsAgent() {
        try {
            await fetch("/api/support/close", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chatId, by: "agent" }),
            });
        } catch {
            // ignore
        }
        router.push("/support/agent");
    }


    return (
        <div className="flex h-screen w-full bg-neutral-50">
            <div className="m-4 flex h-[calc(100%-32px)] w-full max-w-6xl overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">

                {/* Left strip: back + meta */}
                <div className="flex w-64 flex-col border-r border-neutral-200 bg-neutral-50/60">
                    <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-3">
                        <button
                            type="button"
                            onClick={() => router.push("/support/agent")}
                            className="rounded-full border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                        >
                            ← Inbox
                        </button>
                    </div>

                    <div className="flex flex-1 flex-col gap-3 px-3 py-4 text-xs text-neutral-700">
                        <button
                            type="button"
                            onClick={handleCloseAsAgent}
                            className="rounded-full border bg-accent text-white border-neutral-300 px-3 py-1 text-xs font-semibold hover:brightness-80"
                        >
                            Close chat
                        </button>
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                                Conversation
                            </div>
                            <div className="mt-1 text-[13px] font-semibold text-neutral-900">
                                {meta.userId || "Anonymous user"}
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <span
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColor}`}
                                >
                                    {statusLabel}
                                </span>
                            </div>
                            <div className="text-[11px] text-neutral-500">
                                Last from: {meta.lastMessageFrom || "n/a"}
                            </div>
                            <div className="text-[11px] text-neutral-500">
                                {meta.updatedAt
                                    ? `Updated: ${meta.updatedAt.toLocaleString()}`
                                    : ""}
                            </div>
                        </div>

                        <div className="mt-2 flex flex-col gap-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                                Assignment
                            </div>
                            <div className="text-[11px] text-neutral-600">
                                {meta.assignedToEmail
                                    ? `Assigned to ${meta.assignedToEmail}`
                                    : meta.assignedTo
                                        ? `Assigned`
                                        : "Unassigned"}
                            </div>

                            {!isAssignedToMe && (
                                <button
                                    type="button"
                                    disabled={assigning}
                                    onClick={handleAssignToMe}
                                    className="mt-1 inline-flex items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                                >
                                    {assigning ? "Assigning…" : "Assign to me"}
                                </button>
                            )}

                            {isAssignedToMe && (
                                <div className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                                    You are assigned
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right: message thread */}
                <div className="flex flex-1 flex-col">
                    <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                            <div className="text-xs font-semibold text-neutral-900">
                                {meta.userId || "Anonymous user"}
                            </div>
                            <div className="text-[11px] text-neutral-500">
                                Chat ID: {meta.id}
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {meta.userTyping && (
                                <div className="rounded-full bg-neutral-100 px-3 py-1 text-[11px] text-neutral-600">
                                    User is typing…
                                </div>
                            )}
                            <div className="rounded-full bg-neutral-100 px-3 py-1 text-[11px] text-neutral-600">
                                Agent: {agent.email || agent.uid}
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto bg-neutral-25 px-4 py-3">
                        <div className="flex flex-col gap-2">
                            {messages.map((m) => {
                                const isMine = m.sender === "agent";
                                const isSystem = m.sender === "system";

                                const bubbleBase =
                                    "inline-block rounded-2xl px-3 py-2 text-sm";
                                const bubbleClass = isSystem
                                    ? "bg-neutral-100 text-neutral-600"
                                    : isMine
                                        ? "bg-indigo-600 text-white"
                                        : m.sender === "ai"
                                            ? "bg-neutral-800 text-neutral-50"
                                            : "bg-neutral-200 text-neutral-900";

                                const rowClass = isSystem
                                    ? "justify-center"
                                    : isMine
                                        ? "justify-end"
                                        : "justify-start";

                                return (
                                    <div
                                        key={m.id}
                                        className={`flex ${rowClass} text-xs text-neutral-500`}
                                    >
                                        <div className="flex flex-col">
                                            {!isSystem && (
                                                <span className="mb-0.5 text-[10px] text-neutral-400">
                                                    {m.sender === "user"
                                                        ? "User"
                                                        : m.sender === "ai"
                                                            ? "AI"
                                                            : m.sender === "agent"
                                                                ? "You"
                                                                : "System"}
                                                </span>
                                            )}
                                            <div className={`${bubbleBase} ${bubbleClass}`}>
                                                {m.text}
                                            </div>
                                            {m.createdAt && (
                                                <span className="mt-0.5 text-[10px] text-neutral-400">
                                                    {m.createdAt.toLocaleTimeString([], {
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                    })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={bottomRef} />
                        </div>
                    </div>
                    <form
                        onSubmit={handleSend}
                        className="border-t border-neutral-200 bg-white px-4 py-3"
                    >
                        <div className="flex items-end gap-3">
                            <textarea
                                value={input}
                                onChange={handleInputChange}
                                rows={2}
                                placeholder="Reply as agent…"
                                className="flex-1 resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-indigo-400 focus:bg-white focus:ring-1 focus:ring-indigo-300"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        if (!sending && input.trim()) {
                                            handleSend();
                                        }
                                    }
                                }}
                            />
                            <button
                                type="submit"
                                disabled={sending || !input.trim()}
                                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {sending ? "Sending…" : "Send"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
