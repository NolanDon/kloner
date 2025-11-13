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
    onSnapshot,
    Unsubscribe,
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
import { ref as sRef, listAll, getDownloadURL, deleteObject, type StorageReference } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import PreviewEditor from "@/components/PreviewEditor";
import { Rocket, Plus, ChevronDown, AlertTriangle, Maximize2, Hammer, Eye, HammerIcon } from "lucide-react";

const ACCENT = "#f55f2a";

/* ───────── types ───────── */
type UrlDoc = {
    url: string;
    urlHash?: string;
    screenshotsPrefix?: string;
    screenshotPaths?: string[];
    status?: string;
    createdAt?: any;
    controllerVersion?: string;
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
    controllerVersion?: string | null;
};

/* ───────── utils ───────── */
function isHttpUrl(s?: string): s is string {
    if (!s) return false;
    try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}
function normUrl(s: string): string {
    try { const u = new URL(s); u.hash = ""; return u.toString(); } catch { return s.trim(); }
}
function hash64(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(36);
}
function ensureHttp(u: string): string {
    if (!u) return "";
    return /^https?:\/\//i.test(u) ? u : `https://${u.replace(/^\/+/, "")}`;
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
function extractHashFromKey(key?: string | null): string | null {
    if (!key) return null;
    const file = (key.split("?")[0] || "").split("/").pop() || "";
    const stem = file.replace(/\.(jpe?g|png|webp|gif|bmp|tiff)$/i, "");
    const m = stem.match(/(\d+)$/) || stem.match(/([A-Za-z0-9]+)$/);
    return m ? m[1] || m[0] : null;
}
function shortVersionFromShotPath(
    path: string,
    fallbackHash?: string | null,
    minChars = 4
): string {
    const base = extractHashFromKey(path) || fallbackHash || "";
    if (!base) return "v";
    const digitTail = (base.match(/(\d+)$/) || [])[1] || "";
    if (digitTail.length >= minChars) return digitTail.slice(-minChars);
    const token = base.replace(/[^A-Za-z0-9]/g, "");
    if (token.length >= minChars) return token.slice(-minChars);
    return token || "v";
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
        if (until <= Date.now()) return;
        const t = setInterval(() => {
            setNow(Date.now());
            if (Date.now() >= until) clearInterval(t);
        }, 500);
        return () => clearInterval(t);
    }, [until]);
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
            <div className="flex items-center gap-2 rounded border px-3 py-1.5 text-xs text-neutral-800 bg-white" role="status" aria-live="polite">
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

/* ───────── shallow equality ───────── */
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

/* ───────── ghost action card ───────── */
const GhostActionCard = memo(function GhostActionCard({
    title,
    subtitle,
    onClick,
    disabled,
}: {
    title: string;
    subtitle?: string;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`group relative px-6 flex aspect-[4/3] w-full items-center justify-center rounded-xl border-2 border-dashed bg-white text-center transition ${disabled ? "opacity-60 cursor-not-allowed" : "hover:border-neutral-400"
                }`}
            title={title}
            aria-disabled={disabled}
        >
            <div className="pointer-events-none flex flex-col items-center">
                <div className="grid h-14 w-14 place-items-center rounded-full border border-neutral-200 bg-neutral-50 transition group-hover:scale-105">
                    <Plus className="h-7 w-7 text-neutral-600" />
                </div>
                <div className="mt-3 text-sm font-semibold text-neutral-800">{title}</div>
                {subtitle ? <div className="mt-1 text-xs text-neutral-500">{subtitle}</div> : null}
            </div>
        </button>
    );
});

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

    const [lockUntilByKey, setLockUntilByKey] = useState<Record<string, number>>({});
    const [lockUntilByRender, setLockUntilByRender] = useState<Record<string, number>>({});
    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerIdx, setViewerIdx] = useState(0);

    const [optimisticByKey, setOptimisticByKey] = useState<Record<string, ({ id: string } & RenderDoc)>>({});

    const didAutoSelectRef = useRef(false);

    async function loadShotsForDoc(u: FirebaseUser, targetUrl: string, data: UrlDoc) {
        const prefix = data.screenshotsPrefix || `kloner-screenshots/${u.uid}/${data.urlHash || hash64(targetUrl)}`;
        let fileRefs: StorageReference[] = [];
        if (Array.isArray(data.screenshotPaths) && data.screenshotPaths.length) {
            fileRefs = data.screenshotPaths.map((p) => sRef(storage, p));
        } else {
            fileRefs = await listAllDeep(sRef(storage, prefix));
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
    }

    const openViewer = useCallback((i: number) => {
        setViewerIdx(i);
        setViewerOpen(true);
        try { document.documentElement.style.overflow = "hidden"; } catch { }
    }, []);
    const closeViewer = useCallback(() => {
        setViewerOpen(false);
        try { document.documentElement.style.overflow = ""; } catch { }
    }, []);
    const nextShot = useCallback(() => { if (!shots.length) return; setViewerIdx((i) => (i + 1) % shots.length); }, [shots.length]);
    const prevShot = useCallback(() => { if (!shots.length) return; setViewerIdx((i) => (i - 1 + shots.length) % shots.length); }, [shots.length]);
    useEffect(() => {
        if (!viewerOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeViewer();
            else if (e.key === "ArrowRight") nextShot();
            else if (e.key === "ArrowLeft") prevShot();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [viewerOpen, closeViewer, nextShot, prevShot]);

    async function resolveStorageUrl(pathOrUrl: string): Promise<string> {
        if (!pathOrUrl) return "";
        if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
        try { return await getDownloadURL(sRef(storage, pathOrUrl)); } catch { return ""; }
    }
    function useResolvedImg(pathOrUrl: string) {
        const [src, setSrc] = React.useState("");
        const retriedRef = React.useRef(false);
        const refresh = React.useCallback(async () => {
            const u = await resolveStorageUrl(pathOrUrl);
            if (u) setSrc(u);
        }, [pathOrUrl]);
        React.useEffect(() => { refresh(); }, [refresh]);
        const onError = React.useCallback(() => {
            if (!retriedRef.current) { retriedRef.current = true; refresh(); }
        }, [refresh]);
        return { src, onError };
    }

    const startHardLock = useCallback((key: string, renderId?: string, ms = 60_000) => {
        const until = Date.now() + ms;
        setLockUntilByKey((m) => ({ ...m, [key]: Math.max(m[key] || 0, until) }));
        if (renderId) setLockUntilByRender((m) => ({ ...m, [renderId]: Math.max(m[renderId] || 0, until) }));
    }, []);

    const rescanCooldown = useCooldown(0);

    const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollStopAt = useRef<number>(0);

    const targetUrl = useMemo(() => {
        const raw = search.get("u");
        if (!raw) return "";
        try { const dec = decodeURIComponent(raw); return normUrl(ensureHttp(dec)); } catch { return normUrl(ensureHttp(raw)); }
    }, [search]);

    const [urlMenuOpen, setUrlMenuOpen] = useState(false);
    const urlMenuRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            if (!urlMenuRef.current) return;
            if (!urlMenuRef.current.contains(e.target as Node)) setUrlMenuOpen(false);
        }
        document.addEventListener("click", onDocClick);
        return () => document.removeEventListener("click", onDocClick);
    }, []);

    const activeUrlDoc = useMemo(() => {
        if (!urls.length) return null;
        const match = targetUrl ? urls.find((u) => normUrl(u.url) === normUrl(targetUrl)) : null;
        return match ?? urls[0];
    }, [urls, targetUrl]);

    const orderedUrls = useMemo(() => {
        if (!activeUrlDoc) return [];
        const rest = urls.filter((u) => u.id !== activeUrlDoc.id);
        return [activeUrlDoc, ...rest];
    }, [urls, activeUrlDoc]);

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
            if (!user) { setUrls([]); setUrlsLoading(false); return; }
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
        let unsubUrlDoc: Unsubscribe | null = null;
        (async () => {
            setErr(""); setInfo(""); setLoading(true);
            setDocSnap(null); setDocData(null); setShots([]);

            if (!user || !targetUrl) { setLoading(false); return; }
            if (!isHttpUrl(targetUrl)) { setErr("Invalid URL."); setLoading(false); return; }

            try {
                const qy = query(
                    collection(db, "kloner_users", user.uid, "kloner_urls"),
                    where("url", "==", targetUrl)
                );
                const snap = await getDocs(qy);
                if (snap.empty) { setErr("No record for this URL under your account."); setLoading(false); return; }
                const first = snap.docs[0];
                setDocSnap(first);
                const initial = (first.data() || {}) as UrlDoc;
                setDocData(initial);
                await loadShotsForDoc(user, targetUrl, initial);

                unsubUrlDoc = onSnapshot(first.ref, async (fresh) => {
                    const data = (fresh.data() || {}) as UrlDoc;
                    setDocData(data);
                    await loadShotsForDoc(user, targetUrl, data);
                });
            } catch (e: any) {
                setErr(e?.message || "Failed to load screenshots.");
            } finally {
                setLoading(false);
            }
        })();
        return () => { unsubUrlDoc?.(); };
    }, [user, targetUrl]);

    /* renders list filtered to selected URL */
    const refreshRenders = useCallback(async () => {
        if (!user) return;
        if (!targetUrl || !isHttpUrl(targetUrl)) { setRenders((prev) => (prev.length ? [] : prev)); return; }
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

            const now = Date.now();
            for (const r of filtered) {
                const key = r.key || "";
                if (key && lockUntilByKey[key] && lockUntilByKey[key] > now) {
                    setLockUntilByRender((m) => ({ ...m, [r.id]: Math.max(m[r.id] || 0, lockUntilByKey[key]) }));
                }
            }

            const withOptimistic = [...filtered];
            for (const [k, opt] of Object.entries(optimisticByKey)) {
                const exists = filtered.some((r) => r.key === k);
                if (!exists) withOptimistic.unshift(opt);
                else {
                    setOptimisticByKey((m) => { const n = { ...m }; delete n[k]; return n; });
                }
            }

            setRenders((prev) => (rendersEqual(prev, withOptimistic) ? prev : withOptimistic));

            const anyQueued = withOptimistic.some((r) => r.status === "queued");
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
                withOptimistic.forEach((r) => {
                    if (r.key && (r.status === "ready" || r.status === "failed")) {
                        delete next[r.key];
                        setOptimisticByKey((m) => {
                            if (!m[r.key!]) return m;
                            const n = { ...m };
                            delete n[r.key!];
                            return n;
                        });
                    }
                });
                return next;
            });
        } finally {
            setLoadingRenders(false);
        }
    }, [user, targetUrl, targetHash, optimisticByKey, lockUntilByKey]);

    useEffect(() => {
        if (!user || !targetUrl || !isHttpUrl(targetUrl)) { setRenders([]); return; }
        const base = collection(db, "kloner_users", user.uid, "kloner_renders");
        const qs = query(base, where("archived", "in", [false, null]), orderBy("createdAt", "desc"), limit(100));
        const unsub = onSnapshot(qs, (snap) => {
            const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as RenderDoc) }));
            const filtered = all.filter((r) => {
                const byUrl = (r.url || "") === targetUrl;
                const byHash = !!targetHash && r.urlHash === targetHash;
                const byKeyHash = !!targetHash && extractHashFromKey(r.key) === targetHash;
                return byUrl || byHash || byKeyHash;
            });
            const now = Date.now();
            for (const r of filtered) {
                const key = r.key || "";
                if (key && lockUntilByKey[key] && lockUntilByKey[key] > now) {
                    setLockUntilByRender((m) => ({ ...m, [r.id]: Math.max(m[r.id] || 0, lockUntilByKey[key]) }));
                }
            }
            const withOptimistic = [...filtered];
            for (const [k, opt] of Object.entries(optimisticByKey)) {
                const exists = filtered.some((r) => r.key === k);
                if (!exists) withOptimistic.unshift(opt);
                else {
                    setOptimisticByKey((m) => { const n = { ...m }; delete n[k]; return n; });
                }
            }
            setRenders((prev) => (rendersEqual(prev, withOptimistic) ? prev : withOptimistic));
            setPendingByKey((prev) => {
                const next = { ...prev };
                withOptimistic.forEach((r) => {
                    if (r.key && (r.status === "ready" || r.status === "failed")) {
                        delete next[r.key];
                        setOptimisticByKey((m) => {
                            if (!m[r.key!]) return m;
                            const n = { ...m };
                            delete n[r.key!];
                            return n;
                        });
                    }
                });
                return next;
            });
        });
        return () => unsub();
    }, [user, targetUrl, targetHash, optimisticByKey, lockUntilByKey]);

    const selectUrl = useCallback(
        (u: string) => {
            const next = ensureHttp(u.trim());
            if (!next) return;
            router.push(`/dashboard/view?u=${encodeURIComponent(next)}`, { scroll: false });
        },
        [router]
    );

    const buildFromKey = useCallback(
        async (storageKey: string) => {
            if (!user) return;
            const alreadyQueued = renders.find((r) => r.key === storageKey && r.status === "queued" && !r.archived);
            if (alreadyQueued || pendingByKey[storageKey]) return;
            if (!window.confirm("Generate an editable preview from this screenshot?")) return;

            const optimisticId = `local_${hash64(`${user.uid}|${storageKey}|${Date.now()}`)}`;
            const optimistic: { id: string } & RenderDoc = {
                id: optimisticId,
                key: storageKey,
                referenceImage: null,
                html: "",
                status: "queued",
                url: targetUrl || null,
                urlHash: targetUrl ? hash64(targetUrl) : null,
                nameHint: targetUrl ? new URL(targetUrl).hostname : null,
                model: null,
                archived: false,
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
                controllerVersion: null,
            } as any;

            startHardLock(storageKey, optimisticId, 60_000);
            setRenders((prev) => [optimistic, ...prev]);
            setOptimisticByKey((m) => ({ ...m, [storageKey]: optimistic }));
            setPendingByKey((m) => ({ ...m, [storageKey]: true }));
            setErr("");
            setInfo("Preview queued.");

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
                    push("Server accepted preview job", "ok");
                    await refreshRenders();
                    return;
                }
                if (!r.ok || !j?.ok) throw new Error(j?.error || "Render failed");
                await refreshRenders();
            } catch (e: any) {
                setRenders((prev) => prev.map((r) => (r.id === optimisticId ? { ...r, status: "failed" } : r)));
                setOptimisticByKey((m) => {
                    const v = m[storageKey];
                    if (!v) return m;
                    return { ...m, [storageKey]: { ...v, status: "failed" } };
                });
                setErr(e?.message || "Failed to start preview.");
                push("Preview failed to start", "err");
            }
        },
        [user, targetUrl, renders, refreshRenders, push, startHardLock, pendingByKey]
    );

    const continueRender = useCallback(
        async (renderId: string) => {
            if (!user) return;
            setErr("");
            setLoading(true);
            const dref = doc(db, "kloner_users", user.uid, "kloner_renders", renderId);
            const snap = await getDoc(dref);
            if (!snap.exists()) { setErr("Preview not found."); push("Preview not found", "err"); return; }
            const data = snap.data() as RenderDoc;
            let refSrc =
                (data.referenceImage && (await resolveStorageUrl(data.referenceImage))) ||
                (data.key && (await resolveStorageUrl(data.key))) ||
                "";
            if (!refSrc) {
                const byKey = data.key ? shots.find((s) => s.path === data.key) : undefined;
                refSrc = byKey?.url || shots[0]?.url || "";
            }
            setEditorHtml(data.html || "");
            setEditorRefImg(refSrc);
            setActiveRenderId(renderId);
            setEditorOpen(true);
            setLoading(false);
        },
        [user, push, shots]
    );

    const discardRender = useCallback(
        async (renderId: string) => {
            if (!user) return;
            const ok = window.confirm("Discard this editable preview?");
            if (!ok) return;
            setDeletingRender((m) => ({ ...m, [renderId]: true }));
            try {
                await deleteDoc(doc(db, "kloner_users", user.uid, "kloner_renders", renderId));
                setRenders((prev) => prev.filter((r) => r.id !== renderId));
                push("Preview discarded", "ok");
            } catch (e: any) {
                setErr(e?.message || "Failed to discard preview.");
                push("Failed to discard preview", "err");
            } finally {
                setDeletingRender((m) => { const n = { ...m }; delete n[renderId]; return n; });
            }
        },
        [user, push]
    );

    const discardShot = useCallback(
        async (shot: Shot) => {
            if (!user || !docSnap) return;
            const ok = window.confirm("Delete this screenshot and all its previews?");
            if (!ok) return;
            setErr("");
            setDeletingByKey((m) => ({ ...m, [shot.path]: true }));
            try {
                await deleteObject(sRef(storage, shot.path)).catch(() => { });
                const rCol = collection(db, "kloner_users", user.uid, "kloner_renders");
                const rSnap = await getDocs(query(rCol, where("key", "==", shot.path)));
                if (rSnap.empty === false) await Promise.all(rSnap.docs.map((d) => deleteDoc(d.ref)));
                try {
                    await updateDoc(docSnap.ref, { screenshotPaths: arrayRemove(shot.path), updatedAt: serverTimestamp() } as any);
                } catch { }
                setShots((prev) => prev.filter((s) => s.path !== shot.path));
                setRenders((prev) => prev.filter((r) => r.key !== shot.path));
                setPendingByKey((m) => { const n = { ...m }; delete n[shot.path]; return n; });
                setOptimisticByKey((m) => { const n = { ...m }; delete n[shot.path]; return n; });
                push("Screenshot deleted", "ok");
            } catch (e: any) {
                setErr(e?.message || "Failed to delete screenshot.");
                push("Failed to delete screenshot", "err");
            } finally {
                setDeletingByKey((m) => { const n = { ...m }; delete n[shot.path]; return n; });
            }
        },
        [user, docSnap, push]
    );

    async function exportToVercel(html: string, name?: string) {
        const r = await fetch("/api/user-deploy", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ html, projectName: name }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.url) {
            push(j?.error || "Vercel deploy failed", "err");
            throw new Error(j?.error || "Vercel deploy failed");
        }
        if (user && activeRenderId) {
            await updateDoc(doc(db, "kloner_users", user.uid, "kloner_renders", activeRenderId), {
                lastExportedAt: serverTimestamp(),
            });
        }
        navigator.clipboard?.writeText(j.url).catch(() => void 0);
        push("Deployed. URL copied.", "ok");
        await refreshRenders();
    }

    const saveDraft = useCallback(
        async (payload: { draftId?: string; html: string; meta: { nameHint?: string; device: string; mode: string }; version: number }) => {
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
                    referenceImage: editorRefImg || null,
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

    const shotsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    function beginShortShotsPoll(prefix: string) {
        if (shotsPollRef.current) { clearInterval(shotsPollRef.current); shotsPollRef.current = null; }
        const deadline = Date.now() + 60_000;
        shotsPollRef.current = setInterval(async () => {
            if (!user) return;
            try {
                const refs = await listAllDeep(sRef(storage, prefix));
                const map = new Map(refs.map(r => [r.fullPath, r]));
                const newOnes = Array.from(map.keys()).filter(p => !shots.some(s => s.path === p));
                if (newOnes.length) {
                    const added = await Promise.all(newOnes.map(async (p) => {
                        const r = map.get(p)!; const url = await getDownloadURL(r);
                        const name = r.name || r.fullPath.split("/").pop() || "image";
                        return { path: r.fullPath, url, fileName: name } as Shot;
                    }));
                    setShots(prev => [...added, ...prev].sort((a, b) => (a.fileName < b.fileName ? 1 : a.fileName > b.fileName ? -1 : 0)));
                    clearInterval(shotsPollRef.current!); shotsPollRef.current = null;
                }
            } finally {
                if (Date.now() > deadline && shotsPollRef.current) {
                    clearInterval(shotsPollRef.current); shotsPollRef.current = null;
                }
            }
        }, 3000);
    }
    useEffect(() => () => { if (shotsPollRef.current) clearInterval(shotsPollRef.current); }, []);

    const rescan = useCallback(async () => {
        if (!isHttpUrl(targetUrl) || rescanCooldown.active || !user || !docData) return;
        if (!window.confirm("Rescan this URL now? This queues a fresh screenshot.")) return;
        setRescanning(true); setErr("");
        try {
            const r = await fetch("/api/private/generate", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ url: targetUrl }) });
            if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                setErr(j?.error || "Rescan failed."); push("Rescan failed", "err");
            } else {
                push("Rescan started", "ok");
                rescanCooldown.start(60_000);
                const prefix = docData.screenshotsPrefix || `kloner-screenshots/${user.uid}/${docData.urlHash || hash64(targetUrl)}`;
                beginShortShotsPoll(prefix);
            }
        } catch (e: any) {
            setErr(e?.message || "Rescan failed."); push("Rescan failed", "err");
        } finally {
            setRescanning(false);
        }
    }, [targetUrl, user, docData, push, rescanCooldown]);

    useEffect(() => {
        if (didAutoSelectRef.current) return;
        if (!urlsLoading && !targetUrl && urls.length > 0) {
            didAutoSelectRef.current = true;
            const first = ensureHttp(urls[0].url);
            router.replace(`/dashboard/view?u=${encodeURIComponent(first)}`, { scroll: false });
        }
    }, [urlsLoading, targetUrl, urls, router]);


    /* ───────── cards ───────── */
    const RenderCard = useMemo(
        () =>
            memo(
                function RenderCardInner({ r }: { r: { id: string } & RenderDoc }) {
                    const isQueued = r.status === "queued";
                    const isFailed = r.status === "failed";
                    const isDeleting = !!deletingRender[r.id];
                    const isOpening = loading;

                    const prevHtmlRef = useRef<string | undefined>(undefined);
                    const [srcDoc, setSrcDoc] = useState<string>("");
                    useEffect(() => {
                        if (prevHtmlRef.current === r.html) return;
                        prevHtmlRef.current = r.html;
                        const safeHtml = (r.html || "").trim();
                        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline'; font-src data: https:; script-src 'unsafe-inline'; connect-src 'none';">`;
                        const base = r.html ? `<base target="_blank" rel="noopener noreferrer">` : "";
                        setSrcDoc(`${csp}${base}${safeHtml}`);
                    }, [r.html]);

                    const hardLocked = !!lockUntilByRender[r.id] && lockUntilByRender[r.id] > Date.now();
                    const disableOpen = isOpening || isQueued || isFailed || hardLocked;

                    const { src: refImgUrl, onError: refImgErr } = useResolvedImg(r.key || "");
                    const versionLabel = shortVersionFromShotPath(r.key ?? "", (docData?.urlHash as string | undefined) ?? null);

                    const deployThis = async () => {
                        if (!r.html?.trim()) return;
                        const ok = window.confirm("Deploy this preview to Vercel?");
                        if (!ok) return;
                        try { await exportToVercel(r.html!, r.nameHint || undefined); } catch { }
                    };

                    return (
                        <>
                            <div className="relative flex min-w-[300px] flex-col overflow-visible rounded-xl border border-neutral-200 bg-white shadow-sm">
                                <span className="absolute left-2 top-2 z-30 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white shadow" style={{ backgroundColor: "#1d4ed8" }} title={`Version ${versionLabel}`}>
                                    {versionLabel}
                                </span>

                                <button
                                    onClick={() => discardRender(r.id)}
                                    disabled={isDeleting}
                                    aria-label="Discard preview"
                                    title="Delete this editable preview"
                                    className="absolute top-0 right-0 z-40 grid h-5 w-5 place-items-center -translate-y-1/2 translate-x-1/2 rounded-full bg-red-600 text-white shadow-md ring-1 ring-white hover:bg-red-700 hover:ring-red-300 disabled:opacity-50"
                                >
                                    <span className="text-lg mb-0.5 leading-none">×</span>
                                </button>

                                <div className="relative">
                                    {!refImgUrl ? (
                                        <div className="aspect-[4/3] w-full grid place-items-center text-xs text-neutral-500">No snapshot available</div>
                                    ) : (
                                        <a href={refImgUrl} target="_blank" rel="noreferrer" className="block" title="Open the base screenshot">
                                            <img
                                                src={refImgUrl}
                                                alt={r.nameHint || "preview"}
                                                loading="lazy"
                                                onError={refImgErr}
                                                className="h-full w-full max-h-[260px] object-cover opacity-[0.25] select-none pointer-events-none"
                                                draggable={false}
                                            />
                                        </a>
                                    )}

                                    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                                        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-white/90 p-2 ring-1 ring-neutral-200 backdrop-blur">
                                            <button
                                                onClick={() => continueRender(r.id)}
                                                disabled={disableOpen || isDeleting}
                                                className="rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                                style={{ backgroundColor: ACCENT }}
                                                title={isQueued ? "Still building preview" : isFailed ? "Open editor to fix" : "Open editor to customize"}
                                            >
                                                {isQueued ? "Queued" : isFailed ? "Customize (fix)" : "Customize"}
                                            </button>

                                            <button
                                                onClick={deployThis}
                                                disabled={!r.html || isDeleting || isQueued}
                                                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 disabled:opacity-50 relative inline-flex items-center gap-2"
                                                title="Deploy current HTML to Vercel"
                                            >
                                                Deploy
                                                <Rocket className="h-3 w-3" />
                                            </button>
                                        </div>
                                    </div>

                                    <span className="absolute bottom-2 left-2 z-20 rounded bg-white/90 px-2 py-0.5 text-[10px] font-medium text-neutral-600 ring-1 ring-neutral-200" title="Preview status label">
                                        {isFailed ? "Failed" : r.html?.trim() ? "Preview ready" : "Awaiting HTML"}
                                    </span>
                                    <span className="absolute bottom-2 right-2 z-20 rounded bg-white/90 px-2 py-0.5 text-[10px] font-medium text-neutral-600 ring-1 ring-neutral-200">
                                        {r.status}
                                    </span>

                                    {isDeleting && <CenterSpinner label="Deleting…" />}
                                    {(isQueued || hardLocked) && <CenterSpinner label={isQueued ? "Rendering…" : "Locked…"} />}
                                </div>

                                <div className="relative h-0 overflow-hidden" aria-hidden>
                                    <iframe title={`r-${r.id}`} className="w-full h-0" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock" referrerPolicy="no-referrer" allow="clipboard-read; clipboard-write" key={`frame-${r.id}`} srcDoc={srcDoc} />
                                </div>


                            </div>
                        </>
                    );
                },
                (prev, next) => {
                    const a = prev.r;
                    const b = next.r;
                    return a.id === b.id && a.status === b.status && (a.html || "") === (b.html || "") && (a.key || "") === (b.key || "") && (a.nameHint || "") === (b.nameHint || "");
                }
            ),
        [continueRender, discardRender, deletingRender, docData?.controllerVersion, exportToVercel]
    );

    const ShotCard = useMemo(
        () =>
            memo(
                function ShotCardInner({
                    s, locked, index, onView
                }: { s: Shot; locked: boolean; index: number; onView: (i: number) => void }) {
                    const [imgLoading, setImgLoading] = useState<boolean>(true);
                    const isDeleting = !!deletingByKey[s.path];
                    const hardLocked = (lockUntilByKey[s.path] || 0) > Date.now();
                    const showOverlay = locked || imgLoading || hardLocked || isDeleting;
                    const versionLabel = shortVersionFromShotPath(s.path, (docData?.urlHash as string | undefined) ?? null);

                    return (
                        <figure className="relative rounded-xl border border-neutral-200 bg-white shadow-sm flex flex-col">
                            {/* version badge */}
                            <span
                                className="absolute top-2 left-2 z-10 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
                                style={{ backgroundColor: "#1d4ed8" }}
                                title={`Version ${versionLabel}`}
                            >
                                {versionLabel}
                            </span>

                            {/* NEW: top-right discard "X" */}
                            <button
                                onClick={() => discardShot(s)}
                                disabled={locked || isDeleting}
                                aria-label="Discard screenshot"
                                title="Delete this screenshot and all previews from it"
                                className="absolute top-0 right-0 z-40 grid h-5 w-5 place-items-center -translate-y-1/2 translate-x-1/2 rounded-full bg-red-600 text-white shadow-md ring-1 ring-white hover:bg-red-700 hover:ring-red-300 disabled:opacity-50"
                            >
                                <span className="text-lg mb-0.5 leading-none">×</span>
                            </button>

                            {isDeleting && <CenterSpinner label="Deleting…" />}

                            <a href={s.url} target="_blank" rel="noreferrer" className="block" title="Open full-size screenshot">
                                <div className="w-full aspect-[4/3] bg-neutral-50 flex items-center justify-center rounded-t-xl relative">
                                    <img
                                        src={s.url}
                                        alt={s.fileName}
                                        className={`h-full w-full object-cover ${locked ? "opacity-60" : ""}`}
                                        loading="lazy"
                                        onLoad={() => setImgLoading(false)}
                                        onError={() => setImgLoading(false)}
                                    />
                                    {showOverlay && <CenterSpinner label={locked ? "Queued preview…" : "Loading…"} />}
                                </div>
                            </a>

                            <figcaption className="px-3 py-2 text-xs text-neutral-700 rounded-b-xl">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => onView(index)}
                                            className="shrink-0 rounded-md px-2 py-1 text-[14px] border border-neutral-200 text-neutral-800 hover:bg-neutral-50 inline-flex items-center gap-1.5"
                                            title="View full-screen"
                                        >
                                            <Eye className="h-3 w-3 opacity-90" aria-hidden />
                                            <span>View</span>
                                        </button>
                                    </div>

                                    <div className="ml-auto flex items-center gap-2">
                                        <button
                                            onClick={() => buildFromKey(s.path)}
                                            disabled={locked || isDeleting}
                                            aria-busy={locked}
                                            className="shrink-0 rounded-md px-2 py-1 text-[14px] text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                                            style={{ backgroundColor: ACCENT }}
                                            title="Create editable preview from this screenshot"
                                        >
                                            <span>{locked ? "In progress" : "Generate preview"}</span>
                                            <Hammer className={`h-4 w-4 ${locked ? "animate-pulse" : ""}`} aria-hidden />
                                        </button>
                                    </div>
                                </div>
                            </figcaption>
                        </figure>
                    );
                },
                (prev, next) =>
                    prev.locked === next.locked &&
                    prev.s.path === next.s.path &&
                    prev.s.url === next.s.url &&
                    prev.s.fileName === next.s.fileName
            ),
        [buildFromKey, discardShot, deletingByKey, lockUntilByKey, docData?.urlHash]
    );

    /* ───────── render ───────── */
    return (
        <main className="min-h-screen bg-white">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-8">
                <div className="mb-5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-700">Preview Builder</h1>
                            {/* <p className="mt-1 text-sm text-neutral-600">
                                Flow: Step 1 — Select URL. Step 2 — Generate base screenshot. Step 3 — Generate editable preview. Step 4 — Customize and Deploy.
                            </p> */}
                        </div>
                        {/* <div className="flex items-center gap-2">
                            <a
                                href="/api/vercel/oauth/start"
                                className="rounded-lg border border-neutral-200 bg-[--accent] px-3 py-2 text-sm text-white"
                                style={{ background: ACCENT }}
                                title="Connect your Vercel account to enable Deploy"
                            >
                                Connect Vercel
                            </a>
                        </div> */}
                    </div>

                    <div className="mt-3">
                        {urlsLoading ? (
                            <div className="h-10 rounded-xl bg-neutral-100 animate-pulse" />
                        ) : urls.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-700 my-4">
                                <strong className="text-accent">Step 1</strong> — Add a URL in Dashboard. Return here to capture screenshots and build previews.
                            </div>
                        ) : (
                            <div className="relative inline-block" ref={urlMenuRef}>
                                <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-700 my-4">
                                    <strong className="text-accent">Step 1</strong> — Select a URL
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setUrlMenuOpen((v) => !v)}
                                    className="inline-flex max-w-[540px] items-center gap-2 truncate rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
                                    title={activeUrlDoc?.url}
                                    aria-haspopup="listbox"
                                    aria-expanded={urlMenuOpen}
                                >
                                    <span className="truncate">{activeUrlDoc?.url}</span>
                                    <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500" />
                                </button>

                                {urlMenuOpen && (
                                    <div
                                        role="listbox"
                                        aria-activedescendant={activeUrlDoc?.id}
                                        className="absolute z-40 mt-2 w-[min(640px,90vw)] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg"
                                    >
                                        <ul className="max-h-[280px] overflow-auto py-1">
                                            {orderedUrls.map((u) => {
                                                const isActive = activeUrlDoc?.id === u.id;
                                                return (
                                                    <li key={u.id}>
                                                        <button
                                                            role="option"
                                                            aria-selected={isActive}
                                                            onClick={() => {
                                                                setUrlMenuOpen(false);
                                                                selectUrl(u.url);
                                                            }}
                                                            title={u.url}
                                                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${isActive ? "bg-neutral-100 text-neutral-700" : "text-neutral-800 hover:bg-neutral-50"
                                                                }`}
                                                        >
                                                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${isActive ? "bg-neutral-800" : "bg-neutral-300"}`} />
                                                            <span className="truncate">{u.url}</span>
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                )}
                                {/* <p className="mt-2 text-xs text-neutral-500">
                                    After selecting, proceed to Step 2 below to capture a fresh screenshot if needed.
                                </p> */}
                            </div>
                        )}
                    </div>
                </div>

                {err ? <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div> : null}
                {info ? <div className="mt-2 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">{info}</div> : null}

                <div className="mt-6">
                    <h2 className="text-1xl sm:text-3xl font-semibold tracking-tight text-neutral-700">
                        Screenshots
                    </h2>
                    <p className="mt-2 text-xs text-neutral-500">
                        These are the original screenshots captured directly from your entered URL.
                    </p>

                    {!targetUrl ? (
                        <>
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-700 my-4">
                                <strong className="text-accent">Step 2</strong> — Below will host your base images.
                            </div>
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-6 my-4 text-sm text-neutral-700">
                                Select a URL above to manage its screenshots and previews.
                            </div>
                        </>
                    ) : loading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-64 rounded-xl bg-neutral-100 animate-pulse" />)}
                        </div>
                    ) : shots.length === 0 ? (
                        <>
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-700 my-4">
                                <strong className="text-accent">Step 2</strong> — The section below will host your base images.
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                <GhostActionCard
                                    title={rescanning ? "Starting…" : rescanCooldown.active ? `Rescan (${rescanCooldown.remaining}s)` : "Generate new base image"}
                                    subtitle="Captures a fresh screenshot for this URL. Safe; does not remove prior versions."
                                    onClick={rescan}
                                    disabled={rescanning || rescanCooldown.active || !isHttpUrl(targetUrl)}
                                />
                            </div>
                        </>

                    ) : (
                        <>

                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-700 my-4">
                                <strong className="text-accent">Step 2</strong> — We’ve captured your initial base image. 

                                {renders.length === 0 && (
                                    <div className="inline-flex mt-1 text-sm pt-5 flex items-center text-neutral-700">
                                        Click Generate preview <Hammer className={`mx-1 h-3 w-3`} /> to generate the first preview.
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {shots.map((s, i) => {
                                    const locked = !!pendingByKey[s.path] || renders.some((r) => r.key === s.path && r.status === "queued" && !r.archived);
                                    return <ShotCard key={s.path} s={s} locked={locked} index={i} onView={openViewer} />;
                                })}
                                <GhostActionCard
                                    title={rescanning ? "Starting…" : rescanCooldown.active ? `Rescan (${rescanCooldown.remaining}s)` : "Add / Rescan"}
                                    subtitle="Capture a fresh screenshot for this page."
                                    onClick={rescan}
                                    disabled={rescanning || rescanCooldown.active || !isHttpUrl(targetUrl)}
                                />
                            </div>
                        </>
                    )}
                </div>

                <div className="mt-10">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-1xl sm:text-3xl font-semibold tracking-tight text-neutral-700">Website Previews</h2>
                        </div>
                    </div>

                    <p className="mt-2 text-xs text-neutral-500">
                        These are the concept sites generated from your chosen snapshot.
                    </p>

                    {renders.length === 0 ? (
                        <>
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-700 my-4">
                                <strong className="text-accent">Step 3</strong> — Website Previews. Customize to edit the HTML. Deploy publishes to Vercel.
                            </div>
                            <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700 my-4">
                                No previews yet. Generate one from a base screenshot above.
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-700 my-4">
                                <strong className="text-accent">Step 3</strong> — Customize edits, then Deploy to publish. Discard removes this preview only.
                            </div>
                            <p className="mt-2 text-xs text-neutral-500">
                                Tip: Reference the original with the version badge
                                <span
                                    className="ml-2 rounded-md px-2 py-1 text-[10px] font-semibold text-white shadow"
                                    style={{ backgroundColor: "#1d4ed8" }}
                                    title={`Version`}
                                >
                                    592f
                                </span>
                            </p>
                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Editable previews list">
                                {renders.map((r) => <RenderCard key={r.id} r={r} />)}
                            </div>
                        </>
                    )}
                </div>

                <div className="mt-10">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-1xl sm:text-3xl font-semibold tracking-tight text-neutral-700">Deployments</h2>
                        </div>
                    </div>
                    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-700 my-4">
                        <strong className="text-accent">Step 4</strong> — Track your deployments, customize and redeploy.
                    </div>
                </div>
            </div>

            {editorOpen && (
                <PreviewEditor
                    initialHtml={editorHtml}
                    sourceImage={editorRefImg}
                    onClose={() => { setEditorOpen(false); setActiveRenderId(undefined); }}
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

            {viewerOpen && shots[viewerIdx] && (
                <div className="fixed inset-0 z-[10000]">
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeViewer} />
                    <div className="absolute inset-0 p-4 sm:p-6 md:p-8 grid place-items-center">
                        <div className="relative w-full h-full max-w-[min(95vw,1400px)]">
                            <div className="absolute top-0 bg-black/70 h-20 left-0 right-0 z-10 flex items-center justify-between gap-2 p-2 sm:p-3">
                                <div className="text-[11px] sm:text-xs text-white/80 truncate">{shots[viewerIdx].fileName}</div>
                                <button onClick={closeViewer} className="rounded-md" style={{ background: ACCENT, color: "#fff", padding: "6px 10px", fontSize: "12px" }}>
                                    Close
                                </button>
                            </div>
                            <div className="absolute inset-0 mt-8 mb-8 overflow-auto rounded-lg ring-1 ring-white/10 bg-black/40">
                                <div className="min-h-full w-full grid place-items-center p-4">
                                    <img
                                        src={shots[viewerIdx].url}
                                        alt={shots[viewerIdx].fileName}
                                        className="max-w-none"
                                        style={{ width: "auto", height: "auto", maxWidth: "none" }}
                                    />
                                </div>
                            </div>
                            <button
                                onClick={prevShot}
                                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full text-white h-9 w-9 grid place-items-center shadow ring-1 ring-neutral-200"
                                style={{ background: ACCENT }}
                                aria-label="Previous screenshot"
                            >
                                ‹
                            </button>
                            <button
                                onClick={nextShot}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full text-white h-9 w-9 grid place-items-center shadow ring-1 ring-neutral-200"
                                style={{ background: ACCENT }}
                                aria-label="Next screenshot"
                            >
                                ›
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
