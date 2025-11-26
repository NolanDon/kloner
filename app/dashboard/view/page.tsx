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
    getDocFromServer
} from "firebase/firestore";
import {
    ref as sRef,
    listAll,
    getDownloadURL,
    deleteObject,
    type StorageReference,
} from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import PreviewEditor from "@/components/PreviewEditor";
import {
    Rocket,
    Plus,
    ChevronDown,
    Hammer,
    Eye,
    CheckCircle2,
    Timer,
    Lock,
    Crown,
    BrushIcon,
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

const VERCEL_INTEGRATION_SLUG =
    process.env.NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG || "kloner";

const ACCENT = "#f55f2a";

/* ───────── types ───────── */

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

type RenderDoc = {
    url?: string | null;
    urlHash?: string | null;
    key?: string | null;
    referenceImage?: string | null;
    html?: string;
    nameHint?: string | null;
    status: "ready" | "queued" | "failed";
    archived?: boolean;
    createdAt?: any;
    updatedAt?: any;
    siteConfigId?: string;
    model?: string | null;
    version?: number;
    controllerVersion?: string | null;
    lastExportedAt?: any;
    vercelProjectId?: string | null;
    vercelProjectName?: string | null;
    lastDeployUrl?: string | null;
};

type ToastMsg = {
    id: string;
    text: string;
    tone?: "ok" | "warn" | "err";
};

async function resolveStorageUrl(
    pathOrUrl: string
): Promise<string> {
    if (!pathOrUrl) return "";
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    try {
        return await getDownloadURL(sRef(storage, pathOrUrl));
    } catch {
        return "";
    }
}

type RenderCardProps = {
    r: { id: string } & RenderDoc;

    // primitive flags – derive once in parent
    isDeleting: boolean;
    isOpening: boolean;
    hardLocked: boolean;
    isDeploying: boolean;
    deployLocked: boolean;

    urlHash: string | null;

    // callbacks from parent; keep them stable there with useCallback
    continueRender: (id: string) => void;
    discardRender: (id: string) => void;
    startDeployWizard: (opts: { id: string; nameHint?: string | null }) => void;
    setShowCreditsPaywall: (mode: "deploy" | null) => void;
    push: (message: string, level?: string) => void;
};

export function useResolvedImg(pathOrUrl: string) {
    const [src, setSrc] = React.useState("");
    const retriedRef = React.useRef(false);

    const refresh = React.useCallback(async () => {
        const u = await resolveStorageUrl(pathOrUrl);
        if (u) setSrc(u);
    }, [pathOrUrl]);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const onError = React.useCallback(() => {
        if (!retriedRef.current) {
            retriedRef.current = true;
            refresh();
        }
    }, [refresh]);

    return { src, onError };
}

function RenderCardInner({
    r,
    isDeleting,
    isOpening,
    hardLocked,
    isDeploying,
    deployLocked,
    urlHash,
    continueRender,
    discardRender,
    startDeployWizard,
    setShowCreditsPaywall,
    push,
}: RenderCardProps) {
    const router = useRouter();

    const isQueued = r.status === "queued";
    const isFailed = r.status === "failed";
    const isDeployed = !!r.lastExportedAt;

    const disableOpen =
        isOpening || isQueued || isFailed || hardLocked || isDeploying;

    const { src: refImgUrl, onError: refImgErr } = useResolvedImg(r.key || "");

    const versionLabel = shortVersionFromShotPath(
        r.key ?? "",
        (urlHash as string | undefined) ?? null,
    );

    const controllerVersion =
        typeof r.controllerVersion === "string" ? r.controllerVersion : "";

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

    const deployThis = () => {
        if (!r.html?.trim()) return;
        if (isDeployed) return;
        startDeployWizard({ id: r.id, nameHint: r.nameHint ?? undefined });
    };

    return (
        <div className="relative flex flex-col overflow-visible rounded-xl border border-neutral-200 bg-white shadow-sm">
            <span
                className="absolute left-2 top-2 z-30 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
                style={{ backgroundColor: "#1d4ed8" }}
                title={`Version ${versionLabel}`}
            >
                {versionLabel}
            </span>

            {controllerVersion && (
                <span
                    className="absolute right-2 top-2 z-30 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-neutral-900 shadow bg-amber-300"
                    title={`Controller v${controllerVersion}`}
                >
                    ctrl v{controllerVersion}
                </span>
            )}

            {!isDeployed && (
                <button
                    onClick={() => discardRender(r.id)}
                    disabled={isDeleting}
                    aria-label="Discard preview"
                    title="Delete this editable preview"
                    className="absolute top-0 right-0 z-40 grid h-5 w-5 place-items-center -translate-y-1/2 translate-x-1/2 rounded-full bg-red-600 text-white shadow-md ring-1 ring-white hover:bg-red-700 hover:ring-red-300 disabled:opacity-50"
                >
                    <span className="text-lg mb-0.5 leading-none">×</span>
                </button>
            )}

            <div className="relative">
                {!refImgUrl ? (
                    <div className="aspect-[4/3] w-full grid place-items-center text-xs text-neutral-500">
                        No snapshot available
                    </div>
                ) : (
                    <a className="block" title="Open the base screenshot">
                        <img
                            src={refImgUrl}
                            alt={r.nameHint || "preview"}
                            loading="lazy"
                            onError={refImgErr}
                            className="h-full w-full max-h-[260px] object-cover opacity-[0.25] select-none pointer-events-none"
                            draggable={false}
                        />
                    </a>
                )}

                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                    <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-xl bg-white/90 p-2 ring-1 ring-neutral-200 backdrop-blur md:flex-row">
                        <button
                            onClick={
                                deployLocked
                                    ? () => {
                                        setShowCreditsPaywall("deploy");
                                        push(
                                            "Deploy is available on paid plans.",
                                            "warn",
                                        );
                                    }
                                    : isDeployed
                                        ? () => {
                                            router.push("/dashboard/deployments");
                                        }
                                        : deployThis
                            }
                            disabled={
                                (!r.html && !isDeployed) ||
                                isDeleting ||
                                isQueued ||
                                isDeploying
                            }
                            className="shrink-0 rounded-md px-2 py-1 text-[0.75rem] border border-neutral-400 text-neutral-800 hover:bg-neutral-50 inline-flex items-center gap-1.5 disabled:opacity-60"
                            title={
                                deployLocked
                                    ? "Upgrade to publish live sites"
                                    : isDeployed
                                        ? "View and modify this deployment"
                                        : "Deploy current HTML to Vercel"
                            }
                        >
                            {deployLocked ? (
                                <>
                                    <Lock className="h-4 w-4" />
                                    <span>Deploy (locked)</span>
                                </>
                            ) : isDeploying ? (
                                <>
                                    <span>Deploying…</span>
                                    <Rocket className="h-4 w-4 animate-pulse" />
                                </>
                            ) : isDeployed ? (
                                <>
                                    <span>View deployment</span>
                                    <Rocket className="h-4 w-4" />
                                </>
                            ) : (
                                <>
                                    <span>Deploy</span>
                                    <Rocket className="h-4 w-4" />
                                </>
                            )}
                        </button>

                        {!isDeployed && (
                            <button
                                onClick={() => continueRender(r.id)}
                                disabled={disableOpen || isDeleting}
                                className="inline-flex items-center gap-2 rounded-md border border-neutral-400 px-3 py-1 text-xs text-neutral-800 shadow-sm"
                                title={
                                    isQueued
                                        ? "Still building preview"
                                        : isFailed
                                            ? "Open editor to fix"
                                            : "Open editor to customize"
                                }
                            >
                                {isQueued
                                    ? "Queued"
                                    : isFailed
                                        ? "Customize (fix)"
                                        : "Customize"}
                                <BrushIcon className="h-4 w-4" />
                            </button>
                        )}

                        {r.siteConfigId && (
                            <button
                                onClick={() => router.push(`/site/${r.siteConfigId}`)}
                                disabled={isDeleting}
                                className="inline-flex items-center gap-2 rounded-md border border-neutral-400 px-3 py-1 text-xs text-neutral-800 shadow-sm"
                                title="Open generated layout site"
                            >
                                <span>Open site</span>
                                <Rocket className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </div>

                <span
                    className="absolute bottom-2 left-2 z-20 rounded bg-white/90 px-2 py-0.5 text-[10px] font-medium text-neutral-600 ring-1 ring-neutral-200"
                    title="Preview status label"
                >
                    {isFailed
                        ? "Failed"
                        : r.html?.trim()
                            ? "Preview ready"
                            : "Awaiting HTML"}
                </span>
                <span className="absolute bottom-2 right-2 z-20 rounded bg-white/90 px-2 py-0.5 text-[10px] font-medium text-neutral-600 ring-1 ring-neutral-200">
                    {isDeploying
                        ? "Deploying…"
                        : isDeployed
                            ? "Deployed"
                            : r.status}
                </span>

                {isDeleting && <CenterSpinner label="Deleting…" />}

                {(isQueued || hardLocked || isDeploying) && (
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

            <div className="relative h-0 overflow-hidden" aria-hidden>
                <iframe
                    title={`r-${r.id}`}
                    className="w-full h-0"
                    sandbox="allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock"
                    referrerPolicy="no-referrer"
                    allow="clipboard-read; clipboard-write"
                    key={`frame-${r.id}`}
                    srcDoc={srcDoc}
                />
            </div>
        </div>
    );
}

export const RenderCard = memo(
    RenderCardInner,
    (prev, next) => {
        const a = prev.r as any;
        const b = next.r as any;

        return (
            a.id === b.id &&
            a.status === b.status &&
            (a.html || "") === (b.html || "") &&
            (a.key || "") === (b.key || "") &&
            (a.nameHint || "") === (b.nameHint || "") &&
            (a.lastExportedAt || "") === (b.lastExportedAt || "") &&
            (a.siteConfigId || "") === (b.siteConfigId || "") &&
            (a.controllerVersion || "") === (b.controllerVersion || "") &&
            prev.isDeleting === next.isDeleting &&
            prev.isOpening === next.isOpening &&
            prev.hardLocked === next.hardLocked &&
            prev.isDeploying === next.isDeploying &&
            prev.deployLocked === next.deployLocked &&
            (prev.urlHash || "") === (next.urlHash || "")
        );
    },
);

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
    size = 28,
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

const GhostActionRow = memo(function GhostActionCard({
    title,
    subtitle,
    onClick,
    disabled,
}: {
    title: string;
    subtitle?: string;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`group relative p-6 flex w-full items-center justify-center rounded-xl border-2 border-dashed bg-white text-center transition ${disabled
                ? "opacity-60 cursor-not-allowed"
                : "hover:border-neutral-400"
                }`}
            title={title}
            aria-disabled={disabled}
        >
            <div className="pointer-events-none flex flex-col items-center">
                <div className="grid h-14 w-14 place-items-center rounded-full border border-neutral-200 bg-neutral-50 transition group-hover:scale-105">
                    <Plus className="h-7 w-7 text-neutral-600" />
                </div>
                <div className="mt-3 text-sm font-semibold text-neutral-800">
                    {title}
                </div>
                {subtitle ? (
                    <div className="mt-1 text-xs text-neutral-500">
                        {subtitle}
                    </div>
                ) : null}
            </div>
        </button>
    );
});


const GhostActionCard = memo(function GhostActionCard({
    title,
    subtitle,
    onClick,
    disabled,
}: {
    title: string;
    subtitle?: string;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`group relative p-6 flex aspect-[4/3] w-full items-center justify-center rounded-xl border-2 border-dashed bg-white text-center transition ${disabled
                ? "opacity-60 cursor-not-allowed"
                : "hover:border-neutral-400"
                }`}
            title={title}
            aria-disabled={disabled}
        >
            <div className="pointer-events-none flex flex-col items-center">
                <div className="grid h-14 w-14 place-items-center rounded-full border border-neutral-200 bg-neutral-50 transition group-hover:scale-105">
                    <Plus className="h-7 w-7 text-neutral-600" />
                </div>
                <div className="mt-3 text-sm font-semibold text-neutral-800">
                    {title}
                </div>
                {subtitle ? (
                    <div className="mt-1 text-xs text-neutral-500">
                        {subtitle}
                    </div>
                ) : null}
            </div>
        </button>
    );
});

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

    const [urls, setUrls] = useState<Array<{ id: string } & UrlDoc>>([]);
    const [urlsLoading, setUrlsLoading] = useState<boolean>(true);

    const [err, setErr] = useState<string>("");
    const [info, setInfo] = useState<string>("");

    const [loading, setLoading] = useState<boolean>(true);

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
    const [activeRenderId, setActiveRenderId] = useState<
        string | undefined
    >(undefined);

    const [renders, setRenders] = useState<
        Array<{ id: string } & RenderDoc>
    >([]);
    const [loadingRenders, setLoadingRenders] = useState(false);
    const [projectNameBusy, setProjectNameBusy] = useState(false);

    const [lockUntilByKey, setLockUntilByKey] = useState<
        Record<string, number>
    >({});
    const [lockUntilByRender, setLockUntilByRender] = useState<
        Record<string, number>
    >({});

    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerIdx, setViewerIdx] = useState(0);

    const projectNameInputRef = useRef<HTMLInputElement | null>(null);
    const [showProjectNamePopover, setShowProjectNamePopover] = useState(false);
    const [pendingDeploy, setPendingDeploy] = useState<null | {
        html: string;
        renderId?: string;
    }>(null);
    const [previewConfirmOpen, setPreviewConfirmOpen] = useState(false);
    const [previewConfirmLoading, setPreviewConfirmLoading] = useState(false);


    function handleCancelProjectName() {
        setShowProjectNamePopover(false);
        setPendingDeploy(null);
        setProjectNameBusy(false);
        if (projectNameInputRef.current) {
            projectNameInputRef.current.value = "";
        }
    }


    // async function handleConfirmProjectName() {
    //     if (projectNameBusy) return; // guard against double-clicks
    //     if (!pendingDeploy) {
    //         setShowProjectNamePopover(false);
    //         return;
    //     }

    //     const raw = projectNameInputRef.current?.value ?? "";
    //     const trimmed = raw.trim();

    //     if (!trimmed) {
    //         push("Please enter a project name.", "err");
    //         return;
    //     }

    //     setProjectNameBusy(true);
    //     try {
    //         // persist projectVercelName on the render
    //         if (user && pendingDeploy.renderId) {
    //             await updateDoc(
    //                 doc(
    //                     db,
    //                     "kloner_users",
    //                     user.uid,
    //                     "kloner_renders",
    //                     pendingDeploy.renderId
    //                 ),
    //                 { projectVercelName: trimmed }
    //             );
    //         }

    //         setShowProjectNamePopover(false);

    //         const { html, renderId } = pendingDeploy;
    //         setPendingDeploy(null);

    //         // re-run export with the confirmed name
    //         void exportToVercel({
    //             html,
    //             renderId,
    //             name: trimmed,
    //         });
    //     } finally {
    //         setProjectNameBusy(false);
    //     }
    // }


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

    // at top of component
    const [deletingCollectionById, setDeletingCollectionById] = useState<
        Record<string, boolean>
    >({});

    // somewhere near other callbacks
    const discardCollection = useCallback(
        async (group: {
            snapshotId: string | null | undefined;
            items: { path: string | null | undefined }[];
        }) => {
            if (!user || !docSnap) return;

            // Narrow paths to string[]
            const paths: string[] = group.items
                .map((s) => s.path)
                .filter((p): p is string => typeof p === "string" && p.length > 0);

            if (!paths.length) return;

            const ok = window.confirm(
                `Delete this snapshot collection (${paths.length} screenshot${paths.length > 1 ? "s" : ""
                }) and all its previews?`
            );
            if (!ok) return;

            setErr("");

            const snapshotId = group.snapshotId ?? "";
            if (!snapshotId) return;

            setDeletingCollectionById((m) => ({
                ...m,
                [snapshotId]: true,
            }));

            try {
                // delete storage objects
                await Promise.all(
                    paths.map((p) =>
                        deleteObject(sRef(storage, p)).catch(() => { })
                    )
                );

                // delete renders that reference any of these keys (chunked "in" queries)
                const rCol = collection(
                    db,
                    "kloner_users",
                    user.uid,
                    "kloner_renders"
                );

                const chunks: string[][] = [];
                for (let i = 0; i < paths.length; i += 10) {
                    chunks.push(paths.slice(i, i + 10));
                }

                for (const chunk of chunks) {
                    const rSnap = await getDocs(
                        query(rCol, where("key", "in", chunk))
                    );
                    if (!rSnap.empty) {
                        await Promise.all(
                            rSnap.docs.map((d) => deleteDoc(d.ref))
                        );
                    }
                }

                // remove paths from the snapshot doc
                try {
                    await updateDoc(docSnap.ref, {
                        screenshotPaths: arrayRemove(...paths),
                        updatedAt: serverTimestamp(),
                    } as any);
                } catch {
                    // ignore
                }

                // local state cleanup
                setShots((prev) => prev.filter((s) => !paths.includes(s.path)));

                setRenders((prev) =>
                    prev.filter((r) => !(typeof r.key === "string" && paths.includes(r.key)))
                );

                setPendingByKey((prev) => {
                    const next = { ...prev };
                    paths.forEach((p) => {
                        delete next[p];
                    });
                    return next;
                });

                setOptimisticByKey((prev) => {
                    const next = { ...prev };
                    paths.forEach((p) => {
                        delete next[p];
                    });
                    return next;
                });

                push("Snapshot collection deleted", "ok");
            } catch (e: any) {
                setErr(
                    e?.message || "Failed to delete snapshot collection."
                );
                push("Failed to delete snapshot collection", "err");
            } finally {
                setDeletingCollectionById((m) => {
                    const n = { ...m };
                    delete n[snapshotId];
                    return n;
                });
            }
        },
        [user, docSnap, push]
    );


    // ---- state ----
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
        const raw = search.get("u");
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
                const all = snap.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as RenderDoc),
                }));

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
            const all = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as RenderDoc),
            }));

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

            // Use first key for optimistic bookkeeping
            const primaryKey = storageKeys[0];

            const alreadyQueued = renders.find(
                (r) =>
                    r.key === primaryKey &&
                    r.status === "queued" &&
                    !r.archived
            );
            if (alreadyQueued || pendingByKey[primaryKey]) return;

            if (!canUsePreviewCredit()) {
                push(
                    "You have used all available preview credits for today on this plan.",
                    "warn"
                );
                setShowCreditsPaywall("preview");
                return;
            }

            if (
                !window.confirm(
                    "Generate an editable preview for 15 credits?"
                )
            )
                return;

            const optimisticId = `local_${hash64(
                `${user.uid}|${primaryKey}|${Date.now()}`
            )}`;

            const optimistic: { id: string } & RenderDoc = {
                id: optimisticId,
                key: primaryKey,          // still store a primary key
                referenceImage: null,
                html: "",
                status: "queued",
                url: targetUrl || null,
                urlHash: targetUrl ? hash64(targetUrl) : null,
                nameHint: targetUrl
                    ? new URL(targetUrl).hostname
                    : null,
                model: null,
                archived: false,
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
                controllerVersion: null,
            } as any;

            startHardLock(primaryKey, optimisticId, 60_000);

            setRenders((prev) => [optimistic, ...prev]);
            setOptimisticByKey((m) => ({
                ...m,
                [primaryKey]: optimistic,
            }));
            setPendingByKey((m) => ({
                ...m,
                [primaryKey]: true,
            }));
            setErr("");
            setInfo("Preview queued.");

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

                if (!r.ok || !j?.ok)
                    throw new Error(j?.error || "Render failed");


                await refreshRenders();
            } catch (e: any) {
                setRenders((prev) =>
                    prev.map((r) =>
                        r.id === optimisticId
                            ? { ...r, status: "failed" }
                            : r
                    )
                );
                setOptimisticByKey((m) => {
                    const v = m[primaryKey];
                    if (!v) return m;
                    return {
                        ...m,
                        [primaryKey]: { ...v, status: "failed" },
                    };
                });
                setErr(e?.message || "Failed to start collection preview.");
                push("Collection preview failed to start", "err");
            }
        },
        [
            user,
            targetUrl,
            renders,
            refreshRenders,
            push,
            startHardLock,
            pendingByKey,
            canUsePreviewCredit,

        ]
    );

    const continueRender = useCallback(
        async (renderId: string) => {
            if (!user) return;

            setErr("");
            setLoading(true);

            const dref = doc(
                db,
                "kloner_users",
                user.uid,
                "kloner_renders",
                renderId
            );

            // force fresh read, not cache
            const snap = await getDocFromServer(dref);
            // if you don’t want getDocFromServer:
            // const snap = await getDoc(dref, { source: "server" as const });

            if (!snap.exists()) {
                setErr("Preview not found.");
                push("Preview not found", "err");
                setLoading(false);
                return;
            }

            const data = snap.data() as RenderDoc;

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

            const html = data.html || "";

            // editor UI
            setEditorHtml(html);
            setEditorRefImg(refSrc);
            setActiveRenderId(renderId);
            setEditorOpen(true);
            setLoading(false);
        },
        [user, push, shots]
    );



    const discardRender = useCallback(
        async (renderId: string) => {
            if (!user) return;
            const ok = window.confirm(
                "Discard this editable preview?"
            );
            if (!ok) return;

            setDeletingRender((m) => ({
                ...m,
                [renderId]: true,
            }));

            try {
                await deleteDoc(
                    doc(
                        db,
                        "kloner_users",
                        user.uid,
                        "kloner_renders",
                        renderId
                    )
                );
                setRenders((prev) =>
                    prev.filter((r) => r.id !== renderId)
                );
                push("Preview discarded", "ok");
            } catch (e: any) {
                setErr(
                    e?.message || "Failed to discard preview."
                );
                push("Failed to discard preview", "err");
            } finally {
                setDeletingRender((m) => {
                    const n = { ...m };
                    delete n[renderId];
                    return n;
                });
            }
        },
        [user, push]
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

    /* ───────── export / deploy ───────── */

    async function exportToVercel(opts: {
        html: string;
        name?: string;
        renderId?: string;
    }) {
        const { html, name, renderId } = opts;

        if (userTier === "free") {
            setShowCreditsPaywall("preview");
            push("Export and deploy are reserved for paid plans.", "warn");
            return;
        }

        // Resolve which render id we're operating on (for state + Firestore)
        const resolvedRenderId = renderId || activeRenderId || null;

        // If no project name yet, open popover and stop here
        const trimmedName = name?.trim();
        if (!trimmedName) {
            // Close editor so user fills out project name
            setEditorOpen(false)
            setPendingDeploy({
                html,
                renderId: resolvedRenderId ?? undefined,
            });
            // input is now uncontrolled; no per-keystroke state
            setShowProjectNamePopover(true);
            return;
        }

        // visual feedback: mark this render as deploying
        if (resolvedRenderId) {
            setDeployingRenderId(resolvedRenderId);
        }
        push("Starting deployment…", "ok");

        const csrf = await ensureSessionAndCsrf();

        try {
            const r = await fetch("/api/user-deploy", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                body: JSON.stringify({
                    html,
                    projectName: trimmedName,
                    renderId: resolvedRenderId,
                }),
            });

            const j = (await r.json().catch(() => ({}))) as any;

            if (!r.ok || !j?.url) {
                push(j?.error || "Vercel deploy failed", "err");
                throw new Error(j?.error || "Vercel deploy failed");
            }

            if (user && resolvedRenderId) {
                await updateDoc(
                    doc(
                        db,
                        "kloner_users",
                        user.uid,
                        "kloner_renders",
                        resolvedRenderId
                    ),
                    { lastExportedAt: serverTimestamp() }
                );
            }

            navigator.clipboard?.writeText(j.url).catch(() => void 0);

            try {
                localStorage.setItem("kloner.deployments.hasUnseen", "1");
            } catch {
                // ignore
            }

            setShowDeployNextSteps(true);
            push("Deployed. URL copied.", "ok");

            await refreshRenders();
        } finally {
            setDeployingRenderId(null);
        }
    }


    const saveDraft = useCallback(
        async (payload: {
            draftId?: string;
            html: string;
            meta: {
                nameHint?: string;
                device: string;
                mode: string;
            };
            version: number;
        }) => {
            if (!user) return;

            const rid = payload.draftId || activeRenderId;

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
                        urlHash: targetUrl
                            ? hash64(targetUrl)
                            : null,
                        key: null,
                        referenceImage: editorRefImg || null,
                        html: payload.html,
                        nameHint:
                            payload.meta?.nameHint ||
                            (targetUrl
                                ? new URL(targetUrl).hostname
                                : null),
                        status: "ready",
                        archived: false,
                        version: payload.version || 1,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
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
                        urlHash: targetUrl
                            ? hash64(targetUrl)
                            : null,
                        html: payload.html,
                        referenceImage: editorRefImg || null,
                        nameHint:
                            payload.meta?.nameHint ||
                            (targetUrl
                                ? new URL(targetUrl).hostname
                                : null),
                        version: payload.version || 1,
                        updatedAt: serverTimestamp(),
                    },
                    { merge: true }
                );
                push("Draft updated", "ok");
                await refreshRenders();
            }

            // try {
            //     if (user) {
            //         const flagKey = `kloner.firstCustomize.${user.uid}`;
            //         const seen =
            //             typeof window !== "undefined"
            //                 ? localStorage.getItem(flagKey)
            //                 : "1";
            //         if (!seen) {
            //             if (typeof window !== "undefined") {
            //                 localStorage.setItem(flagKey, "1");
            //             }
            //             setShowUpgradeAfterCustomize(true);
            //         }
            //     }
            // } catch {
            //     // ignore
            // }
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

    const rescan = useCallback(
        async () => {
            if (
                !isHttpUrl(targetUrl) ||
                !user ||
                !docData
            )
                return;

            if (!canUseScreenshotCredit()) {
                push(
                    "You have used all available screenshot credits for today on this plan.",
                    "warn"
                );
                setShowCreditsPaywall("screenshot");
                return;
            }

            if (
                !window.confirm(
                    "Queue a fresh snapshot collection for 10 credits?"
                )
            )
                return;

            setRescanning(true);
            setErr("");

            try {
                const r = await fetch(
                    "/api/private/generate",
                    {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                        },
                        credentials: "include",
                        body: JSON.stringify({ url: targetUrl }),
                    }
                );

                if (!r.ok) {
                    const j = (await r
                        .json()
                        .catch(() => ({}))) as any;
                    setErr(
                        j?.error || "Rescan failed."
                    );
                    push("Rescan failed", "err");
                } else {
                    push("Rescan started", "ok");
                }
            } catch (e: any) {
                setErr(
                    e?.message || "Rescan failed."
                );
                push("Rescan failed", "err");
            } finally {
                setRescanning(false);
            }
        },
        [
            targetUrl,
            user,
            docData,
            push,
            canUseScreenshotCredit,
        ]
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

    const [deployWizardOpen, setDeployWizardOpen] = useState(false);
    const [deployWizardStep, setDeployWizardStep] = useState<1 | 2 | 3>(1);
    const [deployWizardProjectName, setDeployWizardProjectName] = useState("");
    const [deployWizardBusy, setDeployWizardBusy] = useState(false);
    const [deployWizardError, setDeployWizardError] = useState<string | null>(null);
    const [deployWizardRenderId, setDeployWizardRenderId] = useState<string | null>(null);

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
            setDeployWizardProjectName(render.nameHint || "");
            setDeployWizardStep(1);
            setDeployWizardError(null);
            setDeployWizardOpen(true);
            autoDeployTriggeredRef.current = false;
        },
        [],
    );

    const closeDeployWizard = useCallback(() => {
        setDeployWizardOpen(false);
        setDeployWizardRenderId(null);
        setDeployWizardError(null);
        setDeployWizardProjectName("");
        setDeployWizardStep(1);
        autoDeployTriggeredRef.current = false;
    }, []);

    // ───────── auto-advance from step 2 → 3 only if we have a render id ─────────

    useEffect(() => {
        if (!deployWizardOpen) return;
        if (deployWizardStep !== 2) return;
        if (vercelChecking) return;
        if (vercelStatus !== "connected") return;
        if (!deployWizardRenderId) return; // no target → do not advance

        const t = setTimeout(() => {
            setDeployWizardStep(3);
        }, 1500); // short “connected” flash

        return () => clearTimeout(t);
    }, [
        deployWizardOpen,
        deployWizardStep,
        vercelStatus,
        vercelChecking,
        deployWizardRenderId,
    ]);

    // ───────── actual deploy call ─────────

    const submitDeployWizard = useCallback(async () => {
        if (!deployWizardRenderId) return;
        const target = renders.find((r) => r.id === deployWizardRenderId);
        if (!target || !target.html?.trim()) return;

        setDeployWizardBusy(true);
        setDeployWizardError(null);
        try {
            await exportToVercel({
                html: target.html,
                name: deployWizardProjectName || target.nameHint || "",
                renderId: target.id,
            });
            // keep step=3; UI will switch from “Deploying…” → “Deployment created”
            setDeployWizardStep(3);
        } catch (e) {
            console.error("Deploy failed", e);
            setDeployWizardError(
                "We couldn’t finish the deploy. Check your Vercel connection and try again.",
            );
        } finally {
            setDeployWizardBusy(false);
        }
    }, [deployWizardRenderId, deployWizardProjectName, renders, exportToVercel]);

    // ───────── auto-deploy exactly once when we land on step 3 ─────────

    useEffect(() => {
        if (!deployWizardOpen) return;
        if (deployWizardStep !== 3) return;
        if (deployWizardBusy) return;
        if (!deployWizardRenderId) return; // nothing to deploy
        if (autoDeployTriggeredRef.current) return;

        autoDeployTriggeredRef.current = true;
        void submitDeployWizard();
    }, [
        deployWizardOpen,
        deployWizardStep,
        deployWizardBusy,
        deployWizardRenderId,
        submitDeployWizard,
    ]);


    /* ───────── cards ───────── */

    // const ShotCard = useMemo(
    //     () =>
    //         memo(
    //             function ShotCardInner({
    //                 s,
    //                 locked,
    //                 index,
    //                 onView,
    //                 // NEW: optional collection props
    //                 isGroupRoot,
    //                 extraCount,
    //                 onGenerateCollection,
    //             }: {
    //                 s: Shot;
    //                 locked: boolean;
    //                 index: number;
    //                 onView: (i: number) => void;

    //                 // if true, this card represents an entire snapshot collection
    //                 isGroupRoot?: boolean;
    //                 // how many additional pages are in this collection
    //                 extraCount?: number;
    //                 // if provided, use this instead of buildFromKey for generate
    //                 onGenerateCollection?: (snapshotId: string) => void;
    //             }) {
    //                 const [imgLoading, setImgLoading] = useState<boolean>(true);
    //                 const isDeleting = !!deletingByKey[s.path];
    //                 const hardLocked =
    //                     (lockUntilByKey[s.path] || 0) > Date.now();
    //                 const showOverlay =
    //                     locked || imgLoading || hardLocked || isDeleting;

    //                 const versionLabel = shortVersionFromShotPath(
    //                     s.path,
    //                     (docData?.urlHash as string | undefined) ?? null
    //                 );

    //                 const isCollectionCard =
    //                     !!isGroupRoot && !!s.snapshotId && !!onGenerateCollection;

    //                 const handleGenerateClick = (e: React.MouseEvent) => {
    //                     e.preventDefault();
    //                     if (locked || isDeleting) return;

    //                     if (isCollectionCard) {
    //                         onGenerateCollection!(s.snapshotId!);
    //                     } else {
    //                         // legacy single-shot behavior
    //                         buildFromKey(s.path);
    //                     }
    //                 };

    //                 return (
    //                     <figure className="relative rounded-xl border border-neutral-200 bg-white shadow-sm flex flex-col">
    //                         <span
    //                             className="absolute top-2 left-2 z-10 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
    //                             style={{ backgroundColor: "#1d4ed8" }}
    //                             title={`Version ${versionLabel}`}
    //                         >
    //                             {versionLabel}
    //                         </span>

    //                         {/* optional +N more badge for collections */}
    //                         {isCollectionCard && extraCount && extraCount > 0 && (
    //                             <span className="absolute top-2 right-2 z-10 rounded-full bg-neutral-900/80 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
    //                                 +{extraCount} more
    //                             </span>
    //                         )}

    //                         <button
    //                             onClick={() => discardShot(s)}
    //                             disabled={locked || isDeleting}
    //                             aria-label="Discard screenshot"
    //                             title="Delete this screenshot and all previews from it"
    //                             className="absolute top-0 right-0 z-40 grid h-5 w-5 place-items-center -translate-y-1/2 translate-x-1/2 rounded-full bg-red-600 text-white shadow-md ring-1 ring-white hover:bg-red-700 hover:ring-red-300 disabled:opacity-50"
    //                         >
    //                             <span className="text-lg mb-0.5 leading-none">
    //                                 ×
    //                             </span>
    //                         </button>

    //                         {isDeleting && <CenterSpinner label="Deleting…" />}

    //                         <a
    //                             className="block"
    //                             title={
    //                                 isCollectionCard
    //                                     ? "Open collection screenshots"
    //                                     : "Open full-size screenshot"
    //                             }
    //                         >
    //                             <div className="w-full aspect-[4/3] bg-neutral-50 flex items-center justify-center rounded-t-xl relative">
    //                                 <img
    //                                     src={s.url}
    //                                     alt={s.fileName}
    //                                     className="h-full w-full object-cover opacity-30"
    //                                     loading="lazy"
    //                                     onLoad={() => setImgLoading(false)}
    //                                     onError={() => setImgLoading(false)}
    //                                 />

    //                                 <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
    //                                     <div className="pointer-events-auto flex flex-col xl:flex-row items-center gap-2 rounded-xl bg-white/90 p-2 ring-1 ring-neutral-200 backdrop-blur">
    //                                         <button
    //                                             onClick={(e) => {
    //                                                 e.preventDefault();
    //                                                 onView(index);
    //                                             }}
    //                                             className="shrink-0 rounded-md px-2 py-1 text-[0.75rem] border border-neutral-400 text-neutral-800 hover:bg-neutral-50 inline-flex items-center gap-1.5"
    //                                             title={
    //                                                 isCollectionCard
    //                                                     ? "View this collection"
    //                                                     : "View full-screen"
    //                                             }
    //                                         >
    //                                             <span>
    //                                                 {isCollectionCard
    //                                                     ? "View collection"
    //                                                     : "View"}
    //                                             </span>
    //                                             <Eye
    //                                                 className="h-4 w-4"
    //                                                 aria-hidden
    //                                             />
    //                                         </button>

    //                                         <button
    //                                             onClick={handleGenerateClick}
    //                                             disabled={locked || isDeleting}
    //                                             aria-busy={locked}
    //                                             className="shrink-0 rounded-md px-2 py-1 text-[0.75rem] border border-neutral-400 text-neutral-800 hover:bg-neutral-50 inline-flex items-center gap-1.5"
    //                                             title={
    //                                                 isCollectionCard
    //                                                     ? "Create editable preview from this collection"
    //                                                     : "Create editable preview from this screenshot"
    //                                             }
    //                                         >
    //                                             <span>
    //                                                 {locked
    //                                                     ? "In progress"
    //                                                     : isCollectionCard
    //                                                         ? "Generate collection preview"
    //                                                         : "Generate preview"}
    //                                             </span>
    //                                             <Hammer
    //                                                 className={`h-4 w-4 ${locked
    //                                                     ? "animate-pulse"
    //                                                     : ""
    //                                                     }`}
    //                                                 aria-hidden
    //                                             />
    //                                         </button>
    //                                     </div>
    //                                 </div>

    //                                 {showOverlay && (
    //                                     <CenterSpinner
    //                                         label={
    //                                             locked
    //                                                 ? "Queued preview…"
    //                                                 : "Loading…"
    //                                         }
    //                                     />
    //                                 )}
    //                             </div>
    //                         </a>

    //                         <figcaption className="px-3 py-2 text-xs text-neutral-700 rounded-b-xl">
    //                             <div className="flex items-center justify-between gap-2 flex-wrap">
    //                                 <span className="truncate text-[11px] text-neutral-500">
    //                                     {s.fileName}
    //                                 </span>
    //                             </div>
    //                         </figcaption>
    //                     </figure>
    //                 );
    //             },
    //             (prev, next) =>
    //                 prev.locked === next.locked &&
    //                 prev.s.path === next.s.path &&
    //                 prev.s.url === next.s.url &&
    //                 prev.s.fileName === next.s.fileName &&
    //                 prev.isGroupRoot === next.isGroupRoot &&
    //                 prev.extraCount === next.extraCount &&
    //                 prev.onGenerateCollection === next.onGenerateCollection
    //         ),
    //     [buildFromKey, discardShot, deletingByKey, lockUntilByKey, docData?.urlHash]
    // );


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

    // wizard for first customization → upgrade → deploy
    const [upgradeStep, setUpgradeStep] = useState<3 | 4 | 5>(3);
    const [upgradeProjectName, setUpgradeProjectName] = useState("");
    const [upgradeBusy, setUpgradeBusy] = useState(false);
    const [upgradeError, setUpgradeError] = useState<string | null>(null);

    /* ───────── render ───────── */

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


    return (
        <main className="min-h-screen bg-white">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-8">
                <div className="mb-4 flex items-center gap-2">
                    <div className="h-px flex-1 bg-neutral-200/70" />
                    <div className="h-px flex-1 bg-neutral-200/70" />
                </div>

                {/* plan + credits banner */}
                <div className="mb-6 rounded-2xl border border-neutral-200 bg-gradient-to-r from-neutral-50 to-white px-4 py-3 sm:px-5 sm:py-4 text-xs sm:text-sm text-neutral-700 shadow-sm">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1">
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
                                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] sm:text-xs text-neutral-700">
                                    Screenshots Remaining:&nbsp;
                                    <span className="font-semibold text-neutral-900">
                                        {screenshotRemaining === null ||
                                            !screenshotLimitDisplay
                                            ? "unlimited"
                                            : `${screenshotRemaining}/${screenshotLimitDisplay}`}
                                    </span>
                                </span>

                                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] sm:text-xs text-neutral-700">
                                    Previews Remaining:&nbsp;
                                    <span className="font-semibold text-neutral-900">
                                        {previewRemaining === null ||
                                            !previewLimitDisplay
                                            ? "unlimited"
                                            : `${previewRemaining}/${previewLimitDisplay}`}
                                    </span>
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
                    </div>
                </div>

                {/* Step 1: URL selection */}
                <section className="mb-8 rounded-3xl border border-neutral-200 bg-white/70 px-4 py-4 sm:px-5 sm:py-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="space-y-2">
                            <div className="inline-flex items-center gap-2 rounded-full bg-neutral-100 pl-1 pr-3 py-1 text-[20px] mb-4 font-medium text-neutral-600">
                                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-white text-[20px]">
                                    1
                                </span>
                                <span>URLs</span>
                                {step1Done && (
                                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500" />
                                )}
                            </div>

                            <p className="text-xs text-neutral-500">
                                Choose which site Kloner should capture and generate from.
                            </p>
                        </div>
                    </div>

                    {/* url selector */}
                    <div className="mt-4">
                        {urlsLoading ? (
                            <div className="h-10 rounded-xl bg-neutral-100 animate-pulse" />
                        ) : urls.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-2 text-sm text-neutral-700 my-2">
                                <strong className="text-neutral-800 font-semibold inline-flex items-center gap-1">
                                    {step1Done ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                        <Timer className="h-4 w-4 text-orange-400" />
                                    )}
                                    Step 1
                                </strong>{" "}
                                — Add a URL in Dashboard. Return here to capture
                                screenshots and build previews.
                            </div>
                        ) : (
                            <div className="relative inline-block" ref={urlMenuRef}>
                                <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-2 text-sm text-neutral-700 my-2">
                                    <strong className="text-neutral-800 font-semibold inline-flex gap-1">
                                        {step1Done && (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                        )}
                                        Step 1
                                    </strong>{" "}
                                    — You have chosen a URL.
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

                {/* Step 2: collections */}
                <section className="mt-6 rounded-3xl border border-neutral-200 bg-white/70 px-4 py-5 sm:px-5 sm:py-6 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="space-y-1">
                            <div className="inline-flex items-center gap-2 rounded-full bg-neutral-100 pl-1 pr-3 py-1 text-[20px] mb-4 font-medium text-neutral-600">
                                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-white text-[20px]">
                                    2
                                </span>
                                <span>Screenshot collections</span>
                                {step2Done && (
                                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500" />
                                )}
                            </div>

                            <p className="my-1 text-xs text-neutral-500">
                                These are the original screenshots captured directly from
                                your entered URL.
                            </p>
                        </div>
                    </div>

                    {!targetUrl ? (
                        <>
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-2 text-sm text-neutral-700 flex items-center gap-3">
                                <strong className="text-neutral-800 font-semibold inline-flex items-center gap-1">
                                    {step2Done ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                        <Timer className="h-4 w-4 text-orange-400" />
                                    )}
                                    <span>Step 2</span>
                                </strong>
                                <span className="text-sm">
                                    — Below will host your base images.
                                </span>
                            </div>

                            <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-6 text-sm text-neutral-700">
                                Select a URL above to manage its screenshots and previews.
                            </div>
                        </>
                    ) : loading ? (
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div
                                    key={i}
                                    className="h-64 rounded-xl bg-neutral-100 animate-pulse"
                                />
                            ))}
                        </div>
                    ) : shots.length === 0 ? (
                        <>
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-2 text-sm text-neutral-700 my-4">
                                <strong className="text-neutral-800 inline-flex font-semibold gap-1">
                                    {step2Done ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                        <Timer className="h-4 w-4 text-orange-400" />
                                    )}
                                    Step 2
                                </strong>{" "}
                                — Generate your first screenshot by clicking
                                <span className="inline-flex h-5 w-5 items-center justify-center mx-1 rounded-full border border-neutral-200 bg-neutral-50">
                                    <Plus className="h-3 w-3 text-neutral-600" />
                                </span>
                                below.
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                <GhostActionCard
                                    title={
                                        rescanning ? "Starting…" : "Generate new base image"
                                    }
                                    subtitle="Captures a fresh screenshot for this URL. Safe; does not remove prior versions."
                                    onClick={rescan}
                                    disabled={rescanning || !isHttpUrl(targetUrl)}
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-2 text-sm text-neutral-700 my-4">
                                <strong className="text-neutral-800 font-semibold inline-flex gap-1">
                                    {step2Done ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                        <Timer className="h-4 w-4 text-orange-400" />
                                    )}
                                    Step 2
                                </strong>{" "}
                                — Base collection captured.{" "}
                                {renders.length === 0 && (
                                    <span className="inline-flex ml-1 mt-2 text-sm items-center text-neutral-700">
                                        Click{" "}
                                        <span className="mx-2 shrink-0 rounded-md px-2 py-1 text-[0.75rem] bg-accent text-white inline-flex items-center gap-1.5">
                                            Generate preview <Hammer className="h-4 w-4" />
                                        </span>
                                        to create your first website preview.
                                    </span>
                                )}
                            </div>

                            <div className="space-y-3">
                                {groupedShots.map((group, groupIndex) => {
                                    const first = group.items[0];
                                    if (!first) return null;

                                    const extraCount = group.items.length - 1;

                                    // keys for this snapshot run
                                    const collectionKeys = group.items.map(
                                        (s) => s.path,
                                    );

                                    // index in flat shots so your existing viewer still works
                                    const globalIndex = shots.findIndex(
                                        (sh) => sh.path === first.path,
                                    );

                                    // lock if ANY shot in the collection is pending or has a queued render
                                    const locked = group.items.some((s) => {
                                        if (pendingByKey[s.path]) return true;
                                        return renders.some(
                                            (r) =>
                                                r.key === s.path &&
                                                r.status === "queued" &&
                                                !r.archived,
                                        );
                                    });

                                    return (
                                        <div
                                            key={group.snapshotId + "-" + groupIndex}
                                            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-sm"
                                        >
                                            {/* left side: tiny preview + meta */}
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    openViewer(
                                                        globalIndex >= 0 ? globalIndex : 0,
                                                    )
                                                }
                                                className="flex items-center gap-2 text-left"
                                                disabled={locked}
                                            >
                                                <div
                                                    className={`h-10 w-16 ${locked ? "opacity-50" : ""
                                                        } overflow-hidden rounded-md bg-neutral-100`}
                                                >
                                                    <img
                                                        src={first.url}
                                                        alt={first.fileName}
                                                        className="h-full w-full object-cover"
                                                        loading="lazy"
                                                    />
                                                </div>

                                                <div className="flex flex-col">
                                                    <span className="text-[11px] font-semibold text-neutral-800">
                                                        Snapshot Collection{" "}
                                                        {groupedShots.length -
                                                            groupIndex}
                                                    </span>
                                                    {group.snapshotCreatedAt && (
                                                        <span className="text-[10px] text-neutral-500">
                                                            {new Date(
                                                                group.snapshotCreatedAt,
                                                            ).toLocaleString()}
                                                        </span>
                                                    )}
                                                    {extraCount > 0 && (
                                                        <span className="text-[10px] text-neutral-500">
                                                            +{extraCount} more page
                                                            {extraCount > 1 ? "s" : ""}
                                                        </span>
                                                    )}
                                                </div>
                                            </button>

                                            {/* right side: actions for the whole collection */}
                                            <div className="ml-2 flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (locked) return;
                                                        buildFromCollection(
                                                            collectionKeys,
                                                        );
                                                    }}
                                                    disabled={locked}
                                                    aria-busy={locked}
                                                    className="inline-flex items-center rounded-md px-2 py-2 text-[13px] bg-accent text-white disabled:opacity-50"
                                                    title="Create editable preview from this snapshot collection"
                                                >
                                                    <span>
                                                        {locked
                                                            ? "In progress"
                                                            : "Generate preview"}
                                                    </span>
                                                    <Hammer
                                                        className={`ml-1 h-4 w-4 ${locked ? "animate-pulse" : ""
                                                            }`}
                                                        aria-hidden
                                                    />
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        discardCollection(group)
                                                    }
                                                    disabled={
                                                        locked ||
                                                        !!deletingCollectionById[
                                                        group.snapshotId
                                                        ]
                                                    }
                                                    aria-busy={
                                                        !!deletingCollectionById[
                                                        group.snapshotId
                                                        ]
                                                    }
                                                    className="inline-flex items-center rounded-md border border-red-200 px-2 py-2 text-[12px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                                    title="Permanently delete this snapshot collection and all related images"
                                                >
                                                    {deletingCollectionById[
                                                        group.snapshotId
                                                    ]
                                                        ? "Deleting…"
                                                        : "Remove"}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                <div>
                                    <GhostActionRow
                                        title={
                                            rescanning ? "Starting…" : "Add / Rescan"
                                        }
                                        subtitle="Captures a fresh screenshot collection."
                                        onClick={rescan}
                                        disabled={
                                            rescanning || !isHttpUrl(targetUrl)
                                        }
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </section>

                {/* Step 3: previews */}
                <section className="mt-10 rounded-3xl border border-neutral-200 bg-white/70 px-4 py-5 sm:px-5 sm:py-6 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="inline-flex items-center gap-2 rounded-full bg-neutral-100 pl-1 pr-3 py-1 text-[20px] mb-4 font-medium text-neutral-600">
                                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-white text-[20px]">
                                    3
                                </span>
                                <span>Website previews</span>
                                {step3Done && (
                                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500" />
                                )}
                            </div>

                        </div>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                        These are the concept sites generated from your chosen
                        snapshot.
                    </p>

                    {renders.length === 0 ? (
                        <>
                            <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 flex flex-wrap items-center gap-2 my-4">
                                <div className="flex items-center gap-1 p-2">
                                    <strong className="inline-flex items-center gap-2 text-neutral-800 font-semibold">
                                        {step3Done ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                        ) : (
                                            <Timer className="h-4 w-4 text-orange-400" />
                                        )}
                                        <span>Step 3</span>
                                    </strong>
                                    <span className="text-neutral-800">
                                        — Generate a preview from your screenshot
                                        collection options above.
                                    </span>
                                </div>
                            </div>
                            <div className="mt-1 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 my-4">
                                No previews yet.
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 flex flex-wrap items-center gap-1 my-4">
                                <strong className="text-neutral-800 font-semibold inline-flex items-center gap-1">
                                    {step3Done ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                        <Timer className="h-4 w-4 text-orange-400" />
                                    )}
                                    Step 3
                                </strong>

                                {step4Done ? (
                                    <>
                                        <span>
                                            — Your render has been deployed. Modify your
                                            website by clicking{" "}
                                        </span>

                                        <button
                                            type="button"
                                            className="mx-1 inline-flex items-center rounded-md border border-neutral-400 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm"
                                            disabled
                                        >
                                            View Deployment
                                            <Rocket className="ml-1 h-3 w-3" />
                                        </button>
                                        <span>below.</span>
                                    </>
                                ) : step3Done ? (
                                    <>
                                        <span>
                                            — Customize your website preview. When it's
                                            ready, click{" "}
                                        </span>

                                        <button
                                            type="button"
                                            className="inline-flex items-center rounded-md border border-neutral-400 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm"
                                            disabled
                                        >
                                            Deploy
                                            <Rocket className="ml-1 h-3 w-3" />
                                        </button>
                                    </>
                                ) : (
                                    <span className="text-neutral-800">
                                        — Generate a preview from one of your screenshot
                                        collections above.
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
                                        isDeleting={!!deletingRender[r.id]}
                                        isOpening={loading}
                                        hardLocked={
                                            !!lockUntilByRender[r.id] &&
                                            lockUntilByRender[r.id] > Date.now()
                                        }
                                        isDeploying={deployingRenderId === r.id}
                                        deployLocked={userTier === "free"}
                                        urlHash={(docData?.urlHash as string | undefined) ?? null}
                                        continueRender={continueRender}
                                        discardRender={discardRender}
                                        startDeployWizard={startDeployWizard}
                                        setShowCreditsPaywall={setShowCreditsPaywall}
                                        push={push as any}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </section>

                {/* subtle spacer at bottom */}
                <div className="mt-16">
                    <div className="mb-4 flex items-center gap-2">
                        <div className="h-px flex-1 bg-neutral-200/70" />
                        <div className="h-px flex-1 bg-neutral-200/70" />
                    </div>
                </div>

                {/* editor overlay */}
                {editorOpen && (
                    <PreviewEditor
                        initialHtml={editorHtml}
                        sourceImage={editorRefImg}
                        onClose={() => {
                            setEditorOpen(false);
                            setActiveRenderId(undefined);
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
                                    r.id === activeRenderId ? { ...r, html } : r,
                                ),
                            );
                        }}
                    />
                )}

                {/* deploy wizard */}
                {deployWizardOpen && (
                    <div className="fixed inset-0 z-[11500]">
                        <div
                            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                            onClick={closeDeployWizard}
                        />
                        <div className="absolute inset-0 flex items-center justify-center px-4 sm:px-6">
                            <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl">
                                <button
                                    type="button"
                                    onClick={closeDeployWizard}
                                    className="absolute right-3 top-3 z-10 h-7 w-7 rounded-full border border-neutral-200 bg-white text-xs text-neutral-500 hover:bg-neutral-50"
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
                                                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                                                    First deploy wizard
                                                </p>
                                                <p className="text-sm font-semibold text-neutral-900">
                                                    Get this preview ready to go live
                                                </p>
                                            </div>
                                        </div>
                                        <span className="mt-6 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] font-medium text-neutral-600">
                                            Step {deployWizardStep} of 3
                                        </span>
                                    </div>

                                    {deployWizardStep === 1 && (
                                        <div className="space-y-4">
                                            <p className="text-xs text-neutral-600">
                                                Name your Vercel project. This becomes the
                                                base for your live URL and deployment.
                                            </p>
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-medium text-neutral-700">
                                                    Project name
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        autoFocus
                                                        onChange={(e) =>
                                                            setDeployWizardProjectName(
                                                                e.target.value,
                                                            )
                                                        }
                                                        placeholder="e.g. kloner-landing, client-site-01"
                                                        className="mt-0.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[rgba(245,95,42,0.6)] focus:border-transparent"
                                                    />
                                                    <span className="text-[11px] text-neutral-600">
                                                        .vercel.app
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="mt-4 flex items-center justify-between gap-2">
                                                <button
                                                    type="button"
                                                    onClick={closeDeployWizard}
                                                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setDeployWizardStep(2)
                                                    }
                                                    disabled={
                                                        !deployWizardProjectName.trim()
                                                    }
                                                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                                                    style={{ backgroundColor: ACCENT }}
                                                >
                                                    Continue
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {deployWizardStep === 2 && (
                                        <div className="space-y-4">
                                            {vercelStatus === "connected" ? (
                                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 flex items-center gap-2">
                                                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white border border-emerald-200">
                                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-neutral-900">
                                                            Vercel connected
                                                        </p>
                                                        <p className="text-[11px] text-emerald-700">
                                                            You&apos;ll be moved to deploy in a moment…
                                                        </p>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <p className="text-xs text-neutral-600">
                                                        Kloner deploys using your saved Vercel integration. Connect once, then future deploys are one click.
                                                    </p>

                                                    {/* <button
                                                        type="button"
                                                        onClick={handleConnectVercelFromWizard}
                                                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                                                        style={{ backgroundColor: ACCENT }}
                                                    >
                                                        Connect Vercel
                                                    </button> */}
                                                </>
                                            )}

                                            <div className="mt-4 flex items-center justify-between gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setDeployWizardStep(1)}
                                                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                                                >
                                                    Back
                                                </button>
                                                {vercelStatus !== "connected" && (
                                                    <button
                                                        type="button"
                                                        onClick={handleConnectVercelFromWizard}
                                                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                                                        style={{ backgroundColor: ACCENT }}
                                                    >
                                                        Connect Vercel
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {deployWizardStep === 3 && (
                                        <div className="space-y-4">
                                            <p className="text-xs text-neutral-600">
                                                We&apos;re sending this preview to Vercel as
                                                a new deployment.
                                            </p>

                                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-xs text-neutral-700 flex items-center gap-3">
                                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900">
                                                    {deployWizardBusy ? (
                                                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                                    ) : deployWizardError ? (
                                                        <span className="text-sm text-red-500">
                                                            !
                                                        </span>
                                                    ) : (
                                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-neutral-900">
                                                        {deployWizardBusy
                                                            ? "Deploying to Vercel…"
                                                            : deployWizardError
                                                                ? "Deploy failed"
                                                                : "Deployment created"}
                                                    </p>
                                                    <p className="text-[11px] text-neutral-600">
                                                        {deployWizardBusy &&
                                                            "This can take up to a minute depending on your project."}
                                                        {!deployWizardBusy &&
                                                            !deployWizardError &&
                                                            "Open the Deployments tab to see build status and your live URL."}
                                                        {deployWizardError &&
                                                            deployWizardError}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="mt-4 flex items-center justify-between gap-2">
                                                <button
                                                    type="button"
                                                    onClick={closeDeployWizard}
                                                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                                                >
                                                    Close
                                                </button>
                                                {!deployWizardBusy && !deployWizardError && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            closeDeployWizard();
                                                            router.push(
                                                                "/dashboard/deployments",
                                                            );
                                                        }}
                                                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                                                        style={{ backgroundColor: ACCENT }}
                                                    >
                                                        View deployments
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <Toasts toasts={toasts} />

                <style>
                    {`@keyframes spin{to{transform:rotate(360deg)}}`}
                </style>

                {/* screenshot viewer */}
                {viewerOpen && shots[viewerIdx] && (
                    <div className="fixed inset-0 z-[10000]">
                        <div
                            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                            onClick={closeViewer}
                        />
                        <div className="absolute inset-0 p-4 sm:p-6 md:p-8 grid place-items-center">
                            <div className="relative w-full h-full max-w-[min(95vw,1400px)]">
                                <div className="absolute top-0 bg-black/70 h-20 left-0 right-0 z-10 flex items-center justify-between gap-2 p-2 sm:p-3">
                                    <div className="text-[11px] sm:text-xs text-white/80 truncate">
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
                )}

                {/* generic paywall */}
                {showCreditsPaywall && (
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
                                <p className="text-xs text-neutral-600 mb-3">
                                    {showCreditsPaywall === "screenshot" &&
                                        "You have used all monhtly screenshot credits. Upgrade to capture more pages and monitor more sites."}
                                    {showCreditsPaywall === "preview" &&
                                        "You have used all monhtly preview credits. Upgrade to generate more designs and unlock one-click deploy."}
                                    {showCreditsPaywall === "deploy" &&
                                        "To deploy your website live, upgrade to a paid plan to unlock one-click deploy."}
                                </p>
                                <ul className="mb-4 list-disc list-inside text-xs text-neutral-700 space-y-1">
                                    <li>
                                        Higher monthly limits for screenshots and previews
                                    </li>
                                    <li>
                                        Unlock deploy to Vercel and live URLs
                                    </li>
                                    <li>Priority rendering and faster queues</li>
                                </ul>
                                <div className="flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowCreditsPaywall(null)}
                                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
                                    >
                                        Not now
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowCreditsPaywall(null);
                                            router.push("/price");
                                        }}
                                        className="rounded-md px-3 py-1.5 text-xs font-semibold text-white"
                                        style={{ backgroundColor: ACCENT }}
                                    >
                                        View upgrade options
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {showUpgradeAfterCustomize && (
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
                                                <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                                                    You just customized a live preview
                                                </p>
                                            </div>
                                        </div>

                                        <span className="whitespace-nowrap rounded-full border border-white/10 bg-neutral-900/80 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                                            Pro upgrade
                                        </span>
                                    </div>

                                    <h3 className="text-2xl mb-4  font-semibold tracking-tight text-white">
                                        Turn this preview into a real, live site
                                    </h3>
                                    {/* Value stack */}
                                    <div className="mb-4 grid gap-2 text-xs sm:text-[13px] text-neutral-200">
                                        <div className="flex items-start gap-2.5">
                                            <div
                                                className="mt-[3px] h-2 w-2 rounded-full"
                                                style={{ backgroundColor: ACCENT }}
                                            />
                                            <div>
                                                <p className="font-medium text-white">
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
                                                <p className="font-medium text-white">
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
                                                <p className="font-medium text-white">
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
                                        <p className="mb-1 font-medium text-neutral-100">
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
                                            className="flex w-full items-center justify-center rounded-xl px-4 py-2 text-[11px] font-medium text-neutral-400 hover:bg-neutral-900/70 hover:text-neutral-200 transition"
                                        >
                                            Keep editing for now
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* deploy next-steps banner */}
                {showDeployNextSteps && (
                    <div className="fixed bottom-4 left-1/2 z-[9000] -translate-x-1/2 px-4">
                        <div className="max-w-xl rounded-2xl border border-neutral-400 bg-white shadow-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 text-xs sm:text-sm text-neutral-800">
                            <div className="flex-1">
                                <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-800">
                                    <CheckCircle2 className="text-green-600" />
                                    <span>New deployment in progress</span>
                                </div>
                                <p className="mt-1 text-[11px] sm:text-xs text-neutral-600">
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
                                    className="rounded-md px-3 py-1.5 text-[11px] sm:text-xs text-white"
                                    style={{ backgroundColor: ACCENT }}
                                >
                                    Open deployments
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowDeployNextSteps(false)}
                                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-[11px] sm:text-xs text-neutral-700 hover:bg-neutral-50"
                                >
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}
