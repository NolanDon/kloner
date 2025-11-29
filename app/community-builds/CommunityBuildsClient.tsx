// src/app/community-builds/CommunityBuildsClient.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import KlonerLoader from "@/components/KlonerLoader";

type DerivedPage = {
    id: string;
    label: string;
    html: string;
};

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
};

type State =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; items: CommunityBuild[] }
    | { status: "error"; message: string };

const ACCENT = "#f55f2a";

function stripScripts(html: string): string {
    return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}

function stripEditorArtifacts(html: string): string {
    return html;
}

function labelFromRoute(route: string): string {
    if (!route || route === "/") return "Home";
    const clean = route.replace(/^\//, "");
    return clean
        .split(/[\/-]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" / ");
}

function derivePagesFromHtml(html: string | null | undefined): DerivedPage[] {
    if (!html) return [];
    if (typeof window === "undefined") return [];

    try {
        const cleaned = stripScripts(stripEditorArtifacts(html));
        const parser = new DOMParser();
        const doc = parser.parseFromString(cleaned, "text/html");
        const mains = Array.from(
            doc.querySelectorAll("main.page-root[data-route]")
        ) as HTMLElement[];

        if (!mains.length) return [];

        return mains.map((el) => {
            const route = el.getAttribute("data-route") || "/";
            const labelAttr = el.getAttribute("data-label") || "";
            const label = labelAttr || labelFromRoute(route);

            const clonedDoc = doc.cloneNode(true) as Document;
            const clonedMains = Array.from(
                clonedDoc.querySelectorAll("main.page-root[data-route]")
            ) as HTMLElement[];

            clonedMains.forEach((m) => {
                if (m.getAttribute("data-route") !== route) m.remove();
            });

            const serialized =
                "<!DOCTYPE html>" + clonedDoc.documentElement.outerHTML;

            return {
                id: route,
                label,
                html: serialized,
            };
        });
    } catch {
        return [];
    }
}

export default function CommunityBuildsClient() {
    const [state, setState] = useState<State>({ status: "idle" });
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [previewPageIndex, setPreviewPageIndex] = useState(0);
    const router = useRouter();

    useEffect(() => {
        let cancelled = false;
        setState({ status: "loading" });

        (async () => {
            try {
                const res = await fetch("/api/gallery/list", { cache: "no-store" });
                const data = await res.json().catch(() => ({} as any));

                if (!res.ok || data.error) {
                    throw new Error(data.error || "Failed to load community builds");
                }

                const items: CommunityBuild[] = Array.isArray(data.items)
                    ? data.items
                    : [];

                if (cancelled) return;

                setState({ status: "loaded", items });
            } catch (err: any) {
                if (cancelled) return;
                setState({
                    status: "error",
                    message:
                        err?.message || "Unable to load community builds. Try again shortly.",
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const items = state.status === "loaded" ? state.items : [];

    function handleRemix(build: CommunityBuild) {
        if (!build.remixable || !build.renderId) return;
        router.push(`/dashboard/view?remixFrom=${encodeURIComponent(build.renderId)}`);
    }

    function handleOpenPreview(build: CommunityBuild) {
        if (!build.html) return;
        setPreviewId(build.id);
        setPreviewPageIndex(0);
    }

    const previewBuild =
        previewId && state.status === "loaded"
            ? state.items.find((b) => b.id === previewId) || null
            : null;

    const derivedPages = useMemo(
        () => (previewBuild ? derivePagesFromHtml(previewBuild.html) : []),
        [previewBuild?.html]
    );

    useEffect(() => {
        if (!derivedPages.length) {
            setPreviewPageIndex(0);
            return;
        }
        setPreviewPageIndex((idx) =>
            idx >= derivedPages.length ? 0 : Math.max(0, idx)
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
        return (
            <KlonerLoader />
        );
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex flex-col gap-1">
                        <p className="text-[11px] uppercase tracking-[0.24em] text-black/45">
                            Featured builds
                        </p>
                        <p className="max-w-xl text-sm text-black/65">
                            Scroll through approved layouts, open an interactive preview, or
                            remix a project into your own Kloner workspace.
                        </p>
                    </div>
                </div>

                <div className="mx-auto flex w-full max-w-5xl flex-wrap gap-5">
                    {items.map((item) => {
                        const firstPageHtml =
                            derivePagesFromHtml(item.html)?.[0]?.html ?? item.html ?? "";

                        return (
                            <motion.div
                                key={item.id}
                                className="flex h-[22rem] w-full flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_14px_32px_rgba(15,23,42,0.12)] sm:w-[calc(50%-0.625rem)]"
                                whileHover={{
                                    y: -4,
                                    boxShadow: "0 20px 40px rgba(15,23,42,0.16)",
                                }}
                                transition={{ type: "spring", stiffness: 160, damping: 18 }}
                            >
                                {/* PREVIEW AREA WITH FADED/BLURRED SITE + CTA OVERLAY */}
                                <div className="relative h-[65%] w-full overflow-hidden bg-neutral-100 group">
                                    {firstPageHtml ? (
                                        <div className="absolute inset-0 overflow-hidden rounded-xl opacity-50 group-hover:opacity-40 transition">
                                            <iframe
                                                title={item.name}
                                                srcDoc={firstPageHtml}
                                                className="h-full w-full pointer-events-none blur-[2px]"
                                                sandbox="allow-same-origin allow-scripts allow-forms allow-pointer-lock allow-modals allow-popups"
                                            />
                                        </div>
                                    ) : item.screenshotUrl ? (
                                        <motion.img
                                            src={item.screenshotUrl}
                                            alt={item.name}
                                            className="absolute inset-0 h-full w-full object-cover object-top opacity-60 blur-[1px] group-hover:opacity-45"
                                            initial={{ scale: 1.03, opacity: 0.7 }}
                                            animate={{ scale: 1, opacity: 0.8 }}
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
                                        <span className="h-10 w-10 rounded-full bg-white/90 text-[rgba(245,95,42,1)] flex items-center justify-center shadow-md">
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                className="h-5 w-5"
                                            >
                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                                <circle cx="12" cy="12" r="3" />
                                            </svg>
                                        </span>
                                        <span className="rounded-full bg-[rgba(245,95,42,0.95)] px-4 py-1.5 text-white text-sm shadow-sm hover:bg-[rgba(245,95,42,1)] transition">
                                            See live preview
                                        </span>
                                    </button>
                                </div>

                                <div className="flex flex-1 items-center justify-between gap-3 border-t border-black/5 bg-white px-4 py-3 sm:px-5 sm:py-4">
                                    <div className="min-w-0">
                                        <p className="text-[10px] uppercase tracking-[0.26em] text-black/45 sm:text-[11px]">
                                            Community build
                                        </p>
                                        <p className="mt-1 truncate text-[14px] font-semibold text-black sm:text-[15px]">
                                            {item.name}
                                        </p>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-black/55">
                                            {item.remixable && (
                                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                                    Remixable
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end gap-2 text-right text-[11px] text-black/55">


                                        <button
                                            type="button"
                                            onClick={() => handleRemix(item)}
                                            disabled={!item.remixable || !item.renderId}
                                            className={[
                                                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-40",
                                                item.remixable && item.renderId
                                                    ? "border border-transparent bg-[rgba(245,95,42,0.08)] text-[rgba(145,54,14,0.98)] hover:bg-[rgba(245,95,42,0.16)]"
                                                    : "border border-black/10 bg-neutral-50 text-black/35 cursor-not-allowed",
                                            ].join(" ")}
                                        >
                                            {item.remixable && item.renderId
                                                ? "Remix this build"
                                                : "Remix disabled"}
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>

                <div className="mt-2 text-xs text-black/55">
                    Showing {items.length} approved build{items.length === 1 ? "" : "s"}.
                </div>
            </section>

            <AnimatePresence>
                {previewBuild && previewBuild.html && (
                    <motion.div
                        className="fixed inset-0 z-[80] flex items-center justifycenter bg-black/40 p-3 sm:p-6"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="relative flex h-full w-full max-w-8xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white"
                            initial={{ y: 20, scale: 0.96, opacity: 0 }}
                            animate={{ y: 0, scale: 1, opacity: 1 }}
                            exit={{ y: 12, scale: 0.97, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 120, damping: 18 }}
                        >
                            <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 sm:px-5">
                                <div className="min-w-0">
                                    <p className="truncate text-[13px] font-medium text-black">
                                        {previewBuild.name}
                                    </p>
                                    <p className="mt-0.5 text-[11px] text-black/55">
                                        Read-only preview (use arrows to switch pages)
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {previewBuild.remixable && previewBuild.renderId && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                handleRemix(previewBuild);
                                            }}
                                            className="hidden items-center gap-1.5 rounded-full border border-transparent bg-[rgba(245,95,42,0.08)] px-3 py-1.5 text-sm font-medium text-[rgba(145,54,14,0.98)] hover:bg-[rgba(245,95,42,0.16)] sm:inline-flex"
                                        >
                                            Remix this build
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setPreviewId(null)}
                                        className="rounded-full bg-accent px-3 py-1 text-[11px] text-white text-sm font-semibold hover:bg-opacity-90"
                                    >
                                        Close
                                    </button>
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
                                                a, button, input, select, textarea {
                                                pointer-events: none !important;
                                                }
                                                [role="link"], [onclick], [data-clickable] {
                                                pointer-events: none !important;
                                                }
                                            </style>
                                            `}
                                        className="h-full w-full overflow-auto"
                                        sandbox="allow-same-origin allow-scripts"
                                        scrolling="yes"
                                    />

                                    {totalPages > 1 && (
                                        <>
                                            <button
                                                type="button"
                                                aria-label="Previous page"
                                                onClick={() =>
                                                    setPreviewPageIndex((idx) =>
                                                        Math.max(0, idx - 1)
                                                    )
                                                }
                                                disabled={previewPageIndex === 0}
                                                className="absolute left-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(245,95,42,0.6)] bg-white/95 text-2xl font-semibold text-[rgba(245,95,42,1)] shadow-md backdrop-blur transition hover:bg-[rgba(245,95,42,0.06)] hover:border-[rgba(245,95,42,0.95)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(245,95,42,0.9)] disabled:opacity-35 disabled:hover:bg-white"
                                            >
                                                {"<"}
                                            </button>
                                            <button
                                                type="button"
                                                aria-label="Next page"
                                                onClick={() =>
                                                    setPreviewPageIndex((idx) =>
                                                        Math.min(totalPages - 1, idx + 1)
                                                    )
                                                }
                                                disabled={previewPageIndex === totalPages - 1}
                                                className="absolute right-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(245,95,42,0.6)] bg-white/95 text-2xl font-semibold text-[rgba(245,95,42,1)] shadow-md backdrop-blur transition hover:bg-[rgba(245,95,42,0.06)] hover:border-[rgba(245,95,42,0.95)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(245,95,42,0.9)] disabled:opacity-35 disabled:hover:bg-white"
                                            >
                                                {">"}
                                            </button>

                                            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white">
                                                Page {previewPageIndex + 1} of {totalPages}
                                                {activePage?.label
                                                    ? ` · ${activePage.label}`
                                                    : null}
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
                                {previewBuild.remixable && previewBuild.renderId && (
                                    <button
                                        type="button"
                                        onClick={() => handleRemix(previewBuild)}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-[rgba(245,95,42,0.08)] px-3 py-1.5 text-[11px] font-medium text-[rgba(145,54,14,0.98)] hover:bg-[rgba(245,95,42,0.16)]"
                                    >
                                        Remix in dashboard
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
