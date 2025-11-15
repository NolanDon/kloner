"use client";

import { useEffect, useState, useMemo } from "react";
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
    serverTimestamp,
    type QueryDocumentSnapshot,
    type DocumentData,
    type QuerySnapshot,
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
} from "lucide-react";
import PreviewEditor from "@/components/PreviewEditor";

const ACCENT = "#f55f2a";

type DeploymentDoc = {
    vercelDeploymentId: string;
    vercelProjectId?: string | null;
    vercelProjectName?: string | null;
    vercelUrl?: string | null;
    vercelState?: string | null;
    vercelTeamId?: string | null;
    vercelUserId?: string | null;
    configurationId?: string | null;
    lastEventType?: string | null;
    lastEventId?: string | null;
    lastEventAt?: any;
    createdAt?: any;
    updatedAt?: any;
};

type ActionState = {
    [deploymentKey: string]: {
        redeployLoading?: boolean;
        redeployError?: string | null;
        customLoading?: boolean;
        customError?: string | null;
    };
};

function toDate(v: any): Date | null {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    if (typeof v === "number") return new Date(v);
    if (typeof v === "string") {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function formatDate(v: any): string {
    const d = toDate(v);
    if (!d) return "";
    return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function stateColor(state?: string | null): string {
    const s = (state || "").toLowerCase();
    if (s === "ready" || s === "succeeded") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (s === "error" || s === "failed" || s === "canceled")
        return "bg-red-50 text-red-700 border-red-200";
    if (s === "building" || s === "queued" || s === "pending")
        return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-neutral-50 text-neutral-600 border-neutral-200";
}

/**
 * Canonicalize state for UI using both vercelState + lastEventType.
 */
function deriveStateFromDoc(
    d?: DeploymentDoc | null
): "ready" | "error" | "canceled" | "building" | "unknown" {
    if (!d) return "unknown";
    const raw = (d.vercelState || "").toLowerCase();
    const evt = (d.lastEventType || "").toLowerCase();

    if (evt.includes("error")) return "error";
    if (evt.includes("canceled")) return "canceled";
    if (evt.includes("succeeded") || evt.includes("ready") || evt.includes("promoted")) return "ready";

    if (["error", "failed"].includes(raw)) return "error";
    if (["canceled", "cancelled"].includes(raw)) return "canceled";
    if (["ready", "succeeded"].includes(raw)) return "ready";
    if (["queued", "pending", "building"].includes(raw)) return "building";

    return raw ? (raw as any) : "unknown";
}

// Default HTML kept only for other flows; NEVER used as a fallback when a render is missing.
function buildDefaultHtml(projectName: string, deploymentId: string): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${projectName}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --accent: ${ACCENT};
      --bg: #0b0c10;
      --fg: #f9fafb;
      --muted: #9ca3af;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      background: radial-gradient(circle at top left, rgba(245,95,42,0.16), transparent 55%), #050608;
      color: var(--fg);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .shell {
      max-width: 720px;
      width: 100%;
      border-radius: 24px;
      background: radial-gradient(circle at top, rgba(245,95,42,0.18), rgba(15,23,42,0.96));
      box-shadow:
        0 24px 60px rgba(15,23,42,0.65),
        0 0 0 1px rgba(148,163,184,0.18);
      padding: 24px 24px 20px;
      border: 1px solid rgba(148,163,184,0.35);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(15,23,42,0.85);
      border: 1px solid rgba(148,163,184,0.5);
      color: var(--muted);
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .pill-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 0 4px rgba(245,95,42,0.24);
    }
    .title {
      margin: 14px 0 6px;
      font-size: 24px;
      letter-spacing: -0.03em;
      font-weight: 650;
    }
    .subtitle {
      margin: 0;
      font-size: 13px;
      color: var(--muted);
      max-width: 40rem;
    }
    .footer {
      margin-top: 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 11px;
      color: var(--muted);
    }
    .badge {
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid rgba(148,163,184,0.5);
      background: rgba(15,23,42,0.9);
    }
    .tagline span {
      color: var(--accent);
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main class="shell">
    <div class="pill">
      <span class="pill-dot"></span>
      <span>Deployed with Kloner</span>
    </div>
    <h1 class="title">${projectName}</h1>
    <p class="subtitle">
      This deployment was pushed from the Kloner dashboard. Edit this HTML directly in the Deployments view
      to test your Vercel webhooks and project wiring.
    </p>
    <div class="footer">
      <div class="badge">
        Deployment id: <strong>${deploymentId.slice(0, 8)}…</strong>
      </div>
      <div class="tagline">
        <span>Kloner</span> · turn any site into your project
      </div>
    </div>
  </main>
</body>
</html>`;
}

export default function DeploymentsPage(): JSX.Element {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<Array<{ id: string } & DeploymentDoc>>([]);

    // "new deploy" flag coming from Preview Builder via localStorage
    const [hasNewFlag, setHasNewFlag] = useState(false);
    const [hasNewMeta, setHasNewMeta] = useState<{
        url?: string;
        projectName?: string | null;
        projectId?: string | null;
    } | null>(null);

    const [actionState, setActionState] = useState<ActionState>({});

    // editor integration (using reference render)
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorHtml, setEditorHtml] = useState<string>("");
    const [editorRefImg, setEditorRefImg] = useState<string | undefined>(undefined);
    const [editorDraftId, setEditorDraftId] = useState<string | null>(null);
    const [activeDeployment, setActiveDeployment] =
        useState<({ id: string } & DeploymentDoc) | null>(null);
    const [editorLoadingId, setEditorLoadingId] = useState<string | null>(null);

    // local draft cache
    const [htmlDrafts, setHtmlDrafts] = useState<Record<string, string>>({});

    const BUILDING_STATES = ["building", "queued", "pending"];

    useEffect(() => {
        const off = onAuthStateChanged(auth, (u) => {
            setUser(u);
        });
        return () => off();
    }, []);

    useEffect(() => {
        try {
            const raw =
                typeof window !== "undefined" ? localStorage.getItem("kloner.deployments.hasNew") : null;
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

    // auto-refresh stale "building" states via backend helper
    useEffect(() => {
        if (!user || items.length === 0) return;

        const now = Date.now();

        const staleBuildingIds = items
            .filter((d) => {
                const state = deriveStateFromDoc(d);
                if (!BUILDING_STATES.includes(state)) return false;

                const lastDate = toDate(d.updatedAt || d.lastEventAt || d.createdAt);
                if (!lastDate) return true;

                const ageMs = now - lastDate.getTime();
                return ageMs > 2 * 60 * 1000;
            })
            .map((d) => d.vercelDeploymentId)
            .slice(0, 10);

        if (staleBuildingIds.length === 0) return;

        void fetch("/api/vercel/refresh-deployments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deploymentIds: staleBuildingIds }),
        }).catch(() => {
            // ignore
        });
    }, [user, items]);

    const total = items.length;

    const readyCount = useMemo(
        () =>
            items.filter((d) =>
                ["ready", "succeeded"].includes(
                    deriveStateFromDoc(d) === "ready" ? "ready" : (d.vercelState || "").toLowerCase()
                )
            ).length,
        [items]
    );

    const latestFromPreview = useMemo(() => {
        if (!hasNewMeta || items.length === 0) return null;

        return (
            items.find(
                (d) =>
                    (hasNewMeta.projectId && d.vercelProjectId === hasNewMeta.projectId) ||
                    (hasNewMeta.projectName && d.vercelProjectName === hasNewMeta.projectName)
            ) || null
        );
    }, [hasNewMeta, items]);

    const latestState = deriveStateFromDoc(latestFromPreview);
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
                        projectName: json.projectName || d.vercelProjectName || null,
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

    function pickNewest(
        snap: QuerySnapshot<DocumentData>
    ): QueryDocumentSnapshot<DocumentData> | null {
        if (snap.empty) return null;

        let best: QueryDocumentSnapshot<DocumentData> | null = null;
        let bestTs = -Infinity;

        snap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            const ts =
                (data.lastExportedAt && toDate(data.lastExportedAt)?.getTime()) ||
                (data.updatedAt && toDate(data.updatedAt)?.getTime()) ||
                (data.createdAt && toDate(data.createdAt)?.getTime()) ||
                0;

            if (ts > bestTs) {
                bestTs = ts;
                best = docSnap as QueryDocumentSnapshot<DocumentData>;
            }
        });

        return best;
    }

    // Stronger association: try multiple keys to locate the render for a deployment.
    async function fetchRenderForDeployment(opts: {
        uid: string;
        deployment: { id: string } & DeploymentDoc;
    }): Promise<{ id: string; html: string; referenceImage?: string }> {
        const { uid, deployment } = opts;
        const colRef = collection(db, "kloner_users", uid, "kloner_renders");

        const tryQueries: Array<() => Promise<QueryDocumentSnapshot<DocumentData> | null>> = [];

        if (deployment.vercelProjectId) {
            const projectId = deployment.vercelProjectId;
            tryQueries.push(async () => {
                const qy = query(colRef, where("vercelProjectId", "==", projectId));
                const snap = await getDocs(qy);
                return pickNewest(snap);
            });
        }

        if (deployment.vercelProjectName) {
            const projectName = deployment.vercelProjectName;
            tryQueries.push(async () => {
                const qy = query(colRef, where("vercelProjectName", "==", projectName));
                const snap = await getDocs(qy);
                return pickNewest(snap);
            });
        }

        if (deployment.vercelUrl) {
            const url = deployment.vercelUrl;
            tryQueries.push(async () => {
                const qy = query(colRef, where("lastDeployUrl", "==", url));
                const snap = await getDocs(qy);
                return pickNewest(snap);
            });
        }

        // as an absolute last resort: match by base url used in the render
        tryQueries.push(async () => {
            const baseUrl = deployment.vercelUrl?.split("?")[0] || null;
            if (!baseUrl) return null;
            const qy = query(colRef, where("url", "==", baseUrl));
            const snap = await getDocs(qy);
            return pickNewest(snap);
        });

        for (const fn of tryQueries) {
            const docSnap = await fn();
            if (!docSnap) continue;

            const data = docSnap.data() as any;
            const rawHtml = typeof data.html === "string" ? data.html.trim() : "";
            if (!rawHtml) {
                throw new Error(
                    "Reference render exists but has no HTML. Open this URL in the Preview Builder and re-export."
                );
            }

            const refImg =
                typeof data.referenceImage === "string" && data.referenceImage.trim().length > 0
                    ? data.referenceImage
                    : undefined;

            return {
                id: docSnap.id,
                html: rawHtml,
                referenceImage: refImg,
            };
        }

        throw new Error(
            "No reference render found for this deployment. Open this site in the Preview Builder and export at least one render."
        );
    }

    // open reference render for this deployment (using association helper above)
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

            setHtmlDrafts((prev) => ({
                ...prev,
                [draftId]: initialHtml,
            }));

            setActiveDeployment(d);
            setEditorHtml(initialHtml);
            setEditorRefImg(refImg);
            setEditorDraftId(draftId);
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
        } finally {
            setEditorLoadingId(null);
        }
    }

    async function exportToVercel(args: { html: string; name?: string | null }) {
        if (!activeDeployment) return;

        const key = activeDeployment.vercelDeploymentId || activeDeployment.id;
        const projectName =
            args.name ||
            activeDeployment.vercelProjectName ||
            activeDeployment.vercelProjectId ||
            "kloner-site";

        updateActionState(key, { customLoading: true, customError: null });

        try {
            const res = await fetch("/api/user-deploy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    html: args.html,
                    projectName,
                    renderId: editorDraftId ?? null,
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
                        projectId: json.projectId || activeDeployment.vercelProjectId || null,
                        projectName:
                            json.projectName ||
                            activeDeployment.vercelProjectName ||
                            projectName,
                    })
                );
            }

            setEditorOpen(false);
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

    // Firestore-backed saveDraft, modeled after your working version
    const handleSaveDraft = async (payload: {
        draftId?: string;
        html: string;
        meta?: { nameHint?: string; device: any; mode: any };
        version: number;
    }) => {
        if (!user) return;

        const rid = payload.draftId || editorDraftId;
        if (!rid) return;

        try {
            await setDoc(
                doc(db, "kloner_users", user.uid, "kloner_renders", rid),
                {
                    html: payload.html,
                    referenceImage: editorRefImg || null,
                    nameHint: payload.meta?.nameHint || null,
                    version: payload.version || 1,
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );

            setHtmlDrafts((prev) => ({
                ...prev,
                [rid]: payload.html,
            }));

            if (editorDraftId === rid) {
                setEditorHtml(payload.html);
            }
        } catch {
            // silent failure for now; PreviewEditor has its own UX
        }
    };

    const latestDeployment = items[0] || null;
    const history = items.slice(1);

    return (
        <main className="min-h-screen bg-white">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-8">
                <div className="mb-4 flex items-center gap-2">
                    <div className="h-px flex-1 bg-neutral-200/70" />
                    <div className="h-px flex-1 bg-neutral-200/70" />
                </div>

                <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <div>
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-800">
                                    Deployments
                                </h1>
                            </div>

                            {hasNewFlag && (
                                <div
                                    className={`rounded-2xl border px-4 py-3 text-[11px] sm:text-xs shadow-sm ${bannerClasses}`}
                                >
                                    <div className="flex items-start gap-2">
                                        {bannerVariant === "error" ? (
                                            <AlertTriangle className="h-4 w-4 mt-0.5 text-red-500" />
                                        ) : bannerVariant === "success" ? (
                                            <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600" />
                                        ) : (
                                            <Rocket className="h-4 w-4 mt-0.5 text-neutral-500" />
                                        )}

                                        <div className="flex-1">
                                            <div className="font-semibold mb-1">
                                                {bannerVariant === "error"
                                                    ? "Deployment failed"
                                                    : bannerVariant === "success"
                                                        ? "Deployment finished"
                                                        : "Deployment started from Preview Builder"}
                                            </div>

                                            <p className="leading-relaxed">
                                                {bannerVariant === "error"
                                                    ? "Kloner tried to deploy your preview, but Vercel reported an error. Check the deployment in Vercel to inspect the build logs and fix the issue."
                                                    : bannerVariant === "success"
                                                        ? "Your preview finished building on Vercel. You can open the live site or review its history below."
                                                        : "A deployment was just triggered from the Preview Builder. As Vercel webhooks arrive, this list will update with its current status."}
                                                {hasNewMeta?.projectName
                                                    ? ` Project: ${hasNewMeta.projectName}.`
                                                    : ""}
                                            </p>

                                            {(hasNewMeta?.url || latestFromPreview?.vercelUrl) && (
                                                <a
                                                    href={latestFromPreview?.vercelUrl || hasNewMeta?.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="mt-2 inline-flex items-center gap-1 rounded-md border bg-white/80 px-2.5 py-1 text-[11px] font-medium hover:bg-white"
                                                >
                                                    {bannerVariant === "error"
                                                        ? "Open deployment in Vercel"
                                                        : "Open latest URL"}
                                                    <ArrowUpRight className="h-3 w-3" />
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <p className="text-xs sm:text-sm text-neutral-500 max-w-xl">
                                Every time Kloner deploys to your Vercel account, we record the deployment here. Data is
                                driven entirely by the Vercel webhook.
                            </p>
                        </div>
                    </div>

                    <div className="inline-flex flex-col items-end gap-1 text-right">
                        <div className="inline-flex items-center gap-2 text-xs text-neutral-600">
                            <Rocket className="h-3.5 w-3.5 text-neutral-500" />
                            <span>
                                {total} deployment{total === 1 ? "" : "s"}
                            </span>
                        </div>
                        <div className="inline-flex items-center gap-2 text-xs text-neutral-600">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            <span>{readyCount} live / ready</span>
                        </div>
                    </div>
                </header>

                {loading ? (
                    <div className="space-y-4">
                        <div className="h-40 rounded-xl bg-neutral-100 animate-pulse" />
                        <div className="h-40 rounded-xl bg-neutral-100 animate-pulse" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-4 text-sm text-neutral-700">
                        <div className="flex items-center gap-2 text-neutral-800 font-semibold mb-1">
                            <Clock className="h-4 w-4 text-neutral-500" />
                            <span>No deployments yet</span>
                        </div>
                        <p className="text-xs text-neutral-600">
                            Trigger a deployment from the Preview Builder. When Vercel finishes building, the webhook
                            will populate this view automatically.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Latest deployment card */}
                        {latestDeployment && (() => {
                            const d = latestDeployment;
                            const created = formatDate(d.createdAt);
                            const updated = formatDate(d.updatedAt || d.lastEventAt);
                            const state = deriveStateFromDoc(d);
                            const stateStyles = stateColor(state);
                            const projectName = d.vercelProjectName || d.vercelProjectId || "Untitled project";
                            const key = d.vercelDeploymentId || d.id;
                            const act = actionState[key] || {};
                            const isRedeployLoading = !!act.redeployLoading;
                            const isCustomLoading = !!act.customLoading;
                            const isEditorLoading = editorLoadingId === key;

                            return (
                                <section aria-label="Latest deployment">
                                    <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500 mb-2">
                                        Latest deployment
                                    </h2>
                                    <article className="rounded-2xl border border-neutral-200 bg-white shadow-sm p-5 flex flex-col gap-3">
                                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-base font-semibold text-neutral-900 truncate">
                                                        {projectName}
                                                    </div>
                                                    <span className="text-[11px] text-neutral-400 truncate">
                                                        {d.vercelDeploymentId?.slice(0, 10)}…
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-xs text-neutral-500 break-all">
                                                    {d.vercelUrl || "URL pending"}
                                                </div>
                                            </div>

                                            <div
                                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${stateStyles}`}
                                            >
                                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                                                <span className="capitalize">
                                                    {state === "unknown" ? "unknown" : state}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
                                            <div className="inline-flex items-center gap-1.5">
                                                <Clock className="h-3 w-3" />
                                                <span>
                                                    Created {created || "–"}
                                                    {updated && (
                                                        <span className="ml-1 text-neutral-400">
                                                            · Updated {updated}
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                            {d.lastEventType && (
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-1 w-1 rounded-full bg-neutral-300" />
                                                    <span>
                                                        Last event:{" "}
                                                        <span className="font-medium text-neutral-700">
                                                            {d.lastEventType}
                                                        </span>
                                                    </span>
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-3 mt-1">
                                            <a
                                                href={d.vercelUrl || "#"}
                                                target={d.vercelUrl ? "_blank" : undefined}
                                                rel={d.vercelUrl ? "noreferrer" : undefined}
                                                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium ${d.vercelUrl
                                                    ? "border-neutral-200 text-neutral-800 hover:bg-neutral-50"
                                                    : "border-neutral-200 text-neutral-400 cursor-default"
                                                    }`}
                                            >
                                                <span>Open live site</span>
                                                <ArrowUpRight className="h-3 w-3" />
                                            </a>

                                            {state === "error" && (
                                                <div className="inline-flex items-center gap-1 text-[11px] text-red-600">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    <span>Check build logs in Vercel</span>
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-xs mt-3 text-neutral-600 max-w-prose">
                                            To publish your latest changes, open the <strong>Preview Editor</strong> and use the
                                            <strong> Export to Vercel </strong> button.
                                        </p>

                                        {/* Controls always visible for latest deployment */}
                                        <div className="border-t border-neutral-100 pt-3">
                                            <div className="mt-1 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/80 p-3">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => openEditorForDeployment(d)}
                                                        disabled={isEditorLoading}
                                                        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-white"
                                                        style={{
                                                            backgroundColor: ACCENT,
                                                            boxShadow: "0 10px 30px rgba(245,95,42,0.40)",
                                                        }}
                                                    >
                                                        {isEditorLoading ? (
                                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        ) : (
                                                            <Code2 className="h-3.5 w-3.5" />
                                                        )}
                                                        <span>Open in Preview Editor</span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => openEditorForDeployment(d)}
                                                        disabled={isEditorLoading}
                                                        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                                                    >
                                                        {isEditorLoading ? (
                                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" />
                                                        ) : (
                                                            <RefreshCw className="h-3.5 w-3.5 text-neutral-500" />
                                                        )}
                                                        <span>Deploy edited HTML</span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => handleRedeploy(d)}
                                                        disabled={true}
                                                        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                                                    >
                                                        {isRedeployLoading ? (
                                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" />
                                                        ) : (
                                                            <RefreshCw className="h-3.5 w-3.5 text-neutral-500" />
                                                        )}
                                                        <span>Redeploy latest</span>
                                                    </button>
                                                </div>

                                                {(act.customError || act.redeployError) && (
                                                    <p className="mt-1 text-[10px] text-red-600">
                                                        {act.customError || act.redeployError}
                                                    </p>
                                                )}

                                                {isCustomLoading && (
                                                    <p className="mt-1 text-[10px] text-neutral-500 inline-flex items-center gap-1">
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                        <span>Pushing custom HTML to Vercel…</span>
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
                                    <span className="text-[11px] text-neutral-400">
                                        {history.length} previous deployment
                                        {history.length === 1 ? "" : "s"}
                                    </span>
                                </div>

                                <p className="text-xs my-3 text-neutral-600">
                                    Your previous deployments will show in the list below.
                                </p>
                                <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
                                    <div className="px-4 py-2 flex items-center text-[11px] text-neutral-500 border-b border-neutral-100">
                                        <div className="w-[120px]">Status</div>
                                        <div className="flex-1 min-w-0">URL</div>
                                        <div className="w-[150px] hidden sm:block">Created</div>
                                        <div className="w-[160px] hidden md:block">Last event</div>
                                        <div className="w-[90px]" />
                                    </div>

                                    <div className="max-h-72 overflow-y-auto">
                                        {history.map((d) => {
                                            const state = deriveStateFromDoc(d);
                                            const stateStyles = stateColor(state);
                                            const created = formatDate(d.createdAt);
                                            const lastEvt = d.lastEventType || "–";

                                            return (
                                                <div
                                                    key={d.id}
                                                    className="px-4 py-2 flex items-center text-[11px] sm:text-xs text-neutral-700 border-b last:border-b-0 border-neutral-100"
                                                >
                                                    <div className="w-[120px]">
                                                        <span
                                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] sm:text-[11px] ${stateStyles}`}
                                                        >
                                                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                                                            <span className="capitalize">
                                                                {state === "unknown" ? "unknown" : state}
                                                            </span>
                                                        </span>
                                                    </div>

                                                    <div className="flex-1 min-w-0 pr-2">
                                                        <div className="truncate text-neutral-800">
                                                            {d.vercelUrl || "URL pending"}
                                                        </div>
                                                        <div className="sm:hidden text-[10px] text-neutral-400">
                                                            {created || "–"} · {lastEvt}
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
                                                            href={d.vercelUrl || "#"}
                                                            target={d.vercelUrl ? "_blank" : undefined}
                                                            rel={d.vercelUrl ? "noreferrer" : undefined}
                                                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${d.vercelUrl
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
                    <PreviewEditor
                        initialHtml={editorHtml}
                        sourceImage={editorRefImg}
                        onClose={() => {
                            setEditorOpen(false);
                            setActiveDeployment(null);
                            setEditorHtml("");
                            setEditorDraftId(null);
                            setEditorRefImg(undefined);
                        }}
                        onExport={(html, name) =>
                            exportToVercel({
                                html,
                                name,
                            })
                        }
                        draftId={editorDraftId}
                        saveDraft={handleSaveDraft}
                        onLiveHtml={(html) => {
                            if (!editorDraftId) return;
                            setHtmlDrafts((prev) => ({
                                ...prev,
                                [editorDraftId]: html,
                            }));
                            setEditorHtml(html);
                        }}
                    />
                )}
            </div>
        </main>
    );
}
