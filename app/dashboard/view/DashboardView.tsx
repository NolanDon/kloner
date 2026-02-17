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
import Image from 'next/image'
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
import { buildFinalExport, buildSeoMetaMapForExport, SeoMeta, SeoMetaMap } from "@/components/editor/PreviewEditor";
import PreviewEditorManager from "@/components/editor/PreviewEditorManager";
import {
    Rocket,
    ChevronDown,
    Hammer,
    CheckCircle2,
    Crown,
    BrushIcon,
    Clock10,
    MessageCircleWarning,
    Archive,
    Share2,
    WrenchIcon,
    CheckCheck,
    ExternalLink,
    ArrowUpRight,
    Plus,
    CrownIcon,
    Edit2,
    Clock12Icon,
    ClockPlus,
    RotateCcw,
    X,
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
import { archiveRender, filterRendersForBuilder, resolveStorageUrl, useResolvedImg } from "@/src/lib/renders";
import { archiveApp } from "@/src/lib/apps";
import { AnimatePresence, motion } from "framer-motion";
import { extractArchivedPageIdsFromRender, fetchRenderForDeployment, getArchivedRoutesForRender, persistArchivedPageIds, scrubArchivedRoutes, secureHtmlForPreviewIframe, withArchivedPageIds } from "@/components/helpers";
import { recordDeployAnalytics } from "@/components/analytics";
import Footer from "@/components/Footer";
import { useModal } from "@/components/ui/ModalContext";
import AppBuilderEditor from "@/components/AppBuilderEditor";

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
    source?: string | null;
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

// ============================================================================
// HELPER FUNCTION: Strict deployment check
// ============================================================================
function isRenderDeployed(r: { lastExportedAt?: any; lastDeployUrl?: string; vercelProjectId?: string | null; vercelProjectName?: string | null }): boolean {
    return !!(
        r.lastExportedAt &&
        r.lastDeployUrl &&
        (r.vercelProjectId || r.vercelProjectName)
    );
}

// ============================================================================
// RENDER CARD COMPONENT
// ============================================================================
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
    push, // Add this to props if not already there
}: RenderCardProps) {
    const router = useRouter();

    const isQueued = r.status === "queued" || r.status === "processing";

    const reason =
        typeof (r as any).reason === "string" ? (r as any).reason : null;

    // "failed" = timeout-style error, regardless of html
    const isFailed =
        (r.status === "error" || r.status === "failed") &&
        (reason === "timeout_or_worker_shutdown" || reason === "timeout");

    // ✅ STRICT deployment check - must have ALL these fields
    const isDeployed = isRenderDeployed(r as any);
    const isArchived = !!r.archived;

    const isCommunityBuild = r.source === "community_remix";

    // progress normalization: prefer explicit percent, then raw `progress`
    const rawPercent =
        typeof (r as any).progress === "number" ? (r as any).progress : null;

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

    const progressDetail = useMemo(() => {
        if (normalizedProgressPercent === null) return null;
        const p = Math.max(0, Math.min(100, normalizedProgressPercent));

        // If backend provides a label, prefer it (it tends to be more accurate than heuristics).
        const backendLabel =
            typeof (r as any).progressLabel === "string"
                ? String((r as any).progressLabel).trim()
                : "";
        if (backendLabel) return backendLabel;

        if (isDeploying) {
            if (p < 15) return "Packaging your site…";
            if (p < 35) return "Uploading files…";
            if (p < 65) return "Building on Vercel…";
            if (p < 85) return "Warming up deployment…";
            return "Finalizing…";
        }

        // Preview build
        if (p < 10) return "Reading your screenshot…";
        if (p < 25) return "Detecting layout…";
        if (p < 45) return "Generating editable HTML…";
        if (p < 65) return "Applying styles…";
        if (p < 80) return "Linking sections…";
        if (p < 95) return "Final polish…";
        return "Wrapping up…";
    }, [normalizedProgressPercent, isDeploying, r]);

    const hasProgressInfo = !isComplete && hasActiveProgress;
    const isBuilding = hasActiveProgress;

    // only the card that is actually building/deploying is locked
    const isThisCardLockedForBuild = hasActiveProgress;

    const disableOpen =
        isOpening || isDeploying || isArchived || isThisCardLockedForBuild;

    const { src: refImgUrl, onError: refImgErr } = useResolvedImg(r.key || "");

    const { showConfirm, showAlert } = useModal();

    const versionLabel = shortVersionFromShotPath(
        r.key ?? "",
        (urlHash as string | undefined) ?? null,
    );

    const controllerVersion =
        typeof r.controllerVersion === "string" ? r.controllerVersion : "";

    const model = typeof r.model === "string" ? r.model : "";

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

        safeHtml = safeHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
        safeHtml = safeHtml.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "");
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

        const base = r.html ? `<base target="_blank" rel="noopener noreferrer">` : "";
        return `${csp}${base}${safeHtml}`;
    }, [r.html]);

    const isDeployedFlag = isDeployed;
    const isArchivedFlag = isArchived;

    const showIframe = !!r.html?.trim();

    // ✅ Enhanced deployThis function with validation
    const deployThis = () => {
        if (!r.html?.trim()) {
            push?.("No HTML content to deploy", "warn");
            return;
        }

        // ✅ Block if already deployed
        if (isDeployedFlag) {
            push?.("This render is already deployed. View it in deployments.", "warn");
            return;
        }

        if (isArchivedFlag) {
            push?.("Unarchive this render first to deploy it", "warn");
            return;
        }

        startDeployWizard({ id: r.id, nameHint: r.nameHint ?? undefined });
    };

    const handleArchiveClick = async () => {
        if (isDeleting || isDeploying) return;

        if (isArchivedFlag) {
            unarchiveRender(r.id);
            return;
        }

        const ok = await showConfirm(
            "Move this preview into your archive? It will be hidden from your main dashboard.",
            "Archive Preview"
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
                throw new Error((data as any).error || "Failed to share community build");
            }

            if ((data as any).alreadyShared) {
                setAlreadyShared(true);
            } else {
                setAlreadyShared(false);
            }

            await onShareWithCommunity?.({ renderId: r.id, remixable: shareRemixable });
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
            if (!r?.id) return;

            setCheckingShared(true);

            try {
                const res = await fetch(
                    `/api/gallery/check-shared?renderId=${encodeURIComponent(r.id)}`,
                    {
                        method: "GET",
                        credentials: "include",
                    },
                );

                const data = await res.json().catch(() => ({} as any));
                if (cancelled) return;

                setAlreadyShared(!!(data as any)?.alreadyShared);
            } catch {
                // ignore
            } finally {
                if (!cancelled) setCheckingShared(false);
            }
        }

        void checkShared();

        return () => {
            cancelled = true;
        };
    }, [r?.id]);

    return (
        <div
            className={[
                "relative flex flex-col overflow-visible rounded-xl border bg-white shadow-sm hover:shadow-md transition-shadow",
                isArchivedFlag ? "border-amber-300/70 bg-amber-50/50" : "border-neutral-200",
                // ✅ community rebuild/remix: clearer but still clean
                isCommunityBuild && !isArchivedFlag
                    ? [
                        "border-[rgba(245,95,42,0.65)]",
                        "ring-2 ring-[rgba(245,95,42,0.20)]",
                        "shadow-[0_18px_44px_rgba(245,95,42,0.14)]",
                        "bg-[linear-gradient(180deg,rgba(245,95,42,0.06),rgba(255,255,255,0.0))]",
                        "after:pointer-events-none after:absolute after:-inset-[1px] after:rounded-[0.85rem] after:content-['']",
                        "after:ring-1 after:ring-[rgba(245,95,42,0.22)]",
                    ].join(" ")
                    : "",
            ].join(" ")}
        >
            {/* ✅ community badge */}
            {isCommunityBuild && (
                <span
                    className="absolute left-2 bottom-2 z-40 inline-flex items-center gap-1.5 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                    title="Created from a community build"
                >
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
                    remixed
                </span>
            )}


            {/* ✅ render id badge */}
            {!shareOpen && (
                <>
                    <span
                        className="absolute left-2 top-2 z-40 inline-flex items-center rounded-full border border-blue-200 bg-blue-50/90 px-2 py-0.5 text-[10px] font-semibold text-blue-700 shadow-sm"
                        title={`Render ID: ${String(r?.id || "").slice(0, 10)}`}
                    >
                        Website
                    </span>
                </>
            )}

            {/* model badge – bottom left */}
            {/* {model && isDev && (
                <span
                    className="absolute left-2 bottom-1 z-30 inline-flex items-center gap-1 rounded-full bg-neutral-900/85 px-2 py-0.5 text-[10px] text-neutral-50 shadow-sm"
                    title={`Model ${model}`}
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span>{model}</span>
                </span>
            )} */}

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
                    className="absolute right-2 top-2 z-50 inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-all duration-150 bg-white/85 border-neutral-200 text-neutral-400 hover:bg-red-600 hover:border-red-600 hover:text-white hover:shadow-md hover:scale-[1.04] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none"
                >
                    <X className="h-3.5 w-3.5 transition-colors" />
                </button>
            )}

            {/* main visual area – fixed aspect so no extra deadspace */}
            <div className="relative aspect-[3/3] w-full overflow-hidden">
                {!refImgUrl ? (
                    <div className="grid h-full w-full place-items-center text-sm text-neutral-500">
                        No snapshot available
                    </div>
                ) : (
                    <a className="block h-full w-full relative" title="Open the base screenshot">
                        <Image
                            src={refImgUrl}
                            alt={r.nameHint || "preview"}
                            fill
                            sizes="(min-width: 1024px) 420px, 100vw"
                            priority
                            onError={refImgErr}
                            className={`pointer-events-none select-none object-cover opacity-[0.25] ${isArchivedFlag ? "grayscale" : ""
                                }`}
                            draggable={false}
                        />
                    </a>
                )}


                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                    <div className="pointer-events-auto flex max-w-xs flex-col items-stretch rounded-xl border border-neutral-200 bg-white/80 p-3 text-xs shadow-lg backdrop-blur-sm md:max-w-sm">
                        {/* top row: deploy / customize */}
                        {!shareOpen && (
                            <div className="flex w-full flex-col font-semibold gap-2 sm:flex-row">
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
                                        : isDeployedFlag
                                            ? "bg-emerald-500 text-white shadow-sm hover:bg-green-700"
                                            : "bg-accent text-white shadow-sm hover:bg-accent/90 disabled:opacity-60"
                                        }`}
                                    title={
                                        isArchivedFlag
                                            ? "Unarchive this preview to deploy it"
                                            : isDeployedFlag
                                                ? "View and manage this deployment"
                                                : !r.html?.trim()
                                                    ? "This preview's HTML isn't available yet. Click Customize to finish generating it, then deploy."
                                                    : deployLocked
                                                        ? "Upgrade to publish live sites"
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
                                            <span>✓ Deployed</span>
                                            <ExternalLink className="h-4 w-4" />
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
                                                retryRender({ id: r.id, key: r.key || null });
                                            } else {
                                                continueRender(r.id);
                                            }
                                        }}
                                        disabled={(disableOpen || isDeleting || !r.html) && !isFailed}
                                        className="group inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-neutral-500 px-3 py-1.5 text-neutral-800 shadow-sm disabled:opacity-60"
                                        title={
                                            isArchivedFlag
                                                ? "Unarchive to customize this preview"
                                                : isBuilding || isQueued
                                                    ? "Still building preview"
                                                    : isFailed
                                                        ? "Retry the render operation"
                                                        : !r.html?.trim()
                                                            ? "Open the editor to finish preparing this preview"
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
                                            (isBuilding || isQueued) ?
                                                <Hammer className="ghost-hammer-swing h-4 w-4 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                                                :
                                                <BrushIcon className="h-4 w-4 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                                        )}
                                    </button>
                                )}
                            </div>
                        )}

                        {isFailed && !r.html && (
                            <p className="mt-1 text-[11px] text-amber-500">
                                This preview hit a timeout. Click &quot;Retry&quot; to try again.
                            </p>
                        )}

                        {/* progress bar / status – only for the active build/deploy and never at 100% */}
                        {hasProgressInfo && (
                            <div className="mt-2 w-full">
                                <div className="mb-1 flex items-center justify-between text-[10px] text-neutral-600">
                                    <span className="max-w-[72%] truncate" aria-live="polite">
                                        {progressDetail ?? normalizedProgressLabel}
                                    </span>
                                    {normalizedProgressPercent !== null && (
                                        <span className="font-semibold tabular-nums">
                                            {Math.round(normalizedProgressPercent)}%
                                        </span>
                                    )}
                                </div>

                                {normalizedProgressPercent !== null && (
                                    <div
                                        className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200/70"
                                        aria-label="Progress"
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={Math.max(0, Math.min(100, normalizedProgressPercent))}
                                        role="progressbar"
                                    >
                                        <div
                                            className="h-full bg-accent transition-[width] duration-500 ease-out"
                                            style={{
                                                width: `${Math.max(0, Math.min(100, normalizedProgressPercent))}%`,
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* bottom row: open site / share / archive */}
                        {/* <div className="flex w-full flex-wrap items-center justify-between gap-1"> */}
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
                                            onClick={() => setShareOpen((prev) => !prev)}
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
                                                        : "Community share"}
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
                                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${isArchivedFlag
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
                        {/* </div> */}

                        {onShareWithCommunity && (
                            <div>
                                {shareOpen && !alreadyShared && (
                                    <div className="px-3 text-[10px] text-neutral-700">
                                        <p className="mb-2">
                                            Publishing to Kloner community. Name your project and
                                            optionally allow other users to remix a copy of your layout.
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
                                                        /\.(com|ca|org|net|io|co|app|dev)\b/i.test(v) ||
                                                        /\bwww\./i.test(v) ||
                                                        /\bhttps?:\/\//i.test(v) ||
                                                        /\.\w{2,}$/i.test(v);

                                                    const allowed = /^[a-zA-Z0-9\- ]*$/.test(v);

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
                                                onChange={(e) => setShareRemixable(e.target.checked)}
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
    size = 30,
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
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-800"
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
                {/* {label} */}
            </div>
        </div>
    );
});

// ============================================================================
// APP CARD COMPONENT
// ============================================================================
function AppCard({
    app,
    isDeleting,
    isArchiving,
    onCustomize,
    onArchive,
    onDelete,
}: {
    app: { id: string; name: string; createdAt: any; updatedAt: any };
    isDeleting: boolean;
    isArchiving: boolean;
    onCustomize: (appId: string) => void;
    onArchive: (appId: string) => void;
    onDelete: (appId: string) => void;
}) {
    const router = useRouter();

    return (
        <div className="relative flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm hover:shadow-md transition-shadow">
            {/* Delete button - positioned inside the card for better visibility */}
            <button
                onClick={() => onDelete(app.id)}
                disabled={isDeleting}
                aria-label="Delete app"
                title="Delete this app"
                className="absolute right-2 top-2 z-50 inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-all duration-150 bg-white/85 border-neutral-200 text-neutral-400 hover:bg-red-600 hover:border-red-600 hover:text-white hover:shadow-md hover:scale-[1.04] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none"
            >
                <X className="h-3.5 w-3.5 transition-colors" />
            </button>

            {/* App badge - moved to avoid overlap */}
            <span
                className="absolute left-2 top-2 z-40 inline-flex items-center rounded-full border border-neutral-200 bg-[#f55f2a]/10 px-2 py-0.5 text-[10px] font-semibold text-[#f55f2a] shadow-sm"
                title="This is an app"
            >
                App
            </span>

            {/* App name badge - bottom right */}
            <span
                className="absolute right-2 bottom-2 z-40 inline-flex max-w-[180px] items-center truncate rounded-full border border-neutral-200 bg-white/85 px-2 py-0.5 text-[10px] font-medium text-neutral-800 shadow-sm"
                title={app.name || "App"}
            >
                {app.name || app.id.slice(0, 10)}
            </span>

            {/* Main visual area */}
            <div className="relative aspect-[3/3] w-full overflow-hidden flex flex-col items-center justify-center bg-gradient-to-br from-neutral-50 to-neutral-100">
                {/* Action buttons overlay */}
                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                    <div className="pointer-events-auto flex max-w-xs flex-col items-stretch rounded-xl border border-neutral-200 bg-white/80 p-3 text-xs shadow-lg backdrop-blur-sm">
                        <button
                            onClick={() => onCustomize(app.id)}
                            disabled={isDeleting}
                            className="group inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#f55f2a] text-white shadow-sm px-3 py-2 font-medium disabled:opacity-60"
                            title="Open app in editor"
                        >
                            <span>Customize Website</span>
                            <BrushIcon className="h-4 w-4 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                        </button>

                        <button
                            type="button"
                            onClick={() => onArchive(app.id)}
                            disabled={isDeleting || isArchiving}
                            className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-full border border-neutral-300 bg-white/60 px-3 py-2 text-xs font-medium text-neutral-700 shadow-sm hover:border-neutral-400 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Move this app into your archive"
                        >
                            <span>{isArchiving ? "Archiving…" : "Archive"}</span>
                            <Archive className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                {isDeleting && <CenterSpinner />}
            </div>
        </div>
    );
}

const GhostGeneratePreviewCard = memo(function GhostGeneratePreviewCard({
    locked,
    onClick,
    onAppClick,
    isAdmin: _isAdmin,
    onStartFromTemplate,
    onStartFromCommunityBuild,
    user: _user,
}: {
    locked: boolean;
    onClick: () => void;
    onAppClick?: () => void;
    isAdmin: boolean;
    onStartFromTemplate?: () => void;
    onStartFromCommunityBuild?: () => void;
    user: FirebaseUser | null;
    compact?: boolean;
}) {
    const router = useRouter();
    const [localDisabled, setLocalDisabled] = useState(false);
    const [showGenerationModal, setShowGenerationModal] = useState(false);

    // Consider the card disabled if either the parent says so or we've just been clicked.
    const effectiveLocked = locked || localDisabled;

    const handleClick = () => {
        if (effectiveLocked) return;

        // Show modal for all users to choose between website and web app
        setShowGenerationModal(true);
    };

    const handleWebsiteGeneration = () => {
        setShowGenerationModal(false);

        // Immediately prevent further clicks to avoid double-generation.
        setLocalDisabled(true);

        // Safety: clear the local guard after 10s in case something goes wrong.
        const t = setTimeout(() => setLocalDisabled(false), 10000);

        try {
            onClick();
        } finally {
            // If parent quickly reflects the pending state it will keep the button disabled;
            // otherwise we clear the optimistic guard after the timeout above.
            // We don't clear the timeout here to allow it to expire naturally.
        }
    };

    const handleAppGeneration = () => {
        setShowGenerationModal(false);

        if (onAppClick) {
            // Immediately prevent further clicks to avoid double-generation.
            setLocalDisabled(true);

            // Safety: clear the local guard after 10s in case something goes wrong.
            const t = setTimeout(() => setLocalDisabled(false), 10000);

            try {
                onAppClick();
            } finally {
                // If parent quickly reflects the pending state it will keep the button disabled;
                // otherwise we clear the optimistic guard after the timeout above.
                // We don't clear the timeout here to allow it to expire naturally.
            }
        }
    };

    const title = effectiveLocked ? "Generating website…" : "Generate website";
    const subtitle = effectiveLocked
        ? "Building an editable website."
        : "Create an editable website.";

    const iconWrapperSize = "h-14 w-14";

    return (
        <>
            <div className="relative w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                <button
                    type="button"
                    onClick={handleClick}
                    disabled={effectiveLocked}
                    className={`group flex aspect-square w-full flex-col items-center justify-center rounded-lg border-2 border-dashed bg-white px-5 py-6 text-center transition ${effectiveLocked ? "opacity-70 cursor-wait" : "hover:border-neutral-400 cursor-pointer"} border-neutral-300`}
                    aria-label="Generate a new website or app"
                >
                    <div
                        className={`grid ${iconWrapperSize} place-items-center rounded-full border border-neutral-200 bg-neutral-50 transition group-hover:scale-105`}
                        aria-hidden
                    >
                        {effectiveLocked ? (
                            <Hammer className="h-7 w-7 text-neutral-600 ghost-hammer-swing" />
                        ) : (
                            <Plus className="h-7 w-7 text-neutral-600" />
                        )}
                    </div>
                    <div className="mt-4 px-2 text-sm font-semibold text-neutral-800">{title}</div>
                    <div className="mt-1 px-2 text-sm text-neutral-500">{subtitle}</div>
                </button>
            </div>

            {/* Generation Type Selection Modal */}
            <AnimatePresence>
                {showGenerationModal && (
                    <motion.div
                        key="generation-modal"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
                        onMouseDown={(e) => {
                            if (e.target === e.currentTarget) setShowGenerationModal(false);
                        }}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white shadow-2xl"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
                                <div className="space-y-1">
                                    <div className="text-sm font-semibold text-neutral-900">
                                        Choose Generation Type
                                    </div>
                                    <div className="text-xs text-neutral-600">
                                        Select what you&apos;d like to create.
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setShowGenerationModal(false)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200"
                                    title="Close"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 20 20"
                                        fill="currentColor"
                                        className="h-4 w-4 text-neutral-700"
                                    >
                                        <path
                                            fillRule="evenodd"
                                            d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                                            clipRule="evenodd"
                                        />
                                    </svg>
                                </button>
                            </div>

                            <div className="space-y-3 px-5 py-4">
                                {/* 1) Website (Next.js) */}
                                <div className="space-y-3">
                                    <div className="relative">
                                        <span
                                            className="pointer-events-none absolute right-3 top-3 z-10 inline-flex items-center rounded-full border border-neutral-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-neutral-700 shadow-sm backdrop-blur"
                                            aria-hidden
                                        >
                                            New
                                        </span>
                                        <button
                                            type="button"
                                            onClick={handleAppGeneration}
                                            className="w-full rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:bg-neutral-50 hover:border-neutral-300"
                                        >
                                            <div className="flex items-start gap-3">
                                                <div
                                                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-900"
                                                    aria-hidden
                                                >
                                                    <Image
                                                        src="/images/nextjs.webp"
                                                        alt=""
                                                        width={24}
                                                        height={24}
                                                        className="object-contain opacity-95"
                                                        priority={false}
                                                    />
                                                </div>

                                                <div className="flex-1 space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-sm font-semibold text-neutral-900">
                                                            Website (Next.js)
                                                        </div>
                                                        <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-800">
                                                            15 preview credits
                                                        </span>
                                                    </div>

                                                    <div className="text-xs text-neutral-600">
                                                        Clone apps or start from a prompt with full web app support, including auth, databases, and integrations.
                                                    </div>
                                                    <div className="mt-1 text-[11px] leading-4 text-neutral-500">
                                                        Best for: user accounts, AI features, dashboards, CRUD apps, paid tools.
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    </div>
                                </div>

                                {/* 2) Website (HTML) */}
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={handleWebsiteGeneration}
                                        className="w-full rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:bg-neutral-50 hover:border-neutral-300"
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e34f26]/10" aria-hidden>
                                                <Image
                                                    src="/images/html.png"
                                                    alt=""
                                                    width={24}
                                                    height={24}
                                                    className="object-contain"
                                                    priority={false}
                                                />
                                            </div>
                                            <div className="flex-1 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-sm font-semibold text-neutral-900">
                                                        Website (HTML)
                                                    </div>
                                                    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-800">
                                                        15 preview credits
                                                    </span>
                                                </div>
                                                <div className="text-xs text-neutral-600">
                                                    Clone a URL into a fast, editable multi‑page HTML website.
                                                </div>
                                                <div className="mt-1 text-[11px] leading-4 text-neutral-500">
                                                    Best for: landing pages, marketing sites, performance-first pages. Not for auth / AI / databases.
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                </div>

                                {/* 3) Website template (HTML) */}
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowGenerationModal(false);
                                            router.push("/community-builds");
                                        }}
                                        className="w-full rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:bg-neutral-50 hover:border-neutral-300"
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10" aria-hidden>
                                                <Image
                                                    src="/images/html.png"
                                                    alt=""
                                                    width={24}
                                                    height={24}
                                                    className="object-contain opacity-95"
                                                    priority={false}
                                                />
                                            </div>
                                            <div className="flex-1 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-sm font-semibold text-neutral-900">
                                                        Website template (HTML)
                                                    </div>
                                                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                                                        Free
                                                    </span>
                                                </div>
                                                <div className="text-xs text-neutral-600">
                                                    Start from a polished HTML template, then customize.
                                                </div>
                                                <div className="mt-1 text-[11px] leading-4 text-neutral-500">
                                                    Best for: fastest start, proven layouts, quick edits. No auth / AI / databases.
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-4">
                                <button
                                    type="button"
                                    onClick={() => setShowGenerationModal(false)}
                                    className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                                >
                                    Cancel
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
});
// RenderCard (full) – only change is the X button styling/placement
// ---------------------------------------------------------------------


/* ───────── main page ───────── */

export default function PreviewPage(): JSX.Element {
    const router = useRouter();
    const search = useSearchParams();
    const { toasts, push } = useToasts();
    const { showConfirm, showAlert } = useModal();

    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [userTier, setUserTier] = useState<UserTier>("unknown");


    const [showCreditsPaywall, setShowCreditsPaywall] = useState<
        null | "screenshot" | "preview" | "deploy"
    >(null);
    const [showProPaywall, setShowProPaywall] = useState(false);
    const [showUpgradeAfterCustomize, setShowUpgradeAfterCustomize] =
        useState(false);

    const [archivingRender, setArchivingRender] = useState<Record<string, boolean>>({});
    const [archivingApp, setArchivingApp] = useState<Record<string, boolean>>({});

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

    async function handleDeleteApp(appId: string) {
        if (!user) return;

        const ok = await showConfirm(
            "Delete this app? This action cannot be undone.",
            "Delete App"
        );
        if (!ok) return;

        setDeletingApp((prev) => ({ ...prev, [appId]: true }));
        try {
            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch("/api/app-builder/delete", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ appId }),
            });
            if (!res.ok) throw new Error("Failed to delete app");

            // Remove from local state
            setApps((prev) => prev.filter((a) => a.id !== appId));
            push("App deleted successfully", "ok");
        } catch (error) {
            console.error("Failed to delete app:", error);
            push("Failed to delete app. Please try again.", "err");
        } finally {
            setDeletingApp((prev) => {
                const next = { ...prev };
                delete next[appId];
                return next;
            });
        }
    }

    async function handleArchiveApp(appId: string) {
        if (!user) return;

        const ok = await showConfirm(
            "Move this app into your archive? It will be hidden from your main dashboard.",
            "Archive App"
        );
        if (!ok) return;

        setArchivingApp((prev) => ({ ...prev, [appId]: true }));
        try {
            await archiveApp(appId);
            // hide from active list once archived
            setApps((prev) => prev.filter((a) => a.id !== appId));
            push("App archived", "ok");
        } catch (e) {
            console.error("Failed to archive app:", e);
            push("Failed to archive app. Please try again.", "err");
        } finally {
            setArchivingApp((prev) => {
                const next = { ...prev };
                delete next[appId];
                return next;
            });
        }
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
    const [editorMode, setEditorMode] = useState<"website" | "app">("website");
    const [editorHtml, setEditorHtml] = useState<string>("");
    const [editorRefImg, setEditorRefImg] = useState<string>("");
    const [isAdmin, setIsAdmin] = useState<boolean>(false);
    const [activeRenderId, setActiveRenderId] = useState<string | undefined>(undefined);

    const [appBuilderOpen, setAppBuilderOpen] = useState(false);
    const [currentAppId, setCurrentAppId] = useState<string | null>(null);

    // ───────── app deploy wizard (first deploy) ─────────
    const [appDeployWizardOpen, setAppDeployWizardOpen] = useState(false);
    const [appDeployWizardStep, setAppDeployWizardStep] = useState<1 | 2 | 3>(1);
    const [appDeployWizardBusy, setAppDeployWizardBusy] = useState(false);
    const [appDeployWizardError, setAppDeployWizardError] = useState<string | null>(null);
    const [appDeployWizardAppId, setAppDeployWizardAppId] = useState<string | null>(null);
    const [appDeployWizardAppName, setAppDeployWizardAppName] = useState<string>("");
    const [appDeployWizardLiveUrl, setAppDeployWizardLiveUrl] = useState<string | null>(null);
    const autoAppDeployTriggeredRef = useRef(false);

    const refreshUserTierNow = useCallback(async (): Promise<UserTier> => {
        // Deploy gating should never rely on a stale cached tier.
        // Stripe webhooks + custom claims can lag; force-refresh the backend view of tier.
        try {
            const res = await fetch("/api/billing/tier?refresh=1", {
                method: "GET",
                credentials: "include",
                cache: "no-store",
            });
            if (res.ok) {
                const data = await res.json().catch(() => ({} as any));
                const t = typeof data?.tier === "string" ? data.tier : "free";
                const normalized: UserTier =
                    t === "pro" || t === "agency" || t === "enterprise" ? (t as UserTier) : "free";
                setUserTier(normalized);
                return normalized;
            }
        } catch {
            // ignore; fall back below
        }

        // Fall back to existing state.
        // IMPORTANT: if the cached tier is `free` but refresh failed, treat as `unknown`
        // so we don't show a false-positive paywall to paid users.
        return userTier === "free" ? "unknown" : userTier;
    }, [userTier]);

    // ───────── web app wizard (new) ─────────
    const [appWizardOpen, setAppWizardOpen] = useState(false);
    const [appWizardBusy, setAppWizardBusy] = useState(false);
    const [appWizardError, setAppWizardError] = useState<string | null>(null);
    const [appWizardUrl, setAppWizardUrl] = useState<string>("");
    const [appWizardShotsUrl, setAppWizardShotsUrl] = useState<string>("");
    const [appWizardSource, setAppWizardSource] = useState<"website" | "prompt" | "sample">("website");
    const [appWizardPrompt, setAppWizardPrompt] = useState<string>("");
    const [appWizardSeedRenderId, setAppWizardSeedRenderId] = useState<string | null>(null);

    const {
        status: vercelStatus,
        checking: vercelChecking,
        refresh: refreshVercelStatus,
    } = useVercelIntegration();

    const isVercelConnected = vercelStatus === "connected";
    const isVercelChecking = vercelStatus === "loading" || vercelChecking;

    const [activeSeoMetaByPage, setActiveSeoMetaByPage] = useState<
        Record<string, SeoMeta> | null
    >(null);

    const [renders, setRenders] = useState<
        Array<{ id: string } & RenderDoc>
    >([]);
    const [apps, setApps] = useState<
        Array<{ id: string; name: string; userId: string; createdAt: any; updatedAt: any }>
    >([]);
    const [loadingRenders, setLoadingRenders] = useState(false);
    const [deletingApp, setDeletingApp] = useState<Record<string, boolean>>({});
    const [lockUntilByKey, setLockUntilByKey] = useState<
        Record<string, number>
    >({});
    const lockUntilByKeyRef = useRef(lockUntilByKey);
    useEffect(() => {
        lockUntilByKeyRef.current = lockUntilByKey;
    }, [lockUntilByKey]);
    const [lockUntilByRender, setLockUntilByRender] = useState<
        Record<string, number>
    >({});
    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerIdx, setViewerIdx] = useState(0);
    const didStripeRestoreRef = useRef(false);

    // Fetch apps from Firestore
    useEffect(() => {
        if (!user) {
            setApps([]);
            return;
        }

        const appsRef = collection(db, "kloner_users", user.uid, "kloner_apps");
        const appsQuery = query(appsRef, orderBy("createdAt", "desc"), limit(100));

        const unsub = onSnapshot(appsQuery, (snap) => {
            const appList = snap.docs.map((doc) => ({
                id: doc.id,
                ...(doc.data() as any),
            }));
            // Keep archived apps off the main dashboard without requiring a Firestore index
            // (and so legacy docs missing the `archived` field still show up).
            // IMPORTANT: only treat boolean true as archived.
            setApps(appList.filter((a: any) => a?.archived !== true));
        });

        let didCleanup = false;
        return () => {
            if (didCleanup) return;
            didCleanup = true;
            try {
                unsub();
            } catch (err) {
                console.warn("[firestore] apps onSnapshot unsubscribe failed", err);
            }
        };
    }, [user]);

    useEffect(() => {
        const billingParam = search.get("billing");
        const wizardParam = search.get("wizard");
        const stepParam = search.get("step");
        const renderId = search.get("render");
        const returnAppId = search.get("appId");

        if (billingParam !== "success" || wizardParam !== "1") return;
        if (!renderId && !returnAppId) return;
        if (!user) return;
        if (didStripeRestoreRef.current) return;
        didStripeRestoreRef.current = true;

        void (async () => {
            // pull latest nameHint/app name from Firestore
            let nameFromDb = "";
            try {
                if (renderId) {
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
                } else if (returnAppId) {
                    const appRef = doc(
                        db,
                        "kloner_users",
                        user.uid,
                        "kloner_apps",
                        returnAppId,
                    );
                    const snap = await getDoc(appRef);
                    if (snap.exists()) {
                        const data = snap.data() as any;
                        if (typeof data?.name === "string") {
                            nameFromDb = data.name.trim();
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to restore after Stripe", e);
            }

            // IMPORTANT: on production the Stripe webhook and/or custom-claims propagation can lag.
            // Force-refresh tier from backend so `trialing` immediately grants Pro/Agency access.
            try {
                const tierRes = await fetch("/api/billing/tier?refresh=1", {
                    method: "GET",
                    credentials: "include",
                });
                if (tierRes.ok) {
                    const data = await tierRes.json().catch(() => ({} as any));
                    const t = data?.tier as string | undefined;
                    if (t === "pro" || t === "agency" || t === "enterprise") {
                        setUserTier(t as any);
                    } else {
                        setUserTier("free");
                    }
                }
            } catch {
                // ignore; normal tier detection will run via auth effect
            }

            if (renderId) {
                // seed website deploy wizard state
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
            } else if (returnAppId) {
                // seed app deploy wizard state
                setAppDeployWizardAppId(returnAppId);
                setAppDeployWizardAppName(nameFromDb || "");
                setAppDeployWizardError(null);
                setAppDeployWizardBusy(false);
                setAppDeployWizardLiveUrl(null);
                setAppDeployWizardOpen(true);

                const nextStep: 1 | 2 | 3 = stepParam === "1" ? 1 : stepParam === "2" ? 2 : 3;
                setAppDeployWizardStep(nextStep);
                autoAppDeployTriggeredRef.current = true;
            }

            // clear billing params via router so useSearchParams updates
            try {
                const url = new URL(window.location.href);
                const params = url.searchParams;

                params.delete("billing");
                params.delete("wizard");
                params.delete("step");
                params.delete("render");
                params.delete("appId");

                const qs = params.toString();
                const next = qs ? `${url.pathname}?${qs}` : url.pathname;
                router.replace(next, { scroll: false });
            } catch (e) {
                console.error("Failed to clear Stripe query params", e);
            }
        })();
    }, [search, user, router, deployWizardProjectName]);

    // Open the web app wizard from query params.
    // Example: /dashboard/view?wizard=1&source=prompt&prompt=...
    useEffect(() => {
        if (!user) return;
        const wizardParam = search.get("wizard");
        const sourceParam = (search.get("source") || "").toLowerCase();
        const promptParam = search.get("prompt") || "";

        if (wizardParam !== "1") return;
        if (sourceParam !== "prompt") return;
        if (!promptParam.trim()) return;

        setAppWizardOpen(true);
        setAppWizardBusy(false);
        setAppWizardError(null);
        setAppWizardSource("prompt");
        setAppWizardPrompt(promptParam);

        // best-effort: clear wizard params so refresh doesn't re-open
        try {
            const url = new URL(window.location.href);
            const params = url.searchParams;
            params.delete("wizard");
            params.delete("source");
            params.delete("prompt");
            const qs = params.toString();
            const next = qs ? `${url.pathname}?${qs}` : url.pathname;
            router.replace(next, { scroll: false });
        } catch {
            // ignore
        }
    }, [search, user, router]);

    const closeAppDeployWizard = useCallback(() => {
        setAppDeployWizardOpen(false);
        setAppDeployWizardBusy(false);
        setAppDeployWizardError(null);
        setAppDeployWizardLiveUrl(null);
        setAppDeployWizardAppId(null);
        setAppDeployWizardAppName("");
        autoAppDeployTriggeredRef.current = false;
    }, []);

    const openAppDeployWizard = useCallback(
        (app: { id: string; name: string }) => {
            setAppDeployWizardAppId(app.id);
            setAppDeployWizardAppName(app.name || "");
            setAppDeployWizardError(null);
            setAppDeployWizardBusy(false);
            setAppDeployWizardLiveUrl(null);
            autoAppDeployTriggeredRef.current = false;

            // Always start with the Vercel connection check slide.
            // If already connected, the wizard will auto-advance to deployment.
            setAppDeployWizardOpen(true);
            setAppDeployWizardStep(1);
        },
        []
    );

    const deployAppLive = useCallback(async (opts?: { force?: boolean }) => {
        if (appDeployWizardBusy && !opts?.force) return;
        if (!user) return;
        if (!appDeployWizardAppId) return;

        if (!isVercelConnected) {
            setAppDeployWizardError("Connect Vercel to deploy.");
            setAppDeployWizardStep(1);
            return;
        }

        setAppDeployWizardBusy(true);
        setAppDeployWizardError(null);
        setAppDeployWizardLiveUrl(null);

        try {
            const csrfRes = await fetch("/api/auth/csrf", {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                cache: "no-store",
            });
            const csrfData = csrfRes.ok ? await csrfRes.json().catch(() => null) : null;
            const csrf = csrfData?.csrf ?? null;

            const res = await fetch(`/api/app-builder/${appDeployWizardAppId}/deploy`, {
                method: "POST",
                headers: {
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
            });

            const data = await res.json().catch(() => ({} as any));
            if (!res.ok || !data?.ok) {
                throw new Error(data?.error || `Deploy failed (HTTP ${res.status})`);
            }

            const url = String(data?.url || data?.previewUrl || "").trim();
            if (!url) throw new Error("Deploy completed but no URL was returned.");
            setAppDeployWizardLiveUrl(url);
        } catch (e: any) {
            setAppDeployWizardError(e?.message || "Deploy failed.");
        } finally {
            setAppDeployWizardBusy(false);
        }
    }, [appDeployWizardAppId, appDeployWizardBusy, isVercelConnected, user]);

    useEffect(() => {
        if (!appDeployWizardOpen) return;
        if (appDeployWizardStep !== 3) return;
        if (!autoAppDeployTriggeredRef.current) return;

        autoAppDeployTriggeredRef.current = false;
        void deployAppLive({ force: true });
    }, [appDeployWizardOpen, appDeployWizardStep, deployAppLive]);

    // Auto-advance: once Vercel is connected, move straight to deploy.
    useEffect(() => {
        if (!appDeployWizardOpen) return;
        if (appDeployWizardStep !== 1) return;
        if (isVercelChecking) return;
        if (!isVercelConnected) return;

        const t = window.setTimeout(() => {
            void (async () => {
                const tierNow = await refreshUserTierNow();
                if (tierNow === "free") {
                    setAppDeployWizardStep(2);
                    return;
                }

                setAppDeployWizardStep(3);
                autoAppDeployTriggeredRef.current = true;
            })();
        }, 900);

        return () => window.clearTimeout(t);
    }, [appDeployWizardOpen, appDeployWizardStep, isVercelChecking, isVercelConnected, refreshUserTierNow]);



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

    const handleCreateApp = useCallback(async (
        mode: "clone" | "url" | "prompt",
        prompt?: string,
        renderId?: string,
        url?: string,
        opts?: { screenshotKeys?: string[] },
    ) => {
        if (!user) return;

        try {
            function appNameFromUrl(raw: string): string {
                try {
                    const u = new URL(raw);
                    const host = u.hostname.replace(/^www\./, "");
                    return `Clone of ${host}`;
                } catch {
                    return "Clone from URL";
                }
            }

            let appName = "My New App";
            let finalRenderId = renderId;

            if (mode === "clone") {
                appName = "Starter Template";
                finalRenderId = renderId; // Can be undefined for template
            } else if (mode === "url") {
                appName = url ? appNameFromUrl(url) : "Clone from URL";
                finalRenderId = undefined; // No render for URL mode
            } else if (mode === "prompt") {
                appName = "App from Prompt";
                finalRenderId = undefined; // No render for prompt mode
            }

            let appId: string;

            if (mode === "url" && url) {
                // Use the new URL generation endpoint
                const csrf = await ensureSessionAndCsrf().catch(() => null);

                const screenshotKeysToSend = Array.isArray(opts?.screenshotKeys)
                    ? opts!.screenshotKeys!.filter((p) => typeof p === "string" && p.trim()).slice(0, 6)
                    : [];

                const res = await fetch("/api/generate-app-from-url", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    body: JSON.stringify({ url, name: appName, screenshotKeys: screenshotKeysToSend }),
                    credentials: "include",
                });

                if (res.status === 202) {
                    const data: any = await res.json().catch(() => ({} as any));
                    const generatedAppId = typeof data?.appId === "string" ? data.appId.trim() : "";
                    if (!generatedAppId) {
                        const reqId = typeof data?.reqId === "string" ? data.reqId : "";
                        throw new Error(reqId ? `Generation accepted but no appId returned (reqId: ${reqId})` : "Generation accepted but no appId returned");
                    }
                    appId = generatedAppId;
                } else {
                    const data = await res.json().catch(() => ({} as any));
                    throw new Error(data?.error || "Failed to generate app from URL");
                }
            } else if (mode === "prompt" && prompt) {
                // Use the new prompt generation endpoint
                const csrf = await ensureSessionAndCsrf().catch(() => null);
                const res = await fetch("/api/generate-app-from-prompt", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    body: JSON.stringify({ prompt, name: appName }),
                    credentials: "include",
                });

                if (res.status === 202) {
                    const data: any = await res.json().catch(() => ({} as any));
                    const generatedAppId = typeof data?.appId === "string" ? data.appId.trim() : "";
                    if (!generatedAppId) {
                        const reqId = typeof data?.reqId === "string" ? data.reqId : "";
                        throw new Error(reqId ? `Generation accepted but no appId returned (reqId: ${reqId})` : "Generation accepted but no appId returned");
                    }
                    appId = generatedAppId;
                } else {
                    const data = await res.json().catch(() => ({} as any));
                    throw new Error(data?.error || "Failed to generate app from prompt");
                }
            } else {
                // Use the existing create endpoint for clone mode
                const res = await fetch("/api/app-builder/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: appName,
                        renderId: finalRenderId,
                        prompt: undefined
                    }),
                });

                if (!res.ok) {
                    throw new Error("Failed to create app");
                }

                const { appId: createdAppId } = await res.json();
                appId = createdAppId;
            }

            // Close the editor modal
            setEditorOpen(false);
            setActiveRenderId(undefined);
            setActiveSeoMetaByPage(null);
            setActiveArchivedPageIds([]);

            // Open app builder as overlay
            setCurrentAppId(appId);
            setAppBuilderOpen(true);

            // No agent application for new modes, as they are full generations

            return appId as string;
        } catch (error) {
            console.error("Failed to create app:", error);
            push("Failed to create app. Please try again.", "err");
            return null;
        }
    }, [user, router, push, activeRenderId]);

    const startWebAppWizard = useCallback(
        (opts?: { seedRenderId?: string | null; url?: string | null }) => {
            // Always refresh Vercel status when opening the wizard so we don't
            // accidentally auto-advance from stale "connected" state.
            void refreshVercelStatus();
            const url = typeof opts?.url === "string" ? opts.url : "";
            setAppWizardUrl(url);
            setAppWizardShotsUrl(url);
            setAppWizardSeedRenderId(opts?.seedRenderId ?? null);
            // Default to Clone from URL when we already have a URL; otherwise keep prior behavior.
            setAppWizardSource(url ? "website" : (isAdmin ? "website" : "sample"));
            setAppWizardPrompt("");
            setAppWizardError(null);
            setAppWizardBusy(false);
            setAppWizardOpen(true);
        },
        [isAdmin, refreshVercelStatus],
    );

    const submitAppWizardWebsite = useCallback(async () => {
        if (appWizardBusy) return;
        setAppWizardBusy(true);
        setAppWizardError(null);

        try {
            const url = (appWizardUrl || "").trim();
            if (!url) {
                setAppWizardError("Enter a URL to continue.");
                return;
            }

            const canAttachShots = !!(appWizardShotsUrl && normUrl(appWizardShotsUrl) === normUrl(url));
            const screenshotKeys = user && canAttachShots
                ? shots
                    .map((s) => s.path)
                    .filter((p) => typeof p === "string" && p.startsWith(`kloner-screenshots/${user.uid}/`))
                    .slice(0, 6)
                : [];

            const created = await handleCreateApp("url", undefined, undefined, url, { screenshotKeys });
            if (created === null) {
                // Async processing started
                setAppWizardBusy(false);
                return;
            }
            if (created) {
                setAppWizardOpen(false);
            } else {
                setAppWizardError("Failed to create app. Please try again.");
            }
        } finally {
            setAppWizardBusy(false);
        }
    }, [appWizardBusy, appWizardUrl, appWizardShotsUrl, user, shots, handleCreateApp]);

    const submitAppWizardSample = useCallback(async () => {
        if (appWizardBusy) return;
        setAppWizardBusy(true);
        setAppWizardError(null);

        try {
            const created = await handleCreateApp("clone", undefined, undefined);
            if (created) {
                setAppWizardOpen(false);
            } else {
                setAppWizardError("Failed to create app. Please try again.");
            }
        } finally {
            setAppWizardBusy(false);
        }
    }, [appWizardBusy, handleCreateApp]);

    const submitAppWizardPrompt = useCallback(async () => {
        if (appWizardBusy) return;
        const prompt = (appWizardPrompt || "").trim();
        if (!prompt) {
            setAppWizardError("Enter a prompt to continue.");
            return;
        }

        setAppWizardBusy(true);
        setAppWizardError(null);

        try {
            const created = await handleCreateApp("prompt", prompt);
            if (created === null) {
                // Async processing started
                setAppWizardBusy(false);
                return;
            }
            if (created) {
                setAppWizardOpen(false);
            } else {
                setAppWizardError("Failed to create app. Please try again.");
            }
        } finally {
            setAppWizardBusy(false);
        }
    }, [appWizardBusy, appWizardPrompt, handleCreateApp]);

    // New: create an app from the starter template (free)
    const handleCreateTemplateApp = useCallback(async () => {
        if (!user) return;
        try {
            const res = await fetch("/api/app-builder/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Starter Template" }),
            });

            if (!res.ok) {
                throw new Error("Failed to create app");
            }

            const { appId } = await res.json();

            // Close any open editor modal
            setEditorOpen(false);
            setActiveRenderId(undefined);
            setActiveSeoMetaByPage(null);
            setActiveArchivedPageIds([]);

            // Open app builder overlay
            setCurrentAppId(appId);
            setAppBuilderOpen(true);
        } catch (error) {
            console.error("Failed to create template app:", error);
            push("Failed to start from template. Please try again.", "err");
        }
    }, [user, push]);


    const [optimisticByKey, setOptimisticByKey] = useState<
        Record<string, { id: string } & RenderDoc>
    >({});

    const optimisticByKeyRef = useRef<Record<string, { id: string } & RenderDoc>>({});
    useEffect(() => {
        optimisticByKeyRef.current = optimisticByKey;
    }, [optimisticByKey]);

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

    const urlParam = search.get("u") || "";

    const targetUrl = useMemo(() => {
        let raw = urlParam;

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
    }, [urlParam]);

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
            // Set isAdmin from claims
            try {
                const result = await getIdTokenResult(u, true);
                setIsAdmin(!!result.claims.admin);
            } catch {
                setIsAdmin(false);
            }
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
            source: data.source ?? null,
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
                    orderBy("createdAt", "desc"),
                    limit(100)
                );
                const snap = await getDocs(qs);

                const all = snap.docs.map(mapRenderDoc);
                const filtered = filterRendersForBuilder({
                    all,
                    targetUrl,
                    targetHash,
                    optimisticKeys: Object.keys(optimisticByKey),
                    extractHashFromKey,
                    strict: true,
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
                    // Only treat the optimistic render as "replaced" once we see a *new* server render
                    // in a non-terminal state. Older completed renders for the same key should not
                    // evict the optimistic placeholder (this was causing the ghost card to re-enable).
                    const exists = filtered.some(
                        (r) =>
                            r.key === k &&
                            (r.status === "queued" || r.status === "processing")
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
                    const now3 = Date.now();

                    for (const key of Object.keys(next)) {
                        // Respect hard lock window so we don't flicker enabled/disabled.
                        if (
                            key &&
                            lockUntilByKey[key] &&
                            lockUntilByKey[key] > now3
                        ) {
                            continue;
                        }

                        const inFlight = withOptimistic.some(
                            (r) =>
                                r.key === key &&
                                (r.status === "queued" || r.status === "processing")
                        );
                        if (inFlight) continue;

                        const isTerminal = withOptimistic.some(
                            (r) =>
                                r.key === key &&
                                (r.status === "ready" ||
                                    r.status === "failed" ||
                                    r.status === "error")
                        );
                        if (!isTerminal) continue;

                        delete next[key];
                        setOptimisticByKey((m) => {
                            if (!m[key]) return m;
                            const n = { ...m };
                            delete n[key];
                            return n;
                        });
                    }
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
            orderBy("createdAt", "desc"),
            limit(100)
        )

        const unsub = onSnapshot(qs, (snap) => {
            const optimisticNow = optimisticByKeyRef.current;
            const lockUntilNow = lockUntilByKeyRef.current || {};

            // Important: don't filter `archived` at the query level.
            // Many older render docs may have no `archived` field at all,
            // and Firestore queries won't match missing fields.
            const all = snap.docs.map(mapRenderDoc);
            const filtered = filterRendersForBuilder({
                all,
                targetUrl,
                targetHash,
                optimisticKeys: Object.keys(optimisticNow),
                extractHashFromKey,
                strict: true,
            });

            const now = Date.now();
            for (const r of filtered) {
                const key = r.key || "";
                if (
                    key &&
                    lockUntilNow[key] &&
                    lockUntilNow[key] > now
                ) {
                    setLockUntilByRender((m) => ({
                        ...m,
                        [r.id]: Math.max(
                            m[r.id] || 0,
                            lockUntilNow[key]
                        ),
                    }));
                }
            }

            const withOptimistic = [...filtered];

            for (const k in optimisticNow) {
                const opt = optimisticNow[k];
                // Only treat the optimistic render as "replaced" once we see a *new* server render
                // in a non-terminal state. Older completed renders for the same key should not
                // evict the optimistic placeholder (this was causing the ghost card to re-enable).
                const exists = filtered.some(
                    (r) =>
                        r.key === k &&
                        (r.status === "queued" || r.status === "processing")
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
                const now3 = Date.now();

                for (const key of Object.keys(next)) {
                    // Respect hard lock window so we don't flicker enabled/disabled.
                    if (
                        key &&
                        lockUntilNow[key] &&
                        lockUntilNow[key] > now3
                    ) {
                        continue;
                    }

                    const inFlight = withOptimistic.some(
                        (r) =>
                            r.key === key &&
                            (r.status === "queued" || r.status === "processing")
                    );
                    if (inFlight) continue;

                    const isTerminal = withOptimistic.some(
                        (r) =>
                            r.key === key &&
                            (r.status === "ready" ||
                                r.status === "failed" ||
                                r.status === "error")
                    );
                    if (!isTerminal) continue;

                    delete next[key];
                    setOptimisticByKey((m) => {
                        if (!m[key]) return m;
                        const n = { ...m };
                        delete n[key];
                        return n;
                    });
                }
                return next;
            });
        });

        let didCleanup = false;
        return () => {
            if (didCleanup) return;
            didCleanup = true;
            try {
                unsub();
            } catch (err) {
                console.warn("[firestore] renders onSnapshot unsubscribe failed", err);
            }
        };
    }, [
        user,
        targetUrl,
        targetHash,
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

            // ── proceed with generation ──

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

    const buildFromUrl = useCallback(async () => {
        if (!user) return;
        if (!targetUrl || !isHttpUrl(targetUrl)) {
            push("Enter a valid URL first.", "err");
            return;
        }

        if (!canUsePreviewCredit()) {
            push(
                "You have used all available preview credits for today on this plan.",
                "warn",
            );
            setShowCreditsPaywall("preview");
            return;
        }

        try {
            const body: any = {
                url: targetUrl,
                urlHash: hash64(targetUrl),
                nameHint: (() => {
                    try {
                        return new URL(targetUrl).hostname;
                    } catch {
                        return undefined;
                    }
                })(),
            };

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
                push("Started generating your website…", "ok");
                await refreshRenders();
                return;
            }

            if (!r.ok || !j?.ok) {
                throw new Error(j?.error || "Render failed");
            }

            await refreshRenders();
        } catch (e: any) {
            console.error("buildFromUrl failed", e);
            push(e?.message || "Failed to start website generation.", "err");
        }
    }, [user, targetUrl, canUsePreviewCredit, push, refreshRenders, setShowCreditsPaywall]);

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
                    } catch (err) {
                        console.warn("Failed to persist sanitized HTML", err);
                    }
                }

                setEditorHtml(cleaned);
                setEditorRefImg(refSrc);
                setActiveRenderId(renderId);
                setActiveSeoMetaByPage(seoMetaByPage);
                setEditorMode("website");
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

            const ok = await showConfirm("Discard this editable preview?", "Discard Preview");
            if (!ok) return;

            setDeletingRender((m) => ({ ...m, [renderId]: true }));

            try {
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

                // delete Firestore render + ai_edits (server-side recursive)
                const csrf = await ensureSessionAndCsrf();
                const resp = await fetch("/api/user-render/delete", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    body: JSON.stringify({ renderId }),
                });

                if (!resp.ok) {
                    const j = await resp.json().catch(() => ({}));
                    throw new Error(j?.error || "Failed to discard preview.");
                }

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
            const ok = await showConfirm(
                "Delete this screenshot and all its previews?",
                "Delete Screenshot"
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

    async function refreshSingleRender(renderId: string) {
        if (!user) return;

        try {
            const renderRef = doc(db, "kloner_users", user.uid, "kloner_renders", renderId);
            const snap = await getDoc(renderRef);

            if (snap.exists()) {
                const data = snap.data() as RenderDoc;

                setRenders((prev) =>
                    prev.map((r) =>
                        r.id !== renderId
                            ? r
                            : {
                                ...r,
                                ...data,
                                lastExportedAt: data.lastExportedAt?.toDate?.() ?? data.lastExportedAt,
                            }
                    )
                );
            }
        } catch (err) {
            console.error("Failed to refresh single render:", err);
            // Fallback to full refresh
            await refreshRenders();
        }
    }

    function isRenderDeployed(r: RenderDoc): boolean {
        return !!(
            r.lastExportedAt &&
            r.lastDeployUrl &&
            (r.vercelProjectId || r.vercelProjectName)
        );
    }


    async function exportToVercel(opts: { html: string; name?: string; renderId?: string }) {
        const funnelStartMs = Date.now();
        setEditorOpen(false);

        const { html, name, renderId } = opts;
        const resolvedRenderId = renderId || activeRenderId || null;

        const trimmedNameInput = name?.trim() || "";
        const hasName = trimmedNameInput.length > 0;

        await recordDeployAnalytics(user, {
            lastExportFlowStartedAt: serverTimestamp(),
            lastExportFlowRenderId: resolvedRenderId ?? null,
            lastExportFlowUserTier: userTier ?? null,
            lastExportFlowSource: "editor_export_button",
        });

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
            } else {
                setDeployWizardRenderId(null);
                setDeployWizardProjectName("");
            }

            setDeployWizardOpen(true);
            return;
        }

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
                    setDeployWizardProjectName(target?.nameHint || trimmedNameInput);
                } else {
                    setDeployWizardRenderId(null);
                    setDeployWizardProjectName(trimmedNameInput);
                }

                setDeployWizardOpen(true);
                push("Export and deploy are reserved for paid plans.", "warn");
            }
            return;
        }

        let projectName = trimmedNameInput;

        if (user && resolvedRenderId) {
            const renderRef = doc(db, "kloner_users", user.uid, "kloner_renders", resolvedRenderId);

            try {
                await updateDoc(renderRef, { nameHint: projectName });
                const snap = await getDoc(renderRef);
                if (snap.exists()) {
                    const data = snap.data() as any;
                    if (typeof data?.nameHint === "string") {
                        const dbName = data.nameHint.trim();
                        if (dbName) projectName = dbName;
                    }
                }
            } catch (err) {
                console.error("Failed to sync project name with Firestore", err);
            }
        }

        if (resolvedRenderId) setDeployWizardRenderId(resolvedRenderId);
        else setDeployWizardRenderId(null);

        setDeployWizardProjectName(projectName);
        setDeployWizardError(null);
        setDeployWizardStep(3);
        setDeployWizardOpen(true);
        setDeployWizardBusy(true);
        setDeployWizardLiveUrl(null);

        autoDeployTriggeredRef.current = true;

        if (resolvedRenderId) setDeployingRenderId(resolvedRenderId);

        push("Starting deployment…", "ok");

        const csrf = await ensureSessionAndCsrf();

        const archivedRoutes = getArchivedRoutesForRender(resolvedRenderId, renders);
        const scrubbedHtml = scrubArchivedRoutes(html, archivedRoutes);

        const finalHtml = await buildFinalExport({
            html: scrubbedHtml,
            user,
            draftId: resolvedRenderId,
            fallbackSeoMetaByPage: activeSeoMetaByPage as SeoMetaByPage | null,
        });

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

            const { url, vercelProjectId: apiProjectId, vercelProjectName: apiProjectName } = j;
            const now = new Date();

            // ✅ IMMEDIATE local state update with all deployment fields
            if (resolvedRenderId) {
                setRenders((prev) =>
                    prev.map((rr) =>
                        rr.id !== resolvedRenderId
                            ? rr
                            : {
                                ...rr,
                                lastDeployUrl: url,
                                lastExportedAt: now,
                                vercelProjectId: apiProjectId ?? rr.vercelProjectId ?? null,
                                vercelProjectName: apiProjectName ?? projectName ?? rr.vercelProjectName ?? null,
                                // ✅ Add explicit deployment flag
                                isDeployed: true,
                            },
                    ),
                );
            }

            setDeployWizardLiveUrl(url);
            autoDeployTriggeredRef.current = true;

            // ✅ Update Firestore with all deployment fields
            if (user && resolvedRenderId) {
                await updateDoc(doc(db, "kloner_users", user.uid, "kloner_renders", resolvedRenderId), {
                    lastExportedAt: serverTimestamp(),
                    lastDeployUrl: url,
                    vercelProjectId: apiProjectId ?? null,
                    vercelProjectName: apiProjectName ?? projectName ?? null,
                    isDeployed: true,
                });
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

            try {
                localStorage.setItem("kloner.deployments.hasUnseen", "1");
            } catch {
                // ignore
            }

            setShowDeployNextSteps(true);
            push("Deployed successfully!", "ok");

            // ✅ CRITICAL: Force refresh of this specific render to reflect deployment state
            if (resolvedRenderId) {
                await refreshSingleRender(resolvedRenderId);
            } else {
                await refreshRenders();
            }

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

    function handleConnectVercelForAppDeployWizard() {
        const u = auth.currentUser;
        if (!VERCEL_INTEGRATION_SLUG || !u) {
            console.error("Missing integration slug or user not signed in");
            setAppDeployWizardError("Sign in to connect Vercel.");
            return;
        }

        setAppDeployWizardError(null);

        try {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            const state = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");

            // Persist which app this deploy was for so we can resume after OAuth redirect.
            try {
                const payload = {
                    appId: appDeployWizardAppId,
                    appName: appDeployWizardAppName,
                    startedAt: Date.now(),
                };
                localStorage.setItem(
                    "kloner_vercel_pending_app_deploy",
                    JSON.stringify(payload),
                );
            } catch {
                // ignore
            }

            localStorage.setItem("kloner_vercel_latest_csrf", state);
            document.cookie = [
                `vercel_oauth_state=${state}`,
                "Path=/",
                "Max-Age=600",
                "SameSite=Lax",
            ].join("; ");

            const appIdParam = appDeployWizardAppId
                ? `&appId=${encodeURIComponent(appDeployWizardAppId)}`
                : "";
            const returnTo = `/dashboard/view?appVercel=connected&flow=appDeploy${appIdParam}`;
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
            setAppDeployWizardError("Could not open Vercel. Try again in a moment.");
        }
    }

    // ───────── on OAuth callback (?vercel=connected) restore *legacy* wizard state ─────────

    useEffect(() => {
        const v = searchParams.get("vercel");
        if (v !== "connected") return;

        // ensure latest status from backend
        void (async () => {
            await refreshVercelStatus();

            // If we were connecting Vercel from App Builder preview, restore that overlay.
            let pendingApp: { appId?: string } | null = null;
            try {
                const raw = localStorage.getItem("kloner_vercel_pending_app_preview");
                if (raw) pendingApp = JSON.parse(raw);
            } catch {
                pendingApp = null;
            }

            if (pendingApp?.appId) {
                setCurrentAppId(pendingApp.appId);
                setAppBuilderOpen(true);
                return;
            }

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
    }, [searchParams, refreshVercelStatus, router]);

    // ───────── on OAuth callback (?appVercel=connected) restore *app* wizard only ─────────

    useEffect(() => {
        const v = searchParams.get("appVercel");
        if (v !== "connected") return;

        void (async () => {
            await refreshVercelStatus();

            const flow = searchParams.get("flow") || "";

            // If we connected Vercel from the app deploy wizard, resume that flow (auto-deploy).
            let pendingAppDeploy: { appId?: string | null; appName?: string | null; startedAt?: number | null } | null = null;
            try {
                const raw = localStorage.getItem("kloner_vercel_pending_app_deploy");
                if (raw) pendingAppDeploy = JSON.parse(raw);
            } catch {
                pendingAppDeploy = null;
            }

            const appIdFromQuery = searchParams.get("appId");

            // Ignore very old pending markers (e.g. user aborted OAuth days ago).
            try {
                const startedAt = Number((pendingAppDeploy as any)?.startedAt || 0);
                const MAX_AGE_MS = 15 * 60 * 1000;
                if (startedAt && Number.isFinite(startedAt) && Date.now() - startedAt > MAX_AGE_MS) {
                    pendingAppDeploy = null;
                    localStorage.removeItem("kloner_vercel_pending_app_deploy");
                }
            } catch {
                // ignore
            }

            const isAppDeployFlow = flow === "appDeploy" || !!pendingAppDeploy?.appId;

            if (isAppDeployFlow) {
                const nextAppId =
                    (typeof pendingAppDeploy?.appId === "string" && pendingAppDeploy.appId) ||
                    (flow === "appDeploy" && typeof appIdFromQuery === "string" ? appIdFromQuery : null) ||
                    null;
                const nextAppName =
                    (typeof pendingAppDeploy?.appName === "string" && pendingAppDeploy.appName) ||
                    "";

                setAppWizardOpen(false);
                setAppWizardError(null);
                setAppWizardBusy(false);

                setAppDeployWizardAppId(nextAppId);
                setAppDeployWizardAppName(nextAppName);
                setAppDeployWizardError(null);
                setAppDeployWizardBusy(false);
                setAppDeployWizardLiveUrl(null);
                setAppDeployWizardOpen(true);

                try {
                    localStorage.removeItem("kloner_vercel_pending_app_deploy");
                } catch {
                    // ignore
                }

                const tierNow = await refreshUserTierNow();
                if (tierNow === "free") {
                    setAppDeployWizardStep(2);
                } else {
                    setAppDeployWizardStep(3);
                    autoAppDeployTriggeredRef.current = true;
                }

                // Clean up callback params so refresh/back doesn't reopen flows.
                try {
                    const url = new URL(window.location.href);
                    const params = url.searchParams;
                    params.delete("appVercel");
                    params.delete("flow");
                    params.delete("appId");
                    const qs = params.toString();
                    const next = qs ? `${url.pathname}?${qs}` : url.pathname;
                    router.replace(next, { scroll: false });
                } catch {
                    // ignore
                }

                return;
            }

            // We no longer connect Vercel as part of the create-app flow.
            // If a non-deploy callback lands here (e.g. stale cookies), just clean up params.

            // Clean up callback params so refresh/back doesn't reopen flows.
            try {
                const url = new URL(window.location.href);
                const params = url.searchParams;
                params.delete("appVercel");
                params.delete("flow");
                params.delete("appId");
                const qs = params.toString();
                const next = qs ? `${url.pathname}?${qs}` : url.pathname;
                router.replace(next, { scroll: false });
            } catch {
                // ignore
            }
        })();
    }, [searchParams, refreshVercelStatus, refreshUserTierNow, router]);

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
        if (!urlParam) return;
        try {
            localStorage.setItem("kloner:lastUrl", urlParam);
        } catch {
            // ignore
        }
    }, [urlParam]);


    // somewhere above the JSX return in this component:
    const hasGhostPending = groupedShots.some((group, groupIndex) => {
        if (groupIndex > 0) return false;
        return group.items.some((s) => pendingByKey[s.path]);
    });


    // exit offer
    const STEP5_SALE_MS = 15 * 60 * 1000;

    const STEP5_SALE_PREFIX = "kloner_step5_sale_endsAt:";

    function isQuotaExceededError(err: unknown) {
        const anyErr = err as any;
        const name = typeof anyErr?.name === "string" ? anyErr.name : "";
        const code = anyErr?.code;
        return (
            name === "QuotaExceededError" ||
            name === "NS_ERROR_DOM_QUOTA_REACHED" ||
            code === 22 ||
            code === 1014
        );
    }

    function safeLocalStorageGet(key: string) {
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    function cleanupStep5SaleKeys(keepKey?: string) {
        try {
            const now = Date.now();
            for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
                const k = window.localStorage.key(i);
                if (!k) continue;
                if (!k.startsWith(STEP5_SALE_PREFIX)) continue;
                if (keepKey && k === keepKey) continue;

                const raw = safeLocalStorageGet(k);
                const parsed = raw ? Number(raw) : 0;
                // Prefer removing obviously bad/expired entries first.
                if (!parsed || !Number.isFinite(parsed) || parsed < now) {
                    window.localStorage.removeItem(k);
                }
            }

            // If we're still tight on quota, drop all remaining sale keys (they're not critical state).
            for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
                const k = window.localStorage.key(i);
                if (!k) continue;
                if (!k.startsWith(STEP5_SALE_PREFIX)) continue;
                if (keepKey && k === keepKey) continue;
                window.localStorage.removeItem(k);
            }
        } catch {
            // Ignore; cleanup is best-effort.
        }
    }

    function safeLocalStorageSet(key: string, value: string) {
        try {
            window.localStorage.setItem(key, value);
            return true;
        } catch (err) {
            if (isQuotaExceededError(err)) {
                cleanupStep5SaleKeys(key);
                try {
                    window.localStorage.setItem(key, value);
                    return true;
                } catch {
                    return false;
                }
            }
            return false;
        }
    }

    function formatMMSS(totalSeconds: number) {
        const s = Math.max(0, totalSeconds | 0);
        const mm = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        return { mm, ss };
    }

    function getRemainingSec(endsAt: number) {
        return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    }

    const STEP5_SALE_KEY = (uid?: string, renderId?: string | null) =>
        `kloner_step5_sale_endsAt:${uid || "anon"}:${renderId || "unknown"}`;

    // ---- inside component (near other derived state) ----
    const step5SaleStorageKey = useMemo(() => {
        const uid = user?.uid;
        const rid = deployWizardRenderId || activeRenderId || null;
        return STEP5_SALE_KEY(uid, rid);
    }, [user?.uid, deployWizardRenderId, activeRenderId]);

    const [step5SaleEndsAt, setStep5SaleEndsAt] = useState<number>(() => {
        if (typeof window === "undefined") return Date.now() + STEP5_SALE_MS;

        const raw = safeLocalStorageGet(step5SaleStorageKey);
        const parsed = raw ? Number(raw) : 0;

        if (parsed && Number.isFinite(parsed) && parsed > Date.now()) return parsed;

        const next = Date.now() + STEP5_SALE_MS;
        safeLocalStorageSet(step5SaleStorageKey, String(next));
        return next;
    });

    const [step5SaleRemainingSec, setStep5SaleRemainingSec] = useState<number>(() =>
        getRemainingSec(step5SaleEndsAt),
    );

    const [showExitOffer, setShowExitOffer] = useState(false);
    const [exitOfferReason, setExitOfferReason] = useState<
        "close" | "back" | "nav" | "outside" | "esc" | null
    >(null);

    // ✅ rehydrate when key changes (user/render changes)
    useEffect(() => {
        if (typeof window === "undefined") return;

        const raw = safeLocalStorageGet(step5SaleStorageKey);
        const parsed = raw ? Number(raw) : 0;

        if (parsed && Number.isFinite(parsed) && parsed > Date.now()) {
            setStep5SaleEndsAt(parsed);
            setStep5SaleRemainingSec(getRemainingSec(parsed));
            return;
        }

        const next = Date.now() + STEP5_SALE_MS;
        safeLocalStorageSet(step5SaleStorageKey, String(next));
        setStep5SaleEndsAt(next);
        setStep5SaleRemainingSec(getRemainingSec(next));
    }, [step5SaleStorageKey]);

    // ✅ keep storage synced (ONLY ONCE)
    useEffect(() => {
        if (typeof window === "undefined") return;
        safeLocalStorageSet(step5SaleStorageKey, String(step5SaleEndsAt));
    }, [step5SaleEndsAt, step5SaleStorageKey]);

    useEffect(() => {
        if (deployWizardStep !== 5) return;

        let raf = 0;
        let t: any = null;

        const tick = () => {
            const rem = getRemainingSec(step5SaleEndsAt);
            setStep5SaleRemainingSec(rem);
            if (rem <= 0) return;
            t = setTimeout(() => {
                raf = requestAnimationFrame(tick);
            }, 250);
        };

        tick();

        return () => {
            if (t) clearTimeout(t);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [deployWizardStep, step5SaleEndsAt]);

    const step5Time = formatMMSS(step5SaleRemainingSec);
    const step5SaleActive = step5SaleRemainingSec > 0;

    function openExitOffer(reason: NonNullable<typeof exitOfferReason>) {
        setExitOfferReason(reason);
        setShowExitOffer(true);
    }

    const EXIT_OFFER_PROMO_CODE = "DEPLOY40"; // ✅ Stripe Promotion Code "code" field

    // client: patched startProCheckout to apply exit offer code
    const startProCheckout = useCallback(
        async (opts?: { exitOffer?: boolean; exitOfferReason?: "close" | "back" | "nav" | "outside" | "esc" }) => {
            if (checkoutBusy) return;
            setCheckoutBusy(true);

            try {
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

                let offerPayload: any = {};
                if (opts?.exitOffer) {
                    const endsAt = step5SaleEndsAt;
                    if (typeof endsAt === "number" && Date.now() <= endsAt) {
                        offerPayload = {
                            offer: "exit40",
                            offerEndsAt: endsAt,
                            offerReason: opts.exitOfferReason || "close",
                            offerPromoCode: EXIT_OFFER_PROMO_CODE, // ✅ send to server
                        };
                    }
                }

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
                        returnStep: 2,
                        ...offerPayload,
                    }),
                });

                if (res.status === 401) {
                    const next = encodeURIComponent("/dashboard/view?upgraded=1");
                    window.location.href = `/login?next=${next}`;
                    return;
                }

                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.url) {
                    await showAlert(data?.error || "Unable to start checkout.", "Checkout Error");
                    return;
                }

                window.location.href = data.url;
            } finally {
                setCheckoutBusy(false);
            }
        },
        [checkoutBusy, deployWizardRenderId, deployWizardProjectName, step5SaleEndsAt],
    );

    const startProCheckoutForAppDeploy = useCallback(
        async (opts?: { exitOffer?: boolean; exitOfferReason?: "close" | "back" | "nav" | "outside" | "esc" }) => {
            if (checkoutBusy) return;
            setCheckoutBusy(true);

            try {
                if (!appDeployWizardAppId) {
                    await showAlert(
                        "We couldn’t determine which app you’re deploying. Close this modal and click Deploy again, then retry.",
                        "Checkout",
                    );
                }

                const csrfRes = await fetch("/api/auth/csrf", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    credentials: "include",
                    cache: "no-store",
                });

                const csrfData = csrfRes.ok ? await csrfRes.json().catch(() => null) : null;
                const csrf = csrfData?.csrf ?? null;

                let offerPayload: any = {};
                if (opts?.exitOffer) {
                    const endsAt = step5SaleEndsAt;
                    if (typeof endsAt === "number" && Date.now() <= endsAt) {
                        offerPayload = {
                            offer: "exit40",
                            offerEndsAt: endsAt,
                            offerReason: opts.exitOfferReason || "close",
                            offerPromoCode: EXIT_OFFER_PROMO_CODE,
                        };
                    }
                }

                const res = await fetch("/api/billing/create-checkout-session", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        plan: "pro",
                        ...(appDeployWizardAppId ? { returnAppId: appDeployWizardAppId } : {}),
                        returnStep: 3,
                        ...offerPayload,
                    }),
                });

                if (res.status === 401) {
                    const next = encodeURIComponent("/dashboard/view?upgraded=1");
                    window.location.href = `/login?next=${next}`;
                    return;
                }

                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.url) {
                    await showAlert(data?.error || "Unable to start checkout.", "Checkout Error");
                    return;
                }

                window.location.href = data.url;
            } finally {
                setCheckoutBusy(false);
            }
        },
        [checkoutBusy, appDeployWizardAppId, step5SaleEndsAt],
    );


    return (
        <main className="min-h-screen bg-white">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-8">
                <section className="mb-10">
                    <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                        <span>Kloner · Builder</span>
                    </div>

                    <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-8 sm:px-8 sm:py-10 shadow-sm">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                                <div className="flex items-end gap-2">
                                    <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                                        Builder
                                    </h1>
                                    {userTier !== "unknown" && (
                                        <div className="inline-flex items-center">
                                            <div className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent-50 px-2 py-1">
                                                <Crown className="h-2.5 w-2.5 text-accent" />
                                                <span className="text-[9px] font-semibold uppercase tracking-wide text-accent">
                                                    {planLabel}
                                                </span>

                                            </div>
                                            <span className="inline-flex">
                                                <button
                                                    type="button"
                                                    onClick={() => router.push("/price")}
                                                    title={userTier === "free" ? "Upgrade plan" : "Manage plan"}
                                                    aria-label={userTier === "free" ? "Upgrade plan" : "Manage plan"}
                                                    className="group inline-flex items-center justify-center rounded-md p-1 transition-all duration-150
               hover:bg-white/10 hover:scale-[1.06] active:scale-[0.98]
               focus:outline-none focus:ring-2 focus:ring-[#C6F44D]/60 focus:ring-offset-2 focus:ring-offset-transparent"
                                                >
                                                    <Edit2 className="h-3 w-3 opacity-80 transition-opacity group-hover:opacity-100" />
                                                    <span
                                                        className="pointer-events-none absolute z-50 -translate-y-8 scale-95 rounded-md bg-black/80 px-2 py-1
                 text-[11px] text-white opacity-0 shadow-lg ring-1 ring-white/10 transition
                 group-hover:opacity-100 group-hover:scale-100"
                                                        style={{ marginLeft: 0 }}
                                                    >
                                                        {userTier === "free" ? "Upgrade" : "Manage"}
                                                    </span>
                                                </button>
                                            </span>

                                        </div>
                                    )}
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2 text-xs gap-2">
                                    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-700">
                                        Screenshot credits:&nbsp;
                                        <span className="font-semibold text-neutral-900">
                                            {screenshotRemaining === null || !screenshotLimitDisplay
                                                ? "-"
                                                : `${screenshotRemaining}/${screenshotLimitDisplay}`}
                                        </span>
                                    </span>

                                    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-700">
                                        Preview credits:&nbsp;
                                        <span className="font-semibold text-neutral-900">
                                            {previewRemaining === null || !previewLimitDisplay
                                                ? "-"
                                                : `${previewRemaining}/${previewLimitDisplay}`}
                                        </span>
                                    </span>
                                </div>

                                {userTier === "free" && (
                                    <p className="mt-2 text-sm text-neutral-600 pl-2">
                                        Upgrade for higher limits and one click deploy, credits reset monthly.
                                    </p>
                                )}
                            </div>

                            {/* <div className="flex flex-col items-start gap-2 sm:items-end sm:flex-row sm:mt-1">
                                <button
                                    type="button"
                                    onClick={() => router.push("/price")}
                                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100 hover:border-amber-300 transition-colors"
                                >
                                    <Crown className="h-3 w-3 text-amber-500" />
                                    <span>{userTier === "free" ? "View upgrades" : "Manage plan"}</span>
                                </button>
                            </div> */}
                        </div>
                    </div>
                </section>

                {/* Step 1: URL selection */}
                <section className="mb-8 rounded-3xl border border-neutral-200 bg-white/70 px-4 py-4 sm:px-5 sm:py-5 shadow-sm">
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
                            className="absolute z-[9999] mt-2 w-[min(640px,90vw)] overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg"
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
                                        CREATE
                                    </span>
                                    <span className="text-[13px] sm:text-[14px] text-neutral-800">
                                        Websites
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* <p className="mt-1 mb-2 text-sm text-neutral-500">
                        {(renders.length === 0 ? 'This section will host your editable websites'
                            :
                            'These are the website previews generated from your url.')}
                    </p> */}

                    {(renders.length === 0 || hasGhostPending) ? (
                        <>
                            {/* <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-2 text-sm text-neutral-700 flex flex-wrap items-center gap-2 my-4">
                                <div className="flex items-center gap-1">
                                    <strong className="inline-flex items-center gap-2 text-neutral-800 font-semibold">
                                        {step3Done ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                        ) : (
                                            <Clock10 className="h-4 w-4 text-amber-500" />
                                        )}
                                        <span>Step 2</span>
                                    </strong>
                                    <span className="text-neutral-800">
                                        — Generate a preview.
                                    </span>
                                </div>
                            </div> */}

                            <div
                                className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                                aria-label="Editable previews list"
                            >
                                {groupedShots.length === 0 ? (
                                    <GhostGeneratePreviewCard
                                        locked={false}
                                        onClick={() => {
                                            if (groupedShots.length > 0) {
                                                const firstGroup = groupedShots[0];
                                                const collectionKeys = firstGroup.items.map((s) => s.path);
                                                buildFromCollection(collectionKeys);
                                            } else {
                                                // No screenshots yet; use the url-only flow which triggers screenshot generation server-side.
                                                void buildFromUrl();
                                            }
                                        }}
                                        onAppClick={() => {
                                            // Next.js apps should not open the HTML PreviewEditor with empty initialHtml.
                                            // Route through the app wizard which creates/opens the App Builder overlay.
                                            startWebAppWizard({ seedRenderId: null, url: targetUrl || "" });
                                        }}
                                        isAdmin={isAdmin}
                                        onStartFromTemplate={handleCreateTemplateApp}
                                        onStartFromCommunityBuild={() => router.push("/community-builds")}
                                        user={user}
                                    />
                                ) : (
                                    groupedShots.map((group, groupIndex) => {
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
                                                key={`ghost-${group.snapshotId || first.path}`}
                                                locked={locked}
                                                onClick={() => buildFromCollection(collectionKeys)}
                                                onAppClick={() => {
                                                    startWebAppWizard({ seedRenderId: null, url: targetUrl || "" });
                                                }}
                                                isAdmin={isAdmin}
                                                onStartFromTemplate={handleCreateTemplateApp}
                                                onStartFromCommunityBuild={() => router.push("/community-builds")}
                                                user={user}
                                            />
                                        );
                                    })
                                )}

                                {apps.map((app) => (
                                    <AppCard
                                        key={app.id}
                                        app={app}
                                        isDeleting={!!deletingApp[app.id]}
                                        isArchiving={!!archivingApp[app.id]}
                                        onCustomize={(appId) => {
                                            setCurrentAppId(appId);
                                            setAppBuilderOpen(true);
                                        }}
                                        onArchive={handleArchiveApp}
                                        onDelete={handleDeleteApp}
                                    />
                                ))}
                            </div>
                        </>

                    ) : (
                        <>
                            {/* <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-1 text-sm text-neutral-700 flex flex-wrap items-center gap-1 my-4">
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
                                        <span>— Customize your preview, then deploy it by clicking </span>

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
                            </div> */}

                            <div
                                className="mt-4 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4"
                                aria-label="Editable previews list"
                            >
                                {renders.length === 0 && (
                                    <>
                                        {(() => {
                                            const locked = false;
                                            return (
                                                <GhostGeneratePreviewCard
                                                    locked={locked}
                                                    onClick={() => {
                                                        if (groupedShots.length > 0) {
                                                            const firstGroup = groupedShots[0];
                                                            const collectionKeys = firstGroup.items.map((s) => s.path);
                                                            buildFromCollection(collectionKeys);
                                                        } else {
                                                            // Start with blank website
                                                            setEditorMode("website");
                                                            setEditorOpen(true);
                                                            setEditorHtml(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Website</title>
</head>
<body>
    <h1>Welcome to your new website</h1>
    <p>Start editing to customize it.</p>
</body>
</html>`);
                                                            setEditorRefImg("");
                                                            setActiveRenderId(undefined);
                                                            setActiveSeoMetaByPage(null);
                                                            setActiveArchivedPageIds([]);
                                                        }
                                                    }}
                                                    onAppClick={() => {
                                                        // Next.js apps should not open the HTML PreviewEditor with empty initialHtml.
                                                        // Route through the app wizard which creates/opens the App Builder overlay.
                                                        startWebAppWizard({ seedRenderId: null, url: targetUrl || "" });
                                                    }}
                                                    isAdmin={isAdmin}
                                                    onStartFromTemplate={handleCreateTemplateApp}
                                                    user={user}
                                                />
                                            );
                                        })()}
                                    </>
                                )}
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

                                {apps.map((app) => (
                                    <AppCard
                                        key={app.id}
                                        app={app}
                                        isDeleting={!!deletingApp[app.id]}
                                        isArchiving={!!archivingApp[app.id]}
                                        onCustomize={(appId) => {
                                            setCurrentAppId(appId);
                                            setAppBuilderOpen(true);
                                        }}
                                        onArchive={handleArchiveApp}
                                        onDelete={handleDeleteApp}
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
                                            key={`ghost-${group.snapshotId || first.path}`}
                                            locked={locked}
                                            onClick={() => buildFromCollection(collectionKeys)}
                                            onAppClick={() => {
                                                // Find the most recent render from this group (optional seed)
                                                const groupRenders = renders
                                                    .filter((r) =>
                                                        group.items.some((s) => s.path === r.key) && !r.archived,
                                                    )
                                                    .sort(
                                                        (a, b) =>
                                                            b.createdAt?.toMillis?.() -
                                                            a.createdAt?.toMillis?.() ||
                                                            0,
                                                    );
                                                const latestRender = groupRenders[0];
                                                startWebAppWizard({ seedRenderId: latestRender?.id || null, url: targetUrl || "" });
                                            }}
                                            isAdmin={isAdmin}
                                            onStartFromCommunityBuild={() => router.push("/community-builds")}
                                            user={user}
                                        />
                                    );
                                })}
                            </div>
                        </>
                    )}
                </section>

                {editorOpen && (
                    <PreviewEditorManager
                        firebaseUser={user}
                        userTier={userTier}
                        startProCheckout={startProCheckout}
                        mode={editorMode}
                        initialHtml={editorHtml}
                        sourceImage={editorRefImg}
                        sourceUrl={activeRender?.source || activeRender?.url || undefined}
                        initialSeoMetaByPage={activeSeoMetaByPage || undefined}
                        initialArchivedPageIds={activeArchivedPageIds}
                        onArchivedPageIdsChange={
                            handleArchivedPageIdsChange
                        }
                        onCreateApp={async (mode, prompt, renderId) => {
                            await handleCreateApp(mode, prompt, renderId);
                        }}
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

                {/* app builder overlay */}
                {appBuilderOpen && currentAppId && (
                    <AppBuilderEditor
                        appId={currentAppId}
                        onClose={() => {
                            setAppBuilderOpen(false);
                            setCurrentAppId(null);
                        }}
                        onDeploy={(app) => openAppDeployWizard(app)}
                    />
                )}

                {/* web app wizard */}
                <AnimatePresence>
                    {appWizardOpen && (
                        <motion.div
                            key="app-wizard"
                            className="fixed inset-0 z-[18000]"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                                onClick={() => {
                                    setAppWizardOpen(false);
                                    setAppWizardError(null);
                                    setAppWizardBusy(false);
                                }}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center p-4">
                                <motion.div
                                    className="w-full max-w-[520px] max-h-[calc(100vh-2rem)] overflow-auto rounded-2xl border border-neutral-200 bg-white shadow-2xl"
                                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.98 }}
                                    transition={{ duration: 0.18, ease: "easeOut" }}
                                >
                                    <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
                                        <div className="space-y-1">
                                            <div className="text-sm font-semibold text-neutral-900">Create a Website</div>
                                            <div className="text-xs text-neutral-600">
                                                Start building now. You’ll only need Vercel when you deploy.
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAppWizardOpen(false);
                                                setAppWizardError(null);
                                                setAppWizardBusy(false);
                                            }}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200"
                                            title="Close"
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 20 20"
                                                fill="currentColor"
                                                className="h-4 w-4 text-neutral-700"
                                            >
                                                <path
                                                    fillRule="evenodd"
                                                    d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                                                    clipRule="evenodd"
                                                />
                                            </svg>
                                        </button>
                                    </div>

                                    <div className="px-5 py-4">
                                        {appWizardError ? (
                                            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                                {appWizardError}
                                            </div>
                                        ) : null}

                                        <div className="space-y-3">
                                            <div className="grid gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAppWizardSource("website");
                                                        setAppWizardPrompt("");
                                                        setAppWizardUrl((prev) => (prev || targetUrl || ""));
                                                        setAppWizardShotsUrl((prev) => (prev || targetUrl || ""));
                                                    }}
                                                    className={`relative w-full rounded-xl border p-4 text-left transition ${appWizardSource === "website"
                                                        ? "border-[#f55f2a] bg-[#f55f2a]/5"
                                                        : "border-neutral-200 bg-white hover:bg-neutral-50"
                                                        }`}
                                                >
                                                    <div className="text-sm font-semibold text-neutral-900">Clone from URL</div>
                                                    <div className="mt-1 text-xs text-neutral-600 break-all">
                                                        High-fidelity clone using your saved screenshots when available.
                                                    </div>
                                                    <div className="mt-1 text-xs text-neutral-500 break-all">
                                                        {appWizardUrl || targetUrl || "(no URL selected)"}
                                                    </div>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setAppWizardSource("sample")}
                                                    className={`w-full rounded-xl border p-4 text-left transition ${appWizardSource === "sample"
                                                        ? "border-[#f55f2a] bg-[#f55f2a]/5"
                                                        : "border-neutral-200 bg-white hover:bg-neutral-50"
                                                        }`}
                                                >
                                                    <div className="text-sm font-semibold text-neutral-900">Quick start</div>
                                                    <div className="mt-1 text-xs text-neutral-600">Start from a Kloner sample app. You&apos;ll still be able to customize it</div>
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => setAppWizardSource("prompt")}
                                                    className={`relative w-full rounded-xl border p-4 text-left transition ${appWizardSource === "prompt"
                                                        ? "border-[#f55f2a] bg-[#f55f2a]/5"
                                                        : "border-neutral-200 bg-white hover:bg-neutral-50"
                                                        }`}
                                                >
                                                    <div className="text-sm font-semibold text-neutral-900">Build from a prompt</div>
                                                    <div className="mt-1 text-xs text-neutral-600">Describe the app and we’ll generate the first version.</div>
                                                </button>
                                            </div>

                                            {appWizardSource === "website" ? (
                                                <div className="mt-2 space-y-2">
                                                    <label className="text-xs font-semibold text-neutral-700">
                                                        URL
                                                    </label>
                                                    <input
                                                        value={appWizardUrl}
                                                        onChange={(e) => setAppWizardUrl(e.target.value)}
                                                        placeholder={targetUrl || "https://example.com"}
                                                        className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#f55f2a]/20"
                                                    />
                                                    {/* <div className="text-[11px] leading-4 text-neutral-500">
                                                            Tip: for best fidelity, we’ll use your stored full-page screenshots for the selected URL.
                                                        </div> */}
                                                </div>
                                            ) : null}

                                            {appWizardSource === "prompt" ? (
                                                <div className="mt-2 space-y-2">
                                                    <label className="text-xs font-semibold text-neutral-700">
                                                        Prompt
                                                    </label>
                                                    <textarea
                                                        value={appWizardPrompt}
                                                        onChange={(e) => setAppWizardPrompt(e.target.value)}
                                                        rows={5}
                                                        className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#f55f2a]/20"
                                                        placeholder="Describe what you want to build…"
                                                    />
                                                </div>
                                            ) : null}

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (appWizardSource === "sample") return void submitAppWizardSample();
                                                    if (appWizardSource === "website") return void submitAppWizardWebsite();
                                                    return void submitAppWizardPrompt();
                                                }}
                                                disabled={appWizardBusy}
                                                className="w-full rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                                                style={{ backgroundColor: ACCENT }}
                                            >
                                                {appWizardBusy
                                                    ? "Creating… This may take a minute."
                                                    : appWizardSource === "sample"
                                                        ? "Create app"
                                                        : appWizardSource === "website"
                                                            ? "Create from URL"
                                                            : "Create from prompt"}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-2 border-t border-neutral-200 px-5 py-4">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAppWizardOpen(false);
                                                setAppWizardError(null);
                                                setAppWizardBusy(false);
                                            }}
                                            className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </motion.div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* app deploy wizard */}
                <AnimatePresence>
                    {appDeployWizardOpen && (
                        <motion.div
                            key="app-deploy-wizard"
                            className="fixed inset-0 z-[18050]"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                                onClick={closeAppDeployWizard}
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
                                                        Website deploy
                                                    </p>
                                                    <p className="text-lg font-semibold text-neutral-900">
                                                        {appDeployWizardAppName ? `Deploy ${appDeployWizardAppName}` : "Deploy your web app"}
                                                    </p>
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={closeAppDeployWizard}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200"
                                                title="Close"
                                            >
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    viewBox="0 0 20 20"
                                                    fill="currentColor"
                                                    className="h-4 w-4 text-neutral-700"
                                                >
                                                    <path
                                                        fillRule="evenodd"
                                                        d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                                                        clipRule="evenodd"
                                                    />
                                                </svg>
                                            </button>
                                        </div>

                                        {appDeployWizardError ? (
                                            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                                                {/already exists/i.test(appDeployWizardError) ? (
                                                    <div>
                                                        <div className="font-semibold">Project name already exists</div>
                                                        <div className="mt-1 text-sm text-red-700">
                                                            {appDeployWizardError}
                                                        </div>
                                                        <div className="mt-2 text-[12px] leading-relaxed text-red-700">
                                                            Fix: open your app in the editor by clicking <span className="font-semibold">Customize app</span> on your project,
                                                            then rename it in the <span className="font-semibold">top left</span>. After that, retry deploy.
                                                        </div>

                                                        <div className="mt-3 flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const id = appDeployWizardAppId;
                                                                    if (!id) return;
                                                                    closeAppDeployWizard();
                                                                    setCurrentAppId(id);
                                                                    setAppBuilderOpen(true);
                                                                }}
                                                                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-neutral-900 shadow-sm hover:bg-neutral-50"
                                                            >
                                                                Customize website
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setAppDeployWizardError(null)}
                                                                className="rounded-xl border border-red-200 bg-transparent px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100/60"
                                                            >
                                                                Dismiss
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-red-700">{appDeployWizardError}</div>
                                                )}
                                            </div>
                                        ) : null}

                                        {appDeployWizardStep === 1 ? (
                                            <div className="space-y-4">
                                                <div className="flex items-start gap-3">
                                                    <div className="mt-0.5 relative h-10 w-10 rounded-xl bg-black overflow-hidden">
                                                        <svg
                                                            viewBox="0 0 24 24"
                                                            className="absolute inset-0 m-auto h-5 w-5 text-white"
                                                            aria-hidden="true"
                                                        >
                                                            <path fill="currentColor" d="M12 4l9 16H3l9-16z" />
                                                        </svg>
                                                        <img
                                                            src="/images/vercel.png"
                                                            alt="Vercel"
                                                            className="absolute inset-0 m-auto h-6 w-6 object-contain"
                                                            onError={(e) => {
                                                                // If the asset isn't present, the SVG fallback stays visible.
                                                                (e.currentTarget as HTMLImageElement).style.display = "none";
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-neutral-500">
                                                            Vercel
                                                        </div>
                                                        <div className="text-sm font-semibold text-neutral-900">Vercel connection</div>
                                                        <div className="text-xs text-neutral-600">
                                                            Required to deploy your app live.
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-700">
                                                    <span className="font-semibold text-neutral-800">Status:</span>{" "}
                                                    {isVercelChecking
                                                        ? "Checking connection…"
                                                        : isVercelConnected
                                                            ? "Connected"
                                                            : "Not connected"}
                                                </div>

                                                {isVercelConnected && !isVercelChecking ? (
                                                    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                                                        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-white">
                                                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                                        </div>
                                                        <div>
                                                            <p className="text-neutral-900">Connected</p>
                                                            <p className="text-[11px] text-emerald-700">Continuing to deploy…</p>
                                                        </div>
                                                    </div>
                                                ) : null}

                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (isVercelConnected) return;
                                                            void handleConnectVercelForAppDeployWizard();
                                                        }}
                                                        className="flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                                                        style={{ backgroundColor: ACCENT }}
                                                        disabled={isVercelChecking || isVercelConnected}
                                                    >
                                                        {isVercelChecking
                                                            ? "Checking…"
                                                            : isVercelConnected
                                                                ? "Connected"
                                                                : "Connect Vercel"}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={closeAppDeployWizard}
                                                        className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : null}

                                        {appDeployWizardStep === 2 ? (
                                            <div className="space-y-4">
                                                <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-4 shadow-sm">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="text-lg font-semibold text-neutral-900">
                                                                Upgrade to publish live apps
                                                            </p>
                                                            <p className="mt-1 text-xs text-neutral-600">
                                                                Includes a free trial. Cancel anytime.
                                                            </p>
                                                        </div>

                                                        <div className="flex items-center gap-1 text-[11px] text-neutral-600 shrink-0">
                                                            <span className="text-amber-500">★★★★★</span>
                                                            <span className="text-neutral-500">4.9</span>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 space-y-2">
                                                        <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                            <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                ✓
                                                            </span>
                                                            <span className="leading-snug">Publish live web apps (production URLs)</span>
                                                        </div>

                                                        <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                            <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                ✓
                                                            </span>
                                                            <span className="leading-snug">One‑click deploys from the builder</span>
                                                        </div>

                                                        <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                            <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                ✓
                                                            </span>
                                                            <span className="leading-snug">Higher limits and faster queue</span>
                                                        </div>

                                                        <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                            <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                ✓
                                                            </span>
                                                            <span className="leading-snug">Priority support included</span>
                                                        </div>
                                                    </div>

                                                    <div className="my-4 flex items-start gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                                                        <div className="mt-[1px] h-7 w-7 shrink-0 overflow-hidden rounded-full border border-neutral-200 bg-white">
                                                            <Image
                                                                src="/images/testimonial-avatar.jpg"
                                                                alt="Customer avatar"
                                                                width={28}
                                                                height={28}
                                                                className="h-full w-full object-cover"
                                                                loading="lazy"
                                                            />
                                                        </div>

                                                        <div className="min-w-0">
                                                            <p className="text-[12px] leading-snug text-neutral-800">
                                                                “I struggled with a slow wordpress site but didn&apos;t have the budget to redo it. This app helped me clone and redeploy it in under 10 minutes, I recommend it to anyone needing a quick landing page”
                                                            </p>
                                                            <p className="mt-1 text-[11px] text-neutral-500">Karissa, freelancer</p>
                                                        </div>
                                                    </div>
                                                </div>

                                                <motion.button
                                                    type="button"
                                                    onClick={() => void startProCheckoutForAppDeploy()}
                                                    disabled={checkoutBusy}
                                                    className="w-full rounded-2xl px-5 py-4 text-[15px] font-extrabold text-white shadow-[0_18px_44px_rgba(0,0,0,0.28)] focus:outline-none focus:ring-2 focus:ring-black/10 disabled:cursor-wait disabled:opacity-70"
                                                    style={{ backgroundColor: ACCENT }}
                                                    whileHover={{ scale: 1.01 }}
                                                    whileTap={{ scale: 0.99 }}
                                                    transition={{ duration: 0.16, ease: "easeOut" }}
                                                >
                                                    {checkoutBusy ? "Redirecting to Stripe…" : "Try Pro free and deploy →"}
                                                </motion.button>

                                                <p className="-mt-1 text-center text-[11px] text-neutral-500">
                                                    Trial starts today. Cancel anytime before renewal.
                                                </p>

                                                <button
                                                    type="button"
                                                    onClick={closeAppDeployWizard}
                                                    className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
                                                >
                                                    Not now
                                                </button>
                                            </div>
                                        ) : null}

                                        {appDeployWizardStep === 3 ? (
                                            <div className="space-y-4">
                                                <p className="text-sm text-neutral-600">
                                                    {appDeployWizardBusy
                                                        ? "Deploying to Vercel…"
                                                        : appDeployWizardLiveUrl
                                                            ? "Your app is live."
                                                            : "Ready to deploy."}
                                                </p>

                                                <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-700">
                                                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white border border-neutral-300">
                                                        {appDeployWizardBusy ? (
                                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-[rgba(245,95,42,0.95)]" />
                                                        ) : appDeployWizardLiveUrl ? (
                                                            <span className="text-base">🎉</span>
                                                        ) : (
                                                            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-neutral-900">
                                                            {appDeployWizardBusy
                                                                ? "Deploying…"
                                                                : appDeployWizardLiveUrl
                                                                    ? "Deployed"
                                                                    : "Ready"}
                                                        </p>
                                                        {appDeployWizardLiveUrl ? (
                                                            <p className="text-[11px] text-neutral-600 break-all">
                                                                {appDeployWizardLiveUrl}
                                                            </p>
                                                        ) : (
                                                            <p className="text-[11px] text-neutral-600">
                                                                Deploy creates a production URL in Vercel.
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={closeAppDeployWizard}
                                                        className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                                                    >
                                                        Close
                                                    </button>

                                                    {appDeployWizardLiveUrl ? (
                                                        <a
                                                            href={appDeployWizardLiveUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="group flex flex-inline items-center gap-1 rounded-full px-3 py-1.5 text-sm text-white"
                                                            style={{ backgroundColor: ACCENT }}
                                                        >
                                                            <span>View App</span>
                                                            <Rocket className="h-4 w-4 transform transition-transform duration-150 group-hover:translate-x-0.5" />
                                                        </a>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => void deployAppLive()}
                                                            disabled={appDeployWizardBusy}
                                                            className="rounded-full px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                                                            style={{ backgroundColor: ACCENT }}
                                                        >
                                                            {appDeployWizardBusy ? "Deploying…" : "Deploy"}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                </motion.div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

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
                                                            className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
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
                                                            className="rounded-full px-3 py-1.5 text-sm text-white disabled:opacity-60 disabled:cursor-not-allowed"
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
                                                                className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                Close
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={handleConnectVercelFromWizard}
                                                                disabled={deployWizardBusy}
                                                                className="rounded-full px-3 py-1.5 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed"
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
                                                                    className="group flex flex-inline items-center gap-1 rounded-full px-3 py-1.5 text-sm text-white"
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
                                                    className="w-full"
                                                >
                                                    {/* paywall-style card */}
                                                    <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-[28px] border border-neutral-200 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.20)]">
                                                        {/* illustration header */}
                                                        <div className="relative bg-neutral-50 px-6 pb-6 pt-6">
                                                            <div className="mx-auto flex max-w-[320px] items-center justify-center pt-6">
                                                                {/* simple inline illustration (no extra copy) */}
                                                                <svg viewBox="0 0 560 320" className="h-[160px] w-full" role="img" aria-hidden="true">
                                                                    <defs>
                                                                        <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
                                                                            <stop offset="0" stopColor="#1D4ED8" stopOpacity="0.22" />
                                                                            <stop offset="1" stopColor="#60A5FA" stopOpacity="0.14" />
                                                                        </linearGradient>
                                                                        <filter id="s1" x="-20%" y="-20%" width="140%" height="140%">
                                                                            <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#000" floodOpacity="0.10" />
                                                                        </filter>
                                                                    </defs>

                                                                    {/* soft swoosh */}
                                                                    <path
                                                                        d="M70,210 C130,90 260,70 330,95 C420,128 470,110 510,70"
                                                                        fill="none"
                                                                        stroke="url(#g1)"
                                                                        strokeWidth="22"
                                                                        strokeLinecap="round"
                                                                    />
                                                                    <path
                                                                        d="M80,230 C145,150 250,120 330,140 C415,160 470,155 515,130"
                                                                        fill="none"
                                                                        stroke="url(#g1)"
                                                                        strokeWidth="14"
                                                                        strokeLinecap="round"
                                                                    />

                                                                    {/* hand-ish outline */}
                                                                    <path
                                                                        d="M285 215
                 C275 200 278 182 292 174
                 C305 167 322 173 330 187
                 L358 242
                 C365 256 357 272 343 276
                 C328 280 315 273 309 259
                 L296 230"
                                                                        fill="#fff"
                                                                        stroke="#111827"
                                                                        strokeWidth="6"
                                                                        strokeLinejoin="round"
                                                                        filter="url(#s1)"
                                                                    />

                                                                    {/* pen */}
                                                                    <path
                                                                        d="M360 70
                 L410 40
                 C420 34 432 38 436 48
                 L466 118
                 C470 128 465 140 455 144
                 L405 174 Z"
                                                                        fill="#2563EB"
                                                                        opacity="0.95"
                                                                        filter="url(#s1)"
                                                                    />
                                                                    <path
                                                                        d="M406 174 L360 70"
                                                                        stroke="#93C5FD"
                                                                        strokeWidth="10"
                                                                        strokeLinecap="round"
                                                                        opacity="0.8"
                                                                    />

                                                                    {/* sparks */}
                                                                    <path d="M140 92 L152 62" stroke="#F59E0B" strokeWidth="8" strokeLinecap="round" />
                                                                    <path d="M152 62 L172 78" stroke="#F59E0B" strokeWidth="8" strokeLinecap="round" />
                                                                    <path d="M140 92 L166 98" stroke="#F59E0B" strokeWidth="8" strokeLinecap="round" />

                                                                    <circle cx="210" cy="88" r="6" fill="#FB7185" opacity="0.9" />
                                                                    <circle cx="238" cy="68" r="4" fill="#FB7185" opacity="0.85" />
                                                                    <circle cx="468" cy="88" r="5" fill="#FB7185" opacity="0.85" />
                                                                    <circle cx="494" cy="112" r="4" fill="#FB7185" opacity="0.8" />
                                                                </svg>
                                                            </div>
                                                        </div>

                                                        {/* content */}
                                                        <div className="px-7 pb-6 pt-5">
                                                            {/* badge */}
                                                            <div className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1 text-[11px] font-extrabold tracking-[0.18em] text-neutral-800 uppercase">
                                                                Try Pro for free
                                                            </div>

                                                            {/* headline */}
                                                            <h2 className="mt-3 text-[34px] font-bold leading-[1.05] text-neutral-900">
                                                                Deploy in one click
                                                            </h2>

                                                            {/* subcopy */}
                                                            <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">
                                                                7 day free trial. Cancel anytime.
                                                            </p>

                                                            {/* feature list */}
                                                            <div className="mt-5 space-y-3">
                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">One click Vercel deploy</span>
                                                                </div>

                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">Multiple Sites & Team Management</span>
                                                                </div>

                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">300+ Exclusive Design Tools</span>
                                                                </div>

                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">Premium Templates</span>
                                                                </div>


                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">Higher limits and faster queue</span>
                                                                </div>

                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">24/7 Chat Support Included</span>
                                                                </div>
                                                            </div>

                                                            {/* small secondary action */}
                                                            <div className="mt-6 text-center">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openExitOffer("close")}
                                                                    className="text-[12px] font-semibold text-neutral-500 hover:text-neutral-700"
                                                                >
                                                                    Don’t deploy my new site
                                                                </button>
                                                            </div>

                                                            {/* primary CTA */}
                                                            <div className="mt-5">
                                                                <motion.button
                                                                    type="button"
                                                                    onClick={() => void startProCheckout()}
                                                                    disabled={checkoutBusy}
                                                                    className="w-full rounded-2xl px-5 py-4 text-[15px] font-extrabold text-white shadow-[0_18px_44px_rgba(0,0,0,0.28)] focus:outline-none focus:ring-2 focus:ring-black/10 disabled:cursor-wait disabled:opacity-70"
                                                                    style={{ backgroundColor: ACCENT }}
                                                                    whileHover={{ scale: 1.01 }}
                                                                    whileTap={{ scale: 0.99 }}
                                                                    transition={{ duration: 0.16, ease: "easeOut" }}
                                                                >
                                                                    {checkoutBusy ? "Redirecting to Stripe…" : "Try Pro free and deploy →"}
                                                                </motion.button>

                                                                <p className="mt-3 text-center text-[11px] text-neutral-500">
                                                                    Trial starts today. Cancel anytime before renewal.
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Exit offer modal (ONLY place you show the discount) */}
                                                    <AnimatePresence>
                                                        {showExitOffer && (
                                                            <motion.div
                                                                key="exit-offer"
                                                                initial={{ opacity: 0 }}
                                                                animate={{ opacity: 1 }}
                                                                exit={{ opacity: 0 }}
                                                                className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                                                                role="dialog"
                                                                aria-modal="true"
                                                            >
                                                                <motion.div
                                                                    initial={{ opacity: 0, y: 24, scale: 0.96 }}
                                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                                    exit={{ opacity: 0, y: 16, scale: 0.96 }}
                                                                    transition={{ duration: 0.22, ease: [0.23, 0.82, 0.25, 1] }}
                                                                    className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-neutral-200 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.20)]"
                                                                >
                                                                    {/* ultra-minimal header strip */}
                                                                    <div className="h-1 w-full" style={{ backgroundColor: ACCENT }} />

                                                                    {/* tighter padding, more “exclusive” */}
                                                                    <div className="px-4 pb-4 pt-3">
                                                                        <div className="flex items-start justify-between gap-3">
                                                                            <div className="min-w-0">
                                                                                {/* small whisper label */}
                                                                                <div className="flex items-center gap-2">
                                                                                    <span
                                                                                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] uppercase"
                                                                                        style={{
                                                                                            borderColor: `${ACCENT}33`,
                                                                                            backgroundColor: `${ACCENT}10`,
                                                                                            color: ACCENT,
                                                                                        }}
                                                                                    >
                                                                                        One-time Deal
                                                                                    </span>

                                                                                    {/* social proof: minimal */}
                                                                                    <div className="flex items-center gap-1 text-[11px] text-neutral-600">
                                                                                        <span className="text-amber-500">★★★★★</span>
                                                                                        <span className="text-neutral-500">4.9</span>
                                                                                    </div>
                                                                                </div>

                                                                                {/* discount line: big number, not heavy font */}
                                                                                <div className="mt-6 flex justify-center items-baseline gap-2">
                                                                                    <span className="text-[30px] font-semibold leading-none text-neutral-900">Exclusive Welcome Gift</span>
                                                                                </div>

                                                                                {/* discount line: big number, not heavy font */}
                                                                                <div className="mt-6 flex justify-center items-baseline gap-2">
                                                                                    <span className="text-[28px] font-bold text-accent leading-none text-neutral-900">40% off</span>
                                                                                    <span className="text-[12px] font-medium text-neutral-600">your first month</span>
                                                                                </div>
                                                                                <div className="mt-1 flex text-[12px] justify-center text-neutral-700 gap-1">

                                                                                </div>
                                                                                {/* price compare: minimal, still explicit */}
                                                                                <div className="mt-1 flex text-[12px] justify-center text-neutral-700 gap-1">
                                                                                    <span className="font-medium">only $4.35/week</span>{" "}
                                                                                    <span className="text-neutral-500 line-through">$29.00</span>{" "}
                                                                                    <span className="text-neutral-500">for month one</span>
                                                                                </div>

                                                                                {/* micro testimonial row (image avatar) */}
                                                                                <div className="my-7 flex items-start gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                                                                                    <div className="mt-[1px] h-7 w-7 shrink-0 overflow-hidden rounded-full border border-neutral-200 bg-white">
                                                                                        <Image
                                                                                            src="/images/testimonial-avatar.jpg"
                                                                                            alt="Customer avatar"
                                                                                            width={28}
                                                                                            height={28}
                                                                                            className="h-full w-full object-cover"
                                                                                            loading="lazy"
                                                                                        />
                                                                                    </div>

                                                                                    <div className="min-w-0">
                                                                                        <p className="text-[12px] leading-snug text-neutral-800">
                                                                                            “I struggled with a slow wordpress site but didn&apos;t have the budget to redo it. This app helped me clone and redeploy it in under 10 minutes, I recommend it to anyone needing a quick landing page”
                                                                                        </p>
                                                                                        <p className="mt-1 text-[11px] text-neutral-500">Karissa, freelancer</p>
                                                                                    </div>
                                                                                </div>

                                                                            </div>

                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setShowExitOffer(false)}
                                                                                aria-label="Close"
                                                                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-[18px] leading-none text-neutral-700 hover:bg-neutral-50"
                                                                                style={{ aspectRatio: "1 / 1" }}
                                                                            >
                                                                                ×
                                                                            </button>

                                                                        </div>

                                                                        {/* Primary CTA */}
                                                                        <div className="mt-6">
                                                                            <motion.button
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    setShowExitOffer(false);
                                                                                    void startProCheckout({
                                                                                        exitOffer: true,
                                                                                        exitOfferReason: exitOfferReason || "close",
                                                                                    });
                                                                                }}
                                                                                disabled={checkoutBusy}
                                                                                className="w-full rounded-2xl px-5 py-4 text-[15px] font-extrabold text-white shadow-[0_18px_44px_rgba(0,0,0,0.28)] focus:outline-none focus:ring-2 focus:ring-black/10 disabled:cursor-wait disabled:opacity-70"
                                                                                style={{ backgroundColor: ACCENT }}
                                                                                whileHover={{ scale: 1.01 }}
                                                                                whileTap={{ scale: 0.99 }}
                                                                                transition={{ duration: 0.16, ease: "easeOut" }}
                                                                            >
                                                                                {checkoutBusy ? "Redirecting to Stripe…" : "Start free trial & claim 40% off →"}
                                                                            </motion.button>

                                                                            <p className="mt-3 text-center text-[11px] text-neutral-500">
                                                                                Free for 7 days. Discount applies after trial. Cancel anytime.
                                                                            </p>
                                                                        </div>

                                                                        {/* Secondary action */}
                                                                        <div className="mt-4 text-center">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    setShowExitOffer(false);
                                                                                    closeDeployWizard();
                                                                                }}
                                                                                className="text-[12px] font-semibold text-neutral-500 hover:text-neutral-700"
                                                                            >
                                                                                No thanks, close
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </motion.div>
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
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
                                            <Image
                                                src={shots[viewerIdx].url}
                                                alt={shots[viewerIdx].fileName}
                                                width={1600}
                                                height={1000}
                                                sizes="(min-width: 1024px) 900px, 100vw"
                                                className="h-auto w-full max-w-full object-contain"
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

                {/* PRO paywall for apps */}
                {
                    showProPaywall && (
                        <div className="fixed inset-0 z-[12000]">
                            <div className="absolute inset-0 bg-black/60" />
                            <div className="absolute inset-0 flex items-center justify-center p-4">
                                <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-neutral-200 p-6 text-sm text-neutral-800">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Crown className="h-4 w-4 text-amber-500" />
                                        <h3 className="text-base font-semibold">
                                            Upgrade to PRO to build apps
                                        </h3>
                                    </div>
                                    <p className="text-sm text-neutral-600 mb-3">
                                        Building dynamic web apps with features like user authentication, search, and CMS requires a PRO subscription.
                                    </p>
                                    <ul className="mb-4 list-disc list-inside text-sm text-neutral-700 space-y-1">
                                        <li>Build apps with login, auth, and databases</li>
                                        <li>Advanced features like CMS and search</li>
                                        <li>Deploy complex applications</li>
                                    </ul>
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowProPaywall(false)}
                                            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                                        >
                                            Not now
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowProPaywall(false);
                                                startProCheckout();
                                            }}
                                            className="rounded-md px-3 py-1.5 text-sm font-semibold text-white"
                                            style={{ backgroundColor: ACCENT }}
                                        >
                                            Upgrade to PRO
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
            </div>
        </main>
    );
}
