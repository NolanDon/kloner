"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuth, getIdToken, getIdTokenResult, onAuthStateChanged } from "firebase/auth";
import {
    ChevronLeft,
    ChevronRight,
    Clock3,
    Database,
    HardDrive,
    Loader2,
    RefreshCw,
    Search,
    ShieldAlert,
    Trash2,
    UserRound,
} from "lucide-react";

const ACCENT = "#FF8D21";
const PAGE_SIZE = 20;
const CLIENT_RESULTS_CACHE_TTL_MS = 30_000;

type SortMode = "created_desc" | "last_sign_in_desc" | "last_sign_in_asc" | "storage_desc";

type UserRow = {
    uid: string;
    email: string | null;
    displayName: string | null;
    createdAt: string | null;
    lastSignInAt: string | null;
    disabled: boolean;
    emailVerified: boolean;
    tier: string | null;
    storageBytes: number;
    counts: {
        apps: number;
        urls: number;
        renders: number;
        drafts: number;
        deployments: number;
    };
};

async function adminFetch(path: string, init?: RequestInit) {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");

    const token = await getIdToken(user, true);
    const headers = new Headers(init?.headers || {});
    headers.set("authorization", `Bearer ${token}`);
    if (init?.body && !headers.get("content-type")) {
        headers.set("content-type", "application/json");
    }

    const res = await fetch(path, {
        ...init,
        headers,
        credentials: "include",
        cache: "no-store",
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) {
        throw new Error(payload?.error || payload?.message || `Request failed (${res.status})`);
    }

    return payload;
}

function formatWhen(value: string | null): string {
    if (!value) return "Never";
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return "Never";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(ms));
}

function formatStorage(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
    const mb = bytes / (1024 ** 2);
    return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function sortLabel(sort: SortMode): string {
    if (sort === "last_sign_in_desc") return "Recent login";
    if (sort === "last_sign_in_asc") return "Oldest login";
    if (sort === "storage_desc") return "Most data used";
    return "Newest users";
}

export default function AdminUsersClient() {
    const [userUid, setUserUid] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

    const [query, setQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [sort, setSort] = useState<SortMode>("created_desc");
    const [page, setPage] = useState(0);

    const [items, setItems] = useState<UserRow[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [total, setTotal] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [refreshNonce, setRefreshNonce] = useState(0);

    const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);
    const [deletingByUid, setDeletingByUid] = useState<Record<string, boolean>>({});
    const [deleteWarnings, setDeleteWarnings] = useState<Record<string, string[]>>({});
    const resultsCacheRef = useRef<
        Map<string, { expiresAt: number; payload: { items: UserRow[]; hasMore: boolean; total: number | null } }>
    >(new Map());

    useEffect(() => {
        const auth = getAuth();
        return onAuthStateChanged(auth, async (user) => {
            if (!user) {
                setUserUid(null);
                setIsAdmin(false);
                return;
            }

            setUserUid(user.uid);
            try {
                const tokenResult = await getIdTokenResult(user, true);
                setIsAdmin(tokenResult?.claims?.admin === true);
            } catch {
                setIsAdmin(false);
            }
        });
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedQuery(query.trim());
        }, 250);
        return () => window.clearTimeout(timer);
    }, [query]);

    useEffect(() => {
        setPage(0);
    }, [debouncedQuery, sort]);

    const refresh = useCallback(async () => {
        setLoading(true);
        setErr(null);

        try {
            const params = new URLSearchParams({
                q: debouncedQuery,
                sort,
                page: String(page),
                limit: String(PAGE_SIZE),
            });
            const cacheKey = params.toString();
            const cached = resultsCacheRef.current.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                setItems(cached.payload.items);
                setHasMore(cached.payload.hasMore);
                setTotal(cached.payload.total);
                return;
            }

            const payload = await adminFetch(`/api/admin/users?${cacheKey}`);
            setItems(Array.isArray(payload?.items) ? payload.items : []);
            setHasMore(Boolean(payload?.hasMore));
            setTotal(typeof payload?.total === "number" ? payload.total : null);

            resultsCacheRef.current.set(cacheKey, {
                expiresAt: Date.now() + CLIENT_RESULTS_CACHE_TTL_MS,
                payload: {
                    items: Array.isArray(payload?.items) ? payload.items : [],
                    hasMore: Boolean(payload?.hasMore),
                    total: typeof payload?.total === "number" ? payload.total : null,
                },
            });

            if (resultsCacheRef.current.size > 80) {
                const firstKey = resultsCacheRef.current.keys().next().value;
                if (typeof firstKey === "string") resultsCacheRef.current.delete(firstKey);
            }
        } catch (error) {
            setErr(error instanceof Error ? error.message : "Failed to load users.");
            setItems([]);
            setHasMore(false);
            setTotal(null);
        } finally {
            setLoading(false);
        }
    }, [debouncedQuery, page, sort]);

    useEffect(() => {
        if (!userUid || !isAdmin) return;
        void refresh();
    }, [isAdmin, refresh, refreshNonce, userUid]);

    const subtitle = useMemo(() => {
        if (debouncedQuery) {
            return total === null
                ? `Searching all users for “${debouncedQuery}”`
                : `${total} search result${total === 1 ? "" : "s"} for “${debouncedQuery}”`;
        }
        return `Showing ${sortLabel(sort)} first`;
    }, [debouncedQuery, sort, total]);

    const handleDelete = useCallback(async (uid: string) => {
        setDeletingByUid((prev) => ({ ...prev, [uid]: true }));
        setErr(null);
        setDeleteWarnings((prev) => {
            const next = { ...prev };
            delete next[uid];
            return next;
        });

        try {
            const payload = await adminFetch("/api/admin/users", {
                method: "DELETE",
                body: JSON.stringify({ uid }),
            });
            const warnings = Array.isArray(payload?.warnings) ? payload.warnings.filter((item: unknown) => typeof item === "string" && item) : [];
            if (warnings.length) {
                setDeleteWarnings((prev) => ({ ...prev, [uid]: warnings }));
            }
            resultsCacheRef.current.clear();
            setItems((prev) => prev.filter((item) => item.uid !== uid));
            setConfirmDeleteUid(null);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "Failed to delete user.");
        } finally {
            setDeletingByUid((prev) => {
                const next = { ...prev };
                delete next[uid];
                return next;
            });
        }
    }, []);

    if (!userUid) {
        return (
            <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-base font-semibold text-neutral-900">
                    <ShieldAlert className="h-5 w-5" />
                    Sign in required
                </div>
                <p className="mt-2 text-sm text-neutral-600">
                    You must be signed in to access admin users.
                </p>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-base font-semibold text-neutral-900">
                    <ShieldAlert className="h-5 w-5" />
                    Admin only
                </div>
                <p className="mt-2 text-sm text-neutral-600">
                    Your account does not have admin permissions.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="rounded-[28px] border border-neutral-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,249,248,0.94))] p-5 shadow-[0_18px_45px_rgba(0,0,0,0.08)] sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-orange-700">
                            Admin
                        </div>
                        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
                            User accounts
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                            Fast recent-user view with search, login recency, storage usage, and account deletion.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => setRefreshNonce((value) => value + 1)}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:text-neutral-900"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </button>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="relative flex h-[56px] items-center rounded-full bg-white/95 p-2 pl-4 shadow-[0_12px_30px_rgba(0,0,0,0.08)] ring-1 ring-neutral-200 backdrop-blur-md transition-all duration-300 ease-out sm:pl-5">
                        <span className="mr-2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-neutral-500">
                            <Search className="h-4 w-4" />
                        </span>
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search email, display name, or uid"
                            className="flex-1 bg-transparent text-sm font-medium text-neutral-700 outline-none placeholder:text-neutral-400"
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>

                    <label className="flex h-[56px] items-center gap-3 rounded-full border border-neutral-200 bg-white px-4 shadow-[0_12px_30px_rgba(0,0,0,0.05)]">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
                            Sort
                        </span>
                        <select
                            value={sort}
                            onChange={(event) => setSort(event.target.value as SortMode)}
                            className="w-full bg-transparent text-sm font-medium text-neutral-800 outline-none"
                        >
                            <option value="created_desc">Newest users</option>
                            <option value="last_sign_in_desc">Recent login</option>
                            <option value="last_sign_in_asc">Oldest login</option>
                            <option value="storage_desc">Most data used</option>
                        </select>
                    </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-600">
                    <span>{subtitle}</span>
                    <span>
                        Page {page + 1}
                        {total !== null ? ` · ${total} total` : ""}
                    </span>
                </div>
            </div>

            {err ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {err}
                </div>
            ) : null}

            <div className="rounded-[28px] border border-neutral-200 bg-white shadow-sm">
                {loading ? (
                    <div className="flex items-center justify-center gap-3 px-6 py-16 text-sm text-neutral-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading users…
                    </div>
                ) : items.length === 0 ? (
                    <div className="px-6 py-16 text-center text-sm text-neutral-500">
                        No users matched this view.
                    </div>
                ) : (
                    <div className="divide-y divide-neutral-200">
                        {items.map((item) => {
                            const deleting = Boolean(deletingByUid[item.uid]);
                            const warnings = deleteWarnings[item.uid] || [];
                            const confirming = confirmDeleteUid === item.uid;

                            return (
                                <div key={item.uid} className="px-5 py-5 sm:px-6">
                                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-neutral-500">
                                                    <UserRound className="h-4 w-4" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-semibold text-neutral-950">
                                                        {item.email || item.displayName || item.uid}
                                                    </div>
                                                    <div className="truncate text-xs text-neutral-500">
                                                        {item.displayName && item.email ? `${item.displayName} · ` : ""}
                                                        {item.uid}
                                                    </div>
                                                </div>
                                                {item.tier ? (
                                                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-600">
                                                        {item.tier}
                                                    </span>
                                                ) : null}
                                                {item.disabled ? (
                                                    <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-700">
                                                        Disabled
                                                    </span>
                                                ) : null}
                                            </div>

                                            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                                <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 px-3 py-2" title="Account created">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <Clock3 className="h-3.5 w-3.5 text-neutral-500" />
                                                        <div className="truncate text-xs font-medium text-neutral-900" title={formatWhen(item.createdAt)}>
                                                            {formatWhen(item.createdAt)}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 px-3 py-2" title="Last login">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <Clock3 className="h-3.5 w-3.5 text-neutral-500" />
                                                        <div className="truncate text-xs font-medium text-neutral-900" title={formatWhen(item.lastSignInAt)}>
                                                            {formatWhen(item.lastSignInAt)}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 px-3 py-2" title="Total storage used (Firestore-referenced + GCS assets)">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <HardDrive className="h-3.5 w-3.5 text-neutral-500" />
                                                        <div className="truncate text-xs font-medium text-neutral-900" title={formatStorage(item.storageBytes)}>
                                                            {formatStorage(item.storageBytes)}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 px-3 py-2" title="Firestore asset counts: apps, urls, renders, drafts, deployments">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <Database className="h-3.5 w-3.5 text-neutral-500" />
                                                        <div className="truncate text-xs font-medium text-neutral-900" title={`${item.counts.apps} apps · ${item.counts.urls} urls · ${item.counts.renders} renders · ${item.counts.drafts} drafts · ${item.counts.deployments} deployments`}>
                                                            a{item.counts.apps} u{item.counts.urls} r{item.counts.renders} d{item.counts.drafts} p{item.counts.deployments}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {warnings.length ? (
                                                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                                                    {warnings.join(" ")}
                                                </div>
                                            ) : null}
                                        </div>

                                        <div className="flex w-full flex-col gap-2 xl:w-[220px]">
                                            {!confirming ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setConfirmDeleteUid(item.uid)}
                                                    className="inline-flex items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                    Delete user
                                                </button>
                                            ) : (
                                                <div className="rounded-3xl border border-red-200 bg-red-50 p-3">
                                                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-red-600">
                                                        Confirm deletion
                                                    </div>
                                                    <p className="mt-2 text-xs leading-5 text-red-700">
                                                        This removes auth, Firestore data, and storage assets for this user.
                                                    </p>
                                                    <div className="mt-3 flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleDelete(item.uid)}
                                                            disabled={deleting}
                                                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                                            style={{ backgroundColor: ACCENT }}
                                                        >
                                                            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                            Confirm
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setConfirmDeleteUid(null)}
                                                            disabled={deleting}
                                                            className="inline-flex flex-1 items-center justify-center rounded-full border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between gap-3">
                <button
                    type="button"
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                    disabled={page === 0 || loading}
                    className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                </button>

                <button
                    type="button"
                    onClick={() => setPage((value) => value + 1)}
                    disabled={!hasMore || loading}
                    className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Next
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}