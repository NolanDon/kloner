// src/app/admin/renders/[uid]/[renderId]/AdminRenderPreviewClient.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { getAuth, onAuthStateChanged, getIdTokenResult } from "firebase/auth";
import { ArrowLeft, ExternalLink, RefreshCw, ShieldAlert } from "lucide-react";
import { db } from "@/lib/firebase";

function pickHtmlForRoute(data: any, route: string): { html: string; resolvedRoute: string } {
    const r = (route || "/").trim() || "/";
    const routeKey = r.startsWith("/") ? r : `/${r}`;

    const pagesObj = data?.pages && typeof data.pages === "object" ? data.pages : null;
    if (pagesObj && typeof pagesObj[routeKey] === "string") {
        return { html: pagesObj[routeKey], resolvedRoute: routeKey };
    }

    const byRouteObj =
        data?.pageHtmlByRoute && typeof data.pageHtmlByRoute === "object"
            ? data.pageHtmlByRoute
            : null;
    if (byRouteObj && typeof byRouteObj[routeKey] === "string") {
        return { html: byRouteObj[routeKey], resolvedRoute: routeKey };
    }

    if (typeof data?.html === "string" && data.html.trim()) {
        return { html: data.html, resolvedRoute: routeKey };
    }

    // last resort: try first route-like key in pages
    if (pagesObj) {
        const keys = Object.keys(pagesObj);
        const first = keys.find((k) => typeof pagesObj[k] === "string" && pagesObj[k].trim());
        if (first) return { html: pagesObj[first], resolvedRoute: first };
    }

    return { html: "", resolvedRoute: routeKey };
}

export default function AdminRenderPreviewClient({
    uid,
    renderId,
}: {
    uid: string;
    renderId: string;
}) {
    const sp = useSearchParams();
    const routeParam = sp.get("route") || "/";

    const [userUid, setUserUid] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState<boolean>(false);

    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const [name, setName] = useState<string>("Untitled render");
    const [resolvedRoute, setResolvedRoute] = useState<string>("/");
    const [html, setHtml] = useState<string>("");

    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    useEffect(() => {
        const auth = getAuth();
        return onAuthStateChanged(auth, async (u) => {
            if (!u) {
                setUserUid(null);
                setIsAdmin(false);
                return;
            }
            setUserUid(u.uid);
            try {
                const tok = await getIdTokenResult(u, true);
                setIsAdmin(tok?.claims?.admin === true);
            } catch {
                setIsAdmin(false);
            }
        });
    }, []);

    const refresh = useCallback(async () => {
        setErr(null);
        setLoading(true);

        try {
            const ref = doc(db, "kloner_users", uid, "kloner_renders", renderId);
            const snap = await getDoc(ref);

            if (!snap.exists()) {
                setErr("Render not found.");
                setHtml("");
                return;
            }

            const data = snap.data() as any;
            const title =
                (typeof data?.name === "string" && data.name.trim()) ? data.name :
                    (typeof data?.title === "string" && data.title.trim()) ? data.title :
                        "Untitled render";

            const picked = pickHtmlForRoute(data, routeParam);

            setName(title);
            setResolvedRoute(picked.resolvedRoute);
            setHtml(picked.html || "");
        } catch (e: any) {
            console.error("[AdminRenderPreview] load failed", e);
            setErr(e?.message || "Failed to load render.");
            setHtml("");
        } finally {
            setLoading(false);
        }
    }, [uid, renderId, routeParam]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const iframeSrcDoc = useMemo(() => {
        const h = (html || "").trim();
        if (!h) return "";
        return h;
    }, [html]);

    if (!userUid) {
        return (
            <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-neutral-900 font-semibold">
                    <ShieldAlert className="h-5 w-5" />
                    Sign in required
                </div>
                <div className="mt-2 text-sm text-neutral-600">
                    You must be signed in to access admin.
                </div>
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
                <div className="mt-2 text-sm text-neutral-600">
                    Your account does not have admin permissions.
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-6 sm:px-8 sm:py-8 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Link
                            href="/admin/renders"
                            className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-neutral-50"
                            title="Back"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back
                        </Link>

                        <div className="min-w-0">
                            <div className="truncate text-lg font-semibold text-neutral-900">{name}</div>
                            <div className="mt-0.5 truncate text-xs text-neutral-500">
                                uid: {uid} · render: {renderId} · route: {resolvedRoute}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={refresh}
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-sm hover:opacity-95"
                        disabled={loading}
                    >
                        <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                        Refresh
                    </button>

                    <a
                        href={`/admin/renders/${uid}/${renderId}?route=${encodeURIComponent(resolvedRoute || "/")}`}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                        title="Open in new tab"
                    >
                        New tab
                        <ExternalLink className="h-4 w-4" />
                    </a>
                </div>
            </div>

            {err ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {err}
                </div>
            ) : null}

            {loading ? (
                <div className="mt-6 text-sm text-neutral-500">Loading…</div>
            ) : !iframeSrcDoc ? (
                <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
                    No HTML found for this render and route.
                </div>
            ) : (
                <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
                    <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                        Iframe preview
                    </div>
                    <iframe
                        ref={iframeRef}
                        title="Admin render preview"
                        className="h-[75vh] w-full bg-white"
                        srcDoc={iframeSrcDoc}
                        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                    />
                </div>
            )}
        </div>
    );
}
