// src/components/AppBuilderEditor.tsx
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Editor from "@monaco-editor/react";
import Image from "next/image";
import { Folder, File, Upload, X, RefreshCw, MessageSquare, Code, Check, RotateCcw, Database, Rocket, Monitor, SlidersHorizontal, Images, Send, Pencil, Loader2, Share2, ExternalLink, Copy, ChevronDown, ChevronRight, AlertTriangle, Search, Paintbrush, MoreVertical } from "lucide-react";
import AppBuilderEditorAgentChat from "./AppBuilderEditorAgentChat";
import { AppBuilderEditorTour } from "./AppBuilderEditorTour";
import { TOUR_KEY as BUILDER_TOUR_STORAGE_KEY } from "./AppBuilderEditorTour";
import AppPreviewEditor from "./AppPreviewEditor";
import WebsitePrePaywall from "./WebsitePrePaywall";
import KlonerLoader from "./KlonerLoader";
import WebContainerRunner from "./WebContainerRunner";
import { bootstrapServerSession, ensureSessionAndCsrf, resetAuthClientCaches } from "@/lib/auth-client";
import { useVercelIntegration } from "@/src/hooks/useVercelIntegration";
import { auth, db, storage } from "@/lib/firebase";
import { TRIAL_CTA_LABEL } from "@/src/lib/billingAccess";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { doc, onSnapshot } from "firebase/firestore";
import { resolveStorageUrl } from "@/src/lib/renders";
import { signOut as firebaseSignOut } from "firebase/auth";
import { useAuth } from "@/src/hooks/useAuth";
import { useModal } from "@/components/ui/ModalContext";
import { compressImageForUpload } from "@/src/lib/clientImageCompression";
import { sanitizeImageName } from "./helpers";
import { recordAppBuilderSessionAnalytics } from "@/components/analytics";
import { AnimatePresence, motion } from "framer-motion";
import { detectProjectFramework, shouldPreserveRuntimeScripts } from "@/src/lib/projectFramework";
import { normalizePreviewApplyResponse } from "@/src/lib/appEmbeddingsClient";
import { getResponsiveUiScale } from "@/src/lib/uiScale";
import {
    canShowPreviewFixWithAi,
    normalizePreviewFailureContract,
    type PreviewFailureContract,
} from "./previewFailureContract";
import { postPreviewApply } from "./previewMachineApply";
import { ensureUserImageStorageRoom, IMAGE_STORAGE_LIMIT_BYTES, loadUserImageStorageUsage, uploadUserImageToFirebase } from "@/src/lib/imageStorage";

const VERCEL_INTEGRATION_SLUG =
    process.env.NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG || "kloner";
const APP_BUILDER_PENDING_SHARE_KEY = "kloner_vercel_pending_app_share";
const APP_BUILDER_PENDING_AI_IMAGES_KEY = "kloner_vercel_pending_ai_images";

type PreviewIssueFixDecision = {
    eligible: boolean;
    reason: "compile_fixable" | "failure_present_but_not_fixable" | "missing_failure_classification";
};

function safeParseDiagnostics(raw: string | null | undefined): Record<string, any> | null {
    if (!raw || typeof raw !== "string") return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function getPreviewIssueFixDecision(issueText: string | null | undefined, diagnosticsRaw: string | null | undefined, explicitFailure: PreviewFailureContract | null | undefined): PreviewIssueFixDecision {
    const issue = String(issueText || "").trim();
    if (!issue) return { eligible: false, reason: "missing_failure_classification" };

    const diagnostics = safeParseDiagnostics(diagnosticsRaw);
    const fallbackFailure = normalizePreviewFailureContract(diagnostics?.currentStatusData?.failure);
    const failure = explicitFailure || fallbackFailure;
    if (!failure) {
        return { eligible: false, reason: "missing_failure_classification" };
    }

    return {
        eligible: canShowPreviewFixWithAi(failure),
        reason: canShowPreviewFixWithAi(failure) ? "compile_fixable" : "failure_present_but_not_fixable",
    };
}

function DevOnlyIconBadge({ title }: { title: string }) {
    return (
        <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-600"
            title={title}
            aria-label={title}
        >
            <ChevronRight className="h-2.5 w-2.5" />
        </span>
    );
}

type FileNode = {
    name: string;
    type: "file" | "folder";
    children?: FileNode[];
    content?: string;
};

type AppData = {
    id: string;
    name: string;
    files: { [path: string]: { content: string; lastModified: number } };
    htmlStoragePath?: string | null;
    htmlByteLength?: number | null;
    htmlEditIndex?: unknown;
    embeddingStatus?: string | null;
    embeddingMessage?: string | null;
    embeddingProgress?: number | null;
    embedding?: {
        status?: string | null;
        stage?: string | null;
        progress?: number | null;
        message?: string | null;
    } | null;
    updatedAt?: unknown;
    vercelProjectId?: string;
    previewUrl?: string;
    isDeployed?: boolean;
    productionUrl?: string | null;
    vercelProtectionBypassSecret?: string | null;
    generationStatus?: string | null;
    generationError?: string | null;
    generationProgress?: number | null;
    generation?: {
        status?: string | null;
        stage?: string | null;
        progress?: number | null;
        title?: string | null;
        jobId?: string | null;
        requestId?: string | null;
        archiveZipPath?: string | null;
        archiveZipUrl?: string | null;
        errorCode?: string | null;
        details?: unknown;
        retryable?: boolean | null;
        needsRescan?: boolean | null;
        nextAction?: string | null;
    } | null;
    lastDeploymentId?: string | null;
    lastDeploymentState?: string | null;
    lastDeploymentErrorCode?: string | null;
    lastDeploymentErrorMessage?: string | null;
    lastDeploymentErrorAt?: unknown;
    lastDeploymentUrl?: string | null;
};

type FileHydrationProgressCallback = (progress: number) => void;

type NormalizedGenerationState = {
    status: string | null;
    stage: string | null;
    progress: number | null;
    message: string | null;
    title: string | null;
    jobId: string | null;
    requestId: string | null;
    archiveZipPath: string | null;
    archiveZipUrl: string | null;
    error: string | null;
    errorCode: string | null;
    details: unknown;
    retryable: boolean | null;
    needsRescan: boolean | null;
    nextAction: string | null;
};

type AutoPreviewPhase =
    | "idle"
    | "checking"
    | "connecting"
    | "loading"
    | "ready"
    | "building"
    | "enabling-bypass"
    | "error";

type LeftViewMode = "ai" | "code" | "images" | "custom";

type UpgradePaywallCopy = {
    title: string;
    description: string;
    benefits: string[];
    primaryLabel: string;
    footerNote: string;
};

const DEPLOY_UPGRADE_PAYWALL_COPY: UpgradePaywallCopy = {
    title: "Upgrade to publish",
    description: "Publish your website live from the editor. Upgrade to unlock one-click deploy and higher monthly credits.",
    benefits: [
        "Deploy 40+ websites per month",
        "One-click publishing",
        "AI task force to build and design your websites",
        "Higher queue priority for faster outputs",
        "24/7 Human support included",
        "Subscriptions starting at only $4.99/wk.",
    ],
    primaryLabel: TRIAL_CTA_LABEL,
    footerNote: "Cancel anytime before renewal.",
};

const FREE_PLAN_UPGRADE_PAYWALL_COPY: UpgradePaywallCopy = {
    title: "You’ve hit the limit on your free plan",
    description: "You’ve used your free AI edit credits. Upgrade to keep building, unlock more features, and publish from the same dashboard.",
    benefits: [
        "Higher monthly limits for screenshots and previews",
        "Unlock deployments and live URLs",
        "Priority rendering and faster queues",
        "Access way more features",
        "AI task force to build and design your websites",
        "Subscriptions starting at only $4.99/wk.",
    ],
    primaryLabel: TRIAL_CTA_LABEL,
    footerNote: "Cancel anytime before renewal.",
};

type PreviewMode = "webcontainer" | "vercel";

type EditorIssue = {
    title: string;
    detail: string;
    fingerprint: string;
    fixAction?: string;
};

type DeployStatusBanner = {
    kind: "success" | "error";
    title: string;
    detail: string;
    fingerprint: string;
    fixAction?: string;
    liveUrl?: string | null;
};

function buildDeployIssueFromApp(appData: Partial<AppData> | null | undefined): EditorIssue | null {
    if (!appData) return null;

    const deploymentId = String(appData.lastDeploymentId || "").trim();
    const state = String(appData.lastDeploymentState || "").toLowerCase();
    const errorCode = String(appData.lastDeploymentErrorCode || "").trim();
    const errorMessage = String(appData.lastDeploymentErrorMessage || "").trim();
    const errorStamp = (() => {
        const raw = appData.lastDeploymentErrorAt;
        if (!raw) return "current";
        if (typeof raw === "string") return raw.trim() || "current";
        if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : "current";
        try {
            const serialized = JSON.stringify(raw);
            return serialized && serialized !== "{}" ? serialized : "current";
        } catch {
            return "current";
        }
    })();

    if (state !== "error" && !errorMessage) return null;

    const detail = errorMessage || "Vercel reported a deployment failure.";
    if (/Vercel is not connected yet|Vercel is not connected|not connected for this user/i.test(detail)) {
        return {
            title: "Vercel not connected",
            detail: "Connect Vercel before deploying from this editor.",
            fingerprint: `deploy:${deploymentId || "unknown"}:${errorStamp}:vercel-not-connected`,
            fixAction: "connect_vercel",
        };
    }

    return {
        title: "Deployment failed",
        detail,
        fingerprint: `deploy:${deploymentId || "unknown"}:${errorStamp}:${errorCode || "error"}:${detail.slice(0, 160)}`,
        fixAction: errorCode === "VERCEL_DEPLOY_BODY_TOO_LARGE" ? "reduce_deploy_payload" : "deploy_issue_fix",
    };
}

function buildDeployErrorBannerFromApp(appData: Partial<AppData> | null | undefined): DeployStatusBanner | null {
    const issue = buildDeployIssueFromApp(appData);
    if (!issue) return null;

    return {
        kind: "error",
        title: issue.title,
        detail: issue.detail,
        fingerprint: issue.fingerprint,
        fixAction: issue.fixAction,
        liveUrl: appData?.lastDeploymentUrl || null,
    };
}

function buildDeploySuccessBanner(params: {
    appId: string;
    deploymentId?: string | null;
    liveUrl?: string | null;
}): DeployStatusBanner {
    const liveUrl = typeof params.liveUrl === "string" ? params.liveUrl.trim() : "";
    return {
        kind: "success",
        title: "Live deploy started",
        detail: "Rebuild can take a few minutes before updates appear.",
        fingerprint: `deploy-success:${params.appId}:${params.deploymentId || liveUrl || "unknown"}`,
        liveUrl: liveUrl || null,
    };
}

type VercelOAuthFlow = "preview" | "share" | "images";

type CodedError = Error & {
    code?: string;
    statusCode?: number;
};

type ObservabilityFrontendIngestPayload = {
    source: "frontend";
    severity: "critical" | "error" | "warning" | "info";
    statusCode?: number;
    route?: string;
    method?: string;
    action?: string;
    userId?: string;
    requestId?: string;
    message: string;
    errorName?: string;
    stack?: string;
    url?: string;
    service?: string;
    extra?: Record<string, unknown>;
};

type StagedImage = {
    id: string;
    originalFile: globalThis.File;
    preparedFile: globalThis.File;
    previewUrl: string;
    originalBytes: number;
    preparedBytes: number;
    alt: string;
    placementPrompt: string;
    uploadedUrl: string | null;
    uploadedPath: string | null;
    status: "staged" | "uploading" | "applied" | "failed";
    error: string | null;
};
type PlacementPosition = "top" | "middle" | "bottom";

type ImagePlacementPlan = {
    targetPath: string;
    position: PlacementPosition;
    label: string;
};

type LastImageInsert = {
    stagedImageId: string;
    targetPath: string;
    previousContent: string;
    uploadedPath: string | null;
};

const IMAGE_PLACEMENT_PLACEHOLDERS = [
    "insert this image on the homepage",
    "insert this image for the product display",
    "insert this image in the footer",
];

const APP_BUILDER_COOKIE_CONSENT_KEY = "kloner.appBuilder.necessaryCookiesAccepted.v1";
const APP_BUILDER_COOKIE_CONSENT_COOKIE = "kloner_app_builder_nc";
const APP_BUILDER_TRIAL_DWELL_MS = 0;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const PREVIEW_RECOVERY_MESSAGE = "Something went wrong while preparing the preview. Please try again.";

function getCookieValue(name: string): string | null {
    if (typeof document === "undefined") return null;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1] || "") : null;
}

function hasAcceptedBuilderNecessaryCookies(): boolean {
    if (typeof window === "undefined") return false;

    try {
        const local = window.localStorage.getItem(APP_BUILDER_COOKIE_CONSENT_KEY);
        if (local === "1") return true;
    } catch {
        // ignore
    }

    const cookie = getCookieValue(APP_BUILDER_COOKIE_CONSENT_COOKIE);
    return cookie === "1";
}

function persistBuilderNecessaryCookiesConsent(): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    try {
        window.localStorage.setItem(APP_BUILDER_COOKIE_CONSENT_KEY, "1");
    } catch {
        // ignore
    }

    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${APP_BUILDER_COOKIE_CONSENT_COOKIE}=1; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
}

function formatDeployUrlShortLabel(url: string | null): string {
    if (!url) return "Open live site";
    try {
        const parsed = new URL(url);
        const path = parsed.pathname === "/" ? "" : parsed.pathname;
        const shortPath = path.length > 12 ? `${path.slice(0, 12)}…` : path;
        return `${parsed.hostname}${shortPath}`;
    } catch {
        return url.length > 28 ? `${url.slice(0, 28)}…` : url;
    }
}

function copyTextToClipboard(text: string): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    }

    if (typeof document === "undefined") return Promise.resolve(false);

    try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return Promise.resolve(ok);
    } catch {
        return Promise.resolve(false);
    }
}

function mergeFilesPreferNewest(
    localFiles: AppData["files"],
    remoteFiles: AppData["files"],
): AppData["files"] {
    const merged: AppData["files"] = {};
    const keys = new Set<string>([...Object.keys(localFiles || {}), ...Object.keys(remoteFiles || {})]);
    for (const key of keys) {
        const local = (localFiles as any)?.[key];
        const remote = (remoteFiles as any)?.[key];
        if (!local && remote) {
            merged[key] = remote;
            continue;
        }
        if (!remote && local) {
            merged[key] = local;
            continue;
        }
        if (!local && !remote) continue;

        const localTs = typeof local?.lastModified === "number" ? local.lastModified : 0;
        const remoteTs = typeof remote?.lastModified === "number" ? remote.lastModified : 0;

        // Prefer the newest edit. On ties with differing content, prefer remote
        // so backend-hydrated files are not masked by stale local state.
        if (remoteTs > localTs) {
            merged[key] = remote;
        } else if (localTs > remoteTs) {
            merged[key] = local;
        } else {
            const localContent = typeof local?.content === "string" ? local.content : "";
            const remoteContent = typeof remote?.content === "string" ? remote.content : "";
            merged[key] = remoteContent !== localContent ? remote : local;
        }
    }
    return merged;
}

function normalizeIncomingFilesMap(input: unknown): AppData["files"] {
    const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const normalized: AppData["files"] = {};

    for (const [path, raw] of Object.entries(source)) {
        const cleanPath = String(path || "").trim();
        if (!cleanPath) continue;

        if (typeof raw === "string") {
            normalized[cleanPath] = { content: raw, lastModified: Date.now() };
            continue;
        }

        if (!raw || typeof raw !== "object") {
            normalized[cleanPath] = { content: "", lastModified: Date.now() };
            continue;
        }

        const file = raw as Record<string, unknown>;
        const content = typeof file.content === "string" ? file.content : "";
        const lastModified = typeof file.lastModified === "number" && Number.isFinite(file.lastModified)
            ? file.lastModified
            : Date.now();

        normalized[cleanPath] = { content, lastModified };
    }

    return normalized;
}

function ensureCompilerOptionsObject(jsonText: string): { ok: true; normalized: string } | { ok: false } {
    try {
        const parsed: any = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
        if (!parsed.compilerOptions || typeof parsed.compilerOptions !== "object" || Array.isArray(parsed.compilerOptions)) {
            parsed.compilerOptions = {};
            return { ok: true, normalized: JSON.stringify(parsed, null, 2) + "\n" };
        }
        return { ok: true, normalized: JSON.stringify(parsed, null, 2) + "\n" };
    } catch {
        return { ok: false };
    }
}

function filesShallowEqualByContentAndTimestamp(
    a: AppData["files"],
    b: AppData["files"],
): boolean {
    const aKeys = Object.keys(a || {});
    const bKeys = Object.keys(b || {});
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        const av = (a as any)[key];
        const bv = (b as any)[key];
        if (!bv) return false;
        if (av?.lastModified !== bv?.lastModified) return false;
        if (av?.content !== bv?.content) return false;
    }
    return true;
}

function csrfHeaders(csrf: unknown): HeadersInit | undefined {
    if (typeof csrf === "string" && csrf.trim()) {
        return { "x-csrf": csrf };
    }
    return undefined;
}

function asTrimmedString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const next = value.trim();
    return next ? next : null;
}

function asFiniteNumber(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return value;
}

function asBoolean(value: unknown): boolean | null {
    if (typeof value !== "boolean") return null;
    return value;
}

function normalizeGenerationState(data: any): NormalizedGenerationState {
    const generation = data?.generation && typeof data.generation === "object" ? data.generation : null;
    const legacyError = asTrimmedString(data?.error) || asTrimmedString(data?.generationError);

    return {
        status:
            asTrimmedString(generation?.status) ||
            asTrimmedString(generation?.stage) ||
            asTrimmedString(data?.generationStatus) ||
            asTrimmedString(data?.status),
        stage:
            asTrimmedString(generation?.stage) ||
            asTrimmedString(data?.generationStage) ||
            asTrimmedString(data?.stage),
        progress:
            asFiniteNumber(generation?.progress) ??
            asFiniteNumber(data?.generationProgress) ??
            asFiniteNumber(data?.progress),
        message:
            asTrimmedString(generation?.message) ||
            asTrimmedString(data?.generationMessage) ||
            asTrimmedString(data?.message),
        title:
            asTrimmedString(generation?.title) ||
            asTrimmedString(data?.generationTitle) ||
            asTrimmedString(data?.title),
        jobId:
            asTrimmedString(generation?.jobId) ||
            asTrimmedString(data?.generationJobId) ||
            asTrimmedString(data?.jobId),
        requestId:
            asTrimmedString(generation?.requestId) ||
            asTrimmedString(data?.generationRequestId) ||
            asTrimmedString(data?.requestId) ||
            asTrimmedString(data?.reqId),
        archiveZipPath:
            asTrimmedString(generation?.archiveZipPath) ||
            asTrimmedString(data?.archiveZipPath),
        archiveZipUrl:
            asTrimmedString(generation?.archiveZipUrl) ||
            asTrimmedString(data?.archiveZipUrl),
        error:
            asTrimmedString(generation?.error) ||
            asTrimmedString(generation?.errorMessage) ||
            legacyError,
        errorCode:
            asTrimmedString(generation?.errorCode) ||
            asTrimmedString(data?.generationErrorCode) ||
            asTrimmedString(data?.errorCode) ||
            null,
        details:
            generation?.details ??
            data?.generationDetails ??
            data?.details ??
            null,
        retryable:
            asBoolean(generation?.retryable) ??
            asBoolean(data?.generationRetryable) ??
            asBoolean(data?.retryable),
        needsRescan:
            asBoolean(generation?.needsRescan) ??
            asBoolean(data?.generationNeedsRescan) ??
            asBoolean(data?.needsRescan),
        nextAction:
            asTrimmedString(generation?.nextAction) ||
            asTrimmedString(data?.generationNextAction) ||
            asTrimmedString(data?.nextAction),
    };
}

type NormalizedEmbeddingState = {
    status: string | null;
    progress: number | null;
    message: string | null;
};

function normalizeEmbeddingState(data: any): NormalizedEmbeddingState {
    const embedding = data?.embedding && typeof data.embedding === "object" ? data.embedding : null;

    return {
        status:
            asTrimmedString(embedding?.status) ||
            asTrimmedString(embedding?.stage) ||
            asTrimmedString(data?.embeddingStatus) ||
            asTrimmedString(data?.embeddingStage) ||
            asTrimmedString(data?.status),
        progress:
            asFiniteNumber(embedding?.progress) ??
            asFiniteNumber(data?.embeddingProgress) ??
            asFiniteNumber(data?.progress),
        message:
            asTrimmedString(embedding?.message) ||
            asTrimmedString(data?.embeddingMessage) ||
            asTrimmedString(data?.message),
    };
}

function generationStateChanged(
    prev: Partial<NormalizedGenerationState> | null | undefined,
    next: Partial<NormalizedGenerationState>,
): boolean {
    if (!prev) return true;
    return (
        prev.status !== next.status ||
        prev.stage !== next.stage ||
        prev.progress !== next.progress ||
        prev.message !== next.message ||
        prev.title !== next.title ||
        prev.jobId !== next.jobId ||
        prev.requestId !== next.requestId ||
        prev.archiveZipPath !== next.archiveZipPath ||
        prev.archiveZipUrl !== next.archiveZipUrl ||
        prev.error !== next.error ||
        prev.errorCode !== next.errorCode ||
        prev.details !== next.details ||
        prev.retryable !== next.retryable ||
        prev.needsRescan !== next.needsRescan ||
        prev.nextAction !== next.nextAction
    );
}

function isGenerationInProgress(state: NormalizedGenerationState | null | undefined): boolean {
    const status = state?.status || "";
    return ["queued", "running", "extracting_archive", "generating", "writing_files", "processing"].includes(status);
}

function isGenerationInProgressStatus(status: string | null | undefined): boolean {
    return ["queued", "running", "extracting_archive", "generating", "writing_files", "processing"].includes(status || "");
}

function formatGenerationStageLabel(stage: string | null): string | null {
    if (!stage) return null;
    switch (stage) {
        case "extracting_archive":
            return "Extracting archive";
        case "writing_files":
            return "Writing files";
        default:
            return stage.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
    }
}

function detectNextAppDir(files: AppData["files"] | null | undefined): "src/app" | "app" | null {
    const keys = Object.keys(files || {});
    if (keys.some((key) => key === "src/app" || key.startsWith("src/app/"))) return "src/app";
    if (keys.some((key) => key === "app" || key.startsWith("app/"))) return "app";
    return null;
}

function isPageFile(path: string): boolean {
    const value = String(path || "").trim();
    if (!value) return false;
    return (
        /^(?:src\/)?app\/.+\/page\.(tsx|ts|jsx|js|mdx?)$/i.test(value) ||
        /^(?:src\/)?app\/page\.(tsx|ts|jsx|js|mdx?)$/i.test(value) ||
        /^(?:src\/)?pages\/(?:index|.+)\.(tsx|ts|jsx|js|mdx?)$/i.test(value) ||
        /^public\/.+\/index\.html?$/i.test(value) ||
        /^public\/index\.html?$/i.test(value) ||
        /^public\/.+\.html?$/i.test(value)
    );
}

function humanizePageLabel(path: string): string {
    const normalized = String(path || "").replace(/^src\//, "");
    if (/^(?:app|pages)\/(?:page|index)\.[^.]+$/i.test(normalized) || /^public\/index\.html?$/i.test(normalized)) return "home";

    const publicMatch = normalized.match(/^public\/(.+?)\/(?:index\.html?|index)$/i) || normalized.match(/^public\/(.+?)\.html?$/i);
    if (publicMatch?.[1]) {
        return publicMatch[1]
            .replace(/\(([^)]+)\)/g, "$1")
            .split("/")
            .filter(Boolean)
            .map((segment) => segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toLowerCase()))
            .join(" / ");
    }

    const appMatch = normalized.match(/^app\/(.+?)\/page\.[^.]+$/i);
    const pagesMatch = normalized.match(/^pages\/(.+?)\.[^.]+$/i);
    const rawRoute = appMatch?.[1] || pagesMatch?.[1] || normalized;
    return rawRoute
        .replace(/\/index$/i, "")
        .replace(/\(([^)]+)\)/g, "$1")
        .split("/")
        .filter(Boolean)
        .map((segment) => segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toLowerCase()))
        .join(" / ") || path;
}

function pageFileToPreviewPath(path: string): string {
    const normalized = String(path || "").replace(/^src\//, "").trim();
    if (!normalized) return "/";

    if (/^app\/page\.[^.]+$/i.test(normalized) || /^pages\/index\.[^.]+$/i.test(normalized)) {
        return "/";
    }

    if (normalized.toLowerCase().startsWith("app/")) {
        const segments = normalized
            .slice(4)
            .replace(/\/page\.[^.]+$/i, "")
            .split("/")
            .filter(Boolean)
            .filter((segment) => !/^\(.+\)$/.test(segment) && !segment.startsWith("@"));
        return `/${segments.join("/")}`.replace(/\/+/g, "/") || "/";
    }

    if (normalized.toLowerCase().startsWith("pages/")) {
        const route = normalized.slice(6).replace(/\.(tsx|ts|jsx|js|mdx?)$/i, "");
        return `/${route.replace(/\/index$/i, "")}`.replace(/\/+/g, "/") || "/";
    }

    if (normalized.toLowerCase().startsWith("public/")) {
        const route = normalized
            .slice(7)
            .replace(/\/index\.html?$/i, "")
            .replace(/\.html?$/i, "");
        if (!route || route.toLowerCase() === "index") return "/";
        return `/${route}`.replace(/\/+/g, "/") || "/";
    }

    return "/";
}

function buildHeadTsxWithFavicon(faviconUrl: string): string {
    return [
        "export default function Head() {",
        "  return (",
        "    <>",
        `      <link rel=\"icon\" href=\"${faviconUrl}\" />`,
        "    </>",
        "  );",
        "}",
        "",
    ].join("\n");
}

function appHasStripeConfig(files: AppData["files"] | null | undefined): boolean {
    const haystack = Object.values(files || {})
        .map((file) => String(file?.content || ""))
        .join("\n");
    return /STRIPE_(SECRET|PUBLISHABLE|PUBLIC)|NEXT_PUBLIC_STRIPE|stripe/i.test(haystack);
}

function upsertFaviconInHeadTsx(existing: string, faviconUrl: string): string {
    const nextHref = faviconUrl;

    // Replace an existing rel="icon" href="..." in either attribute order.
    const r1 = /(<link\s+[^>]*rel=["']icon["'][^>]*href=["'])([^"']*)(["'][^>]*>)/i;
    if (r1.test(existing)) {
        return existing.replace(r1, `$1${nextHref}$3`);
    }
    const r2 = /(<link\s+[^>]*href=["'])([^"']*)(["'][^>]*rel=["']icon["'][^>]*>)/i;
    if (r2.test(existing)) {
        return existing.replace(r2, `$1${nextHref}$3`);
    }

    // If it's a TSX file with a return fragment, insert our link near the top.
    const insertAfter = existing.indexOf("return (");
    if (insertAfter !== -1) {
        const idx = existing.indexOf("<>", insertAfter);
        if (idx !== -1) {
            const before = existing.slice(0, idx + 2);
            const after = existing.slice(idx + 2);
            return (
                before +
                `\n      {/* kloner:favicon */}\n      <link rel=\"icon\" href=\"${nextHref}\" />` +
                after
            );
        }
    }

    // Fallback: preserve existing and append a safe link.
    return existing + `\n\n{/* kloner:favicon */}\n<link rel=\"icon\" href=\"${nextHref}\" />\n`;
}

function buildFaviconIcoRouteTs(faviconUrl: string): string {
    const urlLiteral = JSON.stringify(faviconUrl);
    return (
        `// kloner:favicon-route\n` +
        `const FAVICON_URL = ${urlLiteral};\n\n` +
        `async function fetchFavicon() {\n` +
        `  const upstream = await fetch(FAVICON_URL, { cache: "no-store" });\n` +
        `  if (!upstream.ok) {\n` +
        `    return new Response(null, { status: 307, headers: { Location: FAVICON_URL } });\n` +
        `  }\n` +
        `  const contentType = upstream.headers.get("content-type") || "image/x-icon";\n` +
        `  const cacheControl = upstream.headers.get("cache-control") || "public, max-age=3600";\n` +
        `  const body = await upstream.arrayBuffer();\n` +
        `  return new Response(body, {\n` +
        `    status: 200,\n` +
        `    headers: {\n` +
        `      "content-type": contentType,\n` +
        `      "cache-control": cacheControl,\n` +
        `    },\n` +
        `  });\n` +
        `}\n\n` +
        `export async function GET() {\n` +
        `  return fetchFavicon();\n` +
        `}\n\n` +
        `export async function HEAD() {\n` +
        `  const res = await fetchFavicon();\n` +
        `  return new Response(null, { status: res.status, headers: res.headers });\n` +
        `}\n`
    );
}

const htmlStorageContentCache = new Map<string, Promise<string | null>>();

function isHtmlPath(path: string): boolean {
    return /\.(html?|xhtml)$/i.test(String(path || ""));
}

function isLikelyHtmlPathHint(value: string): boolean {
    const raw = String(value || "").trim();
    if (!raw) return false;
    if (raw.length > 200) return false;
    if (/\s/.test(raw)) return false;
    return /(^|\/)[^/]+\.(html?|xhtml)$/i.test(raw);
}

function collectHtmlCandidatePaths(value: unknown, out: Set<string>) {
    if (!value || out.size > 50) return;

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (isLikelyHtmlPathHint(trimmed)) {
            out.add(trimmed.replace(/^\/+/, ""));
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) collectHtmlCandidatePaths(item, out);
        return;
    }

    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        for (const [key, nested] of Object.entries(record)) {
            if (isLikelyHtmlPathHint(key)) {
                out.add(key.replace(/^\/+/, ""));
            }
            if (key === "path" || key === "filePath" || key === "targetPath" || key === "htmlPath" || key === "entryPath") {
                if (typeof nested === "string" && isLikelyHtmlPathHint(nested)) {
                    out.add(nested.replace(/^\/+/, ""));
                }
            }
            collectHtmlCandidatePaths(nested, out);
        }
    }
}

function pickHtmlTargetPaths(files: AppData["files"], htmlEditIndex: unknown): string[] {
    const hinted = new Set<string>();
    collectHtmlCandidatePaths(htmlEditIndex, hinted);

    for (const path of Object.keys(files || {})) {
        if (isHtmlPath(path)) hinted.add(path);
    }

    if (hinted.size === 0) {
        hinted.add("index.html");
    }

    return Array.from(hinted);
}

async function readHtmlFromStorage(storagePath: string): Promise<string | null> {
    const path = String(storagePath || "").trim();
    if (!path) return null;

    const cached = htmlStorageContentCache.get(path);
    if (cached) return cached;

    const pending = (async () => {
        const resolved = await resolveStorageUrl(path);
        if (!resolved) return null;

        const res = await fetch(resolved, { method: "GET", cache: "no-store", credentials: "include" });
        if (!res.ok) return null;

        const html = (await res.text()).trim();
        return html || null;
    })().catch(() => null);

    htmlStorageContentCache.set(path, pending);
    return pending;
}

function proxyFirebaseStorageUrl(rawUrl: string, proxyOrigin = ""): string {
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

function rewriteFirebaseStorageUrlsInHtml(html: string, proxyOrigin = ""): string {
    const input = String(html || "");
    if (!input) return input;
    return input.replace(
        /https?:\/\/(?:firebasestorage|storage)\.googleapis\.com\/[^\s"'<>)]*/gi,
        (match) => proxyFirebaseStorageUrl(match, proxyOrigin),
    );
}

function rewriteFirebaseStorageUrlsInHtmlForWebContainer(html: string, proxyOrigin: string): string {
    return rewriteFirebaseStorageUrlsInHtml(html, proxyOrigin);
}

async function hydrateHtmlFilesForApp(
    data: AppData,
    opts?: {
        onProgress?: FileHydrationProgressCallback;
    },
): Promise<AppData> {
    const emitProgress = (completed: number, total: number) => {
        if (!opts?.onProgress) return;
        const safeTotal = Math.max(1, total);
        const nextProgress = Math.max(0, Math.min(100, Math.round((completed / safeTotal) * 100)));
        opts.onProgress(nextProgress);
    };

    const yieldToBrowser = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    const sourceFiles = Object.entries(data.files || {});
    const nextFiles: AppData["files"] = {};
    const storagePath = typeof data.htmlStoragePath === "string" ? data.htmlStoragePath.trim() : "";
    const targetPaths = pickHtmlTargetPaths(data.files || {}, data.htmlEditIndex);
    const needsHydration = storagePath ? targetPaths.some((path) => !String(data.files?.[path]?.content || "").trim()) : false;
    const totalWorkUnits = Math.max(1, sourceFiles.length + (needsHydration ? 1 : 0));
    let completedWorkUnits = 0;

    opts?.onProgress?.(1);

    for (let index = 0; index < sourceFiles.length; index += 1) {
        const [path, file] = sourceFiles[index];
        if (typeof file?.content !== "string") {
            nextFiles[path] = file;
        } else {
            nextFiles[path] = isHtmlPath(path)
                ? {
                    ...file,
                    content: rewriteFirebaseStorageUrlsInHtml(file.content),
                }
                : file;
        }

        completedWorkUnits += 1;
        emitProgress(completedWorkUnits, totalWorkUnits);
        if ((index + 1) % 8 === 0) {
            await yieldToBrowser();
        }
    }

    if (!storagePath) {
        opts?.onProgress?.(100);
        return { ...data, files: nextFiles };
    }

    if (!needsHydration) {
        opts?.onProgress?.(100);
        return { ...data, files: nextFiles };
    }

    completedWorkUnits += 1;
    emitProgress(completedWorkUnits, totalWorkUnits);
    await yieldToBrowser();

    const html = await readHtmlFromStorage(storagePath);
    if (!html) {
        opts?.onProgress?.(100);
        return { ...data, files: nextFiles };
    }
    const normalizedHtml = rewriteFirebaseStorageUrlsInHtml(html);
    let applied = false;

    for (const path of targetPaths) {
        const current = nextFiles[path];
        if (current && String(current.content || "").trim()) continue;

        nextFiles[path] = {
            content: normalizedHtml,
            lastModified: current?.lastModified || Date.now(),
        };
        applied = true;

        if (Object.prototype.hasOwnProperty.call(data.files || {}, path)) {
            break;
        }
    }

    if (!applied && !Object.keys(data.files || {}).some((path) => isHtmlPath(path))) {
        nextFiles["index.html"] = {
            content: normalizedHtml,
            lastModified: Date.now(),
        };
    }

    opts?.onProgress?.(100);
    return { ...data, files: nextFiles };
}

async function hydratePrimaryHtmlFileForApp(
    data: AppData,
    opts?: {
        onProgress?: FileHydrationProgressCallback;
    },
): Promise<AppData> {
    const yieldToPaint = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const nextFiles: AppData["files"] = { ...(data.files || {}) };
    const storagePath = typeof data.htmlStoragePath === "string" ? data.htmlStoragePath.trim() : "";
    const targetPaths = pickHtmlTargetPaths(data.files || {}, data.htmlEditIndex);
    const firstTarget = targetPaths[0] || null;

    opts?.onProgress?.(10);
    await yieldToPaint();

    if (!firstTarget) {
        opts?.onProgress?.(100);
        return { ...data, files: nextFiles };
    }

    const current = nextFiles[firstTarget];
    if (current && String(current.content || "").trim()) {
        nextFiles[firstTarget] = isHtmlPath(firstTarget)
            ? {
                ...current,
                content: rewriteFirebaseStorageUrlsInHtml(String(current.content || "")),
            }
            : current;
        await yieldToPaint();
        opts?.onProgress?.(100);
        return { ...data, files: nextFiles };
    }

    if (!storagePath) {
        await yieldToPaint();
        opts?.onProgress?.(100);
        return { ...data, files: nextFiles };
    }

    opts?.onProgress?.(45);
    await yieldToPaint();
    const html = await readHtmlFromStorage(storagePath);
    if (!html) {
        await yieldToPaint();
        opts?.onProgress?.(100);
        return { ...data, files: nextFiles };
    }

    opts?.onProgress?.(85);
    await yieldToPaint();
    nextFiles[firstTarget] = {
        content: rewriteFirebaseStorageUrlsInHtml(html),
        lastModified: current?.lastModified || Date.now(),
    };

    if (!Object.keys(data.files || {}).some((path) => isHtmlPath(path))) {
        nextFiles["index.html"] = {
            content: rewriteFirebaseStorageUrlsInHtml(html),
            lastModified: Date.now(),
        };
    }

    await yieldToPaint();
    opts?.onProgress?.(100);
    return { ...data, files: nextFiles };
}

function addCacheBust(url: string, token: string | number): string {
    try {
        const u = new URL(url);
        // IMPORTANT: `t` is reserved as the preview viewer token (capability).
        // Use a different param for cache-busting.
        u.searchParams.set("cb", String(token));
        return u.toString();
    } catch {
        const suffix = url.includes("?") ? "&" : "?";
        return `${url}${suffix}cb=${encodeURIComponent(String(token))}`;
    }
}

function addVercelProtectionBypass(url: string, secret: string | null | undefined): string {
    const s = (secret || "").trim();
    if (!s) return url;
    try {
        const u = new URL(url);
        u.searchParams.set("x-vercel-protection-bypass", s);
        return u.toString();
    } catch {
        const suffix = url.includes("?") ? "&" : "?";
        return `${url}${suffix}x-vercel-protection-bypass=${encodeURIComponent(s)}`;
    }
}

function appendPathToUrl(url: string, path: string): string {
    const raw = String(path || "").trim();
    if (!raw) return url;

    const normalized = raw.startsWith("/") ? raw : `/${raw}`;
    try {
        const u = new URL(url);
        u.pathname = normalized.replace(/\/+/g, "/");
        return u.toString();
    } catch {
        const base = String(url || "").replace(/[?#].*$/, "");
        return `${base}${normalized}`;
    }
}

function escapeAttribute(value: string): string {
    return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildImageSnippet(url: string, alt: string): string {
    const safeUrl = escapeAttribute(url);
    const safeAlt = escapeAttribute(alt || "");
    return `<img src=\"${safeUrl}\" alt=\"${safeAlt}\" loading=\"lazy\" />`;
}

function detectPlacementPosition(prompt: string): PlacementPosition {
    const p = String(prompt || "").toLowerCase();
    if (/(bottom|footer|end|last|below)/i.test(p)) return "bottom";
    if (/(top|header|hero|start|above|first)/i.test(p)) return "top";
    return "middle";
}

function resolveFileFromPrompt(
    files: AppData["files"],
    prompt: string,
    currentFile: string | null,
): string | null {
    const p = String(prompt || "").toLowerCase();
    const keys = Object.keys(files || {});
    const codeKeys = keys.filter((k) => /\.(tsx|ts|jsx|js|html|mdx?)$/i.test(k));

    const byPriority = (candidates: string[]) => candidates.find((c) => Boolean((files as any)?.[c])) || null;

    if (/(this file|current file|here)/i.test(p) && currentFile && (files as any)?.[currentFile]) {
        return currentFile;
    }

    const homepage = byPriority(["src/app/page.tsx", "app/page.tsx", "src/pages/index.tsx", "pages/index.tsx", "src/pages/index.jsx", "pages/index.jsx"]);
    if (/(homepage|home page|home|landing)/i.test(p) && homepage) {
        return homepage;
    }

    const routeMatch = p.match(/\/(\w[\w-]*)/);
    if (routeMatch && routeMatch[1]) {
        const route = routeMatch[1].toLowerCase();
        const routeFile = codeKeys.find((k) => k.toLowerCase().includes(`/app/${route}/page.`) || k.toLowerCase().includes(`/pages/${route}.`));
        if (routeFile) return routeFile;
    }

    const sectionHints: Array<{ match: RegExp; token: string }> = [
        { match: /(about)/i, token: "about" },
        { match: /(contact)/i, token: "contact" },
        { match: /(pricing|price)/i, token: "price" },
        { match: /(team)/i, token: "team" },
        { match: /(blog)/i, token: "blog" },
        { match: /(faq|support)/i, token: "support" },
    ];
    for (const hint of sectionHints) {
        if (!hint.match.test(p)) continue;
        const match = codeKeys.find((k) => k.toLowerCase().includes(hint.token));
        if (match) return match;
    }

    if (currentFile && (files as any)?.[currentFile] && /\.(tsx|ts|jsx|js|html|mdx?)$/i.test(currentFile)) {
        return currentFile;
    }

    if (homepage) return homepage;
    return codeKeys[0] || null;
}

function resolveImagePlacementPlan(
    files: AppData["files"],
    prompt: string,
    currentFile: string | null,
): ImagePlacementPlan | null {
    const targetPath = resolveFileFromPrompt(files, prompt, currentFile);
    if (!targetPath) return null;
    const position = detectPlacementPosition(prompt);
    return {
        targetPath,
        position,
        label: `${targetPath} (${position})`,
    };
}

function insertSnippetIntoContent(content: string, snippet: string, position: PlacementPosition): string {
    const base = String(content || "");
    const insertAfterTag = (regex: RegExp): string | null => {
        const m = regex.exec(base);
        if (!m || m.index < 0) return null;
        const start = m.index;
        const end = start + m[0].length;
        return `${base.slice(0, end)}\n${snippet}\n${base.slice(end)}`;
    };

    if (position === "top") {
        return (
            insertAfterTag(/<main[^>]*>/i) ||
            insertAfterTag(/<header[^>]*>/i) ||
            insertAfterTag(/<body[^>]*>/i) ||
            `${snippet}\n${base}`
        );
    }

    if (position === "bottom") {
        const mainClose = base.search(/<\/main>/i);
        if (mainClose >= 0) {
            return `${base.slice(0, mainClose)}\n${snippet}\n${base.slice(mainClose)}`;
        }
        const bodyClose = base.search(/<\/body>/i);
        if (bodyClose >= 0) {
            return `${base.slice(0, bodyClose)}\n${snippet}\n${base.slice(bodyClose)}`;
        }
        const needsBreak = base.length > 0 && !base.endsWith("\n");
        return `${base}${needsBreak ? "\n" : ""}${snippet}\n`;
    }

    return (
        insertAfterTag(/<section[^>]*>/i) ||
        insertAfterTag(/<main[^>]*>/i) ||
        (() => {
            const needsBreak = base.length > 0 && !base.endsWith("\n");
            return `${base}${needsBreak ? "\n" : ""}${snippet}\n`;
        })()
    );
}

function FileTree({ nodes, onFileSelect, expandedFolders, onToggleFolder, prefix = "", depth = 0, forceExpanded = false }: {
    nodes: FileNode[];
    onFileSelect: (path: string) => void;
    expandedFolders: Record<string, boolean>;
    onToggleFolder: (path: string) => void;
    prefix?: string;
    depth?: number;
    forceExpanded?: boolean;
}) {
    return (
        <ul>
            {nodes.map((node) => (
                <li key={node.name}>
                    {(() => {
                        const nodePath = prefix + node.name;
                        const isExpanded = forceExpanded || (expandedFolders[nodePath] ?? true);

                        return node.type === "folder" ? (
                        <button
                            type="button"
                            onClick={() => onToggleFolder(nodePath)}
                            className="flex w-full items-center gap-2 rounded-md py-1 text-left hover:bg-gray-100"
                            style={{ paddingLeft: depth * 16 + 4 }}
                        >
                            <span className="inline-flex h-4 w-4 items-center justify-center text-gray-500">
                                {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                ) : (
                                    <ChevronRight className="h-4 w-4" />
                                )}
                            </span>
                            <Folder className="h-4 w-4 shrink-0" />
                            <span>{node.name}</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => onFileSelect(nodePath)}
                            className="flex w-full items-center gap-2 rounded-md py-1 text-left hover:bg-gray-100"
                            style={{ paddingLeft: depth * 16 + 4 }}
                        >
                            <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true" />
                            <File className="h-4 w-4 shrink-0" />
                            <span className="truncate">{node.name}</span>
                        </button>
                    );
                    })()}
                    {(() => {
                        const nodePath = prefix + node.name;
                        const isExpanded = forceExpanded || (expandedFolders[nodePath] ?? true);
                        return node.children && isExpanded ? (
                        <FileTree
                            nodes={node.children}
                            onFileSelect={onFileSelect}
                            expandedFolders={expandedFolders}
                            onToggleFolder={onToggleFolder}
                            prefix={prefix + node.name + "/"}
                            depth={depth + 1}
                            forceExpanded={forceExpanded}
                        />
                        ) : null;
                    })()}
                </li>
            ))}
        </ul>
    );
}

function filterFileTree(nodes: FileNode[], query: string, prefix = ""): FileNode[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return nodes;

    const matchesText = (value: string) => value.toLowerCase().includes(normalized);

    return nodes
        .map((node) => {
            const fullPath = `${prefix}${node.name}`;
            const selfMatches = matchesText(node.name) || matchesText(fullPath);

            if (node.type === "file") {
                return selfMatches ? node : null;
            }

            const childMatches = filterFileTree(node.children || [], normalized, `${fullPath}/`);
            if (selfMatches) {
                return { ...node, children: node.children || [] };
            }
            if (childMatches.length > 0) {
                return { ...node, children: childMatches };
            }
            return null;
        })
        .filter((node): node is FileNode => Boolean(node));
}

function getEditorLanguageForPath(path: string | null): string {
    const lower = String(path || "").toLowerCase();
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    if (lower.endsWith(".css")) return "css";
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
    if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) return "typescriptreact";
    if (lower.endsWith(".ts")) return "typescript";
    if (lower.endsWith(".js")) return "javascript";
    return "javascript";
}

export default function AppBuilderEditor({
    appId,
    initialAppData = null,
    initialViewMode,
    onCanonicalAppIdResolved,
    onClose,
    onMissingApp,
    onDeploy,
    deployLocked = false,
    accessLocked = false,
    showTour = false,
    onRequestDeployCheckout,
    agentWelcomeContext,
    trialPromptEnabled = false,
    trialPromptSessionEligible = false,
    trialCheckoutBusy = false,
    onTrialPromptShown,
    onTrialPromptStartCheckout,
    previewDebugScenario = null,
    deployIssue = null,
}: {
    appId: string;
    initialAppData?: AppData | null;
    initialViewMode?: LeftViewMode;
    onCanonicalAppIdResolved?: (canonicalAppId: string) => void;
    onClose: () => void;
    onMissingApp?: (missingAppId: string) => void;
    onDeploy?: (app: { id: string; name: string }) => void;
    deployLocked?: boolean;
    accessLocked?: boolean;
    showTour?: boolean;
    onRequestDeployCheckout?: () => void;
    agentWelcomeContext?: {
        source?: "prompt" | "url" | "quickstart" | "template" | "sample" | "unknown";
        prompt?: string | null;
        url?: string | null;
        templateName?: string | null;
    };
    trialPromptEnabled?: boolean;
    trialPromptSessionEligible?: boolean;
    trialCheckoutBusy?: boolean;
    onTrialPromptShown?: (appId: string) => void;
    onTrialPromptStartCheckout?: (appId: string) => void;
    previewDebugScenario?: { mode: 'terminal-error' | 'terminal-error-auto-fix'; nonce: number } | null;
    deployIssue?: EditorIssue | null;
}) {
    const { user, userTier, loading: authLoading } = useAuth();
    const { showConfirm, showAlert, hideModal } = useModal();
    const onMissingAppRef = useRef(onMissingApp);
    const sourceUrlToRescan = useMemo(() => {
        if (agentWelcomeContext?.source !== "url") return "";
        return String(agentWelcomeContext?.url || "").trim();
    }, [agentWelcomeContext?.source, agentWelcomeContext?.url]);

    useEffect(() => {
        if (!onCanonicalAppIdResolved) return;
        onCanonicalAppIdResolved(appId);
    }, [onCanonicalAppIdResolved, appId]);

    useEffect(() => {
        onMissingAppRef.current = onMissingApp;
    }, [onMissingApp]);

    const faviconInputRef = useRef<HTMLInputElement | null>(null);
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const [faviconUploading, setFaviconUploading] = useState(false);
    const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
    const [supabaseConnected, setSupabaseConnected] = useState<boolean | null>(null);
    const [supabaseProjectName, setSupabaseProjectName] = useState<string | null>(null);
    const [supabaseProjectRef, setSupabaseProjectRef] = useState<string | null>(null);
    const [supabaseDbReachable, setSupabaseDbReachable] = useState<boolean | null>(null);
    const [supabaseDbStatusText, setSupabaseDbStatusText] = useState<string | null>(null);
    const [supabaseDbReason, setSupabaseDbReason] = useState<string | null>(null);
    const [supabaseDbLastCheckedAt, setSupabaseDbLastCheckedAt] = useState<number | null>(null);
    const supabaseVerifyInFlightRef = useRef(false);
    const lastSupabaseVerifyAtRef = useRef(0);
    const supabaseConnectedRef = useRef<boolean | null>(null);
    const supabaseDbHealthInFlightRef = useRef(false);
    const lastSupabaseDbHealthAtRef = useRef(0);
    const getOptionalAuthHeaders = useCallback(
        async (forceRefreshToken: boolean): Promise<Record<string, string>> => {
            if (!user?.uid) return {};

            const buildHeaders = (token: string) => ({
                authorization: `Bearer ${token}`,
            });

            try {
                const idToken = await user.getIdToken(forceRefreshToken);
                return buildHeaders(idToken);
            } catch (err) {
                console.warn("[app-builder] Firebase ID token unavailable; falling back to session cookie", err);

                if (forceRefreshToken) {
                    try {
                        const cachedToken = await user.getIdToken(false);
                        return buildHeaders(cachedToken);
                    } catch (fallbackErr) {
                        console.warn("[app-builder] cached Firebase ID token fallback failed", fallbackErr);
                    }
                }

                return {};
            }
        },
        [user],
    );

    useEffect(() => {
        supabaseConnectedRef.current = supabaseConnected;
    }, [supabaseConnected]);

        const refreshSupabaseStatusFromApi = useCallback(async (): Promise<boolean> => {
            try {
                const url = appId
                    ? `/api/supabase/project-status?appId=${encodeURIComponent(appId)}`
                    : "/api/supabase/project-status";
                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) return false;
                const data: any = await res.json().catch(() => null);
                if (data && data.completed && data.ok) {
                    const name = typeof data?.project?.name === "string" && data.project.name.trim() ? data.project.name.trim() : null;
                    const ref =
                        (typeof data?.project?.ref === "string" && data.project.ref.trim() ? data.project.ref.trim() : null) ||
                        (typeof data?.project?.id === "string" && data.project.id.trim() ? data.project.id.trim() : null);

                    setSupabaseConnected(true);
                    setSupabaseProjectName(name);
                    setSupabaseProjectRef(ref);
                    return true;
                }
                if (data && data.completed && data.ok === false) {
                    setSupabaseConnected(false);
                    setSupabaseProjectName(null);
                    setSupabaseProjectRef(null);
                }
                return false;
            } catch {
                return false;
            }
        }, []);

        const verifySupabaseConnection = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
            if (!user?.uid) return false;
            if (supabaseVerifyInFlightRef.current) return supabaseConnectedRef.current === true;

            const now = Date.now();
            if (now - lastSupabaseVerifyAtRef.current < 10_000) {
                return supabaseConnectedRef.current === true;
            }
            lastSupabaseVerifyAtRef.current = now;
            supabaseVerifyInFlightRef.current = true;

            try {
                const csrf = await ensureSessionAndCsrf().catch(() => null);
                const res = await fetch("/api/supabase/verify", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    body: JSON.stringify({ cleanupIfDeleted: true, appId: appId || undefined }),
                });
                const data: any = await res.json().catch(() => null);

                if (!res.ok || !data?.ok) {
                    // If we're in a neutral/"verifying" state, don't get stuck.
                    // Fall back to the session-protected status endpoint (GET; no CSRF).
                    if (supabaseConnectedRef.current === null) {
                        const ok = await refreshSupabaseStatusFromApi();
                        if (ok) return true;
                        setSupabaseConnected(false);
                        setSupabaseProjectName(null);
                        setSupabaseProjectRef(null);
                        return false;
                    }
                    // Don’t flap the UI on transient failures.
                    return supabaseConnectedRef.current === true;
                }

                if (data.connected) {
                    setSupabaseConnected(true);
                    return true;
                }

                // Not connected; clear locally.
                setSupabaseConnected(false);
                setSupabaseProjectName(null);
                setSupabaseProjectRef(null);

                if (!opts?.silent) {
                    const reason = typeof data?.reason === "string" ? data.reason : "disconnected";
                    const msg =
                        reason === "project_deleted"
                            ? "Your Supabase project no longer exists (it looks like it was deleted). Kloner removed the stale connection."
                            : reason === "unauthorized"
                              ? "Kloner can’t access your Supabase project anymore. Please reconnect Supabase."
                              : reason === "app_mismatch"
                                ? "" // Silently clear — this integration belongs to a different app
                                : "Supabase is no longer connected. Please reconnect.";
                    if (msg) void showAlert(msg, "Database");
                }
                return false;
            } catch {
                if (supabaseConnectedRef.current === null) {
                    const ok = await refreshSupabaseStatusFromApi();
                    if (ok) return true;
                    setSupabaseConnected(false);
                    setSupabaseProjectName(null);
                    setSupabaseProjectRef(null);
                    return false;
                }
                return supabaseConnectedRef.current === true;
            } finally {
                supabaseVerifyInFlightRef.current = false;
            }
        }, [refreshSupabaseStatusFromApi, showAlert, user?.uid]);

        const checkSupabaseDbHealth = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
            if (!user?.uid) return false;
            if (supabaseDbHealthInFlightRef.current) return supabaseDbReachable === true;

            const now = Date.now();
            if (now - lastSupabaseDbHealthAtRef.current < 10_000) {
                return supabaseDbReachable === true;
            }
            lastSupabaseDbHealthAtRef.current = now;
            supabaseDbHealthInFlightRef.current = true;

            try {
                const csrf = await ensureSessionAndCsrf().catch(() => null);
                const res = await fetch("/api/supabase/db-health", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    body: JSON.stringify({ cleanupIfDeleted: true, appId: appId || undefined }),
                    cache: "no-store",
                });

                const data: any = await res.json().catch(() => null);
                setSupabaseDbLastCheckedAt(Date.now());

                if (!res.ok || !data?.ok) {
                    // Don’t flap on transient failures.
                    setSupabaseDbReachable(null);
                    setSupabaseDbStatusText("Could not verify database reachability");
                    return false;
                }

                if (data.connected === false) {
                    setSupabaseConnected(false);
                    setSupabaseProjectName(null);
                    setSupabaseProjectRef(null);
                    setSupabaseDbReachable(false);
                    setSupabaseDbReason(data?.reason || null);
                    setSupabaseDbStatusText(
                        data?.reason === "project_deleted"
                            ? "Supabase project was deleted"
                            : data?.reason === "unauthorized"
                              ? "Supabase access unauthorized"
                              : "Supabase not connected",
                    );

                    if (!opts?.silent) {
                        void showAlert(
                            data?.reason === "project_deleted"
                                ? "Your Supabase project no longer exists (it looks like it was deleted). Kloner removed the stale connection."
                                : "Supabase is not reachable right now. Please reconnect.",
                            "Database",
                        );
                    }
                    return false;
                }

                const reachable = Boolean(data.reachable);
                setSupabaseDbReachable(reachable);
                setSupabaseDbReason(reachable ? null : (data?.reason || null));

                const reason = typeof data?.reason === "string" ? data.reason : "";
                setSupabaseDbStatusText(
                    reachable
                        ? "Database reachable"
                        : reason === "project_paused"
                          ? "Project is paused — resume it in the Supabase dashboard"
                          : reason === "timeout_or_network"
                            ? "Connection timed out — project may still be resuming after a pause"
                            : (typeof data?.error === "string" && data.error.trim())
                              ? data.error.trim()
                              : "Database not reachable (project may be paused or networking is blocked)",
                );
                return reachable;
            } catch {
                setSupabaseDbLastCheckedAt(Date.now());
                setSupabaseDbReachable(null);
                setSupabaseDbReason(null);
                setSupabaseDbStatusText("Could not verify database reachability");
                return false;
            } finally {
                supabaseDbHealthInFlightRef.current = false;
            }
        }, [showAlert, supabaseDbReachable, user?.uid]);

        useEffect(() => {
            if (!user?.uid) {
                setSupabaseConnected(null);
                setSupabaseProjectName(null);
                setSupabaseProjectRef(null);
                setSupabaseDbReachable(null);
                setSupabaseDbReason(null);
                setSupabaseDbStatusText(null);
                setSupabaseDbLastCheckedAt(null);
                return;
            }

            setSupabaseConnected(null);
            const integrationRef = doc(db, "kloner_users", user.uid, "kloner_apps", appId, "integrations", "supabase");
            const unsub = onSnapshot(
                integrationRef,
                (snap) => {
                    if (!snap.exists()) {
                        setSupabaseConnected(false);
                        setSupabaseProjectName(null);
                        setSupabaseProjectRef(null);
                        return;
                    }
                    const data = snap.data() as any;

                    // Optimistically show connected if the integration doc exists.
                    // Background verification will flip it back to disconnected if the project was deleted.
                    setSupabaseConnected(true);
                    setSupabaseProjectName(
                        typeof data?.projectName === "string" && data.projectName.trim() ? data.projectName.trim() : null,
                    );
                    const ref =
                        (typeof data?.projectRef === "string" && data.projectRef.trim() ? data.projectRef.trim() : null) ||
                        (typeof data?.projectId === "string" && data.projectId.trim() ? data.projectId.trim() : null);
                    setSupabaseProjectRef(ref);

                    void verifySupabaseConnection({ silent: true });
                    void checkSupabaseDbHealth({ silent: true });
                },
                () => {
                    // If Firestore read fails (rules/offline), fall back to the session-protected status endpoint.
                    void refreshSupabaseStatusFromApi().then((ok) => {
                        if (!ok) {
                            setSupabaseConnected(false);
                            setSupabaseProjectName(null);
                            setSupabaseProjectRef(null);
                        }
                    });
                },
            );

            let didCleanup = false;
            return () => {
                if (didCleanup) return;
                didCleanup = true;
                try {
                    unsub();
                } catch (err) {
                    // Firestore can throw internal assertion errors in rare edge cases
                    // (e.g. rapid subscribe/unsubscribe or React strict-mode double-invoke).
                    console.warn("Supabase integration listener unsubscribe error:", err);
                }
            };
        }, [checkSupabaseDbHealth, refreshSupabaseStatusFromApi, user?.uid, verifySupabaseConnection]);

        useEffect(() => {
            if (!supabaseConnected) return;
            const id = window.setInterval(() => {
                void checkSupabaseDbHealth({ silent: true });
            }, 60_000);
            return () => window.clearInterval(id);
        }, [checkSupabaseDbHealth, supabaseConnected]);

        const disconnectSupabase = useCallback(async () => {
            if (!user?.uid) {
                void showAlert("Please sign in to disconnect your database.", "Database");
                return;
            }

            const confirmed = await showConfirm(
                "Disconnect Supabase from Kloner?\n\nThis does NOT delete your Supabase project — it only removes Kloner’s stored connection so you can connect a different project.",
                "Database",
            );
            if (!confirmed) return;

            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch("/api/supabase/disconnect", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ confirm: "DISCONNECT", appId: appId || undefined }),
            });

            const data: any = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                const msg = (data && (data.error || data.message)) ? String(data.error || data.message) : "Failed to disconnect.";
                void showAlert(msg, "Database");
                return;
            }

            setSupabaseConnected(false);
            setSupabaseProjectName(null);
            setSupabaseProjectRef(null);
            void showAlert("Disconnected. Your Supabase project was not deleted.", "Database");
        }, [showAlert, showConfirm, user?.uid]);

        const openDatabaseConnect = useCallback(async () => {
            if (!user?.uid) {
                void showAlert("Please sign in to connect a database.", "Database");
                return;
            }

            if (supabaseConnected) {
                // Re-verify before claiming connected/opening external links.
                // If the Supabase project was deleted, this will flip the UI to disconnected.
                // (silent=false so the user gets a clear message.)
                const stillConnected = await verifySupabaseConnection({ silent: false });
                if (!stillConnected) return;
                const label = supabaseProjectName ? `Supabase is connected ("${supabaseProjectName}").` : "Supabase is connected.";
                const confirmed = await showConfirm(
                    `${label}\n\nOpen the Supabase dashboard in a new tab?`,
                    "Database",
                );
                if (confirmed) {
                    const ref = (supabaseProjectRef || "").trim();
                    if (ref) {
                        window.open(`https://supabase.com/dashboard/project/${encodeURIComponent(ref)}`, "_blank", "noopener,noreferrer");
                    } else {
                        window.open("https://supabase.com/dashboard", "_blank", "noopener,noreferrer");
                    }
                    return;
                }

                setViewMode("ai");
                window.dispatchEvent(new CustomEvent("kloner:open-db-connect", { detail: { provider: "supabase" } }));
            }
        }, [showAlert, showConfirm, supabaseConnected, supabaseProjectName, supabaseProjectRef, user?.uid, verifySupabaseConnection]);

    const hasInitialAppData = Boolean(initialAppData && initialAppData.id === appId);
    const [app, setApp] = useState<AppData | null>(() => (hasInitialAppData ? initialAppData : null));
    const projectFramework = useMemo(() => detectProjectFramework(app?.files || null), [app?.files]);
    const [loading, setLoading] = useState(() => !hasInitialAppData);
    const [filesHydrated, setFilesHydrated] = useState(() => hasInitialAppData);
    const [isPreviewBootReady, setIsPreviewBootReady] = useState(false);
    const [filesHydrationProgress, setFilesHydrationProgress] = useState(0);
    const [filesHydrationCompletionHold, setFilesHydrationCompletionHold] = useState(false);
    const [isFilesHydrationActive, setIsFilesHydrationActive] = useState(false);
    const filesHydrationRunIdRef = useRef(0);
    const filesHydrationInFlightRef = useRef<Promise<AppData | null> | null>(null);
    const filesHydrationActiveCountRef = useRef(0);
    const filesHydrationCompletionTimerRef = useRef<number | null>(null);
    const [previewHydrationLoaderMounted, setPreviewHydrationLoaderMounted] = useState(true);
    const [previewHydrationLoaderVisible, setPreviewHydrationLoaderVisible] = useState(false);
    const previewHydrationLoaderHideTimerRef = useRef<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const buildFileTree = useCallback((files: AppData["files"]) => {
        const tree: FileNode[] = [];
        const paths = Object.keys(files);

        paths.forEach((path) => {
            const parts = path.split("/");
            let current = tree;

            parts.forEach((part, index) => {
                let node = current.find((n) => n.name === part);
                if (!node) {
                    node = {
                        name: part,
                        type: index === parts.length - 1 ? "file" : "folder",
                        children: index === parts.length - 1 ? undefined : [],
                    };
                    current.push(node);
                }
                if (node.children) current = node.children;
            });
        });

        setFileTree(tree);
    }, []);

    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    const sessionExpiredRedirectingRef = useRef(false);
    const handleSessionExpired = useCallback(async (source?: string) => {
        if (sessionExpiredRedirectingRef.current) return;
        sessionExpiredRedirectingRef.current = true;
        try {
            console.warn("[auth] app builder session expired", source || "unknown");
            resetAuthClientCaches();
            await firebaseSignOut(auth).catch(() => null);
        } finally {
            const nextPath =
                typeof window !== "undefined"
                    ? `${window.location.pathname}${window.location.search}`
                    : "/dashboard/view";
            if (typeof window !== "undefined") {
                window.location.assign(`/login?reason=session_expired&next=${encodeURIComponent(nextPath)}`);
            }
        }
    }, []);

    const clearFilesHydrationTimer = useCallback(() => {
        // Intentionally left as a stable cleanup hook.
        // The loader now uses actual request and file hydration progress directly.
    }, []);

    const clearFilesHydrationCompletionTimer = useCallback(() => {
        if (filesHydrationCompletionTimerRef.current !== null) {
            window.clearTimeout(filesHydrationCompletionTimerRef.current);
            filesHydrationCompletionTimerRef.current = null;
        }
    }, []);

    const clearPreviewHydrationLoaderHideTimer = useCallback(() => {
        if (previewHydrationLoaderHideTimerRef.current !== null) {
            window.clearTimeout(previewHydrationLoaderHideTimerRef.current);
            previewHydrationLoaderHideTimerRef.current = null;
        }
    }, []);

    const beginFilesHydrationActivity = useCallback(() => {
        filesHydrationActiveCountRef.current += 1;
        setIsFilesHydrationActive(true);
    }, []);

    const endFilesHydrationActivity = useCallback(() => {
        filesHydrationActiveCountRef.current = Math.max(0, filesHydrationActiveCountRef.current - 1);
        if (filesHydrationActiveCountRef.current === 0) {
            setIsFilesHydrationActive(false);
        }
    }, []);

    const advanceFilesHydrationProgress = useCallback((nextProgress: number) => {
        setFilesHydrationProgress((prev) => Math.max(prev || 0, Math.max(0, Math.min(100, Math.round(nextProgress)))));
    }, []);

    const fetchAndHydrateAppFiles = useCallback(
        async (opts?: { forceRefreshToken?: boolean; signal?: AbortSignal | null }): Promise<AppData | null> => {
            if (filesHydrationInFlightRef.current) {
                return filesHydrationInFlightRef.current;
            }

            if (!user?.uid) {
                await handleSessionExpired("app_builder_missing_user");
                return null;
            }

            const forceRefreshToken = Boolean(opts?.forceRefreshToken);
            const runPromise = (async () => {
                beginFilesHydrationActivity();
                try {
                    const runId = ++filesHydrationRunIdRef.current;
                    setFilesHydrationProgress(1);
                    advanceFilesHydrationProgress(6);
                    await bootstrapServerSession({
                        forceRefresh: forceRefreshToken,
                        minIntervalMs: forceRefreshToken ? 0 : 10 * 60 * 1000,
                        timeoutMs: 12_000,
                        reason: "app_builder_load",
                    }).catch(() => false);
                    advanceFilesHydrationProgress(14);

                    const authHeaders = await getOptionalAuthHeaders(forceRefreshToken);
                    advanceFilesHydrationProgress(20);
                    let attempt = 0;
                    let delayMs = 500;
                    const maxAttempts = 24;
                    let lastNotFound: { status: number; message: string } | null = null;

                    while (attempt < maxAttempts && runId === filesHydrationRunIdRef.current) {
                        attempt += 1;
                        const res = await fetch(`/api/app-builder/${appId}/files`, {
                            method: "GET",
                            credentials: "include",
                            cache: "no-store",
                            signal: opts?.signal || undefined,
                            headers: authHeaders,
                        });
                        advanceFilesHydrationProgress(48);

                        if (res.status === 401 || res.status === 403) {
                            await handleSessionExpired("app_builder_load_unauthorized");
                            return null;
                        }

                        const data = await (async () => {
                            try {
                                return await res.json();
                            } catch {
                                return null;
                            }
                        })();

                        if (res.status === 200) {
                            advanceFilesHydrationProgress(62);
                            if (runId !== filesHydrationRunIdRef.current) return null;
                            clearFilesHydrationTimer();
                            const hydratedData = await hydrateHtmlFilesForApp(data as AppData, {
                                onProgress: (progress) => {
                                    setFilesHydrationProgress(Math.max(0, Math.min(100, Math.round(62 + (progress * 0.38)))));
                                },
                            });
                            return hydratedData;
                        }

                        if (res.status === 422) {
                            throw new Error(String(data?.error || data?.message || data?.detail || "This app is not ready yet."));
                        }

                        if (res.status === 404 || res.status === 202 || res.status === 409) {
                            lastNotFound = {
                                status: res.status,
                                message: String(data?.error || data?.message || "This app is still syncing its files."),
                            };
                            await sleep(Math.min(5000, delayMs));
                            delayMs = Math.min(5000, Math.max(500, Math.floor(delayMs * 1.35)));
                            continue;
                        }

                        if (!res.ok) {
                            throw new Error(`Failed to load app: ${res.status} ${res.statusText}`);
                        }
                    }

                    if (lastNotFound) {
                        console.warn("App files are still syncing while hydrating editor", {
                            appId,
                            status: lastNotFound.status,
                        });
                        return null;
                    }

                    return null;
                } finally {
                    endFilesHydrationActivity();
                }
            })();

            filesHydrationInFlightRef.current = runPromise;
            try {
                return await runPromise;
            } finally {
                if (filesHydrationInFlightRef.current === runPromise) {
                    filesHydrationInFlightRef.current = null;
                }
            }
        },
        [advanceFilesHydrationProgress, appId, beginFilesHydrationActivity, clearFilesHydrationTimer, endFilesHydrationActivity, handleSessionExpired, user],
    );

    const [currentFile, setCurrentFile] = useState<string | null>(null);
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
    const [codeFileSearch, setCodeFileSearch] = useState("");
    const [code, setCode] = useState<string>("");
    const [refreshKey, setRefreshKey] = useState(0);
    const [applyCompleteKey, setApplyCompleteKey] = useState(0);
    const [localRestartKey, setLocalRestartKey] = useState(0);
    const [reconnectKey, setReconnectKey] = useState(0);
    const [isWebPreviewReady, setIsWebPreviewReady] = useState(false);
    const [isWebPreviewReadyLatched, setIsWebPreviewReadyLatched] = useState(false);
    const [dismissedGenerationError, setDismissedGenerationError] = useState(false);
    const [agentCreditError, setAgentCreditError] = useState<string | null>(null);
    const [builderTourStartToken, setBuilderTourStartToken] = useState(0);
    const lastConsumedAiCreditRequestIdRef = useRef<string | null>(null);
    const [forceFreshStart, setForceFreshStart] = useState(false);
    const forceFreshStartRef = useRef(false);
    const forceFreshStartKey = useRef(0);
    const [viewMode, setViewMode] = useState<LeftViewMode>(initialViewMode || "ai"); // Default to AI chat unless dashboard opens in preview first
    const [isModeSwitching, setIsModeSwitching] = useState(false);
    const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
    const stagedImagesRef = useRef<StagedImage[]>([]);
    const stagedImageApplyInFlightRef = useRef<string | null>(null);
    const [autoCompressImages, setAutoCompressImages] = useState(true);
    const isVercelConnectedRef = useRef(false);
    const ensureFreshVercelConnectionRef = useRef<
        ((flow: "preview" | "images" | "share") => Promise<boolean>) | null
    >(null);
    const [lastImageInsert, setLastImageInsert] = useState<LastImageInsert | null>(null);
    const [imagePromptPlaceholderIdx, setImagePromptPlaceholderIdx] = useState(0);
    const [isMobile, setIsMobile] = useState(false);
    const [mobileTab, setMobileTab] = useState<"app" | "prompt">("app");
    const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
    const [tabletControlsOpen, setTabletControlsOpen] = useState(false);
    const [topupModalTrigger, setTopupModalTrigger] = useState(0);
    const [desktopOnlyToast, setDesktopOnlyToast] = useState(false);
    const desktopOnlyToastTimerRef = useRef<number | null>(null);
    const tabletControlsRef = useRef<HTMLDivElement | null>(null);
    const showDesktopOnlyToast = () => {
        setDesktopOnlyToast(true);
        if (desktopOnlyToastTimerRef.current) window.clearTimeout(desktopOnlyToastTimerRef.current);
        desktopOnlyToastTimerRef.current = window.setTimeout(() => setDesktopOnlyToast(false), 2800);
    };
    useEffect(() => {
        if (!isMobile) return;
        if (viewMode === "ai") return;
        setViewMode("ai");
    }, [isMobile, viewMode]);
    const [isRenaming, setIsRenaming] = useState(false);
    const [isRenameSaving, setIsRenameSaving] = useState(false);
    const [tempName, setTempName] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isDeploying, setIsDeploying] = useState(false);
    const [isSharingPreview, setIsSharingPreview] = useState(false);
    const [isPreviewBuilding, setIsPreviewBuilding] = useState(false);
    const [isCustomSidebarOpen, setIsCustomSidebarOpen] = useState(true);
    const [customPreviewScale, setCustomPreviewScale] = useState<number>(() => {
        if (typeof window === "undefined") return 0.6;
        const v = Number(localStorage.getItem("kloner:uiScale"));
        return Number.isFinite(v) && v >= 0.5 && v <= 1.25 ? v : getResponsiveUiScale(window.innerWidth);
    });
    const [previewPagePath, setPreviewPagePath] = useState<string | null>(null);
    const [previewNavigateToken, setPreviewNavigateToken] = useState(0);
    const [isPageDropdownOpen, setIsPageDropdownOpen] = useState(false);
    const pageDropdownRef = useRef<HTMLDivElement | null>(null);
    const previewHydrationAnchorRef = useRef<HTMLDivElement | null>(null);
    const [previewHydrationAnchorRect, setPreviewHydrationAnchorRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
    const previewEditorFlushRef = useRef<null | (() => Promise<boolean>)>(null);
    const lastVisualEditedHtmlPathRef = useRef<string | null>(null);
    const [debugHydrationLoaderOpen, setDebugHydrationLoaderOpen] = useState(false);
    const debugHydrationLoaderTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!tabletControlsOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (tabletControlsRef.current?.contains(event.target as Node)) return;
            setTabletControlsOpen(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setTabletControlsOpen(false);
        };

        window.addEventListener("pointerdown", handlePointerDown);
        window.addEventListener("keydown", handleKeyDown);

        return () => {
        window.removeEventListener("pointerdown", handlePointerDown);
        window.removeEventListener("keydown", handleKeyDown);
        };
    }, [tabletControlsOpen]);

    useEffect(() => {
        const handleDebugShowLoader = (event: Event) => {
            if (!(event instanceof CustomEvent)) return;
            setDebugHydrationLoaderOpen(true);
            if (debugHydrationLoaderTimerRef.current !== null) {
                window.clearTimeout(debugHydrationLoaderTimerRef.current);
            }
            const durationMs = Math.max(400, Number(event.detail?.durationMs ?? 2200));
            debugHydrationLoaderTimerRef.current = window.setTimeout(() => {
                setDebugHydrationLoaderOpen(false);
                debugHydrationLoaderTimerRef.current = null;
            }, durationMs);
        };

        window.addEventListener("kloner:debug-show-loader", handleDebugShowLoader as EventListener);
        return () => {
            window.removeEventListener("kloner:debug-show-loader", handleDebugShowLoader as EventListener);
            if (debugHydrationLoaderTimerRef.current !== null) {
                window.clearTimeout(debugHydrationLoaderTimerRef.current);
                debugHydrationLoaderTimerRef.current = null;
            }
        };
    }, []);

    const applyPreviewChangesNowRef = useRef<null | ((changes: Array<{ path: string; content: string }>, opts: { interactive: boolean; source?: string }) => Promise<void>)>(null);
    const isDev = process.env.NODE_ENV !== "production";
    const isVisualEditorMode = viewMode === "custom" || viewMode === "images";
    const filteredCodeFileTree = useMemo(() => filterFileTree(fileTree, codeFileSearch), [codeFileSearch, fileTree]);
    const codeFileSearchActive = Boolean(codeFileSearch.trim());
    const viewModeTabBaseClass =
        "relative inline-flex flex-shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-[1.15rem] border px-3 sm:px-4 py-2 text-xs font-semibold transition-all duration-200";
    const viewModeTabIdleClass =
        "border-neutral-200 bg-white/85 text-gray-700 shadow-[0_1px_0_rgba(255,255,255,0.75)] hover:-translate-y-0.5 hover:border-neutral-300 hover:bg-white";
    const viewModeTabActiveClass =
        "border-[#FF8D21]/20 bg-[#FF8D21] text-white shadow-[0_14px_28px_rgba(255,141,33,0.24)]";
    const canUsePremiumImagesTab = userTier === "pro" || userTier === "agency";
    const shouldLockImagesTab = !authLoading && !canUsePremiumImagesTab;

    useEffect(() => {
        if (typeof window === "undefined") return;
        localStorage.setItem("kloner:uiScale", String(customPreviewScale));
    }, [customPreviewScale]);

    useEffect(() => {
        if (!appId) return;
        setBuilderTourStartToken((token) => token + 1);
    }, [appId]);

    const handleTakeBuilderTour = useCallback(() => {
        try {
            window.sessionStorage?.removeItem(BUILDER_TOUR_STORAGE_KEY);
            window.localStorage?.removeItem(BUILDER_TOUR_STORAGE_KEY);
        } catch {
            // ignore storage failures
        }
        setBuilderTourStartToken((token) => token + 1);
    }, []);

    const openDeployUpgradePaywall = useCallback(() => {
        setUpgradePaywallCopy(DEPLOY_UPGRADE_PAYWALL_COPY);
        setShowDeployUpgradePaywall(true);
    }, []);

    const openFreePlanUpgradePaywall = useCallback(() => {
        setUpgradePaywallCopy(FREE_PLAN_UPGRADE_PAYWALL_COPY);
        setShowDeployUpgradePaywall(true);
    }, []);

    const pageOptions = useMemo(() => {
        const seen = new Set<string>();
        return Object.keys(app?.files || {})
            .filter((path) => isPageFile(path))
            .map((path) => ({
                path,
                route: pageFileToPreviewPath(path),
                label: humanizePageLabel(path),
            }))
            .filter((page) => {
                if (!page.route) return false;
                if (seen.has(page.route)) return false;
                seen.add(page.route);
                return true;
            })
            .sort((left, right) => left.label.localeCompare(right.label) || left.route.localeCompare(right.route));
    }, [app?.files]);
    const preferredPagePath = useMemo(
        () => pageOptions.find((page) => page.route === "/")?.path ?? pageOptions[0]?.path ?? null,
        [pageOptions],
    );
            const hasPageDropdown = pageOptions.length > 1;

    useEffect(() => {
        if (viewMode === "code") return;
        if (currentFile && pageOptions.some((page) => page.path === currentFile)) {
            setPreviewPagePath(currentFile);
            return;
        }

        setPreviewPagePath((prev) => {
            if (prev && pageOptions.some((page) => page.path === prev)) return prev;
            return preferredPagePath;
        });
    }, [currentFile, pageOptions, preferredPagePath, viewMode]);

    useEffect(() => {
        if (hasPageDropdown) return;
        setIsPageDropdownOpen(false);
    }, [hasPageDropdown]);

    useEffect(() => {
        if (currentFile) return;
        if (!previewPagePath) return;
        const matched = pageOptions.find((page) => page.path === previewPagePath);
        if (!matched) return;
        const content = app?.files?.[matched.path]?.content;
        if (typeof content !== "string") return;
        setCurrentFile(matched.path);
        setCode(content);
    }, [app?.files, currentFile, pageOptions, previewPagePath]);

    const selectedPreviewPage = useMemo(
        () => pageOptions.find((page) => page.path === previewPagePath) || null,
        [pageOptions, previewPagePath],
    );
    const aiCurrentFile = selectedPreviewPage?.path || null;
    const aiSearchCurrentFileLabel = aiCurrentFile || "(none)";
    const previewNavigatePath = selectedPreviewPage?.route || null;
    const selectedPageLabel = useMemo(() => {
        const route = String(selectedPreviewPage?.route || "").trim();
        if (!route || route === "/") return "home";
        return route.replace(/^\//, "").toLowerCase();
    }, [selectedPreviewPage?.route]);
    const pageDropdownLabel = useMemo(() => {
        if (selectedPageLabel) return selectedPageLabel;
        if (currentFile) return String(currentFile.replace(/^src\//, "")).toLowerCase();
        return "page";
    }, [currentFile, selectedPageLabel]);

    useEffect(() => {
        if (!isPageDropdownOpen) return;

        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (pageDropdownRef.current && target && !pageDropdownRef.current.contains(target)) {
                setIsPageDropdownOpen(false);
            }
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsPageDropdownOpen(false);
            }
        };

        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);

        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [isPageDropdownOpen]);

    useEffect(() => {
        if (IS_PRODUCTION && viewMode === "code") {
            setViewMode("ai");
        }
    }, [viewMode]);

    const requestViewModeChange = useCallback(async (nextMode: LeftViewMode) => {
        // Prevent multiple simultaneous mode switches
        if (isModeSwitching) return;
        
        const leavingVisual = (viewMode === "custom" || viewMode === "images") && !(nextMode === "custom" || nextMode === "images");
        const enteringVisual = !(viewMode === "custom" || viewMode === "images") && (nextMode === "custom" || nextMode === "images");
        const builderHasChanges = Boolean(getHasUnsavedChangesRef.current?.());
        
        setIsModeSwitching(true);
        
        try {
            if (leavingVisual) {
                let previewHadChanges = false;
                if (previewEditorFlushRef.current) {
                    try {
                        previewHadChanges = await previewEditorFlushRef.current();
                    } catch (err) {
                        console.error("[app-builder] pre-switch preview flush failed", err);
                        await showAlert("Could not sync your latest visual edits. Please save again and retry.", "Sync failed");
                        return;
                    }
                }

                if (!previewHadChanges && !builderHasChanges) {
                    return;
                }

                try {
                    const synced = await fetchAndHydrateAppFiles({ forceRefreshToken: true });
                    if (synced?.files) {
                        setApp(synced);
                        buildFileTree(synced.files);

                        const preferredEditedPath = String(lastVisualEditedHtmlPathRef.current || "").trim();
                        const resolvedEditedPath = preferredEditedPath
                            ? canonicalizeEditPath(preferredEditedPath, synced.files as any)
                            : "";
                        const targetPath =
                            resolvedEditedPath && (synced.files as any)?.[resolvedEditedPath]
                                ? resolvedEditedPath
                                : (currentFileRef.current && (synced.files as any)?.[currentFileRef.current]
                                    ? currentFileRef.current
                                    : "");

                        if (targetPath) {
                            setPreviewPagePath(targetPath);
                            if (currentFileRef.current !== targetPath) setCurrentFile(targetPath);
                            const nextContent = (synced.files as any)?.[targetPath]?.content;
                            if (typeof nextContent === "string") {
                                setCode(nextContent);

                                // Force a real file write to the running machine and wait for it
                                // before reconnecting, so refresh happens after apply completes.
                                await applyPreviewChangesNowRef.current?.([{ path: targetPath, content: nextContent }], {
                                    interactive: false,
                                });
                            }
                        }

                        // Ensure Builder preview reflects visual edits immediately
                        // after switching out of visual mode.
                        setPreviewMode("webcontainer");
                        setReconnectKey((k) => k + 1);
                        setRefreshKey((k) => k + 1);
                    }
                } catch (rehydrateErr) {
                    console.error("[app-builder] post-flush rehydrate failed", rehydrateErr);
                    await showAlert("Your latest edits were saved, but reload from source failed. Please retry.", "Sync warning");
                    return;
                }
            }
            
            // When entering visual mode, rehydrate BEFORE changing mode so preview gets latest files
            if (enteringVisual && builderHasChanges) {
                try {
                    const synced = await fetchAndHydrateAppFiles({ forceRefreshToken: true });
                    if (synced?.files) {
                        setApp(synced);
                        buildFileTree(synced.files);
                        // Trigger preview refresh to reflect any changes made in builder while in preview
                        // This ensures the machine/iframe preview reflects the latest file content
                        setReconnectKey((k) => k + 1);
                    }
                } catch (err) {
                    console.warn("[app-builder] pre-visual-enter rehydrate failed", err);
                    // Don't block mode switch on this, just warn
                }
            }
        } finally {
            // Change mode AFTER rehydration completes
            setViewMode(nextMode);
            setIsModeSwitching(false);
        }
    }, [buildFileTree, fetchAndHydrateAppFiles, showAlert, viewMode, isModeSwitching]);

    const [previewError, setPreviewError] = useState<string | null>(null);
    const [protectedPreviewUrl, setProtectedPreviewUrl] = useState<string | null>(null);
    const [vercelSecuritySettingsUrl, setVercelSecuritySettingsUrl] = useState<string | null>(null);
    const [vercelDeploymentProtectionSettingsUrl, setVercelDeploymentProtectionSettingsUrl] = useState<string | null>(null);
    const [vercelProtectionBypassDraft, setVercelProtectionBypassDraft] = useState<string>("");
    const [savingVercelProtectionBypass, setSavingVercelProtectionBypass] = useState(false);
    const [enablingVercelProtectionBypass, setEnablingVercelProtectionBypass] = useState(false);
    const [autoPreviewPhase, setAutoPreviewPhase] = useState<AutoPreviewPhase>("idle");
    const [autoPreviewError, setAutoPreviewError] = useState<string | null>(null);
    const [previewIssue, setPreviewIssue] = useState<string | null>(null);
    const [previewIssueDiagnostics, setPreviewIssueDiagnostics] = useState<string | null>(null);
    const [previewIssueFailure, setPreviewIssueFailure] = useState<PreviewFailureContract | null>(null);
    const [previewIssueActionLabel, setPreviewIssueActionLabel] = useState<string | null>(null);
    const [deployBannerFromApp, setDeployBannerFromApp] = useState<DeployStatusBanner | null>(null);
    const [deployBannerFromRoute, setDeployBannerFromRoute] = useState<DeployStatusBanner | null>(null);
    const [dismissedDeployBannerFingerprint, setDismissedDeployBannerFingerprint] = useState<string | null>(null);
    const [showDeployUpgradePaywall, setShowDeployUpgradePaywall] = useState(false);
    const [upgradePaywallCopy, setUpgradePaywallCopy] = useState<UpgradePaywallCopy>(DEPLOY_UPGRADE_PAYWALL_COPY);
    const [autoPreviewAttempt, setAutoPreviewAttempt] = useState<number>(0);
    const [autoPreviewBypassUnsupported, setAutoPreviewBypassUnsupported] = useState(false);
    const [previewMode, setPreviewMode] = useState<PreviewMode>("webcontainer");
    const [previewOpenToken, setPreviewOpenToken] = useState(0);
    const [vercelConnectOpen, setVercelConnectOpen] = useState(false);
    const [vercelConnectOpening, setVercelConnectOpening] = useState(false);
    const [vercelConnectFlow, setVercelConnectFlow] = useState<VercelOAuthFlow>("preview");
    const [generationEver, setGenerationEver] = useState(false);
    const previewIssueFixRequestCooldownRef = useRef<{ fingerprint: string; until: number } | null>(null);
    const appBuilderSessionStartedAtRef = useRef<number>(Date.now());
    const appBuilderAiMessagesSentRef = useRef<number>(0);
    const appBuilderViewSwitchesRef = useRef<number>(0);
    const previousViewModeRef = useRef<LeftViewMode>("ai");
    const [hasCompletedBuilderTour, setHasCompletedBuilderTour] = useState(false);
    const shouldRunBuilderTour = isDev && !isVisualEditorMode && showTour;
    const shouldLockBuilderEditor = accessLocked || userTier === "free";
    const showAccessPaywall =
        shouldLockBuilderEditor &&
        !authLoading &&
        (!shouldRunBuilderTour || hasCompletedBuilderTour);
    const previousVisualEditorModeRef = useRef<boolean | null>(null);
    const pendingShareResumeRef = useRef(false);
    const previewActionThrottleRef = useRef<{ refreshAt: number; rebuildAt: number; saveAt: number }>({
        refreshAt: 0,
        rebuildAt: 0,
        saveAt: 0,
    });
    const previewIssueFixDecision = useMemo(
        () => getPreviewIssueFixDecision(previewIssue || autoPreviewError || previewError, previewIssueDiagnostics, previewIssueFailure),
        [autoPreviewError, previewError, previewIssue, previewIssueDiagnostics, previewIssueFailure],
    );
    const canFixPreviewIssueWithAi = previewIssueFixDecision.eligible;

    useEffect(() => {
        const wasVisual = previousVisualEditorModeRef.current;
        if (isVisualEditorMode && !wasVisual) {
            setPreviewOpenToken((token) => token + 1);
        }
        previousVisualEditorModeRef.current = isVisualEditorMode;
    }, [isVisualEditorMode]);

    useEffect(() => {
        const shouldShowLoader =
            previewMode === "webcontainer" &&
            (debugHydrationLoaderOpen ||
                (!isPreviewBootReady && viewMode !== "custom" && viewMode !== "images") ||
                filesHydrationCompletionHold);

        if (!shouldShowLoader) {
            clearFilesHydrationCompletionTimer();
            clearPreviewHydrationLoaderHideTimer();
            setPreviewHydrationLoaderVisible(false);
            previewHydrationLoaderHideTimerRef.current = window.setTimeout(() => {
                setPreviewHydrationLoaderMounted(false);
                previewHydrationLoaderHideTimerRef.current = null;
            }, 240);
            return;
        }

        clearFilesHydrationTimer();
        clearFilesHydrationCompletionTimer();
        clearPreviewHydrationLoaderHideTimer();
        setPreviewHydrationLoaderMounted(true);
        requestAnimationFrame(() => setPreviewHydrationLoaderVisible(true));
        if (isPreviewBootReady) {
            setFilesHydrationProgress(100);
            setFilesHydrationCompletionHold(true);
            filesHydrationCompletionTimerRef.current = window.setTimeout(() => {
                setFilesHydrationCompletionHold(false);
                filesHydrationCompletionTimerRef.current = null;
            }, 450);
        }
    }, [
        clearFilesHydrationCompletionTimer,
        clearPreviewHydrationLoaderHideTimer,
        clearFilesHydrationTimer,
        isPreviewBootReady,
        filesHydrationCompletionHold,
        previewMode,
        viewMode,
        debugHydrationLoaderOpen,
    ]);

    useEffect(
        () => () => {
            clearFilesHydrationTimer();
            clearFilesHydrationCompletionTimer();
            clearPreviewHydrationLoaderHideTimer();
        },
        [clearFilesHydrationCompletionTimer, clearFilesHydrationTimer, clearPreviewHydrationLoaderHideTimer],
    );

    const shouldShowPreviewHydrationLoader =
        previewMode === "webcontainer" &&
        (previewHydrationLoaderMounted || filesHydrationCompletionHold) &&
        !showAccessPaywall &&
        (debugHydrationLoaderOpen || (viewMode !== "custom" && viewMode !== "images"));
    const previewHydrationLoader = shouldShowPreviewHydrationLoader && typeof window !== "undefined"
        ? createPortal(
            isMobile || !previewHydrationAnchorRect ? (
                <div
                    className={`fixed inset-0 z-[22050] flex items-center justify-center px-4 transition-opacity duration-300 ease-out ${previewHydrationLoaderVisible ? "opacity-100" : "opacity-0"}`}
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                >
                    <div className="flex flex-col items-center justify-center text-center">
                        <div className="kloner-dots" aria-hidden="true">
                            <span className="kloner-dot" />
                            <span className="kloner-dot" />
                            <span className="kloner-dot" />
                        </div>
                        <div className="mt-4 text-sm font-medium text-neutral-700">
                            Hydrating files
                        </div>
                    </div>
                </div>
            ) : (
                <div
                    className={`fixed z-[22050] flex items-center justify-center px-4 transition-opacity duration-300 ease-out ${previewHydrationLoaderVisible ? "opacity-100" : "opacity-0"}`}
                    style={{
                        top: previewHydrationAnchorRect.top,
                        left: previewHydrationAnchorRect.left,
                        width: previewHydrationAnchorRect.width,
                        height: previewHydrationAnchorRect.height,
                    }}
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                >
                    <div className="flex flex-col items-center justify-center text-center">
                        <div className="kloner-dots" aria-hidden="true">
                            <span className="kloner-dot" />
                            <span className="kloner-dot" />
                            <span className="kloner-dot" />
                        </div>
                        <div className="mt-4 text-sm font-medium text-neutral-700">
                            Hydrating files
                        </div>
                    </div>
                </div>
            ),
            document.body,
        )
        : null;

    useEffect(() => {
        if (!shouldShowPreviewHydrationLoader) {
            setPreviewHydrationAnchorRect(null);
            return;
        }

        const measure = () => {
            const el = previewHydrationAnchorRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            setPreviewHydrationAnchorRect({
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
            });
        };

        measure();

        const handleChange = () => measure();
        window.addEventListener("resize", handleChange);
        window.addEventListener("scroll", handleChange, true);

        const observer = typeof ResizeObserver !== "undefined" && previewHydrationAnchorRef.current
            ? new ResizeObserver(() => measure())
            : null;
        if (observer && previewHydrationAnchorRef.current) {
            observer.observe(previewHydrationAnchorRef.current);
        }

        return () => {
            window.removeEventListener("resize", handleChange);
            window.removeEventListener("scroll", handleChange, true);
            observer?.disconnect();
        };
    }, [shouldShowPreviewHydrationLoader, previewMode, isPreviewBootReady, isWebPreviewReady, showAccessPaywall]);

    const handlePreviewRouteChange = useCallback((nextPath: string | null) => {
        const raw = String(nextPath || "").trim();
        if (!raw) return;

        const matched = pageOptions.find((page) => page.route === raw) || null;
        if (!matched) return;

        setPreviewPagePath((current) => {
            if (current === matched.path) return current;
            return matched.path;
        });
    }, [pageOptions]);

    const buildCurrentVercelOAuthReturnPath = useCallback((): string => {
        if (typeof window === "undefined") return "/dashboard/view";

        const url = new URL(window.location.href);
        url.searchParams.delete("vercel");
        url.searchParams.delete("vercelShare");
        return `${url.pathname}${url.search}${url.hash}` || "/dashboard/view";
    }, []);

    const persistPendingVercelShareFlow = useCallback((returnTo: string) => {
        if (typeof window === "undefined") return;

        try {
            window.localStorage.setItem(
                APP_BUILDER_PENDING_SHARE_KEY,
                JSON.stringify({ appId, returnTo, startedAt: Date.now() }),
            );
        } catch {
            // ignore
        }
    }, [appId]);

    const handleCompileErrorFixRequest = useCallback((payload: {
        appId: string;
        code: string;
        actionType: "quick_fix_compile";
        fixAction?: string;
        autoSend?: boolean;
        metadata?: {
            requestedAssets?: string[];
            missingAssets?: string[];
            availableAssets?: string[];
        };
        compileError: {
            summary: string;
            detail: string;
            fingerprint: string;
        };
    }) => {
        setViewMode("ai");
        if (isMobile) setMobileTab("prompt");
        if (typeof window === "undefined") return;
        try {
            window.dispatchEvent(new CustomEvent("kloner:compile-error-fix-request", { detail: payload }));
        } catch {
            // ignore
        }
    }, [isMobile]);

    const handlePreviewIssueFixRequest = useCallback(() => {
        if (!canFixPreviewIssueWithAi) return;
        const issue = String(previewIssue || autoPreviewError || previewError || "").trim();
        if (!issue) return;

        const fingerprint = `preview_issue:${appId}:${issue.slice(0, 120)}`;
        const now = Date.now();
        const cooldown = previewIssueFixRequestCooldownRef.current;
        const cooldownMs = 5_000;
        if (cooldown && cooldown.fingerprint === fingerprint && now < cooldown.until) return;
        previewIssueFixRequestCooldownRef.current = { fingerprint, until: now + cooldownMs };

        const fileCount = Object.keys(app?.files || {}).length;
        const hasPath = (pattern: RegExp): boolean => Object.keys(app?.files || {}).some((path) => pattern.test(path));
        const bundleSignals = {
            fileCount,
            hasPackageJson: Boolean(app?.files?.["package.json"]),
            hasServerJs: hasPath(/^server\.(js|ts)$/i),
            hasServerMjs: hasPath(/^server\.mjs$/i),
            hasNextConfig: hasPath(/^next\.config\.(mjs|js|ts|cjs)$/i),
            hasAppPage: hasPath(/^(?:src\/)?app\/page\.(tsx|ts|jsx|js|mdx?)$/i),
            hasAppLayout: hasPath(/^(?:src\/)?app\/layout\.(tsx|ts|jsx|js|mdx?)$/i),
            hasPagesDir: hasPath(/^(?:src\/)?pages\//i),
            hasAnyPublicContent: hasPath(/^public\//i),
            hasPublicHtmlContent: hasPath(/^public\/.+\/index\.html?$/i) || hasPath(/^public\/index\.html?$/i),
            hasNextShape: Boolean(projectFramework.key === "nextjs"),
            hasHtmlServerShape: Boolean(projectFramework.key === "html-js" || hasPath(/^index\.html?$/i) || hasPath(/^server\.(js|ts)$/i)),
            hasBuildArtifacts: hasPath(/^\.next\//i) || hasPath(/^dist\//i) || hasPath(/^build\//i),
        };

        const missingFiles: string[] = [];
        if (projectFramework.key === "nextjs") {
            if (!bundleSignals.hasNextConfig) missingFiles.push("next.config.mjs|next.config.js");
            if (!bundleSignals.hasAppPage) missingFiles.push("app/page.js|app/page.tsx");
            if (!bundleSignals.hasAppLayout) missingFiles.push("app/layout.js|app/layout.tsx");
        } else if (projectFramework.key === "html-js") {
            if (!bundleSignals.hasPublicHtmlContent && !hasPath(/^index\.html?$/i)) missingFiles.push("index.html");
        }

        const hiddenDiagnostics = {
            detectedFramework: projectFramework.key,
            frameworkLabel: projectFramework.label,
            frameworkConfidence: projectFramework.confidence,
            frameworkReason: projectFramework.reason,
            bundleSignals,
            missingFiles,
            missingFileCount: missingFiles.length,
            previewIssueDiagnostics: safeParseDiagnostics(previewIssueDiagnostics),
            previewIssueFixDecision,
        };

        handleCompileErrorFixRequest({
            appId,
            code: "preview_issue",
            actionType: "quick_fix_compile",
            fixAction: "preview_issue_fix",
            autoSend: true,
            compileError: {
                summary: "Preview hit an error",
                detail: `${issue}${previewIssueDiagnostics ? `\n\nHidden diagnostics:\n${JSON.stringify(hiddenDiagnostics, null, 2)}` : ""}`,
                fingerprint,
            },
        });
    }, [appId, app?.files, autoPreviewError, canFixPreviewIssueWithAi, handleCompileErrorFixRequest, previewError, previewIssue, previewIssueDiagnostics, previewIssueFixDecision, projectFramework]);

    const effectiveDeployBanner = deployBannerFromRoute || deployBannerFromApp;

    useEffect(() => {
        if (deployBannerFromApp?.kind !== "error") return;
        setDeployBannerFromRoute((current) => (current?.kind === "success" ? null : current));
    }, [deployBannerFromApp]);

    const handleDeployBannerFixRequest = useCallback(() => {
        if (!effectiveDeployBanner || effectiveDeployBanner.kind !== "error") return;

        if (effectiveDeployBanner.fixAction === "connect_vercel") {
            void ensureFreshVercelConnectionRef.current?.("preview");
            return;
        }

        handleCompileErrorFixRequest({
            appId,
            code: "deploy_issue",
            actionType: "quick_fix_compile",
            fixAction: effectiveDeployBanner.fixAction || "deploy_issue_fix",
            autoSend: true,
            compileError: {
                summary: effectiveDeployBanner.title,
                detail: effectiveDeployBanner.detail,
                fingerprint: effectiveDeployBanner.fingerprint,
            },
        });
    }, [appId, effectiveDeployBanner, handleCompileErrorFixRequest]);

    useEffect(() => {
        if (!effectiveDeployBanner) {
            setDismissedDeployBannerFingerprint(null);
            return;
        }
        if (dismissedDeployBannerFingerprint !== effectiveDeployBanner.fingerprint) return;
        // keep dismissed until the issue changes
    }, [dismissedDeployBannerFingerprint, effectiveDeployBanner]);

    const showDeployBanner = Boolean(
        effectiveDeployBanner &&
            effectiveDeployBanner.detail &&
            dismissedDeployBannerFingerprint !== effectiveDeployBanner.fingerprint,
    );

    useEffect(() => {
        stagedImagesRef.current = stagedImages;
    }, [stagedImages]);

    useEffect(() => {
        const previous = previousViewModeRef.current;
        if (previous !== viewMode) {
            appBuilderViewSwitchesRef.current += 1;
            previousViewModeRef.current = viewMode;
        }
    }, [viewMode]);

    useEffect(() => {
        appBuilderSessionStartedAtRef.current = Date.now();
        return () => {
            const durationMs = Math.max(0, Date.now() - appBuilderSessionStartedAtRef.current);
            // Ignore ultra-short mounts (React strict-mode/dev remount jitter).
            if (durationMs < 1500) return;

            void recordAppBuilderSessionAnalytics(
                user,
                appId,
                durationMs,
                "close",
                {
                    aiUserMessagesSent: appBuilderAiMessagesSentRef.current,
                    viewSwitchCount: appBuilderViewSwitchesRef.current,
                },
                {
                    supabaseConnected: supabaseConnected === true,
                    vercelConnected:
                        !!(app?.vercelProjectId && String(app.vercelProjectId).trim()) ||
                        !!(app?.productionUrl && String(app.productionUrl).trim()),
                    stripeConfigured: appHasStripeConfig(app?.files),
                },
            ).catch((err) => {
                console.error("AppBuilderEditor session analytics flush failed", err);
            });
        };
    }, [appId, app?.files, app?.productionUrl, app?.vercelProjectId, supabaseConnected, user]);

    useEffect(() => {
        if (viewMode !== "images") return;
        const id = window.setInterval(() => {
            setImagePromptPlaceholderIdx((prev) => (prev + 1) % IMAGE_PLACEMENT_PLACEHOLDERS.length);
        }, 2600);
        return () => window.clearInterval(id);
    }, [viewMode]);

    useEffect(() => {
        return () => {
            for (const item of stagedImagesRef.current) {
                try {
                    URL.revokeObjectURL(item.previewUrl);
                } catch {
                    // ignore
                }
            }
        };
    }, []);

    const uploadImageToUserBlob = useCallback(async (file: globalThis.File) => {
        const uid = user?.uid;
        if (!uid) {
            throw new Error("Missing user session");
        }

        const safeName = sanitizeImageName(file.name || "upload.bin");
        const usage = await loadUserImageStorageUsage(uid);
        if (usage.usedBytes + file.size > IMAGE_STORAGE_LIMIT_BYTES) {
            throw new Error(
                `Image storage limit reached. You are using ${Math.round(usage.usedBytes / 1024 / 1024)}MB of ${Math.round(IMAGE_STORAGE_LIMIT_BYTES / 1024 / 1024)}MB.`,
            );
        }

        const uploaded = await uploadUserImageToFirebase({
            uid,
            file,
            fileName: safeName,
            renderId: appId || "draft",
        });
        if (!uploaded?.url?.trim()) {
            throw new Error("Image upload returned no URL.");
        }
        if (process.env.NODE_ENV === "development") {
            console.log("[AppBuilderEditor] image upload success", {
                fileName: safeName,
                url: uploaded.url,
                path: uploaded.path || "",
                bytes: file.size,
                type: file.type,
            });
        }

        return {
            url: uploaded.url,
            path: uploaded.path,
        };
    }, [appId, user?.uid]);

    const handlePickFavicon = useCallback(() => {
        if (faviconUploading) return;
        faviconInputRef.current?.click();
    }, [faviconUploading]);

    const uploadFaviconToUserBlob = useCallback(async (file: globalThis.File): Promise<{ url: string; path?: string }> => {
        const uid = user?.uid;
        if (!uid) throw new Error("Missing user session");
        const usage = await loadUserImageStorageUsage(uid);
        if (usage.usedBytes + file.size > IMAGE_STORAGE_LIMIT_BYTES) {
            throw new Error(
                `Image storage limit reached. You are using ${Math.round(usage.usedBytes / 1024 / 1024)}MB of ${Math.round(IMAGE_STORAGE_LIMIT_BYTES / 1024 / 1024)}MB.`,
            );
        }
        const uploaded = await uploadUserImageToFirebase({
            uid,
            file,
            fileName: "favicon.ico",
            renderId: appId || "draft",
        });
        if (!uploaded?.url?.trim()) {
            throw new Error("Image upload returned no URL.");
        }
        if (process.env.NODE_ENV === "development") {
            console.log("[AppBuilderEditor] favicon upload success", {
                url: uploaded.url,
                path: uploaded.path || "",
                bytes: file.size,
                type: file.type,
            });
        }
        return { url: uploaded.url, path: uploaded.path };
    }, [appId, user?.uid]);

    const deleteUserBlobPaths = useCallback(async (paths: string[]) => {
        const filtered = paths.filter((p) => typeof p === "string" && p.trim().length > 0);
        if (!filtered.length) return;

        const csrf = await ensureSessionAndCsrf().catch(() => null);
        await fetch("/api/user-blob/delete", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
            },
            credentials: "include",
            body: JSON.stringify({ paths: filtered }),
        }).catch(() => null);
    }, []);

    const handlePickImages = useCallback(() => {
        imageInputRef.current?.click();
    }, []);

    const handleImageFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputFiles = Array.from(e.target.files || []);
        if (!inputFiles.length) return;

        const valid = inputFiles.filter((f) => f.type.startsWith("image/"));
        if (!valid.length) {
            void showAlert("Please select image files only.", "Images");
            e.target.value = "";
            return;
        }

        const nextItems = await Promise.all(
            valid.map(async (file) => {
                let prepared = file;
                if (autoCompressImages) {
                    try {
                        prepared = await compressImageForUpload(file);
                    } catch {
                        prepared = file;
                    }
                }

                return {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    originalFile: file,
                    preparedFile: prepared,
                    previewUrl: URL.createObjectURL(prepared),
                    originalBytes: file.size,
                    preparedBytes: prepared.size,
                    alt: file.name.replace(/\.[^.]+$/, "") || "",
                    placementPrompt: "",
                    uploadedUrl: null,
                    uploadedPath: null,
                    status: "staged" as const,
                    error: null,
                };
            })
        );

        setStagedImages((prev) => [...nextItems, ...prev]);
        e.target.value = "";
    }, [autoCompressImages, showAlert]);

    const removeStagedImage = useCallback((id: string) => {
        setStagedImages((prev) => {
            const target = prev.find((item) => item.id === id);
            if (target) {
                try {
                    URL.revokeObjectURL(target.previewUrl);
                } catch {
                    // ignore
                }
            }
            return prev.filter((item) => item.id !== id);
        });
    }, []);

    const clearStagedImages = useCallback(() => {
        setStagedImages((prev) => {
            for (const item of prev) {
                try {
                    URL.revokeObjectURL(item.previewUrl);
                } catch {
                    // ignore
                }
            }
            return [];
        });
    }, []);

    const updateStagedImage = useCallback((id: string, patch: Partial<StagedImage>) => {
        setStagedImages((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    }, []);

    const generationPlaceholderFiles = useMemo(() => {
        // Minimal Next.js App Router template so we can start a machine immediately
        // while backend generation is still running.
        const appName = String((app as any)?.name || "Kloner App");
        const safeTitle = appName.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const now = Date.now();
        return {
            "package.json": {
                content: JSON.stringify(
                    {
                        name: "kloner-generated-app",
                        private: true,
                        scripts: {
                            dev: "next dev -p 3000",
                            build: "next build",
                            start: "next start -p 3000",
                        },
                        dependencies: {
                            next: "^14.0.0",
                            react: "^18.2.0",
                            "react-dom": "^18.2.0",
                        },
                    },
                    null,
                    2,
                ) + "\n",
                lastModified: now,
            },
            "next.config.mjs": {
                content: "export default {\n  reactStrictMode: true,\n};\n",
                lastModified: now,
            },
            "tsconfig.json": {
                content:
                    JSON.stringify(
                        {
                            compilerOptions: {
                                target: "ES2020",
                                lib: ["dom", "dom.iterable", "esnext"],
                                allowJs: true,
                                skipLibCheck: true,
                                strict: false,
                                noEmit: true,
                                esModuleInterop: true,
                                module: "esnext",
                                moduleResolution: "bundler",
                                resolveJsonModule: true,
                                isolatedModules: true,
                                jsx: "preserve",
                                incremental: true,
                                baseUrl: ".",
                                paths: { "@/*": ["./*"] },
                            },
                            include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
                            exclude: ["node_modules"],
                        },
                        null,
                        2,
                    ) + "\n",
                lastModified: now,
            },
            "next-env.d.ts": {
                content: "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types\" />\n\n// NOTE: This file should not be edited\n// see https://nextjs.org/docs/pages/api-reference/config/typescript for more information.\n",
                lastModified: now,
            },
            "app/layout.tsx": {
                content:
                    `export const metadata = {\n  title: ${JSON.stringify(appName)},\n  description: "Generating your app…",\n};\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang=\"en\">\n      <body style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system' }}>{children}</body>\n    </html>\n  );\n}\n`,
                lastModified: now,
            },
            "app/page.tsx": {
                content:
                    `export default function Page() {\n  return (\n    <main style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>\n      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>${safeTitle}</h1>\n      <p style={{ color: '#374151', marginBottom: 16 }}>\n        Your app is being generated from your screenshots.\n      </p>\n      <div style={{ padding: 16, borderRadius: 12, border: '1px solid #e5e7eb', background: '#f9fafb' }}>\n        <div style={{ fontWeight: 600, marginBottom: 6 }}>Preview machine</div>\n        <div style={{ color: '#6b7280' }}>Starting now so it’s ready when generation finishes.</div>\n      </div>\n    </main>\n  );\n}\n`,
                lastModified: now,
            },
        } as AppData["files"];
    }, [app]);

    const activeGeneration = useMemo(() => normalizeGenerationState(app), [app]);
    const isGenerationProcessing = isGenerationInProgress(activeGeneration);
    const activeEmbedding = useMemo(() => normalizeEmbeddingState(app), [app]);
    const isEmbeddingProcessing = /pending|processing|backfilling|warming|indexing/i.test(String(activeEmbedding.status || ""));

    const generationErrorText = useMemo(() => {
        return String(activeGeneration.error || "");
    }, [activeGeneration.error]);

    const generationErrorLooksPreviewRelated = useMemo(() => {
        const t = generationErrorText.toLowerCase();
        return (
            t.includes("preview") ||
            t.includes("webcontainer") ||
            t.includes("hub") ||
            t.includes("502") ||
            t.includes("poll") ||
            t.includes("render_failed")
        );
    }, [generationErrorText]);

    const generationFailureUi = useMemo(() => {
        if (activeGeneration.status !== "error") return null;

        const errorCode = String(activeGeneration.errorCode || "").trim().toUpperCase();
        const retryable = activeGeneration.retryable === true;
        const needsRescan = activeGeneration.needsRescan === true;
        const nextAction = String(activeGeneration.nextAction || "").trim().toLowerCase();
        const explicitRescan = needsRescan === true;
        const explicitHydrationFailure = errorCode === "HTML_PREVIEW_HYDRATION_FAILED";
        const explicitRetry = nextAction === "retry_generation" || (retryable && !needsRescan);
        const explicitSupport = nextAction === "contact_support";

        let message = generationErrorText || "Generation failed. Please try again.";
        let actionLabel = "Dismiss";
        let actionKind: "dismiss" | "retry" | "rescan" = "dismiss";
        let secondaryMessage: string | null = null;

        if (explicitHydrationFailure) {
            message = "We couldn’t save the generated website files. Please try regenerating.";
            secondaryMessage = "If this keeps happening, the backend may not be writing the full file tree to the Firebase entry.";
            actionLabel = "Try again";
            actionKind = "retry";
        }

        if (!explicitHydrationFailure && explicitRescan) {
            message =
                errorCode === "ARCHIVE_ZIP_MISSING"
                    ? "We couldn't start this app because the archived site files are not ready yet. Please rescan this URL and try again."
                    : "This URL needs to be rescanned before it can be used for generation.";
            actionLabel = "Rescan URL";
            actionKind = "rescan";
        } else if (!explicitHydrationFailure && explicitRetry) {
            switch (errorCode) {
                case "GEMINI_API_UNAVAILABLE":
                    message = "The model is temporarily unavailable. Try again in a moment.";
                    break;
                case "GEMINI_TIMEOUT":
                    message = "The model timed out. Please retry.";
                    break;
                case "GEMINI_BAD_RESPONSE":
                    message = "The model returned an invalid response. Please retry.";
                    break;
                case "GENERATION_FAILED":
                    message = "Generation failed. Please retry.";
                    break;
                default:
                    message = "Generation failed. Please retry.";
                    break;
            }
            actionLabel = "Retry";
            actionKind = "retry";
        } else if (!explicitHydrationFailure && explicitSupport) {
            message = generationErrorText || "Generation failed. Please contact support.";
            actionLabel = "Dismiss";
            actionKind = "dismiss";
        } else if (!explicitHydrationFailure && retryable && !needsRescan) {
            message = "Generation failed. Please retry.";
            actionLabel = "Retry";
            actionKind = "retry";
        } else if (!explicitHydrationFailure && needsRescan) {
            message = "This URL needs to be rescanned before it can be used for generation.";
            actionLabel = "Rescan URL";
            actionKind = "rescan";
        }

        return {
            message,
            secondaryMessage,
            actionLabel,
            actionKind,
            requestId: activeGeneration.requestId,
            details: activeGeneration.details,
            isRetryableNoRescan: explicitRetry,
            isRescanRequired: explicitRescan,
            isHydrationFailure: explicitHydrationFailure,
            isSupportState: explicitSupport,
        };
    }, [activeGeneration.details, activeGeneration.errorCode, activeGeneration.needsRescan, activeGeneration.nextAction, activeGeneration.requestId, activeGeneration.retryable, activeGeneration.status, generationErrorText]);

    const generationFailureDebugDetails = useMemo(() => {
        if (IS_PRODUCTION) return null;
        if (!generationFailureUi) return null;

        const parts: string[] = [];
        const requestId = String(generationFailureUi.requestId || "").trim();
        if (requestId) parts.push(`reqId: ${requestId}`);

        const details = generationFailureUi.details;
        if (details != null) {
            if (typeof details === "string") {
                const text = details.trim();
                if (text) parts.push(text);
            } else {
                try {
                    parts.push(JSON.stringify(details, null, 2));
                } catch {
                    parts.push(String(details));
                }
            }
        }

        return parts.length ? parts.join("\n\n") : null;
    }, [generationFailureUi]);

    const generationFailureLogKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (activeGeneration.status !== "error") return;
        if (!generationFailureUi?.isHydrationFailure) return;

        const dedupeKey = `${generationFailureUi.requestId || ""}:${String(generationFailureUi.message || "")}`;
        if (generationFailureLogKeyRef.current === dedupeKey) return;
        generationFailureLogKeyRef.current = dedupeKey;

        const payload: ObservabilityFrontendIngestPayload = {
            source: "frontend",
            severity: "error",
            route: "/components/AppBuilderEditor",
            method: "render",
            statusCode: 500,
            message: "html_preview_hydration_failed",
            errorName: "HtmlPreviewHydrationFailed",
            service: "app-builder-editor",
            extra: {
                errorCode: activeGeneration.errorCode || null,
                requestId: generationFailureUi.requestId || null,
                details: generationFailureUi.details || null,
                nextAction: activeGeneration.nextAction || null,
            },
        };

        void fetch("/api/internal/observability/ingest", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify(payload),
            keepalive: true,
            credentials: "include",
        }).catch((err) => {
            console.warn("[observability] failed to send hydration failure event", err);
        });
    }, [activeGeneration.errorCode, activeGeneration.nextAction, activeGeneration.status, generationFailureUi]);

    useEffect(() => {
        // If the backend marked generation as error due to a transient preview issue,
        // but the preview is now connected, don't hard-block the UI.
        if (activeGeneration.status !== "error") return;
        if (!generationErrorLooksPreviewRelated) return;
        if (!isWebPreviewReady) return;
        setDismissedGenerationError(true);
    }, [activeGeneration.status, generationErrorLooksPreviewRelated, isWebPreviewReady]);
    useEffect(() => {
        if (isGenerationProcessing) {
            setGenerationEver(true);
        }
    }, [isGenerationProcessing]);
    const effectivePreviewFiles = useMemo(() => {
        if (isGenerationProcessing) return generationPlaceholderFiles;
        if (!isPreviewBootReady) return {};
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const files = (app?.files || {}) as AppData["files"];
        if (!origin) return files;

        const nextFiles: AppData["files"] = {};
        for (const [path, record] of Object.entries(files)) {
            const content = String(record?.content || "");
            nextFiles[path] = /\.html?$/i.test(path)
                ? {
                    ...record,
                    content: rewriteFirebaseStorageUrlsInHtmlForWebContainer(content, origin),
                }
                : { ...record };
        }
        return nextFiles;
    }, [app?.files, generationPlaceholderFiles, isGenerationProcessing, isPreviewBootReady]);

    const usedPlaceholderRef = useRef(false);
    useEffect(() => {
        if (isGenerationProcessing) usedPlaceholderRef.current = true;
    }, [isGenerationProcessing]);

    // Guard against losing in-editor changes on refresh/navigation.
    // - For full-page navigations (refresh/close/url change), browsers require a synchronous beforeunload prompt.
    // - For in-app navigations (links/back), we can use the global confirm modal.
    const codeRef = useRef<string>("");
    useEffect(() => {
        codeRef.current = code;
    }, [code]);

    const allowNextNavigationRef = useRef(false);
    const leaveGuardArmedRef = useRef(false);
    const getHasUnsavedChanges = useCallback((): boolean => {
        if (!appId) return false;

        // If an autosave is pending, treat as unsaved.
        if (autoSaveTimeoutRef.current) return true;
        if (isSaving) return true;

        const cur = currentFileRef.current;
        if (!cur) return false;
        const files = appRef.current?.files as any;
        const saved = files?.[cur]?.content;
        if (typeof saved !== "string") return false;
        return codeRef.current !== saved;
    }, [appId, isSaving]);

    const getLeaveWarningText = useCallback((): string => {
        return getHasUnsavedChanges()
            ? "You have unsaved changes that may be lost. Leave this page anyway?"
            : "Leave the App Builder?";
    }, [getHasUnsavedChanges]);

    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (allowNextNavigationRef.current) return;
            // Required for Chrome/Safari to show a confirmation dialog.
            e.preventDefault();
            e.returnValue = "";
        };

        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [getHasUnsavedChanges]);

    const showConfirmRef = useRef(showConfirm);
    const getHasUnsavedChangesRef = useRef(getHasUnsavedChanges);
    const getLeaveWarningTextRef = useRef(getLeaveWarningText);

    useEffect(() => {
        showConfirmRef.current = showConfirm;
    }, [showConfirm]);

    useEffect(() => {
        getHasUnsavedChangesRef.current = getHasUnsavedChanges;
        getLeaveWarningTextRef.current = getLeaveWarningText;
    }, [getHasUnsavedChanges, getLeaveWarningText]);

    const leaveConfirmInFlightRef = useRef(false);
    useEffect(() => {
        // In-app navigation guard for anchor clicks and back/forward.
        // This catches Next.js client-side navigations that won't trigger beforeunload.
        const confirmLeave = async (): Promise<boolean> => {
            if (allowNextNavigationRef.current) return true;
            if (leaveConfirmInFlightRef.current) return false;
            leaveConfirmInFlightRef.current = true;
            try {
                const hasUnsaved = Boolean(getHasUnsavedChangesRef.current?.());
                return await showConfirmRef.current(
                    getLeaveWarningTextRef.current?.() || "Leave the App Builder?",
                    hasUnsaved ? "Unsaved changes" : "Leave App Builder",
                );
            } finally {
                leaveConfirmInFlightRef.current = false;
            }
        };

        // Add a same-URL history marker so the first Back press doesn't immediately
        // navigate away (it only changes history.state), giving us a chance to confirm.
        if (typeof window !== "undefined") {
            try {
                const st: any = history.state;
                if (!st || st.__klonerAppBuilderGuard !== true) {
                    history.pushState({ ...(st || {}), __klonerAppBuilderGuard: true }, "", window.location.href);
                    leaveGuardArmedRef.current = true;
                }
            } catch {
                // ignore
            }
        }

        // Some browsers (notably Safari) can fire an initial popstate on page load.
        // Ignore early popstate events so we don't show a leave-confirm as soon as the editor opens.
        let popstateReady = false;
        const armTimer = window.setTimeout(() => {
            popstateReady = true;
        }, 250);

        const onDocumentClickCapture = (e: MouseEvent) => {
            if (e.defaultPrevented) return;
            if (e.button !== 0) return; // left-click only
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (allowNextNavigationRef.current) return;

            const target = e.target as HTMLElement | null;
            const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
            if (!anchor) return;
            if (anchor.target && anchor.target !== "_self") return;
            const hrefAttr = (anchor.getAttribute("href") || "").trim();
            if (!hrefAttr || hrefAttr.startsWith("#")) return;

            // Prevent immediate navigation; we'll re-trigger if confirmed.
            e.preventDefault();
            e.stopPropagation();

            if (leaveConfirmInFlightRef.current) return;
            const href = anchor.href;
            void (async () => {
                const ok = await confirmLeave();
                if (!ok) return;

                allowNextNavigationRef.current = true;
                try {
                    window.location.assign(href);
                } finally {
                    // If navigation fails for some reason, re-arm after a tick.
                    setTimeout(() => {
                        allowNextNavigationRef.current = false;
                    }, 1000);
                }
            })();
        };

        const onPopState = () => {
            if (allowNextNavigationRef.current) return;
            if (!popstateReady) return;

            // If the marker isn't present (e.g. some browsers strip history.state), re-add it.
            try {
                const st: any = history.state;
                if (!st || st.__klonerAppBuilderGuard !== true) {
                    history.pushState({ ...(st || {}), __klonerAppBuilderGuard: true }, "", window.location.href);
                    leaveGuardArmedRef.current = true;
                    return;
                }
            } catch {
                // ignore
            }

            if (leaveConfirmInFlightRef.current) return;
            void (async () => {
                const ok = await confirmLeave();
                if (!ok) return;

                allowNextNavigationRef.current = true;
                try {
                    history.back();
                } finally {
                    setTimeout(() => {
                        allowNextNavigationRef.current = false;
                    }, 1000);
                }
            })();
        };

        document.addEventListener("click", onDocumentClickCapture, true);
        window.addEventListener("popstate", onPopState);
        return () => {
            clearTimeout(armTimer);
            document.removeEventListener("click", onDocumentClickCapture, true);
            window.removeEventListener("popstate", onPopState);
        };
    }, [appId]);

    const closeRequestInFlightRef = useRef(false);
    const requestClose = useCallback(async () => {
        if (closeRequestInFlightRef.current) return;
        closeRequestInFlightRef.current = true;
        try {
            const hasUnsaved = getHasUnsavedChanges();
            const ok = await showConfirm(
                hasUnsaved
                    ? "You have unsaved changes that may be lost. Close the editor anyway?"
                    : "Close the editor? Any unsaved changes will be lost.",
                hasUnsaved ? "Unsaved changes" : "Close editor",
            );
            if (!ok) return;
            onCloseRef.current?.();
        } finally {
            closeRequestInFlightRef.current = false;
        }
    }, [getHasUnsavedChanges, showConfirm]);
    const [shareChoiceError, setShareChoiceError] = useState<string | null>(null);

    // Lock chat until the preview iframe has successfully loaded.
    // Any reload/restart/reconnect should re-lock until we see another successful iframe load.
    useEffect(() => {
        if (previewMode !== "webcontainer") {
            setIsWebPreviewReady(true);
            setIsWebPreviewReadyLatched(true);
            return;
        }
        setIsWebPreviewReady(false);
        setIsWebPreviewReadyLatched(false);
    }, [previewMode, refreshKey, localRestartKey, reconnectKey]);
    const [lastDeployLiveUrl, setLastDeployLiveUrl] = useState<string | null>(null);
    const [lastSharePreviewUrl, setLastSharePreviewUrl] = useState<string | null>(null);
    const [showShareSuccess, setShowShareSuccess] = useState(false);
    const deployUrlShortLabel = useMemo(() => formatDeployUrlShortLabel(lastDeployLiveUrl), [lastDeployLiveUrl]);
    const sharePreviewUrlShortLabel = useMemo(() => formatDeployUrlShortLabel(lastSharePreviewUrl), [lastSharePreviewUrl]);

    const openShareSuccessModal = useCallback((shareUrl: string) => {
        const content = (
            <div className="space-y-3 text-left">
                <div className="text-sm text-neutral-700">
                    Your share link is ready.
                </div>
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-mono break-all text-neutral-700">
                    {shareUrl}
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={async () => {
                            await copyTextToClipboard(shareUrl).catch(() => null);
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
                    >
                        Copy link
                    </button>
                    <button
                        type="button"
                        onClick={() => window.open(shareUrl, "_blank", "noopener,noreferrer")}
                        className="inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
                    >
                        Open link
                    </button>
                    <button
                        type="button"
                        onClick={() => hideModal()}
                        className="inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
                    >
                        Close
                    </button>
                </div>
                <div className="text-xs text-neutral-500">
                    The link is also saved in the editor for later reuse.
                </div>
            </div>
        );

        void showAlert(content, "Share preview");
    }, [hideModal, showAlert]);
    const [leftPanelWidth, setLeftPanelWidth] = useState(500); // Default wider AI chat panel
    const [isResizing, setIsResizing] = useState(false);
    const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const restartDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const restartInFlightRef = useRef(false);
    const restartQueuedRef = useRef(false);
    const restartQueuedInteractiveRef = useRef(false);

    const didAutoRepairConfigRef = useRef(false);

    const applyDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const applyInFlightRef = useRef(false);
    const applyQueuedRef = useRef<Record<string, string>>({});
    const applyRunAfterRef = useRef(false);
    const lastApplyAlertAtRef = useRef(0);
    const applyRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
    const applyServerErrorRetryCountRef = useRef(0);
    const applyAutoRetryPausedUntilRef = useRef(0);
    const lastApplyFailureStatusRef = useRef<number | null>(null);
    const applyIdempotencyKeyRef = useRef<string | null>(null);

    // Firebase can emit multiple snapshots in quick succession. Reloading the preview iframe for
    // every snapshot causes heavy flicker and request thrash. Coalesce into at most ~1 reload/1.5s.
    const firebasePreviewReloadTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastFirebasePreviewReloadAtRef = useRef<number>(0);
    const currentFileRef = useRef<string | null>(null);
    const lastAppliedContentRef = useRef<Record<string, string>>({});

    useEffect(() => {
        currentFileRef.current = currentFile;
    }, [currentFile]);

    const queuePreviewReloadFromFirebase = useCallback(() => {
        const now = Date.now();
        const minIntervalMs = 1500;
        const debounceMs = 500;

        const sinceLast = now - (lastFirebasePreviewReloadAtRef.current || 0);
        const delay = Math.max(debounceMs, minIntervalMs - sinceLast);

        if (firebasePreviewReloadTimerRef.current) {
            clearTimeout(firebasePreviewReloadTimerRef.current);
            firebasePreviewReloadTimerRef.current = null;
        }

        firebasePreviewReloadTimerRef.current = setTimeout(() => {
            firebasePreviewReloadTimerRef.current = null;
            lastFirebasePreviewReloadAtRef.current = Date.now();
            setRefreshKey((k) => k + 1);
        }, delay);
    }, []);

    useEffect(() => {
        return () => {
            if (firebasePreviewReloadTimerRef.current) {
                clearTimeout(firebasePreviewReloadTimerRef.current);
                firebasePreviewReloadTimerRef.current = null;
            }
        };
    }, []);

    const { status: vercelStatus, meta: vercelMeta, checking: vercelChecking, refresh: refreshVercelStatus } =
        useVercelIntegration();

    const isVercelConnected = vercelStatus === "connected";
    const isVercelChecking = vercelStatus === "loading" || vercelChecking;
    const storageConfiguredRef = useRef(false);

    useEffect(() => {
        storageConfiguredRef.current = true;
    }, [vercelMeta?.blobConfigured]);

    useEffect(() => {
        isVercelConnectedRef.current = isVercelConnected;
    }, [isVercelConnected]);

    const ensureFreshVercelConnection = useCallback(
        async (flow: "preview" | "images" | "share"): Promise<boolean> => {
            if (isVercelConnectedRef.current) return true;

            await refreshVercelStatus().catch(() => null);
            if (isVercelConnectedRef.current) return true;

            setVercelConnectFlow(flow);
            setVercelConnectOpen(true);
            return false;
        },
        [refreshVercelStatus],
    );

    useEffect(() => {
        ensureFreshVercelConnectionRef.current = ensureFreshVercelConnection;
    }, [ensureFreshVercelConnection]);

    const runVercelDeployLiveRef = useRef<(() => Promise<boolean>) | null>(null);

    const ensureStorageConfiguredForImages = useCallback(async (): Promise<boolean> => {
        return true;
    }, []);

    const appRef = useRef<AppData | null>(null);
    useEffect(() => {
        appRef.current = app;
    }, [app]);

    const suppressNextFilesReplaceApplyRef = useRef(false);
    const scopeBootstrappedForAppIdRef = useRef<string | null>(null);

    const autoPreviewRunIdRef = useRef(0);
    const didAutoPreviewStartRef = useRef(false);

    const bootstrapAppScope = useCallback(async (): Promise<boolean> => {
        if (!appId) return false;
        try {
            const res = await fetch(`/api/app-builder/${encodeURIComponent(appId)}/scope`, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
            });
            return res.ok;
        } catch {
            return false;
        }
    }, [appId]);

    // Proactively issue scope cookie once the app has loaded to reduce first-write 403s
    // without poking the scope endpoint for appIds that are still materializing.
    useEffect(() => {
        if (!appId || !app) return;
        if (scopeBootstrappedForAppIdRef.current === appId) return;
        scopeBootstrappedForAppIdRef.current = appId;
        void bootstrapAppScope();
    }, [app, appId, bootstrapAppScope]);

    const previewSrc = useMemo(() => {
        const base = (app?.previewUrl || "").trim();
        if (!base) return "";
        const withBypass = addVercelProtectionBypass(base, app?.vercelProtectionBypassSecret || null);
        return addCacheBust(withBypass, refreshKey);
    }, [app?.previewUrl, app?.vercelProtectionBypassSecret, refreshKey]);

    useEffect(() => {
        const base = (app?.previewUrl || "").trim();
        if (!base) return;
        setLastSharePreviewUrl(addVercelProtectionBypass(base, app?.vercelProtectionBypassSecret || null));
    }, [app?.previewUrl, app?.vercelProtectionBypassSecret]);

    function isLikelyNetworkError(err: unknown): boolean {
        if (!err || typeof err !== "object") return false;
        const message = String((err as any).message || "").toLowerCase();
        // Fetch throws TypeError on network/CORS issues.
        return (
            err instanceof TypeError ||
            message.includes("network") ||
            message.includes("failed to fetch") ||
            message.includes("load failed") ||
            message.includes("fetch")
        );
    }

    function sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    const getApplyIdempotencyKey = useCallback(() => {
        if (!applyIdempotencyKeyRef.current) {
            applyIdempotencyKeyRef.current = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        }

        return applyIdempotencyKeyRef.current;
    }, []);

    const fetchFreshCsrf = useCallback(async (): Promise<string | null> => {
        try {
            const res = await fetch("/api/auth/csrf", {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                cache: "no-store",
            });
            if (!res.ok) return null;
            const data = await res.json().catch(() => null);
            return (data as any)?.csrf || null;
        } catch {
            return null;
        }
    }, []);

    const restartLocalPreview = useCallback(async (forceFresh: boolean = false) => {
        if (isPreviewBuilding) return;
        const now = Date.now();
        const throttleKey = forceFresh ? "rebuildAt" : "refreshAt";
        const cooldownMs = forceFresh ? 5000 : 1500;
        if (now - previewActionThrottleRef.current[throttleKey] < cooldownMs) return;
        previewActionThrottleRef.current[throttleKey] = now;
        setIsPreviewBuilding(true);
        try {
            setPreviewMode("webcontainer");
            if (forceFresh) {
                console.log('🔄 AppBuilderEditor: Incrementing forceFreshStartKey');
                forceFreshStartKey.current += 1;
                setForceFreshStart(true);
                // Reset the flag after a short delay to allow the component to re-render
                setTimeout(() => {
                    console.log('🔄 AppBuilderEditor: Resetting forceFreshStart to false');
                    setForceFreshStart(false);
                }, 100);
            } else {
                setLocalRestartKey((k) => k + 1);
            }
            setRefreshKey((k) => k + 1);
        } finally {
            setIsPreviewBuilding(false);
        }
    }, [isPreviewBuilding]);

    // Allow child panels (like AppBuilderEditorAgentChat) to request a true "fresh machine" rebuild.
    useEffect(() => {
        if (typeof window === "undefined") return;

        const handler = (event: Event) => {
            try {
                const ce = event as CustomEvent<any>;
                const requestedAppId = String(ce?.detail?.appId || "").trim();
                if (!requestedAppId || requestedAppId !== appId) return;
                void restartLocalPreview(true);
            } catch {
                // ignore
            }
        };

        window.addEventListener("kloner:preview-force-fresh", handler as any);
        return () => {
            window.removeEventListener("kloner:preview-force-fresh", handler as any);
        };
    }, [appId, restartLocalPreview]);

    const consumeAiEditCredit = useCallback(
        async (creditRequestId: string) => {
            const rid = String(creditRequestId || "").trim();
            if (!rid) return;

            try {
                const csrf = await fetchFreshCsrf();
                const res = await fetch("/api/credits/ai-edits/consume", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify({ requestId: rid, cost: 3 }),
                });

                const data = await res.json().catch(() => ({} as any));
                if (!res.ok || !(data as any)?.ok) {
                    const msg = String((data as any)?.error || `Credit consume failed (HTTP ${res.status})`);
                    setAgentCreditError(msg);
                    return;
                }
            } catch (err: any) {
                setAgentCreditError(String(err?.message || "Failed to consume AI edit credit"));
            }
        },
        [fetchFreshCsrf]
    );


    const changeIsNotHotUpdatable = useCallback((path: string) => {
        const p = String(path || "").trim().toLowerCase();
        if (!p) return false;

        // Dependency / build config files typically cannot be hot-updated.
        return (
            p === "public" ||
            p.startsWith("public/") ||
            p.endsWith("/public") ||
            p.endsWith(".html") ||
            p.endsWith(".htm") ||
            p === "package.json" ||
            p.endsWith("/package.json") ||
            p === "package-lock.json" ||
            p.endsWith("/package-lock.json") ||
            p === "pnpm-lock.yaml" ||
            p.endsWith("/pnpm-lock.yaml") ||
            p === "yarn.lock" ||
            p.endsWith("/yarn.lock") ||
            p === "bun.lockb" ||
            p.endsWith("/bun.lockb") ||
            p === "next.config.js" ||
            p === "next.config.mjs" ||
            p.endsWith("/next.config.js") ||
            p.endsWith("/next.config.mjs") ||
            p === "tailwind.config.js" ||
            p === "tailwind.config.ts" ||
            p.endsWith("/tailwind.config.js") ||
            p.endsWith("/tailwind.config.ts") ||
            p === "postcss.config.js" ||
            p.endsWith("/postcss.config.js") ||
            p === "tsconfig.json" ||
            p.endsWith("/tsconfig.json")
        );
    }, []);

    const flushPreviewApply = useCallback(
        async ({ interactive }: { interactive: boolean }) => {
            if (!appId) return;
            if (applyInFlightRef.current) {
                applyRunAfterRef.current = true;
                return;
            }

            const now0 = Date.now();
            if (applyAutoRetryPausedUntilRef.current && now0 < applyAutoRetryPausedUntilRef.current) {
                // Keep changes queued, but don't hammer the backend.
                if (interactive && now0 - lastApplyAlertAtRef.current > 15000) {
                    lastApplyAlertAtRef.current = now0;
                    void showAlert(
                        "Live update is temporarily paused due to server errors. Your changes are saved. Try Refresh first, if it still fails, please contact support.",
                        "Live update",
                    );
                }
                return;
            }

            const queued = applyQueuedRef.current;
            const paths = Object.keys(queued);
            if (paths.length === 0) return;

            applyQueuedRef.current = {};
            applyInFlightRef.current = true;
            applyRunAfterRef.current = false;

            let scheduledRetry = false;
            try {
                // Prefer sending the locally stored container code when available.
                // If absent, the backend/hub can resolve the latest preview by appId.
                let storedCode = "";
                try {
                    const raw = localStorage.getItem(`webcontainer_${appId}`);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed?.code) storedCode = String(parsed.code).trim();
                    }
                } catch {
                    // ignore
                }

                const csrf = await fetchFreshCsrf();
                const payload: any = {
                    appId,
                    files: paths.map((p) => ({ path: p, content: queued[p] })),
                    idempotencyKey: getApplyIdempotencyKey(),
                };
                if (storedCode) payload.code = storedCode;

                const res = await fetch("/api/previews/apply", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "idempotency-key": String(payload.idempotencyKey || ""),
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify(payload),
                });

                const data = await res.json().catch(() => ({} as any));
                const apply = normalizePreviewApplyResponse(data, res.status, res.headers.get("retry-after"));
                const replayedApply = Boolean(apply.replayed);
                const contradictoryStatus = Boolean(apply.contradictoryStatus);
                const expectedOps = typeof apply.expectedOps === "number" ? apply.expectedOps : null;
                const restartPending = Boolean(apply.restartPending || apply.queued || apply.outcome === "restart_pending");
                const restartTimedOut = Boolean(apply.outcome === "timeout" || (res.status === 504 && apply.retryable));
                const retryAfterSeconds = typeof apply.retryAfterSeconds === "number" ? apply.retryAfterSeconds : null;
                const restartMessage = String(apply.restartMessage || "").trim();
                const needsRestart = Boolean(apply.requiresRestart || apply.requiresRebuild || apply.needsRebuild || apply.touchesPublicAssets);
                const retryableApply = Boolean(apply.retryable || restartTimedOut);

                if (replayedApply) {
                    applyInFlightRef.current = false;
                    return;
                }

                if (contradictoryStatus) {
                    for (const p of paths) {
                        if (queued[p] !== undefined) applyQueuedRef.current[p] = queued[p];
                    }
                    if (interactive) {
                        void showAlert(
                            "Apply may not have taken effect on the preview machine. Please retry in a moment.",
                            "Live update",
                        );
                    }
                    return;
                }

                if (apply.saved === false && (expectedOps === null || expectedOps > 0)) {
                    for (const p of paths) {
                        if (queued[p] !== undefined) applyQueuedRef.current[p] = queued[p];
                    }
                    if (interactive) {
                        void showAlert(
                            "The backend reported that file writes did not complete. Please retry apply.",
                            "Live update",
                        );
                    }
                    return;
                }

                if (!res.ok || !apply.ok) {
                    if (retryableApply) {
                        // Keep changes queued so we can retry the exact same payload with the same idempotency key.
                        for (const p of paths) {
                            if (queued[p] !== undefined) applyQueuedRef.current[p] = queued[p];
                        }

                        const now = Date.now();
                        const backoffSeconds = retryAfterSeconds ?? Math.max(1, 1 + applyServerErrorRetryCountRef.current);
                        applyAutoRetryPausedUntilRef.current = now + backoffSeconds * 1000;
                        if (interactive || now - lastApplyAlertAtRef.current > 15000) {
                            lastApplyAlertAtRef.current = now;
                            void showAlert(
                                `${restartMessage || "The preview update timed out while waiting for the restart to settle."}\n\nRetrying in ${backoffSeconds}s with the same apply payload.`,
                                "Live update",
                            );
                        }

                        if (!applyRetryTimerRef.current) {
                            applyRetryTimerRef.current = setTimeout(() => {
                                applyRetryTimerRef.current = null;
                                void flushPreviewApply({ interactive: false });
                            }, backoffSeconds * 1000);
                        }

                        scheduledRetry = true;
                        return;
                    }

                    // Keep changes queued so we can retry safely.
                    for (const p of paths) {
                        if (queued[p] !== undefined) applyQueuedRef.current[p] = queued[p];
                    }

                    // Track consecutive failures by status.
                    const status = res.status;
                    if (lastApplyFailureStatusRef.current === status) {
                        applyServerErrorRetryCountRef.current += 1;
                    } else {
                        lastApplyFailureStatusRef.current = status;
                        applyServerErrorRetryCountRef.current = 1;
                    }

                    // 404: no active preview found. Start/reconnect non-destructively and let the user retry.
                    if (res.status === 404) {
                        const now = Date.now();
                        if (interactive || now - lastApplyAlertAtRef.current > 15000) {
                            lastApplyAlertAtRef.current = now;
                            void showAlert(
                                "Your preview isn’t ready yet, so we can’t apply this change live right now. Your changes are saved, and we’ll try again after the preview restarts.",
                                "Live update",
                            );
                        }

                        // Non-destructive kick: WebContainerRunner should attach to existing machine when possible.
                        await restartLocalPreview(false);

                        if (!applyRetryTimerRef.current) {
                            applyRetryTimerRef.current = setTimeout(() => {
                                applyRetryTimerRef.current = null;
                                void flushPreviewApply({ interactive: false });
                            }, 1500);
                        }
                        scheduledRetry = true;
                        return;
                    }

                    // 409: usually means the preview is booting/busy or the provided code was stale.
                    // Never force-fresh here; just retry shortly.
                    if (res.status === 409) {
                        const now = Date.now();
                        if (interactive || now - lastApplyAlertAtRef.current > 15000) {
                            lastApplyAlertAtRef.current = now;
                            void showAlert(
                                "The preview is still starting up, so we’re waiting before applying this change. Your changes are saved and we’ll try again shortly.",
                                "Live update",
                            );
                        }

                        if (!applyRetryTimerRef.current) {
                            applyRetryTimerRef.current = setTimeout(() => {
                                applyRetryTimerRef.current = null;
                                void flushPreviewApply({ interactive: false });
                            }, 1000);
                        }
                        scheduledRetry = true;
                        return;
                    }

                    // 5xx: backend/hub transient error. Retry a couple times, then pause.
                    if (res.status >= 500 && res.status <= 599) {
                        const attempt = applyServerErrorRetryCountRef.current;
                        if (attempt <= 2) {
                            const delayMs = 1000 + attempt * 1000;
                            if (!applyRetryTimerRef.current) {
                                applyRetryTimerRef.current = setTimeout(() => {
                                    applyRetryTimerRef.current = null;
                                    void flushPreviewApply({ interactive: false });
                                }, delayMs);
                            }
                            scheduledRetry = true;
                            return;
                        }

                        // Pause auto-retry so we don't spam the server.
                        applyAutoRetryPausedUntilRef.current = Date.now() + 30_000;
                        const now = Date.now();
                        const shouldAlert = interactive || now - lastApplyAlertAtRef.current > 15000;
                        if (shouldAlert) {
                            lastApplyAlertAtRef.current = now;
                            const restartHint = String((data as any)?.restartMessage || "").trim();
                            const msg = restartHint || "The preview had a temporary problem while applying your change.";
                            void showAlert(
                                `${msg}\n\nYour changes are still saved. We’ll keep trying for 30 seconds, or you can click Refresh after a moment.`,
                                "Live update",
                            );
                        }
                        return;
                    }

                    const now = Date.now();
                    const shouldAlert = interactive || now - lastApplyAlertAtRef.current > 15000;
                    if (shouldAlert) {
                        lastApplyAlertAtRef.current = now;
                        const backendCode = String((data as any)?.code || apply.code || "").trim().toUpperCase();
                        const msg = backendCode === "PROXY_NOT_READY"
                            ? "The preview proxy is not ready yet. Please retry in a moment."
                            : backendCode === "RESTART_ENQUEUE_FAILED"
                                ? "The backend saved files but could not enqueue restart. Please retry apply."
                                : String((data as any)?.error || "The preview could not be updated right now.");
                        void showAlert(
                            `${msg}\n\nYour changes were kept, and you can try Refresh in a moment.`,
                            "Live update",
                        );
                    }
                    return;
                }

                // Success: reset failure/pause state.
                applyServerErrorRetryCountRef.current = 0;
                applyAutoRetryPausedUntilRef.current = 0;
                lastApplyFailureStatusRef.current = null;

                // Mark these contents as applied so we can safely dedupe future queues.
                for (const p of paths) {
                    if (queued[p] !== undefined) {
                        lastAppliedContentRef.current[p] = queued[p];
                    }
                }

                const nextCode = String((data as any)?.code || storedCode || "").trim();
                if (nextCode) {
                    try {
                        localStorage.setItem(
                            `webcontainer_${appId}`,
                            JSON.stringify({ code: nextCode, timestamp: Date.now() })
                        );
                    } catch {
                        // ignore
                    }
                }

                const requiresRestart = Boolean(
                    apply.requiresRestart ||
                    apply.requiresRebuild ||
                    apply.needsRebuild ||
                    apply.touchesPublicAssets ||
                    needsRestart,
                );

                // Notify the runner that an apply finished. The runner will do a delayed hard reload
                // only if HMR websocket is blocked/unknown (prevents "reload too early" issues).
                if (!replayedApply && (restartPending || apply.saved || apply.restartConfirmed || apply.outcome === "saved")) {
                    setApplyCompleteKey((k) => k + 1);
                }

                if (restartPending || requiresRestart) {
                    void restartLocalPreview(false);
                } else if (apply.outcome === "saved") {
                    const now = Date.now();
                    if (interactive || now - lastApplyAlertAtRef.current > 15000) {
                        lastApplyAlertAtRef.current = now;
                        void showAlert(
                            "Your files were saved successfully.",
                            "Live update",
                        );
                    }
                }

                applyIdempotencyKeyRef.current = null;
            } catch (err: any) {
                // Network / fetch failures: retry a couple times, then pause.
                if (lastApplyFailureStatusRef.current === -1) {
                    applyServerErrorRetryCountRef.current += 1;
                } else {
                    lastApplyFailureStatusRef.current = -1;
                    applyServerErrorRetryCountRef.current = 1;
                }

                const attempt = applyServerErrorRetryCountRef.current;
                if (attempt <= 2) {
                    const delayMs = 1000 + attempt * 1000;
                    if (!applyRetryTimerRef.current) {
                        applyRetryTimerRef.current = setTimeout(() => {
                            applyRetryTimerRef.current = null;
                            void flushPreviewApply({ interactive: false });
                        }, delayMs);
                    }
                    scheduledRetry = true;
                    return;
                }

                applyAutoRetryPausedUntilRef.current = Date.now() + 30_000;
                const now = Date.now();
                const shouldAlert = interactive || now - lastApplyAlertAtRef.current > 15000;
                if (shouldAlert) {
                    lastApplyAlertAtRef.current = now;
                    void showAlert(
                        "We couldn’t reach the preview service just now. Your changes are still saved, and we’ll retry automatically for 30 seconds.",
                        "Live update",
                    );
                }
            } finally {
                applyInFlightRef.current = false;

                // If we already scheduled a retry (or we're paused), do not immediately re-flush.
                const now = Date.now();
                const paused = applyAutoRetryPausedUntilRef.current && now < applyAutoRetryPausedUntilRef.current;
                if (scheduledRetry || applyRetryTimerRef.current || paused) {
                    applyRunAfterRef.current = false;
                    return;
                }

                if (applyRunAfterRef.current || Object.keys(applyQueuedRef.current).length > 0) {
                    applyRunAfterRef.current = false;
                    void flushPreviewApply({ interactive: false });
                } else if (!applyRetryTimerRef.current) {
                    applyIdempotencyKeyRef.current = null;
                }
            }
        },
        [appId, fetchFreshCsrf, getApplyIdempotencyKey, restartLocalPreview, showAlert]
    );

    const getStoredPreviewCode = useCallback((): string => {
        if (!appId) return "";
        try {
            const raw = localStorage.getItem(`webcontainer_${appId}`);
            if (!raw) return "";
            const parsed = JSON.parse(raw);
            const code = typeof parsed?.code === "string" ? parsed.code.trim() : "";
            return code;
        } catch {
            return "";
        }
    }, [appId]);

    const applyDiffToWebcontainerAndMaybeRestart = useCallback(
        async (prevFiles: AppData["files"], nextFiles: AppData["files"], { interactive }: { interactive: boolean }) => {
            if (!appId) return;

            const prev = prevFiles || ({} as any);
            const next = nextFiles || ({} as any);

            const allPaths = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);

            const entries: Array<{ path: string; content?: string; delete?: boolean }> = [];
            for (const p of allPaths) {
                const prevContent = (prev as any)?.[p]?.content;
                const nextContent = (next as any)?.[p]?.content;

                if (typeof prevContent === "string" && typeof nextContent !== "string") {
                    entries.push({ path: p, delete: true });
                    continue;
                }

                if (typeof nextContent === "string" && typeof prevContent !== "string") {
                    entries.push({ path: p, content: String(nextContent) });
                    continue;
                }

                if (typeof prevContent === "string" && typeof nextContent === "string" && prevContent !== nextContent) {
                    entries.push({ path: p, content: String(nextContent) });
                }
            }

            if (entries.length === 0) return;

            const csrf = await fetchFreshCsrf();
            let activeCode = getStoredPreviewCode();
            let overallNeedsRebuild = false;

            const batchSize = 20;
            for (let i = 0; i < entries.length; i += batchSize) {
                const batch = entries.slice(i, i + batchSize);
                const payload: any = {
                    appId,
                    files: batch.map((e) =>
                        e.delete
                            ? { path: e.path, delete: true }
                            : { path: e.path, content: typeof e.content === "string" ? e.content : "" },
                    ),
                    idempotencyKey: getApplyIdempotencyKey(),
                };
                if (activeCode) payload.code = activeCode;

                const res = await fetch("/api/previews/apply", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "idempotency-key": String(payload.idempotencyKey || ""),
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify(payload),
                });

                const data = await res.json().catch(() => ({} as any));
                const apply = normalizePreviewApplyResponse(data, res.status, res.headers.get("retry-after"));
                const replayedApply = Boolean(apply.replayed);
                const contradictoryStatus = Boolean(apply.contradictoryStatus);
                const expectedOps = typeof apply.expectedOps === "number" ? apply.expectedOps : null;
                const restartPending = Boolean(apply.restartPending || apply.queued || apply.outcome === "restart_pending");
                const restartTimedOut = Boolean(apply.outcome === "timeout" || (res.status === 504 && apply.retryable));
                const retryAfterSeconds = typeof apply.retryAfterSeconds === "number" ? apply.retryAfterSeconds : null;
                const retryableApply = Boolean(apply.retryable || restartTimedOut);

                if (replayedApply) {
                    continue;
                }

                if (contradictoryStatus) {
                    if (interactive) {
                        void showAlert(
                            "Restore apply may not have taken effect on the preview machine. Please retry.",
                            "Restore",
                        );
                    }
                    return;
                }

                if (apply.saved === false && (expectedOps === null || expectedOps > 0)) {
                    if (interactive) {
                        void showAlert(
                            "Restore apply did not write all expected files. Please retry.",
                            "Restore",
                        );
                    }
                    return;
                }

                if (!res.ok || !apply.ok) {
                    if (retryableApply) {
                        if (interactive) {
                            const retryText = retryAfterSeconds !== null ? `Retrying in ${retryAfterSeconds}s.` : "Retrying shortly.";
                            void showAlert(
                                `${String(apply.restartMessage || apply.error || "The preview update timed out while waiting for restart.")}\n\n${retryText}`,
                                "Live update",
                            );
                        }
                        return;
                    }

                    if (res.status === 404) {
                        if (interactive) {
                            void showAlert(
                                "No active preview is running to apply these changes. Start/reconnect the preview and try again.",
                                "Restore",
                            );
                        }
                        await restartLocalPreview(false);
                        return;
                    }

                    if (res.status === 409) {
                        if (interactive) {
                            void showAlert(
                                "Preview is busy/booting (409). Try restoring again in a moment.",
                                "Restore",
                            );
                        }
                        return;
                    }

                    const backendCode = String((data as any)?.code || apply.code || "").trim().toUpperCase();
                    const msg = backendCode === "PROXY_NOT_READY"
                        ? "The preview proxy is not ready yet. Please retry in a moment."
                        : backendCode === "RESTART_ENQUEUE_FAILED"
                            ? "Files were saved but restart enqueue failed. Please retry apply."
                            : String((data as any)?.error || `Restore apply failed (HTTP ${res.status})`);
                    if (interactive) void showAlert(msg, "Restore");
                    return;
                }

                const nextCode = String((data as any)?.code || "").trim();
                if (nextCode) {
                    activeCode = nextCode;
                    try {
                        localStorage.setItem(
                            `webcontainer_${appId}`,
                            JSON.stringify({ code: nextCode, timestamp: Date.now() }),
                        );
                    } catch {
                        // ignore
                    }
                }

                // Update dedupe state for applied files.
                for (const e of batch) {
                    const p = String((e as any)?.path || "").trim();
                    if (!p) continue;
                    if ((e as any)?.delete) {
                        delete lastAppliedContentRef.current[p];
                    } else if (typeof (e as any)?.content === "string") {
                        lastAppliedContentRef.current[p] = String((e as any).content);
                    }
                }

                const needsRebuild = Boolean(
                    apply.needsRebuild ||
                        apply.requiresRebuild ||
                        apply.requiresRestart ||
                        apply.touchesPublicAssets ||
                        apply.hmrLikely === false ||
                        (data as any)?.refreshServer,
                );
                overallNeedsRebuild = overallNeedsRebuild || needsRebuild;

                if (restartPending) {
                    void restartLocalPreview(false);
                }
            }

            if (overallNeedsRebuild && activeCode) {
                const rres = await fetch("/api/previews/restart", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify({ appId, code: activeCode }),
                });
                const rdata = await rres.json().catch(() => ({} as any));
                if (!rres.ok || !(rdata as any)?.ok) {
                    const msg = String((rdata as any)?.error || `Restart failed (HTTP ${rres.status})`);
                    if (interactive) void restartLocalPreview(false);
                }
            }

            if (!applyRetryTimerRef.current && Object.keys(applyQueuedRef.current).length === 0) {
                applyIdempotencyKeyRef.current = null;
            }
        },
        [appId, fetchFreshCsrf, getApplyIdempotencyKey, getStoredPreviewCode, restartLocalPreview, showAlert]
    );

    const queuePreviewApply = useCallback(
        (changes: Array<{ path: string; content: string }>, { interactive }: { interactive: boolean }) => {
            if (!appId) return;
            if (!changes?.length) return;

            for (const c of changes) {
                const p = String(c?.path || "").trim();
                if (!p) continue;
                if (changeIsNotHotUpdatable(p)) {
                    void restartLocalPreview(false);
                    continue;
                }

                const nextContent = String(c?.content ?? "");
                // Dedupe: avoid re-applying identical content repeatedly (e.g. Firebase snapshot echoes).
                if (applyQueuedRef.current[p] === nextContent) continue;
                if (lastAppliedContentRef.current[p] === nextContent) continue;

                applyQueuedRef.current[p] = nextContent;
            }

            if (applyDebounceRef.current) {
                clearTimeout(applyDebounceRef.current);
                applyDebounceRef.current = null;
            }

            // Small debounce to coalesce rapid edits (especially from AI).
            applyDebounceRef.current = setTimeout(() => {
                applyDebounceRef.current = null;
                void flushPreviewApply({ interactive });
            }, 250);
        },
        [appId, changeIsNotHotUpdatable, flushPreviewApply, showAlert]
    );

    const applyPreviewChangesNow = useCallback(
        async (
            changes: Array<{ path: string; content: string }>,
            { interactive, source }: { interactive: boolean; source?: string }
        ) => {
            if (!appId) return;
            if (!changes?.length) return;

            const files: Array<{ path: string; content: string }> = [];
            for (const c of changes) {
                const p = String(c?.path || "").trim();
                if (!p) continue;
                if (changeIsNotHotUpdatable(p)) {
                    await restartLocalPreview(false);
                    return;
                }

                const nextContent = String(c?.content ?? "");
                delete lastAppliedContentRef.current[p];
                files.push({ path: p, content: nextContent });
            }

            if (files.length === 0) return;

            const csrf = await fetchFreshCsrf();
            const activeCode = getStoredPreviewCode();
            let nextCode = "";
            try {
                const result = await postPreviewApply({
                    appId,
                    files,
                    csrf,
                    code: activeCode,
                    idempotencyKey: getApplyIdempotencyKey(),
                    source,
                });
                nextCode = result.nextCode;

                const restartRequired = Boolean(
                    result.restartPending ||
                    result.requiresRestart ||
                    result.requiresRebuild ||
                    result.needsRebuild ||
                    result.touchesPublicAssets ||
                    result.hmrLikely === false
                );

                console.info("[preview-apply] backend apply result", {
                    source: source || "unknown",
                    outcome: result.outcome,
                    restartPending: result.restartPending,
                    requiresRestart: result.requiresRestart,
                    requiresRebuild: result.requiresRebuild,
                    needsRebuild: result.needsRebuild,
                    touchesPublicAssets: result.touchesPublicAssets,
                    hmrLikely: result.hmrLikely,
                    retryable: result.retryable,
                    retryAfterSeconds: result.retryAfterSeconds,
                });

                if (restartRequired) {
                    console.warn("[preview-apply] apply wrote files but restart is required; restarting preview", {
                        source: source || "unknown",
                        outcome: result.outcome,
                    });
                    await restartLocalPreview(false);
                }
            } catch (err) {
                if (interactive) {
                    const message = err instanceof Error ? err.message : String(err || "Preview apply failed");
                    void showAlert(message, "Live update");
                }
                throw err;
            }

            if (nextCode) {
                try {
                    localStorage.setItem(
                        `webcontainer_${appId}`,
                        JSON.stringify({ code: nextCode, timestamp: Date.now() }),
                    );
                } catch {
                    // ignore
                }
            }

            for (const file of files) {
                lastAppliedContentRef.current[file.path] = file.content;
            }
        },
        [appId, changeIsNotHotUpdatable, fetchFreshCsrf, getApplyIdempotencyKey, getStoredPreviewCode, restartLocalPreview, showAlert]
    );

    useEffect(() => {
        applyPreviewChangesNowRef.current = applyPreviewChangesNow;
    }, [applyPreviewChangesNow]);

    useEffect(() => {
        // Keep the draft in sync when app data loads.
        const next = (app?.vercelProtectionBypassSecret || "").toString();
        setVercelProtectionBypassDraft(next);
    }, [app?.vercelProtectionBypassSecret]);

    const saveVercelProtectionBypass = useCallback(async () => {
        if (!appId) return;
        if (savingVercelProtectionBypass) return;

        setSavingVercelProtectionBypass(true);
        try {
            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/settings`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                body: JSON.stringify({
                    vercelProtectionBypassSecret: vercelProtectionBypassDraft.trim() || null,
                }),
            });

            const data = await res.json().catch(() => ({} as any));
            if (!res.ok || !data?.ok) {
                throw new Error((data as any)?.error || `Failed to save (HTTP ${res.status})`);
            }

            const saved = (data?.vercelProtectionBypassSecret || "").toString();
            setApp((prev) => (prev ? { ...prev, vercelProtectionBypassSecret: saved || null } : prev));

            // Immediately retry embedding if we have a URL.
            const url = (protectedPreviewUrl || "").trim();
            if (url) {
                setPreviewError(null);
                setApp((prev) => (prev ? { ...prev, previewUrl: url } : prev));
                setRefreshKey((k) => k + 1);
            }
        } catch (err: any) {
            console.error("Failed to save Vercel protection bypass", err);
            setPreviewError(err?.message || "Failed to save protection bypass secret.");
        } finally {
            setSavingVercelProtectionBypass(false);
        }
    }, [appId, savingVercelProtectionBypass, vercelProtectionBypassDraft, protectedPreviewUrl]);

    const enableVercelProtectionBypassAutomatically = useCallback(async (): Promise<string> => {
        if (!appId) throw new Error("Missing appId");
        if (enablingVercelProtectionBypass) throw new Error("Bypass is already being enabled");

        setEnablingVercelProtectionBypass(true);
        try {
            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/vercel/protection-bypass`, {
                method: "POST",
                headers: csrfHeaders(csrf),
                credentials: "include",
            });

            const data = await res.json().catch(() => ({} as any));
            if (!res.ok || !data?.ok) {
                const code = (data as any)?.code;
                const message = (data as any)?.error || `Failed to enable bypass (HTTP ${res.status})`;
                if (code === "vercel_bypass_not_supported") {
                    setAutoPreviewBypassUnsupported(true);
                }
                const err = new Error(message) as CodedError;
                err.code = code;
                throw err;
            }

            const secret = (data?.vercelProtectionBypassSecret || "").toString().trim();
            if (!secret) {
                throw new Error("Bypass enabled but no secret was returned.");
            }

            setVercelProtectionBypassDraft(secret);
            setApp((prev) => (prev ? { ...prev, vercelProtectionBypassSecret: secret } : prev));
            return secret;
        } finally {
            setEnablingVercelProtectionBypass(false);
        }
    }, [appId, enablingVercelProtectionBypass]);

    const runAutoPreviewSequence = useCallback(
        async (opts?: { force?: boolean }) => {
            if (!appId) return;

            const runId = ++autoPreviewRunIdRef.current;
            const maxAttempts = 4;

            setAutoPreviewError(null);
            setAutoPreviewAttempt(0);
            setAutoPreviewBypassUnsupported(false);
            setPreviewMode("webcontainer");

            // If a preview URL exists already and we're not forcing a fresh start, just try to load it.
            if (!opts?.force) {
                const existing = (appRef.current?.previewUrl || "").trim();
                if (existing) {
                    setAutoPreviewPhase("loading");
                    setRefreshKey((k) => k + 1);
                    setAutoPreviewPhase("ready");
                    return;
                }
            }

            setAutoPreviewPhase("checking");

            // NOTE: embedded preview now always uses the local runner. Vercel preview deploys are handled via Deploy.
            setAutoPreviewPhase("ready");
            return;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                if (autoPreviewRunIdRef.current !== runId) return;
                setAutoPreviewAttempt(attempt);
                setAutoPreviewPhase("building");
                setPreviewError(null);
                setProtectedPreviewUrl(null);
                setVercelSecuritySettingsUrl(null);
                setVercelDeploymentProtectionSettingsUrl(null);

                try {
                    const csrf = await ensureSessionAndCsrf().catch(() => null);
                    const res = await fetch(`/api/app-builder/${appId}/preview`, {
                        method: "POST",
                        headers: csrfHeaders(csrf),
                        credentials: "include",
                    });

                    const data = await res.json().catch(() => ({} as any));

                    if (!res.ok || !data?.ok) {
                        const code = (data as any)?.code;

                        if (code === "vercel_not_connected") {
                            await refreshVercelStatus().catch(() => null);
                            if (isVercelConnectedRef.current) {
                                continue;
                            }
                            setAutoPreviewPhase("connecting");
                            setVercelConnectOpen(true);
                            return;
                        }

                        if (code === "vercel_deployment_protected") {
                            const url = (data?.url || data?.previewUrl || data?.deploymentUrl || "").toString();
                            if (url) setProtectedPreviewUrl(url);

                            const deploymentProtectionUrl = (data?.vercelDeploymentProtectionSettingsUrl || "").toString();
                            if (deploymentProtectionUrl) setVercelDeploymentProtectionSettingsUrl(deploymentProtectionUrl);
                            const securityUrl = (data?.vercelSecuritySettingsUrl || "").toString();
                            if (securityUrl) setVercelSecuritySettingsUrl(securityUrl);

                            // Seamless path: if we don't have a bypass secret yet, create/store one and retry embedding.
                            const existingSecret = (appRef.current?.vercelProtectionBypassSecret || "").toString().trim();
                            if (!existingSecret) {
                                setAutoPreviewPhase("enabling-bypass");
                                try {
                                    await enableVercelProtectionBypassAutomatically();
                                } catch (e: any) {
                                    const coded = e as CodedError;
                                    if (coded?.code === "vercel_bypass_not_supported") {
                                        setAutoPreviewError(PREVIEW_RECOVERY_MESSAGE);
                                        setPreviewMode("webcontainer");
                                        setAutoPreviewPhase("error");
                                        return;
                                    }
                                    throw e;
                                }
                            }

                            // Try embedding immediately using the returned deployment URL.
                            if (url) {
                                setAutoPreviewPhase("loading");
                                setPreviewError(null);
                                setApp((prev) => (prev ? { ...prev, previewUrl: url } : prev));
                                setRefreshKey((k) => k + 1);
                                setAutoPreviewPhase("ready");
                                return;
                            }

                            throw new Error((data as any)?.error || "Preview deployment is protected.");
                        }

                        throw new Error((data as any)?.error || `Preview failed (HTTP ${res.status})`);
                    }

                    const nextPreviewUrl = (data?.previewUrl || data?.url || "").toString();
                    if (!nextPreviewUrl) {
                        throw new Error("Preview succeeded but no URL was returned.");
                    }

                    setAutoPreviewPhase("loading");
                    setApp((prev) => (prev ? { ...prev, previewUrl: nextPreviewUrl } : prev));
                    setRefreshKey((k) => k + 1);
                    setAutoPreviewPhase("ready");
                    return;
                } catch (err: any) {
                    if (autoPreviewRunIdRef.current !== runId) return;

                    setAutoPreviewError(PREVIEW_RECOVERY_MESSAGE);
                    setAutoPreviewPhase("error");

                    // Retry automatically on likely transient network failures.
                    if (isLikelyNetworkError(err) && attempt < maxAttempts) {
                        const backoff = 800 * Math.min(6, attempt);
                        await sleep(backoff);
                        continue;
                    }
                    return;
                }
            }
        },
        [appId, enableVercelProtectionBypassAutomatically, refreshVercelStatus],
    );

    // Load app data
    useEffect(() => {
        if (authLoading) return;
        if (hasInitialAppData) {
            setApp(initialAppData);
            setFilesHydrated(true);
            setIsPreviewBootReady(true);
            setFilesHydrationProgress(100);
            setLoading(false);
            setLastDeployLiveUrl(typeof initialAppData?.productionUrl === "string" ? initialAppData.productionUrl.trim() || null : null);
            setLastSharePreviewUrl(typeof initialAppData?.previewUrl === "string" ? initialAppData.previewUrl.trim() || null : null);
            setDeployBannerFromApp(buildDeployErrorBannerFromApp(initialAppData));
            return;
        }

        let didCancel = false;
        const controller = new AbortController();
        const normalizedAppId = String(appId || "").trim();
        const isDraftPromotionAppId = normalizedAppId.startsWith("draftapp_");
        const isFreshUrlGeneratedApp =
            isDraftPromotionAppId ||
            normalizedAppId.startsWith("app_") ||
            agentWelcomeContext?.source === "url";
        const readResponseJson = async (res: Response) => {
            try {
                return await res.json();
            } catch {
                return null;
            }
        };

        const loadApp = async () => {
            let filesHydrationActivityStarted = false;
            try {
                if (!user?.uid) {
                    await handleSessionExpired("app_builder_missing_user");
                    return;
                }

                beginFilesHydrationActivity();
                filesHydrationActivityStarted = true;

                const fetchFiles = async (forceRefreshToken: boolean) => {
                    await bootstrapServerSession({
                        forceRefresh: forceRefreshToken,
                        minIntervalMs: forceRefreshToken ? 0 : 10 * 60 * 1000,
                        timeoutMs: 12_000,
                        reason: "app_builder_load",
                    }).catch(() => false);

                    const authHeaders = await getOptionalAuthHeaders(forceRefreshToken);

                    return fetch('/api/app-builder/' + encodeURIComponent(appId) + '/files', {
                        method: "GET",
                        credentials: "include",
                        cache: "no-store",
                        signal: controller.signal,
                        headers: authHeaders,
                    });
                };

                let attempt = 0;
                let delayMs = 750;
                const maxAttempts = 36;

                while (!didCancel && attempt < maxAttempts) {
                    attempt += 1;

                    let res = await fetchFiles(false);
                    if (res.status === 401) {
                        res = await fetchFiles(true);
                    }

                    if (res.status === 401 || res.status === 403) {
                        clearFilesHydrationTimer();
                        await handleSessionExpired("app_builder_load_unauthorized");
                        return;
                    }

                    const data = await readResponseJson(res);

                    if (res.status === 200) {
                        if (didCancel) return;
                        const rawApp = data as AppData;
                        setFilesHydrated(false);
                        setIsPreviewBootReady(false);
                        setApp(rawApp);
                        setFilesHydrationProgress(1);
                        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
                        const liveUrl = typeof rawApp?.productionUrl === "string" ? rawApp.productionUrl.trim() : "";
                        setLastDeployLiveUrl(liveUrl || null);
                        const previewShareUrl = typeof rawApp?.previewUrl === "string" ? rawApp.previewUrl.trim() : "";
                        setLastSharePreviewUrl(previewShareUrl || null);
                        buildFileTree(rawApp.files);
                        if (!didCancel) setLoading(false);

                        await (async () => {
                            try {
                                advanceFilesHydrationProgress(22);
                                await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
                                const bootApp = await hydratePrimaryHtmlFileForApp(rawApp, {
                                    onProgress: (progress) => {
                                        setFilesHydrationProgress(Math.max(0, Math.min(100, Math.round(22 + (progress * 0.78)))));
                                    },
                                });
                                if (didCancel) return;
                                setApp(bootApp);
                                buildFileTree(bootApp.files);
                                setIsPreviewBootReady(true);
                                setFilesHydrationProgress(100);
                            } catch (hydrationErr) {
                                if (didCancel) return;
                                console.warn("[app-builder] primary preview file hydration failed", hydrationErr);
                                setIsPreviewBootReady(true);
                                setFilesHydrationProgress(100);
                            }

                            const backgroundHydrationPromise = (async (): Promise<AppData | null> => {
                                try {
                                    const hydratedData = await hydrateHtmlFilesForApp(rawApp);
                                    if (didCancel) return null;
                                    setApp(hydratedData);
                                    buildFileTree(hydratedData.files);
                                    setFilesHydrated(true);
                                    return hydratedData;
                                } catch (hydrationErr) {
                                    if (didCancel) return null;
                                    console.warn("[app-builder] background file hydration failed", hydrationErr);
                                    setFilesHydrated(true);
                                    return null;
                                }
                            })();

                            filesHydrationInFlightRef.current = backgroundHydrationPromise;
                            try {
                                await backgroundHydrationPromise;
                            } finally {
                                if (filesHydrationInFlightRef.current === backgroundHydrationPromise) {
                                    filesHydrationInFlightRef.current = null;
                                }
                            }
                        })();
                        return;
                    }

                    if (res.status === 202 || res.status === 409) {
                        const nextDelay = typeof data?.nextPollAfterMs === "number" && Number.isFinite(data.nextPollAfterMs)
                            ? Math.max(400, Math.min(5000, Math.floor(data.nextPollAfterMs)))
                            : delayMs;
                        await sleep(nextDelay);
                        delayMs = Math.min(5000, Math.max(500, Math.floor(delayMs * 1.35)));
                        continue;
                    }

                    if (res.status === 422) {
                        const message = String(data?.error || data?.message || data?.detail || "This app is not ready yet.");
                        console.error("App preparation failed while loading editor", {
                            appId: normalizedAppId,
                            freshUrlGeneratedApp: isFreshUrlGeneratedApp,
                            status: 422,
                            message,
                        });
                        clearFilesHydrationTimer();
                        setError(message);
                        setFilesHydrated(true);
                        setIsPreviewBootReady(true);
                        return;
                    }

                    if (res.status === 404) {
                        const message = String(data?.error || data?.message || "This app is still syncing its files.");
                        console.warn("App files are not ready yet while loading editor", {
                            appId: normalizedAppId,
                            freshUrlGeneratedApp: isFreshUrlGeneratedApp,
                            status: 404,
                            attempt,
                        });
                        await sleep(delayMs);
                        delayMs = Math.min(5000, Math.max(500, Math.floor(delayMs * 1.35)));
                        continue;
                    }

                    if (!res.ok) {
                        throw new Error("Failed to load app: " + res.status + " " + res.statusText);
                    }
                }

                if (!didCancel) {
                    setError("This app is still syncing its files. We’ll keep trying to load it.");
                    setFilesHydrated(true);
                    setIsPreviewBootReady(true);
                }
            } catch (err: any) {
                if (didCancel) return;
                if (err?.name === "AbortError") return;
                const msg = String(err?.message || "").toLowerCase();
                const code = String(err?.code || "").toLowerCase();
                if (msg.includes("401") || msg.includes("unauthorized") || code.includes("permission-denied")) {
                    await handleSessionExpired("app_builder_load_catch_unauthorized");
                    return;
                }
                console.error("Error loading app:", err);
                // For network errors or server errors, don't close immediately.
                // Show error state instead.
                setError(err instanceof Error ? err.message : "Failed to load app");
                setFilesHydrated(true);
                setIsPreviewBootReady(true);
            } finally {
                if (filesHydrationActivityStarted) {
                    endFilesHydrationActivity();
                }
                if (!didCancel) setLoading(false);
            }
        };

        loadApp();
        return () => {
            didCancel = true;
            controller.abort();
        };
    }, [
        advanceFilesHydrationProgress,
        agentWelcomeContext?.source,
        appId,
        authLoading,
        beginFilesHydrationActivity,
        buildFileTree,
        clearFilesHydrationTimer,
        endFilesHydrationActivity,
        getOptionalAuthHeaders,
        hasInitialAppData,
        handleSessionExpired,
        initialAppData,
        user,
    ]);

    // Firebase real-time listener for instant UI updates when files change
    useEffect(() => {
        if (!appId || !user?.uid) return;

        const unsubscribe = onSnapshot(
            doc(db, "kloner_users", user.uid, "kloner_apps", appId),
            (docSnapshot) => {
                if (!docSnapshot.exists()) return;

                const firebaseData = docSnapshot.data();
                if (!firebaseData) return;

                void (async () => {
                    const prevApp = appRef.current;
                    if (!prevApp) {
                        const initialApp: AppData = {
                            id: appId,
                            name: typeof (firebaseData as any).name === "string" ? String((firebaseData as any).name) : "Untitled Project",
                            files: ((firebaseData as any).files || {}) as AppData["files"],
                            htmlStoragePath: (firebaseData as any).htmlStoragePath || null,
                            htmlByteLength:
                                typeof (firebaseData as any).htmlByteLength === "number"
                                    ? (firebaseData as any).htmlByteLength
                                    : null,
                            htmlEditIndex: (firebaseData as any).htmlEditIndex,
                            generationStatus: (firebaseData as any).generationStatus || null,
                            generationError: (firebaseData as any).generationError || null,
                            generationProgress:
                                typeof (firebaseData as any).generationProgress === "number"
                                    ? (firebaseData as any).generationProgress
                                    : null,
                            generation: normalizeGenerationState(firebaseData) as AppData["generation"],
                            isDeployed: Boolean((firebaseData as any).isDeployed),
                            productionUrl: (firebaseData as any).productionUrl || null,
                            previewUrl: (firebaseData as any).previewUrl || null,
                            vercelProjectId: (firebaseData as any).vercelProjectId || undefined,
                            vercelProtectionBypassSecret: (firebaseData as any).vercelProtectionBypassSecret || null,
                            lastDeploymentId: (firebaseData as any).lastDeploymentId || null,
                            lastDeploymentState: (firebaseData as any).lastDeploymentState || null,
                            lastDeploymentErrorCode: (firebaseData as any).lastDeploymentErrorCode || null,
                            lastDeploymentErrorMessage: (firebaseData as any).lastDeploymentErrorMessage || null,
                            lastDeploymentErrorAt: (firebaseData as any).lastDeploymentErrorAt || null,
                            lastDeploymentUrl: (firebaseData as any).lastDeploymentUrl || null,
                            updatedAt: (firebaseData as any).updatedAt,
                        };
                        setApp(initialApp);
                        setDeployBannerFromApp(buildDeployErrorBannerFromApp(initialApp));
                        buildFileTree(initialApp.files);
                        const nextLiveUrl = typeof (firebaseData as any).productionUrl === "string"
                            ? (firebaseData as any).productionUrl.trim()
                            : "";
                        setLastDeployLiveUrl(nextLiveUrl || null);
                        const previewUrl = typeof (firebaseData as any).previewUrl === "string"
                            ? (firebaseData as any).previewUrl.trim()
                            : "";
                        setLastSharePreviewUrl(previewUrl || null);
                        if (loading) setLoading(false);
                        return;
                    }

                    const nextGeneration = normalizeGenerationState(firebaseData);
                    const nextGenStatus = nextGeneration.status;
                    const nextGenError = nextGeneration.error;
                    const nextGenProgress = nextGeneration.progress;
                    const nextDeployBanner = buildDeployErrorBannerFromApp({
                        lastDeploymentId: (firebaseData as any).lastDeploymentId || prevApp.lastDeploymentId || null,
                        lastDeploymentState: (firebaseData as any).lastDeploymentState || prevApp.lastDeploymentState || null,
                        lastDeploymentErrorCode: (firebaseData as any).lastDeploymentErrorCode || prevApp.lastDeploymentErrorCode || null,
                        lastDeploymentErrorMessage: (firebaseData as any).lastDeploymentErrorMessage || prevApp.lastDeploymentErrorMessage || null,
                        lastDeploymentErrorAt: (firebaseData as any).lastDeploymentErrorAt || prevApp.lastDeploymentErrorAt || null,
                        lastDeploymentUrl: (firebaseData as any).lastDeploymentUrl || prevApp.lastDeploymentUrl || null,
                    });

                    const generationStatusChanged =
                        prevApp.generationStatus !== nextGenStatus ||
                        prevApp.generationError !== nextGenError ||
                        prevApp.generationProgress !== nextGenProgress ||
                        generationStateChanged(prevApp.generation, nextGeneration);

                    const deployStatusChanged =
                        prevApp.lastDeploymentId !== (firebaseData as any).lastDeploymentId ||
                        prevApp.lastDeploymentState !== (firebaseData as any).lastDeploymentState ||
                        prevApp.lastDeploymentErrorCode !== (firebaseData as any).lastDeploymentErrorCode ||
                        prevApp.lastDeploymentErrorMessage !== (firebaseData as any).lastDeploymentErrorMessage ||
                        prevApp.lastDeploymentErrorAt !== (firebaseData as any).lastDeploymentErrorAt ||
                        prevApp.lastDeploymentUrl !== (firebaseData as any).lastDeploymentUrl;

                    const hasFilesUpdate = Boolean((firebaseData as any).files);
                    const mergedFiles = hasFilesUpdate
                        ? mergeFilesPreferNewest(prevApp.files, (firebaseData as any).files)
                        : prevApp.files;

                    const filesAreEffectivelySame = hasFilesUpdate
                        ? filesShallowEqualByContentAndTimestamp(prevApp.files, mergedFiles)
                            && (prevApp.htmlStoragePath || null) === ((firebaseData as any).htmlStoragePath || prevApp.htmlStoragePath || null)
                            && (prevApp.htmlEditIndex ?? null) === (((firebaseData as any).htmlEditIndex ?? prevApp.htmlEditIndex) ?? null)
                            && (typeof (firebaseData as any).htmlByteLength === "number"
                                ? (firebaseData as any).htmlByteLength
                                : prevApp.htmlByteLength ?? null) === (prevApp.htmlByteLength ?? null)
                        : true;

                    const hydratedApp = hasFilesUpdate
                        ? filesAreEffectivelySame
                            ? prevApp
                            : await hydrateHtmlFilesForApp(
                                {
                                    ...prevApp,
                                    files: mergedFiles,
                                    htmlStoragePath: (firebaseData as any).htmlStoragePath || prevApp.htmlStoragePath || null,
                                    htmlEditIndex: (firebaseData as any).htmlEditIndex ?? prevApp.htmlEditIndex,
                                    htmlByteLength:
                                        typeof (firebaseData as any).htmlByteLength === "number"
                                            ? (firebaseData as any).htmlByteLength
                                            : prevApp.htmlByteLength ?? null,
                                },
                                {
                                    onProgress: (progress) => {
                                        setFilesHydrationProgress(Math.max(0, Math.min(100, Math.round(progress))));
                                    },
                                },
                            )
                        : prevApp;

                    const filesChanged = hasFilesUpdate
                        ? !filesShallowEqualByContentAndTimestamp(prevApp.files, hydratedApp.files)
                        : false;

                    if (!filesChanged && !generationStatusChanged && !deployStatusChanged) return;

                    const updatedApp: AppData = {
                        ...hydratedApp,
                        htmlStoragePath: (firebaseData as any).htmlStoragePath || hydratedApp.htmlStoragePath || null,
                        htmlByteLength:
                            typeof (firebaseData as any).htmlByteLength === "number"
                                ? (firebaseData as any).htmlByteLength
                                : hydratedApp.htmlByteLength ?? null,
                        htmlEditIndex: (firebaseData as any).htmlEditIndex ?? hydratedApp.htmlEditIndex,
                        generationStatus: nextGenStatus,
                        generationError: nextGenError,
                        generationProgress: nextGenProgress,
                        generation: nextGeneration,
                        isDeployed: Boolean((firebaseData as any).isDeployed),
                        productionUrl: (firebaseData as any).productionUrl || null,
                        lastDeploymentId: (firebaseData as any).lastDeploymentId || hydratedApp.lastDeploymentId || null,
                        lastDeploymentState: (firebaseData as any).lastDeploymentState || hydratedApp.lastDeploymentState || null,
                        lastDeploymentErrorCode: (firebaseData as any).lastDeploymentErrorCode || hydratedApp.lastDeploymentErrorCode || null,
                        lastDeploymentErrorMessage: (firebaseData as any).lastDeploymentErrorMessage || hydratedApp.lastDeploymentErrorMessage || null,
                        lastDeploymentErrorAt: (firebaseData as any).lastDeploymentErrorAt || hydratedApp.lastDeploymentErrorAt || null,
                        lastDeploymentUrl: (firebaseData as any).lastDeploymentUrl || hydratedApp.lastDeploymentUrl || null,
                        updatedAt: (firebaseData as any).updatedAt,
                    };

                    const nextLiveUrl = typeof (firebaseData as any).productionUrl === "string"
                        ? (firebaseData as any).productionUrl.trim()
                        : "";
                    setLastDeployLiveUrl(nextLiveUrl || null);
                    setDeployBannerFromApp(nextDeployBanner);

                    if (filesChanged) {
                        buildFileTree(updatedApp.files);

                        const openPath = currentFileRef.current;
                        if (openPath && (updatedApp.files as any)[openPath]) {
                            setCode((updatedApp.files as any)[openPath].content);
                        }

                        if (previewMode !== "webcontainer") {
                            queuePreviewReloadFromFirebase();
                            try {
                                const changes: Array<{ path: string; content: string }> = [];
                                const prevFiles = prevApp.files || ({} as any);
                                const nextFiles = updatedApp.files || ({} as any);
                                for (const p of Object.keys(nextFiles)) {
                                    const nextContent = (nextFiles as any)?.[p]?.content;
                                    if (typeof nextContent !== "string") continue;
                                    const prevContent = (prevFiles as any)?.[p]?.content;
                                    if (typeof prevContent === "string" && prevContent === nextContent) continue;
                                    changes.push({ path: p, content: nextContent });
                                }
                                if (changes.length) {
                                    queuePreviewApply(changes, { interactive: false });
                                }
                            } catch {
                                // ignore
                            }
                        }
                    }

                    setApp(updatedApp);
                })();
            },
            (error) => {
                const code = String((error as any)?.code || "").toLowerCase();
                if (code.includes("permission-denied")) {
                    void handleSessionExpired("app_builder_doc_listener_permission_denied");
                    return;
                }
                console.error("Firebase listener error:", error);
            }
        );

        return () => {
            try {
                unsubscribe();
            } catch (err) {
                // Firestore can throw internal assertion errors in rare edge cases
                // (e.g. rapid subscribe/unsubscribe or React strict-mode double-invoke).
                console.warn("Firebase listener unsubscribe error:", err);
            }
        };
    }, [appId, buildFileTree, loading, previewMode, user?.uid, queuePreviewApply, queuePreviewReloadFromFirebase, handleSessionExpired]);

    const generationJobId = useMemo(() => asTrimmedString(app?.generation?.jobId), [app?.generation?.jobId]);

    useEffect(() => {
        if (!appId || !user?.uid || !generationJobId) return;

        const jobRef = doc(db, "app_generation_jobs", generationJobId);
        const unsubscribe = onSnapshot(
            jobRef,
            (snap) => {
                if (!snap.exists()) return;
                const jobGeneration = normalizeGenerationState(snap.data());
                setApp((prevApp) => {
                    if (!prevApp) return prevApp;

                    const mergedGeneration = {
                        ...(prevApp.generation || {}),
                        ...jobGeneration,
                    };

                    if (!generationStateChanged(prevApp.generation, mergedGeneration)) return prevApp;

                    return {
                        ...prevApp,
                        generation: mergedGeneration,
                        generationStatus: mergedGeneration.status,
                        generationError: mergedGeneration.error,
                        generationProgress: mergedGeneration.progress,
                    };
                });
            },
            () => {
                // Best effort only. The app doc listener still carries the legacy screenshot flow.
            },
        );

        return () => {
            try {
                unsubscribe();
            } catch (err) {
                console.warn("Generation job listener unsubscribe error:", err);
            }
        };
    }, [appId, generationJobId, user?.uid]);

    // Load panel width from localStorage on mount
    useEffect(() => {
        try {
            const savedWidth = window.localStorage.getItem('app-builder-left-panel-width');
            if (savedWidth) {
                const width = parseInt(savedWidth, 10);
                if (width >= 300 && width <= 800) { // Reasonable bounds
                    setLeftPanelWidth(width);
                }
            }
        } catch {
            // Some browsers/webviews block storage access; keep default width.
        }
    }, []);

    // Save panel width to localStorage when it changes
    useEffect(() => {
        try {
            window.localStorage.setItem('app-builder-left-panel-width', leftPanelWidth.toString());
        } catch {
            // Ignore storage write failures to avoid crashing editor mount.
        }
    }, [leftPanelWidth]);

    // Handle resize mouse events
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            
            const container = document.querySelector('[data-app-builder-container]');
            if (!container) return;
            
            const containerRect = container.getBoundingClientRect();
            const newWidth = e.clientX - containerRect.left;
            
            // Constrain width between 300px and 800px
            const constrainedWidth = Math.max(300, Math.min(800, newWidth));
            setLeftPanelWidth(constrainedWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing]);

    useEffect(() => {
        if (!hasInitialAppData || !initialAppData) return;
        buildFileTree(initialAppData.files);
    }, [buildFileTree, hasInitialAppData, initialAppData]);

    const handleFileSelect = (path: string) => {
        if (app?.files[path]) {
            setCurrentFile(path);
            setCode(app.files[path].content);
        }
    };

    const handleToggleFolder = useCallback((path: string) => {
        setExpandedFolders((prev) => ({
            ...prev,
            [path]: !(prev[path] ?? true),
        }));
    }, []);

    const handleCodeChange = (value: string | undefined) => {
        const newCode = value || "";
        setCode(newCode);

        // Auto-save after a delay
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }
        autoSaveTimeoutRef.current = setTimeout(() => {
            handleSave(false);
        }, 1000);
    };

    const handleFilesReplaceFromServer = useCallback(
        (nextFiles: { [path: string]: { content: string; lastModified: number } }) => {
            const normalizedNextFiles = normalizeIncomingFilesMap(nextFiles);

            if (suppressNextFilesReplaceApplyRef.current) {
                suppressNextFilesReplaceApplyRef.current = false;
                setApp((prev) => (prev ? { ...prev, files: normalizedNextFiles } : null));
                buildFileTree(normalizedNextFiles as any);
                if (currentFile) {
                    const next = normalizedNextFiles[currentFile]?.content;
                    if (typeof next === "string") setCode(next);
                    else setCode("");
                }
                return;
            }

            // Live-apply the diff so the running preview reflects server-driven file updates
            // (restore points, server sync) without requiring a manual Save.
            try {
                const prevFiles = appRef.current?.files || ({} as any);
                const changes: Array<{ path: string; content: string }> = [];
                for (const p of Object.keys(normalizedNextFiles || {})) {
                    const nextContent = (normalizedNextFiles as any)?.[p]?.content;
                    if (typeof nextContent !== "string") continue;
                    const prevContent = (prevFiles as any)?.[p]?.content;
                    if (typeof prevContent === "string" && prevContent === nextContent) continue;
                    changes.push({ path: p, content: nextContent });
                }
                if (changes.length) {
                    queuePreviewApply(changes, { interactive: false });
                }
            } catch {
                // ignore
            }

            setApp((prev) => (prev ? { ...prev, files: normalizedNextFiles } : null));

            // Keep file tree in sync (e.g. newly created files).
            buildFileTree(normalizedNextFiles as any);

            if (currentFile) {
                const next = normalizedNextFiles[currentFile]?.content;
                if (typeof next === "string") setCode(next);
                else setCode("");
            }
        },
        [buildFileTree, currentFile, queuePreviewApply]
    );

    // If we used a placeholder preview while generating, rebuild the machine with the real files
    // once generation completes. Important: generationStatus can flip to "ready" before files are
    // fully written, so we re-hydrate from the server first.
    const lastGenStatusRef = useRef<string | undefined>(undefined);
    const generationBaselineFilesRef = useRef<AppData["files"] | null>(null);
    const generationRehydrateInFlightRef = useRef(false);
    useEffect(() => {
        const status = activeGeneration.status || undefined;
        const prev = lastGenStatusRef.current;
        lastGenStatusRef.current = status;

        if (isGenerationInProgress(activeGeneration) && !isGenerationInProgressStatus(prev)) {
            generationBaselineFilesRef.current = (app?.files as any) || null;
        }

        if (isGenerationInProgressStatus(prev) && status === "ready" && usedPlaceholderRef.current) {
            if (generationRehydrateInFlightRef.current) return;
            usedPlaceholderRef.current = false;
            generationRehydrateInFlightRef.current = true;

            void (async () => {
                try {
                    if (!appId) return;

                    // Mirror AppBuilderEditorAgentChat's flow: refresh session before syncing files.
                    await ensureSessionAndCsrf().catch(() => null);

                    const baseline = generationBaselineFilesRef.current || (app?.files as any) || ({} as any);
                    let lastFetchedFiles: any = null;
                    const start = Date.now();
                    const maxWaitMs = 20000;
                    const intervalMs = 1000;

                    while (Date.now() - start < maxWaitMs) {
                        try {
                            const res = await fetch(`/api/app-builder/${appId}/files`, {
                                method: "GET",
                                credentials: "include",
                                cache: "no-store",
                            });
                            if (res.ok) {
                                const data = await res.json().catch(() => null);
                                const nextFiles = (data as any)?.files;
                                if (nextFiles && typeof nextFiles === "object") {
                                    lastFetchedFiles = nextFiles;
                                    const differsFromBaseline =
                                        !filesShallowEqualByContentAndTimestamp(baseline as any, nextFiles as any);
                                    const differsFromCurrent =
                                        !filesShallowEqualByContentAndTimestamp((app?.files as any) || ({} as any), nextFiles as any);

                                    if (differsFromBaseline || differsFromCurrent) {
                                        suppressNextFilesReplaceApplyRef.current = true;
                                        handleFilesReplaceFromServer(nextFiles);
                                        break;
                                    }
                                }
                            }
                        } catch {
                            // ignore and retry
                        }

                        await new Promise((resolve) => setTimeout(resolve, intervalMs));
                    }

                    if (lastFetchedFiles) {
                        // Even if the server responded with the same files, use the server copy as the
                        // canonical source of truth before we start a fresh machine.
                        suppressNextFilesReplaceApplyRef.current = true;
                        handleFilesReplaceFromServer(lastFetchedFiles);
                    }
                } finally {
                    generationBaselineFilesRef.current = null;
                    generationRehydrateInFlightRef.current = false;

                    // Use the same canonical “force fresh” pathway as the AI agent.
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(
                            new CustomEvent("kloner:preview-force-fresh", {
                                detail: { appId, reason: "generation-ready" },
                            }),
                        );
                    } else {
                        await restartLocalPreview(true);
                    }
                }
            })();
        }
    }, [activeGeneration.status, app?.files, appId, handleFilesReplaceFromServer, restartLocalPreview]);

    const handleRestoreApplied = useCallback(
        async ({ previousFiles, restoredFiles }: { previousFiles: AppData["files"]; restoredFiles: AppData["files"] }) => {
            suppressNextFilesReplaceApplyRef.current = true;
            await applyDiffToWebcontainerAndMaybeRestart(previousFiles, restoredFiles, { interactive: true });
        },
        [applyDiffToWebcontainerAndMaybeRestart]
    );

    function canonicalizeEditPath(
        rawPath: string,
        files: AppData["files"] | null | undefined,
    ): string {
        const trimmed = String(rawPath || "").trim();
        if (!trimmed) return "";

        // Normalize leading slashes to avoid creating duplicate keys.
        let p = trimmed.replace(/^\/+/, "");

        const hasFiles = !!files && typeof files === "object";
        if (hasFiles && (files as any)[p]) return p;

        const keys = hasFiles ? Object.keys(files as any) : [];
        const hasAnyPrefix = (prefix: string) => keys.some((k) => String(k).startsWith(prefix));

        // Prefer src/* roots if present (Next.js convention).
        if (p.startsWith("app/") && hasAnyPrefix("src/app/")) {
            const mapped = `src/${p}`;
            if ((files as any)?.[mapped]) return mapped;
            p = mapped;
        } else if (p.startsWith("src/app/") && hasAnyPrefix("app/")) {
            const mapped = p.replace(/^src\//, "");
            if ((files as any)?.[mapped]) return mapped;
        }

        if (p.startsWith("pages/") && hasAnyPrefix("src/pages/")) {
            const mapped = `src/${p}`;
            if ((files as any)?.[mapped]) return mapped;
            p = mapped;
        } else if (p.startsWith("src/pages/") && hasAnyPrefix("pages/")) {
            const mapped = p.replace(/^src\//, "");
            if ((files as any)?.[mapped]) return mapped;
        }

        // Keep HTML route paths canonical between source writes and live apply.
        // Example: app/page.html -> app/page/index.html (and src/app/* equivalent)
        const appHtmlMatch = p.match(/^(src\/app|app)\/(.+)\.html$/i);
        if (appHtmlMatch) {
            const root = appHtmlMatch[1];
            const routePart = appHtmlMatch[2];
            if (routePart && routePart !== "index" && !/\/index$/i.test(routePart)) {
                const normalizedHtmlPath = `${root}/${routePart}/index.html`;
                if ((files as any)?.[normalizedHtmlPath]) return normalizedHtmlPath;
                p = normalizedHtmlPath;
            }
        }

        // If the agent targets a common entrypoint but uses the "wrong" extension,
        // prefer whichever sibling file already exists.
        const candidatesForSameBase = (base: string) => [
            `${base}.tsx`,
            `${base}.ts`,
            `${base}.jsx`,
            `${base}.js`,
            base,
        ];

        const extMatch = p.match(/^(.*)\.(tsx|ts|jsx|js)$/i);
        if (extMatch && hasFiles) {
            const base = extMatch[1];
            for (const c of candidatesForSameBase(base)) {
                if ((files as any)[c]) return c;
            }
        }

        // Router-specific entrypoint mapping:
        // - If the agent edits pages/index.* but we only have app/page.* (or vice versa),
        //   map to the existing router's entrypoint to ensure the preview reflects changes.
        if (hasFiles) {
            const pagesIndex = p.match(/^(src\/)?pages\/index\.(tsx|ts|jsx|js)$/i);
            const appPage = p.match(/^(src\/)?app\/page\.(tsx|ts|jsx|js)$/i);

            if (pagesIndex) {
                // Prefer src/app/page.* if present, then app/page.*
                for (const c of candidatesForSameBase("src/app/page")) {
                    if ((files as any)[c]) return c;
                }
                for (const c of candidatesForSameBase("app/page")) {
                    if ((files as any)[c]) return c;
                }
            }

            if (appPage) {
                for (const c of candidatesForSameBase("src/pages/index")) {
                    if ((files as any)[c]) return c;
                }
                for (const c of candidatesForSameBase("pages/index")) {
                    if ((files as any)[c]) return c;
                }
            }
        }

        return p;
    }

    const saveFileToServer = useCallback(async (
        path: string,
        content: string,
        opts?: { afterSave?: "apply" | "none"; interactive?: boolean }
    ): Promise<boolean> => {
        try {
            const normalizedContent = isHtmlPath(path)
                ? rewriteFirebaseStorageUrlsInHtml(content)
                : content;

            const getCsrfToken = async (): Promise<string | null> => {
                try {
                    const res = await fetch("/api/auth/csrf", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        credentials: "include",
                        cache: "no-store",
                    });
                    if (!res.ok) return null;
                    const data = await res.json().catch(() => null);
                    return data?.csrf || null;
                } catch {
                    return null;
                }
            };

            const postUpdate = async (csrf: string | null) => {
                const res = await fetch(`/api/app-builder/${appId}/update-file`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify({ path, content: normalizedContent }),
                });
                const data = await res.json().catch(() => ({} as any));
                return { res, data };
            };

            // Always fetch a fresh CSRF token so the header matches the cookie.
            // (Relying on an existing cookie can drift and cause 403s.)
            let csrf = await getCsrfToken();
            let { res, data } = await postUpdate(csrf);

            const errCode = String((data as any)?.code || "").trim();
            const errMsg = String((data as any)?.error || "").toLowerCase();
            const isScopeProblem =
                errCode === "MISSING_APP_SCOPE" ||
                errCode === "INVALID_APP_SCOPE" ||
                errMsg.includes("app scope");

            // Self-heal missing/expired app-scope cookie and retry once.
            if (!res.ok && res.status === 403 && isScopeProblem) {
                const bootstrapped = await bootstrapAppScope();
                if (bootstrapped) {
                    csrf = await getCsrfToken();
                    ({ res, data } = await postUpdate(csrf));
                }
            }

            if (!res.ok || (data && data.ok === false)) {
                const msg =
                    String((data as any)?.error || "").trim() ||
                    `Failed to save (HTTP ${res.status})`;
                throw new Error(msg);
            }

            const afterSave = opts?.afterSave || "apply";
            if (afterSave === "apply") {
                queuePreviewApply([{ path, content: normalizedContent }], { interactive: false });
            }
            return true;
        } catch (err) {
            console.error("Auto-save failed", err);
            if (opts?.interactive) {
                void showAlert("Could not save your change. Please try again.", "Save failed");
            }
            return false;
        }
    }, [appId, bootstrapAppScope, queuePreviewApply, showAlert]);

    const applyStagedImage = useCallback(async (id: string) => {
        if (stagedImageApplyInFlightRef.current === id) return;
        stagedImageApplyInFlightRef.current = id;
        const item = stagedImages.find((entry) => entry.id === id);
        try {
            if (!item) return;

            if (!(await ensureFreshVercelConnection("images"))) return;
            if (!(await ensureStorageConfiguredForImages())) return;

            const allFiles = appRef.current?.files || ({} as AppData["files"]);
            const plan = resolveImagePlacementPlan(allFiles, item.placementPrompt, currentFile);
            if (!plan) {
                void showAlert("I couldn’t find a place for that prompt. Try something like “homepage top” or “/about bottom”.", "Images");
                return;
            }

            const confirm = await showConfirm(
                <div className="space-y-3">
                    <Image
                        src={item.previewUrl}
                        alt={item.alt || "Image preview"}
                        width={1200}
                        height={1200}
                        className="h-auto max-h-56 w-full rounded-lg border border-neutral-200 object-contain"
                        unoptimized
                    />
                    <div className="text-sm text-neutral-700">
                        Place image at {plan.label}?
                    </div>
                    <div className="text-sm text-neutral-700">
                        Prompt: {item.placementPrompt || "(none)"}
                    </div>
                </div>,
                "Images",
            );
            if (!confirm) return;

            updateStagedImage(id, { status: "uploading", error: null });

            let finalUrl = item.uploadedUrl;
            let finalPath = item.uploadedPath;
            if (!finalUrl?.trim()) {
                const uploaded = await uploadImageToUserBlob(item.preparedFile);
                if (!uploaded?.url?.trim()) {
                    updateStagedImage(id, {
                        status: "staged",
                        error: "Image upload failed.",
                    });
                    return;
                }
                finalUrl = uploaded.url;
                finalPath = uploaded.path;
                if (process.env.NODE_ENV === "development") {
                    console.log("[AppBuilderEditor] staged image upload returned", {
                        id,
                        url: finalUrl,
                        path: finalPath || "",
                    });
                }
            }

            const targetContent = appRef.current?.files?.[plan.targetPath]?.content || "";
            const snippet = buildImageSnippet(finalUrl, item.alt || "");
            const nextContent = insertSnippetIntoContent(targetContent, snippet, plan.position);

            setApp((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    files: {
                        ...prev.files,
                        [plan.targetPath]: {
                            content: nextContent,
                            lastModified: Date.now(),
                        },
                    },
                };
            });

            if (currentFile === plan.targetPath) {
                setCode(nextContent);
            }

            const ok = await saveFileToServer(plan.targetPath, nextContent, { afterSave: "apply", interactive: true });
            if (!ok) {
                throw new Error("save_failed");
            }
            if (process.env.NODE_ENV === "development") {
                console.log("[AppBuilderEditor] staged image injected and saved", {
                    id,
                    targetPath: plan.targetPath,
                    url: finalUrl,
                    path: finalPath || "",
                });
            }

            setLastImageInsert({
                stagedImageId: item.id,
                targetPath: plan.targetPath,
                previousContent: targetContent,
                uploadedPath: finalPath || null,
            });

            updateStagedImage(id, {
                status: "applied",
                uploadedUrl: finalUrl,
                uploadedPath: finalPath || null,
                error: null,
            });
            void showAlert("Image applied to your project.", "Images");
        } catch (err: any) {
            const msg = String(err?.message || err || "");
            if (/image storage limit reached/i.test(msg)) {
                updateStagedImage(id, {
                    status: "staged",
                    error: msg,
                });
                void showAlert(msg, "Images");
                return;
            }
            updateStagedImage(id, {
                status: "failed",
                error: err?.message ? String(err.message) : "Failed to apply image",
            });
            void showAlert("Could not apply this image. Please try again.", "Images");
        } finally {
            if (stagedImageApplyInFlightRef.current === id) {
                stagedImageApplyInFlightRef.current = null;
            }
        }
    }, [currentFile, ensureFreshVercelConnection, ensureStorageConfiguredForImages, saveFileToServer, showAlert, showConfirm, stagedImages, updateStagedImage, uploadImageToUserBlob]);

    const undoLastImageInsert = useCallback(async () => {
        if (!lastImageInsert) {
            void showAlert("No image insertion to undo yet.", "Images");
            return;
        }

        const { stagedImageId, targetPath, previousContent, uploadedPath } = lastImageInsert;
        const confirmed = await showConfirm(
            `Undo the last image insert in ${targetPath}?`,
            "Images",
        );
        if (!confirmed) return;

        setApp((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                files: {
                    ...prev.files,
                    [targetPath]: {
                        content: previousContent,
                        lastModified: Date.now(),
                    },
                },
            };
        });

        if (currentFile === targetPath) {
            setCode(previousContent);
        }

        const ok = await saveFileToServer(targetPath, previousContent, { afterSave: "apply", interactive: true });
        if (!ok) {
            void showAlert("Undo failed while restoring file content.", "Images");
            return;
        }

        if (uploadedPath) {
            await deleteUserBlobPaths([uploadedPath]);
        }

        updateStagedImage(stagedImageId, {
            status: "staged",
            uploadedUrl: null,
            uploadedPath: null,
            error: null,
        });
        setLastImageInsert(null);
        void showAlert("Image insert reverted.", "Images");
    }, [currentFile, deleteUserBlobPaths, lastImageInsert, saveFileToServer, showAlert, showConfirm, updateStagedImage]);

    const applyFaviconToApp = useCallback(async (nextUrl: string) => {
        const files = appRef.current?.files;
        const appDir = detectNextAppDir(files);

        if (!files || !appDir) {
            await showAlert(
                "This project doesn’t look like a Next.js App Router project (no app/ or src/app/ folder found). I can upload the icon, but can’t auto-wire it into your code.",
                "Favicon",
            );
            return;
        }

        const headPath = `${appDir}/head.tsx`;
        const existing = (files as any)?.[headPath]?.content;

        const faviconRoutePath = `${appDir}/favicon.ico/route.ts`;
        const existingFaviconRoute = (files as any)?.[faviconRoutePath]?.content;
        const canWriteFaviconRoute =
            typeof existingFaviconRoute !== "string" || existingFaviconRoute.includes("kloner:favicon-route");

        const faviconRouteContent = canWriteFaviconRoute ? buildFaviconIcoRouteTs(nextUrl) : null;

        const content =
            typeof existing === "string" && existing.trim().length > 0
                ? upsertFaviconInHeadTsx(existing, nextUrl)
                : buildHeadTsxWithFavicon(nextUrl);

        // Update local state immediately
        setApp((prev) => prev ? {
            ...prev,
            files: {
                ...prev.files,
                [headPath]: { content, lastModified: Date.now() },
                ...(canWriteFaviconRoute && faviconRouteContent
                    ? { [faviconRoutePath]: { content: faviconRouteContent, lastModified: Date.now() } }
                    : null),
            },
        } : prev);

        if (!canWriteFaviconRoute) {
            void showAlert(
                "I found an existing /favicon.ico route in your app and didn’t overwrite it. I updated head.tsx, but your browser may still request /favicon.ico unless you handle that route.",
                "Favicon",
            );
        }

        await saveFileToServer(headPath, content, { afterSave: "none", interactive: true });
        if (canWriteFaviconRoute && faviconRouteContent) {
            await saveFileToServer(faviconRoutePath, faviconRouteContent, { afterSave: "none", interactive: true });
        }

        queuePreviewApply(
            [
                { path: headPath, content },
                ...(canWriteFaviconRoute && faviconRouteContent
                    ? [{ path: faviconRoutePath, content: faviconRouteContent }]
                    : []),
            ],
            { interactive: false },
        );
        setFaviconUrl(nextUrl);
    }, [queuePreviewApply, saveFileToServer, showAlert]);

    const handleFaviconFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setFaviconUploading(true);

            const { url } = await uploadFaviconToUserBlob(file);
            await applyFaviconToApp(url);
            void showAlert("Favicon updated.", "Favicon");
        } catch (err: any) {
            console.error("Favicon upload failed", err);
            void showAlert("Failed to upload favicon. Please try again.", "Favicon");
        } finally {
            setFaviconUploading(false);
            e.target.value = "";
        }
    }, [applyFaviconToApp, showAlert, uploadFaviconToUserBlob]);

    const handleFileChangeFromContainer = useCallback((path: string, content: string) => {
        // While we are in generation-processing state we may be running a placeholder template.
        // Do not persist container-origin writes during that phase.
        if (isGenerationInProgress(normalizeGenerationState(appRef.current))) {
            return;
        }

        // Update local state
        setApp((prev) => prev ? {
            ...prev,
            files: {
                ...prev.files,
                [path]: { content, lastModified: Date.now() },
            },
        } : null);

        // If this is the currently open file, update the editor
        if (path === currentFile) {
            setCode(content);
        }

        // Persist container-origin changes, but do not re-apply/restart (avoids loops).
        saveFileToServer(path, content, { afterSave: "none" });
    }, [currentFile, saveFileToServer]);

    const handleFileEditFromAI = useCallback((path: string, content: string, creditRequestId?: string) => {
        const files = appRef.current?.files;
        const canonicalPath = canonicalizeEditPath(path, files);
        if (!canonicalPath) return;

        // Guardrail: a broken tsconfig/jsconfig can crash Next dev bundler (e.g. baseUrl errors).
        const lower = canonicalPath.toLowerCase();
        if (lower.endsWith("tsconfig.json") || lower.endsWith("jsconfig.json")) {
            try {
                JSON.parse(String(content || ""));
            } catch {
                void showAlert(
                    `The agent produced invalid JSON for ${canonicalPath}. Not applying this change to avoid breaking the preview.`,
                    "Invalid config",
                );
                return;
            }
        }

        // Update local state
        setApp((prev) => prev ? {
            ...prev,
            files: {
                ...prev.files,
                [canonicalPath]: { content, lastModified: Date.now() },
            },
        } : null);

        // If this is the currently open file, update the editor
        if (canonicalPath === currentFile) {
            setCode(content);
        }

        // Save to Firebase first (source of truth), then live-apply via /api/previews/apply.
        void saveFileToServer(canonicalPath, content, { afterSave: "apply" }).then((ok) => {
            const rid = String(creditRequestId || "").trim();
            if (!ok || !rid) return;
            if (lastConsumedAiCreditRequestIdRef.current === rid) return;
            lastConsumedAiCreditRequestIdRef.current = rid;
            void consumeAiEditCredit(rid);
        });
    }, [consumeAiEditCredit, currentFile, saveFileToServer, showAlert]);

    // If an app has a jsconfig/tsconfig with missing compilerOptions (e.g. `{}`), Next's
    // dev bundler can crash reading `baseUrl`. Repair once and restart the local preview.
    useEffect(() => {
        if (didAutoRepairConfigRef.current) return;
        if (!appId) return;
        const files = app?.files;
        if (!files) return;

        const candidates = ["tsconfig.json", "jsconfig.json"];
        const fixes: Array<{ path: string; content: string }> = [];

        for (const p of candidates) {
            const raw = (files as any)?.[p]?.content;
            if (typeof raw !== "string" || !raw.trim()) continue;
            const normalized = ensureCompilerOptionsObject(raw);
            if (!normalized.ok) continue;
            if (normalized.normalized !== raw) {
                fixes.push({ path: p, content: normalized.normalized });
            }
        }

        if (fixes.length === 0) {
            didAutoRepairConfigRef.current = true;
            return;
        }

        didAutoRepairConfigRef.current = true;

        (async () => {
            try {
                for (const f of fixes) {
                    await saveFileToServer(f.path, f.content, { afterSave: "none" });
                }
                // Restart to ensure the preview machine reloads config without crashing.
                await restartLocalPreview(false);
            } catch {
                // ignore; user can manually restart
            }
        })();
    }, [appId, app?.files, restartLocalPreview, saveFileToServer]);

    const handleSave = async (interactive: boolean = true) => {
        if (!currentFile || !app || isSaving) return;
        const now = Date.now();
        if (now - previewActionThrottleRef.current.saveAt < 1200) return;
        previewActionThrottleRef.current.saveAt = now;

        setIsSaving(true);
        try {
            const ok = await saveFileToServer(currentFile, code, { afterSave: "none", interactive });
            if (!ok) return;

            // Update local state
            setApp((prev) =>
                prev
                    ? {
                        ...prev,
                        files: {
                            ...prev.files,
                            [currentFile]: { content: code, lastModified: Date.now() },
                        },
                    }
                    : null
            );

            queuePreviewApply([{ path: currentFile, content: code }], { interactive });
        } catch (err) {
            console.error("Save failed", err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleApplyCustomHtml = useCallback(
        async (path: string, html: string, skipMachineApply?: boolean) => {
            const activeFiles = appRef.current?.files || app?.files;
            const canonicalPath = canonicalizeEditPath(path, activeFiles as any);
            if (!canonicalPath) {
                throw new Error("Invalid HTML file path.");
            }
            lastVisualEditedHtmlPathRef.current = canonicalPath;

            const wasCurrentFile = currentFile === canonicalPath;

            const ok = await saveFileToServer(canonicalPath, html, { afterSave: "none", interactive: true });
            if (!ok) {
                console.error("[preview-apply] source save failed; skipping machine apply", {
                    path: canonicalPath,
                    source: "preview-apply",
                });
                throw new Error("Failed to save custom HTML changes.");
            }

            console.info("[preview-apply] source save complete", {
                path: canonicalPath,
                source: "preview-apply",
            });

            setApp((prev) => {
                if (!prev) return prev;
                const nextFiles = {
                    ...prev.files,
                    [canonicalPath]: { content: html, lastModified: Date.now() },
                };
                return {
                    ...prev,
                    files: nextFiles,
                };
            });

            buildFileTree({
                ...(appRef.current?.files || app?.files || {}),
                [canonicalPath]: { content: html, lastModified: Date.now() },
            } as any);

            if (currentFile === canonicalPath) {
                setCode(html);
            }

            if (skipMachineApply) {
                console.warn("[preview-apply] machine apply skipped by caller", {
                    path: canonicalPath,
                    source: "preview-apply",
                });
            } else {
                console.info("[preview-apply] triggering machine apply", {
                    path: canonicalPath,
                    source: "preview-apply",
                });
                try {
                    await applyPreviewChangesNow([{ path: canonicalPath, content: html }], {
                        interactive: true,
                        source: "preview-apply",
                    });
                    console.info("[preview-apply] machine apply completed", {
                        path: canonicalPath,
                        source: "preview-apply",
                    });

                    // Trigger background rebuild so preview is ready when user switches back
                    console.info("[preview-apply] triggering background rebuild", {
                        path: canonicalPath,
                        source: "preview-apply",
                    });
                    void restartLocalPreview(true);
                } catch (err) {
                    console.error("[preview-apply] machine apply failed", {
                        path: canonicalPath,
                        source: "preview-apply",
                        error: err,
                    });
                    throw err;
                }
            }
        },
        [app?.files, applyPreviewChangesNow, buildFileTree, currentFile, saveFileToServer, restartLocalPreview],
    );

    const handleVisualEditorLiveHtml = useCallback((html: string) => {
        const path = String(currentFileRef.current || "").trim();
        if (!path || !/\.html?$/i.test(path)) return;

        const nextFiles = {
            ...(appRef.current?.files || app?.files || {}),
            [path]: {
                content: html,
                lastModified: Date.now(),
            },
        };

        setApp((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                files: nextFiles,
            };
        });

        if (currentFileRef.current === path) {
            setCode(html);
        }
    }, [app?.files]);

    const handleDeploy = async () => {
        if (!app || isDeploying) return;
        if (deployLocked) {
            openDeployUpgradePaywall();
            return;
        }

        const alreadyDeployed = Boolean(app.isDeployed) || Boolean(app.productionUrl);
        if (!alreadyDeployed) {
            const confirmed = await showConfirm(
                "Publish this website now?\n\nThis will make your website publicly accessible on a live URL that you can share with anyone.",
                "Deploy",
            );
            if (!confirmed) return;

            if (onDeploy) {
                onDeploy({ id: app.id, name: app.name });
                return;
            }
            void showAlert("First deploy is handled in the dashboard deploy wizard.", "Deploy");
            return;
        }

        const confirmed = await showConfirm(
            "Deploy your latest changes live now?",
            "Deploy",
        );
        if (!confirmed) return;

        void runVercelDeployLive();
    };

    const handleSharePreview = async () => {
        if (!app || isSharingPreview) return;
        setShareChoiceError(null);
        setShowShareSuccess(false);

        try {
            if (!(await ensureFreshVercelConnection("share"))) {
                persistPendingVercelShareFlow(buildCurrentVercelOAuthReturnPath());
                return;
            }

            setIsSharingPreview(true);

            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const doShare = async () => {
                const res = await fetch(`/api/app-builder/${appId}/preview`, {
                    method: "POST",
                    headers: csrfHeaders(csrf),
                    credentials: "include",
                });
                const data = await res.json().catch(() => ({} as any));
                return { res, data };
            };

            let { res, data } = await doShare();

            const code = String((data as any)?.code || "").trim();
            const isScopeProblem = code === "MISSING_APP_SCOPE" || code === "INVALID_APP_SCOPE";

            if ((!res.ok || !data?.ok) && isScopeProblem) {
                await fetch(`/api/app-builder/${appId}/scope`, {
                    method: "GET",
                    credentials: "include",
                }).catch(() => null);

                ({ res, data } = await doShare());
            }

            if (!res.ok || !data?.ok) {
                const msg = (data as any)?.error || `Share preview failed (HTTP ${res.status})`;
                const debugBits = [
                    (data as any)?.code ? `code=${String((data as any).code)}` : "",
                    (data as any)?.reqId ? `reqId=${String((data as any).reqId)}` : "",
                ].filter(Boolean);
                throw new Error(debugBits.length ? `${msg} (${debugBits.join(", ")})` : msg);
            }

            const url = (data?.previewUrl || data?.url || "").toString().trim();
            if (!url) throw new Error("Share preview completed but no URL was returned.");

            const shareUrl = addVercelProtectionBypass(url, appRef.current?.vercelProtectionBypassSecret || null);
            setLastSharePreviewUrl(shareUrl);
            setShowShareSuccess(true);
            setTimeout(() => setShowShareSuccess(false), 12000);
            setApp((prev) => (prev ? { ...prev, previewUrl: url } : prev));
            openShareSuccessModal(shareUrl);
        } catch (err: any) {
            setShareChoiceError(err?.message || "Share preview failed.");
        } finally {
            setIsSharingPreview(false);
        }
    };

    const runVercelDeployLive = useCallback(async (): Promise<boolean> => {
        if (!appId) return false;
        if (isDeploying) return false;

        setIsDeploying(true);

        try {
            // Ensure Vercel is connected before attempting either deploy.
            if (!(await ensureFreshVercelConnection("preview"))) {
                return false;
            }

            const csrf = await ensureSessionAndCsrf().catch(() => null);
            const doDeploy = async () => {
                const res = await fetch(`/api/app-builder/${appId}/deploy`, {
                    method: "POST",
                    headers: csrfHeaders(csrf),
                    credentials: "include",
                });
                const data = await res.json().catch(() => ({} as any));
                return { res, data };
            };

            let { res, data } = await doDeploy();

            const code = String((data as any)?.code || "").trim();
            const isScopeProblem = code === "MISSING_APP_SCOPE" || code === "INVALID_APP_SCOPE";

            if ((!res.ok || !data?.ok) && isScopeProblem) {
                await fetch(`/api/app-builder/${appId}/scope`, {
                    method: "GET",
                    credentials: "include",
                }).catch(() => null);

                ({ res, data } = await doDeploy());
            }

            if (!res.ok || !data?.ok) {
                const msg = (data as any)?.error || `Deploy failed (HTTP ${res.status})`;
                const debugBits = [
                    (data as any)?.code ? `code=${String((data as any).code)}` : "",
                    (data as any)?.reqId ? `reqId=${String((data as any).reqId)}` : "",
                ].filter(Boolean);
                throw new Error(debugBits.length ? `${msg} (${debugBits.join(", ")})` : msg);
            }

            const url = (data?.url || data?.previewUrl || "").toString().trim();
            if (!url) throw new Error("Deploy completed but no URL was returned.");

            const deployedProjectId = String((data as any)?.vercelProjectId || "").trim();
            if (deployedProjectId) {
                setApp((prev) => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        vercelProjectId: deployedProjectId || prev.vercelProjectId,
                        isDeployed: true,
                    };
                });
            }

            setLastDeployLiveUrl(url);
            setDeployBannerFromRoute(buildDeploySuccessBanner({
                appId,
                deploymentId: String((data as any)?.deploymentId || (data as any)?.id || "").trim() || null,
                liveUrl: url,
            }));

            return true;
        } catch (err: any) {
            const errorMessage = err?.message || "Deploy failed.";
            const isVercelConnectIssue = /Vercel is not connected yet|Vercel is not connected|not connected for this user/i.test(errorMessage);
            setDeployBannerFromRoute({
                kind: "error",
                title: isVercelConnectIssue ? "Vercel not connected" : "Deployment failed",
                detail: isVercelConnectIssue
                    ? "Connect Vercel before deploying from this editor."
                    : errorMessage,
                fingerprint: isVercelConnectIssue
                    ? `deploy-route:${appId}:vercel-not-connected`
                    : `deploy-route:${appId}:${errorMessage.slice(0, 160)}`,
                fixAction: isVercelConnectIssue
                    ? "connect_vercel"
                    : /413|body too large|request entity too large/i.test(errorMessage)
                    ? "reduce_deploy_payload"
                    : "deploy_issue_fix",
            });
            return false;
        } finally {
            // Keep deploy disabled for longer to prevent spam
            setTimeout(() => setIsDeploying(false), 5000);
        }
    }, [appId, ensureFreshVercelConnection, isDeploying]);

    useEffect(() => {
        runVercelDeployLiveRef.current = runVercelDeployLive;
    }, [runVercelDeployLive]);

    const startVercelOAuthForPreview = useCallback(() => {
        if (!VERCEL_INTEGRATION_SLUG) {
            console.error("Missing NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG");
            setPreviewError(PREVIEW_RECOVERY_MESSAGE);
            return;
        }

        try {
            setVercelConnectOpening(true);
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            const state = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");

            // Persist what we were trying to do so the dashboard can restore state after redirect.
            localStorage.setItem(
                "kloner_vercel_pending_app_preview",
                JSON.stringify({ appId }),
            );

            localStorage.setItem("kloner_vercel_latest_csrf", state);

            document.cookie = [
                `vercel_oauth_state=${state}`,
                "Path=/",
                "Max-Age=600",
                "SameSite=Lax",
            ].join("; ");

            const returnTo = `/dashboard/view?vercel=connected&flow=preview&appId=${encodeURIComponent(appId)}`;
            document.cookie = [
                `vercel_oauth_return=${encodeURIComponent(returnTo)}`,
                "Path=/",
                "Max-Age=600",
                "SameSite=Lax",
            ].join("; ");

            const link = `https://vercel.com/integrations/${VERCEL_INTEGRATION_SLUG}/new?state=${state}`;
            window.location.assign(link);
        } catch (e) {
            console.error("Failed to start Vercel OAuth", e);
            setPreviewError(PREVIEW_RECOVERY_MESSAGE);
            setVercelConnectOpening(false);
        }
    }, [appId]);

    const startVercelOAuthForSharePreview = useCallback(() => {
        if (!VERCEL_INTEGRATION_SLUG) {
            console.error("Missing NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG");
            setShareChoiceError("Missing Vercel integration configuration.");
            return;
        }

        try {
            setVercelConnectOpening(true);
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            const state = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");

            const returnTo = `/dashboard/view?vercel=connected&shareResume=1&appId=${encodeURIComponent(appId)}`;
            persistPendingVercelShareFlow(returnTo);

            localStorage.setItem("kloner_vercel_latest_csrf", state);

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

            const link = `https://vercel.com/integrations/${VERCEL_INTEGRATION_SLUG}/new?state=${state}`;
            window.location.assign(link);
        } catch (e) {
            console.error("Failed to start Vercel OAuth for share preview", e);
            setShareChoiceError("Could not open Vercel connect.");
            setVercelConnectOpening(false);
        }
    }, [appId, persistPendingVercelShareFlow]);

    const startVercelOAuthForImageLibrary = useCallback(() => {
        if (!VERCEL_INTEGRATION_SLUG) {
            console.error("Missing NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG");
            setPreviewError(PREVIEW_RECOVERY_MESSAGE);
            return;
        }

        try {
            setVercelConnectOpening(true);
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            const state = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");

            const returnTo = `/dashboard/view?vercel=connected&flow=images&appId=${encodeURIComponent(appId)}`;
            localStorage.setItem(
                APP_BUILDER_PENDING_AI_IMAGES_KEY,
                JSON.stringify({
                    appId,
                    returnTo,
                    startedAt: Date.now(),
                }),
            );

            localStorage.setItem("kloner_vercel_latest_csrf", state);

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

            setVercelConnectFlow("images");
            setVercelConnectOpen(true);

            const link = `https://vercel.com/integrations/${VERCEL_INTEGRATION_SLUG}/new?state=${state}`;
            window.location.assign(link);
        } catch (e) {
            console.error("Failed to start Vercel OAuth for image library", e);
            setPreviewError(PREVIEW_RECOVERY_MESSAGE);
            setVercelConnectOpening(false);
        }
    }, [appId]);

    const tryEmbedExistingPreview = useCallback(() => {
        const url = (protectedPreviewUrl || "").trim();
        if (!url) return;
        setPreviewError(null);
        setApp((prev) => (prev ? { ...prev, previewUrl: url } : prev));
        setRefreshKey((k) => k + 1);
    }, [protectedPreviewUrl]);

    // If we just came back from Vercel OAuth, auto-resume the action.
    useEffect(() => {
        if (!isVercelConnected) return;
        if (!appId) return;
        if (!app || loading) return;
        if (!isPreviewBootReady) return;

        if (pendingShareResumeRef.current) return;

        let pending: any = null;
        try {
            const raw = localStorage.getItem("kloner_vercel_pending_app_preview");
            if (raw) pending = JSON.parse(raw);
        } catch {
            pending = null;
        }

        let pendingShare: any = null;
        try {
            const raw = localStorage.getItem(APP_BUILDER_PENDING_SHARE_KEY);
            if (raw) pendingShare = JSON.parse(raw);
        } catch {
            pendingShare = null;
        }

        if (pendingShare && pendingShare.appId === appId) {
            pendingShareResumeRef.current = true;
            try {
                localStorage.removeItem(APP_BUILDER_PENDING_SHARE_KEY);
            } catch {
                // ignore
            }

            void handleSharePreview();
            return;
        }

        if (!pending || pending.appId !== appId) return;

        try {
            localStorage.removeItem("kloner_vercel_pending_app_preview");
        } catch {
            // ignore
        }

        // No-op for embedded preview; deploy actions will work after connect.
    }, [isVercelConnected, appId, app, isPreviewBootReady, loading]);

    useEffect(() => {
        if (!vercelConnectOpen) return;
        if (vercelConnectOpening) return;
        if (isVercelChecking) return;
        if (!isVercelConnected) return;

        const t = window.setTimeout(() => {
            setVercelConnectOpen(false);
        }, 250);

        return () => window.clearTimeout(t);
    }, [vercelConnectOpen, vercelConnectOpening, isVercelChecking, isVercelConnected]);

    useEffect(() => {
        if (!isVercelConnected) return;
        if (!appId) return;
        if (!app || loading) return;
        if (!isPreviewBootReady) return;

        let pendingImages: any = null;
        try {
            const raw = localStorage.getItem(APP_BUILDER_PENDING_AI_IMAGES_KEY);
            if (raw) pendingImages = JSON.parse(raw);
        } catch {
            pendingImages = null;
        }

        if (!pendingImages || pendingImages.appId !== appId) return;

        try {
            localStorage.removeItem(APP_BUILDER_PENDING_AI_IMAGES_KEY);
        } catch {
            // ignore
        }

        setViewMode("images");
    }, [isVercelConnected, appId, app, isPreviewBootReady, loading]);

    useEffect(() => {
        if (!isVercelConnected) {
            pendingShareResumeRef.current = false;
        }
    }, [isVercelConnected]);

    // On editor open: automatically build and show the preview (with retries + automatic bypass).
    useEffect(() => {
        if (!appId) return;
        if (loading) return;
        if (!isPreviewBootReady) return;
        if (isVercelChecking) return;
        if (didAutoPreviewStartRef.current) return;

        didAutoPreviewStartRef.current = true;

        // Always use embedded local preview.
        setPreviewMode("webcontainer");
        // Kick the runner once to ensure it starts.
        setRefreshKey((k) => k + 1);
    }, [appId, isPreviewBootReady, loading, isVercelChecking]);

    const handleRefresh = async (forceFresh: boolean = false) => {
        if (isRefreshing) return;
        const now = Date.now();
        const throttleKey = forceFresh ? "rebuildAt" : "refreshAt";
        const cooldownMs = forceFresh ? 5000 : 1500;
        if (now - previewActionThrottleRef.current[throttleKey] < cooldownMs) return;
        previewActionThrottleRef.current[throttleKey] = now;

        if (forceFresh) {
            // Show confirmation dialog for force fresh start
            const confirmed = await showConfirm(
                "This will completely refresh the current session. Continue?",
                "Force Fresh Start"
            );
            if (!confirmed) return;
        }

        setIsRefreshing(true);
        try {
            if (forceFresh) {
                setFilesHydrated(false);
                setIsPreviewBootReady(false);
                await fetchAndHydrateAppFiles({ forceRefreshToken: true });
                await restartLocalPreview(true);
                return;
            }

            // Default refresh: reconnect/reload without hitting any legacy endpoints.
            setPreviewMode("webcontainer");
            setReconnectKey((k) => k + 1);
            setRefreshKey((k) => k + 1);
        } catch (err) {
            console.warn("[app-builder] background file sync failed", err);
        } finally {
            if (forceFresh) {
                setFilesHydrated(true);
            }
            setTimeout(() => setIsRefreshing(false), 500);
        }
    };

    const handleReconnect = () => {
        setPreviewMode("webcontainer");
        setReconnectKey((k) => k + 1);
    };

    const handleRescanSourceUrl = useCallback(() => {
        const nextUrl = sourceUrlToRescan.trim();
        setDismissedGenerationError(true);
        if (!nextUrl || typeof window === "undefined") return;

        window.location.assign(`/dashboard/view?u=${encodeURIComponent(nextUrl)}&start=1&retry=1`);
    }, [sourceUrlToRescan]);

    const handleRename = async () => {
        if (!app || !tempName.trim() || isRenameSaving) return;

        const nextName = tempName.trim();

        setIsRenameSaving(true);

        const doRename = async (): Promise<Response> => {
            const csrf = await ensureSessionAndCsrf().catch(() => null);
            return fetch(`/api/app-builder/${appId}/rename`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(typeof csrf === "string" && csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ name: nextName }),
            });
        };

        try {
            let res = await doRename();
            let data: any = await res.json().catch(() => ({} as any));
            const code = String(data?.code || "").trim();
            const isScopeProblem = code === "MISSING_APP_SCOPE" || code === "INVALID_APP_SCOPE";

            if ((!res.ok || !data?.success) && isScopeProblem) {
                const scopeOk = await bootstrapAppScope();
                if (scopeOk) {
                    res = await doRename();
                    data = await res.json().catch(() => ({} as any));
                }
            }

            if (!res.ok || !data?.success) {
                let message = "Failed to rename.";
                if (typeof data?.error === "string" && data.error.trim()) {
                    message = data.error.trim();
                }

                if (res.status === 403 || isScopeProblem) {
                    message = "Rename was blocked by permissions or a stale app session. Refresh the page and try again.";
                }

                throw Object.assign(new Error(message), { status: res.status });
            }
            setApp(prev => prev ? { ...prev, name: nextName } : null);
            setIsRenaming(false);
        } catch (err) {
            const message = String((err as any)?.message || "Failed to rename.");
            console.error("Rename failed", err);
            void showAlert(message, "Rename");
        } finally {
            setIsRenameSaving(false);
        }
    };

    const startRename = () => {
        setTempName(app?.name || "");
        setIsRenaming(true);
    };

    const cancelRename = () => {
        setIsRenaming(false);
        setTempName("");
    };

    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(max-width: 767px)");
        const update = () => setIsMobile(Boolean(mq.matches));
        update();

        if (typeof mq.addEventListener === "function") {
            mq.addEventListener("change", update);
            return () => mq.removeEventListener("change", update);
        }

        // Safari < 14 legacy API
        const legacyMq = mq as any;
        if (typeof legacyMq.addListener === "function") legacyMq.addListener(update);
        return () => {
            if (typeof legacyMq.removeListener === "function") legacyMq.removeListener(update);
        };
    }, []);

    const showLeftPanel = !isMobile || mobileTab === "prompt";
    const showRightPanel = !isMobile || mobileTab === "app";

    if (error) {
        return (
            <div
                className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/40 p-4"
                onMouseDown={(e) => {
                    if (e.target === e.currentTarget) onCloseRef.current?.();
                }}
            >
                <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white shadow-2xl">
                    <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
                        <div className="space-y-1">
                            <div className="text-sm font-semibold text-neutral-900">Failed to load app</div>
                        </div>

                        <button
                            type="button"
                            onClick={() => onCloseRef.current?.()}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200"
                            title="Close"
                            aria-label="Close"
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
                        <div className="text-sm text-neutral-700 whitespace-pre-wrap">{error}</div>
                    </div>

                    <div className="flex justify-end gap-3 border-t border-neutral-200 px-5 py-4">
                        <button
                            type="button"
                            onClick={() => onCloseRef.current?.()}
                            className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50"
                        >
                            Close
                        </button>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 text-sm font-medium text-white bg-[#FF8D21] rounded-lg"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!app) return null;

    if (activeGeneration.status === "error" && !dismissedGenerationError) {
        return (
            <div className="fixed inset-0 z-[16000] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
                <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.22)]">
                    <button
                        type="button"
                        onClick={() => setDismissedGenerationError(true)}
                        className="absolute right-3 top-3 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition hover:bg-neutral-50 hover:text-neutral-800 sm:right-4 sm:top-4"
                        aria-label="Close generation error"
                    >
                        <X className="h-4 w-4" />
                    </button>

                    <div className="border-b border-neutral-200 bg-[linear-gradient(180deg,rgba(255,141,33,0.10),rgba(255,255,255,1))] px-5 py-4 sm:px-6">
                        <div className="mt-3 text-[22px] font-semibold tracking-[-0.02em] text-neutral-950">
                            Generation failed
                        </div>
                        <div className="mt-2 max-w-md text-sm leading-6 text-neutral-600">
                            {generationFailureUi?.message || "Generation failed. Please retry."}
                        </div>
                        {generationFailureUi?.secondaryMessage ? (
                            <div className="mt-3 max-w-md text-sm leading-6 text-neutral-700">
                                {generationFailureUi.secondaryMessage}
                            </div>
                        ) : null}
                        {generationFailureDebugDetails ? (
                            <details className="mt-3 rounded-2xl border border-neutral-200 bg-white/80 px-4 py-3 text-sm text-neutral-700">
                                <summary className="inline-flex cursor-pointer list-none items-center justify-center rounded-full border border-blue-200 bg-blue-50 p-1 text-blue-600 hover:bg-blue-100">
                                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                                </summary>
                                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-neutral-700">
                                    {generationFailureDebugDetails}
                                </pre>
                            </details>
                        ) : null}
                    </div>

                    <div className="px-5 py-5 sm:px-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setDismissedGenerationError(true)}
                                className="inline-flex w-full items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 sm:w-auto"
                            >
                                Dismiss
                            </button>
                            {generationFailureUi?.actionKind === "rescan" ? (
                                <button
                                    type="button"
                                    onClick={handleRescanSourceUrl}
                                    disabled={!sourceUrlToRescan}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                    <span>Rescan URL</span>
                                </button>
                            ) : generationFailureUi?.actionKind === "retry" ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setDismissedGenerationError(true);
                                        window.location.reload();
                                    }}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-dark sm:w-auto"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                    <span>{generationFailureUi?.actionLabel || "Retry"}</span>
                                </button>
                            ) : null}
                        </div>
                        {previewHydrationLoader}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[16000] bg-black/70 backdrop-blur-sm">
            {isGenerationProcessing && previewMode !== "webcontainer" ? (
                <motion.div
                    key="generation-processing"
                    className="fixed inset-0 z-[17000] bg-black/70 backdrop-blur-sm flex items-center justify-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                >
                    <motion.div
                        className="bg-white rounded-2xl p-8 max-w-md shadow-[0_28px_80px_rgba(15,23,42,0.22)]"
                        initial={{ opacity: 0, y: 10, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.985 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                    >
                        <div className="text-center">
                            <KlonerLoader />
                            <div className="mt-4 text-sm text-gray-600">
                                {activeGeneration.title || "Generating your app…"}
                            </div>

                            <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#FF8D21]">
                                {formatGenerationStageLabel(activeGeneration.stage) || formatGenerationStageLabel(activeGeneration.status)}
                            </div>

                            <div className="mt-3 text-sm text-gray-600">
                                {activeGeneration.message || "Working through the generation pipeline…"}
                            </div>

                            {typeof activeGeneration.progress === "number" ? (
                                <div className="mt-4">
                                    <div className="text-xs font-semibold text-gray-700">
                                        Progress: {Math.max(0, Math.min(100, Math.round(activeGeneration.progress)))}%
                                    </div>
                                    <div className="mt-2 h-2 w-full rounded-full bg-gray-200 overflow-hidden">
                                        <div
                                            className="h-full bg-[#FF8D21]"
                                            style={{
                                                width: `${Math.max(0, Math.min(100, Math.round(activeGeneration.progress)))}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </motion.div>
                </motion.div>
            ) : null}
            <motion.div
                key="app-builder-shell"
                className={`h-full w-full bg-white flex flex-col ${loading ? "pointer-events-none" : ""}`}
                initial={false}
                animate={{
                    opacity: loading ? 0 : 1,
                    y: loading ? 6 : 0,
                    scale: loading ? 0.995 : 1,
                }}
                transition={{ duration: 0.24, ease: "easeOut" }}
            >
                {/* Header */}
                <div className="relative z-30 flex flex-nowrap items-center justify-between gap-2 overflow-visible border-b bg-gray-50 p-2.5 sm:p-4">
                    <div className="relative z-20 flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                        {isRenaming ? (
                            <div className="flex min-w-0 max-w-full items-center gap-1.5 sm:gap-2">
                                <input
                                    type="text"
                                    value={tempName}
                                    onChange={(e) => setTempName(e.target.value)}
                                    onKeyPress={(e) => {
                                        if (isRenameSaving) return;
                                        if (e.key === "Enter") void handleRename();
                                        if (e.key === "Escape") cancelRename();
                                    }}
                                    disabled={isRenameSaving}
                                    className="min-w-0 w-[46vw] sm:w-auto px-2 py-1 border rounded text-sm sm:text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-accent"
                                    autoFocus
                                />
                                <button
                                    onClick={() => void handleRename()}
                                    disabled={isRenameSaving}
                                    className="shrink-0 p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-60"
                                    title="Save name"
                                >
                                    <Check className="w-4 h-4 text-green-600" />
                                </button>
                                <button
                                    onClick={cancelRename}
                                    disabled={isRenameSaving}
                                    className="shrink-0 p-1 hover:bg-gray-200 rounded transition-colors disabled:opacity-60"
                                    title="Cancel"
                                >
                                    <RotateCcw className="w-4 h-4 text-red-600" />
                                </button>
                            </div>
                        ) : (
                            <div className="relative group min-w-0 max-w-[52vw] sm:max-w-[60vw] md:max-w-none">
                                <h1
                                    className="inline-flex max-w-full items-center gap-1.5 text-sm sm:text-lg md:text-xl font-semibold cursor-pointer hover:text-accent transition-colors"
                                    onClick={startRename}
                                    title="Click to rename"
                                >
                                    <span className="truncate">{app?.name || "Untitled Project"}</span>
                                    <Pencil className="h-3.5 w-3.5 shrink-0 text-neutral-500 group-hover:text-accent" aria-hidden="true" />
                                </h1>
                                {isDev ? (
                                    <div className="mt-1 flex items-center gap-1.5">
                                        <DevOnlyIconBadge title={projectFramework.reason} />
                                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-600">
                                            {projectFramework.label}
                                        </span>
                                    </div>
                                ) : null}
                            </div>
                        )}

                        {/* Tablet controls menu */}
                        <div ref={tabletControlsRef} className="relative ml-0 md:flex lg:hidden">
                            <button
                                type="button"
                                onClick={() => setTabletControlsOpen((open) => !open)}
                                className="inline-flex shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white p-2 text-neutral-700 shadow-sm hover:bg-neutral-50"
                                title="More controls"
                                aria-label="More controls"
                                aria-expanded={tabletControlsOpen}
                            >
                                <MoreVertical className="h-4 w-4" />
                            </button>

                            {tabletControlsOpen ? (
                                <div className="absolute left-0 top-full z-30 mt-2 w-[min(88vw,19rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
                                    {lastDeployLiveUrl ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setTabletControlsOpen(false);
                                                window.open(lastDeployLiveUrl, "_blank", "noopener,noreferrer");
                                            }}
                                            className="flex w-full items-center gap-2 border-b border-neutral-100 px-4 py-3 text-left text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                                        >
                                            <Rocket className="h-4 w-4 text-neutral-500" />
                                            View live
                                        </button>
                                    ) : null}

                                    {isDev ? (
                                        <div className="border-b border-neutral-100 px-4 py-3 text-sm">
                                            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Current file</div>
                                            <div className="mt-1 truncate font-medium text-neutral-800">{currentFile || "(none)"}</div>
                                        </div>
                                    ) : null}

                                    <div className="px-4 py-3 text-sm">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">UI scale</div>
                                        <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1">
                                            <button
                                                type="button"
                                                onClick={() => setCustomPreviewScale((s) => Math.max(0.5, +(s - 0.05).toFixed(2)))}
                                                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
                                                title="Zoom out"
                                            >
                                                −
                                            </button>
                                            <span className="w-12 text-center text-sm font-semibold text-neutral-700">
                                                {Math.round(customPreviewScale * 100)}%
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setCustomPreviewScale((s) => Math.min(1.25, +(s + 0.05).toFixed(2)))}
                                                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
                                                title="Zoom in"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>

                                </div>
                            ) : null}
                        </div>

                        {/* Project controls (desktop) */}
                        <div className="ml-0 hidden flex-nowrap items-center gap-1.5 lg:flex lg:gap-2">
                            {isDev && !isVisualEditorMode ? (
                                <button
                                    onClick={() => void openDatabaseConnect()}
                                    className={`min-w-[170px] px-4 py-2 text-xs font-semibold rounded-full flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
                                        supabaseConnected === null
                                            ? "bg-white text-gray-500 border border-gray-200"
                                            : supabaseConnected
                                              ? supabaseDbReachable === false
                                                  ? (supabaseDbReason === "project_paused" || supabaseDbReason === "timeout_or_network")
                                                      ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                                                      : "bg-red-100 text-red-900 hover:bg-red-200"
                                                  : supabaseDbReachable === true
                                                    ? "bg-green-100 text-green-900 hover:bg-green-200"
                                                    : "bg-white text-green-900 border border-green-200 hover:bg-green-50"
                                              : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                                    }`}
                                    title={
                                        supabaseConnected
                                            ? `${supabaseDbReachable === false ? "Database unreachable" : "Database connected"}${supabaseProjectName ? `: ${supabaseProjectName}` : ""}${supabaseDbStatusText ? `\n\n${supabaseDbStatusText}` : ""}`
                                            : "Connect your database"
                                    }
                                >
                                    <Database className="w-4 h-4 shrink-0" />
                                    {supabaseConnected === null ? (
                                        <span>Database: Verifying…</span>
                                    ) : supabaseConnected ? (
                                        <span className="flex flex-col items-start leading-tight">
                                            <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">
                                                {supabaseDbReachable === false
                                                    ? supabaseDbReason === "project_paused"
                                                        ? "Database: Paused"
                                                        : supabaseDbReason === "timeout_or_network"
                                                          ? "Database: Resuming"
                                                          : "Unreachable"
                                                    : supabaseDbReachable === true
                                                      ? "Database: Healthy"
                                                      : "Database: Connected"}
                                            </span>
                                            {supabaseProjectName ? (
                                                <span className="max-w-[110px] truncate font-semibold" title={supabaseProjectName}>
                                                    {supabaseProjectName}
                                                </span>
                                            ) : supabaseProjectRef ? (
                                                <span className="max-w-[110px] truncate font-mono text-[10px]" title={supabaseProjectRef}>
                                                    {supabaseProjectRef}
                                                </span>
                                            ) : null}
                                        </span>
                                    ) : (
                                        <span>Connect Database</span>
                                    )}
                                    <DevOnlyIconBadge title="Development-only database controls" />
                                </button>
                            ) : null}

                            {lastDeployLiveUrl ? (
                                <button
                                    onClick={() => window.open(lastDeployLiveUrl, "_blank", "noopener,noreferrer")}
                                    className="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-neutral-300 bg-white px-2.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 lg:px-3"
                                    title="Open live deployment"
                                >
                                    <Rocket className="h-4 w-4" />
                                    <span className="hidden md:inline lg:hidden">Live</span>
                                    <span className="hidden lg:inline">View live</span>
                                </button>
                            ) : null}

                            {!isVisualEditorMode ? (
                                <button
                                    type="button"
                                    onClick={handleTakeBuilderTour}
                                    className="hidden shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-neutral-300 bg-white px-2.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 lg:inline-flex lg:px-3"
                                    title="Show the app builder tour"
                                >
                                    <span>Take tour</span>
                                </button>
                            ) : null}

                            {isDev ? (
                                <div
                                    className="inline-flex shrink-0 max-w-[150px] items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[11px] font-medium text-neutral-700 xl:max-w-[320px] xl:px-3 xl:text-xs"
                                    title={`Current open file: ${currentFile || "(none)"}`}
                                >
                                    <DevOnlyIconBadge title="Development-only current file indicator" />
                                    <span className="hidden text-neutral-500 lg:inline">current file:</span>
                                    <span className="truncate">{currentFile || "(none)"}</span>
                                </div>
                            ) : null}

                            {(
                                <div data-tour-ui-scale className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-neutral-300 bg-white px-1.5 py-1 shadow-sm xl:gap-1 xl:px-2">
                                    <button
                                        type="button"
                                        onClick={() => setCustomPreviewScale((s) => Math.max(0.5, +(s - 0.05).toFixed(2)))}
                                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100"
                                        title="Zoom out"
                                    >
                                        −
                                    </button>
                                    <span className="w-9 text-center text-xs font-semibold text-neutral-700 xl:w-10">
                                        {Math.round(customPreviewScale * 100)}%
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setCustomPreviewScale((s) => Math.min(1.25, +(s + 0.05).toFixed(2)))}
                                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100"
                                        title="Zoom in"
                                    >
                                        +
                                    </button>
                                </div>
                            )}

                            {isDev && supabaseConnected && !isVisualEditorMode ? (
                                <button
                                    onClick={() => void disconnectSupabase()}
                                    className="p-2 rounded-full border border-red-200 bg-white text-red-700 hover:bg-red-50 transition-colors"
                                    title="Disconnect Supabase from Kloner (does not delete your Supabase project)"
                                    aria-label="Disconnect database"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            ) : null}
                        </div>
                    </div>
                    {/* Portal target for Custom tab toolbar buttons */}
                    <div id="kloner-custom-toolbar-portal" className="relative z-[40000] mx-2 hidden items-center gap-2 overflow-visible md:flex" />
                    <div className="relative z-10 flex shrink-0 gap-2 items-center">
                        {!(isRenaming && isMobile) ? (
                            <button
                                onClick={() => setMobileControlsOpen(true)}
                                data-tour-mobile-controls
                                className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-md transition hover:bg-neutral-50"
                                title="Controls"
                                aria-label="Controls"
                            >
                                <SlidersHorizontal className="h-4 w-4" />
                            </button>
                        ) : null}

                        {/* Top-right reserved for machine + deploy (PreviewEditorV2-style) */}
                        <div className={`hidden md:inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-1.5 py-1 shadow-md lg:gap-2 lg:px-2 ${isVisualEditorMode ? "invisible pointer-events-none" : ""}`}>
                            <div className="px-1.5 text-[10px] font-semibold text-neutral-700 whitespace-nowrap lg:px-2 lg:text-[11px]">
                                <span
                                    className={`mr-2 inline-block h-2 w-2 rounded-full ${
                                        isPreviewBuilding
                                            ? "bg-amber-500"
                                            : isRefreshing
                                              ? "bg-blue-500"
                                              : isWebPreviewReady
                                                ? "bg-green-500"
                                                : "bg-neutral-400"
                                    }`}
                                    aria-hidden="true"
                                />
                                Machine: {isPreviewBuilding ? "Starting" : isRefreshing ? "Refreshing" : isWebPreviewReady ? "Ready" : "Idle"}
                            </div>

                            <button
                                onClick={handleReconnect}
                                disabled={isRefreshing || isPreviewBuilding}
                                data-tour-refresh
                                className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full border border-neutral-300 bg-white px-2.5 text-[11px] font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 lg:px-2.5 lg:text-[12px]"
                                title="Refresh machine"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span className="hidden lg:inline">Refresh</span>
                            </button>

                            <button
                                onClick={() => handleRefresh(true)}
                                disabled={isPreviewBuilding || isRefreshing}
                                data-tour-rebuild
                                className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full border border-neutral-300 bg-white px-2.5 text-[11px] font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 lg:px-2.5 lg:text-[12px]"
                                title="Rebuild machine"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span className="hidden lg:inline">{isPreviewBuilding ? "Starting" : "Rebuild"}</span>
                            </button>
                        </div>

                        {showShareSuccess && !(isRenaming && isMobile) ? (
                            <div className="md:hidden rounded-xl border border-blue-200 bg-blue-50/70 px-2.5 py-2 text-[11px] text-blue-900">
                                <div className="font-semibold">Share preview created</div>
                                <div className="mt-0.5 text-blue-800/90">This link stays saved in the editor.</div>
                                {lastSharePreviewUrl ? (
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => window.open(lastSharePreviewUrl, "_blank", "noopener,noreferrer")}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-2.5 py-1 font-semibold text-blue-900"
                                            title="Open site link"
                                        >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            <span>Site link</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                const copied = await copyTextToClipboard(lastSharePreviewUrl);
                                                if (copied) {
                                                    void showAlert("Site link copied to clipboard.", "Share preview");
                                                } else {
                                                    void showAlert(`Site link:\n\n${lastSharePreviewUrl}`, "Share preview");
                                                }
                                            }}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-2.5 py-1 font-semibold text-blue-900"
                                            title="Copy site link"
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                            <span>Copy</span>
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {!(isRenaming && isMobile) ? (
                            <>
                                {isDev ? (
                                    <button
                                        onClick={() => void handleSharePreview()}
                                        disabled={isSharingPreview}
                                        data-tour-share
                                        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-2 py-1 text-[12px] font-semibold text-neutral-700 shadow-md transition hover:bg-neutral-50 disabled:opacity-60 xl:px-3 xl:text-[13px]"
                                        title={shareChoiceError || "Create a shareable preview link"}
                                        aria-label="Share preview"
                                    >
                                        <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span className="hidden xl:inline">{isSharingPreview ? "Sharing…" : "Share"}</span>
                                        <DevOnlyIconBadge title="Development-only share control" />
                                    </button>
                                ) : null}

                                <button
                                    onClick={handleDeploy}
                                    disabled={isDeploying}
                                    data-tour-deploy
                                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#FF8D21] bg-[#FF8D21] px-2 py-1 text-[12px] font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60 xl:px-3 xl:text-[13px]"
                                    title="Deploy"
                                    aria-label="Deploy"
                                >
                                    <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span className="hidden xl:inline">{isDeploying ? "Deploying…" : "Deploy"}</span>
                                </button>
                            </>
                        ) : null}

                        <button
                            onClick={() => void requestClose()}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-md transition hover:bg-neutral-50"
                            title="Close"
                            aria-label="Close editor"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Hidden file input: keep mounted for mobile controls */}
                <input
                    ref={faviconInputRef}
                    type="file"
                    accept=".ico,image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml"
                    className="hidden"
                    onChange={handleFaviconFileChange}
                />

                {isEmbeddingProcessing ? (
                    <div className="border-b bg-sky-50 px-4 py-2 text-xs text-sky-900">
                        {"Preparing your files so the assistant can use the right parts faster."}
                        {typeof activeEmbedding.progress === "number" ? ` (${Math.max(0, Math.min(100, Math.round(activeEmbedding.progress * 100)))}%)` : ""}
                    </div>
                ) : null}

                <div className="flex flex-1 min-h-0" data-app-builder-container>
                    {/* Left Panel - AI Chat and Controls */}
                    <div 
                        className={`${showLeftPanel ? "flex" : "hidden"} flex-col bg-gray-50 flex-shrink-0 min-h-0 overflow-hidden w-full md:w-auto ${!isVisualEditorMode ? "md:border-r" : ""}`}
                        style={!isMobile && !isVisualEditorMode ? { width: `${leftPanelWidth}px` } : isVisualEditorMode ? { width: "100%" } : undefined}
                    >
                        {/* View Mode Toggle */}
                        <div
                            className={`p-3 border-b sticky top-0 z-10 bg-gray-50 ${
                                isVisualEditorMode
                                    ? isCustomSidebarOpen
                                        ? "w-[min(92vw,520px)]"
                                        : "hidden"
                                    : ""
                            }`}
                        >
                            <div className="inline-flex w-fit gap-2 overflow-x-auto overflow-y-visible scrollbar-hide min-w-0 rounded-[1.5rem] border border-neutral-200 bg-white/70 p-1 shadow-[0_10px_30px_rgba(15,23,42,0.04)] backdrop-blur">
                                <motion.button
                                    onClick={() => { void requestViewModeChange("ai"); }}
                                    disabled={isModeSwitching}
                                    data-tour-chat-tab
                                    whileHover={{ y: -1 }}
                                    whileTap={{ scale: 0.98 }}
                                    className={`${viewModeTabBaseClass} ${
                                        viewMode === "ai"
                                            ? viewModeTabActiveClass
                                            : viewModeTabIdleClass
                                    } ${isModeSwitching ? "cursor-not-allowed opacity-60" : ""}`}
                                    title="Chat"
                                >
                                    {isModeSwitching && viewMode !== "ai" ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <MessageSquare className="relative z-10 h-4 w-4" />
                                    )}
                                    <span className="relative z-10">Chat</span>
                                </motion.button>
                                {!IS_PRODUCTION ? (
                                    <motion.button
                                        onClick={() => { void requestViewModeChange("code"); }}
                                        disabled={isModeSwitching}
                                        whileHover={{ y: -1 }}
                                        whileTap={{ scale: 0.98 }}
                                        className={`${viewModeTabBaseClass} ${
                                            viewMode === "code"
                                                ? viewModeTabActiveClass
                                                : viewModeTabIdleClass
                                            } ${isModeSwitching ? "cursor-not-allowed opacity-60" : ""}`}
                                        title="Code"
                                    >
                                        {isModeSwitching && viewMode !== "code" ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Code className="relative z-10 h-4 w-4" />
                                        )}
                                        <span className="relative z-10">Code</span>
                                        <DevOnlyIconBadge title="Development-only code tab" />
                                    </motion.button>
                                ) : null}
                                {/* {!IS_PRODUCTION ? ( */}
                                <motion.button
                                        onClick={() => {
                                            if (isMobile) {
                                                showDesktopOnlyToast();
                                                return;
                                            }
                                            void requestViewModeChange("images");
                                        }}
                                        disabled={isModeSwitching}
                                        data-tour-images-tab
                                        whileHover={{ y: -1 }}
                                        whileTap={{ scale: 0.98 }}
                                        className={`${viewModeTabBaseClass} hidden lg:inline-flex ${
                                            viewMode === "images"
                                                ? viewModeTabActiveClass
                                                : viewModeTabIdleClass
                                        } ${isModeSwitching ? "cursor-not-allowed opacity-60" : ""}`}
                                        title={shouldLockImagesTab ? "Images are available on Pro and Agency plans" : "Images"}
                                    >
                                        {isModeSwitching && viewMode !== "images" ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Images className="relative z-10 h-4 w-4" />
                                        )}
                                        <span className="relative z-10">Images</span>
                                    </motion.button>
                                {/* ) : null} */}
                                {/* {!IS_PRODUCTION ? ( */}
                                    <motion.button
                                        onClick={() => { if (isMobile) { showDesktopOnlyToast(); return; } void requestViewModeChange("custom"); }}
                                        disabled={isModeSwitching}
                                        data-tour-custom-tab
                                        whileHover={{ y: -1 }}
                                        whileTap={{ scale: 0.98 }}
                                        className={`${viewModeTabBaseClass} hidden lg:inline-flex ${
                                            viewMode === "custom"
                                                ? viewModeTabActiveClass
                                                : viewModeTabIdleClass
                                            } ${isModeSwitching ? "cursor-not-allowed opacity-60" : ""}`}
                                        title="Custom"
                                    >
                                        {isModeSwitching && viewMode !== "custom" ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Paintbrush className="relative z-10 h-4 w-4" />
                                        )}
                                        <span className="relative z-10">Custom</span>
                                    </motion.button>
                                {/* ) : null} */}
                            </div>

                        </div>

                        {/* AI Chat or Code View */}
                        <div className="flex-1 min-h-0 overflow-hidden">
                            <div data-tour-chat-panel className={viewMode === "ai" ? "h-full" : "hidden"}>
                                <AppBuilderEditorAgentChat
                                    appId={appId}
                                    files={app.files}
                                    currentFile={aiCurrentFile}
                                    onFileEdit={handleFileEditFromAI}
                                    onFilesReplace={handleFilesReplaceFromServer}
                                    onRestoreApplied={handleRestoreApplied}
                                    creditError={agentCreditError}
                                    previewReady={previewMode !== "webcontainer" ? true : isWebPreviewReady}
                                    previewIssue={previewMode !== "webcontainer" ? null : (previewIssue || autoPreviewError || previewError)}
                                    previewIssueActionLabel={previewIssueActionLabel}
                                    onPreviewIssueAction={() => {
                                        const normalizedPreviewIssueAction = String(previewIssueActionLabel || "").trim().toLowerCase();
                                        const shouldForceFreshRebuild = !normalizedPreviewIssueAction || normalizedPreviewIssueAction === "rebuild";
                                        void handleRefresh(shouldForceFreshRebuild);
                                    }}
                                    onPreviewIssueFixRequest={canFixPreviewIssueWithAi ? handlePreviewIssueFixRequest : undefined}
                                    onUserMessageSent={() => {
                                        appBuilderAiMessagesSentRef.current += 1;
                                    }}
                                    onRequestUpgradePaywall={openFreePlanUpgradePaywall}
                                    topupModalTrigger={topupModalTrigger}
                                    welcomeContext={agentWelcomeContext}
                                />
                            </div>

                            <div className={viewMode === "code" ? "h-full flex flex-col" : "hidden"}>
                                {/* File Tree */}
                                <div className="flex-1 border-b overflow-auto p-3">
                                    <div className="sticky top-0 z-20 -mx-3 mb-3 border-b border-neutral-200/80 bg-white/95 px-3 py-2 backdrop-blur-sm">
                                        <div className="flex items-center gap-3">
                                        <h3 className="font-medium text-sm">Files</h3>
                                        <div className="flex flex-1 justify-center">
                                            <div className="relative w-full max-w-[320px]">
                                                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                                                <input
                                                    type="text"
                                                    value={codeFileSearch}
                                                    onChange={(e) => setCodeFileSearch(e.target.value)}
                                                    placeholder="Search files"
                                                    className="w-full rounded-full border border-gray-300 bg-white/95 py-1.5 pl-9 pr-9 text-xs text-gray-800 outline-none transition focus:border-[#FF8D21] focus:ring-2 focus:ring-[#FF8D21]/20"
                                                />
                                                {codeFileSearchActive ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setCodeFileSearch("")}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                                        aria-label="Clear file search"
                                                    >
                                                        <X className="h-3.5 w-3.5" />
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                    </div>
                                    {filteredCodeFileTree.length > 0 ? (
                                        <FileTree
                                            nodes={filteredCodeFileTree}
                                            onFileSelect={handleFileSelect}
                                            expandedFolders={expandedFolders}
                                            onToggleFolder={handleToggleFolder}
                                            forceExpanded={codeFileSearchActive}
                                        />
                                    ) : (
                                        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-3 py-4 text-center text-xs text-gray-500">
                                            {codeFileSearchActive ? "No files match your search." : "No files available."}
                                        </div>
                                    )}
                                </div>

                                {/* Code Editor */}
                                <div className="flex-1">
                                    {currentFile ? (
                                        <Editor
                                            height="100%"
                                            language={getEditorLanguageForPath(currentFile)}
                                            value={code}
                                            onChange={handleCodeChange}
                                            theme="vs-dark"
                                            options={{
                                                minimap: { enabled: false },
                                                fontSize: 12,
                                                lineNumbers: "off",
                                                scrollBeyondLastLine: false,
                                            }}
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                                            Select a file to edit
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="hidden">
                                <div className="border-b p-3 space-y-3">
                                    <div className="flex items-center justify-end gap-3">
                                        {lastImageInsert ? (
                                            <button
                                                type="button"
                                                onClick={() => void undoLastImageInsert()}
                                                className="text-xs font-semibold text-[#FF8D21] hover:text-[#e09b63]"
                                            >
                                                Undo last insert
                                            </button>
                                        ) : null}
                                        {stagedImages.length ? (
                                            <button
                                                type="button"
                                                onClick={clearStagedImages}
                                                className="text-xs text-gray-600 hover:text-gray-900"
                                            >
                                                Clear all
                                            </button>
                                        ) : null}
                                    </div>

                                    <div className="flex flex-col items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={handlePickImages}
                                            className="inline-flex items-center gap-2 rounded-full bg-[#FF8D21] px-3 py-2 text-xs font-semibold text-white hover:bg-[#D96E11]"
                                        >
                                            <Upload className="w-3.5 h-3.5" />
                                            Upload
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handlePickFavicon}
                                            disabled={faviconUploading}
                                            className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                                            title="Upload a favicon.ico for this app"
                                        >
                                            {faviconUploading ? "Uploading favicon…" : "Upload favicon"}
                                        </button>
                                        {faviconUrl ? (
                                            <button
                                                type="button"
                                                onClick={() => window.open(faviconUrl, "_blank", "noopener,noreferrer")}
                                                className="text-[11px] font-semibold text-[#FF8D21] hover:text-[#e09b63]"
                                                title="Open current favicon"
                                            >
                                                View favicon
                                            </button>
                                        ) : null}
                                        <label className="inline-flex items-center gap-2 text-[11px] text-gray-500">
                                            <input
                                                type="checkbox"
                                                checked={autoCompressImages}
                                                onChange={(e) => setAutoCompressImages(e.target.checked)}
                                                className="rounded border-gray-300"
                                            />
                                            Auto-compress before upload
                                        </label>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-auto p-3 space-y-3">
                                    {stagedImages.length === 0 ? (
                                        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-xs text-gray-600">
                                            Add one or more images to stage them, then type placement prompts like insert into homepage top or add to footer.
                                        </div>
                                    ) : null}

                                    {stagedImages.map((item) => {
                                        const compressionPct = item.originalBytes > 0
                                            ? Math.max(0, Math.round((1 - item.preparedBytes / item.originalBytes) * 100))
                                            : 0;

                                        return (
                                            <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5">
                                                <div className="flex items-start gap-3">
                                                    <Image
                                                        src={item.previewUrl}
                                                        alt={item.alt || "Staged image"}
                                                        width={64}
                                                        height={64}
                                                        unoptimized
                                                        className="h-16 w-16 rounded-lg object-cover border border-gray-200"
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-xs font-semibold text-gray-900 truncate">{item.originalFile.name}</div>
                                                        <div className="text-[11px] text-gray-500">
                                                            {Math.round(item.originalBytes / 1024)}KB → {Math.round(item.preparedBytes / 1024)}KB
                                                            {item.preparedBytes < item.originalBytes ? ` (${compressionPct}% smaller)` : ""}
                                                        </div>

                                                        <details className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                                                            <summary className="cursor-pointer select-none text-[11px] text-gray-600">Alt text</summary>
                                                            <div className="mt-2">
                                                                <input
                                                                    type="text"
                                                                    value={item.alt}
                                                                    onChange={(e) => updateStagedImage(item.id, { alt: e.target.value })}
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs bg-white"
                                                                    placeholder="Alt text"
                                                                />
                                                            </div>
                                                        </details>

                                                        {item.error ? (
                                                            <div className="mt-2 text-[11px] text-amber-700">{item.error}</div>
                                                        ) : null}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeStagedImage(item.id)}
                                                        className="text-gray-500 hover:text-gray-900"
                                                        title="Remove"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>

                                                <div className="mt-4 mb-2 space-y-3">
                                                    <label className="block text-[12px] font-medium text-gray-700">Where should this go?</label>
                                                    <div className="relative flex items-center bg-white/95 gap-2 backdrop-blur-md p-2 pl-4 pr-2 shadow-[0_12px_30px_rgba(0,0,0,0.08)] ring-1 ring-neutral-200 rounded-full h-[48px]">
                                                        <input
                                                            type="text"
                                                            value={item.placementPrompt}
                                                            onChange={(e) => updateStagedImage(item.id, { placementPrompt: e.target.value })}
                                                            className="flex-1 bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400 font-medium text-[13px] sm:text-sm"
                                                            placeholder={IMAGE_PLACEMENT_PLACEHOLDERS[imagePromptPlaceholderIdx]}
                                                        />

                                                        <button
                                                            type="button"
                                                            onClick={() => void applyStagedImage(item.id)}
                                                            disabled={item.status === "uploading" || !item.placementPrompt.trim()}
                                                            className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition disabled:opacity-60 ${
                                                                item.status === "applied"
                                                                    ? "bg-emerald-100 text-emerald-700"
                                                                    : item.status === "uploading"
                                                                      ? "bg-neutral-200 text-neutral-600"
                                                                      : "bg-[#FF8D21] text-white hover:bg-[#D96E11]"
                                                            }`}
                                                            title={item.status === "applied" ? "Applied" : "Apply image"}
                                                            aria-label={item.status === "applied" ? "Applied" : "Apply image"}
                                                        >
                                                            {item.status === "applied" ? (
                                                                <Check className="h-4 w-4" />
                                                            ) : item.status === "uploading" ? (
                                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                                            ) : (
                                                                <Send className="h-4 w-4" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className={isVisualEditorMode ? "relative h-full flex flex-col" : "hidden"}>
                                <AnimatePresence mode="wait" initial={false}>
                                    {app ? (
                                        <motion.div
                                            key={`preview-editor-${appId}`}
                                            className="relative h-full min-h-[420px] flex-1"
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: 8 }}
                                            transition={{ duration: 0.24, ease: "easeOut" }}
                                        >
                                            <AppPreviewEditor
                                                appId={appId}
                                                files={app?.files || {}}
                                                initialPath={currentFile}
                                                onApplyHtml={handleApplyCustomHtml}
                                                onSelectPath={handleFileSelect}
                                                currentHtmlPath={currentFile || undefined}
                                                htmlEntryHints={(app as any)?.htmlEditIndex}
                                                preserveRuntimeScripts={shouldPreserveRuntimeScripts(projectFramework)}
                                                onSelectHtmlPath={handleFileSelect}
                                                editableHtmlPaths={Object.keys(app?.files || {})
                                                    .filter((path) => /\.html?$/i.test(path))
                                                    .sort((a, b) => a.localeCompare(b))}
                                                onClose={() => { void requestViewModeChange("ai"); }}
                                                appName={app?.name}
                                                onRenameSuccess={(newName) => setApp(prev => prev ? { ...prev, name: newName } : null)}
                                                baseHref={(protectedPreviewUrl || app?.previewUrl || previewSrc || undefined)}
                                                viewMode={viewMode}
                                                onChangeViewMode={(mode) => { void requestViewModeChange(mode); }}
                                                isProduction={IS_PRODUCTION}
                                                onSidebarVisibilityChange={setIsCustomSidebarOpen}
                                                sharedUiScale={customPreviewScale}
                                                onSharedUiScaleChange={setCustomPreviewScale}
                                                preferredSidePanelMode={viewMode === "images" ? "ai-library" : "style"}
                                                isVercelConnected={isVercelConnected}
                                                onConnectVercel={async () => {
                                                    await ensureFreshVercelConnection("images");
                                                }}
                                                hasVercelProject={Boolean(app?.vercelProjectId?.trim())}
                                                onPrepareVercelProject={runVercelDeployLive}
                                                onLiveHtml={handleVisualEditorLiveHtml}
                                                previewOpenToken={previewOpenToken}
                                                registerBeforeExitFlush={(fn) => {
                                                    previewEditorFlushRef.current = fn;
                                                }}
                                                onTakeBuilderTour={handleTakeBuilderTour}
                                                isFilesHydrated={filesHydrated}
                                                filesHydrationProgress={filesHydrationProgress}
                                                isPreviewReady={previewMode !== "webcontainer" ? true : isPreviewBootReady}
                                                isFilesHydrationActive={isFilesHydrationActive}
                                                deployLocked={deployLocked}
                                                accessLocked={accessLocked}
                                                showTour={showTour}
                                                onRequestDeployCheckout={onRequestDeployCheckout}
                                                showRightSidebarToggle={false}
                                            />
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="preview-loading"
                                            className="flex h-full min-h-[420px] items-center justify-center bg-white"
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: 8 }}
                                            transition={{ duration: 0.24, ease: "easeOut" }}
                                        >
                                            <div className="flex flex-col items-center gap-4 rounded-2xl border border-neutral-200 bg-white px-6 py-8 shadow-sm">
                                                <KlonerLoader />
                                                <div className="text-center">
                                                    <div className="text-sm font-semibold text-neutral-900">
                                                        Preparing preview
                                                    </div>
                                                    <div className="mt-1 text-sm text-neutral-600">
                                                        Loading your files before Custom and Images can render.
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>

                    {/* Resize Handle */}
                    {!isVisualEditorMode && (
                    <div
                        className="hidden md:block w-1 bg-gray-300 hover:bg-gray-400 cursor-col-resize transition-colors flex-shrink-0"
                        onMouseDown={() => setIsResizing(true)}
                        title="Drag to resize panels"
                    />
                    )}

                    {/* Right Panel - Browser-like App View */}
                    <div className={`${showRightPanel && !isVisualEditorMode ? "flex" : "hidden"} flex-1 flex flex-col min-h-0`}>
                        {showDeployBanner ? (
                            <div
                                className={`border-b px-4 py-3 sm:px-4 ${effectiveDeployBanner?.kind === "error"
                                    ? "border-amber-200 bg-[linear-gradient(180deg,rgba(255,251,240,0.98),rgba(255,255,255,1))] shadow-[0_18px_46px_rgba(15,23,42,0.10)]"
                                    : "border-emerald-200 bg-emerald-50/80 shadow-[0_18px_46px_rgba(16,185,129,0.10)]"
                                }`}
                            >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                    <div className="flex min-w-0 items-start gap-3">
                                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-white shadow-sm ${effectiveDeployBanner?.kind === "error" ? "border-amber-200 text-amber-600" : "border-emerald-200 text-emerald-600"}`}>
                                            {effectiveDeployBanner?.kind === "error" ? (
                                                <AlertTriangle className="h-4 w-4" />
                                            ) : (
                                                <Rocket className="h-4 w-4" />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-neutral-950">
                                                {effectiveDeployBanner?.title || "Deployment status"}
                                            </p>
                                            <p className="mt-1 text-sm leading-relaxed text-neutral-700">
                                                {effectiveDeployBanner?.detail}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                                        {effectiveDeployBanner?.kind === "error" && effectiveDeployBanner.fixAction ? (
                                            <button
                                                type="button"
                                                onClick={handleDeployBannerFixRequest}
                                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#FF8D21] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#D96E11] sm:w-auto"
                                            >
                                                {effectiveDeployBanner.fixAction === "connect_vercel" ? "Connect Vercel" : "Fix with AI"}
                                            </button>
                                        ) : null}
                                        {effectiveDeployBanner?.liveUrl ? (
                                            <button
                                                type="button"
                                                onClick={() => window.open(effectiveDeployBanner.liveUrl || lastDeployLiveUrl || "", "_blank", "noopener,noreferrer")}
                                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 sm:w-auto"
                                                title="Open live site"
                                            >
                                                View live
                                            </button>
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={() => setDismissedDeployBannerFingerprint(effectiveDeployBanner?.fingerprint || null)}
                                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 sm:w-auto"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {/* Browser Chrome */}
                        <div className="hidden md:flex bg-gray-100 border-b px-4 py-2 items-center gap-2">
                            <div className="flex gap-1">
                                <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                                <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                                <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                            </div>
                            <div className="ml-3 flex items-center gap-2 text-xs">
                                <a
                                    href="https://vercel.com/domains"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-gray-600 underline hover:text-gray-900"
                                    title="Attach a custom domain in Vercel"
                                >
                                    Attach custom domain
                                </a>
                            </div>

                            {lastSharePreviewUrl ? (
                                <div className="ml-2 flex items-center gap-2 text-xs">
                                    <button
                                        onClick={() => window.open(lastSharePreviewUrl, "_blank", "noopener,noreferrer")}
                                        className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-900 hover:bg-blue-100"
                                        title="Open site link"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        <span>Site link: {sharePreviewUrlShortLabel}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            const copied = await copyTextToClipboard(lastSharePreviewUrl);
                                            if (copied) {
                                                void showAlert("Site link copied to clipboard.", "Share preview");
                                            } else {
                                                void showAlert(`Site link:\n\n${lastSharePreviewUrl}`, "Share preview");
                                            }
                                        }}
                                        className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-3 py-1 text-blue-900 hover:bg-blue-50"
                                        title="Copy site link"
                                    >
                                        <Copy className="h-3.5 w-3.5" />
                                        <span>Copy</span>
                                    </button>
                                </div>
                            ) : null}

                        </div>

                        {/* App Content */}
                        <div data-tour-builder-preview className="flex-1 bg-white">
                            {previewMode === "webcontainer" ? (
                                isPreviewBootReady ? (
                                    <div ref={previewHydrationAnchorRef} className="relative h-full w-full p-3">
                                            <WebContainerRunner
                                                appId={appId}
                                                files={effectivePreviewFiles}
                                                filesReady={isPreviewBootReady}
                                                onFileChange={handleFileChangeFromContainer}
                                                onPreviewReadyChange={(ready) => {
                                                    if (ready) {
                                                        setIsWebPreviewReady(true);
                                                        setIsWebPreviewReadyLatched(true);
                                                    } else {
                                                        setIsWebPreviewReady(false);
                                                    }
                                                    if (ready && isPreviewBootReady) {
                                                        clearFilesHydrationTimer();
                                                        setFilesHydrationProgress(100);
                                                    }
                                                }}
                                                previewIssue={previewIssue}
                                            onPreviewIssueChange={(payload) => {
                                                setPreviewIssue(payload?.issue || null);
                                                setPreviewIssueDiagnostics(payload?.diagnostics || null);
                                                setPreviewIssueFailure(normalizePreviewFailureContract(payload?.failure));
                                                setPreviewIssueActionLabel(payload?.recommendedActionLabel || null);
                                            }}
                                            onNavigatePathChange={handlePreviewRouteChange}
                                            onCompileErrorFixRequest={handleCompileErrorFixRequest}
                                            debugPreviewScenario={previewDebugScenario}
                                            onBackendReady={() => {
                                                // Keep mode pinned to webcontainer, but do not auto-reconnect.
                                                // Auto-incrementing reconnectKey here causes a reconnect loop
                                                // immediately after the iframe becomes visible.
                                                setPreviewMode("webcontainer");
                                            }}
                                            onRequestRebuild={() => void handleRefresh(true)}
                                            reloadToken={refreshKey}
                                            applyToken={applyCompleteKey}
                                            restartToken={localRestartKey}
                                            reconnectToken={reconnectKey}
                                            forceFreshStart={forceFreshStartKey.current}
                                            navigatePath={previewNavigatePath}
                                            navigatePathToken={previewNavigateToken}
                                            pollingConfig={generationEver ? { maxPollingRetries: 480, maxContainerNotFound: 10 } : undefined}
                                        />
                                    </div>
                                ) : (
                                    <div ref={previewHydrationAnchorRef} className="relative h-full w-full bg-[radial-gradient(circle_at_top,rgba(255,141,33,0.08),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(250,250,250,1))]">
                                    </div>
                                )
                            ) : previewSrc ? (
                                <iframe
                                    title="App preview"
                                    src={previewSrc}
                                    className="w-full h-full"
                                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
                                    referrerPolicy="no-referrer"
                                />
                            ) : (
                                <div className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(255,141,33,0.08),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(250,250,250,1))] flex items-center justify-center px-4">
                                    <div className="w-full max-w-md rounded-[28px] border border-neutral-200 bg-white/95 p-6 text-center shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(255,141,33,0.10)] text-[#FF8D21] ring-1 ring-[rgba(255,141,33,0.16)]">
                                            <Monitor className="h-7 w-7" />
                                        </div>
                                        <div className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600">
                                            Preview status
                                        </div>
                                        <div className="mt-3 text-lg font-semibold text-neutral-900">Preview is booting</div>
                                        <div className="mt-2 text-sm leading-relaxed text-neutral-600">
                                            {autoPreviewPhase === "connecting"
                                                ? "Connect Vercel to load your preview."
                                                : autoPreviewPhase === "enabling-bypass"
                                                    ? "Configuring secure preview access…"
                                                    : autoPreviewPhase === "building"
                                                        ? `Building preview…${autoPreviewAttempt ? ` (attempt ${autoPreviewAttempt})` : ""}`
                                                        : autoPreviewPhase === "loading"
                                                            ? "Loading preview… Chat unlocks once the frame is ready."
                                                            : autoPreviewPhase === "error"
                                                                ? "Could not load preview."
                                                                : "Preparing preview…"}
                                        </div>

                                        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] font-medium text-neutral-500">
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF8D21]" />
                                                Waiting on the preview machine
                                            </span>
                                            <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1">
                                                Chat stays locked until the preview renders
                                            </span>
                                        </div>

                                        {autoPreviewPhase === "error" && autoPreviewBypassUnsupported ? (
                                            <div className="mb-4 w-full text-left">
                                                <div className="text-xs text-gray-600 mb-2">
                                                    If you create a Protection Bypass token in Vercel, paste it here to enable iframe embedding.
                                                </div>
                                                <div className="flex gap-2">
                                                    <input
                                                        value={vercelProtectionBypassDraft}
                                                        onChange={(e) => setVercelProtectionBypassDraft(e.target.value)}
                                                        placeholder="Vercel bypass token"
                                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                                                    />
                                                    <button
                                                        onClick={() => void saveVercelProtectionBypass()}
                                                        disabled={savingVercelProtectionBypass}
                                                        className="px-4 py-2 bg-gray-900 text-white rounded-full hover:bg-black disabled:opacity-50"
                                                    >
                                                        {savingVercelProtectionBypass ? "Saving…" : "Save"}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : null}

                                        <div className="flex flex-col gap-2 items-center">
                                            {protectedPreviewUrl ? (
                                                <button
                                                    onClick={() => window.open(protectedPreviewUrl, "_blank", "noopener,noreferrer")}
                                                    className="px-4 py-2 border border-gray-300 rounded-full hover:bg-gray-50"
                                                >
                                                    Open preview in new tab
                                                </button>
                                            ) : null}

                                            <button
                                                onClick={() => {
                                                    setPreviewMode("webcontainer");
                                                    setAutoPreviewError(null);
                                                }}
                                                className="px-4 py-2 border border-gray-300 rounded-full hover:bg-gray-50"
                                            >
                                                Use embedded local preview
                                            </button>

                                            <button
                                                onClick={() => {
                                                    if (autoPreviewBypassUnsupported && protectedPreviewUrl) {
                                                        window.open(protectedPreviewUrl, "_blank", "noopener,noreferrer");
                                                        return;
                                                    }
                                                    if (autoPreviewPhase === "connecting") {
                                                        startVercelOAuthForPreview();
                                                        return;
                                                    }
                                                    setPreviewMode("vercel");
                                                    void runAutoPreviewSequence({ force: true });
                                                }}
                                                disabled={
                                                    isPreviewBuilding ||
                                                    autoPreviewPhase === "building" ||
                                                    autoPreviewPhase === "enabling-bypass" ||
                                                    autoPreviewPhase === "loading"
                                                }
                                                className="px-4 py-2 bg-[#FF8D21] text-xs font-semibold text-white rounded-full hover:bg-[#D96E11] disabled:opacity-50"
                                            >
                                                {autoPreviewBypassUnsupported && protectedPreviewUrl
                                                    ? "Open preview"
                                                    : autoPreviewPhase === "connecting"
                                                    ? (vercelConnectOpening ? "Opening Vercel…" : "Connect Vercel")
                                                    : autoPreviewPhase === "building" ||
                                                        autoPreviewPhase === "enabling-bypass" ||
                                                        autoPreviewPhase === "loading"
                                                        ? "Working…"
                                                        : "Retry"}
                                            </button>

                                            {autoPreviewPhase === "connecting" ? (
                                                <div className="text-xs text-gray-500">
                                                    Preview requires Vercel. We’ll continue automatically after you connect.
                                                </div>
                                            ) : null}

                                            {(vercelDeploymentProtectionSettingsUrl || vercelSecuritySettingsUrl) ? (
                                                <button
                                                    onClick={() =>
                                                        window.open(
                                                            vercelDeploymentProtectionSettingsUrl || vercelSecuritySettingsUrl || "https://vercel.com/dashboard",
                                                            "_blank",
                                                            "noopener,noreferrer",
                                                        )
                                                    }
                                                    className="text-xs text-gray-600 underline"
                                                >
                                                    Open Vercel protection settings
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Mobile bottom tabs: keep preview in focus */}
                {desktopOnlyToast ? (
                    <div className="md:hidden fixed bottom-20 left-1/2 -translate-x-1/2 z-[99999] flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-xl">
                        <Monitor className="h-4 w-4 shrink-0 opacity-70" />
                        <span>Available on desktop</span>
                    </div>
                ) : null}
                <div className="md:hidden border-t bg-white px-2 py-2">
                    <div role="tablist" aria-label="Builder tabs" className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mobileTab === "app"}
                            data-tour-mobile-preview
                            onClick={() => {
                                setMobileTab("app");
                                setMobileControlsOpen(false);
                            }}
                            className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${
                                mobileTab === "app"
                                    ? "bg-[#FF8D21] text-white border-[#FF8D21]"
                                    : "bg-white text-neutral-800 border-neutral-300"
                            }`}
                            title="App"
                        >
                            <Monitor className="h-4 w-4" />
                            <span>Preview</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mobileTab === "prompt"}
                            data-tour-mobile-prompt
                            onClick={() => {
                                setMobileTab("prompt");
                                setMobileControlsOpen(false);
                            }}
                            className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${
                                mobileTab === "prompt"
                                    ? "bg-[#FF8D21] text-white border-[#FF8D21]"
                                    : "bg-white text-neutral-800 border-neutral-300"
                            }`}
                            title="Prompt"
                        >
                            <MessageSquare className="h-4 w-4" />
                            <span>Prompt</span>
                        </button>
                    </div>
                </div>

                {/* Mobile controls sheet */}
                {mobileControlsOpen ? (
                    <div
                        className="md:hidden fixed inset-0 z-[17500] bg-black/40 backdrop-blur-[1px] flex items-end"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Controls"
                        onClick={() => setMobileControlsOpen(false)}
                    >
                        <div
                            className="w-full rounded-t-2xl bg-white border border-neutral-200 shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-4 border-b flex items-center justify-between">
                                <div className="min-w-0">
                                    <div className="font-semibold text-neutral-900">Controls</div>
                                    <div className="text-[11px] text-neutral-600 truncate">
                                        {app?.name || "Untitled Project"}
                                    </div>
                                </div>
                                <button
                                    onClick={() => setMobileControlsOpen(false)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700"
                                    title="Close"
                                    aria-label="Close controls"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="p-4 space-y-2">
                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] font-semibold text-neutral-800">
                                    <span
                                        className={`mr-2 inline-block h-2 w-2 rounded-full ${
                                            isPreviewBuilding
                                                ? "bg-amber-500"
                                                : isRefreshing
                                                  ? "bg-blue-500"
                                                  : isWebPreviewReady
                                                    ? "bg-green-500"
                                                    : "bg-neutral-400"
                                        }`}
                                        aria-hidden="true"
                                    />
                                    Machine: {isPreviewBuilding ? "Starting" : isRefreshing ? "Refreshing" : isWebPreviewReady ? "Ready" : "Idle"}
                                </div>

                                <div className={`grid gap-2 ${IS_PRODUCTION ? "grid-cols-1" : "grid-cols-2"}`}>
                                    {!IS_PRODUCTION ? (
                                        <button
                                            onClick={() => {
                                                setMobileControlsOpen(false);
                                                void handleSave(true);
                                            }}
                                            disabled={isSaving}
                                            className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold bg-[#FF8D21] text-white disabled:opacity-60"
                                            title="Save"
                                        >
                                            <Upload className="h-4 w-4" />
                                            <DevOnlyIconBadge title="Development-only save control" />
                                            <span>{isSaving ? "Saving…" : "Save"}</span>
                                        </button>
                                    ) : null}

                                    <button
                                        onClick={() => {
                                            setMobileControlsOpen(false);
                                            handleReconnect();
                                        }}
                                        disabled={isRefreshing || isPreviewBuilding}
                                        className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800 disabled:opacity-60"
                                        title="Refresh machine"
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                        <span>Refresh</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setMobileControlsOpen(false);
                                            void handleRefresh(true);
                                        }}
                                        disabled={isPreviewBuilding || isRefreshing}
                                        className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800 disabled:opacity-60"
                                        title="Rebuild machine"
                                    >
                                        <RefreshCw className="h-4 w-4" />
                                        <span>Rebuild</span>
                                    </button>

                                    {isDev ? (
                                        <button
                                            onClick={() => void openDatabaseConnect()}
                                            className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800"
                                            title={supabaseConnected && (supabaseProjectName || supabaseProjectRef) ? `Connected to: ${supabaseProjectName || supabaseProjectRef}` : supabaseConnected ? "Open Supabase" : "Connect Database"}
                                        >
                                            <Database className="h-4 w-4 shrink-0" />
                                            {supabaseConnected && (supabaseProjectName || supabaseProjectRef) ? (
                                                <span className="flex flex-col items-start leading-tight">
                                                    <span className="text-[10px] uppercase tracking-wide opacity-60">Database</span>
                                                    <span className="max-w-[140px] truncate">{supabaseProjectName || supabaseProjectRef}</span>
                                                </span>
                                            ) : (
                                                <span>{supabaseConnected ? "Database" : "Connect Database"}</span>
                                            )}
                                            <DevOnlyIconBadge title="Development-only database controls" />
                                        </button>
                                    ) : null}
                                </div>

                                {isDev && supabaseConnected ? (
                                    <button
                                        onClick={() => {
                                            setMobileControlsOpen(false);
                                            void disconnectSupabase();
                                        }}
                                        className="w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-red-200 bg-white text-red-700"
                                        title="Disconnect database"
                                    >
                                        <X className="h-4 w-4" />
                                        <span>Disconnect DB</span>
                                    </button>
                                ) : null}

                                {lastDeployLiveUrl ? (
                                    <button
                                        onClick={() => window.open(lastDeployLiveUrl, "_blank", "noopener,noreferrer")}
                                        className="w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800"
                                        title="Open live deployment"
                                    >
                                        <Rocket className="h-4 w-4" />
                                        <span>View live</span>
                                    </button>
                                ) : null}

                                {isDev ? (
                                    <button
                                        onClick={() => {
                                            setMobileControlsOpen(false);
                                            void handleSharePreview();
                                        }}
                                        disabled={isSharingPreview}
                                        className="w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-neutral-300 bg-white text-neutral-800 disabled:opacity-60"
                                        title={shareChoiceError || "Create a shareable preview link"}
                                    >
                                        <Share2 className="h-4 w-4" />
                                        <span>{isSharingPreview ? "Sharing…" : "Share preview"}</span>
                                        <DevOnlyIconBadge title="Development-only share control" />
                                    </button>
                                ) : null}

                                {showShareSuccess ? (
                                    <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-900">
                                        <div className="font-semibold">Share preview created</div>
                                        <div className="mt-0.5 text-[11px] text-blue-800/90">Saved in the editor for later reuse.</div>
                                        {lastSharePreviewUrl ? (
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => window.open(lastSharePreviewUrl, "_blank", "noopener,noreferrer")}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-900"
                                                    title="Open site link"
                                                >
                                                    <ExternalLink className="h-3 w-3" />
                                                    <span>Site link</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        const copied = await copyTextToClipboard(lastSharePreviewUrl);
                                                        if (copied) {
                                                            void showAlert("Site link copied to clipboard.", "Share preview");
                                                        } else {
                                                            void showAlert(`Site link:\n\n${lastSharePreviewUrl}`, "Share preview");
                                                        }
                                                    }}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-900"
                                                    title="Copy site link"
                                                >
                                                    <Copy className="h-3 w-3" />
                                                    <span>Copy</span>
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}

                {shouldRunBuilderTour ? (
                    <AppBuilderEditorTour
                        startToken={builderTourStartToken}
                        onEnd={() => {
                            setHasCompletedBuilderTour(true);
                        }}
                    />
                ) : null}

                <WebsitePrePaywall
                    open={showAccessPaywall}
                    onClose={onClose}
                    onStartCheckout={() => {
                        onRequestDeployCheckout?.();
                    }}
                    checkoutBusy={trialCheckoutBusy}
                    zIndexClassName="z-[9999999999]"
                    title="Unlock the full editing experience"
                    description="Upgrade to unlock editing, keep your momentum, and turn your changes into a live website."
                    primaryLabel={TRIAL_CTA_LABEL}
                    secondaryLabel="No, I don't want this website"
                    footerNote="Cancel anytime before renewal."
                    dismissible={false}
                />

                <WebsitePrePaywall
                    open={showDeployUpgradePaywall}
                    onClose={() => setShowDeployUpgradePaywall(false)}
                    onStartCheckout={() => {
                        setShowDeployUpgradePaywall(false);
                        onRequestDeployCheckout?.();
                    }}
                    checkoutBusy={trialCheckoutBusy}
                    zIndexClassName="z-[20001]"
                    title={upgradePaywallCopy.title}
                    description={upgradePaywallCopy.description}
                    benefits={upgradePaywallCopy.benefits}
                    primaryLabel={upgradePaywallCopy.primaryLabel}
                    footerNote={upgradePaywallCopy.footerNote}
                />

                {vercelConnectOpen && (
                    <div className="fixed inset-0 z-[17000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                        <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-lg">
                            <div className="flex items-start justify-between gap-4 border-b bg-gradient-to-b from-gray-50 to-white px-5 py-5">
                                <div className="min-w-0 space-y-1">
                                    <div className="text-2xl font-semibold tracking-tight text-neutral-900">Connect Vercel</div>
                                    <div className="text-sm leading-6 text-neutral-600">Unlock production-style previews and deploys.</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setVercelConnectOpen(false);
                                        setVercelConnectOpening(false);
                                    }}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800"
                                    title="Close"
                                    aria-label="Close"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="px-5 py-5">
                                <div className="text-sm leading-6 text-neutral-700">
                                    Required to build previews and deploy your app live.
                                </div>

                                <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm leading-6 text-neutral-700">
                                    <span className="font-semibold text-neutral-900">Status:</span>{" "}
                                    {isVercelChecking
                                        ? "Checking connection…"
                                        : vercelConnectOpening
                                            ? "Opening Vercel…"
                                            : isVercelConnected
                                                ? "Connected. You can build a preview now."
                                                : "Not connected yet."}
                                </div>

                                <div className="mt-4 flex flex-col gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (isVercelChecking || vercelConnectOpening) return;

                                            if (isVercelConnected) {
                                                setVercelConnectOpen(false);
                                                return;
                                            }

                                            if (vercelConnectFlow === "share") {
                                                startVercelOAuthForSharePreview();
                                                return;
                                            }

                                            if (vercelConnectFlow === "images") {
                                                startVercelOAuthForImageLibrary();
                                                return;
                                            }

                                            startVercelOAuthForPreview();
                                        }}
                                        disabled={isVercelChecking || vercelConnectOpening}
                                        className="inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#FF8D21] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {(isVercelChecking || vercelConnectOpening) ? (
                                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                                        ) : null}
                                        <span>
                                            {vercelConnectOpening
                                                ? "Opening Vercel…"
                                                : isVercelChecking
                                                    ? "Checking…"
                                                    : isVercelConnected
                                                        ? "Continue"
                                                        : "Connect Vercel"}
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={async () => {
                                            await refreshVercelStatus();
                                            setVercelConnectOpening(false);
                                        }}
                                        className="inline-flex h-auto w-full items-center justify-center whitespace-nowrap rounded-none border-0 bg-transparent px-0 py-1 text-xs font-medium text-neutral-500 transition hover:bg-transparent hover:text-neutral-700"
                                        title="Re-check connection"
                                    >
                                        I already connected
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </motion.div>
        </div>
    );
}
