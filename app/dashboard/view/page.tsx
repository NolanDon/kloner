// app/dashboard/view/page.tsx
"use client";

import React, {
    useEffect,
    useMemo,
    useState,
    useCallback,
    useRef,
    memo,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "react-hot-toast";

import { useRouter, useSearchParams } from "next/navigation";
import {
    onAuthStateChanged,
    User as FirebaseUser,
    getIdTokenResult,
} from "firebase/auth";
import {
    collection,
    query,
    where,
    getDocs,
    DocumentData,
    QueryDocumentSnapshot,
    orderBy,
    limit,
    onSnapshot,
    Unsubscribe,
    addDoc,
    doc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    setDoc,
    arrayRemove,
    getDocFromServer,
    getDoc
} from "firebase/firestore";
import {
    ref as sRef,
    listAll,
    getDownloadURL,
    deleteObject,
    type StorageReference,
} from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import PreviewEditor, { buildFinalExport, buildSeoMetaMapForExport, SeoMeta, SeoMetaMap } from "@/components/PreviewEditor";
import {
    Rocket,
    Plus,
    ChevronDown,
    Hammer,
    CheckCircle2,
    Crown,
    BrushIcon,
    Clock10,
    MessageCircleWarning,
    Archive,
    Share2,
    ScanFace,
    WrenchIcon,
} from "lucide-react";
import {
    isHttpUrl,
    normUrl,
    hash64,
    ensureHttp,
    extractHashFromKey,
    shortVersionFromShotPath,
    rendersEqual,
} from "./page.helpers";
import { CREDIT_LIMITS, UserTier } from "@/src/lib/credits";
import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import { UrlDoc } from "../page";
import { useVercelIntegration } from "@/src/hooks/useVercelIntegration";
import { archiveRender, resolveStorageUrl, useResolvedImg } from "@/src/lib/renders";
import { AnimatePresence, motion } from "framer-motion";
import { extractArchivedPageIdsFromRender, fetchRenderForDeployment, getArchivedRoutesForRender, persistArchivedPageIds, scrubArchivedRoutes, withArchivedPageIds } from "@/components/helpers";
import { recordDeployAnalytics } from "@/components/analytics";

const VERCEL_INTEGRATION_SLUG =
    process.env.NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG || "kloner";

const ACCENT = "#f55f2a";

/* ───────── types ───────── */

export type SeoMetaByPage = Record<string, SeoMeta>;

export type KlonerRender = {
    id: string;
    html: string;
    referenceImage?: string | null;
    status: string;
    url?: string | null;
    urlHash?: string | null;
    nameHint?: string | null;
    multiPageMode?: boolean;
    htmlStoragePath?: string | null;
    htmlByteLength?: number | null;
    // NEW
    seoMetaByPage?: SeoMetaByPage | null;

    // PROGRESS (matches backend progress implementation)
    progressLabel?: string | null;
    progressPercent?: number | null;
};

type Shot = {
    path: string;
    url: string;
    fileName: string;

    // new fields from Firestore screenshots[]
    snapshotId?: string;
    snapshotCreatedAt?: string;
    sourceUrl?: string;
    status?: string;
    bytes?: number;
};

const RenderCard = memo(
    RenderCardInner,
    (prev, next) => {
        const a = prev.r as any;
        const b = next.r as any;

        return (
            a.id === b.id &&
            a.status === b.status &&
            (a.reason || "") === (b.reason || "") &&
            (a.html || "") === (b.html || "") &&
            (a.key || "") === (b.key || "") &&
            (a.nameHint || "") === (b.nameHint || "") &&
            (a.lastExportedAt || "") === (b.lastExportedAt || "") &&
            (a.siteConfigId || "") === (b.siteConfigId || "") &&
            (a.controllerVersion || "") === (b.controllerVersion || "") &&
            (a.model || "") === (b.model || "") &&
            // progress
            (a.progressLabel || "") === (b.progressLabel || "") &&
            (a.progressPercent || null) === (b.progressPercent || null) &&
            (a.progress || null) === (b.progress || null) &&
            prev.isDeleting === next.isDeleting &&
            prev.isOpening === next.isOpening &&
            prev.hardLocked === next.hardLocked &&
            prev.isDeploying === next.isDeploying &&
            prev.deployLocked === next.deployLocked &&
            (prev.urlHash || "") === (next.urlHash || "")
        );
    },
);


export type RenderDoc = {
    url?: string | null;
    urlHash?: string | null;
    key?: string | null;
    referenceImage?: string | null;
    html?: string;
    reason?: string | null;
    nameHint?: string | null;
    // NOTE: add "error" here
    status: "ready" | "queued" | "failed" | "processing" | "error";
    archived?: boolean;
    createdAt?: any;
    updatedAt?: any;
    siteConfigId?: string;
    model?: string | null;
    version?: number;
    controllerVersion?: string | null;
    mode?: string | null;
    lastExportedAt?: any;
    vercelProjectId?: string | null;
    vercelProjectName?: string | null;
    lastDeployUrl?: string | null;
    seoMetaByPage?: SeoMetaByPage | null;

    progress?: number | null;
};

type ToastMsg = {
    id: string;
    text: string;
    tone?: "ok" | "warn" | "err";
};

type RenderCardProps = {
    r: { id: string } & RenderDoc;
    isDeleting: boolean;
    isOpening: boolean;
    hardLocked: boolean; // kept in props but no longer used to lock other cards
    isDeploying: boolean;
    deployLocked: boolean;
    urlHash: string | null;
    onShareWithCommunity?: (opts: { renderId: string; remixable: boolean }) => Promise<void>;
    archiveRender: (id: string) => void;
    unarchiveRender: (id: string) => void;
    continueRender: (id: string) => void;
    discardRender: (id: string) => void;
    startDeployWizard: (opts: { id: string; nameHint?: string | null }) => void;
    setShowCreditsPaywall: (mode: "deploy" | null) => void;
    push: (message: string, level?: string) => void;
    retryRender: (render: { id: string; key?: string | null }) => void; // ← new
};

function RenderCardInner({
    r,
    isDeleting,
    isOpening,
    isDeploying,
    deployLocked,
    urlHash,
    continueRender,
    retryRender,
    discardRender,
    startDeployWizard,
    archiveRender,
    unarchiveRender,
    onShareWithCommunity,
}: RenderCardProps) {
    const router = useRouter();

    const isQueued = r.status === "queued" || r.status === "processing";

    const reason =
        typeof (r as any).reason === "string" ? (r as any).reason : null;

    // “failed” = timeout-style error, regardless of html
    const isFailed =
        (r.status === "error" || r.status === "failed") &&
        (reason === "timeout_or_worker_shutdown" || reason === "timeout");

    const isDeployed = !!r.lastExportedAt;
    const isArchived = !!r.archived;

    // progress normalization: prefer explicit percent, then raw `progress`
    const rawPercent =
        typeof (r as any).progress === "number"
            ? (r as any).progress
            : null;

    const normalizedProgressPercent =
        typeof rawPercent === "number" && !Number.isNaN(rawPercent)
            ? Math.min(100, Math.max(0, rawPercent))
            : null;

    // finished when at 100% and not queued/deploying
    const isComplete =
        normalizedProgressPercent !== null &&
        normalizedProgressPercent >= 100 &&
        !isQueued &&
        !isDeploying;

    // only the actively building/deploying card gets a progress bar
    const hasActiveProgress =
        normalizedProgressPercent !== null &&
        normalizedProgressPercent < 100 &&
        (isQueued || isDeploying);

    const normalizedProgressLabel = hasActiveProgress
        ? isDeploying
            ? "Deploying…"
            : "Building preview…"
        : null;

    const hasProgressInfo = !isComplete && hasActiveProgress;
    const isBuilding = hasActiveProgress;

    // only the card that is actually building/deploying is locked
    const isThisCardLockedForBuild = hasActiveProgress;

    const disableOpen =
        isOpening ||
        isDeploying ||
        isArchived ||
        isThisCardLockedForBuild;

    const { src: refImgUrl, onError: refImgErr } = useResolvedImg(r.key || "");

    const versionLabel = shortVersionFromShotPath(
        r.key ?? "",
        (urlHash as string | undefined) ?? null,
    );

    const controllerVersion =
        typeof r.controllerVersion === "string" ? r.controllerVersion : "";

    const model =
        typeof r.model === "string" ? r.model : "";

    const [shareOpen, setShareOpen] = useState(false);
    const [shareRemixable, setShareRemixable] = useState(true);
    const [shareBusy, setShareBusy] = useState(false);
    const [alreadyShared, setAlreadyShared] = useState(false);
    const [checkingShared, setCheckingShared] = useState(false);
    const [shareError, setShareError] = useState<string | null>(null);
    const isDev = process.env.NODE_ENV === "development";
    const [shareProjectName, setShareProjectName] = useState("");
    const hasEditedShareNameRef = useRef(false);

    const srcDoc = useMemo(() => {
        if (!r.html) return "";
        let safeHtml = r.html.trim();

        safeHtml = safeHtml.replace(
            /<script\b[^>]*>[\s\S]*?<\/script>/gi,
            "",
        );

        safeHtml = safeHtml.replace(
            /\son\w+\s*=\s*(['"]).*?\1/gi,
            "",
        );

        safeHtml = safeHtml.replace(
            /href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi,
            'href="#"',
        );

        const csp = `
<meta http-equiv="Content-Security-Policy"
    content="
        default-src 'none';
        img-src data: blob: http: https:;
        style-src 'unsafe-inline' https:;
        font-src https: data:;
        script-src 'none';
        connect-src 'none';
    ">
`.trim();

        const base = r.html
            ? `<base target="_blank" rel="noopener noreferrer">`
            : "";

        return `${csp}${base}${safeHtml}`;
    }, [r.html]);

    const isDeployedFlag = isDeployed;
    const isArchivedFlag = isArchived;

    const showIframe = !!r.html?.trim();

    const deployThis = () => {
        if (!r.html?.trim()) return;
        if (isDeployedFlag) return;
        if (isArchivedFlag) return;
        startDeployWizard({ id: r.id, nameHint: r.nameHint ?? undefined });
    };

    const handleArchiveClick = () => {
        if (isDeleting || isDeploying) return;

        if (isArchivedFlag) {
            unarchiveRender(r.id);
            return;
        }

        const ok = window.confirm(
            "Move this preview into your archive? It will be hidden from your main dashboard.",
        );
        if (!ok) return;

        archiveRender(r.id);
    };

    async function handleShareClick() {
        if (!r.id || !r.html || !r.key) return;

        const raw = (shareProjectName ?? "").trim();

        if (!raw) {
            setShareError("Add a name for this build before sharing.");
            return;
        }

        if (shareError) return;

        const finalName = raw;

        setShareBusy(true);
        setShareError(null);

        try {
            const res = await fetch("/api/gallery/share", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    renderId: r.id,
                    html: r.html,
                    name: finalName,
                    screenshotKey: r.key || null,
                    remixable: shareRemixable,
                }),
            });

            const data = await res.json().catch(() => ({} as any));
            if (!res.ok || (data as any).error) {
                throw new Error((data as any).error || "Failed to share");
            }

            if (data.alreadyShared) {
                setAlreadyShared(true);
                toast?.("This build is already in the community gallery.");
            } else {
                setAlreadyShared(true);
                toast?.success?.("Thanks for sharing this build with the community!") ??
                    toast?.("Thanks for sharing this build with the community.");
            }

            onShareWithCommunity?.(r.id as any);
            setShareOpen(false);
        } catch (err: any) {
            console.error("Failed to share community build", err);
            setShareError(err?.message || "Failed to share community build");

            toast?.error?.("Failed to share this build. Please try again.") ??
                toast?.("Failed to share this build. Please try again.");
        } finally {
            setShareBusy(false);
        }
    }

    useEffect(() => {
        let cancelled = false;

        async function checkShared() {
            if (!r?.id) {
                setAlreadyShared(false);
                setCheckingShared(false);
                return;
            }

            setCheckingShared(true);

            try {
                const res = await fetch(
                    `/api/gallery/check-shared?renderId=${encodeURIComponent(r.id)}`,
                    {
                        method: "GET",
                        credentials: "include",
                    },
                );

                if (!res.ok) {
                    console.error("check-shared failed", res.status);
                    if (!cancelled) {
                        setAlreadyShared(false);
                    }
                    return;
                }

                const data = (await res.json()) as { alreadyShared?: boolean };
                if (!cancelled) {
                    setAlreadyShared(Boolean(data.alreadyShared));
                }
            } catch (err) {
                console.error("check-shared error", err);
                if (!cancelled) {
                    setAlreadyShared(false);
                }
            } finally {
                if (!cancelled) {
                    setCheckingShared(false);
                }
            }
        }

        checkShared();

        return () => {
            cancelled = true;
        };
    }, [r?.id]);

    return (
        <div
            className={`relative flex flex-col overflow-visible rounded-xl border bg-white shadow-sm ${isArchivedFlag
                ? "border-amber-300/70 bg-amber-50/50"
                : "border-neutral-200"
                }`}
        >
            {/* controller version badge – top left */}
            {(controllerVersion && isDev) && (
                <span
                    className="absolute left-2 top-1 z-30 inline-flex items-center gap-1 rounded-full bg-neutral-900/85 px-2 py-0.5 text-[10px] text-neutral-50 shadow-sm"
                    title={`Controller version ${controllerVersion}`}
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span>v{controllerVersion}</span>
                </span>
            )}

            {/* controller version badge – top left */}
            {(controllerVersion && isDev) && (
                <span
                    className="absolute left-2 bottom-1 z-30 inline-flex items-center gap-1 rounded-full bg-neutral-900/85 px-2 py-0.5 text-[10px] text-neutral-50 shadow-sm"
                    title={`Model ${model}`}
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span>{model}</span>
                </span>
            )}

            {isArchivedFlag && (
                <span
                    className="absolute left-2 top-7 z-30 mt-1 rounded-full bg-amber-200/90 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 shadow"
                    title="Archived previews are hidden from the main dashboard"
                >
                    Archived
                </span>
            )}

            {!isDeployedFlag && !isArchivedFlag && (
                <button
                    onClick={() => discardRender(r.id)}
                    disabled={isDeleting || isBuilding}
                    aria-label="Discard preview"
                    title="Delete this editable preview"
                    className="absolute right-1 top-1 z-40 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-200 bg-white/95 pb-1 text-[18px] font-bold leading-none text-red-600 shadow-sm hover:border-red-500 hover:bg-red-600 hover:text-white disabled:opacity-60"
                >
                    ×
                </button>
            )}

            {/* main visual area – fixed aspect so no extra deadspace */}
            <div className="relative aspect-[3/3] w-full overflow-hidden">
                {!refImgUrl ? (
                    <div className="grid h-full w-full place-items-center text-sm text-neutral-500">
                        No snapshot available
                    </div>
                ) : (
                    <a className="block h-full w-full" title="Open the base screenshot">
                        <img
                            src={refImgUrl}
                            alt={r.nameHint || "preview"}
                            loading="lazy"
                            onError={refImgErr}
                            className={`pointer-events-none h-full w-full select-none object-cover opacity-[0.25] ${isArchivedFlag ? "grayscale" : ""
                                }`}
                            draggable={false}
                        />
                    </a>
                )}

                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                    <div className="pointer-events-auto flex max-w-xs flex-col items-stretch gap-2 rounded-xl border border-neutral-200 bg-white/80 p-3 text-xs shadow-lg backdrop-blur-sm md:max-w-sm">
                        {/* top row: deploy / customize */}
                        <div className="flex w-full flex-col gap-2 sm:flex-row">
                            <button
                                onClick={
                                    isDeployedFlag
                                        ? () => {
                                            router.push("/dashboard/deployments");
                                        }
                                        : deployThis
                                }
                                disabled={
                                    isArchivedFlag ||
                                    (!r.html && !isDeployedFlag) ||
                                    isDeleting ||
                                    isDeploying ||
                                    isThisCardLockedForBuild
                                }
                                className={`group inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${isArchivedFlag
                                    ? "cursor-not-allowed bg-neutral-50 text-neutral-400"
                                    : "bg-accent text-white shadow-sm hover:bg-accent/90 disabled:opacity-60"
                                    }`}
                                title={
                                    isArchivedFlag
                                        ? "Unarchive this preview to deploy it"
                                        : deployLocked
                                            ? "Upgrade to publish live sites"
                                            : isDeployedFlag
                                                ? "View and modify this deployment"
                                                : "Deploy current HTML to Vercel"
                                }
                            >
                                {isDeploying ? (
                                    <>
                                        <span>Deploying…</span>
                                        <Rocket className="h-4 w-4 animate-pulse" />
                                    </>
                                ) : isDeployedFlag ? (
                                    <>
                                        <span>View deployment</span>
                                        <Rocket className="h-4 w-4 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                                    </>
                                ) : (
                                    <>
                                        <span>Deploy</span>
                                        <Rocket className="h-4 w-4 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                                    </>
                                )}
                            </button>

                            {!isDeployedFlag && (
                                <button
                                    onClick={async () => {
                                        if (isFailed) {
                                            // reuse this card, do NOT create a new optimistic render
                                            retryRender({ id: r.id, key: r.key || null });
                                        } else {
                                            continueRender(r.id);
                                        }
                                    }}
                                    // allow click when timeout error, even if html is empty
                                    disabled={(disableOpen || isDeleting || !r.html) && !isFailed}
                                    className="group inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-neutral-700 px-3 py-1.5 text-neutral-600 shadow-sm disabled:opacity-60"
                                    title={
                                        isArchivedFlag
                                            ? "Unarchive to customize this preview"
                                            : isBuilding || isQueued
                                                ? "Still building preview"
                                                : isFailed
                                                    ? "Retry the render operation"
                                                    : "Open editor to customize"
                                    }
                                >
                                    {isBuilding || isQueued
                                        ? "Building…"
                                        : isFailed
                                            ? "Retry"
                                            : "Customize"}

                                    {isFailed ? (
                                        <WrenchIcon className="h-4 w-4 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                                    ) : (
                                        <BrushIcon className="h-4 w-4 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                                    )}
                                </button>
                            )}

                        </div>
                        {isFailed && !r.html && (
                            <p className="mt-1 text-[11px] text-amber-500">
                                This preview hit a timeout. Click "Retry" to try again.
                            </p>
                        )}

                        {/* progress bar / status – only for the active build/deploy and never at 100% */}
                        {hasProgressInfo && (
                            <div className="mt-1 w-full">
                                <div className="mb-1 flex items-center justify-between text-[10px] text-neutral-600">
                                    <span className="max-w-[70%] truncate">
                                        {normalizedProgressLabel}
                                    </span>
                                    {normalizedProgressPercent !== null && (
                                        <span className="font-semibold">
                                            {Math.round(normalizedProgressPercent)}%
                                        </span>
                                    )}
                                </div>
                                {normalizedProgressPercent !== null && (
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200/80">
                                        <div
                                            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                                            style={{
                                                width: `${normalizedProgressPercent}%`,
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* bottom row: open site / share / archive */}
                        <div className="flex w-full flex-wrap items-center justify-between gap-1">
                            {r.siteConfigId && (
                                <button
                                    onClick={() => router.push(`/site/${r.siteConfigId}`)}
                                    disabled={isDeleting}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white/70 px-2.5 py-1 text-[11px] text-neutral-800 shadow-sm hover:border-neutral-400 disabled:opacity-60"
                                    title="Open generated layout site"
                                >
                                    <span>Open site</span>
                                    <Rocket className="h-3.5 w-3.5" />
                                </button>
                            )}

                            {onShareWithCommunity && (
                                <div className="mt-4 flex w-full items-center justify-center gap-1">
                                    {!shareOpen && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setShareOpen((prev) => !prev)
                                                }
                                                disabled={
                                                    alreadyShared ||
                                                    !r.html?.trim() ||
                                                    isDeleting ||
                                                    isDeploying ||
                                                    isQueued ||
                                                    isFailed
                                                }
                                                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white/60 px-2.5 py-1 text-[11px] text-neutral-600 hover:border-neutral-400 disabled:opacity-50"
                                                title={
                                                    alreadyShared
                                                        ? "This build is already shared to the community gallery"
                                                        : "Share this build to the Kloner community gallery"
                                                }
                                            >
                                                <span>
                                                    {alreadyShared
                                                        ? "Shared"
                                                        : shareOpen
                                                            ? "Cancel sharing"
                                                            : "Share"}
                                                </span>
                                                <Share2 className="h-3.5 w-3.5" />
                                            </button>

                                            <button
                                                onClick={handleArchiveClick}
                                                disabled={
                                                    !r.html?.trim() ||
                                                    isDeleting ||
                                                    isDeploying ||
                                                    isQueued ||
                                                    isFailed
                                                }
                                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] shadow-sm
        disabled:opacity-50 disabled:cursor-not-allowed
        ${isArchivedFlag
                                                        ? "border-amber-500 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                                        : "border-neutral-300 bg-white/60 text-neutral-700 hover:border-neutral-400"
                                                    }`}
                                                title={
                                                    isArchivedFlag
                                                        ? "Move back to active previews"
                                                        : "Move this preview into your archive"
                                                }
                                            >
                                                <span>{isArchivedFlag ? "Unarchive" : "Archive"}</span>
                                                <Archive className="h-3.5 w-3.5" />
                                            </button>

                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        {onShareWithCommunity && (
                            <div className="mt-1 w-full">
                                {shareOpen && !alreadyShared && (
                                    <div className="mt-1 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-2 text-[10px] text-neutral-700">
                                        <p className="mb-2">
                                            Publishing to Kloner community. Name your
                                            project and optionally allow other users to
                                            remix a copy of your layout.
                                        </p>

                                        <div className="mb-2">
                                            <label className="mb-1 block text-[10px] text-neutral-700">
                                                Project name
                                            </label>

                                            <input
                                                type="text"
                                                value={shareProjectName}
                                                onChange={(e) => {
                                                    const v = e.target.value;
                                                    hasEditedShareNameRef.current = true;

                                                    const forbidden =
                                                        /\.(com|ca|org|net|io|co|app|dev)\b/i.test(
                                                            v,
                                                        ) ||
                                                        /\bwww\./i.test(v) ||
                                                        /\bhttps?:\/\//i.test(v) ||
                                                        /\.\w{2,}$/i.test(v);

                                                    const allowed =
                                                        /^[a-zA-Z0-9\- ]*$/.test(v);

                                                    if (forbidden) {
                                                        setShareError(
                                                            "Remove .com/.ca/www and any dots or URLs.",
                                                        );
                                                    } else if (!allowed) {
                                                        setShareError(
                                                            "Use only letters, numbers, spaces, and dashes.",
                                                        );
                                                    } else {
                                                        setShareError(null);
                                                    }

                                                    setShareProjectName(v);
                                                }}
                                                placeholder="e.g. cookie gift landing, portfolio v2"
                                                className={`w-full rounded-full border px-2 py-1 text-[10px] bg-white text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-1 ${shareError
                                                    ? "border-red-500 focus:ring-red-500"
                                                    : "border-neutral-300 focus:ring-accent"
                                                    }`}
                                            />

                                            <div className="mt-0.5 min-h-[14px]">
                                                {shareError && (
                                                    <p className="text-[10px] text-red-600">
                                                        {shareError}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <label className="mb-2 inline-flex items-center gap-2 text-[10px] text-neutral-700">
                                            <input
                                                type="checkbox"
                                                className="h-3 w-3 rounded border-neutral-300"
                                                checked={shareRemixable}
                                                onChange={(e) =>
                                                    setShareRemixable(e.target.checked)
                                                }
                                            />
                                            <span>Allow community to copy build</span>
                                        </label>

                                        <div className="mt-1 flex justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setShareOpen(false)}
                                                className="rounded-full px-2 py-1 text-[10px] text-neutral-500 hover:bg-neutral-100"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleShareClick}
                                                disabled={shareBusy}
                                                className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-[10px] text-white hover:opacity-80 disabled:opacity-60"
                                            >
                                                {shareBusy ? "Sharing…" : "Share build"}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {isDeleting && <CenterSpinner />}

                {/* generic overlay spinner only when this card is queued/deploying and has no bar */}
                {(isQueued || isDeploying) && !hasProgressInfo && (
                    <CenterSpinner
                        label={
                            isDeploying
                                ? "Deploying…"
                                : isQueued
                                    ? "Building site. This may take up to five minutes"
                                    : "Locked…"
                        }
                    />
                )}
            </div>

            {showIframe && (
                <div className="relative h-0 overflow-hidden" aria-hidden>
                    <iframe
                        title={`r-${r.id}`}
                        className="h-0 w-full"
                        sandbox="allow-same-origin"
                        referrerPolicy="no-referrer"
                        allow="clipboard-read; clipboard-write"
                        key={`frame-${r.id}`}
                        srcDoc={srcDoc}
                    />
                </div>
            )}
        </div>
    );
}



/* ───────── toasts ───────── */

function useToasts() {
    const [toasts, setToasts] = useState<ToastMsg[]>([]);

    const push = useCallback(
        (text: string, tone: "ok" | "warn" | "err" = "ok") => {
            const id = `${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 8)}`;
            setToasts((t) => [...t, { id, text, tone }]);
            setTimeout(
                () =>
                    setToasts((t) => t.filter((m) => m.id !== id)),
                6800
            );
        },
        []
    );

    return { toasts, push };
}

function Toasts({ toasts }: { toasts: ToastMsg[] }) {
    return (
        <div className="fixed bottom-3 right-3 z-50 flex flex-col gap-2">
            {toasts.map((t) => (
                <div
                    key={t.id}
                    className={`rounded-md border px-3 py-2 text-sm shadow-sm bg-white ${t.tone === "ok"
                        ? "border-emerald-200 text-emerald-700"
                        : t.tone === "warn"
                            ? "border-amber-200 text-amber-700"
                            : "border-red-200 text-red-700"
                        }`}
                >
                    {t.text}
                </div>
            ))}
        </div>
    );
}

/* ───────── shared UI ───────── */

const CenterSpinner = memo(function CenterSpinner({
    label = "Loading…",
    dim = true,
    size = 20,
}: {
    label?: string;
    dim?: boolean;
    size?: number;
}) {
    return (
        <div
            className={`absolute inset-0 z-30 grid place-items-center ${dim ? "bg-white/85" : ""
                }`}
        >
            <div
                className="flex items-center gap-2 rounded border px-3 py-1.5 text-xs text-neutral-800 bg-white"
                role="status"
                aria-live="polite"
            >
                <span
                    className="inline-block rounded-full border-2 border-neutral-300"
                    style={{
                        width: size,
                        height: size,
                        borderTopColor: ACCENT,
                        animation: "spin 0.8s linear infinite",
                    }}
                    aria-hidden
                />
                {label}
            </div>
        </div>
    );
});

const GhostGeneratePreviewCard = memo(function GhostGeneratePreviewCard({
    locked,
    onClick,
}: {
    locked: boolean;
    onClick: () => void;
    compact?: boolean;
}) {
    // Rely entirely on the parent-provided 'locked' prop.
    // The parent tracks pendingByKey and renders with queued status,
    // so this card will naturally disable when a render appears.
    const effectiveLocked = locked;

    const handleClick = () => {
        if (effectiveLocked) return;
        onClick();
    };

    const title = effectiveLocked ? "Generating preview…" : "Generate preview";
    const subtitle = effectiveLocked
        ? "Building an editable website."
        : "Create an editable website.";

    const sizeMinH = "min-h-[260px]";
    const sizeMaxW = "max-w-[350px]";
    const sizeMinW = "min-w-[220px] sm:min-w-[260px]";
    const iconWrapperSize = "h-14 w-14";
    const titleSize = "text-sm";
    const subtitleSize = "text-sm";

    return (
        <>
            <style jsx global>{`
                @keyframes ghost-hammer-swing {
                    0% {
                        transform: rotate(-20deg) translateY(-1px);
                    }
                    25% {
                        transform: rotate(-5deg) translateY(0);
                    }
                    50% {
                        transform: rotate(10deg) translateY(1px);
                    }
                    75% {
                        transform: rotate(-5deg) translateY(0);
                    }
                    100% {
                        transform: rotate(-20deg) translateY(-1px);
                    }
                }
                .ghost-hammer-swing {
                    animation: ghost-hammer-swing 0.8s ease-in-out infinite;
                    transform-origin: 25% 10%;
                }
            `}</style>

            <button
                type="button"
                onClick={handleClick}
                disabled={effectiveLocked}
                aria-busy={effectiveLocked}
                className={`group relative flex ${sizeMinH} ${sizeMinW} ${sizeMaxW} items-center justify-center rounded-xl border-2 border-dashed bg-white text-center transition ${effectiveLocked
                    ? "opacity-70 cursor-wait"
                    : "hover:border-neutral-400"
                    }`}
                title={title}
                aria-disabled={effectiveLocked}
            >
                <div className="pointer-events-none flex flex-col items-center">
                    <div
                        className={`grid ${iconWrapperSize} place-items-center rounded-full border border-neutral-200 bg-neutral-50 transition group-hover:scale-105`}
                    >
                        <Hammer
                            className={`h-7 w-7 text-neutral-600 ${effectiveLocked
                                ? "ghost-hammer-swing"
                                : "transition-transform group-hover:-rotate-6"
                                }`}
                            aria-hidden
                        />
                    </div>
                    <div
                        className={`mt-3 font-semibold text-neutral-800 ${titleSize}`}
                    >
                        {title}
                    </div>
                    <div className={`mt-1 text-neutral-500 ${subtitleSize}`}>
                        {subtitle}
                    </div>
                </div>
            </button>
        </>
    );
});



// ---------------------------------------------------------------------
// RenderCard (full) – only change is the X button styling/placement
// ---------------------------------------------------------------------


/* ───────── main page ───────── */

export default function PreviewPage(): JSX.Element {
    const router = useRouter();
    const search = useSearchParams();
    const { toasts, push } = useToasts();

    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [userTier, setUserTier] = useState<UserTier>("unknown");


    const [showCreditsPaywall, setShowCreditsPaywall] = useState<
        null | "screenshot" | "preview" | "deploy"
    >(null);
    const [showUpgradeAfterCustomize, setShowUpgradeAfterCustomize] =
        useState(false);

    const [archivingRender, setArchivingRender] = useState<Record<string, boolean>>({});

    async function handleArchiveRender(id: string) {
        setArchivingRender((prev) => ({ ...prev, [id]: true }));
        try {
            await archiveRender(id);
            // hide from active list once archived
            setRenders((prev) => prev.filter((r) => r.id !== id));
        } finally {
            setArchivingRender((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
        }
    }

    // you probably won’t use this on the main dashboard
    function handleUnarchiveRender(_id: string) {
        // no-op here; real unarchive happens on /dashboard/archived
    }

    const [deployWizardOpen, setDeployWizardOpen] = useState(false);
    const [deployWizardStep, setDeployWizardStep] = useState<1 | 2 | 3 | 5>(1);
    const [deployWizardProjectName, setDeployWizardProjectName] = useState("");
    const [deployWizardBusy, setDeployWizardBusy] = useState(false);
    const [deployWizardError, setDeployWizardError] = useState<string | null>(null);
    const [deployWizardRenderId, setDeployWizardRenderId] = useState<string | null>(null);

    const [urls, setUrls] = useState<Array<{ id: string } & UrlDoc>>([]);
    const [urlsLoading, setUrlsLoading] = useState<boolean>(true);

    const [err, setErr] = useState<string>("");
    const [info, setInfo] = useState<string>("");

    const [loading, setLoading] = useState<boolean>(true);

    const projectNameSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [docSnap, setDocSnap] =
        useState<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [docData, setDocData] = useState<UrlDoc | null>(null);

    const [shots, setShots] = useState<Shot[]>([]);
    const [rescanning, setRescanning] = useState<boolean>(false);

    const [pendingByKey, setPendingByKey] = useState<
        Record<string, boolean>
    >({});
    const [deletingByKey, setDeletingByKey] = useState<
        Record<string, boolean>
    >({});
    const [deletingRender, setDeletingRender] = useState<
        Record<string, boolean>
    >({});

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorHtml, setEditorHtml] = useState<string>("");
    const [editorRefImg, setEditorRefImg] = useState<string>("");
    const [activeRenderId, setActiveRenderId] = useState<string | undefined>(undefined);

    const [activeSeoMetaByPage, setActiveSeoMetaByPage] = useState<
        Record<string, SeoMeta> | null
    >(null);

    const [renders, setRenders] = useState<
        Array<{ id: string } & RenderDoc>
    >([]);
    const [loadingRenders, setLoadingRenders] = useState(false);
    const [lockUntilByKey, setLockUntilByKey] = useState<
        Record<string, number>
    >({});
    const [lockUntilByRender, setLockUntilByRender] = useState<
        Record<string, number>
    >({});
    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerIdx, setViewerIdx] = useState(0);
    const didStripeRestoreRef = useRef(false);


    useEffect(() => {
        const billingParam = search.get("billing");
        const wizardParam = search.get("wizard");
        const stepParam = search.get("step");
        const renderId = search.get("render");

        if (billingParam !== "success" || wizardParam !== "1") return;
        if (!renderId) return;
        if (!user) return;
        if (didStripeRestoreRef.current) return;
        didStripeRestoreRef.current = true;

        void (async () => {
            // pull latest nameHint from Firestore
            let nameFromDb = "";
            try {
                const renderRef = doc(
                    db,
                    "kloner_users",
                    user.uid,
                    "kloner_renders",
                    renderId,
                );
                const snap = await getDoc(renderRef);
                if (snap.exists()) {
                    const data = snap.data() as any;
                    if (typeof data?.nameHint === "string") {
                        nameFromDb = data.nameHint.trim();
                    }
                }
            } catch (e) {
                console.error("Failed to restore nameHint after Stripe", e);
            }

            // seed wizard state
            setDeployWizardRenderId(renderId);
            setDeployWizardProjectName(
                nameFromDb || deployWizardProjectName || "",
            );
            setDeployWizardError(null);
            setDeployWizardBusy(false);
            setDeployWizardOpen(true);

            const nextStep =
                stepParam === "3"
                    ? 3
                    : stepParam === "2"
                        ? 2
                        : 2;
            setDeployWizardStep(nextStep);

            // clear billing params via router so useSearchParams updates
            try {
                const url = new URL(window.location.href);
                const params = url.searchParams;

                params.delete("billing");
                params.delete("wizard");
                params.delete("step");
                params.delete("render");

                const qs = params.toString();
                const next = qs ? `${url.pathname}?${qs}` : url.pathname;
                router.replace(next, { scroll: false });
            } catch (e) {
                console.error("Failed to clear Stripe query params", e);
            }
        })();
    }, [search, user, router, deployWizardProjectName]);



    async function handleShareWithCommunity(opts: { renderId: string; remixable: boolean }) {
        const { renderId, remixable } = opts;
        const render = renders.find((r) => r.id === renderId);
        if (!render || !render.html || !user) return;

        try {
            // deterministic ID so a render can't be shared twice by same user
            const communityId = `${user.uid}_${render.id}`;
            const communityRef = doc(collection(db, "kloner_community"), communityId);

            const existing = await getDoc(communityRef);
            if (existing.exists()) {
                push("You’ve already shared this build with the community.", "err");
                return;
            }

            await setDoc(communityRef, {
                html: render.html,
                sourceRenderId: render.id,
                name: render.nameHint ?? "Untitled build",
                screenshotKey: render.key ?? null,
                approved: false,
                remixable,
                author: user.uid,
                createdAt: serverTimestamp(),
            });

            push("Thanks for sharing this build with the community.", "ok");
        } catch (err) {
            console.error("Failed to share community build", err);
            push("Could not share this build. Please try again.", "err");
        }
    }


    const persistProjectNameHint = useCallback(
        (renderId: string, name: string) => {
            if (!user) return;

            if (projectNameSaveTimeoutRef.current) {
                clearTimeout(projectNameSaveTimeoutRef.current);
            }

            projectNameSaveTimeoutRef.current = setTimeout(() => {
                const trimmed = name.trim();

                void updateDoc(
                    doc(db, "kloner_users", user.uid, "kloner_renders", renderId),
                    {
                        nameHint: trimmed || null,
                    },
                ).catch((err) => {
                    console.error("Failed to persist project name hint", err);
                });
            }, 400); // small debounce so we don't write every keystroke
        },
        [user],
    );


    const [optimisticByKey, setOptimisticByKey] = useState<
        Record<string, { id: string } & RenderDoc>
    >({});

    const didAutoSelectRef = useRef(false);

    // new: track which render is currently deploying, and show "next steps"
    const [deployingRenderId, setDeployingRenderId] = useState<
        string | null
    >(null);
    const [showDeployNextSteps, setShowDeployNextSteps] =
        useState(false);

    const todayKey = useMemo(
        () => new Date().toISOString().slice(0, 10),
        []
    );

    const tierLimits = useMemo(
        () => CREDIT_LIMITS[userTier] || CREDIT_LIMITS.free,
        [userTier]
    );


    const saveRenderNameHintNow = useCallback(
        async (renderId: string, slug: string) => {
            if (!user) return;
            const trimmed = slug.trim();
            if (!trimmed) return;

            try {
                await updateDoc(
                    doc(db, "kloner_users", user.uid, "kloner_renders", renderId),
                    { nameHint: trimmed },
                );
            } catch (err) {
                console.error("Failed to save render nameHint", err);
            }
        },
        [user],
    );

    // ---- state ----

    const [deployWizardLiveUrl, setDeployWizardLiveUrl] = useState<string | null>(null);


    type UICredits = {
        screenshotUsed: number;
        previewUsed: number;
        screenshotRemaining: number | null;
        previewRemaining: number | null;
    };

    const [credits, setCredits] = useState<UICredits>({
        screenshotUsed: 0,
        previewUsed: 0,
        screenshotRemaining: null,
        previewRemaining: null,
    });

    // derived limits for denominator (fallback only)
    const screenshotLimitDisplay =
        tierLimits.screenshotMonthly && tierLimits.screenshotMonthly > 0
            ? tierLimits.screenshotMonthly
            : null;

    const previewLimitDisplay =
        tierLimits.previewMonthly && tierLimits.previewMonthly > 0
            ? tierLimits.previewMonthly
            : null;

    /* ───────── credits (read from Firestore) ───────── */

    // Watch kloner_users/{uid} and derive credits from the canonical buckets:
    //   credits.preview
    //   credits.snapshot
    useEffect(() => {
        if (!user) {
            setCredits({
                screenshotUsed: 0,
                previewUsed: 0,
                screenshotRemaining: null,
                previewRemaining: null,
            });
            return;
        }

        const ref = doc(db, "kloner_users", user.uid);
        const unsub = onSnapshot(ref, (snap) => {
            if (!snap.exists()) {
                // No doc yet: treat as full allowance based on tier limits
                const screenshotLimit =
                    tierLimits.screenshotMonthly && tierLimits.screenshotMonthly > 0
                        ? tierLimits.screenshotMonthly
                        : 0;
                const previewLimit =
                    tierLimits.previewMonthly && tierLimits.previewMonthly > 0
                        ? tierLimits.previewMonthly
                        : 0;

                setCredits({
                    screenshotUsed: 0,
                    previewUsed: 0,
                    screenshotRemaining: screenshotLimit || null,
                    previewRemaining: previewLimit || null,
                });
                return;
            }

            const creditsMap = (snap.data() as any) || {};
            // ONLY read nested buckets under `credits`
            const previewBucket = (creditsMap['credits.preview'] as any) || {};
            const snapshotBucket = (creditsMap['credits.snapshot'] as any) || {};

            const previewLimit =
                typeof previewBucket.monthlyLimit === "number" &&
                    previewBucket.monthlyLimit >= 0
                    ? previewBucket.monthlyLimit
                    : tierLimits.previewMonthly || 0;

            const screenshotLimit =
                typeof snapshotBucket.monthlyLimit === "number" &&
                    snapshotBucket.monthlyLimit >= 0
                    ? snapshotBucket.monthlyLimit
                    : tierLimits.screenshotMonthly || 0;

            const previewRemaining =
                previewLimit === 0
                    ? null
                    : typeof previewBucket.remaining === "number"
                        ? previewBucket.remaining
                        : previewLimit;

            const screenshotRemaining =
                screenshotLimit === 0
                    ? null
                    : typeof snapshotBucket.remaining === "number"
                        ? snapshotBucket.remaining
                        : screenshotLimit;

            setCredits({
                screenshotUsed:
                    screenshotRemaining === null || screenshotLimit === 0
                        ? 0
                        : Math.max(screenshotLimit - screenshotRemaining, 0),
                previewUsed:
                    previewRemaining === null || previewLimit === 0
                        ? 0
                        : Math.max(previewLimit - previewRemaining, 0),
                screenshotRemaining,
                previewRemaining,
            });
        });

        return () => unsub();
    }, [
        user?.uid,
        tierLimits.screenshotMonthly,
        tierLimits.previewMonthly,
        db,
    ]);

    // Simple accessors for UI
    const screenshotRemaining = credits.screenshotRemaining;
    const previewRemaining = credits.previewRemaining;

    function canUseScreenshotCredit(): boolean {
        if (screenshotRemaining === null) return true; // unlimited
        return screenshotRemaining > 0;
    }

    function canUsePreviewCredit(): boolean {
        if (previewRemaining === null) return true; // unlimited
        return previewRemaining > 0;
    }


    /* ───────── storage helpers ───────── */

    async function listAllDeep(root: StorageReference): Promise<StorageReference[]> { const out: StorageReference[] = []; async function walk(ref: StorageReference) { const l = await listAll(ref); out.push(...l.items); await Promise.all(l.prefixes.map(walk)); } await walk(root); return out; }

    async function loadShotsForDoc(
        u: FirebaseUser,
        targetUrl: string,
        data: UrlDoc
    ) {
        const prefix =
            data.screenshotsPrefix ||
            `kloner-screenshots/${u.uid}/${data.urlHash || hash64(targetUrl)}`;

        let fileRefs: StorageReference[] = [];

        if (Array.isArray(data.screenshotPaths) && data.screenshotPaths.length) {
            fileRefs = data.screenshotPaths.map((p) => sRef(storage, p));
        } else {
            fileRefs = await listAllDeep(sRef(storage, prefix));
        }

        // NEW: build metadata index from Firestore screenshots[]
        const metaByKey = new Map<string, any>();
        if (Array.isArray(data.screenshots)) {
            for (const s of data.screenshots) {
                if (s && typeof s.key === "string") {
                    metaByKey.set(s.key, s);
                }
            }
        }

        const entries: Shot[] = await Promise.all(
            fileRefs.map(async (r) => {
                const url = await getDownloadURL(r);
                const name = r.name || r.fullPath.split("/").pop() || "image";

                const meta = metaByKey.get(r.fullPath);

                return {
                    path: r.fullPath,
                    url,
                    fileName: name,

                    // attach grouping metadata
                    snapshotId: meta?.snapshotId,
                    snapshotCreatedAt: meta?.snapshotCreatedAt,
                    sourceUrl: meta?.sourceUrl,
                    status: meta?.status,
                    bytes: meta?.bytes,
                };
            })
        );

        // keep your existing sort – newest first by filename
        entries.sort((a, b) =>
            a.fileName < b.fileName ? 1 : a.fileName > b.fileName ? -1 : 0
        );

        setShots(entries);
    }

    const openViewer = useCallback((i: number) => {
        setViewerIdx(i);
        setViewerOpen(true);
        try {
            document.documentElement.style.overflow = "hidden";
        } catch {
            // ignore
        }
    }, []);

    const closeViewer = useCallback(() => {
        setViewerOpen(false);
        try {
            document.documentElement.style.overflow = "";
        } catch {
            // ignore
        }
    }, []);

    const [checkoutBusy, setCheckoutBusy] = useState(false);


    const nextShot = useCallback(() => {
        if (!shots.length) return;
        setViewerIdx((i) => (i + 1) % shots.length);
    }, [shots.length]);

    const prevShot = useCallback(() => {
        if (!shots.length) return;
        setViewerIdx((i) => (i - 1 + shots.length) % shots.length);
    }, [shots.length]);

    useEffect(() => {
        if (!viewerOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeViewer();
            else if (e.key === "ArrowRight") nextShot();
            else if (e.key === "ArrowLeft") prevShot();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [viewerOpen, closeViewer, nextShot, prevShot]);

    const startHardLock = useCallback(
        (key: string, renderId?: string, ms = 60_000) => {
            const until = Date.now() + ms;
            setLockUntilByKey((m) => ({
                ...m,
                [key]: Math.max(m[key] || 0, until),
            }));
            if (renderId) {
                setLockUntilByRender((m) => ({
                    ...m,
                    [renderId]: Math.max(m[renderId] || 0, until),
                }));
            }
        },
        []
    );

    const pollTimer = useRef<ReturnType<typeof setInterval> | null>(
        null
    );
    const pollStopAt = useRef<number>(0);

    /* ───────── url + tier ───────── */

    const targetUrl = useMemo(() => {
        let raw = search.get("u");

        if (!raw) {
            try {
                raw = localStorage.getItem("kloner:lastUrl") || "";
            } catch {
                raw = "";
            }
        }

        if (!raw) return "";

        try {
            const dec = decodeURIComponent(raw);
            return normUrl(ensureHttp(dec));
        } catch {
            return normUrl(ensureHttp(raw));
        }
    }, [search]);

    const [urlMenuOpen, setUrlMenuOpen] = useState(false);
    const urlMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            if (!urlMenuRef.current) return;
            if (!urlMenuRef.current.contains(e.target as Node)) {
                setUrlMenuOpen(false);
            }
        }
        document.addEventListener("click", onDocClick);
        return () => document.removeEventListener("click", onDocClick);
    }, []);

    const activeUrlDoc = useMemo(() => {
        if (!urls.length) return null;
        const match = targetUrl
            ? urls.find(
                (u) => normUrl(u.url) === normUrl(targetUrl)
            )
            : null;
        return match ?? urls[0];
    }, [urls, targetUrl]);

    const orderedUrls = useMemo(() => {
        if (!activeUrlDoc) return [];
        const rest = urls.filter((u) => u.id !== activeUrlDoc.id);
        return [activeUrlDoc, ...rest];
    }, [urls, activeUrlDoc]);

    const targetHash = useMemo(
        () => (isHttpUrl(targetUrl) ? hash64(targetUrl) : null),
        [targetUrl]
    );

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) {
                const next = encodeURIComponent(
                    `/dashboard/view?u=${encodeURIComponent(targetUrl || "")}`
                );
                router.replace(`/login?next=${next}`);
                return;
            }

            setUser(u);

            let effectiveTier: UserTier = "free";

            try {
                // 1) Primary source: backend billing API (Stripe + Firestore)
                const res = await fetch("/api/billing/tier", {
                    method: "GET",
                    credentials: "include",
                });

                if (res.ok) {
                    const data = await res.json();
                    const t = data?.tier as string | undefined;

                    if (t === "pro" || t === "agency" || t === "enterprise") {
                        effectiveTier = t as UserTier;
                    } else {
                        effectiveTier = "free";
                    }
                } else {
                    // 2) Fallback: custom claims
                    const result = await getIdTokenResult(u, true);
                    const claimTier = (result.claims.userTier as string) || "free";
                    if (
                        claimTier === "pro" ||
                        claimTier === "agency" ||
                        claimTier === "enterprise"
                    ) {
                        effectiveTier = claimTier as UserTier;
                    } else {
                        effectiveTier = "free";
                    }
                }
            } catch {
                // 3) Hard fallback: try claims, otherwise stay on "free"
                try {
                    const result = await getIdTokenResult(u, true);
                    const claimTier = (result.claims.userTier as string) || "free";
                    if (
                        claimTier === "pro" ||
                        claimTier === "agency" ||
                        claimTier === "enterprise"
                    ) {
                        effectiveTier = claimTier as UserTier;
                    } else {
                        effectiveTier = "free";
                    }
                } catch {
                    effectiveTier = "free";
                }
            }

            setUserTier(effectiveTier);
            // Credits are now driven entirely by Firestore (credits bucket),
            // via the separate onSnapshot-based hook you wired up.
        });

        return () => unsub();
        // router keeps redirect behavior; we no longer care about todayKey here.
    }, [router]);


    useEffect(() => {
        (async () => {
            if (!user) {
                setUrls([]);
                setUrlsLoading(false);
                return;
            }

            setUrlsLoading(true);
            try {
                const qy = query(
                    collection(db, "kloner_users", user.uid, "kloner_urls"),
                    orderBy("createdAt", "desc"),
                    limit(50)
                );
                const snap = await getDocs(qy);
                const list = snap.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as UrlDoc),
                }));
                setUrls(list);
            } finally {
                setUrlsLoading(false);
            }
        })();
    }, [user]);

    /* ───────── url doc + screenshots ───────── */

    const lastDocShotsKeyRef = useRef<string>("");

    useEffect(() => {
        let unsubUrlDoc: Unsubscribe | null = null;

        (async () => {
            setErr("");
            setInfo("");
            setLoading(true);
            setDocSnap(null);
            setDocData(null);
            setShots([]);

            if (!user || !targetUrl) {
                setLoading(false);
                return;
            }

            if (!isHttpUrl(targetUrl)) {
                setErr("Invalid URL.");
                setLoading(false);
                return;
            }

            try {
                const qy = query(
                    collection(db, "kloner_users", user.uid, "kloner_urls"),
                    where("url", "==", targetUrl)
                );
                const snap = await getDocs(qy);

                if (snap.empty) {
                    setErr("No record for this URL under your account.");
                    setLoading(false);
                    return;
                }

                const first = snap.docs[0];
                setDocSnap(first);

                const initial = (first.data() || {}) as UrlDoc;
                setDocData(initial);

                lastDocShotsKeyRef.current = JSON.stringify({
                    paths: initial.screenshotPaths || [],
                    prefix: initial.screenshotsPrefix || "",
                });

                await loadShotsForDoc(user, targetUrl, initial);

                unsubUrlDoc = onSnapshot(
                    first.ref,
                    async (fresh) => {
                        const data = (fresh.data() || {}) as UrlDoc;
                        setDocData(data);

                        const currentKey = JSON.stringify({
                            paths: data.screenshotPaths || [],
                            prefix: data.screenshotsPrefix || "",
                        });

                        if (
                            currentKey !== lastDocShotsKeyRef.current
                        ) {
                            lastDocShotsKeyRef.current = currentKey;
                            await loadShotsForDoc(user, targetUrl, data);
                        }
                    }
                );
            } catch (e: any) {
                setErr(
                    e?.message || "Failed to load screenshots."
                );
            } finally {
                setLoading(false);
            }
        })();

        return () => {
            unsubUrlDoc?.();
        };
    }, [user, targetUrl]);

    /* ───────── renders (editable previews) ───────── */

    function mapRenderDoc(
        d: QueryDocumentSnapshot<DocumentData>
    ): { id: string } & RenderDoc {
        const data = d.data() as any;

        const progressFromBackend =
            typeof data.progressPercent === "number"
                ? data.progressPercent
                : typeof data.progress === "number"
                    ? data.progress
                    : null;

        return {
            id: d.id,
            // base fields
            url: data.url ?? null,
            urlHash: data.urlHash ?? null,
            key: data.key ?? data.referenceImage ?? null,
            referenceImage: data.referenceImage ?? null,
            html: data.html ?? "",
            status: (data.status as RenderDoc["status"]) ?? "ready",
            reason: (data.reason as string | null) ?? null,
            nameHint: data.nameHint ?? null,
            archived: data.archived ?? false,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            siteConfigId: data.siteConfigId ?? null,
            model: data.model ?? null,
            version: data.version ?? null,
            controllerVersion: data.controllerVersion ?? null,
            lastExportedAt: data.lastExportedAt ?? null,
            vercelProjectId: data.vercelProjectId ?? null,
            vercelProjectName: data.vercelProjectName ?? null,
            lastDeployUrl: data.lastDeployUrl ?? null,
            seoMetaByPage: data.seoMetaByPage ?? null,

            // progress wiring
            progress:
                typeof data.progress === "number"
                    ? data.progress
                    : progressFromBackend,
        };
    }


    const refreshRenders = useCallback(
        async () => {
            if (!user) return;
            if (!targetUrl || !isHttpUrl(targetUrl)) {
                setRenders((prev) =>
                    prev.length ? [] : prev
                );
                return;
            }

            setLoadingRenders(true);
            try {
                const base = collection(
                    db,
                    "kloner_users",
                    user.uid,
                    "kloner_renders"
                );
                const qs = query(
                    base,
                    where("archived", "in", [false, null]),
                    orderBy("createdAt", "desc"),
                    limit(100)
                );
                const snap = await getDocs(qs);

                const all = snap.docs.map(mapRenderDoc);

                const filtered = all.filter((r) => {
                    const byUrl = (r.url || "") === targetUrl;
                    const byHash =
                        !!targetHash && r.urlHash === targetHash;
                    const byKeyHash =
                        !!targetHash &&
                        extractHashFromKey(r.key) === targetHash;
                    return byUrl || byHash || byKeyHash;
                });

                const now = Date.now();
                for (const r of filtered) {
                    const key = r.key || "";
                    if (
                        key &&
                        lockUntilByKey[key] &&
                        lockUntilByKey[key] > now
                    ) {
                        setLockUntilByRender((m) => ({
                            ...m,
                            [r.id]: Math.max(
                                m[r.id] || 0,
                                lockUntilByKey[key]
                            ),
                        }));
                    }
                }

                const withOptimistic = [...filtered];

                for (const [k, opt] of Object.entries(
                    optimisticByKey
                )) {
                    const exists = filtered.some(
                        (r) => r.key === k
                    );
                    if (!exists) {
                        withOptimistic.unshift(opt);
                    } else {
                        setOptimisticByKey((m) => {
                            const n = { ...m };
                            delete n[k];
                            return n;
                        });
                    }
                }

                setRenders((prev) =>
                    rendersEqual(prev, withOptimistic)
                        ? prev
                        : withOptimistic
                );

                const anyQueued = withOptimistic.some(
                    (r) => r.status === "queued"
                );

                if (anyQueued) {
                    const now2 = Date.now();
                    if (!pollTimer.current) {
                        pollStopAt.current = now2 + 10 * 60 * 1000;
                        pollTimer.current = setInterval(async () => {
                            await refreshRenders();
                            if (
                                Date.now() > pollStopAt.current &&
                                pollTimer.current
                            ) {
                                clearInterval(pollTimer.current);
                                pollTimer.current = null;
                            }
                        }, 5000);
                    } else {
                        pollStopAt.current = Math.max(
                            pollStopAt.current,
                            now2 + 5 * 60 * 1000
                        );
                    }
                } else if (pollTimer.current) {
                    clearInterval(pollTimer.current);
                    pollTimer.current = null;
                }

                setPendingByKey((prev) => {
                    const next = { ...prev };
                    withOptimistic.forEach((r) => {
                        if (
                            r.key &&
                            (r.status === "ready" ||
                                r.status === "failed")
                        ) {
                            delete next[r.key];
                            setOptimisticByKey((m) => {
                                if (!m[r.key!]) return m;
                                const n = { ...m };
                                delete n[r.key!];
                                return n;
                            });
                        }
                    });
                    return next;
                });
            } finally {
                setLoadingRenders(false);
            }
        },
        [
            user,
            targetUrl,
            targetHash,
            optimisticByKey,
            lockUntilByKey,
        ]
    );

    useEffect(() => {
        if (!user || !targetUrl || !isHttpUrl(targetUrl)) {
            setRenders([]);
            return;
        }

        const base = collection(
            db,
            "kloner_users",
            user.uid,
            "kloner_renders"
        );
        const qs = query(
            base,
            where("archived", "in", [false, null]),
            orderBy("createdAt", "desc"),
            limit(100)
        );

        const unsub = onSnapshot(qs, (snap) => {
            const all = snap.docs.map(mapRenderDoc);

            const filtered = all.filter((r) => {
                const byUrl = (r.url || "") === targetUrl;
                const byHash =
                    !!targetHash && r.urlHash === targetHash;
                const byKeyHash =
                    !!targetHash &&
                    extractHashFromKey(r.key) === targetHash;
                // Include renders that match an optimistic key, even if URL doesn't match
                const byOptimisticKey =
                    r.key && Object.keys(optimisticByKey).includes(r.key);
                return byUrl || byHash || byKeyHash || byOptimisticKey;
            });

            const now = Date.now();
            for (const r of filtered) {
                const key = r.key || "";
                if (
                    key &&
                    lockUntilByKey[key] &&
                    lockUntilByKey[key] > now
                ) {
                    setLockUntilByRender((m) => ({
                        ...m,
                        [r.id]: Math.max(
                            m[r.id] || 0,
                            lockUntilByKey[key]
                        ),
                    }));
                }
            }

            const withOptimistic = [...filtered];

            for (const [k, opt] of Object.entries(
                optimisticByKey
            )) {
                const exists = filtered.some(
                    (r) => r.key === k
                );
                if (!exists) {
                    // Real render hasn't appeared yet, keep optimistic
                    withOptimistic.unshift(opt);
                } else {
                    // Real render appeared, remove optimistic and clear pending
                    setOptimisticByKey((m) => {
                        const n = { ...m };
                        delete n[k];
                        return n;
                    });
                    setPendingByKey((m) => {
                        const n = { ...m };
                        delete n[k];
                        return n;
                    });
                }
            }

            setRenders((prev) =>
                rendersEqual(prev, withOptimistic)
                    ? prev
                    : withOptimistic
            );

            setPendingByKey((prev) => {
                const next = { ...prev };
                withOptimistic.forEach((r) => {
                    if (
                        r.key &&
                        (r.status === "ready" ||
                            r.status === "failed")
                    ) {
                        delete next[r.key];
                        setOptimisticByKey((m) => {
                            if (!m[r.key!]) return m;
                            const n = { ...m };
                            delete n[r.key!];
                            return n;
                        });
                    }
                });
                return next;
            });
        });

        return () => unsub();
    }, [
        user,
        targetUrl,
        targetHash,
        optimisticByKey,
        lockUntilByKey,
    ]);

    /* ───────── actions ───────── */

    const selectUrl = useCallback(
        (u: string) => {
            const next = ensureHttp(u.trim());
            if (!next) return;
            router.push(
                `/dashboard/view?u=${encodeURIComponent(next)}`,
                { scroll: false }
            );
        },
        [router]
    );

    const buildFromCollection = useCallback(
        async (storageKeys: string[]) => {
            if (!user) return;
            if (!storageKeys.length) return;

            const primaryKey = storageKeys[0];

            // hard guard: if anything already queued or pending for this key, bail
            const alreadyQueued = renders.some(
                (r) =>
                    r.key === primaryKey &&
                    r.status === "queued" &&
                    !r.archived,
            );
            if (alreadyQueued || pendingByKey[primaryKey]) return;

            if (!canUsePreviewCredit()) {
                push(
                    "You have used all available preview credits for today on this plan.",
                    "warn",
                );
                setShowCreditsPaywall("preview");
                return;
            }

            // from here down, NOTHING should happen unless user confirms
            const confirmed = window.confirm(
                "Generate an editable preview for 15 credits?",
            );
            if (!confirmed) {
                // explicit no-op on cancel
                return;
            }

            // ── only confirmed path below ──

            const optimisticId = `local_${hash64(
                `${user.uid}|${primaryKey}|${Date.now()}`,
            )}`;

            const optimistic: { id: string } & RenderDoc = {
                id: optimisticId,
                key: primaryKey,
                referenceImage: null,
                html: "",
                status: "queued",
                url: targetUrl || null,
                urlHash: targetUrl ? hash64(targetUrl) : null,
                nameHint: targetUrl ? new URL(targetUrl).hostname : null,
                model: null,
                archived: false,
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
                controllerVersion: null,
            } as any;

            // lock AFTER confirm so a cancelled prompt never locks anything
            startHardLock(primaryKey, optimisticId, 60_000);

            // Immediately update UI state synchronously so the ghost card disables right away
            flushSync(() => {
                setRenders((prev) => [optimistic, ...prev]);
                setOptimisticByKey((m) => ({
                    ...m,
                    [primaryKey]: optimistic,
                }));
                setPendingByKey((m) => ({
                    ...m,
                    [primaryKey]: true,
                }));
            });
            setErr("");

            try {
                const body: any = { keys: storageKeys.slice(0, 25) }; // respect cap in route
                if (isHttpUrl(targetUrl)) {
                    body.url = targetUrl;
                    body.urlHash = hash64(targetUrl);
                    body.nameHint = new URL(targetUrl).hostname;
                }

                const r = await fetch("/api/preview/render", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
                    credentials: "include",
                    body: JSON.stringify(body),
                });

                const j = (await r.json().catch(() => ({}))) as any;

                if (r.status === 202) {
                    push("Server accepted collection preview job", "ok");
                    await refreshRenders();
                    return;
                }

                if (!r.ok || !j?.ok) {
                    const msg = j?.error || "Render failed";
                    setDeployWizardError(msg);
                    throw new Error(msg);
                }

                await refreshRenders();
            } catch (e: any) {
                const msg = e?.message || "Failed to start collection preview.";

                setDeployWizardError(msg);

                setRenders((prev) =>
                    prev.map((r) =>
                        r.id === optimisticId ? { ...r, status: "failed" } : r,
                    ),
                );
                setOptimisticByKey((m) => {
                    const v = m[primaryKey];
                    if (!v) return m;
                    return {
                        ...m,
                        [primaryKey]: { ...v, status: "failed" },
                    };
                });
                setErr(msg);
                push("Collection preview failed to start", "err");
            }
        },
        [
            user,
            targetUrl,
            renders,
            pendingByKey,
            refreshRenders,
            push,
            startHardLock,
            canUsePreviewCredit,
            setErr,
            setDeployWizardError,
            setShowCreditsPaywall,
        ],
    );

    const continueRender = useCallback(
        async (renderId: string) => {
            if (!user) return;

            setErr("");
            setLoading(true);

            try {
                const dref = doc(
                    db,
                    "kloner_users",
                    user.uid,
                    "kloner_renders",
                    renderId,
                );

                const snap = await getDocFromServer(dref);

                if (!snap.exists()) {
                    setErr("Preview not found.");
                    push("Preview not found", "err");
                    return;
                }

                const data = snap.data() as RenderDoc;

                // FIX: pass the doc, not the id
                const archivedPages = extractArchivedPageIdsFromRender(data);
                setActiveArchivedPageIds(archivedPages);

                const seoMetaByPage =
                    (data.seoMetaByPage as SeoMetaByPage | undefined) ?? null;

                let refSrc =
                    (data.referenceImage &&
                        (await resolveStorageUrl(data.referenceImage))) ||
                    (data.key && (await resolveStorageUrl(data.key))) ||
                    "";

                if (!refSrc) {
                    const byKey = data.key
                        ? shots.find((s) => s.path === data.key)
                        : undefined;
                    refSrc = byKey?.url || shots[0]?.url || "";
                }

                const rawHtml = data.html || "";

                // Strip everything before <!DOCTYPE html>
                let cleaned = rawHtml;
                const doctypeIndex = cleaned.indexOf("<!DOCTYPE html>");
                if (doctypeIndex !== -1) {
                    cleaned = cleaned.slice(doctypeIndex);
                }

                // Strip everything after the final </html>
                const lastHtmlClose = cleaned.lastIndexOf("</html>");
                if (lastHtmlClose !== -1) {
                    cleaned = cleaned.slice(0, lastHtmlClose + "</html>".length);
                }

                // Fallback: don't replace with empty document
                if (!cleaned.trim()) cleaned = rawHtml;

                // Persist sanitized document back to Firestore
                if (cleaned.trim() !== rawHtml.trim()) {
                    try {
                        await updateDoc(dref, {
                            html: cleaned,
                            updatedAt: serverTimestamp(),
                        });
                        console.log("Sanitized HTML persisted for render:", renderId);
                    } catch (err) {
                        console.warn("Failed to persist sanitized HTML", err);
                    }
                }

                setEditorHtml(cleaned);
                setEditorRefImg(refSrc);
                setActiveRenderId(renderId);
                setActiveSeoMetaByPage(seoMetaByPage);
                setEditorOpen(true);
            } catch (e) {
                console.error("continueRender failed", e);
                setErr("Failed to open preview.");
                push("Failed to open preview", "err");
            } finally {
                setLoading(false);
            }
        },
        [user, shots, push],
    );



    const retryRender = useCallback(
        async ({ id, key }: { id: string; key?: string | null }) => {
            if (!user) return;
            if (!key) return;

            // Optimistic: clear error + mark as queued on the SAME card
            setRenders((prev) =>
                prev.map((r) =>
                    r.id === id
                        ? {
                            ...r,
                            status: "queued",
                            reason: "requeued_after_timeout",
                            progress: 5,
                        }
                        : r,
                ),
            );

            try {
                const body: any = {
                    keys: [key],
                    retry: true,
                    renderId: id,
                };

                // if this render had url metadata, send it along
                const existing = renders.find((r) => r.id === id);
                if (existing?.url) {
                    body.url = existing.url;
                    body.urlHash = existing.urlHash;
                    body.nameHint =
                        existing.nameHint ||
                        (() => {
                            try {
                                return new URL(existing.url as string).hostname;
                            } catch {
                                return null;
                            }
                        })();
                }

                const resp = await fetch("/api/preview/render", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(body),
                });

                const j = (await resp.json().catch(() => ({}))) as any;

                if (resp.status === 202) {
                    push("Server accepted retry job", "ok");
                    await refreshRenders();
                    return;
                }

                if (!resp.ok || !j?.ok) {
                    const msg = j?.error || "Retry failed";
                    throw new Error(msg);
                }

                // Success path: refresh to pick up updated progress/status
                await refreshRenders();
                push("Retry started for this preview.", "ok");
            } catch (e: any) {
                const msg = e?.message || "Failed to retry render.";

                // Roll back optimistic change minimally back to error
                setRenders((prev) =>
                    prev.map((r) =>
                        r.id === id
                            ? {
                                ...r,
                                status: "error",
                                reason: "timeout_or_worker_shutdown",
                            }
                            : r,
                    ),
                );

                console.error("retryRender error", e);
                setErr?.(msg);
                push("Failed to retry render.", "err");
            }
        },
        [user, renders, refreshRenders, setRenders, setErr, push],
    );



    const discardRender = useCallback(
        async (renderId: string) => {
            if (!user) return;

            const ok = window.confirm("Discard this editable preview?");
            if (!ok) return;

            setDeletingRender((m) => ({
                ...m,
                [renderId]: true,
            }));

            try {
                const renderRef = doc(
                    db,
                    "kloner_users",
                    user.uid,
                    "kloner_renders",
                    renderId
                );
                const snap = await getDoc(renderRef);
                const data = snap.exists() ? (snap.data() as any) : null;

                // fire-and-forget delete of ALL storage objects for this render
                try {
                    const csrf = await ensureSessionAndCsrf();
                    await fetch("/api/user-blob/delete", {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                            ...(csrf ? { "x-csrf": csrf } : {}),
                        },
                        credentials: "include",
                        body: JSON.stringify({ renderId }),
                    });
                } catch (e) {
                    console.error("storage delete by renderId failed (non-fatal)", e);
                }

                // delete Firestore doc last
                await deleteDoc(renderRef);

                setRenders((prev) => prev.filter((r) => r.id !== renderId));
                push("Preview discarded", "ok");
            } catch (e: any) {
                setErr(e?.message || "Failed to discard preview.");
                push("Failed to discard preview", "err");
            } finally {
                setDeletingRender((m) => {
                    const n = { ...m };
                    delete n[renderId];
                    return n;
                });
            }
        },
        [user, push, setRenders, setDeletingRender, setErr]
    );


    const discardShot = useCallback(
        async (shot: Shot) => {
            if (!user || !docSnap) return;
            const ok = window.confirm(
                "Delete this screenshot and all its previews?"
            );
            if (!ok) return;

            setErr("");
            setDeletingByKey((m) => ({
                ...m,
                [shot.path]: true,
            }));

            try {
                await deleteObject(
                    sRef(storage, shot.path)
                ).catch(() => { });

                const rCol = collection(
                    db,
                    "kloner_users",
                    user.uid,
                    "kloner_renders"
                );
                const rSnap = await getDocs(
                    query(rCol, where("key", "==", shot.path))
                );
                if (rSnap.empty === false) {
                    await Promise.all(
                        rSnap.docs.map((d) => deleteDoc(d.ref))
                    );
                }

                try {
                    await updateDoc(docSnap.ref, {
                        screenshotPaths: arrayRemove(shot.path),
                        updatedAt: serverTimestamp(),
                    } as any);
                } catch {
                    // ignore
                }

                setShots((prev) =>
                    prev.filter((s) => s.path !== shot.path)
                );
                setRenders((prev) =>
                    prev.filter((r) => r.key !== shot.path)
                );

                setPendingByKey((m) => {
                    const n = { ...m };
                    delete n[shot.path];
                    return n;
                });

                setOptimisticByKey((m) => {
                    const n = { ...m };
                    delete n[shot.path];
                    return n;
                });

                push("Screenshot deleted", "ok");
            } catch (e: any) {
                setErr(
                    e?.message || "Failed to delete screenshot."
                );
                push("Failed to delete screenshot", "err");
            } finally {
                setDeletingByKey((m) => {
                    const n = { ...m };
                    delete n[shot.path];
                    return n;
                });
            }
        },
        [user, docSnap, push]
    );

    async function exportToVercel(opts: {
        html: string;
        name?: string;
        renderId?: string;
    }) {
        // full funnel timer
        const funnelStartMs = Date.now();

        setEditorOpen(false);

        const { html, name, renderId } = opts;
        const resolvedRenderId = renderId || activeRenderId || null;

        const trimmedNameInput = name?.trim() || "";
        const hasName = trimmedNameInput.length > 0;

        // mark funnel start
        await recordDeployAnalytics(user, {
            lastExportFlowStartedAt: serverTimestamp(),
            lastExportFlowRenderId: resolvedRenderId ?? null,
            lastExportFlowUserTier: userTier ?? null,
            lastExportFlowSource: "editor_export_button",
        });

        // If no name, open wizard at step 1 and bail.
        if (!hasName) {
            const durationMs = Date.now() - funnelStartMs;

            await recordDeployAnalytics(
                user,
                {
                    lastExportFlowStatus: "missing_name",
                    lastExportFlowEndedAt: serverTimestamp(),
                    lastExportFlowDurationMs: durationMs,
                },
                ["missingNameCount"],
            );

            setDeployWizardBusy(false);
            setDeployWizardError(null);
            setDeployWizardStep(1);
            autoDeployTriggeredRef.current = false;

            if (resolvedRenderId) {
                setDeployWizardRenderId(resolvedRenderId);

                setDeployWizardProjectName("your-website");
                // const target = renders.find((r) => r.id === resolvedRenderId);
                // setDeployWizardProjectName(target?.nameHint || "");
            } else {
                setDeployWizardRenderId(null);
                setDeployWizardProjectName("");
            }

            setDeployWizardOpen(true);
            return;
        }

        // Free tier: force upgrade step, do NOT deploy.
        if (userTier === "free") {
            const durationMs = Date.now() - funnelStartMs;

            await recordDeployAnalytics(
                user,
                {
                    lastExportFlowStatus: "paywall_blocked",
                    lastPaywallShownAt: serverTimestamp(),
                    lastExportFlowEndedAt: serverTimestamp(),
                    lastExportFlowDurationMs: durationMs,
                    lastPaywallReason: "export_to_vercel_free_tier",
                },
                ["paywallShownCount"],
            );

            if (deployWizardStep !== 5) {
                setDeployWizardBusy(false);
                setDeployWizardError(null);
                setDeployWizardStep(5);

                if (resolvedRenderId) {
                    setDeployWizardRenderId(resolvedRenderId);
                    const target = renders.find((r) => r.id === resolvedRenderId);
                    setDeployWizardProjectName(
                        target?.nameHint || trimmedNameInput,
                    );
                } else {
                    setDeployWizardRenderId(null);
                    setDeployWizardProjectName(trimmedNameInput);
                }

                setDeployWizardOpen(true);
                push("Export and deploy are reserved for paid plans.", "warn");
            }
            return;
        }

        // ── Resolve canonical project name from Firestore ──
        let projectName = trimmedNameInput;

        if (user && resolvedRenderId) {
            const renderRef = doc(
                db,
                "kloner_users",
                user.uid,
                "kloner_renders",
                resolvedRenderId,
            );

            try {
                // write the name immediately
                await updateDoc(renderRef, { nameHint: projectName });

                // then read back as canonical (in case some other process changed it)
                const snap = await getDoc(renderRef);
                if (snap.exists()) {
                    const data = snap.data() as any;
                    if (typeof data?.nameHint === "string") {
                        const dbName = data.nameHint.trim();
                        if (dbName) {
                            projectName = dbName;
                        }
                    }
                }
            } catch (err) {
                console.error("Failed to sync project name with Firestore", err);
                // fall back to local projectName
            }
        }

        if (resolvedRenderId) {
            setDeployWizardRenderId(resolvedRenderId);
        } else {
            setDeployWizardRenderId(null);
        }

        setDeployWizardProjectName(projectName);
        setDeployWizardError(null);
        setDeployWizardStep(3);
        setDeployWizardOpen(true);
        setDeployWizardBusy(true);
        setDeployWizardLiveUrl(null);
        autoDeployTriggeredRef.current = false;

        if (resolvedRenderId) {
            setDeployingRenderId(resolvedRenderId);
        }

        push("Starting deployment…", "ok");

        const csrf = await ensureSessionAndCsrf();

        // derive archived routes for this render and scrub them out of the HTML
        const archivedRoutes = getArchivedRoutesForRender(resolvedRenderId, renders);
        const scrubbedHtml = scrubArchivedRoutes(html, archivedRoutes);

        const finalHtml = await buildFinalExport({
            html: scrubbedHtml,
            user,
            draftId: resolvedRenderId,
            fallbackSeoMetaByPage: activeSeoMetaByPage as SeoMetaByPage | null,
        });

        // deploy timer
        const deployStartMs = Date.now();

        try {
            const r = await fetch("/api/user-deploy", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                body: JSON.stringify({
                    html: finalHtml,
                    projectName,
                    renderId: resolvedRenderId,
                }),
            });

            const j = (await r.json().catch(() => ({}))) as any;

            if (!r.ok || !j?.url) {
                const msg = j?.error || "Vercel deploy failed";
                const deployDurationMs = Date.now() - deployStartMs;
                const funnelDurationMs = Date.now() - funnelStartMs;

                await recordDeployAnalytics(
                    user,
                    {
                        lastExportFlowStatus: "deploy_failed",
                        lastDeployError: msg,
                        lastDeployEndedAt: serverTimestamp(),
                        lastDeployDurationMs: deployDurationMs,
                        lastExportFlowEndedAt: serverTimestamp(),
                        lastExportFlowDurationMs: funnelDurationMs,
                        lastDeployProjectName: projectName,
                    },
                    ["deployErrorCount"],
                );

                setDeployWizardError(msg);
                setDeployWizardLiveUrl(null);
                push(msg, "err");
                console.error("Deploy failed", msg);
                return;
            }

            const {
                url,
                vercelProjectId: apiProjectId,
                vercelProjectName: apiProjectName,
            } = j;

            // update local render state so the overlay switches out of "Deploy"
            if (resolvedRenderId) {
                setRenders((prev) =>
                    prev.map((rr) =>
                        rr.id !== resolvedRenderId
                            ? rr
                            : {
                                ...rr,
                                lastDeployUrl: url,
                                lastExportedAt: new Date(),
                                vercelProjectId:
                                    apiProjectId ?? rr.vercelProjectId ?? null,
                                vercelProjectName:
                                    apiProjectName ??
                                    projectName ??
                                    rr.vercelProjectName ??
                                    null,
                            },
                    ),
                );
            }

            setDeployWizardLiveUrl(url);
            autoDeployTriggeredRef.current = true;

            if (user && resolvedRenderId) {
                await updateDoc(
                    doc(
                        db,
                        "kloner_users",
                        user.uid,
                        "kloner_renders",
                        resolvedRenderId,
                    ),
                    {
                        lastExportedAt: serverTimestamp(),
                        lastDeployUrl: url,
                        vercelProjectId: apiProjectId ?? null,
                        vercelProjectName: apiProjectName ?? projectName ?? null,
                    },
                );
            }

            const deployDurationMs = Date.now() - deployStartMs;
            const funnelDurationMs = Date.now() - funnelStartMs;

            await recordDeployAnalytics(
                user,
                {
                    lastExportFlowStatus: "deployed",
                    lastDeployUrl: url,
                    lastDeployProjectId: apiProjectId ?? null,
                    lastDeployProjectName: apiProjectName ?? projectName ?? null,
                    lastDeployCompletedAt: serverTimestamp(),
                    lastDeployDurationMs: deployDurationMs,
                    lastExportFlowEndedAt: serverTimestamp(),
                    lastExportFlowDurationMs: funnelDurationMs,
                    lastUserTierAtDeploy: userTier ?? null,
                    lastRenderIdAtDeploy: resolvedRenderId ?? null,
                },
                ["deploySuccessCount"],
            );

            navigator.clipboard?.writeText(url).catch(() => void 0);

            try {
                localStorage.setItem("kloner.deployments.hasUnseen", "1");
            } catch {
                // ignore
            }

            setShowDeployNextSteps(true);
            push("Deployed", "ok");

            await refreshRenders();
        } catch (err: any) {
            const msg = err?.message || "Vercel deploy failed";
            const deployDurationMs = Date.now() - deployStartMs;
            const funnelDurationMs = Date.now() - funnelStartMs;

            await recordDeployAnalytics(
                user,
                {
                    lastExportFlowStatus: "deploy_error",
                    lastDeployError: msg,
                    lastDeployEndedAt: serverTimestamp(),
                    lastDeployDurationMs: deployDurationMs,
                    lastExportFlowEndedAt: serverTimestamp(),
                    lastExportFlowDurationMs: funnelDurationMs,
                    lastDeployProjectName: projectName,
                },
                ["deployErrorCount"],
            );

            setDeployWizardError(msg);
            setDeployWizardLiveUrl(null);
            push(msg, "err");
            console.error("Deploy failed", err);
        } finally {
            setDeployingRenderId(null);
            setDeployWizardBusy(false);
        }
    }



    const activeRender = useMemo(
        () => renders.find((r) => r.id === activeRenderId) || null,
        [renders, activeRenderId]
    );

    const saveDraft = useCallback(
        async (payload: {
            draftId?: string;
            html: string;
            meta: {
                nameHint?: string;
                device: any;
                mode: any;
                pageId?: string;
                archivedPageIds?: string[];
            };
            version: number;
        }) => {
            if (!user) return;

            const rid = payload.draftId || activeRenderId;
            const trimmedNameHint =
                typeof payload.meta?.nameHint === "string"
                    ? payload.meta.nameHint.trim()
                    : "";

            const safeNameHint =
                trimmedNameHint ||
                (targetUrl ? new URL(targetUrl).hostname : null);

            const safeArchivedPageIds = Array.isArray(
                payload.meta?.archivedPageIds
            )
                ? payload.meta.archivedPageIds.filter(Boolean)
                : [];

            const baseMeta = {
                // meta is just for editor context, not the canonical archive list
                device: payload.meta.device,
                mode: payload.meta.mode,
                pageId: payload.meta.pageId || "/",
                ...(safeNameHint ? { nameHint: safeNameHint } : {}),
            };

            if (!rid) {
                const created = await addDoc(
                    collection(
                        db,
                        "kloner_users",
                        user.uid,
                        "kloner_renders"
                    ),
                    {
                        url: targetUrl || null,
                        urlHash: targetUrl ? hash64(targetUrl) : null,
                        key: null,
                        referenceImage: editorRefImg || null,
                        html: payload.html,
                        nameHint: safeNameHint,
                        status: "ready",
                        archived: false,
                        archivedPageIds: safeArchivedPageIds,
                        version: payload.version || 1,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                        meta: baseMeta,
                    } as any
                );

                setActiveRenderId(created.id);
                push("Draft saved", "ok");
                await refreshRenders();
            } else {
                await setDoc(
                    doc(
                        db,
                        "kloner_users",
                        user.uid,
                        "kloner_renders",
                        rid
                    ),
                    {
                        url: targetUrl || null,
                        urlHash: targetUrl ? hash64(targetUrl) : null,
                        html: payload.html,
                        referenceImage: editorRefImg || null,
                        nameHint: safeNameHint,
                        archivedPageIds: safeArchivedPageIds,
                        version: payload.version || 1,
                        updatedAt: serverTimestamp(),
                        meta: baseMeta,
                    },
                    { merge: true }
                );

                push("Draft updated", "ok");
                await refreshRenders();
            }
        },
        [
            user,
            activeRenderId,
            targetUrl,
            editorRefImg,
            refreshRenders,
            push,
        ]
    );


    const shotsPollRef =
        useRef<ReturnType<typeof setInterval> | null>(null);


    useEffect(
        () => () => {
            if (shotsPollRef.current)
                clearInterval(shotsPollRef.current);
        },
        []
    );

    const [activeArchivedPageIds, setActiveArchivedPageIds] = useState<string[]>(
        []
    );


    const handleArchivedPageIdsChange = useCallback(
        async (ids: string[]) => {
            console.log("[Dashboard] handleArchivedPageIdsChange", {
                renderId: activeRenderId,
                ids,
            });

            setActiveArchivedPageIds(ids);

            if (!user || !activeRenderId) {
                console.warn(
                    "[Dashboard] handleArchivedPageIdsChange missing user or activeRenderId",
                    { user: !!user, activeRenderId }
                );
                return;
            }

            try {
                const dref = doc(
                    db,
                    "kloner_users",
                    user.uid,
                    "kloner_renders",
                    activeRenderId
                );

                await updateDoc(dref, {
                    archivedPageIds: ids,
                    updatedAt: serverTimestamp(),
                });

                console.log(
                    "[Deployments] archivedPageIds persisted to Firestore",
                    {
                        renderId: activeRenderId,
                        ids,
                    }
                );
            } catch (err) {
                console.error(
                    "[Deployments] failed to persist archivedPageIds",
                    err
                );
            }
        },
        [user, activeRenderId]
    );

    useEffect(() => {
        if (didAutoSelectRef.current) return;
        if (
            !urlsLoading &&
            !targetUrl &&
            urls.length > 0
        ) {
            didAutoSelectRef.current = true;
            const first = ensureHttp(urls[0].url);
            router.replace(
                `/dashboard/view?u=${encodeURIComponent(
                    first
                )}`,
                { scroll: false }
            );
        }
    }, [urlsLoading, targetUrl, urls, router]);

    useEffect(() => {
        if (didAutoSelectRef.current) return;
        if (!urlsLoading && !targetUrl && urls.length > 0) {
            didAutoSelectRef.current = true;
            const first = ensureHttp(urls[0].url);
            router.replace(`/dashboard/view?u=${encodeURIComponent(first)}`, {
                scroll: false,
            });
        }
    }, [urlsLoading, targetUrl, urls, router]);

    // ───────── deploy wizard state: project name → vercel → deploy ─────────

    const {
        status: vercelStatus,
        checking: vercelChecking,
        refresh: refreshVercelStatus,
    } = useVercelIntegration();

    const autoDeployTriggeredRef = useRef(false);

    const [vercelInlineConnecting, setVercelInlineConnecting] = useState(false);
    const [vercelInlineError, setVercelInlineError] = useState<string | null>(null);

    const searchParams = useSearchParams();

    // ───────── connect to Vercel from inside the wizard ─────────

    function handleConnectVercelFromWizard() {
        const u = auth.currentUser;
        if (!VERCEL_INTEGRATION_SLUG || !u) {
            console.error("Missing integration slug or user not signed in");
            return;
        }

        setVercelInlineError(null);
        setVercelInlineConnecting(true);

        try {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            const state = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");

            // persist which render this wizard was for + project name
            if (deployWizardRenderId) {
                try {
                    const payload = {
                        renderId: deployWizardRenderId,
                        projectName: deployWizardProjectName,
                    };
                    localStorage.setItem(
                        "kloner_vercel_pending_deploy",
                        JSON.stringify(payload),
                    );
                } catch {
                    // non-fatal
                }
            }

            // csrf for OAuth
            localStorage.setItem("kloner_vercel_latest_csrf", state);
            document.cookie = [
                `vercel_oauth_state=${state}`,
                "Path=/",
                "Max-Age=600",
                "SameSite=Lax",
            ].join("; ");

            // tell callback where to send the user back to
            const returnTo = `/dashboard/view?vercel=connected`;
            document.cookie = [
                `vercel_oauth_return=${encodeURIComponent(returnTo)}`,
                "Path=/",
                "Max-Age=600",
                "SameSite=Lax",
            ].join("; ");

            const link = `https://vercel.com/integrations/${VERCEL_INTEGRATION_SLUG}/new?state=${state}`;
            window.location.assign(link);
        } catch (e) {
            console.error("Inline Vercel connect failed to start", e);
            setVercelInlineError("Could not open Vercel. Try again in a moment.");
            setVercelInlineConnecting(false);
        }
    }

    // ───────── on OAuth callback (?vercel=connected) restore wizard state ─────────

    useEffect(() => {
        const v = searchParams.get("vercel");
        if (v !== "connected") return;

        // ensure latest status from backend
        void (async () => {
            await refreshVercelStatus();

            let pending: { renderId?: string; projectName?: string } | null = null;
            try {
                const raw = localStorage.getItem("kloner_vercel_pending_deploy");
                if (raw) pending = JSON.parse(raw);
            } catch {
                pending = null;
            }

            if (pending?.renderId) {
                setDeployWizardRenderId(pending.renderId);
                setDeployWizardProjectName(pending.projectName || "");
            }

            autoDeployTriggeredRef.current = false;
            setDeployWizardError(null);
            setDeployWizardBusy(false);
            setDeployWizardOpen(true);
            setDeployWizardStep(2);

            try {
                localStorage.removeItem("kloner_vercel_pending_deploy");
            } catch {
                // ignore
            }
        })();
    }, [searchParams, refreshVercelStatus]);

    // ───────── step 1: start wizard from a render card ─────────

    const startDeployWizard = useCallback(
        (render: { id: string; nameHint?: string | null }) => {
            setDeployWizardRenderId(render.id);
            setDeployWizardProjectName("");
            setDeployWizardStep(1);
            setDeployWizardError(null);
            setDeployWizardOpen(true);
            autoDeployTriggeredRef.current = false;
        },
        [],
    );

    const closeDeployWizard = useCallback(() => {
        setDeployWizardOpen(false);
        setDeployWizardBusy(false);
        setDeployWizardError(null);
        setDeployWizardStep(1);
        setDeployWizardProjectName("");
        setDeployWizardRenderId(null);
        setDeployWizardLiveUrl(null);
        setShowDeployNextSteps(false);
        setDeployingRenderId(null);
        autoDeployTriggeredRef.current = false;

        try {
            const url = new URL(window.location.href);
            const params = url.searchParams;

            // strip all wizard/billing/vercel flags that could reopen it
            params.delete("wizard");
            params.delete("step");
            params.delete("billing");
            params.delete("render");
            params.delete("vercel");
            params.delete("upgraded");

            const qs = params.toString();
            const next = qs ? `${url.pathname}?${qs}` : url.pathname;

            router.replace(next, { scroll: false });
        } catch (e) {
            console.error("Failed to clear wizard query params on close", e);
        }
    }, [router]);


    const startProCheckout = useCallback(async () => {
        if (checkoutBusy) return;
        setCheckoutBusy(true);

        try {
            // ⬇️ persist project name so Stripe callback can read it from nameHint
            const slug = deployWizardProjectName.trim();
            if (slug && deployWizardRenderId) {
                try {
                    await saveRenderNameHintNow(deployWizardRenderId, slug);
                } catch (e) {
                    console.error("Failed to persist project name before checkout", e);
                }
            }

            const csrfRes = await fetch("/api/auth/csrf", {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                cache: "no-store",
            });

            const csrfData = csrfRes.ok ? await csrfRes.json().catch(() => null) : null;
            const csrf = csrfData?.csrf ?? null;

            const res = await fetch("/api/billing/create-checkout-session", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                body: JSON.stringify({
                    plan: "pro",
                    returnRenderId: deployWizardRenderId,
                    // ⬇️ come back into the wizard at step 2, not 5
                    returnStep: 2,
                }),
            });

            if (res.status === 401) {
                const next = encodeURIComponent("/dashboard/view?upgraded=1");
                window.location.href = `/login?next=${next}`;
                return;
            }

            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.url) {
                alert(data?.error || "Unable to start checkout.");
                return;
            }

            window.location.href = data.url;
        } finally {
            setCheckoutBusy(false);
        }
    }, [checkoutBusy, deployWizardRenderId, deployWizardProjectName]);



    // ───────── auto-advance from step 2 → 3 only if we have a render id ─────────

    useEffect(() => {
        if (!deployWizardOpen) return;
        if (deployWizardStep !== 2) return;
        if (vercelChecking) return;
        if (vercelStatus !== "connected") return;
        if (!deployWizardRenderId) return; // no target → do not advance

        const t = setTimeout(() => {
            setDeployWizardStep(3);
        }, 1200); // short “connected” flash

        return () => clearTimeout(t);
    }, [
        deployWizardOpen,
        deployWizardStep,
        vercelStatus,
        vercelChecking,
        deployWizardRenderId,
    ]);

    // ───────── actual deploy call ─────────

    const submitDeployWizard = useCallback(
        async (target: { id: string; html: string; nameHint?: string | null }) => {
            setDeployWizardBusy(true);
            setDeployWizardError(null);

            try {
                await exportToVercel({
                    html: target.html,
                    name: deployWizardProjectName || "Untitled",
                    renderId: target.id,
                });
            } catch (e) {
                console.error("Deploy failed", e);
                setDeployWizardError(
                    "We couldn’t finish the deploy. Please check the error notification, and try again.",
                );
            } finally {
                setDeployWizardBusy(false);
            }
        },
        [deployWizardProjectName, exportToVercel],
    );



    // ───────── auto-deploy exactly once when we land on step 3 ─────────

    useEffect(() => {
        if (!deployWizardOpen) return;
        if (deployWizardStep !== 3) return;
        if (deployWizardBusy) return;
        if (!deployWizardRenderId) return;
        if (!renders || renders.length === 0) return;
        if (autoDeployTriggeredRef.current) return;

        const target = renders.find((r) => r.id === deployWizardRenderId);
        if (!target || !target.html?.trim()) return;

        autoDeployTriggeredRef.current = true;
        void submitDeployWizard(target as any);
    }, [
        deployWizardOpen,
        deployWizardStep,
        deployWizardBusy,
        deployWizardRenderId,
        renders,
        submitDeployWizard,
    ]);


    /* ───────── UI state / labels ───────── */

    const step1Done = !!activeUrlDoc;
    const step2Done = shots.length > 0;
    const step3Done =
        renders.length > 0 && Object.keys(optimisticByKey).length === 0;
    const step4Done =
        step3Done &&
        renders.some((r) => (r as any).lastExportedAt);

    const planLabel =
        userTier === "unknown"
            ? "Detecting plan…"
            : userTier === "free"
                ? "Free plan"
                : userTier === "pro"
                    ? "Pro plan"
                    : userTier === "agency"
                        ? "Agency plan"
                        : "Enterprise plan";

    /* ───────── collections grouping ───────── */

    const groupedShots = useMemo(() => {
        if (!shots || shots.length === 0) return [];

        const groupsMap = new Map<
            string,
            { snapshotId: string; snapshotCreatedAt?: string; items: Shot[] }
        >();

        for (const s of shots) {
            const id = s.snapshotId || "ungrouped";

            let group = groupsMap.get(id);
            if (!group) {
                group = {
                    snapshotId: id,
                    snapshotCreatedAt: s.snapshotCreatedAt,
                    items: [],
                };
                groupsMap.set(id, group);
            }
            group.items.push(s);
        }

        const groups = Array.from(groupsMap.values());

        // newest snapshot first if we have timestamps
        groups.sort((a, b) => {
            const at = a.snapshotCreatedAt || "";
            const bt = b.snapshotCreatedAt || "";
            if (!at && !bt) return 0;
            if (!at) return 1;
            if (!bt) return -1;
            return at < bt ? 1 : at > bt ? -1 : 0;
        });

        return groups;
    }, [shots]);

    useEffect(() => {
        const current = search.get("u");
        if (current) {
            try {
                localStorage.setItem("kloner:lastUrl", current);
            } catch { }
        }
    }, [search]);


    // somewhere above the JSX return in this component:
    const hasGhostPending = groupedShots.some((group, groupIndex) => {
        if (groupIndex > 0) return false;
        return group.items.some((s) => pendingByKey[s.path]);
    });

    return (
        <main className="min-h-screen bg-white">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-8">
                <div className="mb-4 flex items-center gap-2">
                    <div className="h-px flex-1 bg-neutral-200/70" />
                    <div className="h-px flex-1 bg-neutral-200/70" />
                </div>
                {/* plan + credits banner */}
                <div className="mb-6 rounded-2xl border border-neutral-200 bg-gradient-to-r from-neutral-50 to-white px-4 py-3 sm:px-5 sm:py-4 text-sm sm:text-sm text-neutral-700 shadow-sm">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <div className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1">
                                    <Crown className="h-3.5 w-3.5 text-amber-500" />
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                                        Current plan
                                    </span>
                                </div>
                                <span className="text-sm font-semibold text-neutral-900">
                                    {planLabel}
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-700">
                                    Screenshots Remaining:&nbsp;
                                    <span className="font-semibold text-neutral-900">
                                        {screenshotRemaining === null || !screenshotLimitDisplay
                                            ? "-"
                                            : `${screenshotRemaining}/${screenshotLimitDisplay}`}
                                    </span>
                                </span>

                                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-700">
                                    Previews Remaining:&nbsp;
                                    <span className="font-semibold text-neutral-900">
                                        {previewRemaining === null || !previewLimitDisplay
                                            ? "-"
                                            : `${previewRemaining}/${previewLimitDisplay}`}
                                    </span>
                                </span>

                                <span className="basis-full text-[11px] text-neutral-500 px-2.5">
                                    Credits reset monthly.
                                </span>
                            </div>
                            {userTier === "free" && (
                                <p className="text-[11px] leading-relaxed text-neutral-500">
                                    Free plans include a limited number of screenshots and
                                    previews per day. Upgrading unlocks higher limits and
                                    one-click deploy.
                                </p>
                            )}
                        </div>

                        {/* actions: upgrade + earn free credits */}
                        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                            <button
                                type="button"
                                onClick={() => router.push("/price")}
                                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 hover:border-amber-300 transition-colors"
                            >
                                <Crown className="h-3.5 w-3.5" />
                                <span>
                                    {userTier === "free"
                                        ? "View upgrade options"
                                        : "Manage plan"}
                                </span>
                            </button>

                            {/* Earn free credits + tooltip */}
                            <div className="relative group">
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-800 hover:bg-neutral-50 hover:border-neutral-300 transition-colors"
                                >
                                    Earn free credits
                                </button>
                                <div className="pointer-events-none absolute right-0 z-20 mt-1 w-64 translate-y-1 rounded-md bg-neutral-900/95 px-3 py-2 text-[11px] text-neutral-100 opacity-0 shadow-lg ring-1 ring-black/10 transition group-hover:opacity-100 group-hover:translate-y-0">
                                    Share your build with the community. If it&apos;s approved, you&apos;ll earn 100 free preview credits.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>


                {/* Step 1: URL selection */}
                <section className="mb-8 rounded-3xl border border-neutral-200 bg-white/70 px-4 py-4 sm:px-5 sm:py-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/80 px-3 py-1.5 text-xs sm:text-sm text-neutral-700 shadow-sm">
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white shadow-sm">
                                1
                            </span>
                            <div className="flex flex-col leading-tight">
                                <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-400">
                                    Step 1
                                </span>
                                <span className="text-[13px] sm:text-[14px] text-neutral-800">
                                    URLs
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* url selector */}
                    <div className="mt-4">
                        {urlsLoading ? (
                            <div className="h-10 rounded-xl bg-neutral-100 animate-pulse" />
                        ) : urls.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-2 text-sm text-neutral-700 my-2 flex items-center gap-2">
                                <strong className="text-neutral-800 font-semibold inline-flex items-center gap-1">
                                    {step1Done ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                        <Clock10 className="h-4 w-4 text-amber-500" />
                                    )}
                                    Step 1
                                </strong>{" "}
                                — Add a URL in<a className="underline font-semibold tracking-wide text-amber-500" href="/dashboard">Dashboard</a>
                            </div>
                        ) : (
                            <div className="relative inline-block" ref={urlMenuRef}>
                                <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-2 text-sm text-neutral-700 my-2 flex items-center gap-2">
                                    <strong className="text-neutral-800 font-semibold inline-flex gap-1 flex items-center">
                                        {step1Done ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                        ) :
                                            <Clock10 className="h-4 w-4 text-amber-500" />
                                        }
                                        Step 1
                                    </strong>{" "}
                                    — chosen URL.
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setUrlMenuOpen((v) => !v)}
                                    className="inline-flex max-w-[540px] items-center gap-2 truncate rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
                                    title={activeUrlDoc?.url}
                                    aria-haspopup="listbox"
                                    aria-expanded={urlMenuOpen}
                                >
                                    <span className="truncate">
                                        {activeUrlDoc?.url || "Select a URL"}
                                    </span>
                                    <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500" />
                                </button>

                                {urlMenuOpen && (
                                    <div
                                        role="listbox"
                                        aria-activedescendant={activeUrlDoc?.id}
                                        className="absolute z-40 mt-2 w-[min(640px,90vw)] overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg"
                                    >
                                        <ul className="max-h-[280px] overflow-auto py-1">
                                            {orderedUrls.map((u) => {
                                                const isActive =
                                                    activeUrlDoc?.id === u.id;
                                                return (
                                                    <li key={u.id}>
                                                        <button
                                                            role="option"
                                                            aria-selected={isActive}
                                                            onClick={() => {
                                                                setUrlMenuOpen(false);
                                                                selectUrl(u.url);
                                                            }}
                                                            title={u.url}
                                                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${isActive
                                                                ? "bg-neutral-100 text-neutral-700"
                                                                : "text-neutral-800 hover:bg-neutral-50"
                                                                }`}
                                                        >
                                                            <span
                                                                className={`inline-block h-2.5 w-2.5 rounded-full ${isActive
                                                                    ? "bg-neutral-800"
                                                                    : "bg-neutral-300"
                                                                    }`}
                                                            />
                                                            <span className="truncate">
                                                                {u.url}
                                                            </span>
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </section>

                {err ? (
                    <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {err}
                    </div>
                ) : null}

                {info ? (
                    <div className="mt-2 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
                        {info}
                    </div>
                ) : null}
                <section className="mt-10 rounded-3xl border border-neutral-200 bg-white/70 px-4 py-5 sm:px-5 sm:py-6 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/80 px-3 py-1.5 text-xs sm:text-sm text-neutral-700 shadow-sm">
                                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white shadow-sm">
                                    2
                                </span>
                                <div className="flex flex-col leading-tight">
                                    <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-400">
                                        Step 2
                                    </span>
                                    <span className="text-[13px] sm:text-[14px] text-neutral-800">
                                        Websites
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <p className="mt-1 mb-2 text-sm text-neutral-500">
                        {(renders.length === 0 ? 'This section will host your editable previews'
                            :
                            'These are the website previews generated from your url.')}
                    </p>

                    {(renders.length === 0 || hasGhostPending) ? (
                        <>
                            <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-2 text-sm text-neutral-700 flex flex-wrap items-center gap-2 my-4">
                                <div className="flex items-center gap-1 p-2">
                                    <strong className="inline-flex items-center gap-2 text-neutral-800 font-semibold">
                                        {step3Done ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                        ) : (
                                            <Clock10 className="h-4 w-4 text-amber-500" />
                                        )}
                                        <span>Step 2</span>
                                    </strong>
                                    <span className="text-neutral-800">
                                        {`${step2Done
                                            ? "— Generate a preview."
                                            : "—  Below will host your website previews."
                                            }`}
                                    </span>
                                </div>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-4 text-sm text-neutral-500">
                                {groupedShots.map((group, groupIndex) => {
                                    if (groupIndex > 0) return null;

                                    const first = group.items[0];
                                    if (!first) return null;

                                    const collectionKeys = group.items.map((s) => s.path);

                                    const locked = group.items.some((s) => {
                                        if (pendingByKey[s.path]) return true;
                                        return renders.some(
                                            (r) =>
                                                r.key === s.path &&
                                                (r.status === "queued" || r.status === "processing") &&
                                                !r.archived,
                                        );
                                    });

                                    return (
                                        <GhostGeneratePreviewCard
                                            key={`ghost-${first.path}`}
                                            locked={locked}
                                            onClick={() => buildFromCollection(collectionKeys)}
                                        />
                                    );
                                })}
                            </div>
                        </>

                    ) : (
                        <>
                            <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-1 text-sm text-neutral-700 flex flex-wrap items-center gap-1 my-4">
                                <strong className="text-neutral-800 font-semibold inline-flex items-center gap-1">
                                    {step3Done ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                        <Clock10 className="h-4 w-4 text-amber-500" />
                                    )}
                                    Step 2
                                </strong>

                                {step4Done ? (
                                    <>
                                        <span>— Render deployed.</span>
                                    </>
                                ) : step3Done ? (
                                    <>
                                        <span>— Customize your preview, when you're ready, deploy it live by clicking </span>

                                        <button
                                            type="button"
                                            className="ml-1 inline-flex items-center rounded-full border border-neutral-400 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm"
                                            disabled
                                        >
                                            Deploy
                                            <Rocket className="ml-1 h-3 w-3" />
                                        </button>
                                    </>
                                ) : (
                                    <span className="text-neutral-800">
                                        — Generate previews from the collections above.
                                    </span>
                                )}
                            </div>

                            <div
                                className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                                aria-label="Editable previews list"
                            >
                                {renders.map((r) => (
                                    <RenderCard
                                        key={r.id}
                                        r={r}
                                        isDeleting={!!deletingRender[r.id] || !!archivingRender[r.id]}
                                        isOpening={loading}
                                        hardLocked={
                                            !!lockUntilByRender[r.id] && lockUntilByRender[r.id] > Date.now()
                                        }
                                        isDeploying={deployingRenderId === r.id}
                                        deployLocked={userTier === "free"}
                                        urlHash={(docData?.urlHash as string | undefined) ?? null}
                                        continueRender={continueRender}
                                        discardRender={discardRender}
                                        startDeployWizard={startDeployWizard}
                                        setShowCreditsPaywall={setShowCreditsPaywall}
                                        push={push as any}
                                        archiveRender={handleArchiveRender}
                                        unarchiveRender={handleUnarchiveRender}
                                        onShareWithCommunity={handleShareWithCommunity}
                                        retryRender={retryRender}
                                    />

                                ))}

                                {groupedShots.map((group, groupIndex) => {
                                    if (groupIndex > 0) return null;

                                    const first = group.items[0];
                                    if (!first) return null;

                                    const collectionKeys = group.items.map((s) => s.path);

                                    const locked = group.items.some((s) => {
                                        if (pendingByKey[s.path]) return true;
                                        return renders.some(
                                            (r) =>
                                                r.key === s.path &&
                                                (r.status === "queued" || r.status === "processing") &&
                                                !r.archived,
                                        );
                                    });

                                    return (
                                        <GhostGeneratePreviewCard
                                            key={`ghost-${first.path}`}
                                            locked={locked}
                                            onClick={() => buildFromCollection(collectionKeys)}
                                        />
                                    );
                                })}
                            </div>
                        </>
                    )}
                </section>

                {editorOpen && (
                    <PreviewEditor
                        initialHtml={editorHtml}
                        sourceImage={editorRefImg}
                        initialSeoMetaByPage={activeSeoMetaByPage || undefined}
                        initialArchivedPageIds={activeArchivedPageIds}
                        onArchivedPageIdsChange={
                            handleArchivedPageIdsChange
                        }
                        onClose={() => {
                            setEditorOpen(false);
                            setActiveRenderId(undefined);
                            setActiveSeoMetaByPage(null);
                            setActiveArchivedPageIds([]);
                        }}
                        onExport={(html, name) =>
                            exportToVercel({
                                html,
                                name,
                                renderId: activeRenderId,
                            })
                        }
                        draftId={activeRenderId}
                        saveDraft={saveDraft}
                        onLiveHtml={(html) => {
                            if (!activeRenderId) return;
                            setRenders((prev) =>
                                prev.map((r) =>
                                    r.id === activeRenderId ? { ...r, html } : r
                                )
                            );
                        }}
                        onSaveMeta={async (pageId, meta, fullMap) => {
                            if (!user || !activeRenderId) return;

                            const dref = doc(
                                db,
                                "kloner_users",
                                user.uid,
                                "kloner_renders",
                                activeRenderId
                            );

                            await updateDoc(dref, {
                                seoMetaByPage: fullMap,
                                updatedAt: serverTimestamp(),
                            });

                            setRenders((prev) =>
                                prev.map((r) =>
                                    r.id === activeRenderId
                                        ? { ...r, seoMetaByPage: fullMap }
                                        : r
                                )
                            );

                            setActiveSeoMetaByPage(fullMap);
                        }}
                    />
                )}


                {/* deploy wizard */}
                <AnimatePresence>
                    {deployWizardOpen && (
                        <motion.div
                            key="deploy-wizard"
                            className="fixed inset-0 z-[11500]"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                                onClick={closeDeployWizard}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.18 }}
                            />

                            <div className="absolute inset-0 flex items-center justify-center px-4 sm:px-6">
                                <motion.div
                                    className="relative w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl"
                                    initial={{ opacity: 0, y: 24, scale: 0.96 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 16, scale: 0.96 }}
                                    transition={{ duration: 0.22, ease: [0.23, 0.82, 0.25, 1] }}
                                >
                                    <button
                                        type="button"
                                        onClick={closeDeployWizard}
                                        className="absolute right-3 top-3 z-10 h-7 w-7 rounded-full border border-neutral-200 bg-white text-sm text-neutral-500 hover:bg-neutral-50"
                                    >
                                        ✕
                                    </button>

                                    <div className="relative p-5 pt-6">
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <div
                                                    className="flex h-8 w-8 items-center justify-center rounded-2xl"
                                                    style={{ background: ACCENT }}
                                                >
                                                    <Rocket className="h-4 w-4 text-white" />
                                                </div>
                                                <div>
                                                    <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">
                                                        First deploy wizard
                                                    </p>
                                                    <p className="text-sm font-semibold text-neutral-900">
                                                        Get this preview ready to go live
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="mt-6 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] text-neutral-600">
                                                Step {deployWizardStep === 5 ? "2" : deployWizardStep} of 3
                                            </span>
                                        </div>

                                        <AnimatePresence mode="wait" initial={false}>
                                            {deployWizardStep === 1 && (
                                                <motion.div
                                                    key="step-1"
                                                    initial={{ opacity: 0, x: 20 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, x: -20 }}
                                                    transition={{ duration: 0.18, ease: "easeOut" }}
                                                    className="space-y-4"
                                                >
                                                    <p className="text-sm text-neutral-600">
                                                        Name your Vercel project. This becomes the base for your live URL and deployment.
                                                    </p>

                                                    <div className="space-y-1">
                                                        <label className="text-[11px] text-neutral-700">
                                                            Project name
                                                        </label>

                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                autoFocus
                                                                value={deployWizardProjectName}
                                                                onChange={(e) => {
                                                                    const raw = e.target.value;
                                                                    const value = raw.trim();

                                                                    let err: string | null = null;

                                                                    const hasProtocol = /\bhttps?:\/\//i.test(raw);
                                                                    const hasWww = /\bwww\./i.test(raw);
                                                                    const hasDotTld = /\.(com|ca|net|org|io|app|dev|co|uk|us)\b/i.test(raw);
                                                                    const hasAnyDot = /\./.test(raw);
                                                                    const slugOk =
                                                                        value.length > 0 &&
                                                                        /^(?!-)[a-zA-Z0-9-]+(?<!-)$/.test(value); // letters, numbers, dash; no leading/trailing dash

                                                                    if (!value) {
                                                                        err = "Enter a project name.";
                                                                    } else if (hasProtocol) {
                                                                        err = "Remove https:// or http:// – only the project slug.";
                                                                    } else if (hasWww) {
                                                                        err = "Remove www. – only the project slug.";
                                                                    } else if (hasDotTld || hasAnyDot) {
                                                                        err = "Remove .com/.ca and any dots. Use only the slug.";
                                                                    } else if (!slugOk) {
                                                                        err =
                                                                            "Use only letters, numbers, and dashes, no spaces, and don't start or end with a dash.";
                                                                    }

                                                                    setDeployWizardProjectName(raw);
                                                                    setDeployWizardError(err);

                                                                    if (!err && deployWizardRenderId) {
                                                                        persistProjectNameHint(deployWizardRenderId, value);
                                                                    }
                                                                }}
                                                                placeholder="e.g. kloner-landing, client-site-01"
                                                                className={`mt-0.5 w-full rounded-full border px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 ${deployWizardError
                                                                    ? "border-red-500 focus:ring-red-500"
                                                                    : "border-neutral-300 focus:ring-[rgba(245,95,42,0.6)] focus:border-transparent"
                                                                    }`}
                                                            />
                                                            <span className="text-[11px] text-neutral-600">
                                                                .vercel.app
                                                            </span>
                                                        </div>

                                                        <div className="min-h-[14px] mt-0.5">
                                                            {deployWizardError && (
                                                                <p className="text-[11px] text-red-600">
                                                                    {deployWizardError}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 flex items-center justify-between gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={closeDeployWizard}
                                                            className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
                                                        >
                                                            Close
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                const slug = deployWizardProjectName.trim();
                                                                if (!slug || deployWizardError || deployWizardBusy) return;

                                                                if (deployWizardRenderId) {
                                                                    await saveRenderNameHintNow(deployWizardRenderId, slug);
                                                                }

                                                                setDeployWizardStep(2);
                                                            }}
                                                            disabled={
                                                                !deployWizardProjectName.trim() ||
                                                                !!deployWizardError ||
                                                                deployWizardBusy
                                                            }
                                                            className="rounded-full px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
                                                            style={{ backgroundColor: ACCENT }}
                                                        >
                                                            Continue
                                                        </button>

                                                    </div>
                                                </motion.div>
                                            )}

                                            {deployWizardStep === 2 && (
                                                <motion.div
                                                    key="step-2"
                                                    initial={{ opacity: 0, x: 20 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, x: -20 }}
                                                    transition={{ duration: 0.18, ease: "easeOut" }}
                                                    className="space-y-4"
                                                >
                                                    {vercelStatus === "connected" ? (
                                                        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                                                            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-white">
                                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                                            </div>
                                                            <div>
                                                                <p className="text-neutral-900">
                                                                    Vercel successfully connected
                                                                </p>
                                                                <p className="text-[11px] text-emerald-700">
                                                                    You&apos;ll be moved to deploy in a moment…
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <p className="text-sm text-neutral-600">
                                                                Kloner deploys using your saved Vercel integration. Connect once, then
                                                                future deploys are one click.
                                                            </p>
                                                        </>
                                                    )}

                                                    {vercelStatus !== "connected" && (
                                                        <div className="mt-4 flex items-center justify-between gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={closeDeployWizard}
                                                                disabled={deployWizardBusy}
                                                                className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                Close
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={handleConnectVercelFromWizard}
                                                                disabled={deployWizardBusy}
                                                                className="rounded-full px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                                                style={{ backgroundColor: ACCENT }}
                                                            >
                                                                Connect Vercel
                                                            </button>
                                                        </div>
                                                    )}
                                                </motion.div>
                                            )}

                                            {deployWizardStep === 3 && (
                                                <motion.div
                                                    key="step-3"
                                                    initial={{ opacity: 0, x: 20 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, x: -20 }}
                                                    transition={{ duration: 0.18, ease: "easeOut" }}
                                                    className="space-y-4"
                                                >
                                                    <p className="text-sm text-neutral-600">
                                                        We&apos;re sending this preview to Vercel as a new deployment.
                                                    </p>

                                                    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-700">
                                                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white border border-neutral-300">
                                                            {deployWizardError ? (
                                                                <span className="text-sm text-red-500 font-semibold">!</span>
                                                            ) : deployWizardBusy ? (
                                                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-[rgba(245,95,42,0.95)]" />
                                                            ) : (
                                                                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className="text-neutral-900">
                                                                {deployWizardError
                                                                    ? "Deploy failed"
                                                                    : deployWizardBusy
                                                                        ? "Deploying to Vercel…"
                                                                        : autoDeployTriggeredRef.current
                                                                            ? "Deployment created"
                                                                            : "Ready to deploy"}
                                                            </p>
                                                            <p className="text-[11px] text-neutral-600">
                                                                {deployWizardError && deployWizardError}
                                                                {!deployWizardError &&
                                                                    deployWizardBusy &&
                                                                    "This can take up to a minute depending on your project."}
                                                                {!deployWizardError &&
                                                                    !deployWizardBusy &&
                                                                    autoDeployTriggeredRef.current &&
                                                                    (deployWizardLiveUrl
                                                                        ? "Your site is live. You can open it in a new tab."
                                                                        : "Open the Deployments tab to see build status and your live URL.")}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 flex items-center justify-between gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={closeDeployWizard}
                                                            className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                                                        >
                                                            Close
                                                        </button>

                                                        {!deployWizardBusy &&
                                                            !deployWizardError &&
                                                            deployWizardLiveUrl && (
                                                                <a
                                                                    href={deployWizardLiveUrl}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="group flex flex-inline items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-white"
                                                                    style={{ backgroundColor: ACCENT }}
                                                                >
                                                                    <span>View Site</span>
                                                                    <Rocket className="h-4 w-4 transform transition-transform duration-150 group-hover:translate-x-0.5" />
                                                                </a>
                                                            )}
                                                    </div>
                                                </motion.div>
                                            )}

                                            {deployWizardStep === 5 && (
                                                <motion.div
                                                    key="step-5"
                                                    initial={{ opacity: 0, x: 20 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, x: -20 }}
                                                    transition={{ duration: 0.18, ease: "easeOut" }}
                                                    className="space-y-5"
                                                >
                                                    <div className="space-y-1.5">
                                                        <p className="text-sm font-semibold text-neutral-900">
                                                            Upgrade required to publish this site
                                                        </p>
                                                        <p className="text-[11px] text-neutral-600 leading-relaxed">
                                                            Deploying previews to Vercel is a paid feature. Upgrading unlocks instant
                                                            publishing, higher limits, and full multi-site workflows.
                                                        </p>
                                                    </div>

                                                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 space-y-3">
                                                        <div className="flex items-start gap-3">
                                                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900">
                                                                <MessageCircleWarning className="text-white h-3.5 w-3.5" />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <p className="mb-4 text-md text-neutral-900">
                                                                    What you get on Pro
                                                                </p>
                                                                <ul className="space-y-1.5 text-[14px] text-neutral-600">
                                                                    <li className="flex items-center gap-1.5">
                                                                        <span
                                                                            className="h-1.5 w-1.5 rounded-full"
                                                                            style={{ backgroundColor: ACCENT }}
                                                                        />
                                                                        <span>Deploy multiple websites</span>
                                                                    </li>
                                                                    <li className="flex items-center gap-1.5">
                                                                        <span
                                                                            className="h-1.5 w-1.5 rounded-full"
                                                                            style={{ backgroundColor: ACCENT }}
                                                                        />
                                                                        <span>Access to 200+ design tools</span>
                                                                    </li>
                                                                    <li className="flex items-center gap-1.5">
                                                                        <span
                                                                            className="h-1.5 w-1.5 rounded-full"
                                                                            style={{ backgroundColor: ACCENT }}
                                                                        />
                                                                        <span>Higher preview and screenshot limits</span>
                                                                    </li>
                                                                    <li className="flex items-center gap-1.5">
                                                                        <span
                                                                            className="h-1.5 w-1.5 rounded-full"
                                                                            style={{ backgroundColor: ACCENT }}
                                                                        />
                                                                        <span>Priority access to new design engines</span>
                                                                    </li>
                                                                    <li className="flex items-center gap-1.5">
                                                                        <span
                                                                            className="h-1.5 w-1.5 rounded-full"
                                                                            style={{ backgroundColor: ACCENT }}
                                                                        />
                                                                        <span>Priority queue for faster generations</span>
                                                                    </li>
                                                                    <li className="flex items-center gap-1.5">
                                                                        <span
                                                                            className="h-1.5 w-1.5 rounded-full"
                                                                            style={{ backgroundColor: ACCENT }}
                                                                        />
                                                                        <span>One-click Vercel deployment</span>
                                                                    </li>
                                                                </ul>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <motion.button
                                                        type="button"
                                                        onClick={() => void startProCheckout()}
                                                        disabled={checkoutBusy}
                                                        className="group flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(0,0,0,0.6)] focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-70 disabled:cursor-wait"
                                                        style={{ backgroundColor: ACCENT }}
                                                        whileHover={{ scale: 1.02 }}
                                                        whileTap={{ scale: 0.99 }}
                                                        transition={{ duration: 0.16, ease: "easeOut" }}
                                                    >
                                                        <span className="flex items-center gap-1.5">
                                                            <span>
                                                                {checkoutBusy
                                                                    ? "Redirecting to Stripe…"
                                                                    : "Go Pro and Deploy Your Site"}
                                                            </span>
                                                            <span
                                                                className="inline-flex items-center justify-center overflow-hidden text-base opacity-0 translate-x-[-4px] transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0"
                                                                aria-hidden="true"
                                                            >
                                                                →
                                                            </span>
                                                        </span>
                                                    </motion.button>

                                                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-700 flex items-center gap-3">
                                                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900">
                                                            {deployWizardBusy ? (
                                                                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                                            ) : deployWizardError ? (
                                                                <span className="text-sm text-red-500">!</span>
                                                            ) : (
                                                                <ScanFace className="h-4 w-4 text-white" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className="text-neutral-900">
                                                                {deployWizardBusy
                                                                    ? "Checking your plan…"
                                                                    : deployWizardError
                                                                        ? "Upgrade check failed"
                                                                        : "Join 5000+ designers and developers using Kloner."}
                                                            </p>
                                                            <p className="text-[11px] text-neutral-600">
                                                                {deployWizardBusy &&
                                                                    "This can take a moment while we verify your current plan."}
                                                                {!deployWizardBusy &&
                                                                    !deployWizardError &&
                                                                    "After upgrading, we'll return you here to finish deployment."}
                                                                {deployWizardError && deployWizardError}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 flex items-center justify-between gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={closeDeployWizard}
                                                            className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
                                                        >
                                                            Close
                                                        </button>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </motion.div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>



                <Toasts toasts={toasts} />

                <style>
                    {`@keyframes spin{to{transform:rotate(360deg)}}`}
                </style>

                {/* screenshot viewer */}
                {
                    viewerOpen && shots[viewerIdx] && (
                        <div className="fixed inset-0 z-[10000]">
                            <div
                                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                                onClick={closeViewer}
                            />
                            <div className="absolute inset-0 p-4 sm:p-6 md:p-8 grid place-items-center">
                                <div className="relative w-full h-full max-w-[min(95vw,1400px)]">
                                    <div className="absolute top-0 bg-black/70 h-20 left-0 right-0 z-10 flex items-center justify-between gap-2 p-2 sm:p-3">
                                        <div className="text-[11px] sm:text-sm text-white/80 truncate">
                                            {shots[viewerIdx].fileName}
                                        </div>
                                        <button
                                            onClick={closeViewer}
                                            className="rounded-md"
                                            style={{
                                                background: ACCENT,
                                                color: "#fff",
                                                padding: "6px 10px",
                                                fontSize: "12px",
                                            }}
                                        >
                                            Close
                                        </button>
                                    </div>
                                    <div className="absolute inset-0 mt-8 mb-8 overflow-auto rounded-md ring-1 ring-white/10 bg-black/40">
                                        <div className="min-h-full w-full grid place-items-center p-4">
                                            <img
                                                src={shots[viewerIdx].url}
                                                alt={shots[viewerIdx].fileName}
                                                style={{
                                                    width: "auto",
                                                    height: "auto",
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={prevShot}
                                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full text-white h-9 w-9 grid place-items-center shadow ring-1 ring-neutral-200"
                                        style={{ background: ACCENT }}
                                        aria-label="Previous screenshot"
                                    >
                                        ‹
                                    </button>
                                    <button
                                        onClick={nextShot}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full text-white h-9 w-9 grid place-items-center shadow ring-1 ring-neutral-200"
                                        style={{ background: ACCENT }}
                                        aria-label="Next screenshot"
                                    >
                                        ›
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* generic paywall */}
                {
                    showCreditsPaywall && (
                        <div className="fixed inset-0 z-[12000]">
                            <div className="absolute inset-0 bg-black/60" />
                            <div className="absolute inset-0 flex items-center justify-center p-4">
                                <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-neutral-200 p-6 text-sm text-neutral-800">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Crown className="h-4 w-4 text-amber-500" />
                                        <h3 className="text-base font-semibold">
                                            You’ve hit the limit on your{" "}
                                            {userTier === "free" ? "free" : userTier} plan
                                        </h3>
                                    </div>
                                    <p className="text-sm text-neutral-600 mb-3">
                                        {showCreditsPaywall === "screenshot" &&
                                            "You have used all monthly screenshot credits. Upgrade to capture more pages and monitor more sites."}
                                        {showCreditsPaywall === "preview" &&
                                            "You have used all monthly preview credits. Upgrade to generate more designs and unlock one-click deploy."}
                                        {showCreditsPaywall === "deploy" &&
                                            "To deploy your website live, upgrade to a paid plan to unlock one-click deploy."}
                                    </p>
                                    <ul className="mb-4 list-disc list-inside text-sm text-neutral-700 space-y-1">
                                        <li>
                                            Higher monthly limits for screenshots and previews
                                        </li>
                                        <li>
                                            Unlock deployments and live URLs
                                        </li>
                                        <li>Priority rendering and faster queues</li>
                                    </ul>
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowCreditsPaywall(null)}
                                            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                                        >
                                            Not now
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowCreditsPaywall(null);
                                                router.push("/price");
                                            }}
                                            className="rounded-md px-3 py-1.5 text-sm font-semibold text-white"
                                            style={{ backgroundColor: ACCENT }}
                                        >
                                            View upgrade options
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }

                {
                    showUpgradeAfterCustomize && (
                        <div className="fixed inset-0 z-[12050]">
                            {/* Backdrop */}
                            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

                            {/* Shell */}
                            <div className="absolute inset-0 flex items-center justify-center px-4 sm:px-6">
                                <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/8 bg-neutral-950/95 text-neutral-50 shadow-[0_30px_120px_rgba(0,0,0,0.85)]">
                                    {/* Accent glow */}
                                    <div
                                        className="pointer-events-none absolute inset-x-10 -top-24 h-40 rounded-full blur-3xl opacity-80"
                                        style={{
                                            background: `radial-gradient(circle, ${ACCENT}40 0%, transparent 65%)`,
                                        }}
                                    />

                                    <div className="relative p-6 sm:p-7">
                                        {/* Header row */}
                                        <div className="mb-4 flex items-start justify-between gap-3">
                                            <div className="flex items-start gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-neutral-900/80 border border-white/10">
                                                    <Crown className="h-4 w-4 text-amber-400" />
                                                </div>
                                                <div>
                                                    <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-400">
                                                        You just customized a live preview
                                                    </p>
                                                </div>
                                            </div>

                                            <span className="whitespace-nowrap rounded-full border border-white/10 bg-neutral-900/80 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-neutral-400">
                                                Pro upgrade
                                            </span>
                                        </div>

                                        <h3 className="text-2xl mb-4  font-semibold tracking-tight text-white">
                                            Turn this preview into a real, live site
                                        </h3>
                                        {/* Value stack */}
                                        <div className="mb-4 grid gap-2 text-sm sm:text-[13px] text-neutral-200">
                                            <div className="flex items-start gap-2.5">
                                                <div
                                                    className="mt-[3px] h-2 w-2 rounded-full"
                                                    style={{ backgroundColor: ACCENT }}
                                                />
                                                <div>
                                                    <p className="text-white">
                                                        Publish in minutes
                                                    </p>
                                                    <p className="text-[11px] text-neutral-400">
                                                        Kloner ships this exact preview to a
                                                        live URL, no Git, no config.
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-start gap-2.5">
                                                <div
                                                    className="mt-[3px] h-2 w-2 rounded-full"
                                                    style={{ backgroundColor: ACCENT }}
                                                />
                                                <div>
                                                    <p className="text-white">
                                                        Your domain, your branding
                                                    </p>
                                                    <p className="text-[11px] text-neutral-400">
                                                        Point your own domain, and own the
                                                        experience.
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-start gap-2.5">
                                                <div
                                                    className="mt-[3px] h-2 w-2 rounded-full"
                                                    style={{ backgroundColor: ACCENT }}
                                                />
                                                <div>
                                                    <p className="text-white">
                                                        Keep editing visually
                                                    </p>
                                                    <p className="text-[11px] text-neutral-400">
                                                        Keep using the editor you’re in right
                                                        now. Every change ships with one click.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* What happens next strip */}
                                        <div className="mb-5 rounded-2xl border border-white/10 bg-neutral-900/80 px-3 py-2.5 text-[14px] text-neutral-300">
                                            <p className="mb-1 text-neutral-100">
                                                What happens when you continue
                                            </p>
                                            <p className="text-[12px] text-neutral-200">
                                                1) Pick a plan · 2) Fast, secure checkout · 3)
                                                Click publish and your site goes live.
                                            </p>
                                        </div>

                                        {/* Actions */}
                                        <div className="space-y-2.5">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowUpgradeAfterCustomize(false);
                                                    router.push("/price");
                                                }}
                                                className="flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(0,0,0,0.6)] transition transform hover:-translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-white/20"
                                                style={{ backgroundColor: ACCENT }}
                                            >
                                                Upgrade and publish this site
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setShowUpgradeAfterCustomize(false)
                                                }
                                                className="flex w-full items-center justify-center rounded-xl px-4 py-2 text-[11px] text-neutral-400 hover:bg-neutral-900/70 hover:text-neutral-200 transition"
                                            >
                                                Keep editing for now
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* deploy next-steps banner */}
                {
                    showDeployNextSteps && (
                        <div className="fixed bottom-4 left-1/2 z-[9000] -translate-x-1/2 px-4">
                            <div className="max-w-xl rounded-2xl border border-neutral-400 bg-white shadow-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 text-sm sm:text-sm text-neutral-800">
                                <div className="flex-1">
                                    <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-800">
                                        <CheckCircle2 className="text-green-600" />
                                        <span>New deployment in progress</span>
                                    </div>
                                    <p className="mt-1 text-[11px] sm:text-sm text-neutral-600">
                                        Watch build status, logs, and history on the
                                        Deployments tab. Your latest deploy has just been
                                        created.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowDeployNextSteps(false);
                                            router.push("/dashboard/deployments");
                                        }}
                                        className="rounded-md px-3 py-1.5 text-[11px] sm:text-sm text-white"
                                        style={{ backgroundColor: ACCENT }}
                                    >
                                        Open deployments
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowDeployNextSteps(false)}
                                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-[11px] sm:text-sm text-neutral-700 hover:bg-neutral-50"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }
            </div >
        </main >
    );
}
