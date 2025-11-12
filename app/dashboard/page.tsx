// app/dashboard/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    onAuthStateChanged,
    type User as FirebaseUser,
} from "firebase/auth";
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
} from "firebase/firestore";
import {
    ref as sRef,
    listAll,
    deleteObject,
    getDownloadURL,
    type ListResult,
} from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import { CheckCircle2, Clock3, AlertTriangle, Loader2 } from "lucide-react";

/* -------------------------------- theme -------------------------------- */
const ACCENT = "#f55f2a";

/* -------------------------------- types -------------------------------- */
type UrlStatusRaw =
    | "queued"
    | "uploaded"
    | "done"
    | "ready"
    | "in_progress"
    | "error"
    | "unknown";

type UrlStatusUi = "queued" | "processing" | "ready" | "error" | "unknown";

interface UrlDoc {
    url: string;
    urlHash?: string;
    createdAt?: any;
    updatedAt?: any;
    status?: UrlStatusRaw | UrlStatusUi;
    screenshotsPrefix?: string;
    screenshotPaths?: string[];
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

/* -------------------------------- utils -------------------------------- */
function isHttpUrl(s: string): s is string {
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

function normalizeUrlStatus(
    raw?: UrlStatusRaw | UrlStatusUi,
    shotCount?: number
): UrlStatusUi {
    const s = (raw || "unknown").toLowerCase() as UrlStatusRaw | UrlStatusUi;

    if (s === "error") return "error";
    if (s === "uploaded" || s === "done" || s === "ready") return "ready";
    if (s === "queued") return (shotCount || 0) > 0 ? "processing" : "queued";
    if (s === "in_progress" || s === "processing") return "processing";
    return "unknown";
}

function StatusBadge({ status }: { status: UrlStatusUi }) {
    const base =
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium";
    switch (status) {
        case "ready":
            return (
                <span
                    className={`${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`}
                    title="Screenshots captured and ready to view"
                >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Ready to view
                </span>
            );
        case "processing":
            return (
                <span
                    className={`${base} bg-amber-50 text-amber-700 ring-1 ring-amber-200`}
                    title="Capture is running"
                >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Processing
                </span>
            );
        case "queued":
            return (
                <span
                    className={`${base} bg-sky-50 text-sky-700 ring-1 ring-sky-200`}
                    title="Queued for capture"
                >
                    <Clock3 className="h-3.5 w-3.5" />
                    Queued
                </span>
            );
        case "error":
            return (
                <span
                    className={`${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200`}
                    title="Capture failed"
                >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Failed
                </span>
            );
        default:
            return (
                <span
                    className={`${base} bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200`}
                    title="Unknown status"
                >
                    Unknown
                </span>
            );
    }
}

/* pick the newest-looking path (filename includes a timestamp suffix) */
function pickLatestPath(paths: string[]): string | null {
    if (!paths || paths.length === 0) return null;
    const scored = paths.map((p) => {
        // try to pull the trailing digits before extension
        const m = p.match(/(\d{10,})\.(?:jpe?g|png|webp)$/i);
        const ts = m ? Number(m[1]) : Number.NaN;
        return { p, ts: Number.isFinite(ts) ? ts : -1 };
    });
    scored.sort((a, b) => b.ts - a.ts);
    return (scored[0]?.p as string) || paths[paths.length - 1] || null;
}

/* ---------------------------------- form --------------------------------- */
function UrlForm({ uid, onAdded }: UrlFormProps) {
    const [url, setUrl] = useState<string>("");
    const [err, setErr] = useState<string>("");
    const [busy, setBusy] = useState<boolean>(false);

    async function handleAdd(e: React.FormEvent) {
        e.preventDefault();
        setErr("");
        const cleaned = normUrl(url);
        if (!isHttpUrl(cleaned)) {
            setErr("Enter a valid http(s) URL.");
            return;
        }
        setBusy(true);
        try {
            const col = collection(db, "kloner_users", uid, "kloner_urls");
            await addDoc(col, {
                url: cleaned,
                urlHash: hash64(cleaned),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                status: "queued",
                screenshotsPrefix: `screenshots/${uid}/${hash64(cleaned)}`,
                screenshotPaths: [],
            } satisfies UrlDoc);

            const r = await fetch("/api/private/generate", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: cleaned }),
            });
            const j: any = await r.json().catch(() => ({}));
            if (!r.ok) {
                setErr(j?.error || "Failed to queue screenshot job.");
            } else {
                onAdded?.();
                setUrl("");
            }
        } catch (e: any) {
            setErr(e?.message || "Could not save URL.");
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
                        boxShadow: "0 0 0 0 rgba(0,0,0,0)",
                        caretColor: ACCENT,
                        WebkitTapHighlightColor: "transparent",
                    }}
                />
                <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-medium text-white shadow-sm disabled:opacity-60"
                    style={{ backgroundColor: ACCENT }}
                >
                    {busy ? "Saving…" : "Add URL"}
                </button>
            </div>
            {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
            <p className="mt-2 text-xs text-neutral-500">
                We’ll queue a capture and store screenshots under your account.
            </p>
        </form>
    );
}

/* --------------------------------- list ---------------------------------- */
function UrlRow({ uid, r }: UrlRowProps) {
    const [busy, setBusy] = useState<boolean>(false);
    const [err, setErr] = useState<string>("");

    const uiStatus = normalizeUrlStatus(
        r.status as UrlStatusRaw | UrlStatusUi | undefined,
        r.screenshotPaths?.length
    );
    const locked = uiStatus === "queued" || uiStatus === "processing";

    // thumbnail
    const [thumbUrl, setThumbUrl] = useState<string | null>(null);
    const [thumbLoading, setThumbLoading] = useState<boolean>(false);
    useEffect(() => {
        let alive = true;
        (async () => {
            setThumbLoading(true);
            try {
                // try from explicit paths first
                let key: string | null = pickLatestPath(r.screenshotPaths || []);
                // fallback: list by prefix if no paths yet but prefix exists
                if (!key && r.screenshotsPrefix) {
                    const folderRef = sRef(storage, r.screenshotsPrefix);
                    const listed: ListResult | null = await listAll(folderRef).catch(
                        () => null
                    );
                    if (listed && listed.items.length > 0) {
                        // pick most recent by item.name (has timestamp)
                        const items = listed.items.slice().sort((a, b) =>
                            a.name < b.name ? 1 : -1
                        );
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
            } finally {
                if (alive) setThumbLoading(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, [r.screenshotPaths, r.screenshotsPrefix]);

    async function rescan() {
        if (locked) return;
        setErr("");
        setBusy(true);
        try {
            await updateDoc(doc(db, "kloner_users", uid, "kloner_urls", r.id), {
                status: "queued",
                updatedAt: serverTimestamp(),
            } as any);
            const res = await fetch("/api/private/generate", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: r.url }),
            });
            if (!res.ok) {
                const j: any = await res.json().catch(() => ({}));
                setErr(j?.error || "Failed to start capture.");
                await updateDoc(doc(db, "kloner_users", uid, "kloner_urls", r.id), {
                    status: "error",
                    updatedAt: serverTimestamp(),
                } as any);
            }
        } catch (e: any) {
            setErr(e?.message || "Rescan failed.");
        } finally {
            setBusy(false);
        }
    }

    async function remove() {
        if (locked) return;
        setErr("");
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
                    await Promise.allSettled(listed.items.map((it) => deleteObject(it)));
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

            const rendersCol = collection(db, "kloner_users", uid, "kloner_renders");
            const qHash = query(rendersCol, where("urlHash", "==", urlHash));
            const qUrl = query(rendersCol, where("url", "==", r.url));
            const [snapHash, snapUrl] = await Promise.all([getDocs(qHash), getDocs(qUrl)]);
            const toDeleteIds = new Set<string>();
            snapHash.forEach((d) => toDeleteIds.add(d.id));
            snapUrl.forEach((d) => toDeleteIds.add(d.id));
            if (toDeleteIds.size > 0) {
                const batch = writeBatch(db);
                for (const id of toDeleteIds) {
                    batch.delete(doc(db, "kloner_users", uid, "kloner_renders", id));
                }
                await batch.commit();
            }

            await deleteDoc(doc(db, "kloner_users", uid, "kloner_urls", r.id));
        } catch (e: any) {
            setErr(e?.message || "Delete failed.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div
            className={`rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-sm relative ${locked ? "opacity-60" : ""
                }`}
            aria-busy={locked}
            aria-disabled={locked}
        >
            {locked && (
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                    <div className="flex items-center gap-2 rounded border px-3 py-1.5 text-xs text-neutral-800 bg-white">
                        <span
                            className="inline-block h-4 w-4 rounded-full border-2 border-neutral-300"
                            style={{ borderTopColor: ACCENT, animation: "spin 0.8s linear infinite" }}
                            aria-hidden
                        />
                        Working…
                    </div>
                </div>
            )}

            <div className="flex items-start gap-3">
                {/* Left: thumbnail or fallback badge */}
                {thumbUrl ? (
                    <div className="h-14 w-14 rounded-lg overflow-hidden border border-neutral-200 bg-neutral-100 shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={thumbUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            draggable={false}
                        />
                    </div>
                ) : (
                    <div
                        className="h-14 w-14 rounded-lg grid place-items-center text-white font-semibold shrink-0"
                        style={{ backgroundColor: ACCENT }}
                    >
                        {(r.urlHash ?? hash64(r.url)).slice(0, 2).toUpperCase()}
                    </div>
                )}

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <a
                            href={locked ? undefined : r.url}
                            target={locked ? undefined : "_blank"}
                            rel={locked ? undefined : "noreferrer"}
                            className={`truncate font-medium ${locked ? "text-neutral-400" : "text-neutral-900 hover:underline"
                                } ${locked ? "pointer-events-none" : ""}`}
                            aria-disabled={locked}
                            tabIndex={locked ? -1 : 0}
                        >
                            {r.url}
                        </a>

                        <StatusBadge status={uiStatus} />
                    </div>

                    {err ? <div className="mt-2 text-sm text-red-600">{err}</div> : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            onClick={() => void rescan()}
                            disabled={busy || locked}
                            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                        >
                            {busy ? "Working…" : "Rescan"}
                        </button>

                        <a
                            href={
                                locked ? undefined : `/dashboard/view?u=${encodeURIComponent(r.url)}`
                            }
                            className={`rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs ${locked
                                    ? "text-neutral-400 pointer-events-none"
                                    : "text-neutral-700 hover:bg-neutral-50"
                                }`}
                            aria-disabled={locked}
                            tabIndex={locked ? -1 : 0}
                        >
                            Open
                        </a>

                        <button
                            onClick={() => void remove()}
                            disabled={busy || locked}
                            className="rounded-lg px-3 py-2 text-xs text-white disabled:opacity-50"
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

/* ------------------------------- main page ------------------------------- */
export default function DashboardPage() {
    const router = useRouter();
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [rows, setRows] = useState<Array<UrlDoc & { id: string }>>([]);
    const unsubRef = useRef<Unsubscribe | null>(null);

    useEffect(() => {
        const off = onAuthStateChanged(auth, (u) => {
            if (!u) {
                router.replace("/login?next=/dashboard");
                return;
            }
            setUser(u);

            const qy = query(
                collection(db, "kloner_users", u.uid, "kloner_urls"),
                orderBy("createdAt", "desc")
            );
            unsubRef.current?.();
            unsubRef.current = onSnapshot(qy, (snap) => {
                const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as UrlDoc) }));
                setRows(list);
            });
        });
        return () => {
            off();
            unsubRef.current?.();
        };
    }, [router]);

    return (
        <div className="px-4 sm:px-6 lg:px-10 py-6">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-900">
                Dashboard
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
                Add a URL to capture. We’ll queue screenshots and keep them under your account.
            </p>

            <div className="mt-6">
                {user ? <UrlForm uid={user.uid} onAdded={() => { }} /> : null}
            </div>

            <div className="mt-8">
                <h2 className="text-sm font-semibold text-neutral-700">Tracked URLs</h2>
                <div className="mt-3 grid grid-cols-1 gap-4">
                    {rows.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-neutral-500">
                            No URLs yet. Add one above.
                        </div>
                    ) : (
                        rows.map((r) => <UrlRow key={r.id} uid={user!.uid} r={r} />)
                    )}
                </div>
            </div>
        </div>
    );
}
