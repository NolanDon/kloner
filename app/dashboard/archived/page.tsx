// app/dashboard/archived/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { getUserRenders, RenderRecord, unarchiveRender, useResolvedImg } from "@/src/lib/renders";
import { Trash2 as DeleteIcon } from "lucide-react";
import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import Image from 'next/image'
import { useModal } from "@/components/ui/ModalContext";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import {
    collection,
    limit,
    onSnapshot,
    orderBy,
    query,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { unarchiveApp } from "@/src/lib/apps";

type ArchiveCardProps = {
    r: RenderRecord;
    onUnarchive: (id: string) => void;
    onDiscard: (id: string) => void;
    isDeleting: boolean;
};

function ArchiveCard({ r, onUnarchive, onDiscard, isDeleting }: ArchiveCardProps) {
    const { src: refImgUrl, onError: refImgErr } = useResolvedImg(r.key || "");
    const isDeployed = !!r.lastExportedAt;

    const name =
        r.nameHint ||
        (r.url ? new URL(r.url).hostname : "") ||
        "Untitled preview";

    return (
        <div className="relative flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <button
                onClick={() => onDiscard(r.id)}
                disabled={isDeleting}
                aria-label="Discard preview"
                title="Delete this editable preview"
                className={[
                    "absolute -right-3 -top-3 z-40 inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm",
                    "transition-all duration-150",
                    "bg-white/85 border-neutral-200 text-neutral-400",
                    "hover:bg-red-600 hover:border-red-600 hover:text-white hover:shadow-md hover:scale-[1.04]",
                    "active:scale-[0.98]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2",
                    "disabled:opacity-60 disabled:pointer-events-none",
                ].join(" ")}
            >
                <DeleteIcon className="h-3.5 w-3.5 transition-colors" />
            </button>

            <div className="relative">
                {refImgUrl ? (
                    <Image
                        src={refImgUrl}
                        alt={name}
                        loading="lazy"
                        width={704}
                        height={176}
                        onError={refImgErr}
                        className="h-40 w-full object-cover opacity-70"
                        draggable={false}
                    />
                ) : (
                    <div className="grid h-40 w-full place-items-center text-xs text-neutral-500">
                        No snapshot available
                    </div>
                )}

                <span
                    className="absolute left-2 top-2 rounded-md bg-amber-200/95 px-2 py-0.5 text-[10px] font-semibold text-amber-900 shadow"
                    title="Archived previews are hidden from the main dashboard"
                >
                    Archived
                </span>

                <span className="absolute right-2 bottom-2 rounded-md bg-white/95 px-2 py-0.5 text-[10px] font-medium text-neutral-700 shadow">
                    {isDeployed ? "Deployed" : "Not deployed"}
                </span>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-3 py-2.5">
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-neutral-900">
                        {name}
                    </div>
                    {r.url && (
                        <div className="truncate text-xs text-neutral-500">
                            {r.url}
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => onUnarchive(r.id)}
                    className="shrink-0 rounded-md border border-amber-500 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    title="Move this preview back to your main dashboard"
                    disabled={isDeleting}
                >
                    Unarchive
                </button>
            </div>
        </div>
    );
}

type ArchivedAppRecord = {
    id: string;
    name?: string | null;
    createdAt?: any;
    updatedAt?: any;
    archived?: boolean;
    archivedAt?: any;
};

function ArchivedAppCard({
    app,
    onUnarchive,
    onDelete,
    isDeleting,
}: {
    app: ArchivedAppRecord;
    onUnarchive: (id: string) => void;
    onDelete: (id: string) => void;
    isDeleting: boolean;
}) {
    const name = app.name || app.id.slice(0, 10);

    return (
        <div className="relative flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <button
                onClick={() => onDelete(app.id)}
                disabled={isDeleting}
                aria-label="Delete app"
                title="Delete this app"
                className={[
                    "absolute -right-3 -top-3 z-40 inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm",
                    "transition-all duration-150",
                    "bg-white/85 border-neutral-200 text-neutral-400",
                    "hover:bg-red-600 hover:border-red-600 hover:text-white hover:shadow-md hover:scale-[1.04]",
                    "active:scale-[0.98]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2",
                    "disabled:opacity-60 disabled:pointer-events-none",
                ].join(" ")}
            >
                <DeleteIcon className="h-3.5 w-3.5 transition-colors" />
            </button>

            <div className="relative grid h-40 w-full place-items-center bg-gradient-to-br from-neutral-50 to-neutral-100">
                <span
                    className="absolute left-2 top-2 rounded-md bg-amber-200/95 px-2 py-0.5 text-[10px] font-semibold text-amber-900 shadow"
                    title="Archived apps are hidden from the main dashboard"
                >
                    Archived
                </span>

                <div className="px-4 text-center">
                    <div className="truncate text-sm font-semibold text-neutral-900">
                        {name}
                    </div>
                    <div className="mt-1 text-xs text-neutral-600">App</div>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-3 py-2.5">
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-neutral-900">
                        {name}
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => onUnarchive(app.id)}
                    className="shrink-0 rounded-md border border-amber-500 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    title="Move this app back to your main dashboard"
                    disabled={isDeleting}
                >
                    Unarchive
                </button>
            </div>
        </div>
    );
}

export default function ArchivedPage() {
    const [renders, setRenders] = useState<RenderRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingRender, setDeletingRender] = useState<Record<string, boolean>>({});
    const [err, setErr] = useState<string | null>(null);
    const { showConfirm } = useModal();

    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [apps, setApps] = useState<ArchivedAppRecord[]>([]);
    const [appsLoading, setAppsLoading] = useState(true);
    const [deletingApp, setDeletingApp] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsub();
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const all = await getUserRenders();
            if (cancelled) return;
            setRenders(all.filter((r) => r.archived));
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!user?.uid) {
            setApps([]);
            setAppsLoading(false);
            return;
        }

        setAppsLoading(true);
        const appsRef = collection(db, "kloner_users", user.uid, "kloner_apps");
        const qs = query(appsRef, orderBy("createdAt", "desc"), limit(200));
        const unsub = onSnapshot(
            qs,
            (snap) => {
                const list = snap.docs
                    .map((d) => ({ id: d.id, ...(d.data() as any) }))
                    .filter((a) => !!(a as any)?.archived);
                setApps(list);
                setAppsLoading(false);
            },
            (e) => {
                console.error("apps archive snapshot failed", e);
                setAppsLoading(false);
            }
        );

        return () => unsub();
    }, [user?.uid]);

    const discardRender = useCallback(
        async (renderId: string) => {
            const ok = await showConfirm("Discard this editable preview?", "Discard Preview");
            if (!ok) return;

            setErr(null);
            setDeletingRender((m) => ({ ...m, [renderId]: true }));

            try {
                // fire-and-forget delete of ALL storage objects for this render
                try {
                    const csrf = await ensureSessionAndCsrf();
                    await fetch("/api/user-blob/delete", {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                            ...(csrf ? { "x-csrf": csrf } : {}),
                        },
                        credentials: "include",
                        body: JSON.stringify({ renderId }),
                    });
                } catch (e) {
                    console.error("storage delete by renderId failed (non-fatal)", e);
                }

                // delete Firestore render + ai_edits (server-side recursive)
                const csrf = await ensureSessionAndCsrf();
                const resp = await fetch("/api/user-render/delete", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    body: JSON.stringify({ renderId }),
                });

                if (!resp.ok) {
                    const j = await resp.json().catch(() => ({}));
                    throw new Error(j?.error || "Failed to discard preview.");
                }

                setRenders((prev) => prev.filter((r) => r.id !== renderId));
            } catch (e: any) {
                console.error("discardRender failed", e);
                setErr(e?.message || "Failed to discard preview.");
            } finally {
                setDeletingRender((m) => {
                    const n = { ...m };
                    delete n[renderId];
                    return n;
                });
            }
        },
        [setRenders]
    );

    async function handleUnarchive(id: string) {
        await unarchiveRender(id);
        setRenders((prev) => prev.filter((r) => r.id !== id));
    }

    async function handleUnarchiveApp(id: string) {
        try {
            await unarchiveApp(id);
            setApps((prev) => prev.filter((a) => a.id !== id));
        } catch (e: any) {
            console.error("unarchiveApp failed", e);
            setErr(e?.message || "Failed to unarchive app.");
        }
    }

    const discardApp = useCallback(
        async (appId: string) => {
            const ok = await showConfirm(
                "Delete this app? This action cannot be undone.",
                "Delete App"
            );
            if (!ok) return;

            setErr(null);
            setDeletingApp((m) => ({ ...m, [appId]: true }));

            try {
                const csrf = await ensureSessionAndCsrf().catch(() => null);
                const res = await fetch("/api/app-builder/delete", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    body: JSON.stringify({ appId }),
                });

                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    throw new Error(j?.error || "Failed to delete app.");
                }

                setApps((prev) => prev.filter((a) => a.id !== appId));
            } catch (e: any) {
                console.error("discardApp failed", e);
                setErr(e?.message || "Failed to delete app.");
            } finally {
                setDeletingApp((m) => {
                    const n = { ...m };
                    delete n[appId];
                    return n;
                });
            }
        },
        [showConfirm]
    );

    return (
        <div className="min-h-screen bg-white pb-[30px]">
            <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 py-8">
                {/* Hero */}
                <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                    <span>Kloner · Your Archives</span>
                </div>

                <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-8 sm:px-8 sm:py-10 shadow-sm">
                    <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                        Archives
                    </h1>
                    <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                        Archived previews are hidden from your dashboard. Unarchive anytime to resume editing or deploy.
                    </p>

                    {err ? (
                        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                            {err}
                        </div>
                    ) : null}

                    {loading ? (
                        <div className="mt-6 text-sm text-neutral-500">Loading…</div>
                    ) : renders.length === 0 ? (
                        <div className="mt-6 text-sm text-neutral-500">
                            No archived previews yet.
                        </div>
                    ) : (
                        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {renders.map((r) => {
                                const normalized = { ...r, html: r.html ?? undefined };
                                const isDeleting = !!deletingRender[r.id];
                                return (
                                    <ArchiveCard
                                        key={r.id}
                                        r={normalized}
                                        onUnarchive={handleUnarchive}
                                        onDiscard={discardRender}
                                        isDeleting={isDeleting}
                                    />
                                );
                            })}
                        </div>
                    )}

                    <div className="mt-10">
                        <h2 className="text-lg font-semibold text-neutral-900">Archived Apps</h2>
                        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                            Archived apps are hidden from your dashboard. Unarchive anytime to resume editing.
                        </p>

                        {appsLoading ? (
                            <div className="mt-4 text-sm text-neutral-500">Loading…</div>
                        ) : apps.length === 0 ? (
                            <div className="mt-4 text-sm text-neutral-500">
                                No archived apps yet.
                            </div>
                        ) : (
                            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {apps.map((a) => {
                                    const isDeleting = !!deletingApp[a.id];
                                    return (
                                        <ArchivedAppCard
                                            key={a.id}
                                            app={a}
                                            onUnarchive={handleUnarchiveApp}
                                            onDelete={discardApp}
                                            isDeleting={isDeleting}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
