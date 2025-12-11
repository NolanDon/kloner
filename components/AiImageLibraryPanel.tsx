// components/AiImageLibraryPanel.tsx
"use client";

import { useEffect, useState } from "react";
import type { RefObject, DragEvent } from "react";
import { ref, listAll, getDownloadURL } from "firebase/storage";
import { Image as ImageIcon, RefreshCcw } from "lucide-react";
import { storage } from "@/lib/firebase";
import type { User as FirebaseUser } from "firebase/auth";

type AiLibraryItem = {
    url: string;
    path: string;
    name: string;
};

type Props = {
    iframeRef: RefObject<HTMLIFrameElement>;
    user: FirebaseUser | null;
    renderId: string | null;
};

export function AiImageLibraryPanel({ iframeRef, user, renderId }: Props) {
    const [items, setItems] = useState<AiLibraryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!user || !renderId) return;
        void loadImages(user.uid, renderId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid, renderId]);

    async function loadImages(uidFromProp?: string, renderIdFromProp?: string) {
        const uid = uidFromProp ?? user?.uid;
        const rid = renderIdFromProp ?? renderId;

        if (!uid || !rid) return;

        setLoading(true);
        setError(null);

        try {
            const paths = [
                // NEW STRUCTURE: images are stored under kloner_ai_images/{renderId}
                `kloner_ai_images/${rid}`,
                // keep home images per user
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
                    const msg = innerErr?.message || "";
                    if (
                        msg.includes("storage/unauthorized") ||
                        msg.includes("permission") ||
                        msg.includes("denied")
                    ) {
                        console.warn(
                            `[AiImageLibraryPanel] permission issue for path ${basePath}`,
                            innerErr,
                        );
                        setError("You don't have permission to load some images.");
                    } else {
                        console.warn(
                            `[AiImageLibraryPanel] skipped path ${basePath}`,
                            innerErr,
                        );
                    }
                }
            }

            const dedupMap = new Map<string, AiLibraryItem>();
            for (const item of allItems) {
                dedupMap.set(item.path, item);
            }
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
    }

    function handleInsert(item: AiLibraryItem) {
        const win = iframeRef.current?.contentWindow as any;
        const api = win?.__klonerApi;
        if (!api || typeof api.imgInsertFromLibrary !== "function") {
            console.warn(
                "[AiImageLibraryPanel] imgInsertFromLibrary not available on __klonerApi",
                api,
            );
            return;
        }

        try {
            api.imgInsertFromLibrary(item.url, item.path);
        } catch (err) {
            console.warn("[AiImageLibraryPanel] insert failed", err);
        }
    }

    // Insert as background on selected block
    function handleInsertAsBackground(item: AiLibraryItem) {
        const win = iframeRef.current?.contentWindow as any;
        const api = win?.__klonerApi;

        if (!api) {
            console.warn("[AiImageLibraryPanel] __klonerApi missing on iframe window");
            return;
        }

        // Try a few likely method names so it hooks into whatever you already implemented
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
            console.warn(
                "[AiImageLibraryPanel] no background method found on __klonerApi. Expected one of: blockSetBackgroundFromLibrary, blockSetBackgroundImageFromLibrary, blockSetBackgroundImage, blockSetBackground",
                api,
            );
            return;
        }

        try {
            // Methods that know about storage path
            if (
                method === "blockSetBackgroundFromLibrary" ||
                method === "blockSetBackgroundImageFromLibrary"
            ) {
                api[method](item.url, item.path);
            } else {
                // Fallback: only URL
                api[method](item.url);
            }
        } catch (err) {
            console.warn(
                `[AiImageLibraryPanel] insert-as-background failed via ${method}`,
                err,
            );
        }
    }

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
        <div className="flex h-full flex-col gap-3 border-l border-neutral-200 bg-white/95 px-4 py-3">
            <div className="flex items-center justify-between">
                <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        AI Image Library
                    </div>
                    <div className="mt-1 text-[12px] text-neutral-500">
                        Select a slot from your preview, then click an image to insert it.
                        Or use the background action to set it as the section background.
                        <br />
                        <br />
                        Make sure to click save after inserting, or use the undo buttons to
                        remove it.
                    </div>

                    {error && (
                        <div className="mt-1 max-w-[220px] text-[10px] text-red-500">
                            {error}
                        </div>
                    )}
                </div>
            </div>

            <button
                type="button"
                onClick={() => {
                    if (!user || !renderId) return;
                    void loadImages(user.uid, renderId);
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-300 p-2 text-neutral-500 hover:border-transparent hover:bg-neutral-900 hover:text-white"
            >
                <RefreshCcw className="h-3.5 w-3.5" />
            </button>

            {loading && (
                <div className="flex flex-1 items-center justify-center text-xs text-neutral-500">
                    Loading images…
                </div>
            )}

            {!loading && !error && items.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-xs text-neutral-500">
                    <ImageIcon className="h-6 w-6 text-neutral-300" />
                    <p>No saved AI images found for this project yet.</p>
                </div>
            )}

            {!loading && !error && items.length > 0 && (
                <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-auto pb-3">
                    {items.map((item) => (
                        <button
                            key={item.path}
                            type="button"
                            draggable
                            onDragStart={(e) => handleDragStart(e, item)}
                            onClick={() => handleInsert(item)}
                            className="group relative flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-left text-[0px] shadow-sm transition hover:z-10 hover:border-[#f55f2a] hover:bg-white"
                        >
                            <div className="relative aspect-[4/3] w-full max-h-24 overflow-hidden bg-neutral-900/5">
                                <img
                                    src={item.url}
                                    alt={item.name}
                                    className="h-full w-full object-cover transition group-hover:scale-[1.08]"
                                />

                                {/* hover highlight ring */}
                                <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-[#f55f2a] opacity-0 transition-opacity group-hover:opacity-100" />

                                {/* on-theme actions overlay */}
                                <div className="pointer-events-none absolute inset-x-1 bottom-1 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                    <a
                                        type="button"
                                        className="pointer-events-auto flex-1 rounded-full border border-white/80 bg-white/90 px-2 py-1 text-[10px] font-medium text-neutral-800 shadow-sm hover:bg-white"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleInsert(item);
                                        }}
                                    >
                                        Insert image
                                    </a>
                                    <a
                                        type="button"
                                        className="pointer-events-auto flex-1 rounded-full bg-[#f55f2a] px-2 py-1 text-[10px] font-semibold text-white shadow-sm shadow-[#f55f2a]/40 hover:bg-[#e55523]"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleInsertAsBackground(item);
                                        }}
                                    >
                                        Background
                                    </a>
                                </div>
                            </div>
                            <div className="truncate px-2 py-1.5 text-[10px] text-neutral-600">
                                {item.name}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
