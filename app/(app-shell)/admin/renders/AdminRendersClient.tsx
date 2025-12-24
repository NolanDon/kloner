// src/app/admin/renders/AdminRendersClient.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuth, onAuthStateChanged, getIdTokenResult, getIdToken } from "firebase/auth";
import {
    ExternalLink,
    RefreshCw,
    ShieldAlert,
    X,
    Maximize2,
    Minimize2,
    ChevronLeft,
    ChevronRight,
    Image as ImageIcon,
    Code as CodeIcon,
    LayoutTemplate,
    Copy,
} from "lucide-react";
import Image from 'next/image'

type AdminRenderRow = {
    uid: string;
    renderId: string;
    name?: string;
    createdAt?: any;
    updatedAt?: any;
    status?: string;
    path?: string;
};

type AdminRenderItem = AdminRenderRow & {
    html?: string;
    referenceImage?: string | null;
    key?: string | null;
    htmlStoragePath?: string | null;
    url?: string;
    multiPageMode?: boolean;
};

type ViewerTab = "preview" | "screenshot" | "code";

function claimIsAdmin(v: any): boolean {
    return v === true || v === "true" || v === 1;
}

function norm(s: string) {
    return (s || "").trim();
}

function includesCI(hay: string, needle: string) {
    return hay.toLowerCase().includes(needle.toLowerCase());
}

function normalizeRoute(v: string) {
    const s = (v || "/").trim() || "/";
    return s.startsWith("/") ? s : `/${s}`;
}

function safeDecode(v: string) {
    try {
        return decodeURIComponent(v);
    } catch {
        return v;
    }
}

function clampIdx(n: number, len: number) {
    if (len <= 0) return 0;
    if (n < 0) return 0;
    if (n >= len) return len - 1;
    return n;
}

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

async function adminFetch(path: string, init?: RequestInit) {
    const auth = getAuth();
    const u = auth.currentUser;
    if (!u) throw new Error("Not signed in");

    const token = await getIdToken(u, true);

    const headers = new Headers(init?.headers || {});
    headers.set("authorization", `Bearer ${token}`);
    if (init?.body && !headers.get("content-type")) headers.set("content-type", "application/json");

    const resp = await fetch(path, { ...init, headers, credentials: "include", cache: "no-store" });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.error || json?.message || `Request failed (${resp.status})`);
    return json;
}

/**
 * Injects a tiny router into the HTML so the iframe can switch "pages" without reloading,
 * matching the community-build preview behavior.
 */
function buildAdminPreviewHtml(rawHtml: string, initialRoute: string) {
    const r = normalizeRoute(initialRoute);

    const bridge = `
<script>
(function(){
  const INIT_ROUTE = ${JSON.stringify(r)};

  function norm(route){
    route = String(route || "/").trim() || "/";
    if (!route.startsWith("/")) route = "/" + route;
    return route;
  }

  function allRouteNodes(){
    const a = Array.from(document.querySelectorAll(".page-root[data-route], [data-route]"));
    return a;
  }

  function setActive(route){
    route = norm(route);
    try {
      const nodes = allRouteNodes();
      if (!nodes.length) return;

      for (const el of nodes) el.classList.remove("active");

      let target = nodes.find(el => String(el.getAttribute("data-route") || "") === route);
      if (!target) target = nodes.find(el => ("/" + String(el.getAttribute("data-route") || "").replace(/^\\/+/, "")) === route);
      if (!target) target = nodes.find(el => String(el.getAttribute("data-route") || "") === "/");
      if (!target) target = nodes[0];

      if (target) target.classList.add("active");
      try { window.history.replaceState({}, "", route); } catch {}
    } catch {}
  }

  function isInternal(href){
    if (!href) return false;
    href = String(href);
    if (href.startsWith("#")) return false;
    if (href.startsWith("mailto:") || href.startsWith("tel:")) return false;
    if (href.startsWith("http://") || href.startsWith("https://")) return false;
    return href.startsWith("/") || /^[a-zA-Z0-9._\\-~/]+$/.test(href);
  }

  function toInternalRoute(href){
    href = String(href || "/").trim() || "/";
    href = href.split("#")[0].split("?")[0];
    return norm(href);
  }

  setActive(INIT_ROUTE);

  document.addEventListener("click", function(e){
    const t = e.target;
    const a = t && t.closest ? t.closest("a") : null;
    if (!a) return;

    const href = a.getAttribute("href") || "";
    const dataLink = a.hasAttribute("data-link");

    if (dataLink || isInternal(href)) {
      e.preventDefault();
      e.stopPropagation();

      const next = toInternalRoute(href || "/");
      setActive(next);

      try { parent.postMessage({ type: "KLONER_ADMIN_ROUTE", route: next }, "*"); } catch {}
    }
  }, true);

  window.addEventListener("message", function(ev){
    const d = ev && ev.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "KLONER_SET_ROUTE" && typeof d.route === "string") {
      setActive(d.route);
    }
  });
})();
</script>
`;

    const lower = (rawHtml || "").toLowerCase();
    const idx = lower.lastIndexOf("</body>");
    if (idx !== -1) return rawHtml.slice(0, idx) + bridge + rawHtml.slice(idx);
    return rawHtml + bridge;
}

function getScreenshotUrlFromItem(item: AdminRenderItem | null): string {
    console.log(item);
    if (!item) return "";

    const anyItem = item as any;

    const cand =
        norm(String(item.referenceImage || "")) ||
        norm(String(anyItem.referenceImage || "")) ||
        norm(String(anyItem.referenceImageUrl || "")) ||
        norm(String(anyItem.screenshotUrl || "")) ||
        norm(String(anyItem.screenshot || "")) ||
        "";

    return cand;
}

function safeFilenameBase(s: string) {
    return (s || "")
        .trim()
        .toLowerCase()
        .replace(/https?:\/\//g, "")
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

export default function AdminRendersClient() {
    const [userUid, setUserUid] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState<boolean>(false);

    const [loading, setLoading] = useState<boolean>(false);
    const [items, setItems] = useState<AdminRenderRow[]>([]);
    const [err, setErr] = useState<string | null>(null);

    const [uidFilter, setUidFilter] = useState<string>("");
    const [appliedUidFilter, setAppliedUidFilter] = useState<string>("");

    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerFull, setViewerFull] = useState(false);
    const [viewerErr, setViewerErr] = useState<string | null>(null);
    const [viewerLoading, setViewerLoading] = useState(false);

    const [selected, setSelected] = useState<AdminRenderItem | null>(null);
    const [route, setRoute] = useState<string>("/");
    const [tab, setTab] = useState<ViewerTab>("preview");
    const [copied, setCopied] = useState<boolean>(false);

    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const fsWrapRef = useRef<HTMLDivElement | null>(null);

    const didInitialFetchRef = useRef(false);

    useEffect(() => {
        const a = getAuth();
        return onAuthStateChanged(a, async (u) => {
            if (!u) {
                setUserUid(null);
                setIsAdmin(false);
                return;
            }

            setUserUid(u.uid);

            try {
                const tok = await getIdTokenResult(u, true);
                const adminClaim = (tok?.claims as any)?.admin;
                setIsAdmin(claimIsAdmin(adminClaim));
            } catch {
                setIsAdmin(false);
            }
        });
    }, []);

    const fetchList = useCallback(async (serverUidQuery: string) => {
        const q = norm(serverUidQuery);
        const url = q ? `/api/admin/renders?uid=${encodeURIComponent(q)}` : `/api/admin/renders`;

        const j = await adminFetch(url, { method: "GET" });
        const next = Array.isArray(j?.items) ? (j.items as AdminRenderRow[]) : [];
        return next.filter(
            (x) => x && typeof x.uid === "string" && x.uid && typeof x.renderId === "string" && x.renderId,
        );
    }, []);

    const fetchSingleWithHtml = useCallback(async (uid: string, renderId: string) => {
        const u = norm(uid);
        const r = norm(renderId);
        if (!u || !r) throw new Error("Missing uid/renderId");

        const j = await adminFetch(
            `/api/admin/renders?uid=${encodeURIComponent(u)}&renderId=${encodeURIComponent(r)}`,
            { method: "GET" },
        );

        const item = (j?.item || null) as AdminRenderItem | null;
        if (!item) throw new Error("not_found");
        return item;
    }, []);

    const refresh = useCallback(async () => {
        if (!userUid || !isAdmin) return;

        setErr(null);
        setLoading(true);
        try {
            const next = await fetchList(appliedUidFilter);
            setItems(next);
        } catch (e: any) {
            console.error("[AdminRenders] fetch failed", e);
            setErr(e?.message || "Failed to load renders.");
        } finally {
            setLoading(false);
        }
    }, [userUid, isAdmin, appliedUidFilter, fetchList]);

    useEffect(() => {
        if (!userUid || !isAdmin) return;
        if (didInitialFetchRef.current) return;
        didInitialFetchRef.current = true;
        refresh();
    }, [userUid, isAdmin, refresh]);

    useEffect(() => {
        if (!userUid || !isAdmin) return;
        refresh();
    }, [appliedUidFilter, userUid, isAdmin, refresh]);

    const onClearFilter = useCallback(() => {
        setUidFilter("");
        setAppliedUidFilter("");
    }, []);

    const shownItems = useMemo(() => {
        const q = norm(uidFilter);
        if (!q) return items;
        return items.filter((x) => includesCI(x.uid, q));
    }, [items, uidFilter]);

    const closeViewer = useCallback(async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
        } catch { }
        setViewerOpen(false);
        setViewerFull(false);
        setViewerErr(null);
        setViewerLoading(false);
        setSelected(null);
        setRoute("/");
        setTab("preview");
        setCopied(false);
    }, []);

    const openViewer = useCallback(
        async (r: AdminRenderRow) => {
            setViewerErr(null);
            setViewerLoading(true);
            setViewerOpen(true);
            setViewerFull(false);
            setSelected(null);
            setRoute("/");
            setTab("preview");
            setCopied(false);

            try {
                const item = await fetchSingleWithHtml(r.uid, r.renderId);

                const html = (item?.html || "").trim();
                if (!html) {
                    throw new Error("This API response does not include HTML for the render.");
                }

                setSelected(item);
            } catch (e: any) {
                console.error("[AdminRenders] open viewer failed", e);
                setViewerErr(e?.message || "Failed to open viewer.");
            } finally {
                setViewerLoading(false);
            }
        },
        [fetchSingleWithHtml],
    );

    useEffect(() => {
        const el = document.documentElement;
        const prev = el.style.overflow;
        if (viewerOpen) el.style.overflow = "hidden";
        return () => {
            el.style.overflow = prev;
        };
    }, [viewerOpen]);

    useEffect(() => {
        if (!viewerOpen) return;

        const onKey = async (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;

            if (document.fullscreenElement) {
                try {
                    await document.exitFullscreen();
                    return;
                } catch { }
            }
            closeViewer();
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [viewerOpen, closeViewer]);

    useEffect(() => {
        if (!viewerOpen) return;

        const onMsg = (ev: MessageEvent) => {
            const d: any = ev?.data;
            if (!d || typeof d !== "object") return;
            if (d.type === "KLONER_ADMIN_ROUTE" && typeof d.route === "string") {
                setRoute(normalizeRoute(d.route));
            }
        };
        window.addEventListener("message", onMsg);
        return () => window.removeEventListener("message", onMsg);
    }, [viewerOpen]);

    useEffect(() => {
        if (!viewerOpen) return;
        if (tab !== "preview") return;
        const normalized = normalizeRoute(route);
        try {
            iframeRef.current?.contentWindow?.postMessage({ type: "KLONER_SET_ROUTE", route: normalized }, "*");
        } catch { }
    }, [route, viewerOpen, tab]);

    const routes = useMemo(() => extractRoutesFromHtml(selected?.html || ""), [selected?.html]);

    useEffect(() => {
        if (!viewerOpen) return;
        if (!routes.length) return;
        const normalized = normalizeRoute(route);
        if (routes.includes(normalized)) return;
        setRoute(routes[0] || "/");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewerOpen, routes.join("|")]);

    const idx = useMemo(() => {
        const normalized = normalizeRoute(route);
        const i = routes.indexOf(normalized);
        return i === -1 ? 0 : i;
    }, [route, routes]);

    const onPrev = useCallback(() => {
        if (!routes.length) return;
        setRoute(routes[clampIdx(idx - 1, routes.length)] || "/");
    }, [idx, routes]);

    const onNext = useCallback(() => {
        if (!routes.length) return;
        setRoute(routes[clampIdx(idx + 1, routes.length)] || "/");
    }, [idx, routes]);

    const toggleIframeFullscreen = useCallback(async () => {
        const el = fsWrapRef.current;
        if (!el) return;

        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await el.requestFullscreen();
            }
        } catch { }
    }, []);

    const screenshotUrl = useMemo(() => getScreenshotUrlFromItem(selected), [selected]);
    const htmlText = useMemo(() => String(selected?.html || ""), [selected?.html]);

    useEffect(() => {
        if (!copied) return;
        const t = window.setTimeout(() => setCopied(false), 1200);
        return () => window.clearTimeout(t);
    }, [copied]);

    const onCopyHtml = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(htmlText);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    }, [htmlText]);

    const onDownloadHtml = useCallback(() => {
        try {
            const base =
                safeFilenameBase(selected?.name || selected?.url || `${selected?.uid || "uid"}-${selected?.renderId || "render"}`) ||
                "render";
            const blob = new Blob([htmlText], { type: "text/html;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${base}.html`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch { }
    }, [htmlText, selected]);

    if (!userUid) {
        return (
            <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-neutral-900 font-semibold">
                    <ShieldAlert className="h-5 w-5" />
                    Sign in required
                </div>
                <div className="mt-2 text-sm text-neutral-600">You must be signed in to access admin.</div>
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
                <div className="mt-2 text-sm text-neutral-600">Your account does not have admin permissions.</div>
            </div>
        );
    }

    return (
        <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-6 sm:px-8 sm:py-8 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-2xl tracking-tight text-neutral-900">User renders</h2>
                    <p className="mt-1 text-sm text-neutral-600">
                        Browse all renders across all users. Server filter requires exact uid; typing filter is partial.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={refresh}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-sm hover:opacity-95"
                    disabled={loading}
                >
                    <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                    Refresh
                </button>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative w-full sm:max-w-[520px]">
                    <input
                        value={uidFilter}
                        onChange={(e) => setUidFilter(e.target.value)}
                        placeholder="Type to filter uids (partial ok)"
                        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 pr-10 text-sm text-neutral-900 shadow-sm outline-none focus:ring-2 focus:ring-neutral-900/10"
                        spellCheck={false}
                        autoCapitalize="none"
                        autoCorrect="off"
                    />
                    {norm(uidFilter) ? (
                        <button
                            type="button"
                            onClick={onClearFilter}
                            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-neutral-100"
                            title="Clear"
                            aria-label="Clear"
                        >
                            <X className="h-4 w-4 text-neutral-700" />
                        </button>
                    ) : null}
                </div>
            </div>

            {err ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {err}
                </div>
            ) : null}

            {loading ? (
                <div className="mt-6 text-sm text-neutral-500">Loading…</div>
            ) : shownItems.length === 0 ? (
                <div className="mt-6 text-sm text-neutral-500">No renders found.</div>
            ) : (
                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {shownItems.map((r) => (
                        <RenderCard key={`${r.uid}:${r.renderId}`} r={r} onOpen={() => openViewer(r)} />
                    ))}
                </div>
            )}

            {viewerOpen ? (
                <div className="fixed inset-0 z-[9999]">
                    <div className="absolute inset-0 bg-black/40" onClick={closeViewer} />

                    <div
                        className={[
                            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-neutral-200 shadow-2xl overflow-hidden",
                            viewerFull
                                ? "w-[calc(100vw-24px)] h-[calc(100vh-24px)] rounded-3xl"
                                : "w-[min(1200px,calc(100vw-24px))] h-[min(820px,calc(100vh-24px))] rounded-3xl",
                        ].join(" ")}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-neutral-200">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-neutral-900">
                                    {norm(selected?.name || "") || "Untitled render"}
                                </div>
                                {selected ? (
                                    <div className="truncate text-xs text-neutral-500">
                                        uid: {selected.uid} · renderId: {selected.renderId}
                                    </div>
                                ) : (
                                    <div className="truncate text-xs text-neutral-500">Loading render…</div>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                {tab === "preview" ? (
                                    <button
                                        type="button"
                                        onClick={toggleIframeFullscreen}
                                        className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                                        title="Fullscreen iframe preview"
                                    >
                                        <Maximize2 className="h-4 w-4" />
                                        Fullscreen preview
                                    </button>
                                ) : null}

                                <button
                                    type="button"
                                    onClick={() => setViewerFull((v) => !v)}
                                    className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                                    title={viewerFull ? "Shrink overlay" : "Expand overlay"}
                                >
                                    {viewerFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                                    {viewerFull ? "Shrink" : "Expand"}
                                </button>

                                {selected ? (
                                    <a
                                        href={`/admin/renders/${selected.uid}/${selected.renderId}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95"
                                        title="Open render page in new tab"
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        New tab
                                    </a>
                                ) : null}

                                <button
                                    type="button"
                                    onClick={closeViewer}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-neutral-100"
                                    aria-label="Close"
                                    title="Close"
                                >
                                    <X className="h-5 w-5 text-neutral-700" />
                                </button>
                            </div>
                        </div>

                        {viewerErr ? (
                            <div className="m-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                                {viewerErr}
                            </div>
                        ) : null}

                        {viewerLoading || !selected ? (
                            <div className="p-6 text-sm text-neutral-500">Loading…</div>
                        ) : (
                            <div className="h-[calc(100%-56px)] flex flex-col min-h-0">
                                <div className="px-4 py-3 border-b border-neutral-200 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setTab("preview")}
                                            className={[
                                                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                                tab === "preview"
                                                    ? "border-neutral-900 bg-neutral-900 text-white"
                                                    : "border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50",
                                            ].join(" ")}
                                        >
                                            <LayoutTemplate className="h-4 w-4" />
                                            Preview
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setTab("screenshot")}
                                            className={[
                                                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                                tab === "screenshot"
                                                    ? "border-neutral-900 bg-neutral-900 text-white"
                                                    : "border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50",
                                            ].join(" ")}
                                        >
                                            <ImageIcon className="h-4 w-4" />
                                            Screenshot
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setTab("code")}
                                            className={[
                                                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                                tab === "code"
                                                    ? "border-neutral-900 bg-neutral-900 text-white"
                                                    : "border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50",
                                            ].join(" ")}
                                        >
                                            <CodeIcon className="h-4 w-4" />
                                            Code
                                        </button>
                                        <div className="text-xs text-neutral-500 truncate">
                                            {selected.url ? (
                                                <>
                                                    url:
                                                    <a
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        href={selected.url}
                                                        className="font-semibold hover:underline text-neutral-800">{selected.url}
                                                    </a>
                                                </>
                                            ) : (
                                                <>
                                                    storage:{" "}
                                                    <span className="font-semibold text-neutral-800">
                                                        {norm(String(selected.key || "")) || "unknown"}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {tab === "preview" ? (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={onPrev}
                                                disabled={!routes.length}
                                                className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-60"
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                                Prev
                                            </button>

                                            <button
                                                type="button"
                                                onClick={onNext}
                                                disabled={!routes.length}
                                                className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-60"
                                            >
                                                Next
                                                <ChevronRight className="h-4 w-4" />
                                            </button>

                                            <select
                                                value={normalizeRoute(route)}
                                                onChange={(e) => setRoute(normalizeRoute(safeDecode(e.target.value)))}
                                                className="h-9 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-900"
                                            >
                                                {routes.map((r) => (
                                                    <option key={r} value={r}>
                                                        {r}
                                                    </option>
                                                ))}
                                            </select>

                                            <div className="text-xs text-neutral-500">
                                                route: <span className="font-mono text-neutral-800">{normalizeRoute(route)}</span>
                                            </div>

                                            <a
                                                href="#"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    try {
                                                        const srcDoc = buildAdminPreviewHtml(
                                                            selected.html || "<!doctype html><html><body></body></html>",
                                                            normalizeRoute(route),
                                                        );
                                                        const w = window.open("", "_blank");
                                                        if (!w) return;
                                                        w.document.open();
                                                        w.document.write(srcDoc);
                                                        w.document.close();
                                                    } catch { }
                                                }}
                                                className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                                                title="Open current srcDoc in a new tab"
                                            >
                                                Open tab
                                                <ExternalLink className="h-4 w-4" />
                                            </a>
                                        </div>
                                    ) : tab === "code" ? (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={onCopyHtml}
                                                className={[
                                                    "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
                                                    copied
                                                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                                        : "border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50",
                                                ].join(" ")}
                                                title="Copy HTML"
                                            >
                                                <Copy className="h-4 w-4" />
                                                {copied ? "Copied" : "Copy"}
                                            </button>

                                            <button
                                                type="button"
                                                onClick={onDownloadHtml}
                                                className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                                                title="Download .html"
                                            >
                                                Download
                                                <ExternalLink className="h-4 w-4" />
                                            </button>

                                            <div className="text-xs text-neutral-500">
                                                bytes: <span className="font-semibold text-neutral-800">{htmlText.length}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap items-center gap-2">
                                            {screenshotUrl ? (
                                                <a
                                                    href={screenshotUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                                                    title="Open screenshot in new tab"
                                                >
                                                    Open image
                                                    <ExternalLink className="h-4 w-4" />
                                                </a>
                                            ) : (
                                                <div className="text-xs text-neutral-500">No screenshot URL on this render.</div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {tab === "preview" ? (
                                    <div ref={fsWrapRef} className="flex-1 bg-white min-h-0">
                                        <iframe
                                            ref={iframeRef}
                                            title="Admin render iframe preview"
                                            srcDoc={buildAdminPreviewHtml(
                                                selected.html || "<!doctype html><html><body></body></html>",
                                                normalizeRoute(route),
                                            )}
                                            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
                                            allow="fullscreen; clipboard-read; clipboard-write"
                                            className="w-full h-full"
                                            style={{ border: 0, background: "white" }}
                                        />
                                    </div>
                                ) : tab === "screenshot" ? (
                                    <div className="flex-1 bg-neutral-50 min-h-0">
                                        {screenshotUrl ? (
                                            <div className="h-full w-full rounded-2xl border border-neutral-200 bg-white shadow-sm flex flex-col min-h-0 overflow-hidden">
                                                <div className="flex-1 min-h-0 overflow-auto">
                                                    <Image
                                                        src={screenshotUrl}
                                                        alt="Render screenshot"
                                                        className="block h-auto rounded-xl border border-neutral-200"
                                                        loading="lazy"
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="h-full w-full rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
                                                No screenshot URL found on the render doc. Populate `referenceImage` with a signed download URL.
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="h-full w-full rounded-2xl border border-neutral-200 bg-white shadow-sm flex flex-col min-h-0 overflow-hidden">
                                        <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
                                            <div className="text-xs text-neutral-500 truncate">
                                                html field:{" "}
                                                <span className="font-semibold text-neutral-800">
                                                    {htmlText ? "present" : "missing"}
                                                </span>
                                                {selected.htmlStoragePath ? (
                                                    <span className="ml-2">
                                                        · htmlStoragePath:{" "}
                                                        <span className="font-semibold text-neutral-800">{selected.htmlStoragePath}</span>
                                                    </span>
                                                ) : null}
                                            </div>
                                        </div>

                                        <div className="flex-1 min-h-0 overflow-auto p-4">
                                            <pre className="block whitespace-pre font-mono text-[12px] leading-5 text-neutral-900 w-max min-w-full">
                                                {htmlText}
                                            </pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function RenderCard({ r, onOpen }: { r: AdminRenderRow; onOpen: () => void }) {
    const title = norm(r.name || "") || "Untitled render";

    return (
        <div className="relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="p-3">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-neutral-900">{title}</div>
                    <div className="mt-0.5 truncate text-xs text-neutral-500">uid: {r.uid}</div>
                    <div className="mt-0.5 truncate text-xs text-neutral-500">
                        /admin/renders/{r.uid}/{r.renderId}
                    </div>
                    {r.status ? <div className="mt-0.5 truncate text-xs text-neutral-500">status: {r.status}</div> : null}
                </div>

                <div className="mt-3 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onOpen}
                        className="ml-auto inline-flex items-center gap-1 rounded-full bg-neutral-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-95"
                        title="Open viewer"
                    >
                        Open
                        <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
}
