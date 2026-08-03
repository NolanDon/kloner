// components/AiImageLibraryPanel.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject, DragEvent } from "react";
import { ref, listAll, getDownloadURL } from "firebase/storage";
import { AlertTriangle, ArrowUpRight, ChevronDown, ExternalLink, Image as ImageIcon, MessageCircleWarning, RefreshCcw, RotateCcw, Trash2, X } from "lucide-react";
import { storage } from "@/lib/firebase";
import type { User as FirebaseUser } from "firebase/auth";
import { useModal } from "@/components/ui/ModalContext";
import { IMAGE_STORAGE_LIMIT_BYTES, formatBytes, loadUserImageStorageUsage } from "@/src/lib/imageStorage";

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
    hasVercelProject?: boolean;
    onPrepareVercelProject?: () => Promise<boolean> | boolean;
    selectionMeta?: {
        has: boolean;
        tagName?: string;
        path?: string | null;
        selector?: string | null;
    } | null;
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

function proxyFirebaseStorageUrl(rawUrl: string): string {
    const url = String(rawUrl || "").trim();
    if (!url) return url;
    if (url.startsWith("/api/user-blob/proxy?url=")) {
        const encoded = url.slice("/api/user-blob/proxy?url=".length);
        try {
            return decodeURIComponent(encoded);
        } catch {
            return url;
        }
    }
    if (!/^https?:\/\//i.test(url)) return url;
    if (!/^https?:\/\/(?:firebasestorage|storage)\.googleapis\.com\//i.test(url)) {
        return url;
    }
    return url;
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
        const stableRef = img.getAttribute("data-kloner-path") || img.getAttribute("data-local-image-id") || src;
        pushItem({
            key: `img:${selector}:${stableRef}`,
            selector,
            kind: "image",
            label: img.getAttribute("alt")?.trim() || img.getAttribute("data-kloner-filename")?.trim() || getFileName(src) || `Image ${index + 1}`,
            src,
            path: img.getAttribute("data-kloner-path"),
            description: img.getAttribute("data-kloner-path") || img.getAttribute("data-local-image-id") || "Inline image",
        });
    });

    const backgroundRoots: HTMLElement[] = [];
    if (doc.documentElement instanceof HTMLElement) backgroundRoots.push(doc.documentElement);
    if (doc.body instanceof HTMLElement) backgroundRoots.push(doc.body);
    doc.querySelectorAll<HTMLElement>("body *").forEach((el) => backgroundRoots.push(el));

    backgroundRoots.forEach((el) => {
        if (el.tagName === "IMG") return;

        const style = doc.defaultView?.getComputedStyle(el);
        const background = style?.backgroundImage || el.style.backgroundImage || "";
        if (!background || background === "none") return;

        const match = background.match(/url\((?:['"]?)(.*?)(?:['"]?)\)/i);
        const src = match?.[1]?.trim();
        if (!src) return;

        const selector = buildSelector(el);
        const stableRef = el.getAttribute("data-kloner-bg-path") || el.getAttribute("data-kloner-bg-old-path") || src;
        pushItem({
            key: `bg:${selector}:${stableRef}`,
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

function DashboardWarningCard(props: {
    message: string;
    detail?: string;
    primaryLabel?: string;
    onPrimary?: () => void;
    secondaryLabel?: string;
    onSecondary?: () => void;
    onDismiss?: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const isCompact = !props.detail && Boolean(props.primaryLabel && props.onPrimary);

    if (isCompact) {
        return (
            <div className="relative mt-3 flex items-center gap-2 rounded-2xl border border-amber-300/80 bg-white px-3 py-2 text-amber-950 shadow-[0_10px_24px_rgba(180,108,17,0.06)]">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-4 text-amber-950">
                    {props.message}
                </div>
                {props.onPrimary ? (
                    <button
                        type="button"
                        onClick={props.onPrimary}
                        className="inline-flex shrink-0 items-center justify-center gap-1 rounded-full border border-amber-300/80 bg-white px-3 py-1 text-[11px] font-semibold text-amber-900 shadow-sm transition hover:border-amber-400 hover:bg-amber-50"
                    >
                        <RotateCcw className="h-3 w-3 text-amber-800" />
                        <span>{props.primaryLabel ?? "Start"}</span>
                    </button>
                ) : null}
                {props.onDismiss ? (
                    <button
                        type="button"
                        onClick={props.onDismiss}
                        className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-amber-700 transition hover:bg-amber-100 hover:text-amber-950"
                        aria-label="Dismiss warning"
                        title="Dismiss"
                    >
                        <X className="h-3 w-3" />
                    </button>
                ) : null}
            </div>
        );
    }

    return (
        <div className="relative mt-3 overflow-hidden rounded-2xl border border-amber-300/80 bg-white px-4 py-3 text-xs text-amber-950 shadow-[0_10px_24px_rgba(180,108,17,0.06)] sm:pr-12">
            <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="whitespace-nowrap text-sm font-semibold leading-5 text-amber-950">
                        {props.message}
                    </div>
                </div>
                {props.detail ? (
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-amber-800 transition hover:text-amber-950"
                        aria-expanded={expanded}
                        aria-label={expanded ? "Hide details" : "Show details"}
                        title={expanded ? "Hide details" : "Show details"}
                    >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                ) : null}
            </div>
            <div className="mt-3 flex items-center gap-2 pl-9">
                {props.primaryLabel && props.onPrimary ? (
                    <button
                        type="button"
                        onClick={props.onPrimary}
                        className="inline-flex items-center justify-center gap-1 rounded-full border border-amber-300/80 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-900 shadow-sm transition hover:border-amber-400 hover:bg-amber-50"
                    >
                        <RotateCcw className="h-3 w-3 text-amber-800" />
                        <span>{props.primaryLabel}</span>
                    </button>
                ) : null}
                {props.secondaryLabel && props.onSecondary ? (
                    <button
                        type="button"
                        onClick={props.onSecondary}
                        className="inline-flex items-center justify-center gap-1 rounded-full border border-amber-300/80 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-900 shadow-sm transition hover:border-amber-400 hover:bg-amber-50"
                    >
                        <span>{props.secondaryLabel}</span>
                    </button>
                ) : null}
            </div>
            {props.detail && expanded ? (
                <div className="mt-2 pl-9 text-[12px] leading-5 text-amber-900/85">
                    {props.detail}
                </div>
            ) : null}
            {props.onDismiss ? (
                <button
                    type="button"
                    onClick={props.onDismiss}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-amber-700 transition hover:bg-amber-100 hover:text-amber-950 sm:right-3 sm:top-1/2 sm:-translate-y-1/2"
                    aria-label="Dismiss warning"
                    title="Dismiss"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            ) : null}
        </div>
    );
}

function StorageSetupModal({
    isOpen,
    onClose,
    onSave,
    isVercelConnected,
    onConnectVercel,
    hasVercelProject,
    onPrepareVercelProject,
}: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (token: string) => Promise<void>;
    isVercelConnected: boolean;
    onConnectVercel: () => void;
    hasVercelProject: boolean;
    onPrepareVercelProject?: () => Promise<boolean> | boolean;
}) {
    const [token, setToken] = useState("");
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [preparingProject, setPreparingProject] = useState(false);
    const [projectReadyLocal, setProjectReadyLocal] = useState<boolean>(hasVercelProject);
    const needsVercelConnection = !isVercelConnected;
    const projectReady = projectReadyLocal || hasVercelProject;
    const needsProjectDeployment = isVercelConnected && !projectReady;

    useEffect(() => {
        if (!isOpen) return;
        setResult(null);
        setError(null);
        setPreparingProject(false);
        setProjectReadyLocal(hasVercelProject);
    }, [hasVercelProject, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
        }}>
            <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
                    <div>
                        <div className="text-lg font-semibold text-neutral-900">Set up storage</div>
                        <div className="mt-1 text-sm text-neutral-600">
                            {needsVercelConnection
                                ? "Connect Vercel, deploy the website, then save your token."
                                : needsProjectDeployment
                                    ? "Deploy the website, then the storage step unlocks."
                                    : "Paste your token here, then save."}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200"
                        title="Close"
                    >
                        <X className="h-4 w-4 text-neutral-700" />
                    </button>
                </div>

                <div className="px-5 py-4 space-y-4">
                    <div className="space-y-3">
                        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-neutral-900">1. Deploy website</div>
                                    <div className="mt-1 whitespace-pre-line text-sm text-neutral-600">
                                        Deploy this website to Vercel so the storage step can turn on.
                                    </div>
                                </div>
                                <div className="shrink-0">
                                    {projectReady ? (
                                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                                            Deployed
                                        </span>
                                    ) : needsVercelConnection ? (
                                        <span className="inline-flex items-center rounded-full bg-neutral-200 px-3 py-1 text-[11px] font-semibold text-neutral-600">
                                            Connect Vercel first
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (preparingProject) return;
                                                setPreparingProject(true);
                                                setError(null);
                                                setResult(null);
                                                try {
                                                    const ok = await onPrepareVercelProject?.();
                                                    if (!ok) {
                                                        setError("Deploy failed.");
                                                        return;
                                                    }
                                                    setProjectReadyLocal(true);
                                                    setResult("Website deployed. Storage setup is now unlocked.");
                                                } catch (err: any) {
                                                    setError(err?.message || "Deploy failed.");
                                                } finally {
                                                    setPreparingProject(false);
                                                }
                                            }}
                                            disabled={preparingProject}
                                            className="inline-flex items-center justify-center rounded-full bg-[#f55f2a] px-4 py-1.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {preparingProject ? "Deploying…" : "Deploy"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className={`rounded-2xl border px-4 py-3 ${projectReady ? "border-neutral-200 bg-white" : "border-dashed border-neutral-200 bg-neutral-50/70"}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-neutral-900">2. Storage token</div>
                                    <div className="mt-1 text-sm text-neutral-600">
                                        {projectReady ? (
                                            <div className="space-y-1">
                                                <ol className="space-y-0.5">
                                                    <li>1. Click Open Vercel below.</li>
                                                    <li>2. Click Storage in the left sidebar.</li>
                                                    <li>3. Create database &gt; Blob &gt; Continue.</li>
                                                    <li>4. Click Connect Project and choose the project from Search project.</li>
                                                    <li>5. Check Add a read-write token env var.</li>
                                                    <li>6. Choose Public.</li>
                                                    <li>7. Copy the token here.</li>
                                                </ol>
                                            </div>
                                        ) : (
                                            "This unlocks after deploy finishes."
                                        )}
                                    </div>
                                </div>
                                {projectReady ? (
                                    <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800">
                                        Ready
                                    </span>
                                ) : null}
                            </div>

                            {projectReady ? (
                                <div className="mt-3 space-y-3">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-neutral-800">Storage token</label>
                                        <input
                                            value={token}
                                            onChange={(e) => setToken(e.target.value)}
                                            type="password"
                                            autoComplete="off"
                                            spellCheck={false}
                                            placeholder="Paste token here"
                                            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#f55f2a] focus:ring-2 focus:ring-[#f55f2a]/20"
                                        />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <a
                                            href={needsVercelConnection ? "https://vercel.com/signup" : "https://vercel.com/dashboard"}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-800 hover:bg-neutral-50"
                                        >
                                            Open Vercel
                                            <ExternalLink className="h-3.5 w-3.5" />
                                        </a>
                                        {needsVercelConnection ? (
                                            <button
                                                type="button"
                                                onClick={onConnectVercel}
                                                className="inline-flex items-center justify-center rounded-full bg-[#f55f2a] px-4 py-1.5 text-[12px] font-semibold text-white"
                                            >
                                                Connect Vercel
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    const next = token.trim();
                                                    if (!next) {
                                                        setError("Paste the token first.");
                                                        return;
                                                    }
                                                    setSaving(true);
                                                    setError(null);
                                                    setResult(null);
                                                    try {
                                                        await onSave(next);
                                                        setResult("Saved.");
                                                        setToken("");
                                                    } catch (err: any) {
                                                        setError(err?.message || "Could not save.");
                                                    } finally {
                                                        setSaving(false);
                                                    }
                                                }}
                                                disabled={saving || !token.trim()}
                                                className="inline-flex items-center justify-center rounded-full bg-[#f55f2a] px-4 py-1.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {saving ? "Saving…" : "Save"}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {result ? <p className="text-sm text-emerald-700">{result}</p> : null}
                    {error ? <p className="text-sm text-rose-700">{error}</p> : null}
                </div>
            </div>
        </div>
    );
}

export function AiImageLibraryPanel({
    iframeRef,
    user,
    renderId,
    selectionMeta,
    isVercelConnected = false,
    onConnectVercel,
    hasVercelProject = false,
    onPrepareVercelProject,
}: Props) {
    const { showAlert } = useModal();
    const [items, setItems] = useState<AiLibraryItem[]>([]);
    const [pageImages, setPageImages] = useState<PageImageItem[]>([]);
    const [imageAvailability, setImageAvailability] = useState<Record<string, "ok" | "error">>({});
    const [loading, setLoading] = useState(false);
    const [storageUsage, setStorageUsage] = useState({ usedBytes: 0, fileCount: 0 });
    const [storageUsageLoading, setStorageUsageLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const refreshInFlightRef = useRef(false);
    const loggedPermissionPathsRef = useRef(new Set<string>());
    const pageImageRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const storageLimitReached = storageUsage.usedBytes >= IMAGE_STORAGE_LIMIT_BYTES;
    const storageUsagePercent = IMAGE_STORAGE_LIMIT_BYTES > 0
        ? Math.min(100, Math.round((storageUsage.usedBytes / IMAGE_STORAGE_LIMIT_BYTES) * 100))
        : 0;
    const storageReady = Boolean(user?.uid) && !storageLimitReached;

    const selectedPageImage = useCallback((item: PageImageItem): boolean => {
        const selectedPath = String(selectionMeta?.path || "").trim();
        const selectedSelector = String(selectionMeta?.selector || "").trim();

        if (selectedPath) {
            if (item.path && item.path === selectedPath) return true;
            if (item.description === selectedPath) return true;
            if (item.key.includes(selectedPath)) return true;
        }

        if (selectedSelector) {
            if (item.selector === selectedSelector) return true;
        }

        return false;
    }, [selectionMeta]);

    useEffect(() => {
        let cancelled = false;
        if (!user?.uid) {
            setStorageUsage({ usedBytes: 0, fileCount: 0 });
            return;
        }

        setStorageUsageLoading(true);
        void loadUserImageStorageUsage(user.uid)
            .then((stats) => {
                if (!cancelled) setStorageUsage(stats);
            })
            .catch(() => {
                if (!cancelled) setStorageUsage({ usedBytes: 0, fileCount: 0 });
            })
            .finally(() => {
                if (!cancelled) setStorageUsageLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [user?.uid]);

    useEffect(() => {
        if (!user?.uid) return;

        const refreshUsage = () => {
            setStorageUsageLoading(true);
            void loadUserImageStorageUsage(user.uid)
                .then((stats) => setStorageUsage(stats))
                .catch(() => setStorageUsage((prev) => prev))
                .finally(() => setStorageUsageLoading(false));
        };

        const onStorageChanged = (event: Event) => {
            const detail = (event as CustomEvent<{
                uid?: string;
                deltaBytes?: number;
                deltaFiles?: number;
                kind?: "upload" | "delete";
            }>).detail;

            if (detail?.uid && detail.uid !== user.uid) return;

            if (detail?.kind === "upload" && Number.isFinite(Number(detail.deltaBytes))) {
                const deltaBytes = Math.max(0, Number(detail.deltaBytes) || 0);
                const deltaFiles = Math.max(0, Number(detail.deltaFiles) || 0);
                setStorageUsage((prev) => ({
                    usedBytes: prev.usedBytes + deltaBytes,
                    fileCount: prev.fileCount + deltaFiles,
                }));
                // Reconcile with the server shortly after the optimistic bump.
                window.setTimeout(refreshUsage, 250);
                return;
            }

            refreshUsage();
        };

        window.addEventListener("kloner:image-storage-changed", onStorageChanged as EventListener);
        return () => {
            window.removeEventListener("kloner:image-storage-changed", onStorageChanged as EventListener);
        };
    }, [user?.uid, loadUserImageStorageUsage]);

    const loadImages = useCallback(async (uidFromProp?: string, renderIdFromProp?: string) => {
        const uid = uidFromProp ?? user?.uid;
        const rid = renderIdFromProp ?? renderId;

        if (!uid || !rid) return;

        setLoading(true);
        setError(null);

        try {
            const paths = [
                `kloner_images/${uid}`,
                `kloner_ai_home/${uid}`,
            ];

            const allItems: AiLibraryItem[] = [];

            for (const basePath of paths) {
                try {
                    const folderRef = ref(storage, basePath);
                    const res = await listAll(folderRef);

                    const fromPath: AiLibraryItem[] = await Promise.all(
                        res.items.map(async (obj) => {
                            const url = proxyFirebaseStorageUrl(await getDownloadURL(obj));
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
                        if (!loggedPermissionPathsRef.current.has(basePath)) {
                            loggedPermissionPathsRef.current.add(basePath);
                            console.info(`[AiImageLibraryPanel] permission issue for path ${basePath}`, innerErr);
                        }
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

    const handleRefreshLibrary = useCallback(() => {
        if (!user || !renderId) return;
        if (loading || refreshInFlightRef.current) return;

        refreshInFlightRef.current = true;
        void (async () => {
            try {
                await loadImages(user.uid, renderId);
                const stats = await loadUserImageStorageUsage(user.uid);
                setStorageUsage(stats);
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
    }, [items, pageImages]);

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

    useEffect(() => {
        if (!selectionMeta?.has) return;
        const selected = pageImages.find((item) => selectedPageImage(item));
        if (!selected) return;
        const el = pageImageRefs.current[selected.key];
        el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }, [pageImages, selectedPageImage, selectionMeta?.has, selectionMeta?.path, selectionMeta?.selector]);

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
        if (!storageReady) {
            void showAlert(
                storageLimitReached
                    ? "Storage is full. Delete an image to continue."
                    : "Sign in to replace images.",
                "Images",
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
    }, [iframeRef, showAlert, storageLimitReached, storageReady]);

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
                        Review your images below. Replace is gated when storage is full.
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

            <div className={`mt-1 rounded-2xl border px-4 py-3 ${storageLimitReached ? "border-rose-200 bg-rose-50/70" : "border-neutral-200 bg-white"}`}>
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Storage</div>
                        <div className="mt-1 text-sm font-medium text-neutral-900">
                            {storageUsageLoading ? "Checking usage…" : `${formatBytes(storageUsage.usedBytes)} used of ${formatBytes(IMAGE_STORAGE_LIMIT_BYTES)}`}
                        </div>
                        <div className="mt-1 text-xs text-neutral-600">
                            {storageUsageLoading ? "Loading your quota…" : `${storageUsage.fileCount} files`}
                        </div>
                    </div>
                    <div className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${storageLimitReached ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {storageLimitReached ? "Full" : `${storageUsagePercent}%`}
                    </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100">
                    <div
                        className={`h-full rounded-full ${storageLimitReached ? "bg-rose-500" : "bg-[#f55f2a]"}`}
                        style={{ width: `${storageUsagePercent}%` }}
                    />
                </div>
            </div>

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
                                ref={(node) => {
                                    pageImageRefs.current[item.key] = node;
                                }}
                                className={`group overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(15,23,42,0.10)] ${selectedPageImage(item) ? "border-[#f55f2a] ring-2 ring-[#f55f2a]/25" : "border-neutral-200 hover:border-[#f55f2a]/50"}`}
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
                                                disabled={!storageReady || storageUsageLoading}
                                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 transition hover:border-[#f55f2a] hover:text-[#f55f2a] disabled:cursor-not-allowed disabled:opacity-45"
                                                title={storageLimitReached ? "Storage is full" : "Replace this image"}
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
