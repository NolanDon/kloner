"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import {
    collection,
    query,
    where,
    getDocs,
    DocumentData,
    QueryDocumentSnapshot,
    orderBy,
    limit,
    addDoc,
    doc,
    updateDoc,
    serverTimestamp,
    getDoc,
    setDoc,
    Timestamp,
} from "firebase/firestore";
import { ref as sRef, listAll, getDownloadURL, StorageReference } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import PreviewEditor from "@/components/PreviewEditor";

const ACCENT = "#f55f2a";

type UrlDoc = {
    url: string;
    urlHash?: string;
    screenshotsPrefix?: string;
    screenshotPaths?: string[];
    status?: string;
};
type Shot = { path: string; url: string; fileName: string; createdAt?: Date };
type RenderDoc = {
    url?: string | null;
    urlHash?: string | null;
    key?: string | null;
    referenceImage?: string | null;
    html?: string;
    nameHint?: string | null;
    status: "ready" | "queued" | "failed";
    archived?: boolean;
    createdAt?: any;
    updatedAt?: any;
    model?: string | null;
    version?: number;
};

function isHttpUrl(s?: string): s is string {
    if (!s) return false;
    try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}
function normUrl(s: string): string {
    try {
        const u = new URL(s);
        u.hash = "";
        return u.toString();
    } catch {
        return s.trim();
    }
}
function hash64(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(36);
}
async function listAllDeep(root: StorageReference): Promise<StorageReference[]> {
    const out: StorageReference[] = [];
    async function walk(ref: StorageReference) {
        const l = await listAll(ref);
        out.push(...l.items);
        await Promise.all(l.prefixes.map(walk));
    }
    await walk(root);
    return out;
}
function tsToMs(v: any): number {
    if (!v) return 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v?.toDate === "function") return (v as Timestamp).toDate().getTime();
    if (typeof v === "number") return v;
    return 0;
}

function CenterSpinner({
    label = "Loading…",
    dim = true,
    size = 28,
}: {
    label?: string;
    dim?: boolean;
    size?: number;
}) {
    return (
        <div className={`absolute inset-0 grid place-items-center ${dim ? "bg-white/85" : ""}`}>
            <div
                className="flex items-center gap-2 rounded border px-3 py-1.5 text-xs text-neutral-800 bg-white"
                role="status"
                aria-live="polite"
            >
                <span
                    className="inline-block rounded-full border-2 border-neutral-300"
                    style={{ width: size, height: size, borderTopColor: ACCENT, animation: "spin 0.8s linear infinite" }}
                    aria-hidden
                />
                {label}
            </div>
        </div>
    );
}

export default function PreviewPage(): JSX.Element {
    const router = useRouter();
    const search = useSearchParams();

    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [err, setErr] = useState<string>("");
    const [info, setInfo] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(true);
    const [docSnap, setDocSnap] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [docData, setDocData] = useState<UrlDoc | null>(null);
    const [shots, setShots] = useState<Shot[]>([]);
    const [rescanning, setRescanning] = useState<boolean>(false);

    const [pendingByKey, setPendingByKey] = useState<Record<string, boolean>>({});

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorHtml, setEditorHtml] = useState<string>("");
    const [editorRefImg, setEditorRefImg] = useState<string>("");
    const [activeRenderId, setActiveRenderId] = useState<string | undefined>(undefined);

    const [renders, setRenders] = useState<Array<{ id: string } & RenderDoc>>([]);
    const [loadingRenders, setLoadingRenders] = useState(false);

    const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollStopAt = useRef<number>(0);

    const targetUrl = useMemo(() => {
        const raw = search.get("u");
        if (!raw) return "";
        try {
            return normUrl(decodeURIComponent(raw));
        } catch {
            return normUrl(raw);
        }
    }, [search]);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (!u) {
                const next = encodeURIComponent(`/dashboard/view?u=${encodeURIComponent(targetUrl || "")}`);
                router.replace(`/login?next=${next}`);
                return;
            }
            setUser(u);
        });
        return () => unsub();
    }, [router, targetUrl]);

    useEffect(() => {
        (async () => {
            setErr("");
            setInfo("");
            setLoading(true);
            setDocSnap(null);
            setDocData(null);
            setShots([]);

            if (!user) {
                setLoading(false);
                return;
            }
            if (!isHttpUrl(targetUrl)) {
                setErr("Invalid or missing URL parameter.");
                setLoading(false);
                return;
            }

            try {
                const qy = query(collection(db, "kloner_users", user.uid, "kloner_urls"), where("url", "==", targetUrl));
                const snap = await getDocs(qy);
                if (snap.empty) {
                    setErr("No record for this URL under your account.");
                    setLoading(false);
                    return;
                }
                const first = snap.docs[0];
                const data = (first.data() || {}) as UrlDoc;
                setDocSnap(first);
                setDocData(data);

                const prefix = data.screenshotsPrefix || `kloner-screenshots/${user.uid}/${data.urlHash || hash64(targetUrl)}`;
                let fileRefs: StorageReference[] = [];
                if (Array.isArray(data.screenshotPaths) && data.screenshotPaths.length) {
                    fileRefs = data.screenshotPaths.map((p) => sRef(storage, p));
                } else {
                    const root = sRef(storage, prefix);
                    fileRefs = await listAllDeep(root);
                }
                const entries = await Promise.all(
                    fileRefs.map(async (r) => {
                        const url = await getDownloadURL(r);
                        const name = r.name || r.fullPath.split("/").pop() || "image";
                        return { path: r.fullPath, url, fileName: name } as Shot;
                    })
                );
                entries.sort((a, b) => (a.fileName < b.fileName ? 1 : a.fileName > b.fileName ? -1 : 0));
                setShots(entries);
            } catch (e: any) {
                setErr(e?.message || "Failed to load screenshots.");
            } finally {
                setLoading(false);
            }
        })();
    }, [user, targetUrl]);

    const refreshRenders = useCallback(async () => {
        if (!user) return;
        setLoadingRenders(true);
        try {
            const base = collection(db, "kloner_users", user.uid, "kloner_renders");
            const qs = query(base, where("archived", "in", [false, null]), orderBy("createdAt", "desc"), limit(60));
            const snap = await getDocs(qs);
            const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as RenderDoc) }));

            const forUrl = items.filter((r) => (r.url || "") === (targetUrl || ""));
            const rest = items.filter((r) => (r.url || "") !== (targetUrl || ""));
            const merged = [...forUrl, ...rest];

            setRenders(merged);

            const anyQueued = merged.some((r) => r.status === "queued");
            const now = Date.now();

            if (anyQueued) {
                if (!pollTimer.current) {
                    pollStopAt.current = now + 10 * 60 * 1000;
                    pollTimer.current = setInterval(async () => {
                        await refreshRenders();
                        if (Date.now() > pollStopAt.current && pollTimer.current) {
                            clearInterval(pollTimer.current);
                            pollTimer.current = null;
                        }
                    }, 5000);
                } else {
                    pollStopAt.current = Math.max(pollStopAt.current, now + 5 * 60 * 1000);
                }
            } else if (pollTimer.current) {
                clearInterval(pollTimer.current);
                pollTimer.current = null;
            }

            setPendingByKey((prev) => {
                const next = { ...prev };
                merged.forEach((r) => {
                    if (r.key && (r.status === "ready" || r.status === "failed")) {
                        delete next[r.key];
                    }
                });
                return next;
            });
        } finally {
            setLoadingRenders(false);
        }
    }, [user, targetUrl]);

    useEffect(() => {
        refreshRenders();
    }, [user, targetUrl]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const onFocus = () => void refreshRenders();
        const onVis = () => document.visibilityState === "visible" && refreshRenders();
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVis);
        return () => {
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [refreshRenders]);

    const buildFromKey = useCallback(
        async (storageKey: string) => {
            if (!user) return;

            const alreadyQueued = renders.find((r) => r.key === storageKey && r.status === "queued" && !r.archived);
            if (alreadyQueued) return;

            const optimisticId = `local_${hash64(`${user.uid}|${storageKey}|${Date.now()}`)}`;
            const optimistic: { id: string } & RenderDoc = {
                id: optimisticId,
                key: storageKey,
                referenceImage: null,
                html: "",
                status: "queued",
                url: targetUrl || null,
                urlHash: targetUrl ? hash64(targetUrl) : null,
                nameHint: null,
                model: null,
                archived: false,
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            } as any;
            setRenders((prev) => [optimistic, ...prev]);
            setPendingByKey((m) => ({ ...m, [storageKey]: true }));
            setInfo("Rendering started. It will appear below when ready.");

            try {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), 20000);
                const r = await fetch("/api/preview/render", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ key: storageKey, url: targetUrl }),
                    signal: ctrl.signal,
                });
                clearTimeout(t);
                const j = await r.json().catch(() => ({} as any));
                if (!r.ok || !j?.ok) throw new Error(j?.error || "Render failed");

                await refreshRenders();
            } catch (e: any) {
                setRenders((prev) => prev.map((r) => (r.id === optimisticId ? { ...r, status: "failed" } : r)));
                setErr(e?.message || "Failed to start rendering.");
            }
        },
        [user, targetUrl, renders, refreshRenders]
    );

    const continueRender = useCallback(
        async (renderId: string) => {
            if (!user) return;
            setErr("");
            const dref = doc(db, "kloner_users", user.uid, "kloner_renders", renderId);
            const snap = await getDoc(dref);
            if (!snap.exists()) {
                setErr("Rendering not found");
                return;
            }
            const data = snap.data() as RenderDoc;
            setEditorHtml(data.html || "");
            setEditorRefImg(data.referenceImage || "");
            setActiveRenderId(renderId);
            setEditorOpen(true);
        },
        [user]
    );

    const discardRender = useCallback(
        async (renderId: string) => {
            if (!user) return;
            await updateDoc(doc(db, "kloner_users", user.uid, "kloner_renders", renderId), {
                archived: true,
                updatedAt: serverTimestamp(),
            });
            setRenders((prev) => prev.filter((r) => r.id !== renderId));
        },
        [user]
    );

    async function exportToVercel(html: string, name?: string) {
        const r = await fetch("/api/export/vercel", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ html, name }),
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || "Vercel export failed");
        if (user && activeRenderId) {
            await updateDoc(doc(db, "kloner_users", user.uid, "kloner_renders", activeRenderId), {
                lastExportedAt: serverTimestamp(),
            });
        }
    }

    const saveDraft = useCallback(
        async (payload: {
            draftId?: string;
            html: string;
            meta: { nameHint?: string; device: string; mode: string };
            version: number;
        }) => {
            if (!user) return;
            const rid = payload.draftId || activeRenderId;
            if (!rid) {
                const created = await addDoc(collection(db, "kloner_users", user.uid, "kloner_renders"), {
                    url: targetUrl || null,
                    urlHash: targetUrl ? hash64(targetUrl) : null,
                    key: null,
                    referenceImage: editorRefImg || null,
                    html: payload.html,
                    nameHint: payload.meta?.nameHint || null,
                    status: "ready",
                    archived: false,
                    version: payload.version || 1,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                } as any);
                setActiveRenderId(created.id);
                await refreshRenders();
                return;
            }
            await setDoc(
                doc(db, "kloner_users", user.uid, "kloner_renders", rid),
                {
                    url: targetUrl || null,
                    urlHash: targetUrl ? hash64(targetUrl) : null,
                    html: payload.html,
                    nameHint: payload.meta?.nameHint || null,
                    version: payload.version || 1,
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );
            await refreshRenders();
        },
        [user, activeRenderId, targetUrl, editorRefImg, refreshRenders]
    );

    const rescan = useCallback(async () => {
        if (!isHttpUrl(targetUrl)) return;
        setRescanning(true);
        setErr("");
        try {
            const r = await fetch("/api/private/generate", {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ url: targetUrl }),
            });
            if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                setErr(j?.error || "Rescan failed.");
            }
        } catch (e: any) {
            setErr(e?.message || "Rescan failed.");
        } finally {
            setRescanning(false);
        }
    }, [targetUrl]);

    const RenderCard = ({ r }: { r: { id: string } & RenderDoc }) => {
        const isQueued = r.status === "queued";
        const isFailed = r.status === "failed";
        const disableOpen = isQueued || isFailed;
        const [frameLoading, setFrameLoading] = useState<boolean>(
            !isQueued && !isFailed && !(r.html && r.html.trim().length > 0)
        );

        useEffect(() => {
            if (r.html && r.html.trim().length > 0) setFrameLoading(false);
        }, [r.html]);

        useEffect(() => {
            if (isQueued || isFailed) return;
            const t = setTimeout(() => setFrameLoading(false), 10000);
            return () => clearTimeout(t);
        }, [isQueued, isFailed, r.id]);

        const ageMs = Date.now() - tsToMs(r.createdAt);
        const isStaleQueued = isQueued && ageMs > 6 * 60 * 1000;

        return (
            <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm flex flex-col">
                <div className="text-xs text-neutral-500 mb-2">{r.nameHint || r.key || r.id}</div>
                <div className="flex-1 overflow-hidden rounded border bg-neutral-50 h-44 relative">
                    {(isQueued || frameLoading) && (
                        <CenterSpinner label={isQueued ? (isStaleQueued ? "Still queued… Retry available" : "Rendering…") : "Loading…"} />
                    )}
                    {isFailed ? (
                        <div className="absolute inset-0 grid place-items-center">
                            <div className="text-xs text-red-600 bg-white/90 px-3 py-1.5 rounded border border-red-200">Failed</div>
                        </div>
                    ) : (
                        <iframe title={`r-${r.id}`} srcDoc={r.html} className="w-full h-full" sandbox="allow-same-origin" onLoad={() => setFrameLoading(false)} />
                    )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                    <button
                        onClick={() => continueRender(r.id)}
                        className="rounded-md px-2 py-1 text-[11px] text-white disabled:opacity-50"
                        style={{ backgroundColor: ACCENT }}
                        disabled={disableOpen}
                        title={isQueued ? "Still rendering" : isFailed ? "Rendering failed" : "Open editor"}
                    >
                        {isQueued ? "Queued" : isFailed ? "Retry" : "Preview / Edit"}
                    </button>
                    {isStaleQueued && r.key ? (
                        <button
                            onClick={() => buildFromKey(r.key!)}
                            className="rounded-md px-2 py-1 text-[11px] border border-amber-300 text-amber-700"
                            title="Retry this render"
                        >
                            Retry render
                        </button>
                    ) : null}
                    <button onClick={() => discardRender(r.id)} className="rounded-md px-2 py-1 text-[11px] border text-red-600 border-red-200">
                        Discard
                    </button>
                    <button onClick={rescan} className="rounded-md px-2 py-1 text-[11px] border" disabled={rescanning} title="Capture a fresh screenshot">
                        Rescan
                    </button>
                    <span className="ml-auto text-[11px] text-neutral-500">{isStaleQueued ? "stale" : r.status}</span>
                </div>
            </div>
        );
    };

    const ShotCard = ({ s, locked }: { s: Shot; locked: boolean }) => {
        const [imgLoading, setImgLoading] = useState<boolean>(true);
        const showOverlay = locked || imgLoading;
        return (
            <figure className="rounded-xl border border-neutral-200 bg-white shadow-sm flex flex-col">
                <a href={s.url} target="_blank" rel="noreferrer" className="block">
                    <div className="w-full aspect-[4/3] bg-neutral-50 flex items-center justify-center rounded-t-xl relative">
                        <img
                            src={s.url}
                            alt={s.fileName}
                            className={`h-full w-full object-contain ${locked ? "opacity-60" : ""}`}
                            loading="lazy"
                            onLoad={() => setImgLoading(false)}
                            onError={() => setImgLoading(false)}
                        />
                        {showOverlay && <CenterSpinner label={locked ? "Queued Render…" : "Loading…"} />}
                    </div>
                </a>
                <figcaption className="px-3 py-2 text-xs text-neutral-700 rounded-b-xl">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="truncate max-w-[55%]" title={s.fileName}>
                            {s.fileName}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                            <a href={s.url} download className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] hover:bg-neutral-50">
                                Download
                            </a>
                            <button
                                onClick={() => buildFromKey(s.path)}
                                disabled={locked}
                                aria-busy={locked}
                                className="shrink-0 rounded-md px-2 py-1 text-[11px] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ backgroundColor: ACCENT }}
                                title="Generate editable preview from this screenshot"
                            >
                                {locked ? "In progress" : "Generate preview"}
                            </button>
                        </div>
                    </div>
                </figcaption>
            </figure>
        );
    };

    return (
        <main className="min-h-screen bg-white">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-8">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-900">Preview</h1>
                        <p className="mt-1 text-sm text-neutral-600 break-all">{targetUrl || "—"}</p>
                        {docData?.status ? (
                            <p className="mt-1 text-xs text-neutral-500">
                                Status: <span className="font-medium text-neutral-700">{docData.status}</span>
                            </p>
                        ) : null}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                        <a href="/dashboard" className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
                            Back
                        </a>
                        <button
                            onClick={rescan}
                            disabled={rescanning || !isHttpUrl(targetUrl)}
                            className="rounded-lg px-3 py-2 text-sm text-white disabled:opacity-60"
                            style={{ backgroundColor: ACCENT }}
                        >
                            {rescanning ? "Starting…" : "Rescan"}
                        </button>
                    </div>
                </div>

                {err ? <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div> : null}
                {info ? (
                    <div className="mt-4 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">{info}</div>
                ) : null}

                <div className="mt-6">
                    {loading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="h-64 rounded-xl bg-neutral-100 animate-pulse" />
                            ))}
                        </div>
                    ) : shots.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-neutral-500">
                            No screenshots found for this URL yet.
                        </div>
                    ) : (
                        <>
                            <div className="mb-3 text-sm text-neutral-600">{shots.length} screenshot(s)</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {shots.map((s) => {
                                    const locked =
                                        !!pendingByKey[s.path] || renders.some((r) => r.key === s.path && r.status === "queued" && !r.archived);
                                    return <ShotCard key={s.path} s={s} locked={locked} />;
                                })}
                            </div>
                        </>
                    )}
                </div>

                <div className="mt-10">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-neutral-900">AI renderings</h2>
                        {loadingRenders && <span className="text-xs text-neutral-500">Loading…</span>}
                    </div>
                    {renders.length === 0 ? (
                        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
                            Nothing yet. Start one from a screenshot above.
                        </div>
                    ) : (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {renders.map((r) => (
                                <RenderCard key={r.id} r={r} />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {editorOpen && (
                <PreviewEditor
                    initialHtml={editorHtml}
                    sourceImage={editorRefImg}
                    onClose={() => {
                        setEditorOpen(false);
                        setActiveRenderId(undefined);
                    }}
                    onExport={exportToVercel}
                    draftId={activeRenderId}
                    saveDraft={saveDraft}
                    onLiveHtml={(html) => {
                        if (!activeRenderId) return;
                        setRenders((prev) => prev.map((r) => (r.id === activeRenderId ? { ...r, html } : r)));
                    }}
                />
            )}

            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </main>
    );
}
