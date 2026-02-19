// src/app/dashboard/deployments/page.tsx
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import {
    collection,
    query,
    orderBy,
    limit,
    onSnapshot,
    where,
    getDocs,
    doc,
    setDoc,
    updateDoc,
    serverTimestamp,
    type QueryDocumentSnapshot,
    type DocumentData,
    type QuerySnapshot,
    getDoc,
} from "firebase/firestore";
import {
    ArrowUpRight,
    Clock,
    CheckCircle2,
    AlertTriangle,
    Rocket,
    RefreshCw,
    Code2,
    Loader2,
    BrushIcon,
} from "lucide-react";
import type { Device, SeoMeta, ViewMode } from "@/components/editor/PreviewEditor";
import PreviewEditorManager from "@/components/editor/PreviewEditorManager";
import { ensureSessionAndCsrf } from "@/lib/auth-client";
import {
    extractArchivedPageIdsFromRender,
    fetchRenderForDeployment,
    formatDate,
    getArchivedRoutesForRender,
    normalizeKlonerPaddingForExport,
    persistArchivedPageIds,
    scrubArchivedRoutes,
    secureHtmlForPreviewIframe,
    withArchivedPageIds,
} from "@/components/helpers";
import { RenderDoc } from "../view/DashboardView";

const ACCENT = "#f55f2a";

export type DeploymentDoc = {
    vercelDeploymentId: string;
    vercelProjectId?: string | null;
    vercelProjectName?: string | null;
    vercelUrl?: string | null; // raw deployment URL, e.g. https://crumbs-xyz.vercel.app
    vercelState?: string | null;
    vercelTeamId?: string | null;
    vercelUserId?: string | null;
    configurationId?: string | null;
    lastEventType?: string | null;
    lastEventId?: string | null;
    lastEventAt?: any;
    createdAt?: any;
    updatedAt?: any;
    vercelReadyState?: string | null;
    vercelTarget?: string | null;
    vercelMeta?: Record<string, any> | null;

    // NEW canonical fields written by user-deploy
    publicDomain?: string | null; // e.g. crumbs-eight.vercel.app
    publicUrl?: string | null; // e.g. https://crumbs-eight.vercel.app
};

type ActionState = {
    [deploymentKey: string]: {
        redeployLoading?: boolean;
        redeployError?: string | null;
        customLoading?: boolean;
        customError?: string | null;
    };
};

type ProjectGroup = {
    key: string;
    projectId: string | null;
    projectName: string;
    sampleUrl: string | null;
    count: number;
};

type UiState =
    | "active"
    | "ready"
    | "offline"
    | "building"
    | "error"
    | "canceled"
    | "unknown";

type VercelIntegration = {
    vercelTeamId?: string | null;
    vercelUserId?: string | null;
    configurationId?: string | null;
};


function stateColor(state?: UiState | string | null): string {
    const s = (state || "").toLowerCase();

    if (s === "active" || s === "ready")
        return "bg-emerald-50 text-emerald-700 border-emerald-200";

    if (s === "offline")
        return "bg-neutral-50 text-neutral-500 border-neutral-200";

    if (s === "error" || s === "failed")
        return "bg-red-50 text-red-700 border-red-200";

    if (s === "canceled" || s === "cancelled")
        return "bg-rose-50 text-rose-700 border-rose-200";

    if (s === "building" || s === "queued" || s === "pending")
        return "bg-amber-50 text-amber-700 border-amber-200";

    return "bg-neutral-50 text-neutral-600 border-neutral-200";
}

/**
 * Canonicalize state for UI using Vercel fields + lastEventType.
 */
function deriveStateFromDoc(d?: DeploymentDoc | null): UiState {
    if (!d) return "unknown";

    const candidates: string[] = [];

    if (d.vercelReadyState) candidates.push(d.vercelReadyState.toLowerCase());
    if (d.vercelState) candidates.push(d.vercelState.toLowerCase());
    if (d.lastEventType) candidates.push(d.lastEventType.toLowerCase());

    const text = candidates.join(" ");

    if (/error|failed|fail/.test(text)) return "error";
    if (/cancel/.test(text)) return "canceled";
    if (/queue|pending|build/.test(text)) return "building";
    if (/ready|succeed|promoted|complete|completed/.test(text)) return "ready";

    if (d.vercelReadyState || d.vercelState || d.lastEventType) {
        return "building";
    }

    return "unknown";
}

/**
 * Project grouping key for resolving "active" vs "offline".
 */
function projectKeyForDeployment(d: DeploymentDoc): string {
    const pid = d.vercelProjectId || "no-id";
    const pname = d.vercelProjectName || "Unknown project";
    return `${pid}::${pname}`;
}

/**
 * Lift base state to UI state with "active" / "offline" using per-project latest ready deployment.
 */
function toUiState(
    d: { vercelDeploymentId?: string | null } & DeploymentDoc,
    latestReadyByProject: Map<string, string>
): UiState {
    const base = deriveStateFromDoc(d);

    if (base !== "ready") return base;

    const projKey = projectKeyForDeployment(d);
    const latestId = latestReadyByProject.get(projKey);

    if (!latestId) return "ready";

    if (latestId === d.vercelDeploymentId) {
        return "active";
    }

    return "offline";
}

export default function DeploymentsPage(): JSX.Element {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<Array<{ id: string } & DeploymentDoc>>([]);
    const [showDeployHint, setShowDeployHint] = useState(false);
    const [activeRenderId, setActiveRenderId] = useState<string | undefined>(
        undefined
    );
    const [activeArchivedPageIds, setActiveArchivedPageIds] = useState<string[]>(
        []
    );
    const [activeSeoMetaByPage, setActiveSeoMetaByPage] = useState<
        Record<string, SeoMeta> | null
    >(null);
    const [renders, setRenders] = useState<Array<{ id: string } & RenderDoc>>([]);
    const [hasNewFlag, setHasNewFlag] = useState(false);
    const [hasNewMeta, setHasNewMeta] = useState<{
        url?: string;
        projectName?: string | null;
        projectId?: string | null;
    } | null>(null);

    const [actionState, setActionState] = useState<ActionState>({});

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorHtml, setEditorHtml] = useState<string>("");
    const [editorRefImg, setEditorRefImg] = useState<string | undefined>(
        undefined
    );
    const [editorDraftId, setEditorDraftId] = useState<string | null>(null);
    const [activeDeployment, setActiveDeployment] =
        useState<({ id: string } & DeploymentDoc) | null>(null);
    const [editorLoadingId, setEditorLoadingId] = useState<string | null>(null);

    // keeps latest HTML coming from PreviewEditor (visual export) per renderId
    const [htmlDrafts, setHtmlDrafts] = useState<Record<string, string>>({});

    const BUILDING_STATES = ["building", "queued", "pending"];

    const [selectedProjectKey, setSelectedProjectKey] =
        useState<string>("all");

    const [refreshing, setRefreshing] = useState(false);
    const [lastGlobalCheck, setLastGlobalCheck] = useState<Date | null>(null);
    const [refreshError, setRefreshError] = useState<string | null>(null);

    const [vercelIntegration, setVercelIntegration] =
        useState<VercelIntegration | null>(null);

    const handleArchivedPageIdsChange = useCallback(
        async (ids: string[]) => {
            console.log("[Deployments] handleArchivedPageIdsChange", {
                renderId: activeRenderId,
                ids,
            });

            setActiveArchivedPageIds(ids);

            if (!user || !activeRenderId) {
                console.warn(
                    "[Deployments] handleArchivedPageIdsChange missing user or activeRenderId",
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
        if (!showDeployHint) return;
        const id = setTimeout(() => setShowDeployHint(false), 10000);
        return () => clearTimeout(id);
    }, [showDeployHint]);

    useEffect(() => {
        const off = onAuthStateChanged(auth, (u) => {
            setUser(u);
        });
        return () => off();
    }, []);

    // Load Vercel integration (team/user IDs) for domain link
    useEffect(() => {
        if (!user) {
            setVercelIntegration(null);
            return;
        }

        const integRef = doc(
            db,
            "kloner_users",
            user.uid,
            "integrations",
            "vercel"
        );

        getDoc(integRef)
            .then((snap) => {
                if (!snap.exists()) {
                    setVercelIntegration(null);
                    return;
                }
                const data = snap.data() as any;
                setVercelIntegration({
                    vercelTeamId: data.vercelTeamId ?? null,
                    vercelUserId: data.vercelUserId ?? null,
                    configurationId: data.configurationId ?? null,
                });
            })
            .catch(() => {
                setVercelIntegration(null);
            });
    }, [user]);

    useEffect(() => {
        if (!user) {
            setItems([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const col = collection(db, "kloner_users", user.uid, "deployments");
        const qy = query(col, orderBy("createdAt", "desc"), limit(100));

        const off = onSnapshot(
            qy,
            (snap) => {
                const next: Array<{ id: string } & DeploymentDoc> = snap.docs.map(
                    (d: QueryDocumentSnapshot<DocumentData>) =>
                    ({
                        id: d.id,
                        ...(d.data() as DeploymentDoc),
                    } as any)
                );
                setItems(next);
                setLoading(false);
            },
            () => {
                setItems([]);
                setLoading(false);
            }
        );

        return () => off();
    }, [user]);

    useEffect(() => {
        try {
            const raw =
                typeof window !== "undefined"
                    ? localStorage.getItem("kloner.deployments.hasNew")
                    : null;
            if (!raw) return;
            const parsed = JSON.parse(raw) as {
                ts?: number;
                url?: string;
                projectId?: string | null;
                projectName?: string | null;
            };
            setHasNewFlag(true);
            setHasNewMeta({
                url: parsed.url,
                projectName: parsed.projectName ?? null,
                projectId: parsed.projectId ?? null,
            });
            localStorage.removeItem("kloner.deployments.hasNew");
        } catch {
            // ignore
        }
    }, []);

    // derive project/url groups for dropdown
    const projectGroups: ProjectGroup[] = useMemo(() => {
        if (items.length === 0) return [];
        const map = new Map<string, ProjectGroup>();

        for (const d of items) {
            const pid = d.vercelProjectId || "no-id";
            const pname = d.vercelProjectName || "Unknown project";
            const key = `${pid}::${pname}`;

            const existing = map.get(key);
            const displayUrl = d.publicUrl || d.vercelUrl || null;

            if (!existing) {
                let hostname: string | null = null;

                if (displayUrl) {
                    try {
                        hostname = new URL(displayUrl).hostname;
                    } catch {
                        hostname = displayUrl;
                    }
                }

                map.set(key, {
                    key,
                    projectId: d.vercelProjectId ?? null,
                    projectName: pname,
                    sampleUrl: hostname,
                    count: 1,
                });
            } else {
                existing.count += 1;
                if (!existing.sampleUrl && displayUrl) {
                    try {
                        existing.sampleUrl = new URL(displayUrl).hostname;
                    } catch {
                        existing.sampleUrl = displayUrl;
                    }
                }
            }
        }

        return Array.from(map.values()).sort((a, b) =>
            a.projectName.localeCompare(b.projectName)
        );
    }, [items]);

    useEffect(() => {
        if (projectGroups.length === 0) {
            setSelectedProjectKey("all");
            return;
        }
        if (selectedProjectKey === "all") return;
        const stillExists = projectGroups.some(
            (g) => g.key === selectedProjectKey
        );
        if (!stillExists) {
            setSelectedProjectKey("all");
        }
    }, [projectGroups, selectedProjectKey]);

    const scopedItems = useMemo(() => {
        if (selectedProjectKey === "all") return items;
        return items.filter((d) => {
            const pid = d.vercelProjectId || "no-id";
            const pname = d.vercelProjectName || "Unknown project";
            const key = `${pid}::${pname}`;
            return key === selectedProjectKey;
        });
    }, [items, selectedProjectKey]);

    const latestReadyByProject = useMemo(() => {
        const map = new Map<string, string>();

        for (const d of scopedItems) {
            const baseState = deriveStateFromDoc(d);
            if (baseState !== "ready") continue;
            if (!d.vercelDeploymentId) continue;

            const key = projectKeyForDeployment(d);
            if (!map.has(key)) {
                map.set(key, d.vercelDeploymentId);
            }
        }

        return map;
    }, [scopedItems]);

    // 30s polling
    useEffect(() => {
        if (!user || scopedItems.length === 0) return;

        const buildingIds = scopedItems
            .filter((d) => BUILDING_STATES.includes(deriveStateFromDoc(d)))
            .map((d) => d.vercelDeploymentId)
            .filter(Boolean)
            .slice(0, 10);

        if (buildingIds.length === 0) return;

        let id: number | undefined;

        (async () => {
            const csrf = await ensureSessionAndCsrf();

            const hitApi = () => {
                void fetch("/api/vercel/refresh-deployments", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    body: JSON.stringify({ deploymentIds: buildingIds }),
                }).catch(() => {
                    // ignore
                });
            };

            hitApi();
            id = window.setInterval(hitApi, 30_000);
        })();

        return () => {
            if (id !== undefined) {
                window.clearInterval(id);
            }
        };
    }, [user, scopedItems]);

    const total = scopedItems.length;

    const readyCount = useMemo(
        () =>
            scopedItems.filter((d) => {
                const s = deriveStateFromDoc(d);
                return s === "ready";
            }).length,
        [scopedItems]
    );

    const latestFromPreview = useMemo(() => {
        if (!hasNewMeta || scopedItems.length === 0) return null;

        return (
            scopedItems.find(
                (d) =>
                    (hasNewMeta.projectId &&
                        d.vercelProjectId === hasNewMeta.projectId) ||
                    (hasNewMeta.projectName &&
                        d.vercelProjectName === hasNewMeta.projectName)
            ) || null
        );
    }, [hasNewMeta, scopedItems]);

    const latestState = deriveStateFromDoc(latestFromPreview || undefined);
    const isErrorState = latestState === "error";
    const isSuccessState = latestState === "ready";

    type BannerVariant = "pending" | "success" | "error";
    const bannerVariant: BannerVariant = isErrorState
        ? "error"
        : isSuccessState
            ? "success"
            : "pending";

    const bannerClasses =
        bannerVariant === "error"
            ? "border-red-200 bg-red-50 text-red-700"
            : bannerVariant === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-neutral-200 bg-neutral-50 text-neutral-700";

    const latestPublicUrl =
        latestFromPreview?.publicUrl ||
        latestFromPreview?.vercelUrl ||
        hasNewMeta?.url ||
        undefined;

    function updateActionState(
        key: string,
        patch: Partial<NonNullable<ActionState[string]>>
    ) {
        setActionState((prev) => ({
            ...prev,
            [key]: {
                ...(prev[key] || {}),
                ...patch,
            },
        }));
    }

    async function handleRedeploy(d: { id: string } & DeploymentDoc) {
        if (!d.vercelDeploymentId) return;
        const key = d.vercelDeploymentId || d.id;

        updateActionState(key, { redeployLoading: true, redeployError: null });

        try {
            const res = await fetch("/api/vercel/redeploy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    vercelDeploymentId: d.vercelDeploymentId,
                    vercelProjectId: d.vercelProjectId ?? null,
                    vercelProjectName: d.vercelProjectName ?? null,
                    vercelTeamId: d.vercelTeamId ?? null,
                }),
            });

            const json = await res.json().catch(() => ({} as any));
            if (!res.ok || !json?.ok) {
                throw new Error(json?.error || "Redeploy failed");
            }

            if (typeof window !== "undefined") {
                localStorage.setItem(
                    "kloner.deployments.hasNew",
                    JSON.stringify({
                        ts: Date.now(),
                        url: json.url || null,
                        projectId: json.projectId || d.vercelProjectId || null,
                        projectName:
                            json.projectName || d.vercelProjectName || null,
                    })
                );
            }
        } catch (e: any) {
            updateActionState(key, {
                redeployError: e?.message || "Failed to redeploy",
            });
        } finally {
            updateActionState(key, { redeployLoading: false });
        }
    }



    async function openEditorForDeployment(d: { id: string } & DeploymentDoc) {
        if (!user) return;

        const key = d.vercelDeploymentId || d.id;

        setEditorLoadingId(key);
        updateActionState(key, { customError: null });

        try {
            const render = await fetchRenderForDeployment({
                uid: user.uid,
                deployment: d,
            });

            const initialHtml = render.html;
            const refImg = render.referenceImage;
            const draftId = render.id;
            const seoMap = render.seoMetaByPage ?? null;

            // NEW: push archived ids into local state used by PreviewEditor
            setActiveArchivedPageIds(
                render.archivedPageIds?.filter(
                    (v) => typeof v === "string" && v.trim().length > 0
                ) ?? []
            );

            // keep renders cache in sync if you want it elsewhere
            setRenders((prev) => {
                const existing = prev.find((r) => r.id === draftId);
                const merged: { id: string } & RenderDoc = {
                    ...(existing || ({} as any)),
                    id: draftId,
                    html: initialHtml,
                    referenceImage: refImg ?? existing?.referenceImage ?? null,
                    seoMetaByPage: seoMap ?? existing?.seoMetaByPage ?? null,
                    archivedPageIds:
                        render.archivedPageIds ??
                        (existing as any)?.archivedPageIds ??
                        [],
                };
                if (existing) {
                    return prev.map((r) => (r.id === draftId ? merged : r));
                }
                return [...prev, merged];
            });

            // HTML draft cache (visual-export version)
            setHtmlDrafts((prev) => ({
                ...prev,
                [draftId]: initialHtml,
            }));

            setActiveDeployment(d);
            setEditorHtml(initialHtml);
            setEditorRefImg(refImg);
            setEditorDraftId(draftId);

            setActiveRenderId(draftId);
            setActiveSeoMetaByPage(seoMap);

            setEditorOpen(true);
        } catch (e: any) {
            updateActionState(key, {
                customError:
                    e?.message ||
                    "Failed to open editor. No valid reference render is attached to this deployment.",
            });

            setEditorOpen(false);
            setActiveDeployment(null);
            setEditorHtml("");
            setEditorDraftId(null);
            setEditorRefImg(undefined);
            setActiveRenderId(undefined);
            setActiveSeoMetaByPage(null);
            setActiveArchivedPageIds([]);
        } finally {
            setEditorLoadingId(null);
        }
    }

    async function exportToVercel(opts: {
        html: string;
        name?: string;
        renderId?: string;
    }) {
        if (!activeDeployment) return;

        const key = activeDeployment.vercelDeploymentId || activeDeployment.id;
        const projectName =
            opts.name ||
            activeDeployment.vercelProjectName ||
            activeDeployment.vercelProjectId ||
            "kloner-site";

        // resolve the render id this export is tied to
        const resolvedRenderId = (opts.renderId ?? editorDraftId) ?? null;

        // derive archived routes for this render and scrub them out of the HTML
        const archivedRoutes = getArchivedRoutesForRender(resolvedRenderId, renders);
        const scrubbedHtml = scrubArchivedRoutes(opts.html, archivedRoutes);

        // NEW: normalize device-specific padding for the live, responsive version
        const normalizedHtml = normalizeKlonerPaddingForExport(scrubbedHtml);

        updateActionState(key, { customLoading: true, customError: null });

        const csrf = await ensureSessionAndCsrf();

        try {
            const res = await fetch("/api/user-deploy", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({
                    html: normalizedHtml,
                    projectName,
                    renderId: resolvedRenderId,
                    vercelProjectId: activeDeployment.vercelProjectId ?? null,
                    vercelProjectName: activeDeployment.vercelProjectName ?? null,
                }),
            });

            const json = await res.json().catch(() => ({} as any));
            if (!res.ok || !json?.ok) {
                throw new Error(json?.error || "Custom HTML deploy failed");
            }

            if (typeof window !== "undefined") {
                localStorage.setItem(
                    "kloner.deployments.hasNew",
                    JSON.stringify({
                        ts: Date.now(),
                        url: json.url || null,
                        projectId:
                            json.projectId ||
                            activeDeployment.vercelProjectId ||
                            null,
                        projectName:
                            json.projectName ||
                            activeDeployment.vercelProjectName ||
                            projectName,
                    }),
                );
            }

            setEditorOpen(true);
            setActiveDeployment(null);
            setEditorHtml("");
            setEditorDraftId(null);
            setEditorRefImg(undefined);
        } catch (e: any) {
            updateActionState(key, {
                customError: e?.message || "Failed to deploy custom HTML",
            });
        } finally {
            updateActionState(key, { customLoading: false });
        }
    }

    const handleSaveDraft = async (payload: {
        draftId?: string;
        html: string;
        meta?: { nameHint?: string; device: Device; mode: ViewMode };
        version: number;
    }) => {
        if (!user) return;

        const rid = payload.draftId || editorDraftId;
        if (!rid) return;

        const trimmedNameHint =
            typeof payload.meta?.nameHint === "string"
                ? payload.meta.nameHint.trim()
                : "";

        try {
            await setDoc(
                doc(db, "kloner_users", user.uid, "kloner_renders", rid),
                {
                    html: payload.html,
                    referenceImage: editorRefImg || null,
                    nameHint: trimmedNameHint || null,
                    version: payload.version || 1,
                    updatedAt: serverTimestamp(),
                    // do not touch archived or archivedPageIds here
                },
                { merge: true }
            );

            // persist visual HTML into local draft cache
            setHtmlDrafts((prev) => ({
                ...prev,
                [rid]: payload.html,
            }));

            if (editorDraftId === rid) {
                setEditorHtml(payload.html);
            }
        } catch {
            // PreviewEditor UX handles failures
        }
    };

    async function refreshFromVercel() {
        if (!user) return;
        const ids = scopedItems
            .map((d) => d.vercelDeploymentId)
            .filter(Boolean)
            .slice(0, 50);

        if (ids.length === 0) return;

        setRefreshing(true);
        setRefreshError(null);

        const csrf = await ensureSessionAndCsrf();

        try {
            const res = await fetch("/api/vercel/refresh-deployments", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ deploymentIds: ids }),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => ({} as any));
                throw new Error(
                    json?.error || "Failed to refresh from Vercel"
                );
            }
            setLastGlobalCheck(new Date());
        } catch (e: any) {
            setRefreshError(
                e?.message || "Failed to refresh from Vercel"
            );
        } finally {
            setRefreshing(false);
        }
    }

    const latestDeployment = scopedItems[0] || null;
    const history = scopedItems.slice(1);

    return (
        <main className="min-h-screen bg-white">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-8">
                <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                    <span>Kloner · Deployments</span>
                </div>

                <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">

                    <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-8 sm:px-8 sm:py-10 shadow-sm">
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                                    Deployments
                                </h1>
                            </div>
                            <p className="max-w-2xl text-sm text-neutral-600">
                                Deployments to Vercel show up here, with status kept up to date.
                            </p>
                        </div>
                    </div>


                    <div className="flex flex-col items-end gap-3">
                        {projectGroups.length > 0 && (
                            <div className="w-full sm:w-64">
                                <label className="block text-sm  text-neutral-500 mb-1">
                                    Project / URL scope
                                </label>
                                <select
                                    value={selectedProjectKey}
                                    onChange={(e) =>
                                        setSelectedProjectKey(e.target.value)
                                    }
                                    className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm sm:text-xs text-neutral-800 shadow-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                                >
                                    <option value="all">
                                        All projects ({items.length} deployment
                                        {items.length === 1 ? "" : "s"})
                                    </option>
                                    {projectGroups.map((g) => (
                                        <option key={g.key} value={g.key}>
                                            {g.projectName}
                                            {g.sampleUrl
                                                ? ` · ${g.sampleUrl}`
                                                : ""}{" "}
                                            ({g.count})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="inline-flex flex-col items-end gap-1 text-right">
                            <div className="inline-flex items-center gap-2 text-xs text-neutral-600">
                                <Rocket className="h-3.5 w-3.5 text-neutral-500" />
                                <span>
                                    {total} deployment
                                    {total === 1 ? "" : "s"} in view
                                </span>
                            </div>
                            <div className="inline-flex items-center gap-2 text-xs text-neutral-600">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                <span>{readyCount} live / ready</span>
                            </div>

                            <div className="mt-2 flex flex-col items-end gap-1">
                                {refreshError && (
                                    <div className="text-[10px] text-red-600 max-w-[220px] text-right">
                                        {refreshError}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </header>

                {loading ? (
                    <div className="space-y-4">
                        <div className="h-40 rounded-xl bg-neutral-100 animate-pulse" />
                        <div className="h-40 rounded-xl bg-neutral-100 animate-pulse" />
                    </div>
                ) : scopedItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-4 text-sm text-neutral-700">
                        <div className="flex items-center gap-2 text-neutral-800 font-semibold mb-1">
                            <Clock className="h-4 w-4 text-neutral-500" />
                            <span>No deployments in this scope yet</span>
                        </div>
                        <p className="text-xs text-neutral-600">
                            Trigger a deployment from the Preview Builder.
                            Kloner will use the Vercel API to pull in status
                            and history for the selected project / URL.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Latest deployment card */}
                        {latestDeployment &&
                            (() => {
                                const d = latestDeployment;
                                const created = formatDate(d.createdAt);
                                const updated = formatDate(
                                    d.updatedAt || d.lastEventAt
                                );
                                const state = toUiState(
                                    d,
                                    latestReadyByProject
                                );
                                const stateStyles = stateColor(state);
                                const projectName =
                                    d.vercelProjectName ||
                                    d.vercelProjectId ||
                                    "Untitled project";
                                const key =
                                    d.vercelDeploymentId || d.id;
                                const act = actionState[key] || {};
                                const isCustomLoading = !!act.customLoading;
                                const isEditorLoading =
                                    editorLoadingId === key;
                                const displayUrl =
                                    d.publicUrl ||
                                    (d.publicDomain
                                        ? `https://${d.publicDomain}`
                                        : null) ||
                                    d.vercelUrl ||
                                    null;

                                // Build Vercel domains link for this deployment
                                let domainsHref: string | null = null;
                                if (displayUrl) {
                                    let hostname = displayUrl;
                                    try {
                                        hostname = new URL(displayUrl).hostname;
                                    } catch {
                                        // keep raw string
                                    }

                                    const params = new URLSearchParams();

                                    // prefill domain search with this deployment's hostname
                                    params.set("q", hostname);

                                    // prefer per-deployment team id, fall back to integration
                                    const teamId =
                                        d.vercelTeamId || vercelIntegration?.vercelTeamId || null;
                                    if (teamId) {
                                        params.set("teamId", teamId);
                                    }

                                    const qs = params.toString();
                                    domainsHref = `https://vercel.com/domains${qs ? `?${qs}` : ""}`;
                                }


                                return (
                                    <section aria-label="Latest deployment">
                                        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500 mb-2">
                                            Latest deployment
                                        </h3>
                                        <article className="rounded-2xl border border-neutral-200 bg-white shadow-sm p-5 flex flex-col gap-3">
                                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-lg font-semibold text-neutral-900 truncate mb-2">
                                                            {projectName}
                                                        </div>
                                                    </div>
                                                    <div className="mt-1 text-xs text-neutral-500 break-all">
                                                        {displayUrl ||
                                                            "URL pending"}
                                                    </div>
                                                    {domainsHref && (
                                                        <div className="mt-1 text-[11px] text-neutral-500">
                                                            <a
                                                                href={domainsHref}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-800 hover:text-neutral-900 underline underline-offset-2"
                                                            >
                                                                <span>Apply a custom domain in Vercel</span>
                                                                <ArrowUpRight className="h-3 w-3" />
                                                            </a>
                                                        </div>
                                                    )}
                                                </div>

                                                <div
                                                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs  ${stateStyles}`}
                                                >
                                                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                                                    <span className="capitalize">
                                                        {state}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                                                <div className="inline-flex items-center gap-1.5">
                                                    <Clock className="h-3 w-3" />
                                                    <span>
                                                        Created{" "}
                                                        {created || "–"}
                                                        {updated && (
                                                            <span className="ml-1 text-neutral-400">
                                                                · Updated{" "}
                                                                {updated}
                                                            </span>
                                                        )}
                                                    </span>
                                                </div>
                                                {d.lastEventType && (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <span className="h-1 w-1 rounded-full bg-neutral-300" />
                                                        <span>
                                                            Last event:{" "}
                                                            <span className=" text-neutral-700">
                                                                {
                                                                    d.lastEventType
                                                                }
                                                            </span>
                                                        </span>
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap items-center gap-3 mt-1">
                                                {state === "error" && (
                                                    <div className="inline-flex items-center gap-1 text-sm text-red-600">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        <span>
                                                            Check build logs in
                                                            Vercel
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {hasNewFlag && (
                                                <div
                                                    className={[
                                                        "inline-flex w-auto max-w-none whitespace-nowrap rounded-2xl border px-3 py-2 text-sm sm:text-xs shadow-sm",
                                                        bannerClasses,
                                                    ].join(" ")}
                                                >

                                                    <div className="flex items-start gap-2">
                                                        {bannerVariant === "error" ? (
                                                            <AlertTriangle className="h-4 w-4 text-red-500" />
                                                        ) : bannerVariant === "success" ? (
                                                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                                        ) : (
                                                            <Rocket className="h-4 w-4 text-neutral-500" />
                                                        )}

                                                        <div className="flex-1">
                                                            <div className="font-semibold">
                                                                {bannerVariant === "error"
                                                                    ? "Deployment failed"
                                                                    : bannerVariant === "success"
                                                                        ? "Deployment finished"
                                                                        : "Deployment started"}
                                                            </div>

                                                            <p className="leading-relaxed text-neutral-600">
                                                                {bannerVariant === "error"
                                                                    ? "Vercel reported an error. Check the build logs."
                                                                    : bannerVariant === "success"
                                                                        ? ""
                                                                        : "We’ll keep this status in sync."}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="border-t border-neutral-100 pt-3">
                                                <div className="mt-1 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                openEditorForDeployment(
                                                                    d
                                                                )
                                                            }
                                                            disabled={
                                                                isEditorLoading
                                                            }
                                                            className="group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-white"
                                                            style={{
                                                                backgroundColor:
                                                                    ACCENT,
                                                            }}
                                                        >
                                                            <span>
                                                                Customize
                                                            </span>
                                                            <BrushIcon className="h-3.5 w-3.5 transform transition-transform duration-150 group-hover:-translate-y-0.5" />
                                                        </button>
                                                        <a
                                                            href={
                                                                displayUrl ||
                                                                "#"
                                                            }
                                                            target={
                                                                displayUrl
                                                                    ? "_blank"
                                                                    : undefined
                                                            }
                                                            rel={
                                                                displayUrl
                                                                    ? "noreferrer"
                                                                    : undefined
                                                            }
                                                            className="group inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 hover:bg-neutral-50"
                                                        >
                                                            <span>
                                                                Open site
                                                            </span>
                                                            <ArrowUpRight className="h-3 w-3 transform transition-transform duration-150" />
                                                        </a>
                                                    </div>


                                                    {showDeployHint && (
                                                        <div className="mt-2 max-w-xs rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm">
                                                            <p className="mb-2">
                                                                To deploy edited
                                                                HTML:
                                                            </p>

                                                            <div className="flex flex-col gap-2">
                                                                <button
                                                                    type="button"
                                                                    disabled
                                                                    className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm  text-neutral-800"
                                                                >
                                                                    <span>
                                                                        1. Click
                                                                        <a
                                                                            className="mx-2 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm  text-white cursor-not-allowed"
                                                                            style={{
                                                                                backgroundColor:
                                                                                    ACCENT,
                                                                                boxShadow:
                                                                                    "0 10px 30px rgba(245,95,42,0.40)",
                                                                            }}
                                                                        >
                                                                            {isEditorLoading ? (
                                                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                            ) : (
                                                                                <Code2 className="h-3.5 w-3.5" />
                                                                            )}
                                                                            Open
                                                                            in
                                                                            Preview
                                                                            Editor
                                                                        </a>
                                                                    </span>
                                                                </button>

                                                                <button
                                                                    type="button"
                                                                    disabled
                                                                    className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm  text-neutral-800  whitepace-nowrap "
                                                                >
                                                                    <span>
                                                                        2. Click{" "}
                                                                        <a
                                                                            className={
                                                                                "ml-1 inline-flex items-center gap-2 transition focus:outline-none focus:ring-2 focus:ring-neutral-300 cursor-not-allowed text-sm rounded-md px-3 py-1.5 font-semibold text-white shadow-sm"
                                                                            }
                                                                            style={{
                                                                                backgroundColor:
                                                                                    ACCENT,
                                                                            }}
                                                                        >
                                                                            Export
                                                                            to
                                                                            Vercel
                                                                        </a>{" "}
                                                                        inside
                                                                        the
                                                                        editor
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {(act.customError ||
                                                        act.redeployError) && (
                                                            <p className="mt-1 text-[10px] text-red-600">
                                                                {act.customError ||
                                                                    act.redeployError}
                                                            </p>
                                                        )}

                                                    {isCustomLoading && (
                                                        <p className="mt-1 text-[10px] text-neutral-500 inline-flex items-center gap-1">
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                            <span>
                                                                Pushing custom
                                                                HTML to Vercel…
                                                            </span>
                                                        </p>
                                                    )}

                                                </div>
                                            </div>
                                        </article>
                                    </section>
                                );
                            })()}

                        {/* History rows */}
                        {history.length > 0 && (
                            <section aria-label="Deployment history">
                                <div className="flex items-center justify-between mb-2">
                                    <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                                        History
                                    </h2>
                                    <span className="text-sm text-neutral-400">
                                        {history.length} previous deployment
                                        {history.length === 1 ? "" : "s"}
                                    </span>
                                </div>

                                <p className="text-xs my-3 text-neutral-600">
                                    Your previous deployments will show in the
                                    list below. Use the Vercel API check above
                                    any time you want to force a fresh status
                                    sync.
                                </p>
                                <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
                                    <div className="px-4 py-2 flex items-center text-sm text-neutral-500 border-b border-neutral-100">
                                        <div className="w-[120px]">
                                            Status
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            URL
                                        </div>
                                        <div className="w-[150px] hidden sm:block">
                                            Created
                                        </div>
                                        <div className="w-[160px] hidden md:block">
                                            Last event
                                        </div>
                                        <div className="w-[90px]" />
                                    </div>

                                    <div className="max-h-72 overflow-y-auto">
                                        {history.map((d) => {
                                            const state = toUiState(
                                                d,
                                                latestReadyByProject
                                            );
                                            const stateStyles =
                                                stateColor(state);
                                            const created = formatDate(
                                                d.createdAt
                                            );
                                            const lastEvt =
                                                d.lastEventType || "–";
                                            const displayUrl =
                                                d.publicUrl ||
                                                (d.publicDomain
                                                    ? `https://${d.publicDomain}`
                                                    : null) ||
                                                d.vercelUrl ||
                                                null;

                                            return (
                                                <div
                                                    key={d.id}
                                                    className="px-4 py-2 flex items-center text-sm sm:text-xs text-neutral-700 border-b last:border-b-0 border-neutral-100"
                                                >
                                                    <div className="w-[120px]">
                                                        <span
                                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] text-xs ${stateStyles}`}
                                                        >
                                                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                                                            <span className="capitalize">
                                                                {state}
                                                            </span>
                                                        </span>
                                                    </div>

                                                    <div className="flex-1 min-w-0 pr-2">
                                                        <div className="truncate text-neutral-800">
                                                            {displayUrl ||
                                                                "URL pending"}
                                                        </div>
                                                        <div className="sm:hidden text-[10px] text-neutral-400">
                                                            {created || "–"} ·{" "}
                                                            {lastEvt}
                                                        </div>
                                                    </div>

                                                    <div className="w-[150px] hidden sm:block text-neutral-500">
                                                        {created || "–"}
                                                    </div>

                                                    <div className="w-[160px] hidden md:block text-neutral-500 truncate">
                                                        {lastEvt}
                                                    </div>

                                                    <div className="w-[90px] flex justify-end">
                                                        <a
                                                            href={
                                                                displayUrl ||
                                                                "#"
                                                            }
                                                            target={
                                                                displayUrl
                                                                    ? "_blank"
                                                                    : undefined
                                                            }
                                                            rel={
                                                                displayUrl
                                                                    ? "noreferrer"
                                                                    : undefined
                                                            }
                                                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px]  ${displayUrl
                                                                ? "border-neutral-200 text-neutral-800 hover:bg-neutral-50"
                                                                : "border-neutral-200 text-neutral-400 cursor-default"
                                                                }`}
                                                        >
                                                            <span>Open</span>
                                                            <ArrowUpRight className="h-3 w-3" />
                                                        </a>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </section>
                        )}
                    </div>
                )}

                {editorOpen && activeDeployment && editorDraftId && (
                    <PreviewEditorManager
                        firebaseUser={user}
                        initialHtml={editorHtml}
                        sourceImage={editorRefImg}
                        initialSeoMetaByPage={
                            activeSeoMetaByPage || undefined
                        }
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
                        saveDraft={handleSaveDraft}
                        onLiveHtml={(html) => {
                            if (!activeRenderId) return;

                            // keep in renders cache
                            setRenders((prev) =>
                                prev.map((r) =>
                                    r.id === activeRenderId
                                        ? { ...r, html }
                                        : r
                                )
                            );

                            // feed latest visual HTML into draft cache used by export
                            setHtmlDrafts((prev) => ({
                                ...prev,
                                [activeRenderId]: html,
                            }));

                            // keep local editorHtml in sync so re-open uses latest
                            if (editorDraftId === activeRenderId) {
                                setEditorHtml(html);
                            }
                        }}
                        onSaveMeta={async (
                            pageId,
                            meta,
                            fullMap
                        ) => {
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
            </div>
        </main>
    );
}
