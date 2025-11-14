'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import {
    addDoc,
    collection,
    serverTimestamp,
    onSnapshot,
    query,
    orderBy,
    doc,
    deleteDoc,
    updateDoc,
    getDocs,
    where,
    writeBatch,
    type Unsubscribe,
} from 'firebase/firestore';
import {
    ref as sRef,
    listAll,
    deleteObject,
    getDownloadURL,
    type ListResult,
} from 'firebase/storage';
import { auth, db, storage } from '@/lib/firebase';
import { CheckCircle2, Clock3, AlertTriangle, Loader2 } from 'lucide-react';

const ACCENT = '#f55f2a';

type UrlStatusRaw =
    | 'queued'
    | 'uploaded'
    | 'done'
    | 'ready'
    | 'in_progress'
    | 'error'
    | 'stale'
    | 'unknown';

type UrlStatusUi =
    | 'queued'
    | 'processing'
    | 'ready'
    | 'stale'
    | 'error'
    | 'unknown';

interface UrlDoc {
    url: string;
    urlHash?: string;
    createdAt?: any;
    updatedAt?: any;
    lastAttemptAt?: any;
    status?: UrlStatusRaw | UrlStatusUi;
    screenshotsPrefix?: string;
    screenshotPaths?: string[];
    screenshots?: any[];
    attemptCount?: number;
    lastError?: string | null;
    retry?: boolean;
    id?: string;
}

interface UrlFormProps {
    uid: string;
    onAdded?: () => void;
}
interface UrlRowProps {
    uid: string;
    r: UrlDoc & { id: string };
}

function isHttpUrl(s: string): s is string {
    try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}
function normUrl(s: string): string {
    try {
        const u = new URL(s);
        u.hash = '';
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

function normalizeUrlStatus(
    raw?: UrlStatusRaw | UrlStatusUi,
    shotCount?: number,
    updatedAt?: any
): UrlStatusUi {
    const s = (raw || 'unknown').toLowerCase() as UrlStatusRaw | UrlStatusUi;

    if (s === 'stale') return 'stale';
    if (s === 'error') return 'error';
    if (s === 'uploaded' || s === 'done' || s === 'ready') return 'ready';
    if (s === 'in_progress' || s === 'processing') return 'processing';

    if (s === 'queued') {
        const STALE_MIN_MS = 6 * 60 * 1000;
        const ts =
            typeof updatedAt?.toMillis === 'function'
                ? updatedAt.toMillis()
                : Date.parse(updatedAt || '');
        if (Number.isFinite(ts) && Date.now() - ts > STALE_MIN_MS) return 'stale';
        return (shotCount || 0) > 0 ? 'processing' : 'queued';
    }
    return 'unknown';
}

function StatusBadge({ status }: { status: UrlStatusUi }) {
    const base =
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium';
    switch (status) {
        case 'ready':
            return (
                <span
                    className={`${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`}
                    title="Screenshots ready"
                >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Ready
                </span>
            );
        case 'processing':
            return (
                <span
                    className={`${base} bg-amber-50 text-amber-700 ring-1 ring-amber-200`}
                    title="Running"
                >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Processing
                </span>
            );
        case 'queued':
            return (
                <span
                    className={`${base} bg-sky-50 text-sky-700 ring-1 ring-sky-200`}
                    title="Queued"
                >
                    <Clock3 className="h-3.5 w-3.5" />
                    Queued
                </span>
            );
        case 'stale':
            return (
                <span
                    className={`${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200`}
                    title="Timed out or failed"
                >
                    Stale
                </span>
            );
        case 'error':
            return (
                <span
                    className={`${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200`}
                    title="Failed"
                >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Failed
                </span>
            );
        default:
            return (
                <span
                    className={`${base} bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200`}
                >
                    Unknown
                </span>
            );
    }
}

function pickLatestPath(paths: string[]): string | null {
    if (!paths || paths.length === 0) return null;
    const scored = paths.map((p) => {
        const m = p.match(/(\d{10,})\.(?:jpe?g|png|webp)$/i);
        const ts = m ? Number(m[1]) : Number.NaN;
        return { p, ts: Number.isFinite(ts) ? ts : -1 };
    });
    scored.sort((a, b) => b.ts - a.ts);
    return (scored[0]?.p as string) || paths[paths.length - 1] || null;
}

/* shared add+start */
async function addAndStart(uid: string, rawUrl: string) {
    const cleaned = normUrl(rawUrl);
    if (!isHttpUrl(cleaned)) throw new Error('Invalid URL.');
    const urlHash = hash64(cleaned);

    const col = collection(db, 'kloner_users', uid, 'kloner_urls');
    const [byHash, byUrl] = await Promise.all([
        getDocs(query(col, where('urlHash', '==', urlHash))),
        getDocs(query(col, where('url', '==', cleaned))),
    ]);
    const exists = !byHash.empty || !byUrl.empty;

    if (!exists) {
        await addDoc(col, {
            url: cleaned,
            urlHash,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            status: 'queued',
            screenshotsPrefix: `screenshots/${uid}/${urlHash}`,
            screenshotPaths: [],
        } as UrlDoc);
    }

    const r = await fetch('/api/private/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: cleaned }),
    });
    if (!r.ok) {
        const j: any = await r.json().catch(() => ({}));
        throw new Error(j?.error || 'Failed to queue screenshot job.');
    }
    return cleaned;
}

/* form */
function UrlForm({ uid, onAdded }: UrlFormProps) {
    const [url, setUrl] = useState<string>('');
    const [err, setErr] = useState<string>('');
    const [busy, setBusy] = useState<boolean>(false);

    async function handleAdd(e: React.FormEvent) {
        e.preventDefault();
        setErr('');
        try {
            setBusy(true);
            await addAndStart(uid, url);
            onAdded?.();
            setUrl('');
        } catch (e: any) {
            setErr(e?.message || 'Could not start capture.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <form
            onSubmit={(e) => void handleAdd(e)}
            className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-sm"
        >
            <div className="flex flex-col sm:flex-row gap-3">
                <input
                    type="url"
                    placeholder="https://example.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="flex-1 rounded-xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:ring-4"
                    style={{
                        boxShadow: '0 0 0 0 rgba(0,0,0,0)',
                        caretColor: ACCENT,
                        WebkitTapHighlightColor: 'transparent',
                    }}
                />
                <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-medium text-white shadow-sm disabled:opacity-60"
                    style={{ backgroundColor: ACCENT }}
                >
                    {busy ? 'Saving…' : 'Add URL'}
                </button>
            </div>
            {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
            <p className="mt-2 text-xs text-neutral-500">
                We queue a capture and store screenshots under your account.
            </p>
        </form>
    );
}

/* skeleton row */
function UrlRowSkeleton() {
    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-sm animate-pulse">
            <div className="flex items-start gap-3">
                <div className="h-14 w-14 rounded-lg bg-neutral-200" />
                <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="h-3 w-40 rounded bg-neutral-200" />
                        <div className="h-5 w-20 rounded-full bg-neutral-100" />
                    </div>
                    <div className="h-2.5 w-56 rounded bg-neutral-100" />
                    <div className="flex flex-wrap gap-2 justify-end sm:justify-start">
                        <div className="h-8 w-20 rounded-lg bg-neutral-100" />
                        <div className="h-8 w-20 rounded-lg bg-neutral-100" />
                        <div className="h-8 w-20 rounded-lg bg-neutral-100" />
                    </div>
                </div>
            </div>
        </div>
    );
}

/* row */
function UrlRow({ uid, r }: UrlRowProps) {
    const [busy, setBusy] = useState<boolean>(false);
    const [err, setErr] = useState<string>('');

    const uiStatus = normalizeUrlStatus(
        r.status as UrlStatusRaw | UrlStatusUi | undefined,
        r.screenshotPaths?.length,
        r.updatedAt
    );

    const locked = uiStatus === 'processing';

    const [thumbUrl, setThumbUrl] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                let key: string | null = pickLatestPath(r.screenshotPaths || []);
                if (!key && r.screenshotsPrefix) {
                    const folderRef = sRef(storage, r.screenshotsPrefix);
                    const listed: ListResult | null = await listAll(folderRef).catch(
                        () => null
                    );
                    if (listed && listed.items.length > 0) {
                        const items = listed.items
                            .slice()
                            .sort((a, b) => (a.name < b.name ? 1 : -1));
                        key = `${r.screenshotsPrefix}/${items[0].name}`;
                    }
                }
                if (!key) {
                    if (alive) setThumbUrl(null);
                    return;
                }
                const url = await getDownloadURL(sRef(storage, key));
                if (alive) setThumbUrl(url);
            } catch {
                if (alive) setThumbUrl(null);
            }
        })();
        return () => {
            alive = false;
        };
    }, [r.screenshotPaths, r.screenshotsPrefix]);

    async function handleRescanClick() {
        if (busy || locked) return;
        const ok =
            typeof window !== 'undefined'
                ? window.confirm(
                    'Rescan this URL now? This will queue a new capture and may overwrite the latest screenshot.'
                )
                : true;
        if (!ok) return;
        await rescan();
    }

    async function rescan() {
        if (locked) return;
        setErr('');
        setBusy(true);
        try {
            await updateDoc(doc(db, 'kloner_users', uid, 'kloner_urls', r.id), {
                status: 'queued',
                updatedAt: serverTimestamp(),
                lastError: null,
                retry: null,
            } as any);
            const res = await fetch('/api/private/generate', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ url: r.url }),
            });
            if (!res.ok) {
                const j: any = await res.json().catch(() => ({}));
                setErr(j?.error || 'Failed to start capture.');
                await updateDoc(doc(db, 'kloner_users', uid, 'kloner_urls', r.id), {
                    status: 'stale',
                    updatedAt: serverTimestamp(),
                    lastError: j?.error || 'queue_failed',
                    retry: true,
                } as any);
            }
        } catch (e: any) {
            setErr(e?.message || 'Rescan failed.');
            await updateDoc(doc(db, 'kloner_users', uid, 'kloner_urls', r.id), {
                status: 'stale',
                updatedAt: serverTimestamp(),
                lastError: e?.message || 'rescan_exception',
                retry: true,
            } as any);
        } finally {
            setBusy(false);
        }
    }

    async function remove() {
        if (locked) return;
        setErr('');
        setBusy(true);
        try {
            const urlHash = r.urlHash || hash64(r.url);
            const prefix = r.screenshotsPrefix || `screenshots/${uid}/${urlHash}`;

            if (Array.isArray(r.screenshotPaths) && r.screenshotPaths.length > 0) {
                await Promise.allSettled(
                    r.screenshotPaths.map((p) => deleteObject(sRef(storage, p)))
                );
            } else {
                const folderRef = sRef(storage, prefix);
                const listed: ListResult | null = await listAll(folderRef).catch(
                    () => null
                );
                if (listed) {
                    await Promise.allSettled(
                        listed.items.map((it) => deleteObject(it))
                    );
                    await Promise.allSettled(
                        listed.prefixes.map(async (sub) => {
                            const sublist = await listAll(sub);
                            await Promise.allSettled(
                                sublist.items.map((it) => deleteObject(it))
                            );
                        })
                    );
                }
            }

            const rendersCol = collection(db, 'kloner_users', uid, 'kloner_renders');
            const qHash = query(rendersCol, where('urlHash', '==', urlHash));
            const qUrl = query(rendersCol, where('url', '==', r.url));
            const [snapHash, snapUrl] = await Promise.all([
                getDocs(qHash),
                getDocs(qUrl),
            ]);
            const toDeleteIds = new Set<string>();
            snapHash.forEach((d) => toDeleteIds.add(d.id));
            snapUrl.forEach((d) => toDeleteIds.add(d.id));
            if (toDeleteIds.size > 0) {
                const batch = writeBatch(db);
                for (const id of toDeleteIds)
                    batch.delete(doc(db, 'kloner_users', uid, 'kloner_renders', id));
                await batch.commit();
            }

            await deleteDoc(doc(db, 'kloner_users', uid, 'kloner_urls', r.id));
        } catch (e: any) {
            setErr(e?.message || 'Delete failed.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div
            className={`rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-sm relative ${locked ? 'opacity-60' : ''
                }`}
            aria-busy={locked}
            aria-disabled={locked}
        >
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
                {thumbUrl ? (
                    <div className="h-16 w-full sm:w-20 rounded-lg overflow-hidden border border-neutral-200 bg-neutral-100 shrink-0 sm:h-16">
                        <img
                            src={thumbUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            draggable={false}
                        />
                    </div>
                ) : (
                    <div
                        className="h-16 w-full sm:w-20 rounded-lg grid place-items-center text-white font-semibold shrink-0 sm:h-16"
                        style={{ backgroundColor: ACCENT }}
                    >
                        {(r.urlHash ?? hash64(r.url)).slice(0, 2).toUpperCase()}
                    </div>
                )}

                <div className="min-w-0 flex-1 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                        <a
                            href={locked ? undefined : r.url}
                            target={locked ? undefined : '_blank'}
                            rel={locked ? undefined : 'noreferrer'}
                            className={`truncate max-w-full sm:max-w-[70%] text-sm ${locked
                                    ? 'text-neutral-400 pointer-events-none'
                                    : 'text-neutral-800 hover:underline'
                                }`}
                            aria-disabled={locked}
                            tabIndex={locked ? -1 : 0}
                        >
                            {r.url}
                        </a>
                        <StatusBadge status={uiStatus} />
                    </div>

                    {r.lastError && (uiStatus === 'stale' || uiStatus === 'error') ? (
                        <div className="text-xs text-rose-600">
                            Last error: {r.lastError}
                        </div>
                    ) : null}
                    {err ? <div className="text-xs text-red-600">{err}</div> : null}

                    <div className="mt-1 flex flex-wrap gap-2 justify-end sm:justify-start">
                        <button
                            onClick={() => void handleRescanClick()}
                            disabled={busy || locked}
                            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                        >
                            {busy
                                ? 'Working…'
                                : uiStatus === 'stale'
                                    ? 'Retry'
                                    : 'Rescan'}
                        </button>

                        <a
                            href={
                                locked
                                    ? undefined
                                    : `/dashboard/view?u=${encodeURIComponent(r.url)}`
                            }
                            className={`rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs ${locked
                                    ? 'text-neutral-400 pointer-events-none'
                                    : 'text-neutral-700 hover:bg-neutral-50'
                                }`}
                            aria-disabled={locked}
                            tabIndex={locked ? -1 : 0}
                        >
                            Open
                        </a>

                        <button
                            onClick={() => void remove()}
                            disabled={busy || locked}
                            className="rounded-lg px-3 py-1.5 text-xs text-white disabled:opacity-50"
                            style={{ backgroundColor: ACCENT }}
                        >
                            Delete
                        </button>
                    </div>
                </div>
            </div>

            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}

/* main page */
export default function DashboardPage() {
    const router = useRouter();
    const search = useSearchParams();
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [rows, setRows] = useState<Array<UrlDoc & { id: string }>>([]);
    const [rowsLoading, setRowsLoading] = useState<boolean>(true);
    const unsubRef = useRef<Unsubscribe | null>(null);
    const [bootstrapErr, setBootstrapErr] = useState<string>('');

    const addOnceRef = useRef(false);

    useEffect(() => {
        const off = onAuthStateChanged(auth, (u) => {
            if (!u) {
                router.replace('/login?next=/dashboard');
                return;
            }
            setUser(u);
            const qy = query(
                collection(db, 'kloner_users', u.uid, 'kloner_urls'),
                orderBy('createdAt', 'desc')
            );
            unsubRef.current?.();
            unsubRef.current = onSnapshot(
                qy,
                (snap) => {
                    const list = snap.docs.map((d) => ({
                        id: d.id,
                        ...(d.data() as UrlDoc),
                    }));
                    setRows(list);
                    setRowsLoading(false);
                },
                (err) => {
                    setBootstrapErr(err.message || 'Failed to load URLs.');
                    setRowsLoading(false);
                }
            );
        });
        return () => {
            off();
            unsubRef.current?.();
        };
    }, [router]);

    useEffect(() => {
        const u = user;
        if (!u) return;
        if (addOnceRef.current) return;

        const paramUrl = search.get('u');
        if (!paramUrl) return;

        const cleaned = normUrl(paramUrl);
        const key = `kloner:addOnce:${u.uid}:${hash64(cleaned)}`;
        if (typeof window !== 'undefined' && localStorage.getItem(key)) {
            router.replace('/dashboard');
            return;
        }

        addOnceRef.current = true;
        (async () => {
            try {
                await addAndStart(u.uid, paramUrl);
                if (typeof window !== 'undefined') {
                    localStorage.setItem(key, String(Date.now()));
                }
            } catch (e: any) {
                setBootstrapErr(e?.message || 'Failed to add URL.');
            } finally {
                router.replace('/dashboard');
            }
        })();
    }, [search, user, router]);

    return (
        <div className="px-4 sm:px-6 lg:px-10 py-6">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-800">
                Dashboard
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
                Add a URL to capture. We queue screenshots and keep them under your
                account.
            </p>

            {bootstrapErr ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {bootstrapErr}
                </div>
            ) : null}

            <div className="mt-6">
                {user ? <UrlForm uid={user.uid} onAdded={() => { }} /> : null}
            </div>

            <div className="mt-8">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-neutral-700">
                        Tracked URLs
                    </h2>
                    {rows.length > 0 && (
                        <span className="text-xs text-neutral-400">
                            {rows.length} tracked
                        </span>
                    )}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-4">
                    {rowsLoading && rows.length === 0 ? (
                        <>
                            <UrlRowSkeleton />
                            <UrlRowSkeleton />
                            <UrlRowSkeleton />
                        </>
                    ) : rows.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-neutral-500 text-sm">
                            No URLs yet. Add one above to see capture status here.
                        </div>
                    ) : (
                        rows.map((r) => <UrlRow key={r.id} uid={user!.uid} r={r} />)
                    )}
                </div>
            </div>
        </div>
    );
}
