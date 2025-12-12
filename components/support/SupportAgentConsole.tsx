"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
    collection,
    onSnapshot,
    orderBy,
    query,
    Timestamp,
    DocumentData,
    doc,
    serverTimestamp,
    updateDoc,
} from "firebase/firestore";
import {
    MessageCircle,
    Users,
    Circle,
    Clock,
    Filter,
    ArrowRight,
    CheckCircle2,
    RotateCcw,
    XCircle,
} from "lucide-react";

type InboxItem = {
    id: string;
    userId?: string | null;
    lastMessage?: string | null;
    updatedAt?: Timestamp | null;
    status?: "open" | "pending" | "closed";
    unreadCount?: number;
    assignedTo?: string | null;
};

const STATUS_COLORS: Record<NonNullable<InboxItem["status"]>, string> = {
    open: "bg-emerald-100 text-emerald-800 border-emerald-200",
    pending: "bg-amber-100 text-amber-800 border-amber-200",
    closed: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

function formatTime(ts?: Timestamp | null): string {
    if (!ts) return "—";
    const d = ts.toDate();
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
}

export function SupportAgentConsole() {
    const router = useRouter();
    const [inbox, setInbox] = useState<InboxItem[]>([]);
    const [filter, setFilter] = useState<"all" | "open" | "pending" | "closed">(
        "open",
    );

    // sound only on *new* chats
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const knownChatIdsRef = useRef<Set<string>>(new Set());
    const isInitialSnapshotRef = useRef(true);

    useEffect(() => {
        const audio = new Audio("/sounds/support-new-message.mp3");
        audioRef.current = audio;

        const qInbox = query(
            collection(db, "support_inbox"),
            orderBy("updatedAt", "desc"),
        );

        const unsub = onSnapshot(
            qInbox,
            (snap) => {
                const next: InboxItem[] = [];
                const currentIds = new Set<string>();
                let hasNewChat = false;

                snap.forEach((doc) => {
                    const data = doc.data() as DocumentData;
                    const updatedAt = data.updatedAt as Timestamp | undefined;

                    currentIds.add(doc.id);
                    if (!knownChatIdsRef.current.has(doc.id)) {
                        hasNewChat = true;
                    }

                    next.push({
                        id: doc.id,
                        userId: data.userId || null,
                        lastMessage: data.lastMessage || "",
                        updatedAt: updatedAt ?? null,
                        status: (data.status as InboxItem["status"]) || "open",
                        unreadCount:
                            typeof data.unreadCount === "number"
                                ? data.unreadCount
                                : 0,
                        assignedTo: data.assignedTo || null,
                    });
                });

                setInbox(next);

                // skip first snapshot (initial load)
                if (!isInitialSnapshotRef.current && hasNewChat && audioRef.current) {
                    audioRef.current.play().catch(() => { });
                }

                knownChatIdsRef.current = currentIds;
                if (isInitialSnapshotRef.current) {
                    isInitialSnapshotRef.current = false;
                }
            },
            (err) => {
                console.error("support/agent inbox onSnapshot failed", err);
            },
        );

        return () => unsub();
    }, []);

    const filteredInbox = useMemo(() => {
        if (filter === "all") return inbox;
        return inbox.filter((c) => (c.status || "open") === filter);
    }, [inbox, filter]);

    const totalUnread = useMemo(
        () => inbox.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
        [inbox],
    );

    async function setChatStatus(chatId: string, status: "open" | "pending" | "closed") {
        if (!chatId) return;

        await updateDoc(doc(db, "support_inbox", chatId), {
            status,
            updatedAt: serverTimestamp(),
        });
    }

    return (
        <div className="h-screen bg-white">
            <div className="mx-auto flex h-full max-w-6xl flex-col px-4 py-6">
                {/* Header */}
                <header className="mb-4 flex items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                            <MessageCircle className="h-4 w-4 text-neutral-500" />
                            <span>Support inbox</span>
                        </div>
                        <p className="mt-1 text-xs text-neutral-500">
                            View AI escalations and jump into live chats.
                        </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-neutral-500">
                        <div className="flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1">
                            <Users className="h-3 w-3" />
                            <span>Active chats</span>
                            <span className="font-semibold text-neutral-800">
                                {inbox.length}
                            </span>
                        </div>
                        <div className="flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1">
                            <Circle className="h-2 w-2 fill-emerald-400 text-emerald-500" />
                            <span>Unread</span>
                            <span className="font-semibold text-neutral-800">
                                {totalUnread}
                            </span>
                        </div>
                    </div>
                </header>

                {/* Toolbar */}
                <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                    <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1">
                        <Filter className="h-3 w-3 text-neutral-500" />
                        <button
                            type="button"
                            onClick={() => setFilter("all")}
                            className={
                                filter === "all"
                                    ? "rounded-full bg-accent px-3 py-1 text-[14px] font-semibold text-white"
                                    : "rounded-full px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-white"
                            }
                        >
                            All
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter("open")}
                            className={
                                filter === "open"
                                    ? "rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white"
                                    : "rounded-full px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-white"
                            }
                        >
                            Open
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter("pending")}
                            className={
                                filter === "pending"
                                    ? "rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white"
                                    : "rounded-full px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-white"
                            }
                        >
                            Pending
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter("closed")}
                            className={
                                filter === "closed"
                                    ? "rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white"
                                    : "rounded-full px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-white"
                            }
                        >
                            Closed
                        </button>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] text-neutral-500">
                        <Clock className="h-3 w-3" />
                        <span>Sorted by latest activity</span>
                    </div>
                </div>

                {/* Inbox list */}
                <div className="flex-1 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
                    {filteredInbox.length === 0 ? (
                        <div className="grid h-full place-items-center px-6 py-10 text-xs text-neutral-500">
                            No chats yet. When users ask for a human, they’ll appear here.
                        </div>
                    ) : (
                        <ul className="max-h-full divide-y divide-neutral-100 overflow-y-auto">
                            {filteredInbox.map((chat) => {
                                const status = chat.status || "open";
                                const statusClass = STATUS_COLORS[status];
                                const unread = typeof chat.unreadCount === "number" ? chat.unreadCount : 0;

                                return (
                                    <li key={chat.id}>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                router.push(`/support/agent/${chat.id}`)
                                            }
                                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate text-sm font-medium text-neutral-900">
                                                        {chat.userId || "Anonymous user"}
                                                    </span>
                                                    <span
                                                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-semibold ${statusClass}`}
                                                    >
                                                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                                                        <span className="capitalize">{status}</span>
                                                    </span>

                                                    {/* status actions */}
                                                    <div
                                                        className="inline-flex items-center gap-1"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {status !== "closed" ? (
                                                            <button
                                                                type="button"
                                                                title="Close"
                                                                aria-label="Close conversation"
                                                                onClick={() => void setChatStatus(chat.id, "closed")}
                                                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                                                            >
                                                                <XCircle className="h-4 w-4" />
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                title="Reopen"
                                                                aria-label="Reopen conversation"
                                                                onClick={() => void setChatStatus(chat.id, "open")}
                                                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                                                            >
                                                                <RotateCcw className="h-4 w-4" />
                                                            </button>
                                                        )}

                                                        {status !== "pending" ? (
                                                            <button
                                                                type="button"
                                                                title="Mark pending"
                                                                aria-label="Mark conversation as pending"
                                                                onClick={() => void setChatStatus(chat.id, "pending")}
                                                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                                                            >
                                                                <Clock className="h-4 w-4" />
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                title="Mark open"
                                                                aria-label="Mark conversation as open"
                                                                onClick={() => void setChatStatus(chat.id, "open")}
                                                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                                                            >
                                                                <CheckCircle2 className="h-4 w-4" />
                                                            </button>
                                                        )}
                                                    </div>


                                                    {status === "open" && unread > 0 ? (
                                                        <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1.5 py-[1px] text-[10px] font-semibold text-white">
                                                            {unread}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                                                    <span className="line-clamp-1">
                                                        {chat.lastMessage ||
                                                            "No recent message"}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex flex-col items-end gap-1 text-right">
                                                <span className="text-[11px] text-neutral-400">
                                                    {formatTime(chat.updatedAt)}
                                                </span>
                                                <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
                                                    View thread
                                                    <ArrowRight className="h-3 w-3" />
                                                </span>
                                            </div>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
