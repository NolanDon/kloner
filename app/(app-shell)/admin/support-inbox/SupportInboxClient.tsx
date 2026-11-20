"use client";

import { useCallback, useEffect, useState } from "react";
import { getAuth, getIdToken, getIdTokenResult, onAuthStateChanged } from "firebase/auth";
import { Inbox, Loader2, RefreshCw, Send } from "lucide-react";

type Thread = {
    id: string;
    subject: string;
    fromEmail: string;
    fromName: string | null;
    status: "open" | "closed";
    unread: boolean;
    snippet: string;
    messageCount: number;
    lastMessageAt: number;
    createdAt: number;
};

type Message = {
    id: string;
    direction: "in" | "out";
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string | null;
    attachments: Array<{ filename: string; contentType: string | null; size: number | null }>;
    at: number;
};

async function adminFetch(path: string, init?: RequestInit) {
    const user = getAuth().currentUser;
    if (!user) throw new Error("Sign in with an admin account to continue.");
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${await getIdToken(user, true)}`);
    if (init?.body) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `Request failed (${response.status})`);
    }
    return payload;
}

function formatWhen(ms: number): string {
    if (!ms) return "";
    const date = new Date(ms);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
        ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatFull(ms: number): string {
    if (!ms) return "";
    return new Date(ms).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

/** Display-only fallback for HTML-only mail: strip tags, never render raw HTML. */
function htmlToText(html: string): string {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/[ \t]+/g, " ")
        .trim();
}

export default function SupportInboxClient() {
    const [authReady, setAuthReady] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [threads, setThreads] = useState<Thread[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<{ thread: Thread; messages: Message[] } | null>(null);
    const [replyText, setReplyText] = useState("");
    const [loading, setLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const loadThreads = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const payload = await adminFetch("/api/admin/support/threads");
            setThreads(Array.isArray(payload.threads) ? payload.threads : []);
            setUnreadCount(typeof payload.unreadCount === "number" ? payload.unreadCount : 0);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not load the inbox.");
        } finally {
            setLoading(false);
        }
    }, []);

    const openThread = useCallback(async (threadId: string) => {
        setSelectedId(threadId);
        setDetailLoading(true);
        setError(null);
        setReplyText("");
        try {
            const payload = await adminFetch(`/api/admin/support/threads/${threadId}`);
            setDetail({ thread: payload.thread, messages: payload.messages || [] });
            setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread: false } : t)));
            setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not open that thread.");
        } finally {
            setDetailLoading(false);
        }
    }, []);

    useEffect(
        () =>
            onAuthStateChanged(getAuth(), async (user) => {
                setAuthReady(true);
                setIsAdmin(false);
                if (!user) return;
                try {
                    const token = await getIdTokenResult(user, true);
                    const admin = token.claims.admin === true;
                    setIsAdmin(admin);
                    if (admin) await loadThreads();
                } catch {
                    setIsAdmin(false);
                }
            }),
        [loadThreads]
    );

    const sendReply = useCallback(async () => {
        if (!selectedId || !replyText.trim()) return;
        setSending(true);
        setError(null);
        setNotice(null);
        try {
            await adminFetch(`/api/admin/support/threads/${selectedId}/reply`, {
                method: "POST",
                body: JSON.stringify({ text: replyText }),
            });
            setNotice("Reply sent.");
            await openThread(selectedId);
            await loadThreads();
        } catch (e) {
            setError(e instanceof Error ? e.message : "The reply could not be sent.");
        } finally {
            setSending(false);
        }
    }, [selectedId, replyText, openThread, loadThreads]);

    const toggleStatus = useCallback(async () => {
        if (!detail) return;
        const next = detail.thread.status === "open" ? "closed" : "open";
        setError(null);
        try {
            await adminFetch(`/api/admin/support/threads/${detail.thread.id}`, {
                method: "PATCH",
                body: JSON.stringify({ status: next }),
            });
            setDetail({ ...detail, thread: { ...detail.thread, status: next } });
            setThreads((prev) => prev.map((t) => (t.id === detail.thread.id ? { ...t, status: next } : t)));
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not update the thread.");
        }
    }, [detail]);

    if (!authReady) {
        return (
            <p className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
        );
    }
    if (!isAdmin) {
        return (
            <div>
                <h1 className="text-2xl font-semibold">Support inbox</h1>
                <p className="mt-3 text-sm text-neutral-600">
                    Sign in with an admin account to read support@kloner.app mail.
                </p>
            </div>
        );
    }

    return (
        <div>
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="flex items-center gap-2 text-2xl font-semibold">
                    <Inbox className="h-6 w-6" /> Support inbox
                </h1>
                {unreadCount > 0 && (
                    <span className="rounded-full bg-black px-2 py-0.5 text-xs font-medium text-white">
                        {unreadCount} unread
                    </span>
                )}
                <button
                    type="button"
                    onClick={loadThreads}
                    disabled={loading}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Refresh
                </button>
            </div>
            <p className="mt-1 text-sm text-neutral-500">Mail sent to support@kloner.app. Replies go out as support@kloner.app.</p>

            {error && (
                <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            {notice && (
                <p className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
                <div className="overflow-hidden rounded-lg border border-neutral-200">
                    {threads.length === 0 && !loading && (
                        <p className="px-4 py-6 text-sm text-neutral-500">No support mail yet.</p>
                    )}
                    <ul className="divide-y divide-neutral-100">
                        {threads.map((thread) => (
                            <li key={thread.id}>
                                <button
                                    type="button"
                                    onClick={() => openThread(thread.id)}
                                    className={`block w-full px-4 py-3 text-left hover:bg-neutral-50 ${
                                        selectedId === thread.id ? "bg-neutral-100" : ""
                                    }`}
                                >
                                    <span className="flex items-baseline justify-between gap-2">
                                        <span className={`truncate text-sm ${thread.unread ? "font-semibold" : "font-medium"}`}>
                                            {thread.fromName || thread.fromEmail}
                                        </span>
                                        <span className="shrink-0 text-xs text-neutral-400">{formatWhen(thread.lastMessageAt)}</span>
                                    </span>
                                    <span className={`mt-0.5 block truncate text-sm ${thread.unread ? "font-semibold" : ""}`}>
                                        {thread.subject}
                                    </span>
                                    <span className="mt-0.5 block truncate text-xs text-neutral-500">{thread.snippet}</span>
                                    <span className="mt-1 flex items-center gap-2">
                                        {thread.unread && <span className="h-2 w-2 rounded-full bg-blue-600" />}
                                        <span
                                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                                thread.status === "open"
                                                    ? "bg-green-100 text-green-800"
                                                    : "bg-neutral-200 text-neutral-600"
                                            }`}
                                        >
                                            {thread.status}
                                        </span>
                                        <span className="text-[11px] text-neutral-400">
                                            {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="min-w-0">
                    {!selectedId && (
                        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
                            Pick a thread to read it.
                        </p>
                    )}
                    {selectedId && detailLoading && (
                        <p className="flex items-center gap-2 text-sm text-neutral-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> Opening…
                        </p>
                    )}
                    {selectedId && !detailLoading && detail && (
                        <div>
                            <div className="flex flex-wrap items-center gap-3">
                                <h2 className="min-w-0 truncate text-lg font-semibold">{detail.thread.subject}</h2>
                                <button
                                    type="button"
                                    onClick={toggleStatus}
                                    className="ml-auto rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
                                >
                                    {detail.thread.status === "open" ? "Close thread" : "Reopen thread"}
                                </button>
                            </div>
                            <p className="mt-0.5 text-sm text-neutral-500">
                                {detail.thread.fromName ? `${detail.thread.fromName} · ` : ""}
                                {detail.thread.fromEmail}
                            </p>

                            <div className="mt-4 space-y-3">
                                {detail.messages.map((message) => (
                                    <article
                                        key={message.id}
                                        className={`rounded-lg border px-4 py-3 ${
                                            message.direction === "out"
                                                ? "border-blue-200 bg-blue-50"
                                                : "border-neutral-200 bg-white"
                                        }`}
                                    >
                                        <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-neutral-500">
                                            <span className="font-medium text-neutral-700">
                                                {message.direction === "out" ? "You (support@kloner.app)" : message.from}
                                            </span>
                                            <span>{formatFull(message.at)}</span>
                                        </p>
                                        <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                                            {message.text || (message.html ? htmlToText(message.html) : "(no text body)")}
                                        </p>
                                        {message.attachments.length > 0 && (
                                            <p className="mt-2 text-xs text-neutral-500">
                                                Attachments: {message.attachments.map((a) => a.filename).join(", ")}
                                            </p>
                                        )}
                                    </article>
                                ))}
                            </div>

                            <div className="mt-5">
                                <label htmlFor="support-reply" className="text-sm font-medium">
                                    Reply as support@kloner.app
                                </label>
                                <textarea
                                    id="support-reply"
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    rows={5}
                                    className="mt-1.5 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
                                    placeholder="Write your reply…"
                                />
                                <button
                                    type="button"
                                    onClick={sendReply}
                                    disabled={sending || !replyText.trim()}
                                    className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                                >
                                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    Send reply
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
