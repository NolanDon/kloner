// app/dashboard/view/page.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef, memo } from "react";
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
    deleteDoc,
    serverTimestamp,
    getDoc,
    setDoc,
    arrayRemove,
    Timestamp,
} from "firebase/firestore";
import {
    ref as sRef,
    listAll,
    getDownloadURL,
    deleteObject,
    type StorageReference,
} from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import PreviewEditor from "@/components/PreviewEditor";

const ACCENT = "#f55f2a";

/* ───────── types ───────── */
type UrlDoc = {
    url: string;
    urlHash?: string;
    screenshotsPrefix?: string;
    screenshotPaths?: string[];
    status?: string;
    createdAt?: any;
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

/* ───────── utils ───────── */
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
/** Extract <urlHash> from key like kloner-screenshots/<uid>/url-scans/<urlHash>/<urlHash>-<ts>.jpeg */
function extractHashFromKey(key?: string | null): string | null {
    if (!key) return null;
    const parts = key.split("/");
    const i = parts.indexOf("url-scans");
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
    const file = parts[parts.length - 1] || "";
    const maybe = file.split("-")[0];
    return maybe && maybe.length >= 8 ? maybe : null;
}

/* ───────── tiny toast ───────── */
type ToastMsg = { id: string; text: string; tone?: "ok" | "warn" | "err" };
function useToasts() {
    const [toasts, setToasts] = useState<ToastMsg[]>([]);
    const push = useCallback((text: string, tone: "ok" | "warn" | "err" = "ok") => {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        setToasts((t) => [...t, { id, text, tone }]);
        setTimeout(() => setToasts((t) => t.filter((m) => m.id !== id)), 2800);
    }, []);
    return { toasts, push };
}
function Toasts({ toasts }: { toasts: ToastMsg[] }) {
    return (
        <div className="fixed bottom-3 right-3 z-50 flex flex-col gap-2">
            {toasts.map((t) => (
                <div
                    key={t.id}
                    className={`rounded-lg border px-3 py-2 text-sm shadow-sm bg-white ${t.tone === "ok"
                        ? "border-emerald-200 text-emerald-700"
                        : t.tone === "warn"
                            ? "border-amber-200 text-amber-700"
                            : "border-red-200 text-red-700"
                        }`}
                >
                    {t.text}
                </div>
            ))}
        </div>
    );
}

/* ───────── cooldown helper ───────── */
function useCooldown(initialUntil = 0) {
    const [until, setUntil] = useState<number>(initialUntil);
    const [now, setNow] = useState<number>(Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(t);
    }, []);
    const remaining = Math.max(0, Math.ceil((until - now) / 1000));
    const start = useCallback((ms: number) => setUntil(Date.now() + ms), []);
    const clear = useCallback(() => setUntil(0), []);
    return { remaining, active: remaining > 0, start, clear };
}

/* ───────── overlay spinner ───────── */
const CenterSpinner = memo(function CenterSpinner({
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
});

/* ───────── shallow equality for renders list ───────── */
function rendersEqual(a: Array<{ id: string } & RenderDoc>, b: Array<{ id: string } & RenderDoc>): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        if (x.id !== y.id) return false;
        if (x.status !== y.status) return false;
        if ((x.html || "") !== (y.html || "")) return false;
        if ((x.key || "") !== (y.key || "")) return false;
        if ((x.nameHint || "") !== (y.nameHint || "")) return false;
    }
    return true;
}

/* ───────── main ───────── */
export default function PreviewPage(): JSX.Element {
    const router = useRouter();
    const search = useSearchParams();
    const { toasts, push } = useToasts();

    const [user, setUser] = useState<FirebaseUser | null>(null);

    const [urls, setUrls] = useState<Array<{ id: string } & UrlDoc>>([]);
    const [urlsLoading, setUrlsLoading] = useState<boolean>(true);

    const [err, setErr] = useState<string>("");
    const [info, setInfo] = useState<string>("");

    const [loading, setLoading] = useState<boolean>(true);
    const [docSnap, setDocSnap] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [docData, setDocData] = useState<UrlDoc | null>(null);
    const [shots, setShots] = useState<Shot[]>([]);
    const [rescanning, setRescanning] = useState<boolean>(false);

    const [pendingByKey, setPendingByKey] = useState<Record<string, boolean>>({});
    const [deletingByKey, setDeletingByKey] = useState<Record<string, boolean>>({});
    const [deletingRender, setDeletingRender] = useState<Record<string, boolean>>({});

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorHtml, setEditorHtml] = useState<string>("");
    const [editorRefImg, setEditorRefImg] = useState<string>("");
    const [activeRenderId, setActiveRenderId] = useState<string | undefined>(undefined);

    const [renders, setRenders] = useState<Array<{ id: string } & RenderDoc>>([]);
    const [loadingRenders, setLoadingRenders] = useState(false);

    const rescanCooldown = useCooldown(0);

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

    const targetHash = useMemo(() => (isHttpUrl(targetUrl) ? hash64(targetUrl) : null), [targetUrl]);

    /* auth */
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

    /* fetch user's URL list */
    useEffect(() => {
        (async () => {
            if (!user) {
                setUrls([]);
                setUrlsLoading(false);
                return;
            }
            setUrlsLoading(true);
            try {
                const qy = query(collection(db, "kloner_users", user.uid, "kloner_urls"), orderBy("createdAt", "desc"), limit(50));
                const snap = await getDocs(qy);
                const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as UrlDoc) }));
                setUrls(list);
            } finally {
                setUrlsLoading(false);
            }
        })();
    }, [user]);

    /* screenshots for selected URL */
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
            if (!targetUrl) {
                setLoading(false);
                return;
            }
            if (!isHttpUrl(targetUrl)) {
                setErr("Invalid URL.");
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

    /* renders list filtered to selected URL */
    const refreshRenders = useCallback(async () => {
        if (!user) return;
        if (!targetUrl || !isHttpUrl(targetUrl)) {
            setRenders((prev) => (prev.length ? [] : prev));
            return;
        }
        setLoadingRenders(true);
        try {
            const base = collection(db, "kloner_users", user.uid, "kloner_renders");
            const qs = query(base, where("archived", "in", [false, null]), orderBy("createdAt", "desc"), limit(100));
            const snap = await getDocs(qs);
            const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as RenderDoc) }));

            const filtered = all.filter((r) => {
                const byUrl = (r.url || "") === targetUrl;
                const byHash = !!targetHash && r.urlHash === targetHash;
                const byKeyHash = !!targetHash && extractHashFromKey(r.key) === targetHash;
                return byUrl || byHash || byKeyHash;
            });

            setRenders((prev) => (rendersEqual(prev, filtered) ? prev : filtered));

            if (targetHash) {
                const updates: Promise<any>[] = [];
                for (const r of filtered) {
                    const needsUrl = !r.url && !!targetUrl;
                    const needsHash = !r.urlHash && !!targetHash;
                    if (needsUrl || needsHash) {
                        updates.push(
                            setDoc(
                                doc(db, "kloner_users", user.uid, "kloner_renders", r.id),
                                {
                                    ...(needsUrl ? { url: targetUrl } : {}),
                                    ...(needsHash ? { urlHash: targetHash } : {}),
                                    ...(r.nameHint ? {} : { nameHint: new URL(targetUrl).hostname }),
                                    updatedAt: serverTimestamp(),
                                },
                                { merge: true }
                            ).catch(() => void 0)
                        );
                    }
                }
                if (updates.length) await Promise.all(updates);
            }

            const anyQueued = filtered.some((r) => r.status === "queued");
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
                filtered.forEach((r) => {
                    if (r.key && (r.status === "ready" || r.status === "failed")) delete next[r.key];
                });
                return next;
            });
        } finally {
            setLoadingRenders(false);
        }
    }, [user, targetUrl, targetHash]);

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

    /* change selected URL */
    const selectUrl = useCallback(
        (u: string) => {
            if (!isHttpUrl(u)) return;
            router.push(`/dashboard/view?u=${encodeURIComponent(u)}`);
        },
        [router]
    );

    /* start render from screenshot key */
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
            setErr("");
            setInfo("Rendering started.");
            push("Preview generation queued", "ok");

            try {
                const body: any = { key: storageKey };
                if (isHttpUrl(targetUrl)) {
                    body.url = targetUrl;
                    body.urlHash = hash64(targetUrl);
                    body.nameHint = new URL(targetUrl).hostname;
                }
                const r = await fetch("/api/preview/render", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(body),
                });
                const j = await r.json().catch(() => ({} as any));
                if (r.status === 202) {
                    push("Preview queued on server", "ok");
                    await refreshRenders();
                    return;
                }
                if (!r.ok || !j?.ok) throw new Error(j?.error || "Render failed");
                await refreshRenders();
            } catch (e: any) {
                setRenders((prev) => prev.map((r) => (r.id === optimisticId ? { ...r, status: "failed" } : r)));
                setErr(e?.message || "Failed to start rendering.");
                push("Preview failed to start", "err");
            }
        },
        [user, targetUrl, renders, refreshRenders, push]
    );

    /* editor */
    const continueRender = useCallback(
        async (renderId: string) => {
            if (!user) return;
            setErr("");
            const dref = doc(db, "kloner_users", user.uid, "kloner_renders", renderId);
            const snap = await getDoc(dref);
            if (!snap.exists()) {
                setErr("Rendering not found");
                push("Preview not found", "err");
                return;
            }
            const data = snap.data() as RenderDoc;
            setEditorHtml(data.html || "");
            setEditorRefImg(data.referenceImage || "");
            setActiveRenderId(renderId);
            setEditorOpen(true);
        },
        [user, push]
    );

    const discardRender = useCallback(
        async (renderId: string) => {
            if (!user) return;
            setDeletingRender((m) => ({ ...m, [renderId]: true }));
            try {
                await deleteDoc(doc(db, "kloner_users", user.uid, "kloner_renders", renderId));
                setRenders((prev) => prev.filter((r) => r.id !== renderId));
                push("Preview discarded", "ok");
            } catch (e: any) {
                setErr(e?.message || "Failed to discard preview.");
                push("Failed to discard preview", "err");
            } finally {
                setDeletingRender((m) => {
                    const n = { ...m };
                    delete n[renderId];
                    return n;
                });
            }
        },
        [user, push]
    );

    /* discard a screenshot file + any renders tied to it */
    const discardShot = useCallback(
        async (shot: Shot) => {
            if (!user || !docSnap) return;
            setErr("");
            setDeletingByKey((m) => ({ ...m, [shot.path]: true }));
            try {
                await deleteObject(sRef(storage, shot.path)).catch(() => { });
                const rCol = collection(db, "kloner_users", user.uid, "kloner_renders");
                const rSnap = await getDocs(query(rCol, where("key", "==", shot.path)));
                if (!rSnap.empty) {
                    await Promise.all(rSnap.docs.map((d) => deleteDoc(d.ref)));
                }
                try {
                    await updateDoc(docSnap.ref, {
                        screenshotPaths: arrayRemove(shot.path),
                        updatedAt: serverTimestamp(),
                    } as any);
                } catch { }
                setShots((prev) => prev.filter((s) => s.path !== shot.path));
                setRenders((prev) => prev.filter((r) => r.key !== shot.path));
                setPendingByKey((m) => {
                    const n = { ...m };
                    delete n[shot.path];
                    return n;
                });
                push("Screenshot discarded", "ok");
            } catch (e: any) {
                setErr(e?.message || "Failed to discard screenshot.");
                push("Failed to discard screenshot", "err");
            } finally {
                setDeletingByKey((m) => {
                    const n = { ...m };
                    delete n[shot.path];
                    return n;
                });
            }
        },
        [user, docSnap, push]
    );

    async function exportToVercel(html: string, name?: string) {
        const r = await fetch("/api/export/vercel", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ html, name }),
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) {
            push("Export failed", "err");
            throw new Error(j?.error || "Vercel export failed");
        }
        if (user && activeRenderId) {
            await updateDoc(doc(db, "kloner_users", user.uid, "kloner_renders", activeRenderId), {
                lastExportedAt: serverTimestamp(),
            });
        }
        push("Exported to Vercel", "ok");
        await refreshRenders();
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
                    nameHint: payload.meta?.nameHint || (targetUrl ? new URL(targetUrl).hostname : null),
                    status: "ready",
                    archived: false,
                    version: payload.version || 1,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                } as any);
                setActiveRenderId(created.id);
                push("Draft saved", "ok");
                await refreshRenders();
                return;
            }
            await setDoc(
                doc(db, "kloner_users", user.uid, "kloner_renders", rid),
                {
                    url: targetUrl || null,
                    urlHash: targetUrl ? hash64(targetUrl) : null,
                    html: payload.html,
                    nameHint: payload.meta?.nameHint || (targetUrl ? new URL(targetUrl).hostname : null),
                    version: payload.version || 1,
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );
            push("Draft updated", "ok");
            await refreshRenders();
        },
        [user, activeRenderId, targetUrl, editorRefImg, refreshRenders, push]
    );

    /* rescan current URL (with 60s cooldown + label countdown) */
    const rescan = useCallback(async () => {
        if (!isHttpUrl(targetUrl) || rescanCooldown.active) return;
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
                push("Rescan failed", "err");
            } else {
                push("Rescan started", "ok");
                rescanCooldown.start(60_000);
            }
        } catch (e: any) {
            setErr(e?.message || "Rescan failed.");
            push("Rescan failed", "err");
        } finally {
            setRescanning(false);
        }
    }, [targetUrl, rescanCooldown, push]);

    /* ───────── memoized cards ───────── */
    const RenderCard = useMemo(
        () =>
            memo(function RenderCardInner({ r }: { r: { id: string } & RenderDoc }) {
                const isQueued = r.status === "queued";
                const isFailed = r.status === "failed";
                const disableOpen = isQueued || isFailed;

                // latch "loaded" per render-id; never flip back to true unless html identity changes
                const prevHtmlRef = useRef<string | undefined>(r.html);
                const [frameLoading, setFrameLoading] = useState<boolean>(() => {
                    return !isQueued && !isFailed && !(r.html && r.html.trim().length > 0);
                });

                useEffect(() => {
                    if (prevHtmlRef.current !== r.html) {
                        // new HTML arrived; consider it loading only if it was previously empty -> non-empty handled by onLoad
                        prevHtmlRef.current = r.html;
                        // do not set back to true to avoid flicker; onLoad will clear if needed
                    }
                }, [r.html]);

                useEffect(() => {
                    if (isQueued || isFailed) return;
                    const t = setTimeout(() => setFrameLoading(false), 10000);
                    return () => clearTimeout(t);
                }, [isQueued, isFailed, r.id]);

                const ageMs = Date.now() - tsToMs(r.createdAt);
                const isStaleQueued = isQueued && ageMs > 6 * 60 * 1000;
                const isDeleting = !!deletingRender[r.id];

                return (
                    <div className="relative rounded-xl border border-neutral-200 bg-white p-3 shadow-sm flex flex-col min-w-[300px]">
                        {isDeleting && <CenterSpinner label="Deleting…" />}
                        <div className="text-xs truncate text-neutral-500 mb-2">{r.nameHint || r.key || r.id}</div>
                        <div className="flex-1 overflow-hidden rounded border bg-neutral-50 h-44 relative">
                            {(isQueued || frameLoading) && (
                                <CenterSpinner
                                    label={isQueued ? (isStaleQueued ? "Still queued… Retry available" : "Rendering…") : "Loading…"}
                                />
                            )}
                            {isFailed ? (
                                <div className="absolute inset-0 grid place-items-center">
                                    <div className="text-xs text-red-600 bg-white/90 px-3 py-1.5 rounded border border-red-200">Failed</div>
                                </div>
                            ) : (
                                // After
                                <iframe
                                    title={`r-${r.id}`}
                                    srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline'; font-src data: https:; script-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'none';"><base target="_blank" rel="noopener noreferrer">${r.html}`}
                                    className="w-full h-full"
                                    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock" // ✅ no same-origin
                                    referrerPolicy="no-referrer"
                                    allow="clipboard-read; clipboard-write"
                                    onLoad={() => setFrameLoading(false)}
                                />

                            )}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                            <button
                                onClick={() => continueRender(r.id)}
                                className="rounded-md px-2 py-1 text-[11px] text-white disabled:opacity-50"
                                style={{ backgroundColor: ACCENT }}
                                disabled={disableOpen || isDeleting}
                                title={isQueued ? "Still rendering" : isFailed ? "Rendering failed" : "Open editor"}
                            >
                                {isQueued ? "Queued" : isFailed ? "Retry" : "Preview / Edit"}
                            </button>
                            {isStaleQueued && r.key ? (
                                <button
                                    onClick={() => buildFromKey(r.key!)}
                                    className="rounded-md px-2 py-1 text-[11px] border border-amber-300 text-amber-700"
                                    title="Retry this render"
                                    disabled={isDeleting}
                                >
                                    Retry render
                                </button>
                            ) : null}
                            <button
                                onClick={() => discardRender(r.id)}
                                className="rounded-md px-2 py-1 text-[11px] border text-red-600 border-red-200 disabled:opacity-50"
                                disabled={isDeleting}
                            >
                                {isDeleting ? "Deleting…" : "Discard"}
                            </button>
                            <button
                                onClick={rescan}
                                className="rounded-md px-2 py-1 text-[11px] border disabled:opacity-60"
                                disabled={rescanning || rescanCooldown.active || !isHttpUrl(targetUrl) || isDeleting}
                                title="Capture a fresh screenshot"
                            >
                                {rescanning ? "Starting…" : rescanCooldown.active ? `Rescan (${rescanCooldown.remaining}s)` : "Rescan"}
                            </button>
                            <span className="ml-auto text-[11px] text-neutral-500">{isStaleQueued ? "stale" : r.status}</span>
                        </div>
                    </div>
                );
            },
                // props equality: prevent useless re-renders of the card
                (prev, next) => {
                    const a = prev.r;
                    const b = next.r;
                    return (
                        a.id === b.id &&
                        a.status === b.status &&
                        (a.html || "") === (b.html || "") &&
                        (a.key || "") === (b.key || "") &&
                        (a.nameHint || "") === (b.nameHint || "")
                    );
                }),
        [continueRender, buildFromKey, discardRender, rescan, rescanning, rescanCooldown.active, rescanCooldown.remaining, targetUrl, deletingRender]
    );

    const ShotCard = useMemo(
        () =>
            memo(function ShotCardInner({ s, locked }: { s: Shot; locked: boolean }) {
                const [imgLoading, setImgLoading] = useState<boolean>(true);
                const isDeleting = !!deletingByKey[s.path];
                const showOverlay = locked || imgLoading || isDeleting;
                return (
                    <figure className="relative rounded-xl border border-neutral-200 bg-white shadow-sm flex flex-col">
                        {isDeleting && <CenterSpinner label="Deleting…" />}
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
                                    <button
                                        onClick={() => buildFromKey(s.path)}
                                        disabled={locked || isDeleting}
                                        aria-busy={locked}
                                        className="shrink-0 rounded-md px-2 py-1 text-[11px] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                        style={{ backgroundColor: ACCENT }}
                                        title="Generate editable preview from this screenshot"
                                    >
                                        {locked ? "In progress" : "Generate preview"}
                                    </button>
                                    <button
                                        onClick={() => discardShot(s)}
                                        disabled={locked || isDeleting}
                                        className="shrink-0 rounded-md px-2 py-1 text-[11px] border border-red-200 text-red-600 disabled:opacity-50"
                                        title="Delete screenshot and all associated previews"
                                    >
                                        {isDeleting ? "Deleting…" : "Discard"}
                                    </button>
                                </div>
                            </div>
                        </figcaption>
                    </figure>
                );
            },
                (prev, next) => prev.locked === next.locked && prev.s.path === next.s.path && prev.s.url === next.s.url && prev.s.fileName === next.s.fileName),
        [buildFromKey, discardShot, deletingByKey]
    );

    /* ───────── render ───────── */
    return (
        <main className="min-h-screen bg-white">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-8">
                {/* URL selector row */}
                <div className="mb-5">
                    <div className="flex items-center justify-between">
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-900">Preview</h1>
                        <a
                            href="/dashboard"
                            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                        >
                            Dashboard
                        </a>
                    </div>

                    <div className="mt-3">
                        {urlsLoading ? (
                            <div className="h-10 rounded-xl bg-neutral-100 animate-pulse" />
                        ) : urls.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
                                Add a URL from Dashboard to get started.
                            </div>
                        ) : (
                            <div className="flex gap-2 overflow-x-auto py-1">
                                {urls.map((u) => {
                                    const active = targetUrl && normUrl(u.url) === normUrl(targetUrl);
                                    return (
                                        <button
                                            key={u.id}
                                            onClick={() => selectUrl(u.url)}
                                            className={`shrink-0 max-w-[360px] truncate rounded-lg px-3 py-2 text-sm ring-1 ${active ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-800 ring-neutral-200 hover:bg-neutral-50"
                                                }`}
                                            title={u.url}
                                        >
                                            {u.url}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* URL meta + actions */}
                    {targetUrl && (
                        <div className="mt-3 flex items-center gap-2">
                            <span className="text-sm text-neutral-600 break-all">{targetUrl}</span>
                            {docData?.status && (
                                <span className="ml-2 rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                                    {docData.status.toUpperCase()}
                                </span>
                            )}
                            <button
                                onClick={rescan}
                                disabled={rescanning || rescanCooldown.active || !isHttpUrl(targetUrl)}
                                className="ml-auto rounded-lg px-3 py-2 text-sm text-white disabled:opacity-60"
                                style={{ backgroundColor: ACCENT }}
                            >
                                {rescanning ? "Starting…" : rescanCooldown.active ? `Rescan (${rescanCooldown.remaining}s)` : "Rescan"}
                            </button>
                        </div>
                    )}
                </div>

                {err ? (
                    <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
                ) : null}
                {info ? (
                    <div className="mt-2 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">{info}</div>
                ) : null}

                {/* Screenshots grid */}
                <div className="mt-6">
                    {!targetUrl ? (
                        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-6 text-sm text-neutral-700">
                            Choose a URL above to view its screenshots and AI previews.
                        </div>
                    ) : loading ? (
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

                {/* Renders grid */}
                <div className="mt-10">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-neutral-900">Render Sandbox</h2>
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

            <Toasts toasts={toasts} />

            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </main>
    );
}
