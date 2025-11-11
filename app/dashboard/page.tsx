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
    type ListResult,
} from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";

/* -------------------------------- theme -------------------------------- */
const ACCENT = "#f55f2a";

/* -------------------------------- types -------------------------------- */
type UrlStatus = "queued" | "error" | "done" | "unknown";

interface UrlDoc {
    url: string;
    urlHash?: string;
    createdAt?: any;
    updatedAt?: any;
    status?: UrlStatus;
    screenshotsPrefix?: string;
    screenshotPaths?: string[];
    id?: string; // added at read time
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
/** short non-crypto hash for display/use in prefixes */
function hash64(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(36);
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

    const locked =
        (r.status ?? "unknown") === "queued" &&
        (!Array.isArray(r.screenshotPaths) || r.screenshotPaths.length === 0);

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
                const listed: ListResult | null = await listAll(folderRef).catch(() => null);
                if (listed) {
                    await Promise.allSettled(listed.items.map((it) => deleteObject(it)));
                    await Promise.allSettled(
                        listed.prefixes.map(async (sub) => {
                            const sublist = await listAll(sub);
                            await Promise.allSettled(sublist.items.map((it) => deleteObject(it)));
                        })
                    );
                }
            }

            // cleanup kloner_renders tied to this URL
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
                        Capturing… This process may take a few mins..
                    </div>
                </div>
            )}

            <div className="flex items-start gap-3">
                <div
                    className="h-9 w-9 rounded-lg grid place-items-center text-white font-semibold shrink-0"
                    style={{ backgroundColor: ACCENT }}
                >
                    {(r.urlHash ?? hash64(r.url)).slice(0, 2).toUpperCase()}
                </div>
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
                        <span className="inline-flex items-center rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                            {(r.status ?? "unknown").toUpperCase()}
                        </span>
                    </div>

                    {err ? <div className="mt-2 text-sm text-red-600">{err}</div> : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            onClick={() => void rescan()}
                            disabled={busy || locked}
                            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                        >
                            {busy ? "Working…" : "Rescan"}
                        </button>

                        <a
                            href={locked ? undefined : `/dashboard/view?u=${encodeURIComponent(r.url)}`}
                            className={`rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm ${locked ? "text-neutral-400 pointer-events-none" : "text-neutral-700 hover:bg-neutral-50"
                                }`}
                            aria-disabled={locked}
                            tabIndex={locked ? -1 : 0}
                        >
                            Open
                        </a>

                        <button
                            onClick={() => void remove()}
                            disabled={busy || locked}
                            className="rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
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
                            No URLs yet. Add one above to get started.
                        </div>
                    ) : (
                        rows.map((r) => <UrlRow key={r.id} uid={user!.uid} r={r} />)
                    )}
                </div>
            </div>
        </div>
    );
}
