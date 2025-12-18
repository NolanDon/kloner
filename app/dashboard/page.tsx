// app/dashboard/page.tsx (status badge moved to bottom-right of each card)
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
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
import { CheckCircle2, Clock3, AlertTriangle, Loader2, CrossIcon, DeleteIcon, ArrowRight, AxeIcon } from "lucide-react";

const ACCENT = "#f55f2a";

type UrlStatusRaw =
    | "queued"
    | "uploaded"
    | "done"
    | "ready"
    | "in_progress"
    | "error"
    | "stale"
    | "unknown";

type UrlStatusUi = "queued" | "processing" | "ready" | "stale" | "error" | "unknown";

export interface UrlDoc {
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
    disabled?: boolean;
}
interface UrlRowProps {
    uid: string;
    r: UrlDoc & { id: string };
}

function isHttpUrl(s: string): s is string {
    const raw = (s ?? "").trim();

    // reject obvious garbage early
    if (!raw) return false;
    if (/\s/.test(raw)) return false;            // "status buddy haha"
    if (/[\u0000-\u001F\u007F]/.test(raw)) return false; // control chars
    if (raw.length > 2048) return false;

    // must be absolute http(s)
    if (!/^https?:\/\//i.test(raw)) return false;

    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return false;
    }

    if (u.protocol !== "http:" && u.protocol !== "https:") return false;

    // disallow credentials
    if (u.username || u.password) return false;

    // host must exist and not contain spaces
    if (!u.hostname || /\s/.test(u.hostname)) return false;

    // reject localhost-ish if you want (optional: uncomment)
    // if (u.hostname === "localhost" || u.hostname.endsWith(".local")) return false;

    // must look like a real domain or an IP
    const host = u.hostname;

    const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host.split(".").every(p => {
        const n = Number(p);
        return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === p;
    });

    const isIPv6 = host.includes(":"); // URL.hostname strips brackets; simple check

    const isDomain =
        host.includes(".") &&
        !host.startsWith(".") &&
        !host.endsWith(".") &&
        /^[a-z0-9.-]+$/i.test(host) &&
        host.split(".").every(label =>
            label.length > 0 &&
            label.length <= 63 &&
            !label.startsWith("-") &&
            !label.endsWith("-")
        ) &&
        host.split(".").at(-1)!.length >= 2;

    if (!(isIPv4 || isIPv6 || isDomain)) return false;

    return true;
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

function ensureProtocol(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

function normalizeUrlStatus(
    raw?: UrlStatusRaw | UrlStatusUi,
    shotCount?: number,
    updatedAt?: any
): UrlStatusUi {
    const s = (raw || "unknown").toLowerCase() as UrlStatusRaw | UrlStatusUi;

    if (s === "stale") return "stale";
    if (s === "error") return "error";
    if (s === "uploaded" || s === "done" || s === "ready") return "ready";
    if (s === "in_progress" || s === "processing") return "processing";

    if (s === "queued") {
        const STALE_MIN_MS = 6 * 60 * 1000;
        const ts =
            typeof updatedAt?.toMillis === "function"
                ? updatedAt.toMillis()
                : Date.parse(updatedAt || "");
        if (Number.isFinite(ts) && Date.now() - ts > STALE_MIN_MS) return "stale";
        return (shotCount || 0) > 0 ? "processing" : "queued";
    }
    return "unknown";
}

function StatusBadge({ status }: { status: UrlStatusUi }) {
    const base =
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs";
    switch (status) {
        case "ready":
            return (
                <span
                    className={`${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`}
                    title="Screenshots ready"
                >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Ready
                </span>
            );
        case "processing":
            return (
                <span
                    className={`${base} bg-amber-50 text-amber-700 ring-1 ring-amber-200`}
                    title="Running"
                >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Processing
                </span>
            );
        case "queued":
            return (
                <span
                    className={`${base} bg-sky-50 text-sky-700 ring-1 ring-sky-200`}
                    title="Queued"
                >
                    <Clock3 className="h-3.5 w-3.5" />
                    Queued
                </span>
            );
        case "stale":
            return (
                <span
                    className={`${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200`}
                    title="Timed out or failed"
                >
                    Stale
                </span>
            );
        case "error":
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
    const withProtocol = ensureProtocol(rawUrl);
    const cleaned = normUrl(withProtocol);
    if (!isHttpUrl(cleaned)) throw new Error("Invalid URL.");
    const urlHash = hash64(cleaned);

    const col = collection(db, "kloner_users", uid, "kloner_urls");
    const [byHash, byUrl] = await Promise.all([
        getDocs(query(col, where("urlHash", "==", urlHash))),
        getDocs(query(col, where("url", "==", cleaned))),
    ]);
    const exists = !byHash.empty || !byUrl.empty;

    if (!exists) {
        await addDoc(col, {
            url: cleaned,
            urlHash,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            status: "queued",
            screenshotsPrefix: `screenshots/${uid}/${urlHash}`,
            screenshotPaths: [],
        } as UrlDoc);
    }

    const r = await fetch("/api/private/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: cleaned }),
    });
    if (!r.ok) {
        const j: any = await r.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to queue screenshot job.");
    }
    return cleaned;
}

/* form */
function UrlForm({ uid, onAdded, disabled }: UrlFormProps) {
    const [url, setUrl] = useState<string>("");
    const [err, setErr] = useState<string>("");
    const [busy, setBusy] = useState<boolean>(false);

    const effectiveDisabled = busy || !!disabled;

    async function handleAdd(e: React.FormEvent) {
        e.preventDefault();
        if (effectiveDisabled) return;

        setErr("");
        try {
            setBusy(true);
            const normalized = ensureProtocol(url);
            setUrl(normalized);
            await addAndStart(uid, normalized);
            onAdded?.();
            setUrl("");
        } catch (e: any) {
            setErr(e?.message || "Could not start capture.");
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
                    placeholder="https://example.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={effectiveDisabled}
                    className="flex-1 rounded-xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:ring-4 disabled:bg-neutral-100 disabled:text-neutral-400"
                    style={{
                        boxShadow: "0 0 0 0 rgba(0,0,0,0)",
                        caretColor: ACCENT,
                        WebkitTapHighlightColor: "transparent",
                    }}
                />
                <button
                    type="submit"
                    disabled={effectiveDisabled}
                    className="inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm text-white shadow-sm disabled:opacity-60"
                    style={{ backgroundColor: ACCENT }}
                >
                    {busy ? "Saving…" : disabled ? "Processing…" : "Add URL"}
                </button>
            </div>
            {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
            <p className="mt-2 text-xs text-neutral-500">
                We queue a capture and store a base layout under your account.
            </p>
        </form>
    );
}

/* skeleton row */
function UrlRowSkeleton() {
    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-sm animate-pulse">
            <div className="flex items-start gap-3">
                <div className="h-14 w-14 rounded-full bg-neutral-200" />
                <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="h-3 w-40 rounded bg-neutral-200" />
                        <div className="h-5 w-20 rounded-full bg-neutral-100" />
                    </div>
                    <div className="h-2.5 w-56 rounded bg-neutral-100" />
                    <div className="flex flex-wrap gap-2 justify-end sm:justify-start">
                        <div className="h-8 w-20 rounded-full bg-neutral-100" />
                        <div className="h-8 w-20 rounded-full bg-neutral-100" />
                        <div className="h-8 w-20 rounded-full bg-neutral-100" />
                    </div>
                </div>
            </div>
        </div>
    );
}

function UrlRow({ uid, r }: UrlRowProps) {
    const [busy, setBusy] = useState<boolean>(false);
    const [err, setErr] = useState<string>("");
    const [deleteBlocked, setDeleteBlocked] = useState<null | { urlHash: string; url: string; count: number }>(null);

    const uiStatus = normalizeUrlStatus(
        r.status as UrlStatusRaw | UrlStatusUi | undefined,
        r.screenshotPaths?.length,
        r.updatedAt
    );

    const locked = uiStatus === "processing";
    const isStale = uiStatus === "stale";
    const isReady = uiStatus === "ready";

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
            typeof window !== "undefined"
                ? window.confirm(
                    isStale
                        ? "Retry screenshots for this URL? This will queue a fresh capture."
                        : "Rescan this URL now? This will queue a new capture and may overwrite the latest screenshot."
                )
                : true;
        if (!ok) return;
        await rescan();
    }

    async function rescan() {
        if (locked) return;
        setErr("");
        setBusy(true);
        try {
            await updateDoc(doc(db, "kloner_users", uid, "kloner_urls", r.id), {
                status: "queued",
                updatedAt: serverTimestamp(),
                lastError: null,
                retry: false,
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
                    status: "stale",
                    updatedAt: serverTimestamp(),
                    lastError: j?.error || "queue_failed",
                    retry: true,
                } as any);
            }
        } catch (e: any) {
            setErr(e?.message || "Rescan failed.");
            await updateDoc(doc(db, "kloner_users", uid, "kloner_urls", r.id), {
                status: "stale",
                updatedAt: serverTimestamp(),
                lastError: e?.message || "rescan_exception",
                retry: true,
            } as any);
        } finally {
            setBusy(false);
        }
    }

    async function countRendersForUrl(url: string, urlHash: string) {
        const rendersCol = collection(db, "kloner_users", uid, "kloner_renders");
        const qHash = query(rendersCol, where("urlHash", "==", urlHash));
        const qUrl = query(rendersCol, where("url", "==", url));
        const [snapHash, snapUrl] = await Promise.all([getDocs(qHash), getDocs(qUrl)]);
        const ids = new Set<string>();
        snapHash.forEach((d) => ids.add(d.id));
        snapUrl.forEach((d) => ids.add(d.id));
        return ids.size;
    }

    async function remove() {
        if (locked) return;

        const urlHash = r.urlHash || hash64(r.url);

        // ✅ block screenshot deletion if renders exist
        try {
            setDeleteBlocked(null);
            const renderCount = await countRendersForUrl(r.url, urlHash);
            if (renderCount > 0) {
                setDeleteBlocked({ urlHash, url: r.url, count: renderCount });
                return;
            }
        } catch {
            // if counting fails, be safe and block delete
            setDeleteBlocked({ urlHash, url: r.url, count: 1 });
            return;
        }

        const ok = window.confirm(
            `Delete this tracked URL?\n\n${r.url}\n\nThis removes the URL and its screenshots.`
        );
        if (!ok) return;

        setErr("");
        setBusy(true);
        try {
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

            await deleteDoc(doc(db, "kloner_users", uid, "kloner_urls", r.id));
        } catch (e: any) {
            setErr(e?.message || "Delete failed.");
        } finally {
            setBusy(false);
        }
    }

    const builderHref = locked ? undefined : `/dashboard/view?u=${encodeURIComponent(r.url)}`;
    const rendersHref = locked ? undefined : `/dashboard/view?u=${encodeURIComponent(r.url)}`;

    return (
        <div
            className={`rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-sm relative ${locked ? "opacity-60" : ""
                }`}
            aria-busy={locked}
            aria-disabled={locked}
        >
            {/* red X delete button top-right */}
            <button
                onClick={() => void remove()}
                disabled={busy || locked}
                aria-label="Delete tracked URL"
                title="Delete this tracked URL"
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

            <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
                {thumbUrl ? (
                    <div className="h-12 w-12 rounded-full overflow-hidden border border-neutral-200 bg-neutral-100 shrink-0">
                        <img
                            src={thumbUrl}
                            alt=""
                            className="object-cover"
                            draggable={false}
                        />
                    </div>
                ) : (
                    <div className="h-12 w-12 rounded-full overflow-hidden bg-white shrink-0" />
                )}

                <div className="min-w-0 flex-1 flex flex-col gap-2">
                    {/* top row: URL only */}
                    <div className="flex flex-wrap items-center gap-5 justify-between">
                        <a
                            // href={locked ? undefined : r.url}
                            // target={locked ? undefined : "_blank"}
                            // rel={locked ? undefined : "noreferrer"}
                            className={`truncate max-w-full sm:max-w-[70%] text-sm ${locked
                                ? "text-neutral-400 pointer-events-none"
                                : "text-neutral-800 hover:underline"
                                }`}
                            aria-disabled={locked}
                            tabIndex={locked ? -1 : 0}
                        >
                            {r.url}
                        </a>
                        <StatusBadge status={uiStatus} />
                    </div>

                    {deleteBlocked && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            <div className="font-medium">
                                Delete blocked: this URL still has {deleteBlocked.count} render{deleteBlocked.count === 1 ? "" : "s"}.
                            </div>
                            <div className="mt-1 text-amber-800/90">
                                Delete the render(s) first, then delete this URL.
                            </div>
                        </div>
                    )}

                    {r.lastError && (uiStatus === "stale" || uiStatus === "error") ? (
                        <div className="text-xs text-rose-600">
                            Last error: {r.lastError}
                        </div>
                    ) : null}
                    {err ? <div className="text-xs text-red-600">{err}</div> : null}

                    <div className="mt-1 flex flex-wrap gap-2 justify-end sm:justify-start">
                        {isStale && (
                            <button
                                onClick={() => void handleRescanClick()}
                                disabled={busy || locked}
                                className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                            >
                                {busy ? "Working…" : "Retry"}
                            </button>
                        )}

                        {isReady && (
                            <>
                                <div className="text-[11px] text-zinc-500 w-full">
                                    <p>
                                        Initial scan complete. Your site is ready to build. Click below to begin.
                                    </p>
                                </div>
                                <a
                                    href={builderHref}
                                    className={`group inline-flex items-center rounded-full bg-accent px-3 py-1.5 text-xs text-white whitespace-nowrap transition-[padding] duration-200 ease-out ${locked ? "pointer-events-none" : ""
                                        }`}
                                    aria-disabled={locked}
                                    tabIndex={locked ? -1 : 0}
                                >
                                    <span>Go to Builder</span>

                                    <span
                                        className="ml-0 w-0 overflow-hidden inline-flex items-center transition-[width,margin] duration-200 ease-out
        group-hover:w-4 group-hover:ml-1"
                                        aria-hidden="true"
                                    >
                                        <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100" />
                                    </span>
                                </a>
                            </>
                        )}
                    </div>

                    {locked && (
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            <span>
                                Processing up to 3 pages for this URL. This can take a few
                                minutes.
                            </span>
                        </div>
                    )}
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
    const [bootstrapErr, setBootstrapErr] = useState<string>("");

    const [billingMsg, setBillingMsg] = useState<
        | null
        | {
            type: "success" | "cancelled";
            text: string;
        }
    >(null);

    const addOnceRef = useRef(false);

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
                    setBootstrapErr(err.message || "Failed to load URLs.");
                    setRowsLoading(false);
                }
            );
        });
        return () => {
            off();
            unsubRef.current?.();
        };
    }, [router]);

    const hasPending = useMemo(() => {
        if (!rows || rows.length === 0) return false;
        return rows.some((r) => {
            const ui = normalizeUrlStatus(
                r.status as UrlStatusRaw | UrlStatusUi | undefined,
                r.screenshotPaths?.length,
                r.updatedAt
            );
            return ui === "queued" || ui === "processing";
        });
    }, [rows]);

    useEffect(() => {
        const status = search.get("billing");
        if (!status) return;

        if (status === "success") {
            setBillingMsg({
                type: "success",
                text: "Billing updated. Your subscription is now active. Limits may take a few seconds to refresh.",
            });
        } else if (status === "cancelled") {
            setBillingMsg({
                type: "cancelled",
                text: "Checkout cancelled. Your existing plan is unchanged.",
            });
        }

        if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.delete("billing");
            router.replace(url.pathname + url.search);
        }
    }, [search, router]);

    useEffect(() => {
        const u = user;
        if (!u) return;
        if (addOnceRef.current) return;

        const paramUrl = search.get("u");
        if (!paramUrl) return;

        const cleaned = normUrl(ensureProtocol(paramUrl));
        const key = `kloner:addOnce:${u.uid}:${hash64(cleaned)}`;
        if (typeof window !== "undefined" && localStorage.getItem(key)) {
            router.replace("/dashboard");
            return;
        }

        addOnceRef.current = true;
        (async () => {
            try {
                await addAndStart(u.uid, paramUrl);
                if (typeof window !== "undefined") {
                    localStorage.setItem(key, String(Date.now()));
                }
            } catch (e: any) {
                setBootstrapErr(e?.message || "Failed to add URL.");
            } finally {
                router.replace("/dashboard");
            }
        })();
    }, [search, user, router]);

    return (
        <div className="min-h-screen bg-white pb-[30px]">
            <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 py-8">
                <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                    <span>Kloner · Dashboard</span>
                </div>

                <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-8 sm:px-8 sm:py-10 shadow-sm">
                    <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                        Dashboard
                    </h1>
                    <p className="mt-1 text-sm text-neutral-600">
                        Add a URL to capture. We queue a base layout you can then create a website from.
                    </p>

                    {billingMsg && (
                        <div
                            className={`mt-3 flex items-start gap-2 rounded-full border px-3 py-2 text-sm ${billingMsg.type === "success"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-amber-200 bg-amber-50 text-amber-800"
                                }`}
                        >
                            {billingMsg.type === "success" ? (
                                <CheckCircle2 className="h-4 w-4 mt-[2px]" />
                            ) : (
                                <AlertTriangle className="h-4 w-4 mt-[2px]" />
                            )}
                            <span>{billingMsg.text}</span>
                        </div>
                    )}

                    {bootstrapErr ? (
                        <div className="mt-3 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            {bootstrapErr}
                        </div>
                    ) : null}

                    <div className="mt-6">
                        {user ? (
                            <UrlForm
                                uid={user.uid}
                                onAdded={() => { }}
                                disabled={hasPending}
                            />
                        ) : null}
                    </div>

                    <div className="mt-8">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="text-sm text-neutral-700">
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
            </main>
        </div>
    );
}
