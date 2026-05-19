// components/AiImageLibraryPanel.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject, DragEvent } from "react";
import { ref, listAll, getDownloadURL } from "firebase/storage";
import { ArrowUpRight, Image as ImageIcon, MessageCircleWarning, RefreshCcw, Trash2 } from "lucide-react";
import { storage } from "@/lib/firebase";
import type { User as FirebaseUser } from "firebase/auth";
import { useModal } from "@/components/ui/ModalContext";

type AiLibraryItem = {
    url: string;
    path: string;
    name: string;
};

type PageImageItem = {
    key: string;
    selector: string;
    kind: "image" | "background";
    label: string;
    src: string;
    path: string | null;
    description: string;
};

type Props = {
    iframeRef: RefObject<HTMLIFrameElement>;
    user: FirebaseUser | null;
    renderId: string | null;
    isVercelConnected?: boolean;
    onConnectVercel?: () => void;
};

const VERCEL_INTEGRATION_SLUG = process.env.NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG || "kloner";
const AI_IMAGE_RESUME_KEY = "kloner_vercel_pending_ai_images";

function escapeCssValue(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
    }
    return String(value).replace(/"/g, "\\\"");
}

function buildSelector(el: Element): string {
    const path = el.getAttribute("data-kloner-path") || el.getAttribute("data-kloner-bg-path") || el.getAttribute("data-local-image-id");
    if (path) {
        const attr = el.getAttribute("data-kloner-path") ? "data-kloner-path" : el.getAttribute("data-kloner-bg-path") ? "data-kloner-bg-path" : "data-local-image-id";
        return `[${attr}="${escapeCssValue(path)}"]`;
    }

    const segments: string[] = [];
    let node: Element | null = el;

    while (node && node.tagName.toLowerCase() !== "html") {
        const current: Element = node;
        const tagName = current.tagName;
        const tag = tagName.toLowerCase();
        const parent: HTMLElement | null = current.parentElement;
        if (!parent) {
            segments.unshift(tag);
            break;
        }

        const sameTagSiblings: HTMLElement[] = [];
        for (const child of Array.from(parent.children)) {
            if (child.tagName === tagName) {
                sameTagSiblings.push(child as HTMLElement);
            }
        }
        const index = sameTagSiblings.indexOf(current as HTMLElement) + 1;
        segments.unshift(sameTagSiblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);

        if (current.id) {
            segments[0] = `${tag}#${escapeCssValue(current.id)}${sameTagSiblings.length > 1 ? `:nth-of-type(${index})` : ""}`;
            break;
        }

        node = parent;
    }

    return segments.join(" > ");
}

function getFileName(value: string): string {
    const raw = String(value || "");
    const noQuery = raw.split("?")[0].split("#")[0];
    const parts = noQuery.split("/").filter(Boolean);
    return parts[parts.length - 1] || raw;
}

function scanPageImages(doc: Document): PageImageItem[] {
    const items: PageImageItem[] = [];
    const seen = new Set<string>();

    const pushItem = (item: PageImageItem) => {
        if (seen.has(item.key)) return;
        seen.add(item.key);
        items.push(item);
    };

    doc.querySelectorAll<HTMLImageElement>("img[src]").forEach((img, index) => {
        const src = img.currentSrc || img.src || "";
        if (!src) return;

        const selector = buildSelector(img);
        pushItem({
            key: `img:${selector}:${index}`,
            selector,
            kind: "image",
            label: img.getAttribute("alt")?.trim() || img.getAttribute("data-kloner-filename")?.trim() || getFileName(src) || `Image ${index + 1}`,
            src,
            path: img.getAttribute("data-kloner-path"),
            description: img.getAttribute("data-kloner-path") || img.getAttribute("data-local-image-id") || "Inline image",
        });
    });

    doc.querySelectorAll<HTMLElement>("body *").forEach((el, index) => {
        if (el.tagName === "IMG") return;

        const style = doc.defaultView?.getComputedStyle(el);
        const background = style?.backgroundImage || el.style.backgroundImage || "";
        if (!background || background === "none") return;

        const match = background.match(/url\((?:['"]?)(.*?)(?:['"]?)\)/i);
        const src = match?.[1]?.trim();
        if (!src) return;

        const selector = buildSelector(el);
        pushItem({
            key: `bg:${selector}:${index}`,
            selector,
            kind: "background",
            label: el.getAttribute("aria-label")?.trim() || el.getAttribute("data-kloner-label")?.trim() || `${el.tagName.toLowerCase()} background`,
            src,
            path: el.getAttribute("data-kloner-bg-path"),
            description: el.getAttribute("data-kloner-bg-path") || el.getAttribute("data-kloner-bg-old-path") || "Background image",
        });
    });

    return items;
}

function selectImageTarget(iframeRef: RefObject<HTMLIFrameElement>, selector: string): { api: any; element: HTMLElement | null } {
    const win = iframeRef.current?.contentWindow as any;
    const api = win?.__klonerApi;
    const doc = iframeRef.current?.contentDocument;
    if (!api || !doc) return { api: null, element: null };

    const element = doc.querySelector(selector) as HTMLElement | null;
    if (!element) return { api, element: null };

    if (typeof api.select === "function") {
        api.select(element);
    }

    return { api, element };
}

export function AiImageLibraryPanel({ iframeRef, user, renderId, isVercelConnected = false, onConnectVercel }: Props) {
    const { showAlert } = useModal();
    const [items, setItems] = useState<AiLibraryItem[]>([]);
    const [pageImages, setPageImages] = useState<PageImageItem[]>([]);
    const [imageAvailability, setImageAvailability] = useState<Record<string, "ok" | "error">>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const refreshInFlightRef = useRef(false);

    const loadImages = useCallback(async (uidFromProp?: string, renderIdFromProp?: string) => {
        const uid = uidFromProp ?? user?.uid;
        const rid = renderIdFromProp ?? renderId;

        if (!uid || !rid) return;

        setLoading(true);
        setError(null);

        try {
            const paths = [
                `kloner_images/${uid}`,
                `kloner_ai_images/${rid}`,
                `kloner_ai_home/${uid}`,
            ];

            const allItems: AiLibraryItem[] = [];

            for (const basePath of paths) {
                try {
                    const folderRef = ref(storage, basePath);
                    const res = await listAll(folderRef);

                    const fromPath: AiLibraryItem[] = await Promise.all(
                        res.items.map(async (obj) => {
                            const url = await getDownloadURL(obj);
                            return {
                                url,
                                path: obj.fullPath,
                                name: obj.name,
                            };
                        }),
                    );

                    allItems.push(...fromPath);
                } catch (innerErr: any) {
                    const msg = String(innerErr?.message || "");
                    const code = String(innerErr?.code || "").toLowerCase();
                    const status = Number(innerErr?.customData?.serverResponse?.status || innerErr?.status || 0);
                    if (
                        code.includes("unauthorized") ||
                        msg.includes("storage/unauthorized") ||
                        msg.includes("permission") ||
                        msg.includes("denied")
                    ) {
                        console.warn(`[AiImageLibraryPanel] permission issue for path ${basePath}`, innerErr);
                        setError("You don't have permission to load some images.");
                    } else if (code.includes("storage/unknown") || status === 400) {
                        console.info(`[AiImageLibraryPanel] listing unsupported or empty for path ${basePath}`);
                    } else {
                        console.warn(`[AiImageLibraryPanel] skipped path ${basePath}`, innerErr);
                    }
                }
            }

            const dedupMap = new Map<string, AiLibraryItem>();
            allItems.forEach((item) => dedupMap.set(item.path, item));
            const next = Array.from(dedupMap.values());

            next.sort((a, b) => (a.name < b.name ? 1 : -1));
            setItems(next);
        } catch (err: any) {
            console.warn("[AiImageLibraryPanel] failed to load", err);
            setError(err?.message || "Failed to load images");
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [renderId, user?.uid]);

    const refreshPageImages = useCallback(() => {
        const doc = iframeRef.current?.contentDocument;
        if (!doc) {
            setPageImages([]);
            return;
        }
        setPageImages(scanPageImages(doc));
    }, [iframeRef]);

    const markImageAvailability = useCallback((key: string, status: "ok" | "error") => {
        setImageAvailability((prev) => {
            if (prev[key] === status) return prev;
            return { ...prev, [key]: status };
        });
    }, []);

    const startVercelOAuthForImages = useCallback(() => {
        if (typeof window === "undefined") return;
        if (!VERCEL_INTEGRATION_SLUG) {
            console.error("Missing NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG");
            void showAlert("Missing Vercel integration configuration.", "Connect Vercel");
            return;
        }

        try {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            const state = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");

            const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            window.localStorage.setItem(
                AI_IMAGE_RESUME_KEY,
                JSON.stringify({
                    returnTo,
                    startedAt: Date.now(),
                }),
            );
            window.localStorage.setItem("kloner_vercel_latest_csrf", state);

            document.cookie = [
                `vercel_oauth_state=${state}`,
                "Path=/",
                "Max-Age=600",
                "SameSite=Lax",
            ].join("; ");

            document.cookie = [
                `vercel_oauth_return=${encodeURIComponent(returnTo)}`,
                "Path=/",
                "Max-Age=600",
                "SameSite=Lax",
            ].join("; ");

            window.location.assign(`https://vercel.com/integrations/${VERCEL_INTEGRATION_SLUG}/new?state=${state}`);
        } catch (err) {
            console.warn("[AiImageLibraryPanel] failed to start Vercel OAuth", err);
            void showAlert("Could not open the Vercel connection flow.", "Connect Vercel");
        }
    }, [showAlert]);

    const handleConnectVercel = useCallback(() => {
        if (onConnectVercel) {
            onConnectVercel();
            return;
        }

        startVercelOAuthForImages();
    }, [onConnectVercel, startVercelOAuthForImages]);

    const handleRefreshLibrary = useCallback(() => {
        if (!user || !renderId) return;
        if (loading || refreshInFlightRef.current) return;

        refreshInFlightRef.current = true;
        void (async () => {
            try {
                await loadImages(user.uid, renderId);
            } finally {
                refreshInFlightRef.current = false;
            }
        })();
    }, [loadImages, loading, renderId, user]);

    useEffect(() => {
        const nextKeys = new Set<string>([...pageImages.map((item) => item.key), ...items.map((item) => item.path)]);
        setImageAvailability((prev) => {
            const next: Record<string, "ok" | "error"> = {};
            for (const [key, status] of Object.entries(prev)) {
                if (nextKeys.has(key)) next[key] = status;
            }
            return next;
        });

        if (typeof window === "undefined") return;

        let cancelled = false;
        const probes: Array<Promise<void>> = [];
        const probeEntries = [
            ...pageImages.map((item) => ({ key: item.key, url: item.src })),
            ...items.map((item) => ({ key: item.path, url: item.url })),
        ].filter(({ key, url }) => Boolean(key) && Boolean(url));

        const seen = new Set<string>();
        for (const entry of probeEntries) {
            if (seen.has(entry.key)) continue;
            seen.add(entry.key);
            const promise = new Promise<void>((resolve) => {
                const probe = new window.Image();
                probe.onload = () => {
                    if (!cancelled) markImageAvailability(entry.key, "ok");
                    resolve();
                };
                probe.onerror = () => {
                    if (!cancelled) markImageAvailability(entry.key, "error");
                    resolve();
                };
                probe.src = entry.url;
                if (probe.complete && probe.naturalWidth > 0) {
                    if (!cancelled) markImageAvailability(entry.key, "ok");
                    resolve();
                }
            });
            probes.push(promise);
        }

        void Promise.all(probes);

        return () => {
            cancelled = true;
        };
    }, [items, markImageAvailability, pageImages]);

    const orderedPageImages = useCallback(
        (list: PageImageItem[]) =>
            [...list].sort((left, right) => {
                const leftBroken = imageAvailability[left.key] === "error" ? 1 : 0;
                const rightBroken = imageAvailability[right.key] === "error" ? 1 : 0;
                if (leftBroken !== rightBroken) return leftBroken - rightBroken;
                return 0;
            }),
        [imageAvailability],
    );

    const orderedItems = useCallback(
        (list: AiLibraryItem[]) =>
            [...list].sort((left, right) => {
                const leftBroken = imageAvailability[left.path] === "error" ? 1 : 0;
                const rightBroken = imageAvailability[right.path] === "error" ? 1 : 0;
                if (leftBroken !== rightBroken) return leftBroken - rightBroken;
                return 0;
            }),
        [imageAvailability],
    );

    useEffect(() => {
        if (!user || !renderId) return;
        void loadImages(user.uid, renderId);
    }, [loadImages, renderId, user]);

    useEffect(() => {
        refreshPageImages();

        const doc = iframeRef.current?.contentDocument;
        if (!doc?.body) return;

        let timer = 0;
        const observer = new MutationObserver(() => {
            window.clearTimeout(timer);
            timer = window.setTimeout(refreshPageImages, 180);
        });

        observer.observe(doc.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["src", "alt", "style", "data-kloner-path", "data-kloner-bg-path", "data-local-image-id", "data-local-filename", "data-kloner-bg-old-path"],
        });

        return () => {
            observer.disconnect();
            window.clearTimeout(timer);
        };
    }, [iframeRef, refreshPageImages, renderId, user?.uid]);

    const handleInsert = useCallback((item: AiLibraryItem) => {
        const win = iframeRef.current?.contentWindow as any;
        const api = win?.__klonerApi;
        if (!api || typeof api.imgInsertFromLibrary !== "function") {
            console.warn("[AiImageLibraryPanel] imgInsertFromLibrary not available on __klonerApi", api);
            return;
        }

        try {
            api.imgInsertFromLibrary(item.url, item.path);
        } catch (err) {
            console.warn("[AiImageLibraryPanel] insert failed", err);
        }
    }, [iframeRef]);

    const handleInsertAsBackground = useCallback((item: AiLibraryItem) => {
        const win = iframeRef.current?.contentWindow as any;
        const api = win?.__klonerApi;

        if (!api) {
            console.warn("[AiImageLibraryPanel] __klonerApi missing on iframe window");
            return;
        }

        let method: string | null = null;

        if (typeof api.blockSetBackgroundFromLibrary === "function") {
            method = "blockSetBackgroundFromLibrary";
        } else if (typeof api.blockSetBackgroundImageFromLibrary === "function") {
            method = "blockSetBackgroundImageFromLibrary";
        } else if (typeof api.blockSetBackgroundImage === "function") {
            method = "blockSetBackgroundImage";
        } else if (typeof api.blockSetBackground === "function") {
            method = "blockSetBackground";
        }

        if (!method) {
            console.warn("[AiImageLibraryPanel] no background method found on __klonerApi. Expected one of: blockSetBackgroundFromLibrary, blockSetBackgroundImageFromLibrary, blockSetBackgroundImage, blockSetBackground", api);
            return;
        }

        try {
            if (method === "blockSetBackgroundFromLibrary" || method === "blockSetBackgroundImageFromLibrary") {
                api[method](item.url, item.path);
            } else {
                api[method](item.url);
            }
        } catch (err) {
            console.warn(`[AiImageLibraryPanel] insert-as-background failed via ${method}`, err);
        }
    }, [iframeRef]);

    const openReplaceDialog = useCallback(async (item: PageImageItem) => {
        if (!isVercelConnected) {
            await showAlert(
                "Connect your Vercel account before replacing images. Current-page images can still be removed.",
                "Connect Vercel",
            );
            return;
        }

        const { api, element } = selectImageTarget(iframeRef, item.selector);
        if (!api || !element) {
            setError("Could not find that image in the preview anymore.");
            return;
        }

        try {
            if (item.kind === "background") {
                if (typeof api.setBackgroundImage === "function") {
                    api.setBackgroundImage();
                }
                return;
            }

            if (typeof api.replaceImage === "function") {
                api.replaceImage();
            }
        } catch (err) {
            console.warn("[AiImageLibraryPanel] replace failed", err);
        }
    }, [iframeRef, isVercelConnected, showAlert]);

    const removePageImage = useCallback((item: PageImageItem) => {
        const { api, element } = selectImageTarget(iframeRef, item.selector);
        if (!api || !element) {
            setError("Could not find that image in the preview anymore.");
            return;
        }

        try {
            if (item.kind === "background") {
                if (typeof api.clearBackgroundImage === "function") {
                    api.clearBackgroundImage();
                } else if (typeof api.deleteBlock === "function") {
                    api.deleteBlock();
                }
                return;
            }

            if (typeof api.deleteImage === "function") {
                api.deleteImage();
            }
        } catch (err) {
            console.warn("[AiImageLibraryPanel] remove failed", err);
        }
    }, [iframeRef]);

    function handleDragStart(e: DragEvent<HTMLButtonElement>, item: AiLibraryItem) {
        try {
            e.dataTransfer.effectAllowed = "copyMove";
            e.dataTransfer.setData("text/uri-list", item.url);
            e.dataTransfer.setData("application/kloner-image-url", item.url);
            e.dataTransfer.setData("application/kloner-image-path", item.path);
        } catch (err) {
            console.warn("[AiImageLibraryPanel] drag start failed", err);
        }
    }

    return (
        <div className="flex h-full flex-col gap-3 px-2 py-2 text-sm leading-6 text-neutral-700">
            <div className="flex items-start gap-3 px-1 pt-1">
                {/* <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                        <MessageCircleWarning className="h-4 w-4" />
                    </div> */}
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-neutral-900">Images on this page</div>
                    <div className="mt-1 text-sm leading-relaxed text-neutral-600">
                        Review your images below. Replace is gated until storage is configured.
                    </div>
                </div>
                {/* <button
                        type="button"
                        onClick={() => {
                            if (!user || !renderId) return;
                            void loadImages(user.uid, renderId);
                            refreshPageImages();
                        }}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-500 transition hover:border-neutral-400 hover:bg-neutral-900 hover:text-white"
                        aria-label="Refresh images"
                        title="Refresh images"
                    >
                        <RefreshCcw className="h-3.5 w-3.5" />
                    </button> */}
            </div>

            {!isVercelConnected ? (
                <div className="relative mt-3 overflow-hidden rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-4 py-4 text-xs text-amber-950 shadow-[0_14px_34px_rgba(180,108,17,0.08)]">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="flex items-start gap-2 sm:max-w-[70%] sm:items-center">
                            <MessageCircleWarning className="h-4 w-4 shrink-0 text-amber-700" />
                            <span className="min-w-0 flex-1 text-sm font-medium leading-5 text-amber-950">
                                Storage connection required.
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={handleConnectVercel}
                            className="inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-neutral-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
                        >
                            Connect
                        </button>
                    </div>
                </div>
            ) : null}

            {error ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {error}
                </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto pb-2">
                <section className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Current page</div>
                        <div className="text-xs text-neutral-500">{pageImages.length} found</div>
                    </div>

                    {pageImages.length === 0 && !loading ? (
                        <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
                            No visible images were found on the open page.
                        </div>
                    ) : null}

                    <div className="space-y-3">
                        {orderedPageImages(pageImages).map((item) => (
                            <div
                                key={item.key}
                                className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-[#f55f2a]/50 hover:shadow-[0_14px_32px_rgba(15,23,42,0.10)]"
                            >
                                <div className="grid gap-3 p-2.5 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-stretch">
                                    <div className="relative h-24 overflow-hidden rounded-xl bg-neutral-100 sm:h-full sm:min-h-[110px]">
                                        {imageAvailability[item.key] === "error" ? (
                                            <div className="flex h-full min-h-[96px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-amber-300/80 bg-amber-50/95 px-3 text-center text-[11px] text-amber-950 shadow-[0_14px_34px_rgba(180,108,17,0.10)]">
                                                <ImageIcon className="h-5 w-5 text-amber-700" />
                                                <span className="font-semibold">Image unavailable</span>
                                                {/* <span className="leading-4 text-amber-900/80">This image could not be loaded.</span> */}
                                            </div>
                                        ) : (
                                            <img
                                                src={item.src}
                                                alt={item.label}
                                                onLoad={() => markImageAvailability(item.key, "ok")}
                                                onError={() => markImageAvailability(item.key, "error")}
                                                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
                                                loading="lazy"
                                            />
                                        )}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-semibold text-neutral-900">{item.label}</div>
                                                <div className="mt-1 truncate text-xs text-neutral-500">{item.description}</div>
                                            </div>
                                            <span className="shrink-0 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                                                {item.kind === "background" ? "Background" : "Image"}
                                            </span>
                                        </div>

                                        <div className="mt-3 grid grid-cols-2 gap-2 opacity-100 transition group-hover:opacity-100 sm:opacity-70">
                                            <button
                                                type="button"
                                                onClick={() => void openReplaceDialog(item)}
                                                disabled={!isVercelConnected}
                                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 transition hover:border-[#f55f2a] hover:text-[#f55f2a] disabled:cursor-not-allowed disabled:opacity-45"
                                                title={isVercelConnected ? "Replace this image" : "Connect Vercel to replace images"}
                                            >
                                                <ArrowUpRight className="h-3.5 w-3.5" />
                                                Replace
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removePageImage(item)}
                                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 transition hover:border-rose-200 hover:text-rose-700"
                                                title="Remove image"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="space-y-3 border-t border-neutral-200 pt-4">
                    <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Library</div>
                        <button
                            type="button"
                            onClick={handleRefreshLibrary}
                            disabled={loading}
                            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                            {loading ? "Refreshing…" : "Refresh"}
                        </button>
                    </div>

                    {loading ? (
                        <div className="flex flex-1 items-center justify-center rounded-2xl border border-neutral-200 bg-white px-4 py-10 text-sm text-neutral-500">
                            Loading images…
                        </div>
                    ) : null}

                    {!loading && items.length > 0 ? (
                        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2.5 overflow-auto pb-2">
                            {orderedItems(items).map((item) => (
                                <button
                                    key={item.path}
                                    type="button"
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, item)}
                                    onClick={() => handleInsert(item)}
                                    className="group relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 text-left shadow-sm transition duration-200 hover:z-10 hover:-translate-y-0.5 hover:border-[#f55f2a]/60 hover:bg-white hover:shadow-[0_14px_30px_rgba(15,23,42,0.10)]"
                                >
                                    <div className="relative aspect-[4/3] w-full max-h-28 overflow-hidden bg-neutral-900/5">
                                        {imageAvailability[item.path] === "error" ? (
                                            <div className="flex h-full min-h-[96px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-amber-300/80 bg-amber-50/95 px-3 text-center text-[11px] text-amber-950 shadow-[0_14px_34px_rgba(180,108,17,0.10)]">
                                                <ImageIcon className="h-5 w-5 text-amber-700" />
                                                <span className="font-semibold">Image unavailable</span>
                                                <span className="leading-4 text-amber-900/80">This asset could not be loaded.</span>
                                            </div>
                                        ) : (
                                            <img
                                                src={item.url}
                                                alt={item.name}
                                                onLoad={() => markImageAvailability(item.path, "ok")}
                                                onError={() => markImageAvailability(item.path, "error")}
                                                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.08]"
                                                loading="lazy"
                                            />
                                        )}

                                        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-[#f55f2a] opacity-0 transition-opacity group-hover:opacity-100" />

                                        <div className="pointer-events-none absolute inset-x-1 bottom-1 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                            <span className="rounded-full border border-white/80 bg-white/90 px-2 py-1 text-[10px] font-medium text-neutral-800 shadow-sm">
                                                Click to insert
                                            </span>
                                        </div>
                                    </div>
                                    <div className="truncate px-2 py-1.5 text-[10px] text-neutral-600">
                                        {item.name}
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : null}
                </section>
            </div>
        </div>
    );
}
