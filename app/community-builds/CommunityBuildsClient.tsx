// src/app/community-builds/CommunityBuildsClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import KlonerLoader from "@/components/KlonerLoader";
import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import { auth } from "@/lib/firebase";
import type { User } from "firebase/auth";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import {
    ChevronLeft,
    ChevronRight,
    Eye,
    Heart,
    MoveLeftIcon,
    Repeat2,
} from "lucide-react";

/** ---------------- Types ---------------- */

type CommunityBuild = {
    id: string;
    renderId: string | null;
    name: string;
    author: string | null;
    createdAt: number | null;
    remixable: boolean;
    approved: boolean;
    screenshotKey: string | null;
    screenshotUrl: string | null;
    html: string | null;
    views: number;
    likes: number;
    remixes: number;
    likedByMe: boolean;
};

type State =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "loaded"; items: CommunityBuild[] };

type DerivedPage = { route: string; label: string; html: string };

/** ---------------- Helpers ---------------- */

function toNum(v: unknown, fallback = 0) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function getCount(it: any, key: string, fallback = 0) {
    const direct =
        it?.[key] ??
        it?.[`${key}Count`] ??
        it?.[`${key}_count`] ??
        it?.[`${key}count`] ??
        it?.stats?.[key] ??
        it?.counts?.[key];

    return toNum(direct, fallback);
}

function toMillisMaybeTimestamp(v: any): number | null {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (!v) return null;

    if (typeof v?.toMillis === "function") {
        const ms = v.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }

    if (typeof v?.seconds === "number") {
        const ns = typeof v?.nanoseconds === "number" ? v.nanoseconds : 0;
        const ms = v.seconds * 1000 + Math.floor(ns / 1_000_000);
        return Number.isFinite(ms) ? ms : null;
    }

    if (typeof v === "string") {
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : null;
    }

    return null;
}

function formatCount(n: unknown) {
    const x = toNum(n, 0);
    if (x < 1000) return String(x);
    if (x < 1_000_000) return `${Math.round((x / 1000) * 10) / 10}k`;
    return `${Math.round((x / 1_000_000) * 10) / 10}m`;
}

function routeToLabel(route: string) {
    if (route === "/") return "Home";
    const r = route.replace(/^\//, "");
    if (!r) return "Home";
    return r
        .split("/")
        .filter(Boolean)
        .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
        .join(" ");
}

function escapeHtmlAttr(s: string) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function derivePagesFromHtml(html: string | null | undefined): DerivedPage[] {
    const raw = (html ?? "").trim();
    if (!raw) return [];

    const pages: DerivedPage[] = [];
    const re =
        /<main\b[^>]*class=["'][^"']*\bpage-root\b[^"']*["'][^>]*data-route=["']([^"']+)["'][^>]*>([\s\S]*?)<\/main>/gi;

    let match: RegExpExecArray | null;
    while ((match = re.exec(raw))) {
        const route = match[1] || "/";
        const activeStyle = `<style id="kloner-active-route">main.page-root[data-route]{display:none!important;}main.page-root[data-route="${escapeHtmlAttr(
            route,
        )}"]{display:block!important;}</style>`;

        let doc = raw;
        if (doc.includes('id="kloner-active-route"')) {
            doc = doc.replace(
                /<style\b[^>]*id=["']kloner-active-route["'][^>]*>[\s\S]*?<\/style>/i,
                activeStyle,
            );
        } else if (doc.includes("</head>")) {
            doc = doc.replace("</head>", `${activeStyle}</head>`);
        } else {
            doc = `${activeStyle}\n${doc}`;
        }

        pages.push({
            route,
            label: routeToLabel(route),
            html: doc,
        });
    }

    if (!pages.length) {
        pages.push({ route: "/", label: "Home", html: raw });
    }

    pages.sort((a, b) =>
        a.route === "/" ? -1 : b.route === "/" ? 1 : a.route.localeCompare(b.route),
    );

    return pages;
}

function delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForAuthUser(timeoutMs = 2500): Promise<User | null> {
    const existing = auth.currentUser;
    if (existing) return existing;

    return await new Promise((resolve) => {
        const t = setTimeout(() => {
            unsub();
            resolve(auth.currentUser ?? null);
        }, timeoutMs);

        const unsub = onAuthStateChanged(auth, (u) => {
            clearTimeout(t);
            unsub();
            resolve(u ?? null);
        });
    });
}

/** ---------------- Component ---------------- */

export default function CommunityBuildsClient() {
    const [state, setState] = useState<State>({ status: "idle" });
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [previewPageIndex, setPreviewPageIndex] = useState(0);
    const [likeBusyId, setLikeBusyId] = useState<string | null>(null);
    const [remixBusyId, setRemixBusyId] = useState<string | null>(null);

    // Remix confirm modal state
    const [confirmRemixBuild, setConfirmRemixBuild] = useState<CommunityBuild | null>(null);

    const router = useRouter();
    const viewedOnceRef = useRef<Set<string>>(new Set());

    function patchItem(id: string, patch: Partial<CommunityBuild>) {
        setState((s) => {
            if (s.status !== "loaded") return s;
            return {
                status: "loaded",
                items: s.items.map((b) => (b.id === id ? { ...b, ...patch } : b)),
            };
        });
    }

    const postJsonAuthed = useCallback(async (path: string, body: any) => {
        async function buildHeaders(forceRefreshToken: boolean) {
            const csrf = await ensureSessionAndCsrf().catch(() => null);

            const user = await waitForAuthUser();
            let idToken: string | null = null;
            if (user) {
                try {
                    idToken = await getIdToken(user, forceRefreshToken);
                } catch {
                    idToken = null;
                }
            }

            const headers: Record<string, string> = {
                "content-type": "application/json",
            };

            if (csrf) headers["x-csrf-token"] = String(csrf);
            if (idToken) headers["authorization"] = `Bearer ${idToken}`;

            return headers;
        }

        const headers1 = await buildHeaders(false);
        const res1 = await fetch(path, {
            method: "POST",
            headers: headers1,
            body: JSON.stringify(body ?? {}),
            cache: "no-store",
            credentials: "include",
        });

        if (res1.status === 401) {
            await delay(50);
            const headers2 = await buildHeaders(true);
            return fetch(path, {
                method: "POST",
                headers: headers2,
                body: JSON.stringify(body ?? {}),
                cache: "no-store",
                credentials: "include",
            });
        }

        if (res1.status === 403 || res1.status === 400) {
            const cloned = res1.clone();
            const data = await cloned.json().catch(() => null);
            if (data?.error && String(data.error).toLowerCase().includes("csrf")) {
                await delay(50);
                const headers2 = await buildHeaders(true);
                return fetch(path, {
                    method: "POST",
                    headers: headers2,
                    body: JSON.stringify(body ?? {}),
                    cache: "no-store",
                    credentials: "include",
                });
            }
        }

        return res1;
    }, []);

    useEffect(() => {
        let cancelled = false;
        setState({ status: "loading" });

        (async () => {
            try {
                const res = await fetch("/api/gallery/list", {
                    cache: "no-store",
                    credentials: "include",
                });

                const data = await res.json().catch(() => ({} as any));
                if (!res.ok || data?.error) {
                    throw new Error(data?.error || "Failed to load community builds");
                }

                const raw: any[] = Array.isArray(data.items) ? data.items : [];

                const items: CommunityBuild[] = raw.map((it) => {
                    const views = getCount(it, "views", 0);
                    const likes = getCount(it, "likes", 0);
                    const remixes = getCount(it, "remixes", 0);

                    return {
                        id: String(it.id || ""),
                        renderId: it.renderId ?? it.sourceRenderId ?? null,
                        name: String(it.name || "Untitled build"),
                        author: it.author ?? null,
                        createdAt: toMillisMaybeTimestamp(it.createdAt),
                        remixable: !!it.remixable,
                        approved: !!it.approved,
                        screenshotKey: it.screenshotKey ?? null,
                        screenshotUrl: it.screenshotUrl ?? null,
                        html: it.html ?? null,
                        views,
                        likes,
                        remixes,
                        likedByMe: !!it.likedByMe,
                    };
                });

                if (cancelled) return;
                setState({ status: "loaded", items });
            } catch (err: any) {
                if (cancelled) return;
                setState({
                    status: "error",
                    message:
                        err?.message ||
                        "Unable to load community builds. Try again shortly.",
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const items = state.status === "loaded" ? state.items : [];

    // Actual remix execution (called only after confirm)
    const runRemix = useCallback(
        async (build: CommunityBuild) => {
            if (!build?.remixable) return;
            if (!build?.html) return;
            if (remixBusyId) return;

            setRemixBusyId(build.id);

            try {
                const res = await postJsonAuthed("/api/gallery/remix", {
                    buildId: build.id,
                    sourceRenderId: build.renderId,
                });

                const data = await res.json().catch(() => ({} as any));

                if (!res.ok || data?.error) {
                    if (res.status === 401) {
                        router.push(`/login?next=${encodeURIComponent("/community-builds")}`);
                        return;
                    }
                    console.warn("[remix] failed", res.status, data?.error || data);
                    return;
                }

                const newRenderId = String(data?.renderId || "");
                if (!newRenderId) {
                    console.warn("[remix] missing renderId", data);
                    return;
                }

                patchItem(build.id, { remixes: (build.remixes ?? 0) + 1 });
                router.push(
                    `/dashboard/view?render=${encodeURIComponent(newRenderId)}&remixed=1`,
                );
            } finally {
                setRemixBusyId(null);
            }
        },
        [postJsonAuthed, remixBusyId, router],
    );

    // Opens confirm modal instead of remixing immediately
    function handleRemix(build: CommunityBuild) {
        if (!build?.remixable) return;
        if (!build?.html) return;
        if (remixBusyId) return;
        setConfirmRemixBuild(build);
    }

    function handleBackToCommunity() {
        setPreviewId(null);
        setPreviewPageIndex(0);
    }

    async function trackViewOnce(buildId: string) {
        if (!buildId) return;
        if (viewedOnceRef.current.has(buildId)) return;
        viewedOnceRef.current.add(buildId);

        patchItem(buildId, {
            views: (items.find((x) => x.id === buildId)?.views ?? 0) + 1,
        });

        try {
            await postJsonAuthed("/api/gallery/track-view", { buildId });
        } catch {
            // ignore
        }
    }

    async function handleToggleLike(build: CommunityBuild) {
        if (!build?.id) return;
        if (likeBusyId) return;

        setLikeBusyId(build.id);

        const prevLiked = !!build.likedByMe;
        const prevLikes = toNum(build.likes, 0);

        patchItem(build.id, {
            likedByMe: !prevLiked,
            likes: Math.max(0, prevLikes + (prevLiked ? -1 : 1)),
        });

        try {
            const res = await postJsonAuthed("/api/gallery/toggle-like", {
                buildId: build.id,
            });

            const data = await res.json().catch(() => ({} as any));

            if (!res.ok || data?.error) {
                patchItem(build.id, { likedByMe: prevLiked, likes: prevLikes });

                if (res.status === 401) {
                    router.push(`/login?next=${encodeURIComponent("/community-builds")}`);
                    return;
                }

                console.warn("[toggle-like] failed", res.status, data?.error || data);
                return;
            }

            if (
                typeof data?.likes !== "undefined" ||
                typeof data?.likedByMe !== "undefined"
            ) {
                patchItem(build.id, {
                    likes: typeof data.likes === "number" ? data.likes : undefined,
                    likedByMe:
                        typeof data.likedByMe === "boolean" ? data.likedByMe : undefined,
                });
            }
        } finally {
            setLikeBusyId(null);
        }
    }

    function handleOpenPreview(build: CommunityBuild) {
        if (!build.html) return;
        setPreviewId(build.id);
        setPreviewPageIndex(0);
        void trackViewOnce(build.id);
    }

    const previewBuild =
        previewId && state.status === "loaded"
            ? state.items.find((b) => b.id === previewId) || null
            : null;

    const derivedPages = useMemo(
        () => (previewBuild ? derivePagesFromHtml(previewBuild.html) : []),
        [previewBuild?.html],
    );

    useEffect(() => {
        if (!derivedPages.length) {
            setPreviewPageIndex(0);
            return;
        }
        setPreviewPageIndex((idx) =>
            idx >= derivedPages.length ? 0 : Math.max(0, idx),
        );
    }, [derivedPages.length]);

    const activePage =
        derivedPages.length > 0
            ? derivedPages[previewPageIndex] ?? derivedPages[0]
            : null;

    const activePageHtml =
        activePage?.html ?? previewBuild?.html ?? "<!doctype html><html></html>";

    const totalPages = derivedPages.length || 1;

    if (state.status === "loading" || state.status === "idle") {
        return <KlonerLoader />;
    }

    if (state.status === "error") {
        return (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {state.message}
            </div>
        );
    }

    if (!items.length) {
        return (
            <div className="rounded-2xl border border-black/10 bg-white px-4 py-6 text-sm text-black/65">
                No community builds have been approved yet. Check back soon.
            </div>
        );
    }

    return (
        <>
            <section className="flex flex-col gap-6">
                <div className="mx-auto w-full">
                    <div className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-2">
                        {items.map((item) => {
                            const firstPageHtml =
                                derivePagesFromHtml(item.html)?.[0]?.html ?? item.html ?? "";

                            const canRemix = item.remixable && !!item.html;

                            return (
                                <motion.div
                                    key={item.id}
                                    className="flex h-[24rem] w-full flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_14px_32px_rgba(15,23,42,0.10)]"
                                    whileHover={{
                                        y: -3,
                                        boxShadow: "0 20px 40px rgba(15,23,42,0.14)",
                                    }}
                                    transition={{ type: "spring", stiffness: 160, damping: 18 }}
                                >
                                    <div className="relative h-[70%] w-full overflow-hidden bg-neutral-100 group">
                                        {firstPageHtml ? (
                                            <div className="absolute inset-0 overflow-hidden opacity-90 transition group-hover:opacity-100">
                                                <div className="absolute left-0 top-0 origin-top-left scale-[0.32] pointer-events-none">
                                                    <iframe
                                                        title={item.name}
                                                        srcDoc={firstPageHtml}
                                                        className="h-[1200px] w-[1200px] bg-white"
                                                        sandbox="allow-same-origin"
                                                    />
                                                </div>
                                                <div className="absolute inset-0 bg-white/30" />
                                            </div>
                                        ) : item.screenshotUrl ? (
                                            <motion.img
                                                src={item.screenshotUrl}
                                                alt={item.name}
                                                className="absolute inset-0 h-full w-full object-cover object-top opacity-35 transition group-hover:opacity-100"
                                                initial={{ scale: 1.03, opacity: 0.35 }}
                                                animate={{ scale: 1, opacity: 0.35 }}
                                                transition={{ duration: 0.6 }}
                                                loading="lazy"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_#e5e7eb,_#f3f4f6)]">
                                                <div className="rounded-full border border-dashed border-black/10 px-4 py-2 text-xs text-black/50">
                                                    No preview available
                                                </div>
                                            </div>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => handleOpenPreview(item)}
                                            className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-white font-medium text-sm transition bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100"
                                        >
                                            <div className="flex flex-inline items-end gap-1 rounded-full bg-[rgba(245,95,42,0.95)] px-4 py-1.5 text-white text-sm shadow-sm hover:bg-[rgba(215,75,22,1)] transition">
                                                <span>See preview</span>
                                                <Eye className="h-4 w-4" />
                                            </div>
                                        </button>
                                    </div>

                                    <div className="flex flex-1 items-start justify-between gap-3 border-t border-black/5 bg-white px-4 py-2">
                                        <div className="min-w-0">
                                            <p className="text-[10px] uppercase tracking-[0.26em] text-black/45">
                                                Community build
                                            </p>
                                            <p className="mt-1 truncate text-[14px] font-semibold text-black">
                                                {item.name}
                                            </p>

                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-black/55">
                                                {item.remixable ? (
                                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                                        Remixable
                                                    </span>
                                                ) : (
                                                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">
                                                        Not remixable
                                                    </span>
                                                )}

                                                <span className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2 py-0.5 text-black/60">
                                                    <Eye className="h-3.5 w-3.5" />
                                                    {formatCount(item.views)}
                                                </span>

                                                <button
                                                    type="button"
                                                    onClick={() => void handleToggleLike(item)}
                                                    disabled={likeBusyId === item.id}
                                                    className={[
                                                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition",
                                                        item.likedByMe
                                                            ? "border-[rgba(245,95,42,0.35)] bg-[rgba(245,95,42,0.10)] text-[rgba(145,54,14,0.98)]"
                                                            : "border-black/10 bg-white text-black/60 hover:bg-black/[0.03]",
                                                        likeBusyId === item.id
                                                            ? "opacity-60 pointer-events-none"
                                                            : "",
                                                    ].join(" ")}
                                                    aria-label="Like build"
                                                    title="Like"
                                                >
                                                    <Heart
                                                        className={[
                                                            "h-3.5 w-3.5",
                                                            item.likedByMe ? "fill-current" : "",
                                                        ].join(" ")}
                                                    />
                                                    {formatCount(item.likes)}
                                                </button>

                                                <span className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2 py-0.5 text-black/60">
                                                    <Repeat2 className="h-3.5 w-3.5" />
                                                    {formatCount(item.remixes)}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-end gap-2 text-right text-[11px] text-black/55">
                                            <button
                                                type="button"
                                                onClick={() => handleRemix(item)}
                                                disabled={!canRemix || remixBusyId === item.id}
                                                className={[
                                                    "group inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition",
                                                    "shadow-[0_10px_24px_rgba(15,23,42,0.10)]",
                                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(245,95,42,0.35)] focus-visible:ring-offset-2",
                                                    canRemix
                                                        ? "bg-[rgba(245,95,42,1)] text-white hover:bg-[rgba(215,75,22,1)]"
                                                        : "bg-neutral-100 text-black/40 shadow-none cursor-not-allowed",
                                                    remixBusyId === item.id ? "opacity-80" : "",
                                                ].join(" ")}
                                            >
                                                <span
                                                    className={[
                                                        "inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20",
                                                        canRemix
                                                            ? "group-hover:bg-white/20"
                                                            : "bg-black/5 ring-black/10",
                                                    ].join(" ")}
                                                >
                                                    {remixBusyId === item.id ? (
                                                        <svg
                                                            className="h-4 w-4 animate-spin"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            aria-hidden="true"
                                                        >
                                                            <circle
                                                                cx="12"
                                                                cy="12"
                                                                r="9"
                                                                stroke="currentColor"
                                                                strokeWidth="2.5"
                                                                opacity="0.25"
                                                            />
                                                            <path
                                                                d="M21 12a9 9 0 0 1-9 9"
                                                                stroke="currentColor"
                                                                strokeWidth="2.5"
                                                                strokeLinecap="round"
                                                            />
                                                        </svg>
                                                    ) : (
                                                        <svg
                                                            className="h-4 w-4"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            aria-hidden="true"
                                                        >
                                                            <path
                                                                d="M7 7h6a4 4 0 0 1 4 4v1"
                                                                stroke="currentColor"
                                                                strokeWidth="2.25"
                                                                strokeLinecap="round"
                                                            />
                                                            <path
                                                                d="M17 7l2 2-2 2"
                                                                stroke="currentColor"
                                                                strokeWidth="2.25"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                            />
                                                            <path
                                                                d="M17 17H11a4 4 0 0 1-4-4v-1"
                                                                stroke="currentColor"
                                                                strokeWidth="2.25"
                                                                strokeLinecap="round"
                                                            />
                                                            <path
                                                                d="M7 17l-2-2 2-2"
                                                                stroke="currentColor"
                                                                strokeWidth="2.25"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                            />
                                                        </svg>
                                                    )}
                                                </span>

                                                {remixBusyId === item.id
                                                    ? "Remixing…"
                                                    : canRemix
                                                        ? "Remix"
                                                        : "Remix disabled"}
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-2 text-xs text-black/55">
                    Showing {items.length} approved build{items.length === 1 ? "" : "s"}.
                </div>
            </section>

            {/* Remix confirm modal */}
            <AnimatePresence>
                {confirmRemixBuild && (
                    <motion.div
                        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="w-full max-w-md overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.22)]"
                            initial={{ y: 14, scale: 0.98, opacity: 0 }}
                            animate={{ y: 0, scale: 1, opacity: 1 }}
                            exit={{ y: 10, scale: 0.985, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 140, damping: 18 }}
                            role="dialog"
                            aria-modal="true"
                            aria-label="Confirm remix"
                        >
                            <div className="border-b border-black/10 px-5 py-4">
                                <p className="text-[12px] uppercase tracking-[0.22em] text-black/45">
                                    Confirm remix
                                </p>
                                <p className="mt-1 text-[15px] font-semibold text-black">
                                    Remix “{confirmRemixBuild.name}”?
                                </p>
                                <p className="mt-2 text-[12px] leading-5 text-black/60">
                                    This will clone the build into your account as a new editable preview.
                                </p>
                            </div>

                            <div className="flex items-center justify-end gap-2 px-5 py-4">
                                <button
                                    type="button"
                                    onClick={() => setConfirmRemixBuild(null)}
                                    disabled={!!remixBusyId}
                                    className={[
                                        "rounded-full border px-4 py-2 text-[12px] font-semibold transition",
                                        "border-black/10 bg-white text-black/70 hover:bg-black/[0.03]",
                                        remixBusyId ? "opacity-60 pointer-events-none" : "",
                                    ].join(" ")}
                                >
                                    Cancel
                                </button>

                                <button
                                    type="button"
                                    onClick={async () => {
                                        const b = confirmRemixBuild;
                                        setConfirmRemixBuild(null);
                                        if (b) await runRemix(b);
                                    }}
                                    disabled={!!remixBusyId}
                                    className={[
                                        "rounded-full px-4 py-2 text-[12px] font-semibold text-white transition",
                                        "bg-[rgba(245,95,42,1)] hover:bg-[rgba(215,75,22,1)]",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(245,95,42,0.35)] focus-visible:ring-offset-2",
                                        remixBusyId ? "opacity-80 pointer-events-none" : "",
                                    ].join(" ")}
                                >
                                    Confirm remix
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {previewBuild && previewBuild.html && (
                    <motion.div
                        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3 sm:p-6"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white"
                            initial={{ y: 20, scale: 0.96, opacity: 0 }}
                            animate={{ y: 0, scale: 1, opacity: 1 }}
                            exit={{ y: 12, scale: 0.97, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 120, damping: 18 }}
                        >
                            <div className="border-b border-black/10 px-4 py-3 sm:px-5">
                                <div className="grid grid-cols-[auto,1fr,auto] items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={handleBackToCommunity}
                                        aria-label="Back to community"
                                        className="inline-flex items-center justify-center py-2 px-3 rounded-full bg-accent text-white shadow-md transition hover:bg-[rgba(215,75,22,1)]"
                                    >
                                        <MoveLeftIcon className="h-4 w-4" />
                                        <p className="mx-1 text-[11px]">Back</p>
                                    </button>

                                    <div className="min-w-0">
                                        <p className="truncate text-[13px] font-medium text-black text-center sm:text-left">
                                            {previewBuild.name}
                                        </p>

                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-black/55 justify-center sm:justify-start">
                                            <span className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2 py-0.5">
                                                <Eye className="h-3.5 w-3.5" />
                                                {formatCount(previewBuild.views)}
                                            </span>

                                            <button
                                                type="button"
                                                onClick={() => void handleToggleLike(previewBuild)}
                                                disabled={likeBusyId === previewBuild.id}
                                                className={[
                                                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition",
                                                    previewBuild.likedByMe
                                                        ? "border-[rgba(245,95,42,0.35)] bg-[rgba(245,95,42,0.10)] text-[rgba(145,54,14,0.98)]"
                                                        : "border-black/10 bg-white text-black/60 hover:bg-black/[0.03]",
                                                    likeBusyId === previewBuild.id
                                                        ? "opacity-60 pointer-events-none"
                                                        : "",
                                                ].join(" ")}
                                                aria-label="Like build"
                                                title="Like"
                                            >
                                                <Heart
                                                    className={[
                                                        "h-3.5 w-3.5",
                                                        previewBuild.likedByMe ? "fill-current" : "",
                                                    ].join(" ")}
                                                />
                                                {formatCount(previewBuild.likes)}
                                            </button>

                                            <span className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2 py-0.5">
                                                <Repeat2 className="h-3.5 w-3.5" />
                                                {formatCount(previewBuild.remixes)}
                                            </span>

                                            <span className="text-black/35">·</span>

                                            <p className="text-[11px] text-black/55">
                                                Read-only preview (use arrows to switch pages)
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-end">
                                        {previewBuild.remixable && previewBuild.html && (
                                            <button
                                                type="button"
                                                onClick={() => handleRemix(previewBuild)}
                                                disabled={remixBusyId === previewBuild.id}
                                                className={[
                                                    "group hidden items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold sm:inline-flex transition",
                                                    "shadow-[0_10px_24px_rgba(15,23,42,0.10)]",
                                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(245,95,42,0.35)] focus-visible:ring-offset-2",
                                                    remixBusyId === previewBuild.id
                                                        ? "bg-[rgba(245,95,42,0.85)] text-white opacity-80 pointer-events-none"
                                                        : "bg-[rgba(245,95,42,1)] text-white hover:bg-[rgba(215,75,22,1)]",
                                                ].join(" ")}
                                            >
                                                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20 group-hover:bg-white/20">
                                                    {remixBusyId === previewBuild.id ? (
                                                        <svg
                                                            className="h-4 w-4 animate-spin"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            aria-hidden="true"
                                                        >
                                                            <circle
                                                                cx="12"
                                                                cy="12"
                                                                r="9"
                                                                stroke="currentColor"
                                                                strokeWidth="2.5"
                                                                opacity="0.25"
                                                            />
                                                            <path
                                                                d="M21 12a9 9 0 0 1-9 9"
                                                                stroke="currentColor"
                                                                strokeWidth="2.5"
                                                                strokeLinecap="round"
                                                            />
                                                        </svg>
                                                    ) : (
                                                        <svg
                                                            className="h-4 w-4"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            aria-hidden="true"
                                                        >
                                                            <path
                                                                d="M7 7h6a4 4 0 0 1 4 4v1"
                                                                stroke="currentColor"
                                                                strokeWidth="2.25"
                                                                strokeLinecap="round"
                                                            />
                                                            <path
                                                                d="M17 7l2 2-2 2"
                                                                stroke="currentColor"
                                                                strokeWidth="2.25"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                            />
                                                            <path
                                                                d="M17 17H11a4 4 0 0 1-4-4v-1"
                                                                stroke="currentColor"
                                                                strokeWidth="2.25"
                                                                strokeLinecap="round"
                                                            />
                                                            <path
                                                                d="M7 17l-2-2 2-2"
                                                                stroke="currentColor"
                                                                strokeWidth="2.25"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                            />
                                                        </svg>
                                                    )}
                                                </span>

                                                {remixBusyId === previewBuild.id ? "Remixing…" : "Remix"}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="relative flex-1 bg-neutral-100">
                                <div className="absolute inset-2 overflow-hidden rounded-xl border border-black/10 bg-white">
                                    <iframe
                                        title={previewBuild.name}
                                        srcDoc={`
                      ${activePageHtml}
                      <style>
                        * { cursor: default !important; }
                        a, button, input, select, textarea { pointer-events: none !important; }
                        [role="link"], [onclick], [data-clickable] { pointer-events: none !important; }
                      </style>
                    `}
                                        className="h-full w-full overflow-auto"
                                        sandbox="allow-same-origin"
                                    />

                                    {totalPages > 1 && (
                                        <>
                                            <button
                                                type="button"
                                                aria-label="Previous page"
                                                onClick={() =>
                                                    setPreviewPageIndex((i) => Math.max(0, i - 1))
                                                }
                                                disabled={previewPageIndex === 0}
                                                className="absolute left-6 top-1/2 z-10 flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full bg-[rgba(245,95,42,1)] text-white shadow-lg hover:bg-[rgba(215,75,22,1)] disabled:opacity-40"
                                            >
                                                <ChevronLeft className="h-10 w-10" strokeWidth={2.5} />
                                            </button>

                                            <button
                                                type="button"
                                                aria-label="Next page"
                                                onClick={() =>
                                                    setPreviewPageIndex((i) =>
                                                        Math.min(totalPages - 1, i + 1),
                                                    )
                                                }
                                                disabled={previewPageIndex === totalPages - 1}
                                                className="absolute right-7 top-1/2 z-10 flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full bg-[rgba(245,95,42,1)] text-white shadow-lg hover:bg-[rgba(215,75,22,1)] disabled:opacity-40"
                                            >
                                                <ChevronRight className="h-10 w-10" strokeWidth={2.5} />
                                            </button>

                                            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white">
                                                Page {previewPageIndex + 1} of {totalPages}
                                                {activePage?.label ? ` · ${activePage.label}` : null}
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/10 via-white/0 to-transparent" />
                            </div>

                            <div className="flex items-center justify-between gap-3 border-t border-black/10 px-4 py-3 text-[11px] text-black/60 sm:px-5">
                                <span className="line-clamp-1">
                                    Preview is read-only. Use the large arrows on the sides to flip
                                    through pages.
                                </span>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
