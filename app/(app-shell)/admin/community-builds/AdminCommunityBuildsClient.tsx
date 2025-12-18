// src/app/admin/community-builds/AdminCommunityBuildsClient.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    collection,
    doc,
    getDocs,
    limit,
    orderBy,
    query,
    updateDoc,
    serverTimestamp,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, getIdTokenResult } from "firebase/auth";
import { getDownloadURL, getStorage, ref as storageRef } from "firebase/storage";
import { ExternalLink, CheckCircle2, XCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { db } from "@/lib/firebase";

type GalleryBuild = {
    id: string;
    approved?: boolean;
    author?: string;
    createdAt?: any;
    html?: string;
    name?: string;
    remixable?: boolean;
    screenshotKey?: string;
    sourceRenderId?: string;
};

function extractRoutesFromHtml(html?: string): string[] {
    if (!html) return ["/"];
    const routes: string[] = [];
    const re1 = /data-route\s*=\s*"([^"]+)"/gi;
    const re2 = /data-route\s*=\s*'([^']+)'/gi;

    let m: RegExpExecArray | null;
    while ((m = re1.exec(html))) {
        const v = (m[1] || "").trim();
        if (v) routes.push(v);
    }
    while ((m = re2.exec(html))) {
        const v = (m[1] || "").trim();
        if (v) routes.push(v);
    }

    const uniq = Array.from(new Set(routes.map((r) => normalizeRoute(r))));
    if (!uniq.length) return ["/"];
    uniq.sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
    return uniq;
}

function normalizeRoute(v: string) {
    const s = (v || "/").trim() || "/";
    return s.startsWith("/") ? s : `/${s}`;
}

function useResolvedStorageKey(key?: string) {
    const [src, setSrc] = useState<string>("");
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let alive = true;
        setSrc("");
        setFailed(false);

        const k = (key || "").trim();
        if (!k) return;

        (async () => {
            try {
                const storage = getStorage();
                const url = await getDownloadURL(storageRef(storage, k));
                if (!alive) return;
                setSrc(url);
            } catch {
                if (!alive) return;
                setFailed(true);
            }
        })();

        return () => {
            alive = false;
        };
    }, [key]);

    return { src, failed };
}

export default function AdminCommunityBuildsClient() {
    const [userUid, setUserUid] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState<boolean>(false);

    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<GalleryBuild[]>([]);
    const [err, setErr] = useState<string | null>(null);

    const [saving, setSaving] = useState<Record<string, boolean>>({});
    const [openRoutesFor, setOpenRoutesFor] = useState<string | null>(null);

    useEffect(() => {
        const auth = getAuth();
        return onAuthStateChanged(auth, async (u) => {
            if (!u) {
                setUserUid(null);
                setIsAdmin(false);
                return;
            }
            setUserUid(u.uid);
            try {
                const tok = await getIdTokenResult(u, true);
                setIsAdmin(tok?.claims?.admin === true);
            } catch {
                setIsAdmin(false);
            }
        });
    }, []);

    const refresh = useCallback(async () => {
        setErr(null);
        setLoading(true);
        try {
            const base = collection(db, "gallery");
            const qs = query(base, orderBy("createdAt", "desc"), limit(200));
            const snap = await getDocs(qs);

            const all: GalleryBuild[] = snap.docs.map((d) => {
                const data = d.data() as any;
                return {
                    id: d.id,
                    approved: !!data.approved,
                    author: data.author,
                    createdAt: data.createdAt,
                    html: data.html,
                    name: data.name,
                    remixable: data.remixable,
                    screenshotKey: data.screenshotKey,
                    sourceRenderId: data.sourceRenderId,
                };
            });

            setItems(all);
        } catch (e: any) {
            console.error("[AdminCommunityBuilds] fetch failed", e);
            setErr(e?.message || "Failed to load gallery builds.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const setApproved = useCallback(
        async (id: string, next: boolean) => {
            if (!userUid) return;

            setSaving((m) => ({ ...m, [id]: true }));
            setErr(null);

            try {
                const ref = doc(db, "gallery", id);
                await updateDoc(ref, {
                    approved: next,
                    approvedAt: next ? serverTimestamp() : null,
                    approvedBy: next ? userUid : null,
                    updatedAt: serverTimestamp(),
                });

                setItems((prev) => prev.map((x) => (x.id === id ? { ...x, approved: next } : x)));
            } catch (e: any) {
                console.error("[AdminCommunityBuilds] approve toggle failed", e);
                setErr(e?.message || "Failed to update approved state.");
            } finally {
                setSaving((m) => {
                    const n = { ...m };
                    delete n[id];
                    return n;
                });
            }
        },
        [userUid],
    );

    if (!userUid) {
        return (
            <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-neutral-900 font-semibold">
                    <ShieldAlert className="h-5 w-5" />
                    Sign in required
                </div>
                <div className="mt-2 text-sm text-neutral-600">
                    You must be signed in to access admin moderation.
                </div>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-neutral-900 font-semibold">
                    <ShieldAlert className="h-5 w-5" />
                    Admin only
                </div>
                <div className="mt-2 text-sm text-neutral-600">
                    Your account does not have admin permissions.
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-6 sm:px-8 sm:py-8 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-2xl tracking-tight text-neutral-900">Moderation</h2>
                    <p className="mt-1 text-sm text-neutral-600">
                        Toggle approval, open the build, and inspect routes.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={refresh}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-2 text-sm text-white shadow-sm hover:opacity-95"
                    disabled={loading}
                >
                    <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                    Refresh
                </button>
            </div>

            {err ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {err}
                </div>
            ) : null}

            {loading ? (
                <div className="mt-6 text-sm text-neutral-500">Loading…</div>
            ) : items.length === 0 ? (
                <div className="mt-6 text-sm text-neutral-500">No builds found.</div>
            ) : (
                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {items.map((b) => (
                        <AdminBuildCard
                            key={b.id}
                            b={b}
                            onToggleApproved={setApproved}
                            saving={!!saving[b.id]}
                            openRoutesFor={openRoutesFor}
                            setOpenRoutesFor={setOpenRoutesFor}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function AdminBuildCard({
    b,
    onToggleApproved,
    saving,
    openRoutesFor,
    setOpenRoutesFor,
}: {
    b: GalleryBuild;
    onToggleApproved: (id: string, next: boolean) => Promise<void>;
    saving: boolean;
    openRoutesFor: string | null;
    setOpenRoutesFor: (id: string | null) => void;
}) {
    const { src } = useResolvedStorageKey(b.screenshotKey);
    const name = (b.name || "").trim() || "Untitled build";
    const routes = useMemo(() => extractRoutesFromHtml(b.html), [b.html]);

    const isOpen = openRoutesFor === b.id;

    return (
        <div className="relative overflow-visible">
            <div className="relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
                <div className="relative">
                    {src ? (
                        <img
                            src={src}
                            alt={name}
                            className="h-44 w-full object-cover"
                            draggable={false}
                            loading="lazy"
                        />
                    ) : (
                        <div className="grid h-44 w-full place-items-center text-xs text-neutral-500 bg-neutral-50">
                            No screenshot
                        </div>
                    )}

                    <span
                        className={[
                            "absolute left-2 top-2 rounded-md whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold shadow",
                            b.approved ? "bg-emerald-200/95 text-emerald-900" : "bg-amber-200/95 text-amber-900",
                        ].join(" ")}
                    >
                        {b.approved ? "Approved" : "Not approved"}
                    </span>

                    {/* FIX: open the ADMIN preview, not /gallery */}
                    <Link
                        href={`/admin/community-builds/${b.id}`}
                        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-neutral-900 shadow hover:bg-white"
                        title="Open admin preview"
                    >
                        Open
                        <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                </div>

                <div className="p-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-neutral-900">{name}</div>
                        <div className="mt-0.5 truncate text-xs text-neutral-500">
                            /admin/community-builds/{b.id}
                        </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onToggleApproved(b.id, !b.approved)}
                            disabled={saving}
                            className={[
                                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
                                b.approved
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                                    : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
                                saving ? "opacity-70 pointer-events-none" : "",
                            ].join(" ")}
                            title="Toggle approval"
                        >
                            {b.approved ? (
                                <>
                                    <CheckCircle2 className="h-4 w-4" />
                                    Approved
                                </>
                            ) : (
                                <>
                                    <XCircle className="h-4 w-4" />
                                    Approve
                                </>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setOpenRoutesFor(isOpen ? null : b.id)}
                            className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                            title="View routes detected in HTML"
                        >
                            Pages ({routes.length})
                        </button>
                    </div>

                    {isOpen ? (
                        <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                            <div className="text-[11px] font-semibold text-neutral-700 uppercase tracking-[0.08em]">
                                Detected routes
                            </div>

                            <div className="mt-2 flex flex-col gap-1.5">
                                {routes.map((r) => (
                                    <div
                                        key={r}
                                        className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 border border-neutral-200"
                                    >
                                        <div className="min-w-0 truncate text-xs text-neutral-800">{r}</div>

                                        {/* FIX: open the ADMIN preview with route param */}
                                        <a
                                            href={`/admin/community-builds/${b.id}?route=${encodeURIComponent(r)}`}
                                            className="shrink-0 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] text-white hover:opacity-95"
                                            title="Open this route in admin preview"
                                        >
                                            Open
                                            <ExternalLink className="h-3.5 w-3.5" />
                                        </a>
                                    </div>
                                ))}
                            </div>

                            <button
                                type="button"
                                onClick={() => setOpenRoutesFor(null)}
                                className="mt-3 text-xs text-neutral-600 hover:text-neutral-900"
                            >
                                Close
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
