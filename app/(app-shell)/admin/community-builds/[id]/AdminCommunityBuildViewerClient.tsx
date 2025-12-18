// src/app/admin/community-builds/[id]/AdminCommunityBuildPreviewClient.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuth, onAuthStateChanged, getIdToken } from "firebase/auth";
import {
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
    XCircle,
    RefreshCw,
    ExternalLink,
} from "lucide-react";

type GalleryBuild = {
    id: string;
    approved: boolean;
    author: string;
    createdAt: any;
    name: string;
    remixable: boolean;
    screenshotKey: string;
    sourceRenderId: string;
    html: string;
};

function extractRoutesFromHtml(html?: string): string[] {
    if (!html) return ["/"];
    const routes: string[] = [];

    // common patterns you might generate
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

function clampIdx(n: number, len: number) {
    if (len <= 0) return 0;
    if (n < 0) return 0;
    if (n >= len) return len - 1;
    return n;
}

function safeDecode(v: string) {
    try {
        return decodeURIComponent(v);
    } catch {
        return v;
    }
}

function normalizeRoute(v: string) {
    const s = (v || "/").trim() || "/";
    return s.startsWith("/") ? s : `/${s}`;
}

async function adminFetch(path: string, init?: RequestInit) {
    const auth = getAuth();
    const u = auth.currentUser;
    if (!u) throw new Error("Not signed in");

    const token = await getIdToken(u, true);

    const headers = new Headers(init?.headers || {});
    headers.set("authorization", `Bearer ${token}`);
    if (init?.body && !headers.get("content-type")) headers.set("content-type", "application/json");

    const resp = await fetch(path, { ...init, headers, credentials: "include" });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.error || json?.message || "Request failed");
    return json;
}

function buildAdminPreviewHtml(rawHtml: string, initialRoute: string) {
    const r = normalizeRoute(initialRoute);

    // IMPORTANT: this script only runs if iframe sandbox includes allow-scripts
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
    // support both your "page-root" convention and any element with data-route
    const a = Array.from(document.querySelectorAll(".page-root[data-route], [data-route]"));
    return a;
  }

  function setActive(route){
    route = norm(route);
    try {
      const nodes = allRouteNodes();
      if (!nodes.length) return;

      for (const el of nodes) el.classList.remove("active");

      // exact match
      let target = nodes.find(el => String(el.getAttribute("data-route") || "") === route);

      // if author stored without leading slash
      if (!target) target = nodes.find(el => ("/" + String(el.getAttribute("data-route") || "").replace(/^\\/+/, "")) === route);

      // fallback home
      if (!target) target = nodes.find(el => String(el.getAttribute("data-route") || "") === "/");

      // final fallback first
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
    // treat /path and path as internal
    return href.startsWith("/") || /^[a-zA-Z0-9._\\-~/]+$/.test(href);
  }

  function toInternalRoute(href){
    href = String(href || "/").trim() || "/";
    // strip query/hash for routing in the preview
    href = href.split("#")[0].split("?")[0];
    return norm(href);
  }

  // initial show
  setActive(INIT_ROUTE);

  // intercept internal nav
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

  // parent can request route changes
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

export default function AdminCommunityBuildPreviewClient({ id }: { id: string }) {
    const router = useRouter();
    const sp = useSearchParams();

    const [uid, setUid] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [item, setItem] = useState<GalleryBuild | null>(null);

    const [route, setRoute] = useState<string>(() => {
        const raw = sp.get("route");
        return normalizeRoute(raw ? safeDecode(raw) : "/");
    });

    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    useEffect(() => {
        const auth = getAuth();
        return onAuthStateChanged(auth, (u) => setUid(u?.uid || null));
    }, []);

    const refresh = useCallback(async () => {
        setErr(null);
        setLoading(true);
        try {
            const j = await adminFetch(`/api/admin/gallery/get?id=${encodeURIComponent(id)}`, {
                method: "GET",
            });
            const it = (j?.item || null) as GalleryBuild | null;
            setItem(it);
            if (!it) setErr("Build not found.");
        } catch (e: any) {
            console.error("[AdminPreview] get failed", e);
            setErr(e?.message || "Failed to load.");
            setItem(null);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const routes = useMemo(() => extractRoutesFromHtml(item?.html || ""), [item?.html]);

    // keep route valid
    useEffect(() => {
        if (!routes.length) return;
        const normalized = normalizeRoute(route);
        if (routes.includes(normalized)) return;
        setRoute(routes[0] || "/");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routes.join("|")]);

    // sync URL ?route= (guard to avoid replace loops)
    useEffect(() => {
        const normalized = normalizeRoute(route);
        const currentRaw = sp.get("route");
        const current = normalizeRoute(currentRaw ? safeDecode(currentRaw) : "/");
        if (current === normalized) return;

        router.replace(
            `/admin/community-builds/${encodeURIComponent(id)}?route=${encodeURIComponent(normalized)}`,
        );
    }, [route, id, router, sp]);

    // listen for iframe route changes
    useEffect(() => {
        const onMsg = (ev: MessageEvent) => {
            const d: any = ev?.data;
            if (!d || typeof d !== "object") return;
            if (d.type === "KLONER_ADMIN_ROUTE" && typeof d.route === "string") {
                setRoute(normalizeRoute(d.route));
            }
        };
        window.addEventListener("message", onMsg);
        return () => window.removeEventListener("message", onMsg);
    }, []);

    // push route changes into iframe (no reload)
    useEffect(() => {
        const normalized = normalizeRoute(route);
        try {
            iframeRef.current?.contentWindow?.postMessage(
                { type: "KLONER_SET_ROUTE", route: normalized },
                "*",
            );
        } catch { }
    }, [route]);

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

    const toggleApprove = useCallback(async () => {
        if (!item) return;
        setSaving(true);
        setErr(null);
        try {
            const next = !item.approved;
            await adminFetch("/api/admin/gallery/approve", {
                method: "POST",
                body: JSON.stringify({ id: item.id, approved: next }),
            });
            setItem((prev) => (prev ? { ...prev, approved: next } : prev));
        } catch (e: any) {
            console.error("[AdminPreview] approve failed", e);
            setErr(e?.message || "Failed to update.");
        } finally {
            setSaving(false);
        }
    }, [item]);

    if (!uid) {
        return (
            <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="text-sm text-neutral-700">Sign in required.</div>
            </div>
        );
    }

    if (loading) return <div className="text-sm text-neutral-500">Loading…</div>;

    if (!item) {
        return (
            <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="text-sm text-neutral-800">Build not found.</div>
                {err ? <div className="mt-3 text-sm text-red-700">{err}</div> : null}
                <div className="mt-4">
                    <Link className="text-sm underline" href="/admin/community-builds">
                        Back
                    </Link>
                </div>
            </div>
        );
    }

    const name = (item.name || "").trim() || "Untitled build";
    const normalizedRoute = normalizeRoute(route);
    const srcDoc = buildAdminPreviewHtml(
        item.html || "<!doctype html><html><body></body></html>",
        normalizedRoute,
    );

    return (
        <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.14em] text-neutral-500">Admin preview</div>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900 truncate">{name}</h1>

                    <div className="mt-1 text-sm text-neutral-600">
                        route: <span className="font-mono text-neutral-800">{normalizedRoute}</span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Link
                            href="/admin/community-builds"
                            className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Back
                        </Link>

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
                            value={normalizedRoute}
                            onChange={(e) => setRoute(e.target.value)}
                            className="h-9 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-900"
                        >
                            {routes.map((r) => (
                                <option key={r} value={r}>
                                    {r}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={refresh}
                            className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Refresh
                        </button>

                        <a
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                try {
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
                </div>

                <div className="flex items-center gap-2">
                    <span
                        className={[
                            "inline-flex items-center whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold",
                            item.approved ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900",
                        ].join(" ")}
                    >
                        {item.approved ? "Approved" : "Not approved"}
                    </span>

                    <button
                        type="button"
                        onClick={toggleApprove}
                        disabled={saving}
                        className={[
                            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white",
                            saving ? "opacity-70" : "hover:opacity-95",
                            item.approved ? "bg-emerald-600" : "bg-amber-600",
                        ].join(" ")}
                    >
                        {item.approved ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                        {item.approved ? "Unapprove" : "Approve"}
                    </button>
                </div>
            </div>

            {err ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {err}
                </div>
            ) : null}

            <div className="mt-6 rounded-3xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
                <iframe
                    ref={iframeRef}
                    title="Admin build preview"
                    srcDoc={srcDoc}
                    // THIS WAS THE BREAK: without allow-scripts your injected router never runs
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
                    className="w-full"
                    style={{ height: "72vh", border: 0, background: "white" }}
                />
            </div>
        </div>
    );
}
