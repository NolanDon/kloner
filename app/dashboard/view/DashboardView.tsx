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
import logo from "@/public/images/orange_logo.png";
import { createPortal, flushSync } from "react-dom";
import { toast } from "react-hot-toast";

import { useRouter, useSearchParams } from "next/navigation";
import {
    onAuthStateChanged,
    User as FirebaseUser,
    getIdTokenResult,
    signOut as firebaseSignOut,
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
    Clock3,
    Crown,
    BrushIcon,
    Clock10,
    Loader2,
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
    Send,
    Trash2,
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
import { ensureSessionAndCsrf, resetAuthClientCaches } from "@/lib/auth-client";
import type { UrlDoc } from "@/app/dashboard/types";
import { useVercelIntegration } from "@/src/hooks/useVercelIntegration";
import { archiveRender, filterRendersForBuilder, resolveStorageUrl, useResolvedImg } from "@/src/lib/renders";
import { archiveApp } from "@/src/lib/apps";
import { AnimatePresence, motion } from "framer-motion";
import { extractArchivedPageIdsFromRender, fetchRenderForDeployment, getArchivedRoutesForRender, persistArchivedPageIds, scrubArchivedRoutes, secureHtmlForPreviewIframe, withArchivedPageIds } from "@/components/helpers";
import { useModal } from "@/components/ui/ModalContext";
import AppBuilderEditor from "@/components/AppBuilderEditor";
import { PROMPT_PLACEHOLDERS } from "@/src/lib/promptPlaceholders";
import { useRotatingPlaceholderIndex } from "@/src/hooks/useRotatingPlaceholderIndex";
import { validateAndNormalizePublicHttpUrl } from "@/src/lib/publicHttpUrl";
import { recordAppBuilderSessionAnalytics, recordDeployAnalytics } from "@/components/analytics";

const VERCEL_INTEGRATION_SLUG =
    process.env.NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG || "kloner";

const ACCENT = "#f55f2a";
const CAPTURE_STALL_TIMEOUT_MS = 6 * 60 * 1000;
const RENDER_STALL_TIMEOUT_MS = 5 * 60 * 1000;
const CAPTURE_ISSUE_NOTICE_MS = 10 * 1000;
const FRONTEND_TIMEOUT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const FRONTEND_TIMEOUT_DEDUPE_STORAGE_KEY = "dashboardViewFrontendTimeoutAlertsV1";
const CAPTURE_STALE_ALERT_STORAGE_KEY = "dashboardViewCaptureStaleAlertsV1";
const URL_ADD_SUCCESS_MESSAGE = "Successfully added your URL.";
const APP_WIZARD_PROMPT_MAX_CHARS = 2000;
const FIRST_GEN_TRIAL_OBSERVE_MS = 15 * 1000;
const FIRST_GEN_TRIAL_SESSION_INTERVAL = 3;
const RENDER_TRIAL_SESSION_STORAGE_KEY = "kloner.firstGenTrial.renderSessions.v1";
const APP_BUILDER_TRIAL_SESSION_STORAGE_KEY = "kloner.firstGenTrial.appBuilderSessions.v1";
const CHECKOUT_FETCH_TIMEOUT_MS = 20_000;

const APP_BUILDER_COOKIE_CONSENT_KEY = "kloner.appBuilder.necessaryCookiesAccepted.v1";
const APP_BUILDER_COOKIE_CONSENT_COOKIE = "kloner_app_builder_nc";

function getCookieValueSafe(name: string): string | null {
    if (typeof document === "undefined") return null;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1] || "") : null;
}

function hasAcceptedAppBuilderNecessaryCookies(): boolean {
    if (typeof window === "undefined") return false;
    try {
        if (window.localStorage.getItem(APP_BUILDER_COOKIE_CONSENT_KEY) === "1") return true;
    } catch {
        // ignore
    }
    return getCookieValueSafe(APP_BUILDER_COOKIE_CONSENT_COOKIE) === "1";
}

function persistAppBuilderNecessaryCookiesConsent(): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    try {
        window.localStorage.setItem(APP_BUILDER_COOKIE_CONSENT_KEY, "1");
    } catch {
        // ignore
    }
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${APP_BUILDER_COOKIE_CONSENT_COOKIE}=1; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
}

function shouldShowTrialPromptForSession(storageKey: string, everyNthSession: number): boolean {
    if (typeof window === "undefined") return false;
    const safeEvery = Number.isFinite(everyNthSession) && everyNthSession > 1
        ? Math.floor(everyNthSession)
        : 3;
    try {
        const raw = window.localStorage.getItem(storageKey);
        const prev = Number.parseInt(raw || "0", 10);
        const next = Number.isFinite(prev) && prev > 0 ? prev + 1 : 1;
        window.localStorage.setItem(storageKey, String(next));
        return next % safeEvery === 0;
    } catch {
        return false;
    }
}

function readCaptureStaleAlertCache(): Record<string, number> {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.sessionStorage.getItem(CAPTURE_STALE_ALERT_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        return parsed as Record<string, number>;
    } catch {
        return {};
    }
}

function writeCaptureStaleAlertCache(cache: Record<string, number>): void {
    if (typeof window === "undefined") return;
    try {
        const keys = Object.keys(cache);
        if (!keys.length) {
            window.sessionStorage.removeItem(CAPTURE_STALE_ALERT_STORAGE_KEY);
            return;
        }
        window.sessionStorage.setItem(CAPTURE_STALE_ALERT_STORAGE_KEY, JSON.stringify(cache));
    } catch {
        // ignore
    }
}

function hasCaptureStaleAlertBeenSent(normalizedUrl: string): boolean {
    if (typeof window === "undefined") return false;
    const cache = readCaptureStaleAlertCache();
    return typeof cache[normalizedUrl] === "number";
}

function markCaptureStaleAlertSent(normalizedUrl: string): void {
    if (typeof window === "undefined") return;
    const cache = readCaptureStaleAlertCache();
    cache[normalizedUrl] = Date.now();
    writeCaptureStaleAlertCache(cache);
}

function clearCaptureStaleAlertSent(normalizedUrl: string): void {
    if (typeof window === "undefined") return;
    const cache = readCaptureStaleAlertCache();
    if (!Object.prototype.hasOwnProperty.call(cache, normalizedUrl)) return;
    delete cache[normalizedUrl];
    writeCaptureStaleAlertCache(cache);
}

type UrlStatusUi = "queued" | "processing" | "ready" | "stale" | "error" | "unknown";

function normalizeUrlStatus(
    raw?: UrlDoc["status"],
    shotCount?: number,
    updatedAt?: any,
    lastError?: unknown,
): UrlStatusUi {
    const s = String(raw || "unknown").toLowerCase();
    const lastErrorText = String(lastError || "").toLowerCase();

    if (s === "stale") return "stale";
    if (s === "error") return "error";
    if (lastErrorText) return "error";
    if (s === "uploaded" || s === "done" || s === "ready") return "ready";
    if (s === "in_progress" || s === "processing") return "processing";

    if (s === "queued") {
        const STALE_MIN_MS = 6 * 60 * 1000;
        const ts =
            typeof updatedAt?.toMillis === "function"
                ? updatedAt.toMillis()
                : Date.parse(updatedAt || "");
        if (Number.isFinite(ts) && Date.now() - ts > STALE_MIN_MS) return "stale";
        return (shotCount || 0) > 0 ? "processing" : "queued";
    }

    return "unknown";
}

function stripHttpsUrlsFromPrompt(input: string): string {
    const raw = String(input || "");
    if (!raw) return "";
    return raw
        .replace(/https:\/\/[^\s]+/gi, "")
        .replace(/[ \t]{2,}/g, " ");
}

function truncateMiddle(value: string, maxLen = 72): string {
    const text = String(value || "");
    if (text.length <= maxLen) return text;
    const head = Math.ceil((maxLen - 3) * 0.65);
    const tail = Math.floor((maxLen - 3) * 0.35);
    return `${text.slice(0, head)}...${text.slice(text.length - tail)}`;
}

type MiniDashboardEntryProps = {
    onSubmitUrl: (rawUrl: string) => void;
    onSubmitPrompt: (prompt: string) => void;
    planLabel?: string;
    userTier?: UserTier | "unknown";
    screenshotRemaining?: number | null;
    screenshotLimitDisplay?: string | number | null;
    previewRemaining?: number | null;
    previewLimitDisplay?: string | number | null;
    editRemaining?: number | null;
    editLimitDisplay?: string | number | null;
    onManagePlan?: () => void;
    size?: "compact" | "full";
    disabled?: boolean;
    captureStatus?: UrlStatusUi | null;
    captureIssueNotice?: string | null;
    hideCaptureQueueStatus?: boolean;
};

function MiniDashboardEntry({
    onSubmitUrl,
    onSubmitPrompt,
    planLabel,
    userTier = "unknown",
    screenshotRemaining = null,
    screenshotLimitDisplay = null,
    previewRemaining = null,
    previewLimitDisplay = null,
    editRemaining = null,
    editLimitDisplay = null,
    onManagePlan,
    size = "compact",
    disabled = false,
    captureStatus = null,
    captureIssueNotice = null,
    hideCaptureQueueStatus = false,
}: MiniDashboardEntryProps) {
    const isCompact = size === "compact";
    const [mode, setMode] = useState<"url" | "prompt">("url");
    const [url, setUrl] = useState("");
    const [prompt, setPrompt] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const [isFocused, setIsFocused] = useState(false);
    const promptPlaceholderIdx = useRotatingPlaceholderIndex({
        enabled: mode === "prompt",
        length: PROMPT_PLACEHOLDERS.length,
        intervalMs: 3200,
    });

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (busy || disabled) return;

        setError(null);
        setBusy(true);
        try {
            if (mode === "url") {
                const v = (url || "").trim();
                if (!v) {
                    setError("Enter a URL to continue.");
                    return;
                }
                const normalized = validateAndNormalizePublicHttpUrl(v);
                if (!normalized) {
                    setError("Please enter a valid public http(s) URL.");
                    return;
                }
                onSubmitUrl(normalized);
                return;
            }

            const p = stripHttpsUrlsFromPrompt(prompt || "").trim();
            if (!p) {
                setError("Enter a prompt to continue.");
                return;
            }
            onSubmitPrompt(p);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div
            className={
                "rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 shadow-sm " +
                (isCompact ? "px-4 py-4 sm:px-6 sm:py-7" : "px-4 py-5 sm:px-8 sm:py-10")
            }
        >
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div
                        className={
                            "hidden sm:inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 mb-4 " +
                            (isCompact ? "text-[10px] mb-3" : "text-[11px] mb-4")
                        }
                    >
                        <span>Kloner · Dashboard</span>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                        <h2
                            className={
                                "tracking-tight text-neutral-900 " +
                                (isCompact ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl")
                            }
                        >
                            Dashboard
                        </h2>
                        {userTier !== "unknown" && planLabel ? (
                            <div className="inline-flex items-center">
                                <div className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent-50 px-2 py-1">
                                    <Crown className="h-2.5 w-2.5 text-accent" />
                                    <span className="text-[9px] font-semibold uppercase tracking-wide text-accent">
                                        {planLabel}
                                    </span>
                                </div>
                                {onManagePlan ? (
                                    <span className="inline-flex">
                                        <button
                                            type="button"
                                            onClick={onManagePlan}
                                            title={userTier === "free" ? "Upgrade plan" : "Manage plan"}
                                            aria-label={userTier === "free" ? "Upgrade plan" : "Manage plan"}
                                            className="group inline-flex items-center justify-center rounded-md p-1 transition-all duration-150 hover:bg-white/10 hover:scale-[1.06] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[#C6F44D]/60 focus:ring-offset-2 focus:ring-offset-transparent"
                                        >
                                            <Edit2 className="h-3 w-3 opacity-80 transition-opacity group-hover:opacity-100" />
                                        </button>
                                    </span>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    <div className={"my-4 flex flex-wrap gap-2 " + (isCompact ? "text-[11px]" : "text-xs")}>
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

                        <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-700">
                            AI credits:&nbsp;
                            <span className="font-semibold text-neutral-900">
                                {editRemaining === null
                                    ? "-"
                                    : editLimitDisplay
                                        ? `${editRemaining}/${editLimitDisplay}`
                                        : `${editRemaining}`}
                            </span>
                        </span>
                    </div>


                </div>
            </div>

            <div className={"mt-6 inline-flex rounded-full border border-neutral-200 bg-white p-1 " + (isCompact ? "text-[11px]" : "text-xs")}>
                <button
                    type="button"
                    onClick={() => {
                        setMode("url");
                        setError(null);
                        setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    disabled={disabled}
                    className="rounded-full px-3 py-1.5 transition text-white"
                    style={mode === "url" ? { backgroundColor: ACCENT } : { backgroundColor: "transparent", color: "#404040" }}
                >
                    URL
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setMode("prompt");
                        setError(null);
                        setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    disabled={disabled}
                    className="rounded-full px-3 py-1.5 transition text-white"
                    style={mode === "prompt" ? { backgroundColor: ACCENT } : { backgroundColor: "transparent", color: "#404040" }}
                >
                    Prompt
                </button>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="mt-4">
                <div
                    className={
                        "relative flex items-center bg-white/95 backdrop-blur-md p-2 pl-4 sm:pl-6 shadow-[0_12px_30px_rgba(0,0,0,0.08)] ring-1 ring-neutral-200 transition-all duration-300 ease-out " +
                        (mode === "prompt"
                            ? isCompact
                                ? "rounded-3xl h-[84px] sm:h-[92px]"
                                : "rounded-3xl h-[116px] sm:h-[116px]"
                            : isCompact
                                ? "rounded-full h-[48px] sm:h-[52px]"
                                : "rounded-full h-[64px] sm:h-[72px]")
                    }
                >
                    {mode === "url" ? (
                        <span className={"hidden sm:inline text-neutral-400 font-medium mr-1 " + (isCompact ? "text-sm" : "text-lg")}>
                            https://
                        </span>
                    ) : null}

                    {mode === "prompt" ? (
                        <textarea
                            ref={inputRef as any}
                            value={prompt}
                            onChange={(e) => {
                                const v = stripHttpsUrlsFromPrompt(e.target.value);
                                setPrompt(v);
                                setError(null);
                            }}
                            onPaste={(e) => {
                                const pasted = e.clipboardData.getData("text");
                                if (!pasted) return;
                                e.preventDefault();
                                setPrompt(stripHttpsUrlsFromPrompt(pasted));
                                setError(null);
                            }}
                            placeholder=""
                            rows={3}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                            disabled={disabled}
                            className={
                                "flex-1 bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400 font-medium resize-none h-full leading-snug " +
                                (isCompact ? "text-[13px] sm:text-sm py-2" : "text-base sm:text-lg py-3")
                            }
                            autoComplete="off"
                        />
                    ) : (
                        <input
                            ref={inputRef as any}
                            value={url}
                            onChange={(e) => {
                                setUrl(e.target.value);
                                setError(null);
                            }}
                            onPaste={(e) => {
                                const pasted = e.clipboardData.getData("text");
                                if (!pasted) return;
                                e.preventDefault();
                                setUrl(pasted);
                                setError(null);
                            }}
                            placeholder="example.com"
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                            disabled={disabled}
                            className={
                                "flex-1 bg-transparent outline-none text-neutral-700 placeholder:text-neutral-400 font-medium " +
                                (isCompact ? "text-[13px] sm:text-sm" : "text-base sm:text-lg")
                            }
                            autoComplete="off"
                        />
                    )}

                    {mode === "prompt" && !prompt ? (
                        <div
                            className={
                                "pointer-events-none absolute left-0 right-0 top-0 pl-4 sm:pl-6 pr-[72px] sm:pr-[80px] pt-4 text-left " +
                                (isFocused ? "opacity-60" : "opacity-100")
                            }
                            aria-hidden
                        >
                            <AnimatePresence mode="wait">
                                <motion.span
                                    key={promptPlaceholderIdx}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -6 }}
                                    transition={{ duration: 0.35, ease: "easeOut" }}
                                    className={
                                        "block ml-[0.65ch] text-neutral-400/90 font-medium leading-snug max-h-[4.4em] overflow-hidden " +
                                        (isCompact ? "text-[13px] sm:text-sm" : "text-base sm:text-lg")
                                    }
                                >
                                    {PROMPT_PLACEHOLDERS[promptPlaceholderIdx]}
                                </motion.span>
                            </AnimatePresence>
                        </div>
                    ) : null}

                    <button
                        type="submit"
                        disabled={disabled || busy || (mode === "prompt" ? !prompt.trim() : !url.trim())}
                        className={
                            "shrink-0 rounded-full text-white transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed " +
                            (mode === "prompt"
                                ? "h-11 w-11 grid place-items-center"
                                : "h-full px-6 sm:px-10 max-[380px]:h-11 max-[380px]:w-11 max-[380px]:grid max-[380px]:place-items-center max-[380px]:px-0")
                        }
                        style={{ backgroundColor: ACCENT }}
                        aria-label={mode === "prompt" ? "Create from prompt" : "Preview from URL"}
                    >
                        {disabled && (captureStatus === "queued" || captureStatus === "processing") ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="sr-only">
                                    {captureStatus === "queued" ? "Queued" : "Processing"}
                                </span>
                            </>
                        ) : mode === "prompt" ? (
                            <>
                                <Send className="h-4 w-4" />
                                <span className="sr-only">Preview</span>
                            </>
                        ) : (
                            <>
                                <Send className="hidden max-[380px]:inline h-4 w-4" />
                                <span className="max-[380px]:hidden">Add URL</span>
                                <span className="sr-only">Add URL</span>
                            </>
                        )}
                    </button>
                </div>

                {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}

                {captureIssueNotice ? (
                    <div className="mt-4 inline-flex items-center gap-2 text-xs text-amber-700">
                        <MessageCircleWarning className="h-3.5 w-3.5" />
                        {captureIssueNotice}
                    </div>
                ) : !hideCaptureQueueStatus && disabled && (captureStatus === "queued" || captureStatus === "processing") ? (
                    <div className="mt-4 inline-flex items-center gap-2 text-xs text-neutral-600">
                        {captureStatus === "queued" ? (
                            <Clock3 className="h-3.5 w-3.5" />
                        ) : (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        {captureStatus === "queued"
                            ? "Queued scan… "
                            : "Processing your URL… This may take a few minutes. After processing, you can begin website generation."}
                    </div>
                ) : null}

            </form>
        </div>
    );
}

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
    onRenameRender: (id: string, name: string) => Promise<void>;
};

function getTimestampMs(value: any): number | null {
    if (!value) return null;
    if (typeof value?.toMillis === "function") {
        const millis = value.toMillis();
        return Number.isFinite(millis) ? millis : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function isGenerationTierBlockedMessage(message: string): boolean {
    const lower = String(message || "").toLowerCase();
    return (
        lower.includes("upgrade to pro") ||
        lower.includes("upgrade to pro or agency") ||
        lower.includes("app_generation_tier_blocked") ||
        lower.includes("app_wizard_tier_blocked") ||
        lower.includes("app_create_tier_blocked")
    );
}

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
    onRenameRender,
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
        if (p < 10) return "Starting… ~4 min left";
        if (p < 25) return "Reading layout… ~3 min left";
        if (p < 45) return "Generating page… ~2 min left";
        if (p < 65) return "Applying styles… ~1 min left";
        if (p < 80) return "Linking sections… ~1 min left";
        if (p < 95) return "Finalizing… <1 min left";
        return "Wrapping up…";
    }, [normalizedProgressPercent, isDeploying, r]);

    const hasProgressInfo = !isComplete && hasActiveProgress;
    const isBuilding = hasActiveProgress;

    // only the card that is actually building/deploying is locked
    const isThisCardLockedForBuild = hasActiveProgress;
    const [allowStuckCardCancel, setAllowStuckCardCancel] = useState(false);

    useEffect(() => {
        if (!isQueued) {
            setAllowStuckCardCancel(false);
            return;
        }

        const startedAtMs = getTimestampMs(r.updatedAt) ?? getTimestampMs(r.createdAt);
        if (!startedAtMs) {
            setAllowStuckCardCancel(false);
            return;
        }

        const elapsedMs = Date.now() - startedAtMs;
        const remainingMs = Math.max(0, RENDER_STALL_TIMEOUT_MS - elapsedMs);
        if (remainingMs === 0) {
            setAllowStuckCardCancel(true);
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setAllowStuckCardCancel(true);
        }, remainingMs);

        return () => window.clearTimeout(timeoutId);
    }, [isQueued, r.updatedAt, r.createdAt, r.id]);

    const isStuckQueued = isQueued && allowStuckCardCancel;

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
    const renderDisplayName = (() => {
        const hinted = String(r.nameHint || "").trim();
        if (hinted) return hinted;
        try {
            const rawUrl = String((r as any)?.url || "").trim();
            if (rawUrl) return new URL(rawUrl).hostname.replace(/^www\./, "");
        } catch {
            // ignore
        }
        return `Render ${String(r.id || "").slice(0, 8)}`;
    })();
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState(renderDisplayName);

    useEffect(() => {
        if (!isEditingName) {
            setNameDraft(renderDisplayName);
        }
    }, [isEditingName, renderDisplayName]);

    const submitRenderRename = useCallback(async () => {
        const trimmed = nameDraft.trim();
        if (!trimmed) {
            setNameDraft(renderDisplayName);
            setIsEditingName(false);
            return;
        }
        if (trimmed === renderDisplayName) {
            setIsEditingName(false);
            return;
        }
        await onRenameRender(r.id, trimmed);
        setIsEditingName(false);
    }, [nameDraft, onRenameRender, r.id, renderDisplayName]);

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
                        v1
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
                    disabled={isDeleting || (isBuilding && !isStuckQueued)}
                    aria-label="Discard preview"
                    title={isStuckQueued ? "Delete this preview and clear the stuck processing state" : "Delete this editable preview"}
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
                    <div className="pointer-events-auto flex w-[calc(100%-1rem)] max-w-xs flex-col items-stretch rounded-xl border border-neutral-200 bg-white/80 p-3 text-[11px] shadow-lg backdrop-blur-sm min-[420px]:w-auto min-[420px]:text-xs md:max-w-sm">
                        <div className="mb-3 rounded-lg border border-neutral-300 bg-white/90 px-2.5 py-1.5 shadow-sm">
                            {isEditingName ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        value={nameDraft}
                                        onChange={(e) => setNameDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                void submitRenderRename();
                                            }
                                            if (e.key === "Escape") {
                                                e.preventDefault();
                                                setNameDraft(renderDisplayName);
                                                setIsEditingName(false);
                                            }
                                        }}
                                        className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-400"
                                        aria-label="Rename website"
                                        maxLength={80}
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void submitRenderRename()}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                                        aria-label="Save name"
                                        title="Save"
                                    >
                                        <CheckCheck className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setNameDraft(renderDisplayName);
                                            setIsEditingName(false);
                                        }}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                                        aria-label="Cancel rename"
                                        title="Cancel"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <div
                                        className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-neutral-900"
                                        title={renderDisplayName}
                                    >
                                        {renderDisplayName}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsEditingName(true)}
                                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                                        aria-label="Edit website name"
                                        title="Edit name"
                                    >
                                        <Edit2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}
                        </div>
                        {/* top row: deploy / customize */}
                        {!shareOpen && (
                            <div className="flex w-full flex-col items-stretch gap-2 font-semibold min-[360px]:flex-row min-[360px]:flex-nowrap">
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
                                    className={`group inline-flex min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full px-3 py-1.5 text-[11px] min-[420px]:px-4 min-[420px]:text-xs ${isArchivedFlag
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
                                            <span className="min-w-0">Deploying…</span>
                                            <Rocket className="h-4 w-4 shrink-0 animate-pulse" />
                                        </>
                                    ) : isDeployedFlag ? (
                                        <>
                                            <span className="min-w-0">Deployed</span>
                                            <ExternalLink className="h-4 w-4 shrink-0" />
                                        </>
                                    ) : (
                                        <>
                                            <span className="min-w-0">Deploy</span>
                                            <Rocket className="h-4 w-4 shrink-0 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
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
                                        className="group inline-flex min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full border border-neutral-500 px-3 py-1.5 text-[11px] text-neutral-800 shadow-sm disabled:opacity-60 min-[420px]:text-xs"
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
                                        <span className="min-w-0">
                                            {isBuilding || isQueued
                                                ? "Building…"
                                                : isFailed
                                                    ? "Retry"
                                                    : "Edit"}
                                        </span>

                                        {isFailed ? (
                                            <WrenchIcon className="h-4 w-4 shrink-0 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                                        ) : (
                                            (isBuilding || isQueued) ?
                                                <Hammer className="ghost-hammer-swing h-4 w-4 shrink-0 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                                                :
                                                <BrushIcon className="h-4 w-4 shrink-0 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
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
                                <div className="mb-1 flex flex-col gap-1 text-[10px] font-semibold leading-4 text-neutral-600 min-[360px]:flex-row min-[360px]:items-start min-[360px]:justify-between">
                                    <span className="min-w-0 break-words" aria-live="polite">
                                        {progressDetail ?? normalizedProgressLabel}
                                    </span>
                                    {normalizedProgressPercent !== null && (
                                        <span className="self-end font-semibold tabular-nums min-[360px]:self-auto">
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
                            <div className="mt-4 flex w-full flex-wrap items-center justify-center gap-1.5">
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
                                            className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-neutral-300 bg-white/60 px-2.5 py-1 text-[11px] text-neutral-600 hover:border-neutral-400 disabled:opacity-50"
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
                                            className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${isArchivedFlag
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
                                    ? isStuckQueued
                                        ? "Still building. You can cancel this stuck preview now."
                                        : "Building site. This may take up to five minutes"
                                    : "Locked…"
                        }
                    />
                )}

                {isStuckQueued && !isDeleting && !isDeploying && (
                    <div className="absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
                        <button
                            type="button"
                            onClick={() => discardRender(r.id)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-700 shadow-sm hover:border-red-300 hover:bg-red-50"
                            title="Cancel the stuck preview and clear the processing card"
                        >
                            Cancel stuck preview
                        </button>
                    </div>
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
    onRename,
    onDeploy,
    onDelete,
}: {
    app: { id: string; name: string; createdAt: any; updatedAt: any; isDeployed?: boolean; productionUrl?: string | null; lastDeployUrl?: string | null };
    isDeleting: boolean;
    isArchiving: boolean;
    onCustomize: (appId: string) => void;
    onArchive: (appId: string) => void;
    onRename: (appId: string, name: string) => Promise<void>;
    onDeploy: (app: { id: string; name: string }) => void;
    onDelete: (appId: string) => void;
}) {
    const router = useRouter();
    const showVersionBadge = process.env.NODE_ENV !== "production";

    const isDeployedFlag = Boolean((app as any)?.isDeployed) || Boolean((app as any)?.productionUrl) || Boolean((app as any)?.lastDeployUrl);
    const appDisplayName = String(app.name || app.id.slice(0, 10)).trim();
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState(appDisplayName);

    useEffect(() => {
        if (!isEditingName) {
            setNameDraft(appDisplayName);
        }
    }, [appDisplayName, isEditingName]);

    const submitAppRename = useCallback(async () => {
        const trimmed = nameDraft.trim();
        if (!trimmed) {
            setNameDraft(appDisplayName);
            setIsEditingName(false);
            return;
        }
        if (trimmed === appDisplayName) {
            setIsEditingName(false);
            return;
        }
        await onRename(app.id, trimmed);
        setIsEditingName(false);
    }, [app.id, appDisplayName, nameDraft, onRename]);

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

            {/* App badge - dev only for testing */}
            {showVersionBadge ? (
                <span
                    className="absolute left-2 top-2 z-40 inline-flex items-center rounded-full border border-neutral-200 bg-[#f55f2a]/10 px-2 py-0.5 text-[10px] font-semibold text-[#f55f2a] shadow-sm"
                    title="v2"
                >
                    v2
                </span>
            ) : null}

            {/* Main visual area */}
            <div className="relative aspect-[3/3] w-full overflow-hidden flex flex-col items-center justify-center bg-gradient-to-br from-neutral-50 to-neutral-100">
                {/* Action buttons overlay */}
                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                    <div className="pointer-events-auto flex w-[calc(100%-1rem)] max-w-xs flex-col items-stretch rounded-xl border border-neutral-200 bg-white/80 p-3 text-[11px] shadow-lg backdrop-blur-sm min-[420px]:w-auto min-[420px]:text-xs">
                        <div className="mb-3 rounded-lg border border-neutral-300 bg-white/90 px-2.5 py-1.5 shadow-sm">
                            {isEditingName ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        value={nameDraft}
                                        onChange={(e) => setNameDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                void submitAppRename();
                                            }
                                            if (e.key === "Escape") {
                                                e.preventDefault();
                                                setNameDraft(appDisplayName);
                                                setIsEditingName(false);
                                            }
                                        }}
                                        className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-400"
                                        aria-label="Rename app"
                                        maxLength={80}
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void submitAppRename()}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                                        aria-label="Save app name"
                                        title="Save"
                                    >
                                        <CheckCheck className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setNameDraft(appDisplayName);
                                            setIsEditingName(false);
                                        }}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                                        aria-label="Cancel rename"
                                        title="Cancel"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <div
                                        className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-neutral-900"
                                        title={appDisplayName || "App"}
                                    >
                                        {appDisplayName || "App"}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsEditingName(true)}
                                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                                        aria-label="Edit app name"
                                        title="Edit name"
                                    >
                                        <Edit2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="flex w-full flex-row flex-nowrap items-stretch font-semibold gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (isDeployedFlag) {
                                        router.push("/dashboard/deployments");
                                        return;
                                    }
                                    onDeploy({ id: app.id, name: app.name });
                                }}
                                disabled={isDeleting || isArchiving}
                                className={`group inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full px-4 py-2 text-xs ${isDeployedFlag
                                    ? "bg-emerald-500 text-white shadow-sm hover:bg-green-700"
                                    : "bg-accent text-white shadow-sm hover:bg-accent/90 disabled:opacity-60"
                                    }`}
                                title={isDeployedFlag ? "View and manage deployments" : "Deploy this app to Vercel"}
                            >
                                {isDeployedFlag ? (
                                    <>
                                        <span className="shrink-0">Deployed</span>
                                        <ExternalLink className="h-4 w-4 shrink-0" />
                                    </>
                                ) : (
                                    <>
                                        <span className="shrink-0">Deploy</span>
                                        <Rocket className="h-4 w-4 shrink-0 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={() => onCustomize(app.id)}
                                disabled={isDeleting}
                                className="group inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-neutral-500 px-3 py-2 text-xs font-semibold text-neutral-800 shadow-sm disabled:opacity-60"
                                title="Open app in editor"
                            >
                                <span className="shrink-0">Edit</span>
                                <BrushIcon className="h-4 w-4 shrink-0 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                            </button>
                        </div>

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
    onCancelLocked,
    sourceUrl,
    lockedSinceMs,
    sourceUrlCannotGenerate = false,
    highlight,
    autoOpenNonce,
    autoOpenSuccessMessage,
    onAutoOpenMessageDismiss,
    isAdmin: _isAdmin,
    onStartFromTemplate,
    onStartFromCommunityBuild,
    user: _user,
}: {
    locked: boolean;
    onClick: () => void;
    onAppClick?: () => void;
    onCancelLocked?: () => void;
    sourceUrl?: string | null;
    lockedSinceMs?: number | null;
    sourceUrlCannotGenerate?: boolean;
    highlight?: boolean;
    autoOpenNonce?: number;
    autoOpenSuccessMessage?: string;
    onAutoOpenMessageDismiss?: () => void;
    isAdmin: boolean;
    onStartFromTemplate?: () => void;
    onStartFromCommunityBuild?: () => void;
    user: FirebaseUser | null;
    compact?: boolean;
}) {
    const router = useRouter();
    const [localDisabled, setLocalDisabled] = useState(false);
    const [showGenerationModal, setShowGenerationModal] = useState(false);
    const [selectedGenerationType, setSelectedGenerationType] = useState<"nextjs" | "html" | null>(null);
    const [canOverrideLocked, setCanOverrideLocked] = useState(false);
    const lastAutoOpenNonceRef = useRef(0);

    const sourceUrlDisplay = useMemo(() => {
        const raw = (sourceUrl || "").trim();
        if (!raw) return "";
        try {
            const u = new URL(raw);
            return `${u.host}${u.pathname}${u.search || ""}`;
        } catch {
            return raw.replace(/^https?:\/\//i, "");
        }
    }, [sourceUrl]);

    const canGenerateHtmlFromUrl = useMemo(() => {
        const raw = (sourceUrl || "").trim();
        return /^https?:\/\//i.test(raw);
    }, [sourceUrl]);

    const closeGenerationModal = useCallback(() => {
        setShowGenerationModal(false);
        onAutoOpenMessageDismiss?.();
    }, [onAutoOpenMessageDismiss]);

    const canUseSimpleHtml = canGenerateHtmlFromUrl && !sourceUrlCannotGenerate;

    useEffect(() => {
        if (!autoOpenNonce) return;
        if (autoOpenNonce === lastAutoOpenNonceRef.current) return;
        lastAutoOpenNonceRef.current = autoOpenNonce;
        setSelectedGenerationType(null);
        setShowGenerationModal(true);
    }, [autoOpenNonce]);

    // Consider the card disabled if either the parent says so or we've just been clicked.
    const effectiveLocked = locked || localDisabled;

    useEffect(() => {
        if (!effectiveLocked || !lockedSinceMs) {
            setCanOverrideLocked(false);
            return;
        }

        const elapsedMs = Date.now() - lockedSinceMs;
        const remainingMs = Math.max(0, RENDER_STALL_TIMEOUT_MS - elapsedMs);
        if (remainingMs === 0) {
            setCanOverrideLocked(true);
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setCanOverrideLocked(true);
        }, remainingMs);

        return () => window.clearTimeout(timeoutId);
    }, [effectiveLocked, lockedSinceMs]);

    const handleClick = () => {
        if (localDisabled) return;

        // Even when locked (e.g. snapshots processing), allow opening the modal
        // but disable the options inside so users understand what's happening.
        setSelectedGenerationType(null);
        setShowGenerationModal(true);
    };

    const handleContinueGeneration = () => {
        if (effectiveLocked) return;
        if (selectedGenerationType === "nextjs") {
            handleAppGeneration();
            return;
        }
        if (selectedGenerationType === "html") {
            if (!canUseSimpleHtml) return;
            handleWebsiteGeneration();
        }
    };

    const handleWebsiteGeneration = () => {
        if (effectiveLocked || !canUseSimpleHtml) return;
        closeGenerationModal();

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
        if (effectiveLocked) return;
        closeGenerationModal();

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

    const title = effectiveLocked ? "Processing…" : "Generate";
    const subtitle = effectiveLocked
        ? canOverrideLocked
            ? "This job has been processing for a while. You can cancel it now."
            : "You have a pending job."
        : sourceUrlDisplay
            ? "Create an editable website."
            : "Create an editable website.";

    const iconWrapperSize = "h-14 w-14";

    return (
        <>
            <div
                className={`relative w-full overflow-hidden rounded-xl border bg-white transition-shadow ${highlight
                    ? "border-[rgba(245,95,42,0.45)] ring-1 ring-[rgba(245,95,42,0.30)] shadow-sm"
                    : "border-neutral-200 shadow-sm hover:shadow-md"
                    }`}
            >
                {highlight ? (
                    <div
                        className="pointer-events-none absolute right-3 top-3 z-10 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        style={{
                            borderColor: "rgba(245,95,42,0.35)",
                            backgroundColor: "rgba(245,95,42,0.10)",
                            color: ACCENT,
                        }}
                    >
                        Next step
                    </div>
                ) : null}
                <button
                    type="button"
                    onClick={handleClick}
                    disabled={localDisabled}
                    aria-disabled={effectiveLocked}
                    className={`group flex aspect-square w-full flex-col items-center justify-center rounded-lg border-2 border-dashed bg-white px-5 py-6 text-center transition ${effectiveLocked ? "opacity-70 cursor-wait" : "cursor-pointer"} ${highlight ? "border-[rgba(245,95,42,0.45)] bg-[rgba(245,95,42,0.08)] hover:border-[rgba(245,95,42,0.70)]" : "border-neutral-300 hover:border-neutral-400"}`}
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
                {effectiveLocked && canOverrideLocked && onCancelLocked ? (
                    <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
                        <button
                            type="button"
                            onClick={onCancelLocked}
                            className="inline-flex items-center justify-center rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 shadow-sm hover:border-red-300 hover:bg-red-50"
                        >
                            Cancel stuck job
                        </button>
                    </div>
                ) : null}
            </div>

            {/* Generation Type Selection Modal */}
            <AnimatePresence>
                {showGenerationModal && (
                    <motion.div
                        key="generation-modal"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
                        style={{
                            paddingTop: "calc(1rem + env(safe-area-inset-top))",
                            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
                        }}
                        onMouseDown={(e) => {
                            if (e.target === e.currentTarget) closeGenerationModal();
                        }}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl"
                            style={{
                                maxHeight:
                                    "calc(100dvh - 2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
                            }}
                        >
                            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
                                <div className="space-y-2">
                                    {autoOpenSuccessMessage ? (
                                        <>
                                            <div className="inline-flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                                                <span className="text-sm font-semibold leading-5 text-emerald-800">
                                                    {autoOpenSuccessMessage}
                                                </span>
                                            </div>
                                            <div className="pl-1 text-xs text-neutral-600">
                                                Choose what you want to generate next.
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="text-sm font-semibold text-neutral-900">
                                                Choose Generation Type
                                            </div>
                                            <div className="text-xs text-neutral-600">
                                                Select what you&apos;d like to create.
                                            </div>
                                        </>
                                    )}

                                    {sourceUrlCannotGenerate ? (
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                            URL scan failed. Retry scan before continuing.
                                        </div>
                                    ) : null}
                                </div>
                                <button
                                    type="button"
                                    onClick={closeGenerationModal}
                                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white hover:bg-neutral-100"
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

                            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
                                {effectiveLocked ? (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                        Snapshots are still processing. Generation options are temporarily disabled.
                                    </div>
                                ) : null}

                                {/* 1) Website (Next.js) */}
                                <div className="space-y-3">
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedGenerationType("nextjs")}
                                            disabled={effectiveLocked || sourceUrlCannotGenerate}
                                            className={`relative w-full overflow-hidden rounded-xl border p-4 text-left shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed ${selectedGenerationType === "nextjs"
                                                ? "border-[rgba(245,95,42,0.65)] bg-[linear-gradient(180deg,rgba(245,95,42,0.06),rgba(255,255,255,0))]"
                                                : "border-neutral-200 bg-white hover:bg-neutral-50 hover:border-neutral-300"
                                                }`}
                                        >
                                            {/* <span className="pointer-events-none absolute -right-2 -top-2 z-10 inline-flex items-center rounded-full border border-[rgba(245,95,42,0.45)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[rgba(245,95,42,1)] shadow-sm">
                                                Recommended
                                            </span> */}
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

                                                <div className="min-w-0 flex-1 space-y-1">
                                                    <div className="flex min-w-0 flex-wrap items-start gap-2 sm:items-center">
                                                        <div className="min-w-0 text-sm font-semibold text-neutral-900 break-words">
                                                            Website (NextJS)
                                                        </div>
                                                        <span className="inline-flex max-w-full items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-800 whitespace-nowrap">
                                                            15 preview credits
                                                        </span>
                                                    </div>

                                                    <div className="text-xs text-neutral-600">
                                                        Recommended for complex multi‑page websites.
                                                    </div>
                                                    {/* <div className="mt-1 text-[11px] leading-4 text-neutral-500">
                                                        From: <span className="font-mono underline text-accent font-semibold">{sourceUrlDisplay || "(no URL selected)"}</span>
                                                    </div> */}
                                                    <div className="mt-1 text-[11px] leading-4 text-neutral-500">
                                                        Best for: user accounts, AI features, dashboards, web games, stores, or product-heavy content.
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-2">
                                                <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px]">
                                                    <span
                                                        className="min-w-0 max-w-full flex-1 break-all font-mono font-semibold underline decoration-2 sm:truncate sm:whitespace-nowrap"
                                                        style={{ color: ACCENT }}
                                                        title={sourceUrlDisplay || "(none selected)"}
                                                    >
                                                        {sourceUrlDisplay ? truncateMiddle(sourceUrlDisplay, 56) : "(none selected)"}
                                                    </span>
                                                </div>
                                            </div>
                                        </button>
                                    </div>
                                </div>

                                {/* 2) Simple HTML website */}
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedGenerationType("html")}
                                        disabled={effectiveLocked || !canUseSimpleHtml}
                                        className={`relative w-full rounded-xl border p-4 text-left transition disabled:opacity-60 disabled:cursor-not-allowed ${selectedGenerationType === "html"
                                            ? "border-[rgba(245,95,42,0.65)] bg-[linear-gradient(180deg,rgba(245,95,42,0.06),rgba(255,255,255,0))]"
                                            : "border-neutral-200 bg-white hover:bg-neutral-50 hover:border-neutral-300"
                                            }`}
                                    >
                                        <div className="flex items-start gap-3 overflow-hidden">
                                            <div
                                                className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100"
                                                aria-hidden
                                            >
                                                <Image
                                                    src="/images/html.png"
                                                    alt=""
                                                    width={24}
                                                    height={24}
                                                    className="object-contain opacity-95"
                                                    priority={false}
                                                />
                                            </div>

                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex min-w-0 flex-wrap items-start gap-2 sm:items-center">
                                                    <div className="min-w-0 text-sm font-semibold text-neutral-900 break-words">
                                                        Landing Page (HTML)
                                                    </div>
                                                    <span className="inline-flex max-w-full items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-800 whitespace-nowrap">
                                                        15 preview credits
                                                    </span>
                                                </div>

                                                <div className="text-xs text-neutral-600">
                                                    Faster HTML-first flow that opens in the legacy preview editor.
                                                </div>
                                                <div className="mt-1 text-[11px] leading-4 text-neutral-500">
                                                    Best for: simple landing sites, fast iterations, and projects with no auth or database requirements.
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-2">
                                            <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px]">
                                                <span
                                                    className="min-w-0 max-w-full flex-1 break-all font-mono font-semibold underline decoration-2 sm:truncate sm:whitespace-nowrap"
                                                    style={{ color: ACCENT }}
                                                    title={sourceUrlDisplay || "(none selected)"}
                                                >
                                                    {sourceUrlDisplay ? truncateMiddle(sourceUrlDisplay, 56) : "(none selected)"}
                                                </span>
                                            </div>
                                        </div>
                                    </button>
                                </div>

                                {/* 3) Mobile apps (coming soon) */}
                                {/* <div className="relative">
                                    <button
                                        type="button"
                                        disabled
                                        aria-disabled="true"
                                        className="relative w-full rounded-xl border border-neutral-200 bg-white p-4 text-left opacity-75 cursor-not-allowed"
                                    >
                                        <span className="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 shadow-sm sm:-right-2 sm:-top-2">
                                            Coming Soon
                                        </span>
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10" aria-hidden>
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="1.8"
                                                    className="h-5 w-5 text-sky-700"
                                                >
                                                    <rect x="7" y="2" width="10" height="20" rx="2" />
                                                    <path d="M11 18h2" />
                                                </svg>
                                            </div>
                                            <div className="flex-1 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-sm font-semibold text-neutral-900">
                                                        Mobile App
                                                    </div>
                                                </div>
                                                <div className="text-xs text-neutral-600">
                                                    Generate native-style app experiences for iOS and Android.
                                                </div>
                                                <div className="mt-1 text-[11px] leading-4 text-neutral-500">
                                                    Best for: product MVPs, mobile-first workflows, push-ready experiences, and app-store-ready UX.
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                </div> */}
                            </div>

                            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200 px-5 py-4">
                                <button
                                    type="button"
                                    onClick={closeGenerationModal}
                                    className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleContinueGeneration}
                                    disabled={effectiveLocked || !selectedGenerationType || (selectedGenerationType === "html" && !canUseSimpleHtml)}
                                    className="rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                                    style={{ backgroundColor: ACCENT }}
                                >
                                    Continue
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

    const deepLinkRenderId = useMemo(() => {
        const raw = search.get("render") || "";
        const s = String(raw).trim();
        return s || "";
    }, [search]);

    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [userTier, setUserTier] = useState<UserTier>("unknown");
    const [stripeStatus, setStripeStatus] = useState<string | null>(null);


    const [showCreditsPaywall, setShowCreditsPaywall] = useState<
        null | "screenshot" | "preview" | "deploy"
    >(null);
    const [showProPaywall, setShowProPaywall] = useState(false);
    const [showFirstGenerationTrialPopup, setShowFirstGenerationTrialPopup] = useState(false);
    const [firstGenerationTrialPromptShown, setFirstGenerationTrialPromptShown] = useState(false);
    const [renderTrialSessionEligible, setRenderTrialSessionEligible] = useState(false);
    const [appBuilderTrialSessionEligible, setAppBuilderTrialSessionEligible] = useState(false);
    const [exitOfferClaimed, setExitOfferClaimed] = useState(false);
    const [showWebsitePrePaywall, setShowWebsitePrePaywall] = useState(false);

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
    const [success, setSuccess] = useState<string>("");
    const [captureIssueNotice, setCaptureIssueNotice] = useState<string>("");
    const [hideCaptureQueueStatus, setHideCaptureQueueStatus] = useState<boolean>(false);
    const [dismissedUrlIssueCanonical, setDismissedUrlIssueCanonical] = useState<string>("");

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
    const [appBuilderCookiePromptOpen, setAppBuilderCookiePromptOpen] = useState(false);
    const [pendingAppBuilderAppId, setPendingAppBuilderAppId] = useState<string | null>(null);
    const appBuilderCookiePromptResolverRef = useRef<((accepted: boolean) => void) | null>(null);
    const previousEditorOpenRef = useRef(false);
    const previousAppBuilderOpenRef = useRef(false);

    const [agentWelcomeContextByAppId, setAgentWelcomeContextByAppId] = useState<
        Record<
            string,
            {
                source?: "prompt" | "url" | "quickstart" | "template" | "sample" | "unknown";
                prompt?: string | null;
                url?: string | null;
                templateName?: string | null;
            }
        >
    >({});

    const resolveAppBuilderCookiePrompt = useCallback((accepted: boolean) => {
        const resolve = appBuilderCookiePromptResolverRef.current;
        appBuilderCookiePromptResolverRef.current = null;

        setAppBuilderCookiePromptOpen(false);
        setPendingAppBuilderAppId(null);
        if (!accepted) {
            setCurrentAppId(null);
        }

        if (resolve) resolve(accepted);
    }, []);

    const requestAppBuilderCookieConsent = useCallback(async (): Promise<boolean> => {
        const forceCookiePromptInDev = process.env.NODE_ENV !== "production";
        if (!forceCookiePromptInDev && hasAcceptedAppBuilderNecessaryCookies()) {
            return true;
        }

        setPendingAppBuilderAppId(null);
        setCurrentAppId(null);
        setAppBuilderCookiePromptOpen(true);

        return await new Promise<boolean>((resolve) => {
            appBuilderCookiePromptResolverRef.current = resolve;
        });
    }, []);

    const openAppBuilderWithCookieGate = useCallback((appId: string | null) => {
        const nextId = typeof appId === "string" ? appId.trim() : "";
        if (!nextId) return;
        const forceCookiePromptInDev = process.env.NODE_ENV !== "production";

        setCurrentAppId(nextId);
        if (!forceCookiePromptInDev && hasAcceptedAppBuilderNecessaryCookies()) {
            setAppBuilderCookiePromptOpen(false);
            setPendingAppBuilderAppId(null);
            setAppBuilderOpen(true);
            return;
        }

        setPendingAppBuilderAppId(nextId);
        setAppBuilderCookiePromptOpen(true);
    }, []);

    const openAppBuilderDirectly = useCallback((appId: string | null) => {
        const nextId = typeof appId === "string" ? appId.trim() : "";
        if (!nextId) return;

        setCurrentAppId(nextId);
        setPendingAppBuilderAppId(null);
        setAppBuilderCookiePromptOpen(false);
        setAppBuilderOpen(true);
    }, []);

    const acceptCookiesAndOpenAppBuilder = useCallback(() => {
        persistAppBuilderNecessaryCookiesConsent();
        const nextId = pendingAppBuilderAppId || currentAppId;
        resolveAppBuilderCookiePrompt(true);
        if (nextId) {
            setCurrentAppId(nextId);
            setAppBuilderOpen(true);
        }
    }, [pendingAppBuilderAppId, currentAppId, resolveAppBuilderCookiePrompt]);

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
                const nextStripeStatus =
                    typeof data?.stripeStatus === "string" && data.stripeStatus.trim()
                        ? data.stripeStatus.trim().toLowerCase()
                        : null;
                setStripeStatus(nextStripeStatus);
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

    const canProceedWithAppWizardGeneration = useCallback(async (): Promise<boolean> => {
        const tierNow = await refreshUserTierNow();
        if (tierNow === "pro" || tierNow === "agency") {
            return true;
        }

        setAppWizardBusy(false);
        setAppWizardError(null);
        setShowProPaywall(true);
        return false;
    }, [refreshUserTierNow]);

    // ───────── web app wizard (new) ─────────
    const [appWizardOpen, setAppWizardOpen] = useState(false);
    const [appWizardBusy, setAppWizardBusy] = useState(false);
    const [appWizardError, setAppWizardError] = useState<string | null>(null);
    const [appWizardUrl, setAppWizardUrl] = useState<string>("");
    const [appWizardShotsUrl, setAppWizardShotsUrl] = useState<string>("");
    const [appWizardSource, setAppWizardSource] = useState<"website" | "prompt" | null>(null);
    const [appWizardPrompt, setAppWizardPrompt] = useState<string>("");
    const [appWizardPromptFocused, setAppWizardPromptFocused] = useState(false);
    const [appWizardSeedRenderId, setAppWizardSeedRenderId] = useState<string | null>(null);
    const appWizardPromptPlaceholderIdx = useRotatingPlaceholderIndex({
        enabled: appWizardOpen && appWizardSource === "prompt" && !appWizardPrompt.trim(),
        length: PROMPT_PLACEHOLDERS.length,
        intervalMs: 3200,
    });
    const appWizardPromptLength = appWizardPrompt.length;
    const appWizardPromptOverLimit = appWizardPromptLength > APP_WIZARD_PROMPT_MAX_CHARS;

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
    const [hasAnyRenderDoc, setHasAnyRenderDoc] = useState(false);
    const [hasAnyAppDoc, setHasAnyAppDoc] = useState(false);
    const [autoOpenGenerateModalNonce, setAutoOpenGenerateModalNonce] = useState(0);
    const [autoOpenGenerateSuccessMessage, setAutoOpenGenerateSuccessMessage] = useState("");
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
    const sessionExpiredRedirectingRef = useRef(false);

    const handleSessionExpired = useCallback(async (source?: string) => {
        if (sessionExpiredRedirectingRef.current) return;
        sessionExpiredRedirectingRef.current = true;

        try {
            console.warn("[auth] session expired in dashboard", source || "unknown");
            push("Your session expired. Please sign in again.", "err");
            resetAuthClientCaches();
            await firebaseSignOut(auth).catch(() => null);
        } finally {
            const nextPath =
                typeof window !== "undefined"
                    ? `${window.location.pathname}${window.location.search}`
                    : "/dashboard/view";
            router.replace(`/login?reason=session_expired&next=${encodeURIComponent(nextPath)}`);
        }
    }, [push, router]);

    // Fetch apps from Firestore
    useEffect(() => {
        if (!user) {
            setApps([]);
            setHasAnyAppDoc(false);
            return;
        }

        const appsRef = collection(db, "kloner_users", user.uid, "kloner_apps");
        const appsQuery = query(appsRef, orderBy("createdAt", "desc"), limit(100));

        const unsub = onSnapshot(
            appsQuery,
            (snap) => {
                const appList = snap.docs.map((doc) => ({
                    id: doc.id,
                    ...(doc.data() as any),
                }));
                setHasAnyAppDoc(appList.length > 0);
                // Keep archived apps off the main dashboard without requiring a Firestore index
                // (and so legacy docs missing the `archived` field still show up).
                // IMPORTANT: only treat boolean true as archived.
                setApps(appList.filter((a: any) => a?.archived !== true));
            },
            (err) => {
                console.warn("[firestore] apps snapshot failed", err);
                const code = String((err as any)?.code || "").toLowerCase();
                if (code.includes("permission-denied")) {
                    void handleSessionExpired("apps_snapshot_permission_denied");
                }
                setHasAnyAppDoc(false);
                setApps([]);
            },
        );

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
    }, [user, push]);

    useEffect(() => {
        if (!user) {
            setHasAnyRenderDoc(false);
            return;
        }

        const rendersRef = collection(db, "kloner_users", user.uid, "kloner_renders");
        const rendersAnyQuery = query(rendersRef, limit(1));

        const unsub = onSnapshot(
            rendersAnyQuery,
            (snap) => {
                setHasAnyRenderDoc(!snap.empty);
            },
            (err) => {
                console.warn("[firestore] hasAnyRenderDoc snapshot failed", err);
                const code = String((err as any)?.code || "").toLowerCase();
                if (code.includes("permission-denied")) {
                    void handleSessionExpired("render_probe_permission_denied");
                }
                setHasAnyRenderDoc(false);
            },
        );

        let didCleanup = false;
        return () => {
            if (didCleanup) return;
            didCleanup = true;
            try {
                unsub();
            } catch (err) {
                console.warn("[firestore] hasAnyRenderDoc unsubscribe failed", err);
            }
        };
    }, [user, handleSessionExpired]);

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
        const promptParam = stripHttpsUrlsFromPrompt(search.get("prompt") || "");

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
        setShowAppExitOffer(false);
        setAppExitOfferReason(null);
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
            const csrf = await ensureSessionAndCsrf().catch(() => null);

            const ensureScope = async () => {
                await fetch(`/api/app-builder/${appDeployWizardAppId}/scope`, {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store",
                }).catch(() => null);
            };

            const doDeploy = async () => {
                const res = await fetch(`/api/app-builder/${appDeployWizardAppId}/deploy`, {
                    method: "POST",
                    headers: {
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                });
                const data = await res.json().catch(() => ({} as any));
                return { res, data };
            };

            // App deploy requires an httpOnly app-scope cookie. Obtain it here so users can deploy
            // directly from the dashboard without opening the App Builder (machine/webcontainer).
            await ensureScope();

            let { res, data } = await doDeploy();

            const code = String((data as any)?.code || "").trim();
            const isScopeProblem = code === "MISSING_APP_SCOPE" || code === "INVALID_APP_SCOPE";
            if ((!res.ok || !data?.ok) && isScopeProblem) {
                await ensureScope();
                ({ res, data } = await doDeploy());
            }

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

    function getUserFacingErrorMessage(error: unknown, fallback: string): string {
        const rawMessage =
            typeof error === "string"
                ? error
                : error instanceof Error
                    ? error.message
                    : error && typeof error === "object"
                        ? typeof (error as any).error === "string"
                            ? (error as any).error
                            : typeof (error as any).message === "string"
                                ? (error as any).message
                                : ""
                        : "";

        const firstLine = rawMessage.split(/\r?\n/, 1)[0].replace(/^Error:\s*/i, "").trim();
        return firstLine || fallback;
    }

    function isPreviewCreditsLimitErrorMessage(message: string): boolean {
        const normalized = (message || "").toLowerCase();
        return (
            normalized.includes("monthly preview limit reached") ||
            normalized.includes("preview credits") && normalized.includes("limit") ||
            normalized.includes("used all available preview credits")
        );
    }

    const handleCreateApp = useCallback(async (
        mode: "clone" | "url" | "prompt",
        prompt?: string,
        renderId?: string,
        url?: string,
        opts?: { screenshotKeys?: string[]; onError?: (message: string) => void; skipCookieConsent?: boolean },
    ) => {
        if (!user) return;

        if (!(await canProceedWithAppWizardGeneration())) {
            return null;
        }

        if (!opts?.skipCookieConsent) {
            const consentAccepted = await requestAppBuilderCookieConsent();
            if (!consentAccepted) {
                return null;
            }
        }

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
                appName = "Untitled Website";
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
                const sanitizedPrompt = stripHttpsUrlsFromPrompt(prompt).trim();
                if (!sanitizedPrompt) {
                    throw new Error("Prompt cannot be empty after removing URLs");
                }
                // Use the new prompt generation endpoint
                const csrf = await ensureSessionAndCsrf().catch(() => null);
                const res = await fetch("/api/generate-app-from-prompt", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    body: JSON.stringify({ prompt: sanitizedPrompt, name: appName }),
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
                    const data = await res.json().catch(() => ({} as any));
                    throw new Error(data?.error || data?.message || `Failed to create app (HTTP ${res.status})`);
                }

                const data = await res.json();
                const createdAppId = typeof data?.appId === "string" ? data.appId.trim() : "";
                if (!createdAppId) {
                    throw new Error("Failed to create app: no appId returned");
                }
                appId = createdAppId;
            }

            // Close the editor modal
            setEditorOpen(false);
            setActiveRenderId(undefined);
            setActiveSeoMetaByPage(null);
            setActiveArchivedPageIds([]);

            // Tailor the AI agent's first message for this new app (unobtrusive; only affects the default welcome).
            setAgentWelcomeContextByAppId((prev) => {
                const next = { ...prev };
                if (mode === "prompt") {
                    next[appId] = { source: "prompt", prompt: stripHttpsUrlsFromPrompt(prompt || "").trim() || null };
                } else if (mode === "url") {
                    next[appId] = { source: "url", url: (url || "").trim() || null };
                } else {
                    // leave as-is
                }
                return next;
            });

            // URL creations should finish without auto-opening the builder overlay.
            if (mode !== "url") {
                openAppBuilderWithCookieGate(appId);
            }

            // No agent application for new modes, as they are full generations

            return appId as string;
        } catch (error) {
            const message = getUserFacingErrorMessage(error, "Failed to create app. Please try again.");
            console.error("Failed to create app:", error);
            if (isGenerationTierBlockedMessage(message)) {
                showWebsiteExitOfferPaywall();
                if (appWizardOpen) {
                    setAppWizardOpen(false);
                    setAppWizardError(null);
                    setAppWizardBusy(false);
                }
                return null;
            }
            if (isPreviewCreditsLimitErrorMessage(message)) {
                setShowCreditsPaywall("preview");
                if (appWizardOpen) {
                    setAppWizardOpen(false);
                    setAppWizardError(null);
                    setAppWizardBusy(false);
                }
                return null;
            }
            opts?.onError?.(message);
            push(message, "err");
            return null;
        }
    }, [user, router, push, activeRenderId, openAppBuilderWithCookieGate, requestAppBuilderCookieConsent, appWizardOpen]);

    const startWebAppWizard = useCallback(
        (opts?: { seedRenderId?: string | null; url?: string | null }) => {
            // Always refresh Vercel status when opening the wizard so we don't
            // accidentally auto-advance from stale "connected" state.
            void refreshVercelStatus();
            const url = typeof opts?.url === "string" ? opts.url : "";
            setAppWizardUrl(url);
            setAppWizardShotsUrl(url);
            setAppWizardSeedRenderId(opts?.seedRenderId ?? null);
            // Require explicit source selection in the wizard.
            setAppWizardSource(null);
            setAppWizardPrompt("");
            setAppWizardError(null);
            setAppWizardBusy(false);
            setAppWizardOpen(true);
        },
        [refreshVercelStatus],
    );

    const submitAppWizardWebsite = useCallback(async () => {
        if (appWizardBusy) return;

        if (!(await canProceedWithAppWizardGeneration())) {
            return;
        }

        setAppWizardBusy(true);
        setAppWizardError(null);

        try {
            const url = (appWizardUrl || "").trim();
            if (!url) {
                setAppWizardError("Select a successfully scanned URL to continue.");
                return;
            }

            const successfulUrlSet = new Set(
                urls
                    .map((entry) => {
                        const normalized = validateAndNormalizePublicHttpUrl(String(entry?.url || ""));
                        if (!normalized) return "";
                        const screenshotPathCount = Array.isArray(entry?.screenshotPaths) ? entry.screenshotPaths.length : 0;
                        const screenshotMetaCount = Array.isArray(entry?.screenshots) ? entry.screenshots.length : 0;
                        const statusUi = normalizeUrlStatus(
                            entry?.status,
                            screenshotPathCount + screenshotMetaCount,
                            entry?.updatedAt,
                        );
                        return statusUi === "ready" ? normUrl(normalized) : "";
                    })
                    .filter(Boolean),
            );

            const normalizedSelected = validateAndNormalizePublicHttpUrl(url);
            const canonicalSelected = normalizedSelected ? normUrl(normalizedSelected) : "";
            const normalizedShotsUrl = validateAndNormalizePublicHttpUrl(appWizardShotsUrl || "");
            const canonicalShotsUrl = normalizedShotsUrl ? normUrl(normalizedShotsUrl) : "";
            const hasActiveShotContext = Array.isArray(shots) && shots.length > 0;
            const canTrustCurrentSelectionFromShotContext =
                !!canonicalSelected &&
                !!canonicalShotsUrl &&
                canonicalSelected === canonicalShotsUrl &&
                hasActiveShotContext;

            if (!canonicalSelected || (!successfulUrlSet.has(canonicalSelected) && !canTrustCurrentSelectionFromShotContext)) {
                setAppWizardError("Please choose a URL from the scanned dropdown.");
                return;
            }

            const canAttachShots = !!(appWizardShotsUrl && normUrl(appWizardShotsUrl) === normUrl(url));
            const screenshotKeys = user && canAttachShots
                ? shots
                    .map((s) => s.path)
                    .filter((p) => typeof p === "string" && p.startsWith(`kloner-screenshots/${user.uid}/`))
                    .slice(0, 6)
                : [];

            const created = await handleCreateApp("url", undefined, undefined, url, {
                screenshotKeys,
                onError: setAppWizardError,
            });
            if (created) {
                setAppWizardOpen(false);
            }
        } finally {
            setAppWizardBusy(false);
        }
    }, [appWizardBusy, appWizardUrl, appWizardShotsUrl, user, shots, handleCreateApp, urls, canProceedWithAppWizardGeneration]);

    const submitAppWizardPrompt = useCallback(async () => {
        if (appWizardBusy) return;

        if (!(await canProceedWithAppWizardGeneration())) {
            return;
        }

        const prompt = stripHttpsUrlsFromPrompt(appWizardPrompt || "").trim();
        if (!prompt) {
            setAppWizardError("Enter a prompt to continue.");
            return;
        }
        if (prompt.length > APP_WIZARD_PROMPT_MAX_CHARS) {
            // Inline counter/help text already explains the limit; avoid duplicate top-level error.
            return;
        }

        setAppWizardBusy(true);
        setAppWizardError(null);

        try {
            const created = await handleCreateApp("prompt", prompt, undefined, undefined, {
                onError: setAppWizardError,
            });
            if (created) {
                setAppWizardOpen(false);
            }
        } finally {
            setAppWizardBusy(false);
        }
    }, [appWizardBusy, appWizardPrompt, handleCreateApp, canProceedWithAppWizardGeneration]);
    // New: create an app from the starter template (free)
    const handleCreateTemplateApp = useCallback(async () => {
        if (!user) return;

        if (!(await canProceedWithAppWizardGeneration())) {
            return;
        }

        const consentAccepted = await requestAppBuilderCookieConsent();
        if (!consentAccepted) {
            return;
        }

        try {
            const res = await fetch("/api/app-builder/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Starter Template" }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({} as any));
                throw new Error(data?.error || data?.message || `Failed to create app (HTTP ${res.status})`);
            }

            const data = await res.json();
            const appId = typeof data?.appId === "string" ? data.appId.trim() : "";
            if (!appId) {
                throw new Error("Failed to create app: no appId returned");
            }

            // Close any open editor modal
            setEditorOpen(false);
            setActiveRenderId(undefined);
            setActiveSeoMetaByPage(null);
            setActiveArchivedPageIds([]);

            // Open app builder overlay
            openAppBuilderWithCookieGate(appId);

            setAgentWelcomeContextByAppId((prev) => ({
                ...prev,
                [appId]: { source: "template", templateName: "Starter Template" },
            }));
        } catch (error) {
            const message = getUserFacingErrorMessage(error, "Failed to start from template. Please try again.");
            console.error("Failed to create template app:", error);
            push(message, "err");
        }
    }, [user, push, openAppBuilderWithCookieGate, requestAppBuilderCookieConsent]);


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

    const handleRenameRenderCard = useCallback(
        async (renderId: string, name: string) => {
            if (!user) return;
            const trimmed = name.trim();
            if (!trimmed) return;

            setRenders((prev) =>
                prev.map((item) =>
                    item.id === renderId ? { ...item, nameHint: trimmed } : item,
                ),
            );

            try {
                await updateDoc(
                    doc(db, "kloner_users", user.uid, "kloner_renders", renderId),
                    { nameHint: trimmed },
                );
                push("Website name updated", "ok");
            } catch (err) {
                console.error("Failed to rename render", err);
                push("Failed to rename website. Please try again.", "err");
            }
        },
        [push, user],
    );

    const handleRenameAppCard = useCallback(
        async (appId: string, name: string) => {
            if (!user) return;
            const trimmed = name.trim();
            if (!trimmed) return;

            setApps((prev) =>
                prev.map((item) =>
                    item.id === appId ? { ...item, name: trimmed } : item,
                ),
            );

            try {
                await updateDoc(
                    doc(db, "kloner_users", user.uid, "kloner_apps", appId),
                    { name: trimmed, updatedAt: serverTimestamp() },
                );
                push("App name updated", "ok");
            } catch (err) {
                console.error("Failed to rename app", err);
                push("Failed to rename app. Please try again.", "err");
            }
        },
        [push, user],
    );

    // ---- state ----

    const [deployWizardLiveUrl, setDeployWizardLiveUrl] = useState<string | null>(null);


    type UICredits = {
        screenshotUsed: number;
        previewUsed: number;
        screenshotRemaining: number | null;
        previewRemaining: number | null;
        editUsed: number;
        editRemaining: number | null;
    };

    const [credits, setCredits] = useState<UICredits>({
        screenshotUsed: 0,
        previewUsed: 0,
        screenshotRemaining: null,
        previewRemaining: null,
        editUsed: 0,
        editRemaining: null,
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

    const editLimitDisplay =
        tierLimits.editMonthly && tierLimits.editMonthly > 0 ? tierLimits.editMonthly : null;

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
                editUsed: 0,
                editRemaining: null,
            });
            setExitOfferClaimed(false);
            setFirstGenerationTrialPromptShown(false);
            return;
        }

        const ref = doc(db, "kloner_users", user.uid);
        const unsub = onSnapshot(
            ref,
            (snap) => {
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
                    const editLimit =
                        tierLimits.editMonthly && tierLimits.editMonthly > 0
                            ? tierLimits.editMonthly
                            : 0;

                    setCredits({
                        screenshotUsed: 0,
                        previewUsed: 0,
                        screenshotRemaining: screenshotLimit || null,
                        previewRemaining: previewLimit || null,
                        editUsed: 0,
                        editRemaining: editLimit || null,
                    });
                    setExitOfferClaimed(false);
                    setFirstGenerationTrialPromptShown(false);
                    return;
                }

                const creditsMap = (snap.data() as any) || {};
                const previewBucket =
                    creditsMap?.["credits.preview"] || creditsMap?.credits?.preview || {};
                const snapshotBucket =
                    creditsMap?.["credits.snapshot"] || creditsMap?.credits?.snapshot || {};
                const editBucket =
                    creditsMap?.["credits.aiEdits"] || creditsMap?.credits?.aiEdits || {};

                const offersBucket =
                    creditsMap?.offers && typeof creditsMap.offers === "object"
                        ? creditsMap.offers
                        : {};
                const nextExitOfferClaimed =
                    offersBucket?.exitOffer40Claimed === true ||
                    creditsMap?.["offers.exitOffer40Claimed"] === true;
                const nextTrialPromptShown =
                    offersBucket?.firstGenerationTrialPromptShown === true ||
                    creditsMap?.["offers.firstGenerationTrialPromptShown"] === true;

                setExitOfferClaimed(nextExitOfferClaimed);
                setFirstGenerationTrialPromptShown(nextTrialPromptShown);

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

                const editLimit =
                    typeof editBucket.monthlyLimit === "number" && editBucket.monthlyLimit >= 0
                        ? editBucket.monthlyLimit
                        : tierLimits.editMonthly || 0;

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

                const editRemaining =
                    editLimit === 0
                        ? null
                        : typeof editBucket.remaining === "number"
                            ? editBucket.remaining
                            : editLimit;

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
                    editUsed:
                        editRemaining === null || editLimit === 0
                            ? 0
                            : Math.max(editLimit - editRemaining, 0),
                    editRemaining,
                });
            },
            (err) => {
                console.warn("[firestore] credits snapshot failed", err);
                const code = String((err as any)?.code || "").toLowerCase();
                if (code.includes("permission-denied")) {
                    void handleSessionExpired("credits_snapshot_permission_denied");
                }
                setCredits({
                    screenshotUsed: 0,
                    previewUsed: 0,
                    screenshotRemaining: null,
                    previewRemaining: null,
                    editUsed: 0,
                    editRemaining: null,
                });
                setExitOfferClaimed(false);
                setFirstGenerationTrialPromptShown(false);
            },
        );

        return () => unsub();
    }, [
        user?.uid,
        tierLimits.screenshotMonthly,
        tierLimits.previewMonthly,
        tierLimits.editMonthly,
        db,
        handleSessionExpired,
    ]);

    // Simple accessors for UI
    const screenshotRemaining = credits.screenshotRemaining;
    const previewRemaining = credits.previewRemaining;
    const editRemaining = credits.editRemaining;

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

    async function listAllDeepSafe(root: StorageReference): Promise<StorageReference[]> {
        const out: StorageReference[] = [];

        async function walk(ref: StorageReference) {
            let l: any;
            try {
                l = await listAll(ref);
            } catch {
                return;
            }
            out.push(...(l?.items || []));
            await Promise.all((l?.prefixes || []).map(walk));
        }

        await walk(root);
        return out;
    }

    async function loadShotsForDoc(
        u: FirebaseUser,
        targetUrl: string,
        data: UrlDoc
    ) {
        const prefix =
            data.screenshotsPrefix ||
            `kloner-screenshots/${u.uid}/${data.urlHash || hash64(targetUrl)}`;

        // Prefer explicit paths/keys from Firestore. Avoid Storage folder listing while queued.
        const screenshotPaths = Array.isArray(data.screenshotPaths)
            ? data.screenshotPaths.filter((p): p is string => typeof p === "string" && !!p)
            : [];

        const screenshotKeys = Array.isArray(data.screenshots)
            ? Array.from(
                new Set(
                    data.screenshots
                        .map((s: any) => (typeof s?.key === "string" ? s.key : ""))
                        .filter((k: string) => !!k)
                )
            )
            : [];

        const statusUi = normalizeUrlStatus(
            data.status,
            screenshotPaths.length + screenshotKeys.length,
            data.updatedAt
        );

        let fileRefs: StorageReference[] = [];
        if (screenshotPaths.length > 0) {
            fileRefs = screenshotPaths.map((p) => sRef(storage, p));
        } else if (screenshotKeys.length > 0) {
            fileRefs = screenshotKeys.map((k) => sRef(storage, k));
        } else {
            // Only use legacy prefix listing for explicitly ready docs.
            // For queued/processing/error/stale/unknown, skip listing to avoid noisy
            // Firebase Storage 400s when no screenshot folder exists yet.
            if (statusUi !== "ready") {
                setShots([]);
                return;
            }

            // Legacy fallback (best-effort): older ready docs without paths/keys.
            fileRefs = await listAllDeepSafe(sRef(storage, prefix));
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

        const entries: Shot[] = (
            await Promise.all(
                fileRefs.map(async (r) => {
                    try {
                        const url = await getDownloadURL(r);
                        const name = r.name || r.fullPath.split("/").pop() || "image";

                        const meta = metaByKey.get(r.fullPath);

                        return {
                            path: r.fullPath,
                            url,
                            fileName: name,
                            snapshotId: meta?.snapshotId,
                            snapshotCreatedAt: meta?.snapshotCreatedAt,
                            sourceUrl: meta?.sourceUrl,
                            status: meta?.status,
                            bytes: meta?.bytes,
                        } as Shot;
                    } catch {
                        // If any single URL fails to resolve (rules / race / deleted object), just skip it.
                        return null;
                    }
                })
            )
        ).filter(Boolean) as Shot[];

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
    const startParam = (search.get("start") || "").toLowerCase();
    const startRequested = startParam === "1" || startParam === "true";

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

        let dec = raw;
        try {
            dec = decodeURIComponent(raw);
        } catch {
            dec = raw;
        }

        // Validate strictly: only public http(s) URLs with a real domain.
        const normalized = validateAndNormalizePublicHttpUrl(dec);
        return normalized ? normUrl(normalized) : "";
    }, [urlParam]);

    const startNextJsAppBuilder = useCallback(async (url: string) => {
        const created = await handleCreateApp("url", undefined, undefined, url, {
            skipCookieConsent: true,
        });

        if (created) {
            openAppBuilderDirectly(created);
        }
    }, [handleCreateApp, openAppBuilderDirectly]);

    const DUPLICATE_URL_MESSAGE =
        "This URL has already been processed.";

    const isDuplicateUrlConfirmationMessage = useCallback(
        (message: string): boolean => {
            const m = (message || "").toLowerCase();
            return m === DUPLICATE_URL_MESSAGE.toLowerCase() ||
                (m.includes("already") && m.includes("url") && (m.includes("v1") || m.includes("v2") || m.includes("processed") || m.includes("exists"))) ||
                (m.includes("website") && m.includes("already exists") && m.includes("url")) ||
                m.includes("already has a website");
        },
        [],
    );

    const buildDuplicateUrlMessage = useCallback(
        (candidateUrl: string): string => {
            const normalizedCandidate = validateAndNormalizePublicHttpUrl(candidateUrl);
            if (!normalizedCandidate) return DUPLICATE_URL_MESSAGE;

            const canonicalCandidate = normUrl(normalizedCandidate).toLowerCase();
            const candidateHash = hash64(canonicalCandidate);

            const hasV1FromUrls = urls.some((entry) => {
                const normalizedExisting = validateAndNormalizePublicHttpUrl(String(entry?.url || ""));
                if (!normalizedExisting) return false;
                return normUrl(normalizedExisting).toLowerCase() === canonicalCandidate;
            });

            const hasV1FromRenders = renders.some((render) => {
                if (render?.archived) return false;
                if (typeof render?.urlHash === "string" && render.urlHash === candidateHash) return true;
                const normalizedRenderUrl = validateAndNormalizePublicHttpUrl(String(render?.url || ""));
                if (!normalizedRenderUrl) return false;
                return normUrl(normalizedRenderUrl).toLowerCase() === canonicalCandidate;
            });

            const hasV2FromApps = apps.some((app: any) => {
                const rawUrlCandidates = [
                    app?.sourceUrl,
                    app?.url,
                    app?.targetUrl,
                    app?.originUrl,
                    app?.originalUrl,
                    app?.inputUrl,
                    app?.websiteUrl,
                    app?.source?.url,
                ];

                const hasMatchingUrl = rawUrlCandidates.some((raw) => {
                    const normalizedAppUrl = validateAndNormalizePublicHttpUrl(String(raw || ""));
                    if (!normalizedAppUrl) return false;
                    return normUrl(normalizedAppUrl).toLowerCase() === canonicalCandidate;
                });
                if (hasMatchingUrl) return true;

                const hashCandidates = [
                    app?.urlHash,
                    app?.sourceUrlHash,
                    app?.targetUrlHash,
                    app?.originUrlHash,
                ]
                    .map((v) => (typeof v === "string" ? v : ""))
                    .filter(Boolean);

                return hashCandidates.includes(candidateHash);
            });

            const hasV1 = hasV1FromUrls || hasV1FromRenders;
            const hasV2 = hasV2FromApps;

            if (hasV1 && hasV2) {
                return "This URL already has a website. Use a different URL to create a new one.";
            }
            if (hasV2) {
                return "This URL already has a website. Use a different URL to create a new one.";
            }
            if (hasV1) {
                return "This URL has already been processed.";
            }

            return DUPLICATE_URL_MESSAGE;
        },
        [apps, renders, urls],
    );

    const hasProcessedUrl = useCallback(
        (candidateUrl: string): boolean => {
            const normalizedCandidate = validateAndNormalizePublicHttpUrl(candidateUrl);
            if (!normalizedCandidate) return false;
            const canonicalCandidate = normalizedCandidate.toLowerCase();

            return urls.some((entry) => {
                const normalizedExisting = validateAndNormalizePublicHttpUrl(String(entry?.url || ""));
                return !!normalizedExisting && normalizedExisting.toLowerCase() === canonicalCandidate;
            });
        },
        [urls],
    );

    // If someone deep-links an invalid URL, fail gracefully (no Firestore errors / snapshot retries).
    useEffect(() => {
        if (!urlParam) return;
        if (targetUrl) return;

        setErr("Please enter a valid public http(s) URL.");
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete("u");
            url.searchParams.delete("start");
            const qs = url.searchParams.toString();
            const next = qs ? `${url.pathname}?${qs}` : url.pathname;
            router.replace(next, { scroll: false });
        } catch {
            // ignore
        }
    }, [urlParam, targetUrl, router]);

    const submitMiniUrl = useCallback(
        (raw: string) => {
            const normalized = validateAndNormalizePublicHttpUrl(raw);
            if (!normalized) return;
            if (!canUseScreenshotCredit()) {
                setErr("You have used all monthly screenshot credits. Upgrade to capture more pages and monitor more sites.");
                setInfo("");
                push("You have used all available screenshot credits for this month.", "warn");
                setShowCreditsPaywall("screenshot");
                return;
            }
            setErr("");
            setInfo("");
            router.push(`/dashboard/view?u=${encodeURIComponent(normalized)}&start=1`, { scroll: false });
        },
        [canUseScreenshotCredit, push, router]
    );

    const submitMiniPrompt = useCallback(
        (prompt: string) => {
            const p = stripHttpsUrlsFromPrompt(prompt || "").trim();
            if (!p) return;
            router.push(`/dashboard/view?wizard=1&source=prompt&prompt=${encodeURIComponent(p)}`, { scroll: false });
        },
        [router]
    );

    const [urlMenuOpen, setUrlMenuOpen] = useState(false);
    const urlMenuRef = useRef<HTMLDivElement | null>(null);

    const [urlDocReloadNonce, setUrlDocReloadNonce] = useState(0);
    const startRequestedInFlightRef = useRef<string>("");
    const startRequestedEnqueueAttemptRef = useRef<string>("");
    // Tracks the startRequestKey for which /generate was successfully enqueued, used by the
    // polling fallback to know when it can stop retrying.
    const generateSucceededRef = useRef<string>("");
    // Tracks the startRequestKey for which /generate returned a server error, used to stop
    // polling from retrying after a real failure (as opposed to a missed race-condition fire).
    const generateAbortedRef = useRef<string>("");
    // Counts how many polling retries have been attempted for the current startRequestKey.
    const generatePollCountRef = useRef<number>(0);
    const [captureLockUrl, setCaptureLockUrl] = useState<string | null>(null);
    const captureLockStartedAtRef = useRef<number>(0);
    // Minimum wall-clock time (Date.now()) before the capture lock is auto-released on status
    // change. Ensures the queued/processing UI persists for at least 60s after /generate fires.
    const captureLockMinUntilRef = useRef<number>(0);
    const captureLockUrlRef = useRef<string | null>(null);
    const captureStatusRef = useRef<UrlStatusUi | null>(null);
    const targetUrlRef = useRef<string>("");
    const captureStallReportedForUrlRef = useRef<string>("");
    const captureStaleReportedForUrlRef = useRef<string>("");
    const [captureTerminalFailureUrl, setCaptureTerminalFailureUrl] = useState<string>("");

    const markUrlCaptureTerminalError = useCallback(
        async (uid: string, rawUrl: string, lastError: string, nextStatus: "error" | "stale" = "error") => {
            try {
                const colRef = collection(db, "kloner_users", uid, "kloner_urls");
                const qy = query(colRef, where("url", "==", rawUrl));
                const latest = await getDocs(qy);
                await Promise.all(
                    latest.docs.map((d: any) =>
                        updateDoc(d.ref, {
                            status: nextStatus,
                            updatedAt: serverTimestamp(),
                            lastError,
                        } as any)
                    )
                );
                setUrlDocReloadNonce((n) => n + 1);
            } catch {
                // ignore Firestore sync failures; local UI will still show the error
            }
        },
        []
    );

    const clearStartQueryParam = useCallback(() => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete("start");
            const qs = url.searchParams.toString();
            const next = qs ? `${url.pathname}?${qs}` : url.pathname;
            router.replace(next, { scroll: false });
        } catch {
            // ignore
        }
    }, [router]);

    const clearUrlScanQueuedState = useCallback(
        (rawUrl: string, message: string) => {
            const normalized = normUrl(rawUrl);
            generateAbortedRef.current = `${user?.uid || ""}:${rawUrl}`;
            captureStallReportedForUrlRef.current = normalized;
            captureStaleReportedForUrlRef.current = normalized;
            captureLockMinUntilRef.current = 0;
            captureLockStartedAtRef.current = 0;
            setCaptureTerminalFailureUrl(normalized);
            setCaptureLockUrl(null);
            setHideCaptureQueueStatus(true);
            setCaptureIssueNotice("Issue detected while scanning this URL.");
            setInfo("");
            setErr(message);
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete("start");
                const qs = url.searchParams.toString();
                const next = qs ? `${url.pathname}?${qs}` : url.pathname;
                router.replace(next, { scroll: false });
            } catch {
                // ignore
            }
        },
        [router, user?.uid],
    );

    const shouldSendFrontendTimeoutAlert = useCallback((action: string, rawUrl: string) => {
        try {
            if (typeof window === "undefined") return true;
            const normalizedUrl = normUrl(rawUrl);
            if (!normalizedUrl) return true;

            // Some URL-capture failures can transition through multiple terminal labels
            // (e.g. queued timeout -> stale) within the same incident. Collapse them into
            // one dedupe family so Slack gets a single alert per URL incident.
            const dedupeAction = (() => {
                const a = String(action || "").trim().toLowerCase();
                if (a === "url_capture_stalled" || a === "url_capture_stale") {
                    return "url_capture_timeout_or_stale";
                }
                return a || "unknown_action";
            })();

            const now = Date.now();
            const cacheRaw = window.sessionStorage.getItem(FRONTEND_TIMEOUT_DEDUPE_STORAGE_KEY);
            const cache = cacheRaw ? JSON.parse(cacheRaw) as Record<string, number> : {};
            const next: Record<string, number> = {};

            for (const [key, at] of Object.entries(cache)) {
                if (typeof at === "number" && now - at < FRONTEND_TIMEOUT_DEDUPE_TTL_MS) {
                    next[key] = at;
                }
            }

            const dedupeKey = `${dedupeAction}:${normalizedUrl}`;
            if (typeof next[dedupeKey] === "number") {
                window.sessionStorage.setItem(FRONTEND_TIMEOUT_DEDUPE_STORAGE_KEY, JSON.stringify(next));
                return false;
            }

            next[dedupeKey] = now;
            window.sessionStorage.setItem(FRONTEND_TIMEOUT_DEDUPE_STORAGE_KEY, JSON.stringify(next));
            return true;
        } catch {
            // If storage is unavailable, fail open so alerts still work.
            return true;
        }
    }, []);

    const buildDuplicateUrlMessageRef = useRef(buildDuplicateUrlMessage);

    useEffect(() => {
        buildDuplicateUrlMessageRef.current = buildDuplicateUrlMessage;
    }, [buildDuplicateUrlMessage]);

    // When a URL is entered from the mini-dashboard entry panel (or deep-linked with start=1),
    // ensure the UrlDoc exists and queue the screenshot capture job. The existing loader stages
    // in this page will then take over (docData + shots + groupedShots + preview generation).
    useEffect(() => {
        if (!startRequested) return;
        if (!user || !targetUrl) return;
        if (!isHttpUrl(targetUrl)) return;
        if (!canUseScreenshotCredit()) return;
        if (!canUseScreenshotCredit()) {
            setErr("You have used all monthly screenshot credits. Upgrade to capture more pages and monitor more sites.");
            setInfo("");
            setShowCreditsPaywall("screenshot");
            clearStartQueryParam();
            return;
        }
        const startRequestKey = `${user.uid}:${targetUrl}`;
        if (startRequestedInFlightRef.current === startRequestKey) return;
        startRequestedInFlightRef.current = startRequestKey;

        setCaptureLockUrl(targetUrl);
        captureLockStartedAtRef.current = Date.now();
        captureLockMinUntilRef.current = Date.now() + 60_000;
        captureStallReportedForUrlRef.current = "";
        captureStaleReportedForUrlRef.current = "";
        setCaptureTerminalFailureUrl("");

        let cancelled = false;
        let shouldMarkHandled = false;
        (async () => {
            try {
                let csrf = await ensureSessionAndCsrf().catch(() => null);

                const colRef = collection(db, "kloner_users", user.uid, "kloner_urls");
                const qy = query(colRef, where("url", "==", targetUrl));
                const snap = await getDocs(qy);
                if (cancelled) return;

                if (snap.empty) {
                    const urlHash = hash64(targetUrl);
                    await addDoc(colRef, {
                        url: targetUrl,
                        urlHash,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                        status: "queued",
                        screenshotsPrefix: `kloner-screenshots/${user.uid}/${urlHash}`,
                        screenshotPaths: [],
                    } as UrlDoc);

                    // Trigger the url-doc loader effect to re-run immediately.
                    setUrlDocReloadNonce((n) => n + 1);

                    // Best-effort: keep dropdown list fresh even before the next fetch.
                    setUrls((prev) => {
                        if (prev.some((u) => normUrl(u.url) === normUrl(targetUrl))) return prev;
                        return [{ id: `local_${hash64(targetUrl)}`, url: targetUrl, urlHash: hash64(targetUrl) } as any, ...prev].slice(0, 50);
                    });
                } else {
                    // If this URL already exists, sync it into local dropdown state first so users
                    // can select it immediately, even if the initial list query didn't include it.
                    const existingDoc = snap.docs[0];
                    const existingData = (existingDoc.data() || {}) as UrlDoc;
                    const canonicalTarget = normUrl(targetUrl);

                    setUrls((prev) => {
                        const deduped = prev.filter((u) => normUrl(String(u?.url || "")) !== canonicalTarget);
                        return [{ id: existingDoc.id, ...(existingData as any) }, ...deduped].slice(0, 50);
                    });

                    const existingShotCount =
                        (Array.isArray(existingData?.screenshotPaths) ? existingData.screenshotPaths.length : 0) +
                        (Array.isArray(existingData?.screenshots) ? existingData.screenshots.length : 0);
                    const existingStatusUi = normalizeUrlStatus(
                        existingData?.status,
                        existingShotCount,
                        existingData?.updatedAt,
                        (existingData as any)?.lastError,
                    );

                    const hasExistingScanContext =
                        existingStatusUi === "ready" ||
                        existingStatusUi === "queued" ||
                        existingStatusUi === "processing";

                    if (hasExistingScanContext) {
                        if (cancelled) return;

                        setErr("");
                        setInfo(buildDuplicateUrlMessageRef.current(targetUrl));
                        generateSucceededRef.current = startRequestKey;
                        setCaptureTerminalFailureUrl("");
                        captureLockMinUntilRef.current = 0;
                        setCaptureLockUrl(null);
                        captureLockStartedAtRef.current = 0;
                        shouldMarkHandled = true;
                        return;
                    }
                }

                startRequestedEnqueueAttemptRef.current = startRequestKey;
                const res = await fetch("/api/private/generate", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ url: targetUrl }),
                });
                shouldMarkHandled = res.ok;
                if (res.ok) {
                    generateSucceededRef.current = startRequestKey;
                    setCaptureTerminalFailureUrl("");
                }

                if (cancelled) return;

                if (!res.ok) {
                    const payload = await res.json().catch(() => ({} as any));
                    const activeCaptureForTarget = (() => {
                        const s = String(captureStatusRef.current || "").toLowerCase();
                        return s === "queued" || s === "processing" || s === "ready";
                    })();

                    // False-negative guard: if we got rate-limited but a capture is already active,
                    // do not flip the UI into a hard error state.
                    if (res.status === 429 && activeCaptureForTarget) {
                        shouldMarkHandled = true;
                        setErr("");
                        clearStartQueryParam();
                        return;
                    }

                    generateAbortedRef.current = startRequestKey;
                    setCaptureTerminalFailureUrl(normUrl(targetUrl));
                    const serverError =
                        (typeof payload?.error === "string" && payload.error.trim())
                            ? payload.error.trim()
                            : "";
                    const backendCode = String(payload?.code || payload?.backendCode || "").toUpperCase();
                    const looksBlocked = /blocked the snapshot request|site blocked|blocked/i.test(serverError);
                    const looksCrossDomainRedirect =
                        res.status === 422 ||
                        backendCode === "CROSS_DOMAIN_REDIRECT" ||
                        /redirect(ed)? to a different domain|cross.?domain redirect/i.test(serverError);
                    const uiError =
                        res.status === 429
                            ? (serverError || "Monthly snapshot limit reached for your plan.")
                            : looksCrossDomainRedirect
                                ? "This URL redirected to a different domain and was stopped for safety. Please use the final destination URL directly."
                            : looksBlocked
                                ? "This site blocked the snapshot request. Try a different URL or a less protected page."
                                : "Sorry, we were not able to process this URL. Please ensure it is accessible before trying again.";
                    setErr(uiError);
                    setInfo("");
                    if (res.status === 429) {
                        setShowCreditsPaywall("screenshot");
                    }
                    captureLockMinUntilRef.current = 0;
                    setCaptureLockUrl(null);
                    captureLockStartedAtRef.current = 0;
                    clearStartQueryParam();

                    // Persist terminal error status so a page refresh cannot keep this URL
                    // stuck in queued/processing without an active enqueue attempt.
                    void markUrlCaptureTerminalError(
                        user.uid,
                        targetUrl,
                        looksCrossDomainRedirect
                            ? "cross_domain_redirect"
                            : looksBlocked
                            ? "snapshot_blocked"
                            : (serverError || `generate_http_${res.status}`),
                        "error",
                    );

                    void (async () => {
                        // For blocked/conflict outcomes, /api/private/generate already emits a
                        // richer backend alert (url_scan_failed). Avoid duplicate Slack noise.
                        if (res.status === 409 || looksCrossDomainRedirect) return;
                        if (!shouldSendFrontendTimeoutAlert("url_capture_enqueue_failed", targetUrl)) return;
                        try {
                            await fetch("/api/internal/observability/frontend-timeout", {
                                method: "POST",
                                headers: {
                                    "content-type": "application/json",
                                    ...(csrf ? { "x-csrf": csrf } : {}),
                                },
                                credentials: "include",
                                body: JSON.stringify({
                                    action: "url_capture_enqueue_failed",
                                    route: "/dashboard/view",
                                    service: "dashboard-view",
                                    statusCode: res.status,
                                    status: "enqueue_failed",
                                    message: `Failed to queue URL capture (HTTP ${res.status}).`,
                                    previewUrl: targetUrl,
                                    tags: ["url-capture", "enqueue", "frontend", "error"],
                                }),
                            });
                        } catch {
                            // ignore telemetry failures
                        }
                    })();
                }
            } catch (e: any) {
                generateAbortedRef.current = startRequestKey;
                setCaptureTerminalFailureUrl(normUrl(targetUrl));
                setInfo("");
                clearStartQueryParam();
                if (!cancelled) setErr("This URL failed to process. Please ensure it is accessible before retrying.");
                captureLockMinUntilRef.current = 0;
                setCaptureLockUrl(null);
                captureLockStartedAtRef.current = 0;

                void markUrlCaptureTerminalError(
                    user.uid,
                    targetUrl,
                    "generate_request_failed",
                    "error",
                );
            } finally {
                if (!cancelled && shouldMarkHandled) {
                    clearStartQueryParam();
                }

                if (startRequestedInFlightRef.current === startRequestKey) {
                    startRequestedInFlightRef.current = "";
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        startRequested,
        user,
        targetUrl,
        canUseScreenshotCredit,
        clearStartQueryParam,
        shouldSendFrontendTimeoutAlert,
    ]);

    // Polling fallback: retries /generate up to MAX_POLL_ATTEMPTS times if the main effect
    // fails to enqueue (network hiccup, slow auth hydration on live, etc.). The poll starts
    // after an initial grace period and backs off between attempts.
    useEffect(() => {
        if (!startRequested) return;
        if (!user || !targetUrl) return;
        if (!isHttpUrl(targetUrl)) return;

        const startRequestKey = `${user.uid}:${targetUrl}`;

        // Reset poll counter whenever the key changes (new user/url combo).
        generatePollCountRef.current = 0;

        const MAX_POLL_ATTEMPTS = 5;
        const INITIAL_DELAY_MS = 2500;
        const POLL_INTERVAL_MS = 3000;

        let cancelled = false;
        let nextPollTimeoutId: ReturnType<typeof setTimeout> | null = null;

        const doEnqueueOnce = async (): Promise<boolean> => {
            let csrf = await ensureSessionAndCsrf().catch(() => null);
            if (cancelled) return false;

            const attempt = () =>
                fetch("/api/private/generate", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ url: targetUrl }),
                });

            let res = await attempt();
            if ((res.status === 401 || res.status === 403) && !cancelled) {
                csrf = await ensureSessionAndCsrf().catch(() => csrf);
                res = await attempt();
            }

            if (cancelled) return false;

            if (res.ok) {
                generateSucceededRef.current = startRequestKey;
                setCaptureTerminalFailureUrl("");
                clearStartQueryParam();
                return true;
            }

            const payload = await res.json().catch(() => ({} as any));
            const activeCaptureForTarget = (() => {
                const s = String(captureStatusRef.current || "").toLowerCase();
                return s === "queued" || s === "processing" || s === "ready";
            })();

            // False-negative guard for polling fallback: if a capture is already active,
            // treat 429 as a non-fatal duplicate enqueue outcome.
            if (res.status === 429 && activeCaptureForTarget) {
                generateSucceededRef.current = startRequestKey;
                clearStartQueryParam();
                return true;
            }

            // Server error — abort polling, wipe captured UI state, show error.
            generateAbortedRef.current = startRequestKey;
            if (!cancelled) {
                setCaptureTerminalFailureUrl(normUrl(targetUrl));
                const serverError =
                    (typeof payload?.error === "string" && payload.error.trim())
                        ? payload.error.trim()
                        : "";
                const backendCode = String(payload?.code || payload?.backendCode || "").toUpperCase();
                const looksBlocked = /blocked the snapshot request|site blocked|blocked/i.test(serverError);
                const looksCrossDomainRedirect =
                    res.status === 422 ||
                    backendCode === "CROSS_DOMAIN_REDIRECT" ||
                    /redirect(ed)? to a different domain|cross.?domain redirect/i.test(serverError);
                const uiError =
                    res.status === 429
                        ? (serverError || "Monthly snapshot limit reached for your plan.")
                        : looksCrossDomainRedirect
                            ? "This URL redirected to a different domain and was stopped for safety. Please use the final destination URL directly."
                        : looksBlocked
                            ? "This site blocked the snapshot request. Try a different URL or a less protected page."
                            : "This URL failed to process. Please ensure it is accessible before retrying.";
                if (res.status === 429) {
                    setShowCreditsPaywall("screenshot");
                }
                clearUrlScanQueuedState(targetUrl, uiError);

                if (res.status === 409 || res.status >= 500) {
                    void markUrlCaptureTerminalError(
                        user.uid,
                        targetUrl,
                        looksCrossDomainRedirect
                            ? "cross_domain_redirect"
                            : looksBlocked
                                ? "snapshot_blocked"
                                : (serverError || (res.status >= 500 ? `generate_http_${res.status}` : "generate_conflict")),
                        res.status >= 500 ? "stale" : "error",
                    );
                }
                // Best-effort: mark the Firestore doc as error so the UI reflects the real state
                // (if the doc stays "queued" the ghost render card won't clear).
                const colRef = collection(db, "kloner_users", user.uid, "kloner_urls");
                const qy = query(colRef, where("url", "==", targetUrl));
                const statusFromDoc = (d: any): string =>
                    String((d?.data?.()?.status ?? d?.status ?? "unknown") || "unknown").toLowerCase();
                const tryMarkError = async () => {
                    const latest = await getDocs(qy);
                    await Promise.all(
                        latest.docs.map((d: any) => {
                            const s = statusFromDoc(d);
                            if (s === "ready" || s === "uploaded" || s === "done") return Promise.resolve();
                            return updateDoc(d.ref, {
                                status: "error",
                                updatedAt: serverTimestamp(),
                                lastError: "poll_enqueue_server_error",
                            } as any);
                        })
                    );
                    setUrlDocReloadNonce((n) => n + 1);
                };
                void tryMarkError().catch(() => tryMarkError().catch(() => undefined));
            }

            // For blocked/conflict outcomes, backend already emits url_scan_failed.
            if (res.status === 409 || res.status === 422) return false;
            if (!shouldSendFrontendTimeoutAlert("url_capture_poll_enqueue_failed", targetUrl)) return false;

            void fetch("/api/internal/observability/frontend-timeout", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                body: JSON.stringify({
                    action: "url_capture_poll_enqueue_failed",
                    route: "/dashboard/view",
                    service: "dashboard-view",
                    statusCode: res.status,
                    status: "poll_enqueue_failed",
                    message: `Poll enqueue failed (HTTP ${res.status}).`,
                    previewUrl: targetUrl,
                    pollAttempt: generatePollCountRef.current,
                    tags: ["url-capture", "enqueue", "poll", "frontend"],
                }),
            }).catch(() => { });
            return false;
        };

        const schedulePoll = (delayMs: number) => {
            nextPollTimeoutId = setTimeout(async () => {
                if (cancelled) return;
                // Already succeeded (main effect or a prior poll).
                if (generateSucceededRef.current === startRequestKey) return;
                // Main effect received a real server error — do not retry.
                if (generateAbortedRef.current === startRequestKey) return;
                // Main effect is currently handling it — wait another cycle.
                if (startRequestedInFlightRef.current === startRequestKey) {
                    if (generatePollCountRef.current < MAX_POLL_ATTEMPTS) {
                        schedulePoll(POLL_INTERVAL_MS);
                    }
                    return;
                }
                // Also skip if main effect's request is still in flight (no failure yet).
                if (startRequestedEnqueueAttemptRef.current === startRequestKey) {
                    if (generatePollCountRef.current < MAX_POLL_ATTEMPTS) {
                        schedulePoll(POLL_INTERVAL_MS);
                    }
                    return;
                }

                generatePollCountRef.current++;
                let succeeded = false;
                try {
                    succeeded = await doEnqueueOnce();
                } catch {
                    // Network error — will retry on next cycle if attempts remain.
                }

                // If the poll itself got a server error, doEnqueueOnce will have set
                // generateAbortedRef — check it before scheduling another cycle.
                if (!cancelled && !succeeded && generatePollCountRef.current < MAX_POLL_ATTEMPTS
                    && generateAbortedRef.current !== startRequestKey) {
                    schedulePoll(POLL_INTERVAL_MS);
                }
            }, delayMs);
        };

        schedulePoll(INITIAL_DELAY_MS);

        return () => {
            cancelled = true;
            if (nextPollTimeoutId !== null) clearTimeout(nextPollTimeoutId);
        };
    }, [
        startRequested,
        user,
        targetUrl,
        canUseScreenshotCredit,
        clearStartQueryParam,
        shouldSendFrontendTimeoutAlert,
    ]);

    const startLockRequested = !!startRequested && !!targetUrl && !err;

    const shotMetaCount = useMemo(() => {
        if (!docData) return 0;
        return (
            (docData.screenshotPaths?.length || 0) +
            (Array.isArray(docData.screenshots) ? docData.screenshots.length : 0)
        );
    }, [docData]);

    const activeUrlStatus = useMemo<UrlStatusUi | null>(() => {
        if (!docData) return null;
        return normalizeUrlStatus(docData.status, shotMetaCount, docData.updatedAt, (docData as any)?.lastError);
    }, [docData, shotMetaCount]);

    const lockMatches = useMemo(() => {
        return !!targetUrl && (startLockRequested || captureLockUrl === targetUrl);
    }, [targetUrl, startLockRequested, captureLockUrl]);

    const hasAbortedStartForTarget = useMemo(() => {
        if (!user || !targetUrl) return false;
        return generateAbortedRef.current === `${user.uid}:${targetUrl}`;
    }, [user?.uid, targetUrl, err]);

    const captureStatus = useMemo<UrlStatusUi | null>(() => {
        const normalizedTarget = targetUrl ? normUrl(targetUrl) : "";
        if (normalizedTarget && captureTerminalFailureUrl === normalizedTarget) {
            if (activeUrlStatus === "ready") return activeUrlStatus;
            return "error";
        }

        if (hasAbortedStartForTarget) {
            if (activeUrlStatus === "ready") return activeUrlStatus;
            if (activeUrlStatus === "error" || activeUrlStatus === "stale") return activeUrlStatus;
            return err ? "error" : "stale";
        }

        // If we are in an in-flight capture, don't let an "unknown" doc status remove the UX lock.
        if (lockMatches) {
            const stable = activeUrlStatus;

            // When a fresh scan was explicitly requested (start=1), an old "stale" or "error" doc
            // should not surface as an error immediately — treat it as "queued" until the new
            // /generate call either succeeds or fails.
            if (startRequested && !err && !hasAbortedStartForTarget) {
                if (stable === "stale" || stable === "error") return "queued";
            }

            if (stable === "ready" || stable === "error" || stable === "stale") return stable;
            if (stable === "queued" || stable === "processing") return stable;

            // Infer from screenshot metadata: once any screenshot key/path exists, we're processing.
            return shotMetaCount > 0 ? "processing" : "queued";
        }

        return activeUrlStatus;
    }, [
        activeUrlStatus,
        hasAbortedStartForTarget,
        lockMatches,
        shotMetaCount,
        startRequested,
        err,
        targetUrl,
        captureTerminalFailureUrl,
    ]);

    const cancelQueuedCapture = useCallback(() => {
        if (!user || !targetUrl) return;

        const normalized = normUrl(targetUrl);
        generateAbortedRef.current = `${user.uid}:${targetUrl}`;
        captureStallReportedForUrlRef.current = normalized;
        captureLockMinUntilRef.current = 0;
        setCaptureLockUrl(null);
        captureLockStartedAtRef.current = 0;
        setCaptureTerminalFailureUrl(normalized);
        setHideCaptureQueueStatus(true);
        setCaptureIssueNotice("Capture cancelled after waiting too long.");
        setInfo("");
        setErr("");
        push("Cancelled stuck website generation. You can try again now.", "warn");
        clearStartQueryParam();

        void markUrlCaptureTerminalError(
            user.uid,
            targetUrl,
            "cancelled_after_timeout",
            "stale",
        );
    }, [clearStartQueryParam, markUrlCaptureTerminalError, targetUrl, user]);

    // Only lock generation controls while this frontend session owns an active capture flow.
    // A stale Firestore queued/processing status alone should not freeze the dashboard after refresh.
    const captureLocked =
        !err &&
        !hasAbortedStartForTarget &&
        lockMatches &&
        (captureStatus === "queued" || captureStatus === "processing");

    useEffect(() => {
        if (!err) return;
        if (captureStatus !== "error" && captureStatus !== "stale") return;
        if (!/not able to process this url|url failed to process|couldn't finish capturing this url/i.test(err)) {
            return;
        }

        setCaptureIssueNotice("Issue detected while scanning this URL.");
        setHideCaptureQueueStatus(true);
        const timeoutId = window.setTimeout(() => {
            setCaptureIssueNotice("");
        }, CAPTURE_ISSUE_NOTICE_MS);

        return () => window.clearTimeout(timeoutId);
    }, [err, captureStatus]);

    useEffect(() => {
        // Avoid carrying a prior URL's scan-issue notice into a newly selected URL.
        setCaptureIssueNotice("");
        setHideCaptureQueueStatus(false);
    }, [targetUrl]);

    useEffect(() => {
        if (captureStatus === "queued" || captureStatus === "processing") {
            setCaptureIssueNotice("");
        }
    }, [captureStatus]);

    useEffect(() => {
        // Re-enable queued/processing inline status only when a fresh scan is actively in flight.
        if (!hideCaptureQueueStatus) return;
        if (lockMatches && (captureStatus === "queued" || captureStatus === "processing") && !err) {
            setHideCaptureQueueStatus(false);
        }
    }, [hideCaptureQueueStatus, lockMatches, captureStatus, err]);

    useEffect(() => {
        captureLockUrlRef.current = captureLockUrl;
    }, [captureLockUrl]);

    useEffect(() => {
        captureStatusRef.current = captureStatus;
    }, [captureStatus]);

    useEffect(() => {
        targetUrlRef.current = targetUrl;
    }, [targetUrl]);

    // Reset polling state whenever the user or target URL changes so a new attempt
    // starts fresh with no stale succeeded/count/aborted values from a prior request.
    useEffect(() => {
        generateSucceededRef.current = "";
        generateAbortedRef.current = "";
        generatePollCountRef.current = 0;
    }, [user, targetUrl]);

    useEffect(() => {
        if (!captureLockUrl) return;
        if (!targetUrl || captureLockUrl !== targetUrl) return;

        if (err) {
            // Hard failure — release lock immediately regardless of min-until.
            captureLockMinUntilRef.current = 0;
            setCaptureLockUrl(null);
            captureLockStartedAtRef.current = 0;
            return;
        }

        if (captureStatus && captureStatus !== "queued" && captureStatus !== "processing") {
            const remaining = captureLockMinUntilRef.current - Date.now();
            if (remaining > 0) {
                // Hold the queued UI until the 60s minimum display time has elapsed.
                const t = setTimeout(() => {
                    captureLockMinUntilRef.current = 0;
                    setCaptureLockUrl(null);
                    captureLockStartedAtRef.current = 0;
                }, remaining);
                return () => window.clearTimeout(t);
            }
            captureLockMinUntilRef.current = 0;
            setCaptureLockUrl(null);
            captureLockStartedAtRef.current = 0;
        }
    }, [captureLockUrl, targetUrl, captureStatus, err]);

    useEffect(() => {
        if (!targetUrl) return;
        if (err) return;
        if (captureStatus !== "queued" && captureStatus !== "processing") return;

        const updatedAtMs = (() => {
            const raw = (docData as any)?.updatedAt;
            if (typeof raw?.toMillis === "function") return raw.toMillis();
            const parsed = Date.parse(raw || "");
            return Number.isFinite(parsed) ? parsed : null;
        })();

        const startedAt = captureLockStartedAtRef.current || updatedAtMs || Date.now();
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, CAPTURE_STALL_TIMEOUT_MS - elapsed);

        const timeoutId = window.setTimeout(() => {
            const currentTarget = targetUrlRef.current;
            const currentStatus = captureStatusRef.current;
            if (!currentTarget) return;
            if (currentStatus !== "queued" && currentStatus !== "processing") return;

            const normalizedUrl = normUrl(currentTarget);
            if (captureStallReportedForUrlRef.current === normalizedUrl) return;
            captureStallReportedForUrlRef.current = normalizedUrl;
            setCaptureTerminalFailureUrl(normalizedUrl);

            setCaptureLockUrl(null);
            captureLockStartedAtRef.current = 0;
            setInfo("");
            if (!shouldSendFrontendTimeoutAlert("url_capture_stalled", currentTarget)) return;
            setErr("We couldn't finish capturing this URL. Please re-enter the URL above and try again.");

            void (async () => {
                try {
                    const csrf = await ensureSessionAndCsrf().catch(() => null);
                    await fetch("/api/internal/observability/frontend-timeout", {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                            ...(csrf ? { "x-csrf": csrf } : {}),
                        },
                        credentials: "include",
                        body: JSON.stringify({
                            action: "url_capture_stalled",
                            route: "/dashboard/view",
                            service: "dashboard-view",
                            statusCode: 504,
                            status: "queued_timeout",
                            message: "URL capture stayed queued/processing for more than 6 minutes without completion.",
                            previewUrl: currentTarget,
                            ageMs: Date.now() - startedAt,
                            tags: ["url-capture", "queue", "timeout", "frontend"],
                        }),
                    });
                } catch {
                    // ignore telemetry failures
                }
            })();
        }, remaining);

        return () => window.clearTimeout(timeoutId);
    }, [targetUrl, captureStatus, err, docData, shouldSendFrontendTimeoutAlert]);

    useEffect(() => {
        if (!targetUrl) return;
        if (captureStatus !== "stale") return;
        // Don't fire while a fresh scan is actively being started — the doc status is stale from
        // a prior run and will be overwritten once /generate kicks off.
        if (startRequested && !err) return;

        const normalizedUrl = normUrl(targetUrl);
        if (captureStaleReportedForUrlRef.current === normalizedUrl) return;
        if (hasCaptureStaleAlertBeenSent(normalizedUrl)) return;
        captureStaleReportedForUrlRef.current = normalizedUrl;
        markCaptureStaleAlertSent(normalizedUrl);
        setCaptureTerminalFailureUrl(normalizedUrl);

        if (!shouldSendFrontendTimeoutAlert("url_capture_stale", targetUrl)) return;

        if (!err) {
            setInfo("");
            setErr("We couldn't finish capturing this URL. Please re-enter the URL above and try again.");
        }

        void (async () => {
            try {
                const csrf = await ensureSessionAndCsrf().catch(() => null);
                await fetch("/api/internal/observability/frontend-timeout", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        action: "url_capture_stale",
                        route: "/dashboard/view",
                        service: "dashboard-view",
                        statusCode: 504,
                        status: "stale",
                        message: "URL capture entered stale state before completion.",
                        previewUrl: targetUrl,
                        tags: ["url-capture", "stale", "frontend"],
                    }),
                });
            } catch {
                // ignore telemetry failures
            }
        })();
    }, [targetUrl, captureStatus, err, startRequested, shouldSendFrontendTimeoutAlert]);

    useEffect(() => {
        const normalizedUrl = targetUrl ? normUrl(targetUrl) : "";
        if (!normalizedUrl) return;
        if (captureStatus === "stale") return;
        clearCaptureStaleAlertSent(normalizedUrl);
    }, [targetUrl, captureStatus]);

    useEffect(() => {
        // Avoid stale/duplicate legacy notifications after capture finishes (e.g. during hot reload).
        if (
            info !== "Queued snapshot job…" &&
            info !== "Queued scan… "
        ) {
            return;
        }
        if (!captureStatus) return;
        if (captureStatus === "queued" || captureStatus === "processing") return;
        setInfo("");
    }, [info, captureStatus]);

    const capturePrevStatusRef = useRef<UrlStatusUi | null>(null);
    const captureSuccessShownForUrlRef = useRef<string>("");
    const firstUrlEmailAttemptedUrlsRef = useRef<Set<string>>(new Set());

    const triggerFirstUrlNextStepsEmail = useCallback(
        async (url: string) => {
            const normalized = validateAndNormalizePublicHttpUrl(url || "");
            const canonical = normalized ? normUrl(normalized) : "";
            if (!canonical) return;
            if (firstUrlEmailAttemptedUrlsRef.current.has(canonical)) return;
            firstUrlEmailAttemptedUrlsRef.current.add(canonical);

            try {
                const csrf = await ensureSessionAndCsrf().catch(() => null);
                await fetch("/api/private/send-first-url-email", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "same-origin",
                    cache: "no-store",
                    body: JSON.stringify({ url: canonical }),
                });
            } catch {
                // Non-blocking: dashboard flow should not fail on email issues.
            }
        },
        [],
    );

    useEffect(() => {
        const urlKey = targetUrl ? normUrl(targetUrl) : "";
        const prev = capturePrevStatusRef.current;
        capturePrevStatusRef.current = captureStatus;

        // Clear on URL change / navigation.
        if (!urlKey) {
            setSuccess("");
            captureSuccessShownForUrlRef.current = "";
            return;
        }

        // If a new capture starts, clear any prior success.
        if (captureStatus === "queued" || captureStatus === "processing") {
            setSuccess("");
            return;
        }

        if (isDuplicateUrlConfirmationMessage(info || "")) {
            setSuccess("");
            return;
        }

        if (err) return;
        if (!lockMatches) return;

        const wasInFlight = prev === "queued" || prev === "processing";
        const isNowReady = captureStatus === "ready";
        if (!wasInFlight || !isNowReady) return;

        if (captureSuccessShownForUrlRef.current === urlKey) return;
        captureSuccessShownForUrlRef.current = urlKey;

        setAutoOpenGenerateSuccessMessage(URL_ADD_SUCCESS_MESSAGE);
        setAutoOpenGenerateModalNonce((n) => n + 1);
        void triggerFirstUrlNextStepsEmail(urlKey);
    }, [captureStatus, targetUrl, lockMatches, err, info, isDuplicateUrlConfirmationMessage, triggerFirstUrlNextStepsEmail]);

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

        const valid = urls.filter((u) => !!validateAndNormalizePublicHttpUrl(u.url));
        if (targetUrl) {
            const match = valid.find((u) => normUrl(u.url) === normUrl(targetUrl));
            if (match) return match;
        }

        return valid[0] ?? null;
    }, [urls, targetUrl]);

    const orderedUrls = useMemo(() => {
        // Keep invalid URLs visible in the menu so they can be deleted.
        if (!urls.length) return [];
        if (!activeUrlDoc) return urls;
        const rest = urls.filter((u) => u.id !== activeUrlDoc.id);
        return [activeUrlDoc, ...rest];
    }, [urls, activeUrlDoc]);

    const activeUrlStatusUi = useMemo<UrlStatusUi | null>(() => {
        if (!activeUrlDoc) return null;

        const normalizedActive = validateAndNormalizePublicHttpUrl(String(activeUrlDoc.url || ""));
        const activeCanonical = normalizedActive ? normUrl(normalizedActive) : "";
        const targetCanonical = targetUrl ? normUrl(targetUrl) : "";
        const isSelectedTarget = !!activeCanonical && !!targetCanonical && activeCanonical === targetCanonical;

        const source: any = isSelectedTarget && docData
            ? {
                status: docData.status,
                screenshotPaths: docData.screenshotPaths,
                screenshots: docData.screenshots,
                updatedAt: docData.updatedAt,
                lastError: (docData as any)?.lastError,
            }
            : activeUrlDoc;

        const shotCount =
            (Array.isArray(source?.screenshotPaths) ? source.screenshotPaths.length : 0) +
            (Array.isArray(source?.screenshots) ? source.screenshots.length : 0);

        let statusUi = normalizeUrlStatus(source?.status, shotCount, source?.updatedAt, source?.lastError);
        if (activeCanonical && captureTerminalFailureUrl === activeCanonical && statusUi !== "ready") {
            statusUi = "error";
        }
        return statusUi;
    }, [activeUrlDoc, targetUrl, docData, captureTerminalFailureUrl]);

    const activeUrlCannotGenerate = activeUrlStatusUi === "error" || activeUrlStatusUi === "stale";

    const activeUrlIssueHref = useMemo(() => {
        const normalized = validateAndNormalizePublicHttpUrl(String(activeUrlDoc?.url || ""));
        return normalized ? normUrl(normalized) : "";
    }, [activeUrlDoc?.url]);

    const showActiveUrlIssueWarning =
        activeUrlCannotGenerate &&
        !!activeUrlIssueHref &&
        dismissedUrlIssueCanonical !== activeUrlIssueHref;

    useEffect(() => {
        if (!dismissedUrlIssueCanonical) return;
        const currentCanonical = targetUrl ? normUrl(targetUrl) : "";
        // Re-show warning if user leaves this URL and later opens it again.
        if (!currentCanonical || currentCanonical !== dismissedUrlIssueCanonical) {
            setDismissedUrlIssueCanonical("");
        }
    }, [targetUrl, dismissedUrlIssueCanonical]);

    const successfulScannedUrls = useMemo(() => {
        const seen = new Set<string>();
        const out: string[] = [];

        const addIfReady = (entry: {
            url?: string;
            status?: UrlDoc["status"];
            screenshotPaths?: unknown;
            screenshots?: unknown;
            updatedAt?: any;
        }) => {
            const normalized = validateAndNormalizePublicHttpUrl(String(entry?.url || ""));
            if (!normalized) return;

            const screenshotPathCount = Array.isArray(entry?.screenshotPaths) ? entry.screenshotPaths.length : 0;
            const screenshotMetaCount = Array.isArray(entry?.screenshots) ? entry.screenshots.length : 0;
            const statusUi = normalizeUrlStatus(
                entry?.status,
                screenshotPathCount + screenshotMetaCount,
                entry?.updatedAt,
            );
            if (statusUi !== "ready") return;

            const canonical = normUrl(normalized);
            if (!canonical || seen.has(canonical)) return;
            seen.add(canonical);
            out.push(canonical);
        };

        // Prefer live active URL doc so the wizard dropdown updates immediately after first successful capture.
        if (targetUrl && docData) {
            addIfReady({
                url: targetUrl,
                status: docData.status,
                screenshotPaths: docData.screenshotPaths,
                screenshots: docData.screenshots,
                updatedAt: docData.updatedAt,
            });
        }

        for (const entry of urls) addIfReady(entry);

        return out;
    }, [urls, targetUrl, docData]);

    useEffect(() => {
        if (!appWizardOpen || appWizardSource !== "website") return;
        if (!successfulScannedUrls.length) return;

        const normalizedCurrent = validateAndNormalizePublicHttpUrl(appWizardUrl || "");
        const currentCanonical = normalizedCurrent ? normUrl(normalizedCurrent) : "";
        const hasCurrent = currentCanonical
            ? successfulScannedUrls.some((u) => normUrl(u) === currentCanonical)
            : false;
        if (hasCurrent) return;

        setAppWizardUrl(successfulScannedUrls[0]);
    }, [appWizardOpen, appWizardSource, appWizardUrl, successfulScannedUrls]);

    const countRendersForUrl = useCallback(
        async (uid: string, url: string, urlHash: string) => {
            const rendersCol = collection(db, "kloner_users", uid, "kloner_renders");
            const qHash = query(rendersCol, where("urlHash", "==", urlHash));
            const qUrl = query(rendersCol, where("url", "==", url));
            const [snapHash, snapUrl] = await Promise.all([getDocs(qHash), getDocs(qUrl)]);
            const ids = new Set<string>();
            snapHash.forEach((d) => ids.add(d.id));
            snapUrl.forEach((d) => ids.add(d.id));
            return ids.size;
        },
        [db]
    );

    const deleteTrackedUrl = useCallback(
        async (r: { id: string } & UrlDoc) => {
            if (!user) return;

            const urlHash = r.urlHash || hash64(r.url);

            // Block deletion if there are renders referencing this URL.
            try {
                const renderCount = await countRendersForUrl(user.uid, r.url, urlHash);
                if (renderCount > 0) {
                    await showAlert(
                        `This URL has ${renderCount} preview(s) associated with it. Archive/delete those previews first, then retry deleting the URL.`,
                        "Delete URL",
                    );
                    return;
                }
            } catch {
                await showAlert(
                    "Unable to verify whether previews exist for this URL, so deletion was blocked for safety.",
                    "Delete URL",
                );
                return;
            }

            const displayUrl = r.url && r.url.length > 64 ? `${r.url.slice(0, 61)}...` : r.url;
            const ok = await showConfirm(
                `Delete this tracked URL?\n\n${displayUrl}\n\nThis removes the URL and its screenshots.`,
                "Delete URL"
            );
            if (!ok) return;

            setErr("");
            setInfo("Deleting URL…");
            try {
                const prefix =
                    r.screenshotsPrefix ||
                    `kloner-screenshots/${user.uid}/${urlHash}`;

                if (Array.isArray(r.screenshotPaths) && r.screenshotPaths.length > 0) {
                    await Promise.allSettled(
                        r.screenshotPaths.map((p) => deleteObject(sRef(storage, p)))
                    );
                } else {
                    const refs = await listAllDeep(sRef(storage, prefix)).catch(() => []);
                    await Promise.allSettled(refs.map((it) => deleteObject(it)));
                }

                await deleteDoc(doc(db, "kloner_users", user.uid, "kloner_urls", r.id));

                setUrls((prev) => prev.filter((u) => u.id !== r.id));
                setUrlMenuOpen(false);

                // If we just deleted the currently selected URL, route to the next valid URL (or clear selection).
                if (activeUrlDoc?.id === r.id) {
                    const remaining = urls.filter((u) => u.id !== r.id);
                    const nextValid = remaining.find((u) => !!validateAndNormalizePublicHttpUrl(u.url))?.url || "";
                    if (nextValid) {
                        router.replace(`/dashboard/view?u=${encodeURIComponent(nextValid)}`, { scroll: false });
                    } else {
                        router.replace(`/dashboard/view`, { scroll: false });
                    }
                }
            } catch (e: any) {
                setErr(e?.message || "Delete failed.");
            } finally {
                setInfo("");
            }
        },
        [
            user,
            activeUrlDoc?.id,
            urls,
            router,
            storage,
            db,
            showAlert,
            showConfirm,
            countRendersForUrl,
        ]
    );

    const targetHash = useMemo(
        () => (isHttpUrl(targetUrl) ? hash64(targetUrl) : null),
        [targetUrl]
    );

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) {
                setStripeStatus(null);
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
                    const nextStripeStatus =
                        typeof data?.stripeStatus === "string" && data.stripeStatus.trim()
                            ? data.stripeStatus.trim().toLowerCase()
                            : null;
                    setStripeStatus(nextStripeStatus);

                    if (t === "pro" || t === "agency" || t === "enterprise") {
                        effectiveTier = t as UserTier;
                    } else {
                        effectiveTier = "free";
                    }
                } else {
                    setStripeStatus(null);
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
                setStripeStatus(null);
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
    const prevUrlDocContextRef = useRef<{ uid: string; targetUrl: string }>({ uid: "", targetUrl: "" });

    useEffect(() => {
        let unsubUrlDoc: Unsubscribe | null = null;

        (async () => {
            const currentContext = {
                uid: user?.uid || "",
                targetUrl,
            };
            const contextChanged =
                currentContext.uid !== prevUrlDocContextRef.current.uid ||
                currentContext.targetUrl !== prevUrlDocContextRef.current.targetUrl;
            prevUrlDocContextRef.current = currentContext;

            // Keep terminal capture errors visible during nonce-driven doc refreshes.
            if (contextChanged) {
                setErr("");
                setInfo("");
            }
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
                    keys: Array.isArray(initial.screenshots)
                        ? initial.screenshots
                            .map((s: any) => (typeof s?.key === "string" ? s.key : ""))
                            .filter((k: string) => !!k)
                        : [],
                });

                await loadShotsForDoc(user, targetUrl, initial).catch(() => null);

                unsubUrlDoc = onSnapshot(
                    first.ref,
                    async (fresh) => {
                        const data = (fresh.data() || {}) as UrlDoc;
                        setDocData(data);

                        const currentKey = JSON.stringify({
                            paths: data.screenshotPaths || [],
                            prefix: data.screenshotsPrefix || "",
                            keys: Array.isArray(data.screenshots)
                                ? data.screenshots
                                    .map((s: any) => (typeof s?.key === "string" ? s.key : ""))
                                    .filter((k: string) => !!k)
                                : [],
                        });

                        if (
                            currentKey !== lastDocShotsKeyRef.current
                        ) {
                            lastDocShotsKeyRef.current = currentKey;
                            await loadShotsForDoc(user, targetUrl, data).catch(() => null);
                        }
                    },
                    (err) => {
                        console.warn("[firestore] url doc snapshot failed", err);
                        const code = String((err as any)?.code || "").toLowerCase();
                        if (code.includes("permission-denied")) {
                            void handleSessionExpired("url_doc_snapshot_permission_denied");
                            return;
                        }
                        setErr("Failed to load screenshots.");
                    },
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
    }, [user, targetUrl, urlDocReloadNonce, handleSessionExpired]);

    /* ───────── renders (editable previews) ───────── */

    const asStringOrNull = (value: unknown): string | null =>
        typeof value === "string" ? value : null;

    const asStringOrEmpty = (value: unknown): string =>
        typeof value === "string" ? value : "";

    const asStringOrUndefined = (value: unknown): string | undefined =>
        typeof value === "string" ? value : undefined;

    const normalizeRenderStatus = (value: unknown): RenderDoc["status"] => {
        const s = typeof value === "string" ? value.toLowerCase() : "";
        if (s === "queued" || s === "processing" || s === "ready" || s === "failed" || s === "error") {
            return s;
        }
        return "ready";
    };

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
            url: asStringOrNull(data.url),
            source: asStringOrNull(data.source),
            urlHash: asStringOrNull(data.urlHash),
            key: asStringOrNull(data.key) ?? asStringOrNull(data.referenceImage),
            referenceImage: asStringOrNull(data.referenceImage),
            html: asStringOrEmpty(data.html),
            status: normalizeRenderStatus(data.status),
            reason: asStringOrNull(data.reason),
            nameHint: asStringOrNull(data.nameHint),
            archived: data.archived ?? false,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            siteConfigId: asStringOrUndefined(data.siteConfigId),
            model: asStringOrNull(data.model),
            version: data.version ?? null,
            controllerVersion: asStringOrNull(data.controllerVersion),
            lastExportedAt: data.lastExportedAt ?? null,
            vercelProjectId: asStringOrNull(data.vercelProjectId),
            vercelProjectName: asStringOrNull(data.vercelProjectName),
            lastDeployUrl: asStringOrNull(data.lastDeployUrl),
            seoMetaByPage: data.seoMetaByPage ?? null,

            // progress wiring
            progress:
                typeof data.progress === "number"
                    ? data.progress
                    : progressFromBackend,
        };
    }

    function mapRenderData(id: string, data: any): { id: string } & RenderDoc {
        const progressFromBackend =
            typeof data?.progressPercent === "number"
                ? data.progressPercent
                : typeof data?.progress === "number"
                    ? data.progress
                    : null;

        return {
            id,
            url: asStringOrNull(data?.url),
            source: asStringOrNull(data?.source),
            urlHash: asStringOrNull(data?.urlHash),
            key: asStringOrNull(data?.key) ?? asStringOrNull(data?.referenceImage),
            referenceImage: asStringOrNull(data?.referenceImage),
            html: asStringOrEmpty(data?.html),
            status: normalizeRenderStatus(data?.status),
            reason: asStringOrNull(data?.reason),
            nameHint: asStringOrNull(data?.nameHint),
            archived: data?.archived ?? false,
            createdAt: data?.createdAt,
            updatedAt: data?.updatedAt,
            siteConfigId: asStringOrUndefined(data?.siteConfigId),
            model: asStringOrNull(data?.model),
            version: data?.version ?? null,
            controllerVersion: asStringOrNull(data?.controllerVersion),
            lastExportedAt: data?.lastExportedAt ?? null,
            vercelProjectId: asStringOrNull(data?.vercelProjectId),
            vercelProjectName: asStringOrNull(data?.vercelProjectName),
            lastDeployUrl: asStringOrNull(data?.lastDeployUrl),
            seoMetaByPage: data?.seoMetaByPage ?? null,
            progress:
                typeof data?.progress === "number"
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
        if (!user) {
            setRenders([]);
            return;
        }

        // When landing via a deep link (e.g. community remix -> /dashboard/view?render=...)
        // there may be no active URL context yet. In that case, keep any pinned render
        // rather than blanking the dashboard.
        if (!targetUrl || !isHttpUrl(targetUrl)) {
            if (!deepLinkRenderId) {
                setRenders([]);
            }
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
        }, (err) => {
            console.warn("[firestore] renders snapshot failed", err);
            const code = String((err as any)?.code || "").toLowerCase();
            if (code.includes("permission-denied")) {
                void handleSessionExpired("renders_snapshot_permission_denied");
            }
            setRenders([]);
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
        optimisticByKey,
        lockUntilByKey,
        handleSessionExpired,
    ]);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            if (!user) return;
            if (!deepLinkRenderId) return;

            try {
                const renderRef = doc(db, "kloner_users", user.uid, "kloner_renders", deepLinkRenderId);
                const snap = await getDoc(renderRef);
                if (!snap.exists()) return;
                const data = snap.data() as any;
                const mapped = mapRenderData(snap.id, data);

                if (cancelled) return;
                setRenders((prev) => {
                    if (prev.some((r) => r.id === mapped.id)) return prev;
                    return [mapped, ...prev].slice(0, 100);
                });
            } catch (err) {
                console.warn("[dashboard] failed to load deep-linked render", err);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [user, deepLinkRenderId]);

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

    const retryTrackedUrl = useCallback(
        (rawUrl: string) => {
            const normalized = validateAndNormalizePublicHttpUrl(rawUrl || "");
            if (!normalized) {
                setErr("That saved URL looks invalid. Delete it from the list to continue.");
                return;
            }
            if (!canUseScreenshotCredit()) {
                setErr("You have used all monthly screenshot credits. Upgrade to capture more pages and monitor more sites.");
                setInfo("");
                push("You have used all available screenshot credits for this month.", "warn");
                setShowCreditsPaywall("screenshot");
                return;
            }
            setErr("");
            setInfo("");
            setSuccess("");
            setCaptureIssueNotice("");
            setHideCaptureQueueStatus(false);
            setDismissedUrlIssueCanonical("");
            setUrlMenuOpen(false);
            router.push(`/dashboard/view?u=${encodeURIComponent(normalized)}&start=1`, { scroll: false });
        },
        [canUseScreenshotCredit, push, router]
    );

    const isBackendFetchFailed502 = useCallback((status: number, payload: any): boolean => {
        if (status !== 502) return false;
        const msg = String(payload?.error || "").toLowerCase();
        return msg.includes("backend fetch failed");
    }, []);

    const recoverFromTransientRenderStart = useCallback(
        (label: string) => {
            push(
                `${label} is taking a little longer. We are still checking for progress in the background.`,
                "warn",
            );
            void refreshRenders();
            window.setTimeout(() => {
                void refreshRenders();
            }, 1200);
            window.setTimeout(() => {
                void refreshRenders();
            }, 3500);
        },
        [push, refreshRenders],
    );

    const buildFromCollection = useCallback(
        async (storageKeys: string[]) => {
            if (!user) return;
            if (!storageKeys.length) return;

            const primaryKey = storageKeys[0];
            const clearOptimisticWebsiteState = () => {
                setRenders((prev) => prev.filter((render) => render.id !== optimisticId));
                setOptimisticByKey((prev) => {
                    const next = { ...prev };
                    delete next[primaryKey];
                    return next;
                });
                setPendingByKey((prev) => {
                    const next = { ...prev };
                    delete next[primaryKey];
                    return next;
                });
                setLockUntilByKey((prev) => {
                    const next = { ...prev };
                    delete next[primaryKey];
                    return next;
                });
                setLockUntilByRender((prev) => {
                    const next = { ...prev };
                    delete next[optimisticId];
                    return next;
                });
            };

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
                    "You have used all available preview credits for this month.",
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
                nameHint: isHttpUrl(targetUrl) ? new URL(targetUrl).hostname : null,
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
                    body.nameHint = isHttpUrl(targetUrl) ? new URL(targetUrl).hostname : undefined;
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

                const blockedByTier =
                    r.status === 403 ||
                    String(j?.code || j?.reason || "").toLowerCase().includes("tier_blocked") ||
                    isGenerationTierBlockedMessage(String(j?.error || ""));

                if (blockedByTier) {
                    clearOptimisticWebsiteState();
                    setDeployWizardError(null);
                    setErr("");
                    showWebsiteExitOfferPaywall();
                    push("Upgrade to Pro or Agency to create websites or apps from the dashboard.", "warn");
                    return;
                }

                if (isBackendFetchFailed502(r.status, j)) {
                    setDeployWizardError("Collection preview start is delayed. Checking for progress…");
                    recoverFromTransientRenderStart("Collection preview start");
                    return;
                }

                if (!r.ok || !j?.ok) {
                    const msg = j?.error || "Render failed";
                    clearOptimisticWebsiteState();
                    setDeployWizardError(msg);
                    throw new Error(msg);
                }

                await refreshRenders();
            } catch (e: any) {
                const msg = e?.message || "Failed to start collection preview.";

                if (isGenerationTierBlockedMessage(msg)) {
                    clearOptimisticWebsiteState();
                    setDeployWizardError(null);
                    setErr("");
                    showWebsiteExitOfferPaywall();
                    push("Upgrade to Pro or Agency to create websites or apps from the dashboard.", "warn");
                    return;
                }

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
            setRenders,
            setOptimisticByKey,
            setPendingByKey,
            setLockUntilByKey,
            setLockUntilByRender,
        ],
    );

    const buildFromUrl = useCallback(async () => {
        if (!user) return;
        if (!targetUrl || !isHttpUrl(targetUrl)) {
            push("Enter a valid URL first.", "err");
            return;
        }

        if (activeUrlCannotGenerate) {
            const msg = "This URL scan failed and cannot be used to create websites. Retry scan or choose a different URL.";
            setErr(msg);
            push(msg, "warn");
            return;
        }

        if (!canUsePreviewCredit()) {
            push(
                "You have used all available preview credits for this month on this plan.",
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
                        return isHttpUrl(targetUrl) ? new URL(targetUrl).hostname : "";
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

            if (
                r.status === 403 &&
                (isGenerationTierBlockedMessage(String(j?.error || "")) ||
                    String(j?.code || j?.reason || "").toLowerCase().includes("tier_blocked"))
            ) {
                setErr("");
                showWebsiteExitOfferPaywall();
                push("Upgrade to Pro or Agency to create websites or apps from the dashboard.", "warn");
                return;
            }

            if (isBackendFetchFailed502(r.status, j)) {
                recoverFromTransientRenderStart("Website generation");
                return;
            }

            if (!r.ok || !j?.ok) {
                throw new Error(j?.error || "Render failed");
            }

            await refreshRenders();
        } catch (e: any) {
            console.error("buildFromUrl failed", e);
            if (isGenerationTierBlockedMessage(e?.message || "")) {
                setErr("");
                showWebsiteExitOfferPaywall();
                return;
            }
            push(e?.message || "Failed to start website generation.", "err");
        }
    }, [
        user,
        targetUrl,
        activeUrlCannotGenerate,
        canUsePreviewCredit,
        push,
        refreshRenders,
        isBackendFetchFailed502,
        recoverFromTransientRenderStart,
        setErr,
        showWebsiteExitOfferPaywall,
    ]);

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

                if (isBackendFetchFailed502(resp.status, j)) {
                    recoverFromTransientRenderStart("Retry");
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
        [user, renders, refreshRenders, setRenders, setErr, push, isBackendFetchFailed502, recoverFromTransientRenderStart],
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
                (isHttpUrl(targetUrl) ? new URL(targetUrl).hostname : null);

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

            // If the user was in the *App Deploy* wizard when they connected Vercel,
            // resume that flow even if the callback landed on the legacy `vercel=connected` param.
            // This protects against older return URLs and cross-flow connects.
            let pendingAppDeploy:
                | { appId?: string | null; appName?: string | null; startedAt?: number | null }
                | null = null;
            try {
                const raw = localStorage.getItem("kloner_vercel_pending_app_deploy");
                if (raw) pendingAppDeploy = JSON.parse(raw);
            } catch {
                pendingAppDeploy = null;
            }

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

            const flow = searchParams.get("flow") || "";
            const appIdFromQuery = searchParams.get("appId");
            const appDeployWizardHasId = !!appDeployWizardAppId;
            const isAppDeployFlow =
                (appDeployWizardOpen && appDeployWizardHasId) ||
                flow === "appDeploy" ||
                !!pendingAppDeploy?.appId;

            if (isAppDeployFlow) {
                const nextAppId =
                    (typeof pendingAppDeploy?.appId === "string" && pendingAppDeploy.appId) ||
                    (appDeployWizardHasId ? appDeployWizardAppId : null) ||
                    (flow === "appDeploy" && typeof appIdFromQuery === "string" ? appIdFromQuery : null) ||
                    null;

                if (nextAppId) {
                    const nextAppName =
                        (typeof pendingAppDeploy?.appName === "string" && pendingAppDeploy.appName) ||
                        appDeployWizardAppName ||
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

                    // Clean up callback params so refresh/back doesn't re-run.
                    try {
                        const url = new URL(window.location.href);
                        const params = url.searchParams;
                        params.delete("vercel");
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
            }

            // If we were connecting Vercel from App Builder preview, restore that overlay.
            let pendingApp: { appId?: string } | null = null;
            try {
                const raw = localStorage.getItem("kloner_vercel_pending_app_preview");
                if (raw) pendingApp = JSON.parse(raw);
            } catch {
                pendingApp = null;
            }

            if (pendingApp?.appId) {
                openAppBuilderWithCookieGate(pendingApp.appId);
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

            // Clean up callback param so refresh/back doesn't re-run.
            try {
                const url = new URL(window.location.href);
                const params = url.searchParams;
                params.delete("vercel");
                const qs = params.toString();
                const next = qs ? `${url.pathname}?${qs}` : url.pathname;
                router.replace(next, { scroll: false });
            } catch {
                // ignore
            }

            try {
                localStorage.removeItem("kloner_vercel_pending_deploy");
            } catch {
                // ignore
            }
        })();
    }, [
        searchParams,
        refreshVercelStatus,
        refreshUserTierNow,
        router,
        appDeployWizardOpen,
        appDeployWizardAppId,
        appDeployWizardAppName,
    ]);

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

    const shouldHighlightCreateWebsiteCta = useMemo(() => {
        const normalizedTarget = validateAndNormalizePublicHttpUrl(targetUrl || "");
        const targetCanonical = normalizedTarget ? normUrl(normalizedTarget) : "";
        const isCurrentUrlSuccessfullyScanned =
            !!targetCanonical && successfulScannedUrls.some((u) => normUrl(u) === targetCanonical);

        if (!isCurrentUrlSuccessfullyScanned) return false;

        const isDev = process.env.NODE_ENV !== "production";
        if (isDev) return true;

        return !hasAnyRenderDoc && !hasAnyAppDoc;
    }, [hasAnyAppDoc, hasAnyRenderDoc, successfulScannedUrls, targetUrl]);

    const forceTrialPromptInDev = process.env.NODE_ENV !== "production";
    const isFreeTierNotTrialing = userTier === "free" && stripeStatus !== "trialing";

    useEffect(() => {
        const wasOpen = previousEditorOpenRef.current;
        if (editorOpen && !wasOpen) {
            const eligible = forceTrialPromptInDev
                ? true
                : shouldShowTrialPromptForSession(
                    RENDER_TRIAL_SESSION_STORAGE_KEY,
                    FIRST_GEN_TRIAL_SESSION_INTERVAL,
                );
            setRenderTrialSessionEligible(eligible);
        }
        if (!editorOpen && wasOpen) {
            setRenderTrialSessionEligible(false);
        }
        previousEditorOpenRef.current = editorOpen;
    }, [editorOpen, forceTrialPromptInDev]);

    useEffect(() => {
        const wasOpen = previousAppBuilderOpenRef.current;
        if (appBuilderOpen && !wasOpen) {
            const eligible = forceTrialPromptInDev
                ? true
                : shouldShowTrialPromptForSession(
                    APP_BUILDER_TRIAL_SESSION_STORAGE_KEY,
                    FIRST_GEN_TRIAL_SESSION_INTERVAL,
                );
            setAppBuilderTrialSessionEligible(eligible && !firstGenerationTrialPromptShown);
        }
        if (!appBuilderOpen && wasOpen) {
            setAppBuilderTrialSessionEligible(false);
        }
        previousAppBuilderOpenRef.current = appBuilderOpen;
    }, [appBuilderOpen, forceTrialPromptInDev, firstGenerationTrialPromptShown]);

    const markFirstGenerationTrialPromptAsShown = useCallback(
        async (source: "kloner_app" | "kloner_render") => {
            if (!user || forceTrialPromptInDev) return;
            try {
                await setDoc(
                    doc(db, "kloner_users", user.uid),
                    {
                        offers: {
                            firstGenerationTrialPromptShown: true,
                            firstGenerationTrialPromptSource: source,
                            firstGenerationTrialPromptShownAt: serverTimestamp(),
                        },
                    },
                    { merge: true },
                );
            } catch (err) {
                console.warn("[billing] failed to persist first-generation trial prompt flag", err);
            }
        },
        [user, forceTrialPromptInDev],
    );

    const firstGenerationTrialCandidate = useMemo<"kloner_render" | null>(() => {
        if (!user) return null;
        if (!isFreeTierNotTrialing) return null;
        if (!forceTrialPromptInDev && !renderTrialSessionEligible) return null;

        const activeReadyRenders = renders.filter((r) => !r.archived && r.status === "ready");

        const renderEligible =
            editorOpen &&
            editorMode === "website" &&
            !deployWizardOpen &&
            activeReadyRenders.length === 1;
        if (renderEligible) return "kloner_render";

        return null;
    }, [
        user,
        isFreeTierNotTrialing,
        forceTrialPromptInDev,
        renderTrialSessionEligible,
        editorOpen,
        editorMode,
        deployWizardOpen,
        renders,
    ]);

    useEffect(() => {
        if (!firstGenerationTrialCandidate) return;
        if (showFirstGenerationTrialPopup) return;

        const openPrompt = () => {
            setShowFirstGenerationTrialPopup(true);
            setFirstGenerationTrialPromptShown(true);
            void markFirstGenerationTrialPromptAsShown(firstGenerationTrialCandidate);
        };

        // Require a dwell window so the trial prompt does not feel instant/spammy.
        const dwellTimer = window.setTimeout(openPrompt, FIRST_GEN_TRIAL_OBSERVE_MS);

        return () => {
            window.clearTimeout(dwellTimer);
        };
    }, [
        firstGenerationTrialCandidate,
        showFirstGenerationTrialPopup,
        markFirstGenerationTrialPromptAsShown,
    ]);

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

    const showDevUrlScreenshots = process.env.NODE_ENV === "development";
    const DEV_URL_SCREENSHOT_PREVIEW_LIMIT = 12;
    const devUrlScreenshotPreviews = shots.slice(0, DEV_URL_SCREENSHOT_PREVIEW_LIMIT);

    const showUrlAccessInError = useMemo(() => {
        if (!err) return false;
        return /not able to process this url|url failed to process/i.test(err);
    }, [err]);

    const safeErrorUrl = useMemo(() => {
        if (!showUrlAccessInError) return "";
        const normalized = validateAndNormalizePublicHttpUrl(targetUrl || "");
        return normalized ? normUrl(normalized) : "";
    }, [showUrlAccessInError, targetUrl]);

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

    async function fetchWithTimeout(
        input: RequestInfo | URL,
        init: RequestInit,
        timeoutMs = CHECKOUT_FETCH_TIMEOUT_MS,
    ): Promise<Response> {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(input, { ...init, signal: controller.signal });
        } finally {
            clearTimeout(t);
        }
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
    const [showAppExitOffer, setShowAppExitOffer] = useState(false);
    const [appExitOfferReason, setAppExitOfferReason] = useState<
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
    const allowOfferInDev = process.env.NODE_ENV !== "production";
    const canUseExitOffer = step5SaleActive && (allowOfferInDev || !exitOfferClaimed);
    const websitePaywallShowcaseImages = [
        "/images/showcase/showcase1.jpg",
        "/images/showcase/showcase2.jpg",
        "/images/showcase/showcase3.jpg",
        "/images/showcase/showcase4.jpg",
        "/images/showcase/showcase5.jpg",
        "/images/showcase/mobile_showcase2.jpg",
    ];

    const websitePrePaywallBenefits = [
        {
            value: '01',
            title: '40+ site generations/mo',
            metric: 'Included',
            text: 'Build and publish more pages without running out of runs.',
        },
        {
            value: '02',
            title: 'AI Agent for app tasks',
            metric: 'Included',
            text: 'Use AI to handle small changes, fixes, and build tasks.',
        },
        {
            value: '03',
            title: 'Editor for design tweaks',
            metric: 'Included',
            text: 'Make quick visual updates without rebuilding from scratch.',
        },
        {
            value: '04',
            title: '24/7 support',
            metric: 'Included',
            text: 'Get help anytime you need it.',
        },
    ];

    function openExitOffer(reason: NonNullable<typeof exitOfferReason>) {
        if (!canUseExitOffer) {
            closeDeployWizard();
            return;
        }
        setExitOfferReason(reason);
        setShowExitOffer(true);
    }

    function openAppExitOffer(reason: NonNullable<typeof appExitOfferReason>) {
        if (!canUseExitOffer) {
            closeAppDeployWizard();
            return;
        }
        setAppExitOfferReason(reason);
        setShowAppExitOffer(true);
    }

    function showWebsiteExitOfferPaywall() {
        setShowCreditsPaywall(null);
        setShowProPaywall(false);
        setShowAppExitOffer(false);
        setShowExitOffer(false);
        setAppWizardOpen(false);
        setAppWizardBusy(false);
        setAppWizardError(null);
        setShowWebsitePrePaywall(true);
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

                const csrfRes = await fetchWithTimeout("/api/auth/csrf", {
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

                const res = await fetchWithTimeout("/api/billing/create-checkout-session", {
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
                    void showAlert(data?.error || "Unable to start checkout.", "Checkout Error");
                    return;
                }

                window.location.href = data.url;
            } catch (err) {
                console.error("startProCheckout failed", err);
                void showAlert(
                    "Checkout is taking too long. Please try again in a few seconds.",
                    "Checkout Error",
                );
            } finally {
                setCheckoutBusy(false);
            }
        },
        [checkoutBusy, deployWizardRenderId, deployWizardProjectName, step5SaleEndsAt, showAlert],
    );

    const startProCheckoutForAppDeploy = useCallback(
        async (opts?: {
            exitOffer?: boolean;
            exitOfferReason?: "close" | "back" | "nav" | "outside" | "esc";
            returnAppId?: string | null;
        }) => {
            if (checkoutBusy) return;
            setCheckoutBusy(true);

            try {
                const checkoutReturnAppId =
                    (typeof opts?.returnAppId === "string" && opts.returnAppId.trim()) ||
                    appDeployWizardAppId ||
                    currentAppId ||
                    null;

                if (!checkoutReturnAppId) {
                    void showAlert(
                        "We couldn’t determine which app you’re deploying. Close this modal and click Deploy again, then retry.",
                        "Checkout",
                    );
                    return;
                }

                const csrfRes = await fetchWithTimeout("/api/auth/csrf", {
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

                const res = await fetchWithTimeout("/api/billing/create-checkout-session", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        plan: "pro",
                        returnAppId: checkoutReturnAppId,
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
                    void showAlert(data?.error || "Unable to start checkout.", "Checkout Error");
                    return;
                }

                window.location.href = data.url;
            } catch (err) {
                console.error("startProCheckoutForAppDeploy failed", err);
                void showAlert(
                    "Checkout is taking too long. Please try again in a few seconds.",
                    "Checkout Error",
                );
            } finally {
                setCheckoutBusy(false);
            }
        },
        [checkoutBusy, appDeployWizardAppId, currentAppId, step5SaleEndsAt, showAlert],
    );


    return (
        <main className="min-h-screen bg-white notranslate" translate="no">
            {checkoutBusy ? (
                <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-3 rounded-3xl border border-white/10 bg-neutral-950/95 px-6 py-5 text-center text-white shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
                        <Loader2 className="h-6 w-6 animate-spin text-[#f55f2a]" />
                        <div>
                            <p className="text-sm font-semibold">Opening secure Stripe checkout...</p>
                            <p className="mt-1 text-xs text-neutral-300">Please wait while we prepare your session.</p>
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-8">
                <section className="mb-10">
                    <MiniDashboardEntry
                        onSubmitUrl={submitMiniUrl}
                        onSubmitPrompt={submitMiniPrompt}
                        planLabel={planLabel}
                        userTier={userTier}
                        screenshotRemaining={screenshotRemaining}
                        screenshotLimitDisplay={screenshotLimitDisplay}
                        previewRemaining={previewRemaining}
                        previewLimitDisplay={previewLimitDisplay}
                        editRemaining={editRemaining}
                        editLimitDisplay={editLimitDisplay}
                        onManagePlan={() => {
                            void startProCheckout();
                        }}
                        size="compact"
                        disabled={captureLocked}
                        captureStatus={captureStatus}
                        captureIssueNotice={captureIssueNotice}
                        hideCaptureQueueStatus={hideCaptureQueueStatus}
                    />
                </section>

                {/* Step 1: URL selection */}
                <section className="mb-8 rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 shadow-sm px-4 py-4 sm:px-5 sm:py-5 shadow-sm">
                    <div ref={urlMenuRef} className="relative">
                        <button
                            type="button"
                            onClick={() => setUrlMenuOpen((v) => !v)}
                            className="flex w-full min-w-0 sm:inline-flex sm:w-auto sm:max-w-[540px] items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
                            title={activeUrlDoc?.url}
                            aria-haspopup="listbox"
                            aria-expanded={urlMenuOpen}
                        >
                            <span className="flex-1 min-w-0 truncate">
                                {activeUrlDoc?.url || "Select a URL"}
                            </span>
                            <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500" />
                        </button>

                        {urlMenuOpen && (
                            <div
                                role="listbox"
                                aria-activedescendant={activeUrlDoc?.id ? String(activeUrlDoc.id) : undefined}
                                className="absolute left-0 z-[300] mt-2 w-[min(640px,calc(100vw-2rem))] max-w-full overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg"
                            >
                                <ul className="max-h-[280px] overflow-auto py-1">
                                    {orderedUrls.map((u) => {
                                        const isActive = activeUrlDoc?.id === u.id;
                                        const normalized = validateAndNormalizePublicHttpUrl(u.url);
                                        const isValid = !!normalized;
                                        const rowCanonical = normalized ? normUrl(normalized) : "";
                                        const targetCanonical = targetUrl ? normUrl(targetUrl) : "";
                                        const isSelectedTargetRow = !!rowCanonical && !!targetCanonical && rowCanonical === targetCanonical;
                                        const rowStatusSource: any = isSelectedTargetRow && docData
                                            ? {
                                                status: docData.status,
                                                screenshotPaths: docData.screenshotPaths,
                                                screenshots: docData.screenshots,
                                                updatedAt: docData.updatedAt,
                                                lastError: (docData as any)?.lastError,
                                            }
                                            : u;
                                        const statusUi = normalizeUrlStatus(
                                            rowStatusSource?.status,
                                            (Array.isArray(rowStatusSource?.screenshotPaths) ? rowStatusSource.screenshotPaths.length : 0) +
                                            (Array.isArray(rowStatusSource?.screenshots) ? rowStatusSource.screenshots.length : 0),
                                            rowStatusSource?.updatedAt,
                                            rowStatusSource?.lastError,
                                        );
                                        const isFailedUrl = statusUi === "error" || statusUi === "stale";

                                        return (
                                            <li key={u.id}>
                                                <div
                                                    className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${isActive
                                                        ? "bg-neutral-100 text-neutral-700"
                                                        : "text-neutral-800 hover:bg-neutral-50"
                                                        }`}
                                                >
                                                    <button
                                                        type="button"
                                                        role="option"
                                                        aria-selected={isActive}
                                                        onClick={() => {
                                                            if (!normalized) {
                                                                setUrlMenuOpen(false);
                                                                setErr(
                                                                    "That saved URL looks invalid. Delete it from the list to continue."
                                                                );
                                                                return;
                                                            }
                                                            setErr("");
                                                            setUrlMenuOpen(false);
                                                            selectUrl(normalized);
                                                        }}
                                                        title={u.url}
                                                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                                    >
                                                        <span
                                                            className={`inline-block h-2.5 w-2.5 rounded-full ${isActive
                                                                ? "bg-neutral-800"
                                                                : "bg-neutral-300"
                                                                }`}
                                                        />
                                                        <span className="min-w-0 truncate">
                                                            {u.url}
                                                        </span>
                                                        {!isValid ? (
                                                            <span className="ml-2 shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                                                                Invalid
                                                            </span>
                                                        ) : isFailedUrl ? (
                                                            <span className="ml-2 shrink-0 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                                                <MessageCircleWarning className="h-3 w-3" />
                                                                {statusUi === "stale" ? "Stale" : "Failed"}
                                                            </span>
                                                        ) : null}
                                                    </button>

                                                    {isValid && isFailedUrl ? (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                retryTrackedUrl(u.url);
                                                            }}
                                                            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 text-amber-700 hover:bg-amber-100"
                                                            title="Retry scanning URL"
                                                            aria-label={`Retry scanning ${u.url}`}
                                                        >
                                                            <RotateCcw className="h-3.5 w-3.5" />
                                                            <span className="text-[11px] font-semibold">Retry</span>
                                                        </button>
                                                    ) : null}

                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            deleteTrackedUrl(u);
                                                        }}
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-500/80 transition hover:bg-red-50 hover:text-red-700 focus-visible:bg-red-50 focus-visible:text-red-700"
                                                        title="Delete tracked URL"
                                                        aria-label={`Delete ${u.url}`}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}
                    </div>
                </section>

                {showActiveUrlIssueWarning && activeUrlDoc?.url ? (
                    <div className="mt-2 flex items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        <div className="min-w-0 flex-1">
                            <div className="inline-flex items-center gap-1.5 font-semibold text-amber-900">
                                <MessageCircleWarning className="h-3.5 w-3.5" />
                                URL scan issue detected
                            </div>
                            <p className="mt-1 text-xs text-amber-800">
                                This URL cannot be used to create websites from until a successful scan completes.
                            </p>
                            {activeUrlIssueHref ? (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <span
                                        className="inline-flex max-w-full items-center rounded-md border border-amber-200 bg-white px-2 py-1 font-mono text-[11px] text-amber-900"
                                        title={activeUrlIssueHref}
                                    >
                                        {truncateMiddle(activeUrlIssueHref, 76)}
                                    </span>
                                    <a
                                        href={activeUrlIssueHref}
                                        target="_blank"
                                        rel="noopener noreferrer nofollow"
                                        className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
                                        title="Open URL in a new tab"
                                    >
                                        <span>Open URL</span>
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </div>
                            ) : null}
                        </div>
                        <div className="flex shrink-0 items-start gap-2">
                            <button
                                type="button"
                                onClick={() => retryTrackedUrl(activeUrlDoc.url)}
                                className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                                title="Retry scanning this URL"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setDismissedUrlIssueCanonical(activeUrlIssueHref || "")}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 bg-white/80 text-amber-700 transition hover:bg-white hover:text-amber-900"
                                aria-label="Dismiss URL scan issue warning"
                                title="Dismiss"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                ) : null}

                {err && !showActiveUrlIssueWarning && !(showUrlAccessInError && activeUrlCannotGenerate) ? (
                    <div className="mt-2 flex items-start justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                        <div className="min-w-0 flex-1">
                            <span>{err}</span>
                            {safeErrorUrl ? (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <span
                                        className="inline-flex max-w-full items-center rounded-md border border-red-200 bg-white px-2 py-1 font-mono text-[11px] text-red-800"
                                        title={safeErrorUrl}
                                    >
                                        {truncateMiddle(safeErrorUrl, 76)}
                                    </span>
                                    <a
                                        href={safeErrorUrl}
                                        target="_blank"
                                        rel="noopener noreferrer nofollow"
                                        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                                        title="Open URL in a new tab"
                                    >
                                        <span>Open URL</span>
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </div>
                            ) : null}
                        </div>
                        <button
                            type="button"
                            onClick={() => setErr("")}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-red-200 bg-white/70 text-red-600 transition hover:bg-white hover:text-red-700"
                            aria-label="Dismiss error"
                            title="Dismiss"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ) : null}

                {success ? (
                    <div className="mt-2 flex items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        <div className="flex min-w-0 items-start gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            <span>{success}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setSuccess("")}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white/70 text-emerald-700 transition hover:bg-white hover:text-emerald-800"
                            aria-label="Dismiss success message"
                            title="Dismiss"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ) : null}

                {info ? (
                    <div
                        className={
                            "mt-2 rounded-md px-3 py-2 text-sm " +
                            (isDuplicateUrlConfirmationMessage(info)
                                ? "border border-amber-300 bg-amber-50 text-amber-800"
                                : "border border-neutral-300 bg-neutral-50 text-neutral-800")
                        }
                    >
                        {info}
                    </div>
                ) : null}

                {showDevUrlScreenshots && targetUrl ? (
                    <section className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-3 py-3 sm:px-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                                    Dev Only
                                </p>
                                <p className="text-sm font-medium text-neutral-800">
                                    URL screenshots for {targetUrl}
                                </p>
                            </div>
                            <span className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700">
                                {shots.length} screenshot{shots.length === 1 ? "" : "s"}
                            </span>
                        </div>

                        {devUrlScreenshotPreviews.length > 0 ? (
                            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                                {devUrlScreenshotPreviews.map((shot, index) => (
                                    <button
                                        key={shot.path}
                                        type="button"
                                        onClick={() => openViewer(index)}
                                        className="group overflow-hidden rounded-lg border border-neutral-200 bg-white text-left shadow-sm transition hover:border-neutral-300 hover:shadow"
                                        title={shot.fileName}
                                    >
                                        <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-100">
                                            <Image
                                                src={shot.url}
                                                alt={shot.fileName}
                                                fill
                                                sizes="(min-width: 1280px) 180px, (min-width: 768px) 25vw, 50vw"
                                                className="object-cover transition duration-200 group-hover:scale-[1.02]"
                                            />
                                        </div>
                                        <div className="truncate px-2 py-1.5 text-[11px] text-neutral-700">
                                            {shot.fileName}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-3 text-xs text-neutral-600">
                                {loading || captureStatus === "queued" || captureStatus === "processing"
                                    ? "Waiting for screenshots to be captured for this URL..."
                                    : "No screenshots found yet for this URL."}
                            </p>
                        )}

                        {shots.length > DEV_URL_SCREENSHOT_PREVIEW_LIMIT ? (
                            <p className="mt-2 text-[11px] text-neutral-500">
                                Showing first {DEV_URL_SCREENSHOT_PREVIEW_LIMIT} screenshots. Use the viewer arrows to browse more.
                            </p>
                        ) : null}
                    </section>
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
                                className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                                aria-label="Editable previews list"
                            >
                                {groupedShots.length === 0 ? (
                                    <GhostGeneratePreviewCard
                                        locked={captureLocked}
                                        lockedSinceMs={captureLockStartedAtRef.current || null}
                                        sourceUrl={targetUrl}
                                        sourceUrlCannotGenerate={activeUrlCannotGenerate}
                                        highlight={shouldHighlightCreateWebsiteCta}
                                        autoOpenNonce={autoOpenGenerateModalNonce}
                                        autoOpenSuccessMessage={autoOpenGenerateSuccessMessage}
                                        onAutoOpenMessageDismiss={() => setAutoOpenGenerateSuccessMessage("")}
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
                                            // Go straight to the App Builder editor.
                                            void startNextJsAppBuilder(targetUrl || "");
                                        }}
                                        onCancelLocked={cancelQueuedCapture}
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
                                                locked={captureLocked || locked}
                                                lockedSinceMs={captureLockStartedAtRef.current || null}
                                                sourceUrl={targetUrl}
                                                sourceUrlCannotGenerate={activeUrlCannotGenerate}
                                                highlight={shouldHighlightCreateWebsiteCta}
                                                autoOpenNonce={autoOpenGenerateModalNonce}
                                                autoOpenSuccessMessage={autoOpenGenerateSuccessMessage}
                                                onAutoOpenMessageDismiss={() => setAutoOpenGenerateSuccessMessage("")}
                                                onClick={() => buildFromCollection(collectionKeys)}
                                                onAppClick={() => {
                                                    void startNextJsAppBuilder(targetUrl || "");
                                                }}
                                                onCancelLocked={cancelQueuedCapture}
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
                                            openAppBuilderWithCookieGate(appId);
                                        }}
                                        onArchive={handleArchiveApp}
                                        onRename={handleRenameAppCard}
                                        onDeploy={(app) => openAppDeployWizard(app)}
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
                                            const locked = captureLocked;
                                            return (
                                                <GhostGeneratePreviewCard
                                                    locked={locked}
                                                    lockedSinceMs={captureLockStartedAtRef.current || null}
                                                    sourceUrl={targetUrl}
                                                    sourceUrlCannotGenerate={activeUrlCannotGenerate}
                                                    highlight={shouldHighlightCreateWebsiteCta}
                                                    autoOpenNonce={autoOpenGenerateModalNonce}
                                                    autoOpenSuccessMessage={autoOpenGenerateSuccessMessage}
                                                    onAutoOpenMessageDismiss={() => setAutoOpenGenerateSuccessMessage("")}
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
                                                        // Go straight to the App Builder editor.
                                                        void startNextJsAppBuilder(targetUrl || "");
                                                    }}
                                                    onCancelLocked={cancelQueuedCapture}
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
                                        onRenameRender={handleRenameRenderCard}
                                    />

                                ))}

                                {apps.map((app) => (
                                    <AppCard
                                        key={app.id}
                                        app={app}
                                        isDeleting={!!deletingApp[app.id]}
                                        isArchiving={!!archivingApp[app.id]}
                                        onCustomize={(appId) => {
                                            openAppBuilderWithCookieGate(appId);
                                        }}
                                        onArchive={handleArchiveApp}
                                        onRename={handleRenameAppCard}
                                        onDeploy={(app) => openAppDeployWizard(app)}
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
                                            locked={captureLocked || locked}
                                            lockedSinceMs={captureLockStartedAtRef.current || null}
                                            sourceUrl={targetUrl}
                                            sourceUrlCannotGenerate={activeUrlCannotGenerate}
                                            highlight={shouldHighlightCreateWebsiteCta}
                                            autoOpenNonce={autoOpenGenerateModalNonce}
                                            autoOpenSuccessMessage={autoOpenGenerateSuccessMessage}
                                            onAutoOpenMessageDismiss={() => setAutoOpenGenerateSuccessMessage("")}
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
                                                            void startNextJsAppBuilder(targetUrl || "");
                                            }}
                                            onCancelLocked={cancelQueuedCapture}
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
                        agentWelcomeContext={agentWelcomeContextByAppId[currentAppId]}
                        trialPromptEnabled={isFreeTierNotTrialing && !firstGenerationTrialPromptShown}
                        trialPromptSessionEligible={appBuilderTrialSessionEligible && !firstGenerationTrialPromptShown}
                        trialCheckoutBusy={checkoutBusy}
                        onTrialPromptShown={() => {
                            setFirstGenerationTrialPromptShown(true);
                            void markFirstGenerationTrialPromptAsShown("kloner_app");
                        }}
                        onTrialPromptStartCheckout={(appId) => {
                            void startProCheckoutForAppDeploy({ returnAppId: appId });
                        }}
                    />
                )}

                <AnimatePresence>
                    {appBuilderCookiePromptOpen && (
                        <motion.div
                            key="app-builder-cookie-wizard"
                            className="fixed inset-0 z-[18100]"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                                onClick={() => {
                                    resolveAppBuilderCookiePrompt(false);
                                }}
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
                                    <div className="p-5 pt-6">
                                        <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Final step</p>
                                        <p className="mt-1 text-lg font-semibold text-neutral-900">One quick cookie check</p>
                                        <p className="mt-2 text-sm text-neutral-600">
                                            To keep your preview connected, we need essential app cookies. No marketing cookies, just builder basics.
                                        </p>

                                        <div className="mt-4 flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    resolveAppBuilderCookiePrompt(false);
                                                }}
                                                className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                                            >
                                                Not now
                                            </button>
                                            <button
                                                type="button"
                                                onClick={acceptCookiesAndOpenAppBuilder}
                                                className="rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                                                style={{ backgroundColor: ACCENT }}
                                            >
                                                Accept and continue
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

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
                                                Start building now. Choose to clone from a URL or generate from a prompt. You can customize and deploy it live, all within our platform.
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAppWizardOpen(false);
                                                setAppWizardError(null);
                                                setAppWizardBusy(false);
                                            }}
                                            className="inline-flex h-9 w-9 min-h-9 min-w-9 shrink-0 aspect-square items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200"
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
                                        <div className="space-y-3">
                                            <div className="grid gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAppWizardSource("website");
                                                        setAppWizardPrompt("");
                                                        setAppWizardUrl((prev) => (prev || successfulScannedUrls[0] || ""));
                                                        setAppWizardShotsUrl((prev) => (prev || targetUrl || ""));
                                                    }}
                                                    className={`relative w-full rounded-xl border p-4 pb-14 text-left transition ${appWizardSource === "website"
                                                        ? "border-[#f55f2a] bg-[#f55f2a]/5"
                                                        : "border-neutral-200 bg-white hover:bg-neutral-50"
                                                        }`}
                                                >
                                                    <div className="text-sm font-semibold text-neutral-900">Clone from URL</div>
                                                    <div className="mt-1 text-xs text-neutral-600 break-all">
                                                        High-fidelity clone using your saved screenshots when available.
                                                    </div>
                                                    <div className="mt-2">
                                                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                                                            URL
                                                        </label>
                                                        <select
                                                            value={appWizardUrl || ""}
                                                            onChange={(e) => {
                                                                setAppWizardUrl(e.target.value);
                                                                setAppWizardError(null);
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
                                                            disabled={!successfulScannedUrls.length}
                                                            className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#f55f2a]/20"
                                                        >
                                                            <option value="" disabled>
                                                                {successfulScannedUrls.length
                                                                    ? "Select a scanned URL"
                                                                    : "No successfully scanned URLs yet"}
                                                            </option>
                                                            {successfulScannedUrls.map((u) => (
                                                                <option key={u} value={u}>
                                                                    {u}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <div className="mt-1 text-[11px] leading-4 text-neutral-500">
                                                            Only URLs with completed scans are listed.
                                                        </div>
                                                    </div>

                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setAppWizardSource("prompt")}
                                                    className={`relative w-full rounded-xl border p-4 pb-14 text-left transition ${appWizardSource === "prompt"
                                                        ? "border-[#f55f2a] bg-[#f55f2a]/5"
                                                        : "border-neutral-200 bg-white hover:bg-neutral-50"
                                                        }`}
                                                >
                                                    <div className="text-sm font-semibold text-neutral-900">Build from a prompt</div>
                                                    <div className="mt-1 text-xs text-neutral-600">Describe the app and we’ll generate the first version.</div>
                                                </button>
                                            </div>

                                            {appWizardSource === "prompt" ? (
                                                <div className="mt-2 space-y-2">
                                                    <label className="text-xs font-semibold text-neutral-700">
                                                        Prompt
                                                    </label>
                                                    <div className="relative rounded-2xl border border-neutral-200 bg-white/95 p-3 shadow-[0_10px_24px_rgba(0,0,0,0.07)] ring-1 ring-neutral-200/80 transition-all duration-300 ease-out">
                                                        <textarea
                                                            value={appWizardPrompt}
                                                            onChange={(e) => {
                                                                const nextPrompt = stripHttpsUrlsFromPrompt(e.target.value);
                                                                setAppWizardPrompt(nextPrompt);
                                                                setAppWizardError(null);
                                                            }}
                                                            onPaste={(e) => {
                                                                const pasted = e.clipboardData.getData("text");
                                                                if (!pasted) return;
                                                                e.preventDefault();
                                                                const nextPrompt = stripHttpsUrlsFromPrompt(pasted);
                                                                setAppWizardPrompt(nextPrompt);
                                                                setAppWizardError(null);
                                                            }}
                                                            onFocus={() => setAppWizardPromptFocused(true)}
                                                            onBlur={() => setAppWizardPromptFocused(false)}
                                                            rows={5}
                                                            className="relative z-[1] min-h-[124px] w-full resize-none bg-transparent text-sm font-medium leading-snug text-neutral-800 outline-none"
                                                            placeholder=""
                                                        />
                                                        {!appWizardPrompt.trim() ? (
                                                            <div
                                                                className={`pointer-events-none absolute inset-x-3 top-3 pr-1 text-left transition-opacity ${appWizardPromptFocused ? "opacity-60" : "opacity-100"}`}
                                                                aria-hidden
                                                            >
                                                                <AnimatePresence mode="wait">
                                                                    <motion.span
                                                                        key={appWizardPromptPlaceholderIdx}
                                                                        initial={{ opacity: 0, y: 6 }}
                                                                        animate={{ opacity: 1, y: 0 }}
                                                                        exit={{ opacity: 0, y: -6 }}
                                                                        transition={{ duration: 0.35, ease: "easeOut" }}
                                                                        className="block text-sm font-medium leading-snug text-neutral-400/90"
                                                                    >
                                                                        {PROMPT_PLACEHOLDERS[appWizardPromptPlaceholderIdx]}
                                                                    </motion.span>
                                                                </AnimatePresence>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    <div className="mt-1 flex items-center justify-between text-[11px]">
                                                        <span className={appWizardPromptOverLimit ? "text-red-600" : "text-neutral-500"}>
                                                            {appWizardPromptOverLimit
                                                                ? `Please shorten your prompt to ${APP_WIZARD_PROMPT_MAX_CHARS} characters.`
                                                                : "Keep it concise for best results."}
                                                        </span>
                                                        <span className={`tabular-nums ${appWizardPromptOverLimit ? "text-red-600 font-semibold" : "text-neutral-500"}`}>
                                                            {appWizardPromptLength}/{APP_WIZARD_PROMPT_MAX_CHARS}
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : null}

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
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (appWizardSource === "website") return void submitAppWizardWebsite();
                                                if (appWizardSource === "prompt") return void submitAppWizardPrompt();
                                                setAppWizardError("Select how you want to create your website to continue.");
                                            }}
                                            disabled={appWizardBusy || !appWizardSource || (appWizardSource === "prompt" && appWizardPromptOverLimit)}
                                            className="rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                                            style={{ backgroundColor: ACCENT }}
                                        >
                                            {appWizardBusy ? "Creating…" : "Continue"}
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
                                onClick={() => {
                                    if (appDeployWizardStep === 2) {
                                        openAppExitOffer("outside");
                                        return;
                                    }
                                    closeAppDeployWizard();
                                }}
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
                                                        {appDeployWizardAppName ? `Deploy ${appDeployWizardAppName}` : "Deploy your website"}
                                                    </p>
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (appDeployWizardStep === 2) {
                                                        openAppExitOffer("close");
                                                        return;
                                                    }
                                                    closeAppDeployWizard();
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
                                                                    openAppBuilderWithCookieGate(id);
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
                                                            Required to deploy your website live.
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
                                                                Upgrade to launch with one click
                                                            </p>
                                                            <p className="mt-1 text-xs text-neutral-600">
                                                                Build in Next.js 16 or ship a lightweight HTML site. Includes a 7-day trial.
                                                            </p>
                                                        </div>

                                                        <div className="flex items-center gap-1 text-[11px] text-neutral-600 shrink-0">
                                                            <span className="text-amber-500">★★★★★</span>
                                                            <span className="text-neutral-500">4.9</span>
                                                        </div>
                                                    </div>

                                                    {canUseExitOffer ? (
                                                        <div className="mt-3 inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-700">
                                                            Limited welcome offer ends in {step5Time.mm}:{step5Time.ss}
                                                        </div>
                                                    ) : null}

                                                    <div className="mt-4 space-y-2">
                                                        <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                            <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                ✓
                                                            </span>
                                                            <span className="leading-snug">Deploy Next.js 16 apps and static HTML websites</span>
                                                        </div>

                                                        <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                            <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                ✓
                                                            </span>
                                                            <span className="leading-snug">One-click publish from app builder or website editor</span>
                                                        </div>

                                                        <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                            <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                ✓
                                                            </span>
                                                            <span className="leading-snug">More monthly generation credits and faster queues</span>
                                                        </div>

                                                        <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                            <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                ✓
                                                            </span>
                                                            <span className="leading-snug">Priority support when you are ready to ship</span>
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
                                                    {checkoutBusy ? "Redirecting to Stripe…" : "Start 7-day trial & publish →"}
                                                </motion.button>

                                                <p className="-mt-1 text-center text-[11px] text-neutral-500">
                                                    Trial starts today. Cancel anytime before renewal.
                                                </p>

                                                <button
                                                    type="button"
                                                    onClick={() => openAppExitOffer("back")}
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
                                                            ? "Your website is live."
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
                                                            <span>View site</span>
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

                <AnimatePresence>
                    {showAppExitOffer && (
                        <motion.div
                            key="app-exit-offer"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[18120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
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
                                <div className="h-1 w-full" style={{ backgroundColor: ACCENT }} />

                                <div className="px-4 pb-4 pt-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
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

                                                {canUseExitOffer ? (
                                                    <span className="text-[11px] text-neutral-600">
                                                        Ends in {step5Time.mm}:{step5Time.ss}
                                                    </span>
                                                ) : null}
                                            </div>

                                            <div className="mt-6 text-center">
                                                <span className="text-[30px] font-semibold leading-none text-neutral-900">
                                                    Publish your app today
                                                </span>
                                            </div>

                                            <div className="mt-4 flex justify-center items-baseline gap-2">
                                                <span className="text-[28px] font-bold leading-none text-neutral-900">40% off</span>
                                                <span className="text-[12px] font-medium text-neutral-600">your first month</span>
                                            </div>

                                            <div className="mt-1 flex justify-center text-[12px] text-neutral-700 gap-1">
                                                <span className="font-medium">7-day trial + discount after trial</span>
                                            </div>

                                            <div className="my-5 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] text-neutral-700">
                                                Includes Next.js 16 app deploys, HTML website deploys, and higher generation credits.
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => setShowAppExitOffer(false)}
                                            aria-label="Close"
                                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-[18px] leading-none text-neutral-700 hover:bg-neutral-50"
                                            style={{ aspectRatio: "1 / 1" }}
                                        >
                                            ×
                                        </button>
                                    </div>

                                    <div className="mt-6">
                                        <motion.button
                                            type="button"
                                            onClick={() => {
                                                setShowAppExitOffer(false);
                                                void startProCheckoutForAppDeploy({
                                                    exitOffer: true,
                                                    exitOfferReason: appExitOfferReason || "close",
                                                    returnAppId: appDeployWizardAppId,
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
                                            Cancel anytime before renewal.
                                        </p>
                                    </div>

                                    <div className="mt-4 text-center">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowAppExitOffer(false);
                                                closeAppDeployWizard();
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
                                                        Name your Website. This becomes the base for your live URL and deployment.
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
                                                                    <span>View site</span>
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
                                                                Start 7-day trial
                                                            </div>

                                                            {/* headline */}
                                                            <h2 className="mt-3 text-[34px] font-bold leading-[1.05] text-neutral-900">
                                                                Publish apps and websites in one click
                                                            </h2>

                                                            {/* subcopy */}
                                                            <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">
                                                                Build with Next.js 16 or ship lightweight HTML pages, then deploy from the same dashboard.
                                                            </p>

                                                            {canUseExitOffer ? (
                                                                <p className="mt-2 text-[12px] font-semibold text-neutral-700">
                                                                    Limited welcome offer ends in {step5Time.mm}:{step5Time.ss}
                                                                </p>
                                                            ) : null}

                                                            {/* feature list */}
                                                            <div className="mt-5 space-y-3">
                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">Deploy Next.js 16 apps and static HTML websites</span>
                                                                </div>

                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">One-click publish from app builder and website editor</span>
                                                                </div>

                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">More monthly generation credits</span>
                                                                </div>

                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">Higher queue priority for faster outputs</span>
                                                                </div>


                                                                <div className="flex items-start gap-3 text-[14px] text-neutral-800">
                                                                    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] font-black text-blue-600">
                                                                        ✓
                                                                    </span>
                                                                    <span className="leading-snug">Priority support included</span>
                                                                </div>
                                                            </div>

                                                            {/* small secondary action */}
                                                            <div className="mt-6 text-center">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openExitOffer("close")}
                                                                    className="text-[12px] font-semibold text-neutral-500 hover:text-neutral-700"
                                                                >
                                                                    Not ready to deploy yet
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
                                                                    {checkoutBusy ? "Redirecting to Stripe…" : "Start 7-day trial & publish →"}
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
                                                                                    <span className="text-[28px] font-bold leading-none text-[#f55f2a]">40% off</span>
                                                                                    <span className="text-[12px] font-medium text-neutral-600">your first month + free trial</span>
                                                                                </div>
                                                                                {canUseExitOffer ? (
                                                                                    <div className="mt-1 flex justify-center text-[12px] text-neutral-700">
                                                                                        Offer expires in {step5Time.mm}:{step5Time.ss}
                                                                                    </div>
                                                                                ) : null}
                                                                                <div className="mt-1 flex text-[12px] justify-center text-neutral-700 gap-1">

                                                                                </div>
                                                                                <div className="mt-4 space-y-3">
                                                                                    {websitePrePaywallBenefits.map((item, index) => (
                                                                                        <div
                                                                                            key={item.value}
                                                                                            className="website-paywall-feature flex items-start gap-4 px-1 py-1"
                                                                                            style={{
                                                                                                animationDelay: `${index * 140}ms`,
                                                                                                ["--website-paywall-feature-delay" as string]: `${index * 140}ms`,
                                                                                            }}
                                                                                        >
                                                                                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(245,95,42,0.2)] text-[#f55f2a]">
                                                                                                <CheckCircle2 className="h-5 w-5" />
                                                                                            </div>
                                                                                            <div>
                                                                                                <p className="text-base font-semibold text-neutral-900 sm:text-[17px]">
                                                                                                    {item.title}
                                                                                                </p>
                                                                                                <p className="mt-0.5 text-sm font-semibold text-[rgba(245,95,42,1)]">
                                                                                                    {item.metric}
                                                                                                </p>
                                                                                                <p className="mt-1 text-sm leading-relaxed text-neutral-600">
                                                                                                    {item.text}
                                                                                                </p>
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
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
                                                                                {checkoutBusy ? "Redirecting to Stripe…" : "Start 7-day free trial & claim 40% off first month →"}
                                                                            </motion.button>

                                                                            <p className="mt-3 text-center text-[11px] text-neutral-500">
                                                                                Free for 7 days. Then 40% off your first month. Includes higher generation credits.
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

                {
                    showFirstGenerationTrialPopup && typeof document !== "undefined"
                        ? createPortal(
                            <motion.div
                                className="fixed inset-0 z-[25000]"
                                style={{ zIndex: 2147483647 }}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.2, ease: "easeOut" }}
                            >
                                <motion.div
                                    className="absolute inset-0 bg-black/65"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ duration: 0.2, ease: "easeOut" }}
                                />
                                <div className="absolute inset-0 flex items-center justify-center p-4">
                                    <motion.div
                                        className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-800 shadow-xl"
                                        initial={{ opacity: 0, y: 18, scale: 0.98 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        transition={{ duration: 0.24, ease: "easeOut" }}
                                    >
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <div className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-700">
                                                7-day free trial
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowFirstGenerationTrialPopup(false);
                                                }}
                                                disabled={checkoutBusy}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                aria-label="Close"
                                            >
                                                ×
                                            </button>
                                        </div>

                                        <h3 className="text-xl font-semibold text-neutral-900">
                                            Like what you built? Publish it live next.
                                        </h3>
                                        <p className="mt-2 text-sm text-neutral-600">
                                            Unlock Next.js 16 app deploys, HTML website deploys, and higher generation credits.
                                        </p>

                                        <ul className="mt-4 list-disc list-inside space-y-1 text-sm text-neutral-700">
                                            <li>7 days free, cancel anytime</li>
                                            <li>One-click deploy to live URL</li>
                                            <li>Higher monthly generation limits</li>
                                        </ul>

                                        <div className="mt-5 space-y-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    void startProCheckout();
                                                }}
                                                disabled={checkoutBusy}
                                                className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-80"
                                                style={{ backgroundColor: ACCENT }}
                                            >
                                                {checkoutBusy ? (
                                                    <span className="inline-flex items-center justify-center gap-2">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Redirecting to Stripe...
                                                    </span>
                                                ) : (
                                                    "Start free trial & publish →"
                                                )}
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowFirstGenerationTrialPopup(false);
                                                }}
                                                disabled={checkoutBusy}
                                                className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                Keep building for now
                                            </button>

                                            {checkoutBusy ? (
                                                <p className="text-center text-xs text-neutral-500">
                                                    Opening secure Stripe checkout...
                                                </p>
                                            ) : null}
                                        </div>
                                    </motion.div>
                                </div>
                            </motion.div>,
                            document.body,
                        )
                        : null
                }

                {/* generic paywall */}
                {
                    showCreditsPaywall && (
                        <div className="fixed inset-0 z-[12000]">
                            <div className="absolute inset-0 bg-black/60" />
                            <div className="absolute inset-0 flex items-center justify-center p-4">
                                <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl border border-neutral-200 p-6 pt-5 text-sm text-neutral-800">
                                    <button
                                        type="button"
                                        onClick={() => setShowCreditsPaywall(null)}
                                        className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition hover:bg-neutral-50 hover:text-neutral-700"
                                        aria-label="Close paywall"
                                        title="Close"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>

                                    <div className="flex items-center gap-2 mb-2 pr-10">
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
                                            "You have used all monthly generation credits. Upgrade to websites and unlock one-click deploy."}
                                        {showCreditsPaywall === "deploy" &&
                                            "To publish your app or website live, upgrade to unlock one-click deploy and higher monthly credits."}
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
                                    <div className="flex items-center justify-center">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowCreditsPaywall(null);
                                                void startProCheckout();
                                            }}
                                            className="inline-flex w-full max-w-sm items-center justify-center rounded-xl px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:opacity-90"
                                            style={{ backgroundColor: ACCENT }}
                                        >
                                            Claim free 7-day trial
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
                                            Upgrade to Pro to launch faster
                                        </h3>
                                    </div>
                                    <p className="text-sm text-neutral-600 mb-3">
                                        Pro unlocks Next.js 16 app generation, HTML website publishing, and higher monthly generation credits.
                                    </p>
                                    <ul className="mb-4 list-disc list-inside text-sm text-neutral-700 space-y-1">
                                        <li>Create and deploy Next.js 16 apps</li>
                                        <li>Publish HTML websites from the same dashboard</li>
                                        <li>Get higher limits and faster queue priority</li>
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
                                            Start 7-day trial
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }

                {
                    showWebsitePrePaywall && (
                        <div className="website-paywall-overlay fixed inset-0 z-[12049] opacity-0 animate-[website-paywall-fade-in_900ms_ease-out_forwards]">
                            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm opacity-0 animate-[website-paywall-backdrop-fade-in_900ms_ease-out_forwards]" />

                            <div className="absolute inset-0 flex items-start justify-center px-4 py-4 sm:items-center sm:px-6 sm:py-6">
                                <div className="relative w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-[32px] border border-neutral-200 bg-white shadow-[0_30px_120px_rgba(0,0,0,0.24)] opacity-0 translate-y-2 animate-[website-paywall-panel-in_900ms_ease-out_forwards] sm:max-h-[calc(100dvh-3rem)]">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowWebsitePrePaywall(false);
                                            setExitOfferReason("close");
                                            setShowExitOffer(true);
                                        }}
                                        aria-label="Close paywall"
                                        title="Close paywall"
                                        className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 focus:outline-none focus:ring-2 focus:ring-[rgba(245,95,42,0.35)] focus:ring-offset-2 focus:ring-offset-white sm:right-4 sm:top-4"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>

                                    <div className="p-6 sm:p-8 lg:p-10">
                                        <div className="max-w-xl">
                                            <h3 className="text-[30px] font-semibold leading-[1.05] tracking-tight text-neutral-950 sm:text-[38px]">
                                                See what upgrading unlocks
                                            </h3>
                                            <p className="mt-3 text-[15px] leading-relaxed text-neutral-600 sm:text-[16px]">
                                                A few quick reasons people upgrade before they ship.
                                            </p>
                                        </div>

                                        <div className="mt-7 space-y-4">
                                            {websitePrePaywallBenefits.map((item, index) => (
                                                <div
                                                    key={item.value}
                                                    className="website-paywall-feature flex items-start gap-4 px-1 py-1"
                                                    style={{
                                                        animationDelay: `${index * 140}ms`,
                                                        ["--website-paywall-feature-delay" as string]: `${index * 140}ms`,
                                                    }}
                                                >
                                                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(245,95,42,0.2)] text-[#f55f2a]">
                                                        <CheckCircle2 className="h-5 w-5" />
                                                    </div>
                                                    <div>
                                                        <p className="text-base font-semibold text-neutral-900 sm:text-[17px]">
                                                            {item.title}
                                                        </p>
                                                        <p className="mt-0.5 text-sm font-semibold text-[rgba(245,95,42,1)]">
                                                            {item.metric}
                                                        </p>
                                                        <p className="mt-1 text-sm leading-relaxed text-neutral-600">
                                                            {item.text}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="mt-7 flex flex-col gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowWebsitePrePaywall(false);
                                                    void startProCheckout({ exitOffer: true, exitOfferReason: "close" });
                                                }}
                                                className="inline-flex flex-1 items-center justify-center rounded-2xl bg-[#f55f2a] px-6 py-5 text-[19px] font-semibold tracking-tight text-white shadow-[0_18px_44px_rgba(245,95,42,0.24)] transition hover:translate-y-[-1px] hover:bg-[#f3602c] sm:text-[20px]"
                                            >
                                                Start generating websites for free →
                                            </button>
                                        </div>

                                        <p className="mt-3 text-xs text-neutral-500">
                                            Cancel anytime before renewal.
                                        </p>

                                        <div className="mt-8 border-t border-neutral-200 pt-6">
                                            <div className="mb-3 flex items-center justify-center gap-3 text-center">
                                                <span className="text-[13px] uppercase tracking-[0.1em] text-neutral-500 sm:text-[12px]">
                                                    See what <span className="text-[15px] font-bold text-[rgba(245,95,42,1)]">5000+</span> Kloner members have built with
                                                </span>
                                                <span className="relative inline-block h-[56px] w-[56px] sm:h-[72px] sm:w-[72px]">
                                                    <Image
                                                        src={logo}
                                                        alt="Kloner logo"
                                                        fill
                                                        sizes="(max-width: 640px) 56px, 72px"
                                                        className="object-contain"
                                                    />
                                                </span>
                                            </div>

                                            <div className="relative overflow-hidden rounded-[28px] border border-neutral-200 bg-white shadow-[0_18px_48px_rgba(0,0,0,0.08)]">
                                                <div className="overflow-hidden py-5">
                                                    <div className="website-paywall-carousel flex w-max items-stretch gap-4 px-4">
                                                        {[...websitePaywallShowcaseImages, ...websitePaywallShowcaseImages].map((src, index) => (
                                                            <div
                                                                key={`${src}-${index}`}
                                                                className="relative h-[220px] w-[260px] shrink-0 overflow-hidden rounded-[24px] border border-neutral-200 bg-neutral-100 shadow-[0_16px_36px_rgba(0,0,0,0.12)] sm:h-[250px] sm:w-[300px]"
                                                            >
                                                                <Image
                                                                    src={src}
                                                                    alt={`Showcase ${index + 1}`}
                                                                    fill
                                                                    sizes="(min-width: 640px) 300px, 260px"
                                                                    className="object-cover"
                                                                    priority={index < 2}
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
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
