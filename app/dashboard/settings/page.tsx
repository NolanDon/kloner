// app/settings/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, type User, updateProfile } from "firebase/auth";
import {
    CheckCircle2,
    ChevronDown,
    Shield,
    Bell,
    LayoutGrid,
    Rocket,
    Plug,
    Gauge,
    Loader2,
    ArchiveRestore,
    XCircle,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useVercelIntegration } from "@/src/hooks/useVercelIntegration";
import { ensureSessionAndCsrf } from "@/lib/auth-client";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useModal } from "@/components/ui/ModalContext";

const ACCENT = "#f55f2a";
const VERCEL_INTEGRATION_SLUG =
    process.env.NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG || "kloner";

type BillingTier = "free" | "pro" | "agency";

type TierResponse = {
    uid: string;
    tier: BillingTier;
    stripeStatus: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean | null;
    trialEnd?: number | null;
    source: string;
};

type DeploymentSummary = {
    id: string;
    url: string | null;
    vercelDeploymentId: string | null;
    vercelProjectId: string | null;
    vercelProjectName: string | null;
    renderId: string | null;
    createdAt: number | null;

    vercelReadyState: string | null;
    vercelState: string | null;
    lastEventType: string | null;

    publicDomain: string | null;
    publicUrl: string | null;
};

type UiState = "active" | "ready" | "offline" | "building" | "error" | "canceled" | "unknown";

type NotificationPrefs = {
    journeyEmails: boolean;
    productEmails: boolean;
    securityEmails: boolean;
};

type DashboardPrefs = {
    compactDashboardLayout: boolean;
    showArchivedApps: boolean;
};

const CANCELLATION_REASON_OPTIONS = [
    "Too expensive",
    "Not accurate enough",
    "Just checking things out",
    "Missing features",
    "Switching to another tool",
    "Other",
];

function toDateFromUnixSeconds(v: number | null | undefined): Date | null {
    if (v === null || v === undefined) return null;
    const ms = v > 10_000_000_000 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
}

function formatUnixSeconds(v: number | null | undefined): string {
    const d = toDateFromUnixSeconds(v);
    if (!d) return "";
    return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function daysUntilUnixSeconds(v: number | null | undefined): number | null {
    if (!v && v !== 0) return null;
    const nowSec = Date.now() / 1000;
    const deltaDays = Math.max(0, Math.ceil((v - nowSec) / 86400));
    return deltaDays;
}

function deriveStateFromDoc(d?: DeploymentSummary | null): UiState {
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

    if (d.vercelReadyState || d.vercelState || d.lastEventType) return "building";
    return "unknown";
}

function projectKeyForDeployment(d: DeploymentSummary): string {
    const pid = d.vercelProjectId || "no-id";
    const pname = d.vercelProjectName || "Unknown project";
    return `${pid}::${pname}`;
}

function toUiState(d: DeploymentSummary, latestReadyByProject: Map<string, string>): UiState {
    const base = deriveStateFromDoc(d);
    if (base !== "ready") return base;

    const projKey = projectKeyForDeployment(d);
    const latestId = latestReadyByProject.get(projKey);
    if (!latestId) return "ready";

    if (latestId === d.vercelDeploymentId) return "active";
    return "offline";
}

function stateLabel(state: UiState): string {
    return state;
}

function btnClass({
    kind,
    disabled,
}: {
    kind: "primary" | "soft" | "danger" | "warn" | "ghost";
    disabled?: boolean;
}) {
    const base =
        "inline-flex items-center justify-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-[0.99]";
    const dis = disabled ? "opacity-50 pointer-events-none" : "";

    if (kind === "primary")
        return [base, "bg-accent text-white hover:brightness-95", dis].join(" ");

    if (kind === "soft")
        return [
            base,
            "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50",
            dis,
        ].join(" ");

    if (kind === "warn")
        return [
            base,
            "border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
            dis,
        ].join(" ");

    if (kind === "danger")
        return [
            base,
            "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
            dis,
        ].join(" ");

    return [
        base,
        "border border-neutral-200 bg-transparent text-neutral-700 hover:bg-neutral-100",
        dis,
    ].join(" ");
}

export default function SettingsPage(): JSX.Element {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showConfirm } = useModal();

    const [user, setUser] = useState<User | null>(null);
    const [disconnectBusy, setDisconnectBusy] = useState(false);
    const [profileNameDraft, setProfileNameDraft] = useState("");
    const [profileNameSaving, setProfileNameSaving] = useState(false);
    const [profileNameError, setProfileNameError] = useState<string | null>(null);
    const [profileNameSuccess, setProfileNameSuccess] = useState<string | null>(null);

    const [dashboardPrefs, setDashboardPrefs] = useState<DashboardPrefs>({
        compactDashboardLayout: false,
        showArchivedApps: false,
    });
    const [dashboardPrefsSaving, setDashboardPrefsSaving] = useState(false);
    const [dashboardPrefsError, setDashboardPrefsError] = useState<string | null>(null);
    const [dashboardPrefsSaved, setDashboardPrefsSaved] = useState<string | null>(null);

    const [tier, setTier] = useState<BillingTier>("free");
    const [tierLoading, setTierLoading] = useState(false);
    const [tierError, setTierError] = useState<string | null>(null);
    const [stripeStatus, setStripeStatus] = useState<string | null>(null);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState<boolean | null>(null);

    const [currentPeriodEndSec, setCurrentPeriodEndSec] = useState<number | null>(null);
    const [trialEndSec, setTrialEndSec] = useState<number | null>(null);

    const [cancelBusy, setCancelBusy] = useState(false);
    const [cancelError, setCancelError] = useState<string | null>(null);
    const [cancelSuccess, setCancelSuccess] = useState<string | null>(null);
    const [cancelReason, setCancelReason] = useState<string>("");
    const [cancelFeedback, setCancelFeedback] = useState<string>("");
    const [showCancelFeedbackPopup, setShowCancelFeedbackPopup] = useState(false);

    const [renewBusy, setRenewBusy] = useState(false);
    const [renewError, setRenewError] = useState<string | null>(null);
    const [renewSuccess, setRenewSuccess] = useState<string | null>(null);

    const {
        status: vercelStatus,
        checking: vercelChecking,
        refresh: refreshVercelStatus,
    } = useVercelIntegration();

    const [deployments, setDeployments] = useState<DeploymentSummary[]>([]);
    const [deploymentsLoading, setDeploymentsLoading] = useState(false);
    const [deploymentsError, setDeploymentsError] = useState<string | null>(null);

    const [deleteDeploymentBusy, setDeleteDeploymentBusy] = useState(false);
    const [deleteDeploymentError, setDeleteDeploymentError] = useState<string | null>(null);
    const [deleteDeploymentSuccess, setDeleteDeploymentSuccess] = useState<string | null>(null);

    const [accountActionBusy, setAccountActionBusy] = useState(false);
    const [accountActionError, setAccountActionError] = useState<string | null>(null);
    const [accountActionSuccess, setAccountActionSuccess] = useState<string | null>(null);

    type DeploymentFilter = "all" | "live-only" | "live-projects";
    const [deploymentFilter, setDeploymentFilter] = useState<DeploymentFilter>("all");

    const [selectedDeploymentIds, setSelectedDeploymentIds] = useState<string[]>([]);

    // Notifications tab state
    const [activeTab, setActiveTab] = useState<"account" | "notifications">("account");
    const [prefs, setPrefs] = useState<NotificationPrefs>({
        journeyEmails: true,
        productEmails: false,
        securityEmails: true,
    });
    const [prefsLoading, setPrefsLoading] = useState(false);
    const [prefsError, setPrefsError] = useState<string | null>(null);
    const [prefsSaved, setPrefsSaved] = useState<string | null>(null);
    const [prefsLoaded, setPrefsLoaded] = useState(false);

    useEffect(() => {
        const t = (searchParams.get("tab") || "").toLowerCase();
        if (t === "notifications") setActiveTab("notifications");
    }, [searchParams]);

    useEffect(() => {
        const off = onAuthStateChanged(auth, (u) => setUser(u));
        return () => off();
    }, []);

    useEffect(() => {
        if (!user) {
            setProfileNameDraft("");
            setDashboardPrefs({
                compactDashboardLayout: false,
                showArchivedApps: false,
            });
            return;
        }

        let cancelled = false;
        const fallback = user.displayName || user.email?.split("@")[0] || "";
        setProfileNameDraft(fallback);
        setDashboardPrefs({
            compactDashboardLayout: false,
            showArchivedApps: false,
        });

        (async () => {
            try {
                const snap = await getDoc(doc(db, "kloner_users", user.uid));
                if (cancelled) return;
                const data = snap.exists() ? snap.data() : null;
                const next = String((data as any)?.profileName || (data as any)?.displayName || fallback || "").trim();
                if (next) setProfileNameDraft(next);

                const dashboardPrefsData = ((data as any)?.dashboardPrefs || (data as any)?.dashboardSettings || {}) as any;
                setDashboardPrefs({
                    compactDashboardLayout: dashboardPrefsData.compactDashboardLayout === true,
                    showArchivedApps: dashboardPrefsData.showArchivedApps === true,
                });
            } catch {
                // leave the auth fallback in place
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [user]);

    async function handleSaveProfileName() {
        if (!user) return;

        const trimmed = profileNameDraft.trim();
        if (!trimmed) {
            setProfileNameError("Enter a profile name.");
            return;
        }

        setProfileNameSaving(true);
        setProfileNameError(null);
        setProfileNameSuccess(null);

        try {
            await updateProfile(user, { displayName: trimmed });
            await setDoc(
                doc(db, "kloner_users", user.uid),
                {
                    displayName: trimmed,
                    profileName: trimmed,
                    profileNameUpdatedAt: Date.now(),
                    updatedAt: Date.now(),
                },
                { merge: true },
            );
            setProfileNameSuccess("Saved.");
        } catch (err: any) {
            console.error("Failed to save profile name", err);
            setProfileNameError(err?.message || "Unable to save profile name.");
        } finally {
            setProfileNameSaving(false);
        }
    }

    async function handleToggleDashboardPref(key: keyof DashboardPrefs, value: boolean) {
        if (!user) return;

        const next = {
            ...dashboardPrefs,
            [key]: value,
        };

        setDashboardPrefs(next);
        setDashboardPrefsSaving(true);
        setDashboardPrefsError(null);
        setDashboardPrefsSaved(null);

        try {
            await setDoc(
                doc(db, "kloner_users", user.uid),
                {
                    dashboardPrefs: next,
                    dashboardSettings: next,
                    dashboardPrefsUpdatedAt: Date.now(),
                    updatedAt: Date.now(),
                },
                { merge: true },
            );
            setDashboardPrefsSaved("Saved.");
        } catch (err: any) {
            console.error("Failed to save dashboard prefs", err);
            setDashboardPrefsError(err?.message || "Unable to save dashboard settings.");
            setDashboardPrefs((prev) => ({
                ...prev,
                [key]: !value,
            }));
        } finally {
            setDashboardPrefsSaving(false);
        }
    }

    const loadTier = async (signal?: AbortSignal) => {
        setTierLoading(true);
        setTierError(null);
        setCancelError(null);
        setCancelSuccess(null);
        setRenewError(null);
        setRenewSuccess(null);

        try {
            const res = await fetch("/api/billing/tier?refresh=1", {
                method: "GET",
                credentials: "include",
                signal,
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data: TierResponse = await res.json();

            setTier(data.tier);
            setStripeStatus(data.stripeStatus);
            setCancelAtPeriodEnd(data.cancelAtPeriodEnd ?? null);
            setCurrentPeriodEndSec(data.currentPeriodEnd ?? null);
            setTrialEndSec((data.trialEnd ?? null) as any);
        } catch (err) {
            if ((err as any)?.name === "AbortError") return;
            console.error("Failed to load billing tier", err);
            setTierError("Unable to load subscription details right now.");
        } finally {
            setTierLoading(false);
        }
    };

    useEffect(() => {
        if (!user) return;

        const uid = (searchParams.get("uid") || "").trim();
        const token = (searchParams.get("t") || "").trim();
        const tab = (searchParams.get("tab") || "").toLowerCase();

        if (tab === "notifications") setActiveTab("notifications");

        // Only run unsub flow when both are present
        if (!uid && !token) return;

        if (!uid || !token) {
            const sp = new URLSearchParams(searchParams.toString());
            sp.set("tab", "notifications");
            sp.set("unsub", "missing");
            sp.delete("uid");
            sp.delete("t");
            window.history.replaceState({}, "", `/dashboard/settings?${sp.toString()}`);
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const ref = doc(db, "kloner_users", uid);
                const snap = await getDoc(ref);
                const data = snap.exists() ? snap.data() : null;

                const expected =
                    typeof (data as any)?.notificationUnsubToken === "string"
                        ? (data as any).notificationUnsubToken
                        : "";

                if (!expected || expected !== token) {
                    throw new Error("invalid");
                }

                const existingPrefs = ((data as any)?.notificationPrefs || {}) as any;

                await setDoc(
                    ref,
                    {
                        notificationPrefs: {
                            ...existingPrefs,
                            journeyEmails: false,
                        },
                        notificationPrefsUpdatedAt: Date.now(),
                        notificationUnsubbedAt: Date.now(),
                    },
                    { merge: true },
                );

                if (cancelled) return;

                const sp = new URLSearchParams(searchParams.toString());
                sp.set("tab", "notifications");
                sp.set("unsub", "ok");
                sp.delete("uid");
                sp.delete("t");
                window.history.replaceState({}, "", `/dashboard/settings?${sp.toString()}`);
            } catch {
                if (cancelled) return;

                const sp = new URLSearchParams(searchParams.toString());
                sp.set("tab", "notifications");
                sp.set("unsub", "invalid");
                sp.delete("uid");
                sp.delete("t");
                window.history.replaceState({}, "", `/dashboard/settings?${sp.toString()}`);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [user, searchParams]);

    const loadPrefs = async (signal?: AbortSignal) => {
        setPrefsLoading(true);
        setPrefsError(null);
        setPrefsSaved(null);
        setPrefsLoaded(false);

        try {
            // Make sure we have a backend session cookie for authed API routes.
            await ensureSessionAndCsrf();

            const res = await fetch("/api/notifications/prefs", {
                method: "GET",
                credentials: "include",
                signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as { ok?: boolean; prefs?: NotificationPrefs };
            if (!data?.ok || !data.prefs) throw new Error("Bad response");
            setPrefs({
                journeyEmails: !!data.prefs.journeyEmails,
                productEmails: !!data.prefs.productEmails,
                securityEmails: data.prefs.securityEmails !== false,
            });
        } catch (e: any) {
            if (e?.name === "AbortError") return;
            console.error("Failed to load notification prefs", e);
            setPrefsError("Unable to load notification preferences.");
        } finally {
            setPrefsLoading(false);
            setPrefsLoaded(true);
        }
    };

    const savePrefs = async (next: NotificationPrefs) => {
        setPrefs(next);
        setPrefsSaved(null);
        setPrefsError(null);

        try {
            const csrf = await ensureSessionAndCsrf();
            const res = await fetch("/api/notifications/prefs", {
                method: "POST",
                credentials: "include",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify(next),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.ok) throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
            setPrefsSaved("Saved.");
        } catch (e: any) {
            console.error("Save prefs failed", e);
            setPrefsError(e?.message || "Save failed.");
        }
    };

    useEffect(() => {
        if (!user) return;
        const ctrl = new AbortController();
        void loadTier(ctrl.signal);
        void loadPrefs(ctrl.signal);
        return () => ctrl.abort();
    }, [user]);

    useEffect(() => {
        if (!user) return;

        let aborted = false;

        const loadDeployments = async () => {
            setDeploymentsLoading(true);
            setDeploymentsError(null);
            setDeleteDeploymentError(null);
            setDeleteDeploymentSuccess(null);

            try {
                const res = await fetch("/api/vercel/deployments", {
                    method: "GET",
                    credentials: "include",
                });

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const data = (await res.json()) as {
                    ok?: boolean;
                    deployments?: DeploymentSummary[];
                    error?: string;
                };

                if (aborted) return;

                if (!data.ok) throw new Error(data.error || "Failed to load deployments");

                const list = data.deployments || [];
                setDeployments(list);
                setSelectedDeploymentIds((prev) => prev.filter((id) => list.some((d) => d.id === id)));
            } catch (err: any) {
                if (!aborted) {
                    console.error("Failed to load deployments", err);
                    setDeploymentsError(err?.message || "Unable to load deployments.");
                    setDeployments([]);
                    setSelectedDeploymentIds([]);
                }
            } finally {
                if (!aborted) setDeploymentsLoading(false);
            }
        };

        void loadDeployments();

        return () => {
            aborted = true;
        };
    }, [user]);

    const latestReadyByProject = useMemo(() => {
        const map = new Map<string, string>();
        if (!deployments.length) return map;

        for (const d of deployments) {
            const base = deriveStateFromDoc(d);
            if (base !== "ready") continue;
            if (!d.vercelDeploymentId) continue;

            const key = projectKeyForDeployment(d);
            if (!map.has(key)) map.set(key, d.vercelDeploymentId);
        }
        return map;
    }, [deployments]);

    const liveProjectKeys = useMemo(() => {
        const set = new Set<string>();
        for (const d of deployments) {
            const state = toUiState(d, latestReadyByProject);
            const key = projectKeyForDeployment(d);
            if (state === "active") set.add(key);
        }
        return set;
    }, [deployments, latestReadyByProject]);

    const visibleDeployments = useMemo(() => {
        return deployments.filter((d) => {
            const state = toUiState(d, latestReadyByProject);
            const key = projectKeyForDeployment(d);

            if (deploymentFilter === "live-only") return state === "active";
            if (deploymentFilter === "live-projects") return liveProjectKeys.has(key);
            return true;
        });
    }, [deployments, latestReadyByProject, liveProjectKeys, deploymentFilter]);

    const allVisibleIds = useMemo(() => visibleDeployments.map((d) => d.id), [visibleDeployments]);

    const allVisibleSelected =
        allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedDeploymentIds.includes(id));
    const someVisibleSelected =
        allVisibleIds.length > 0 &&
        !allVisibleSelected &&
        allVisibleIds.some((id) => selectedDeploymentIds.includes(id));

    const initials = useMemo(() => {
        if (!user) return "ME";
        const base = user.displayName || user.email || "Me";
        return base.slice(0, 2).toUpperCase();
    }, [user]);

    const isVercelConnected = vercelStatus === "connected";
    const isVercelChecking = vercelStatus === "loading" || vercelChecking;
    const canDisconnectVercel = isVercelConnected && !isVercelChecking && !disconnectBusy;

    function handleConnectVercel() {
        if (!VERCEL_INTEGRATION_SLUG || !user) {
            console.error("Missing integration slug or user not signed in");
            return;
        }

        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        const state = Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        localStorage.setItem("kloner_vercel_latest_csrf", state);

        document.cookie = [`vercel_oauth_state=${state}`, "Path=/", "Max-Age=600", "SameSite=Lax"].join(
            "; ",
        );

        const link = `https://vercel.com/integrations/${VERCEL_INTEGRATION_SLUG}/new?state=${state}`;
        window.location.assign(link);
    }

    async function handleDisconnectVercel() {
        if (!canDisconnectVercel) return;

        setDisconnectBusy(true);
        try {
            const csrf = await ensureSessionAndCsrf();

            const res = await fetch("/api/vercel/disconnect", {
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                method: "POST",
                credentials: "include",
            });
            if (res.ok) {
                await refreshVercelStatus();
            } else {
                console.error("Failed to disconnect Vercel");
            }
        } catch (e) {
            console.error("Disconnect error", e);
        } finally {
            setDisconnectBusy(false);
        }
    }

    async function handleDisconnectVercelConfirmed() {
        if (!canDisconnectVercel) return;

        const confirmed = await showConfirm(
            "Disconnect Vercel from Kloner? You can reconnect it later.",
            "Disconnect Vercel",
        );
        if (!confirmed) return;

        await handleDisconnectVercel();
    }

    function handleToggleDeployment(id: string) {
        setSelectedDeploymentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }

    function handleToggleAllVisible() {
        if (allVisibleSelected) {
            setSelectedDeploymentIds((prev) => prev.filter((id) => !allVisibleIds.includes(id)));
        } else {
            setSelectedDeploymentIds((prev) => {
                const merged = new Set(prev);
                for (const id of allVisibleIds) merged.add(id);
                return Array.from(merged);
            });
        }
    }

    async function handleDeleteDeploymentBulk() {
        if (selectedDeploymentIds.length === 0) {
            setDeleteDeploymentError("Select at least one deployment first.");
            return;
        }

        const count = selectedDeploymentIds.length;
        const label = `${count} deployment${count === 1 ? "" : "s"}`;

        const confirmed = await showConfirm(
            `Delete ${label} and any associated screenshots? This cannot be undone.`,
            "Delete Deployments"
        );
        if (!confirmed) return;

        setDeleteDeploymentBusy(true);
        setDeleteDeploymentError(null);
        setDeleteDeploymentSuccess(null);

        try {
            const csrf = await ensureSessionAndCsrf();

            const res = await fetch("/api/vercel/delete-deployment", {
                method: "POST",
                credentials: "include",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ deploymentIds: selectedDeploymentIds }),
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data?.ok) {
                setDeleteDeploymentError(data?.error || `Delete failed (HTTP ${res.status})`);
                return;
            }

            const deletedIds = (data.results || [])
                .filter((r: any) => r && r.ok && r.firestoreDeleted)
                .map((r: any) => r.deploymentId as string);

            setDeployments((prev) => prev.filter((d) => !deletedIds.includes(d.id)));
            setSelectedDeploymentIds((prev) => prev.filter((id) => !deletedIds.includes(id)));

            setDeleteDeploymentSuccess(
                `Deleted ${deletedIds.length} deployment${deletedIds.length === 1 ? "" : "s"}.`,
            );
        } catch (err: any) {
            console.error("Delete deployment error", err);
            setDeleteDeploymentError(err?.message || "Delete failed.");
        } finally {
            setDeleteDeploymentBusy(false);
        }
    }

    async function handleExportAccountData() {
        setAccountActionError(null);
        setAccountActionSuccess(null);

        setAccountActionBusy(true);
        try {
            const csrf = await ensureSessionAndCsrf();
            const res = await fetch("/api/me", {
                method: "GET",
                credentials: "include",
                headers: {
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error || `Export failed (HTTP ${res.status})`);
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `kloner-export-${user?.uid || "account"}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            setAccountActionSuccess("Your data export is downloading.");
        } catch (err: any) {
            setAccountActionError(err?.message || "Export failed.");
        } finally {
            setAccountActionBusy(false);
        }
    }

    async function handleDeleteAccount() {
        const confirmed = await showConfirm(
            "Delete your Kloner account, all associated app data, uploaded files, integrations, and local session data? This cannot be undone.",
            "Delete Account",
        );
        if (!confirmed) return;

        setAccountActionBusy(true);
        setAccountActionError(null);
        setAccountActionSuccess(null);

        try {
            const csrf = await ensureSessionAndCsrf();
            const res = await fetch("/api/me", {
                method: "DELETE",
                credentials: "include",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ confirm: "DELETE_MY_ACCOUNT" }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.ok) {
                throw new Error(data?.error || `Delete failed (HTTP ${res.status})`);
            }

            await fetch("/api/auth/session", {
                method: "DELETE",
                credentials: "include",
            }).catch(() => undefined);
            await auth.signOut().catch(() => undefined);
            router.replace("/");
        } catch (err: any) {
            setAccountActionError(err?.message || "Delete failed.");
        } finally {
            setAccountActionBusy(false);
        }
    }

    function openCancelFeedbackPopup() {
        setCancelError(null);
        setCancelSuccess(null);
        setRenewError(null);
        setRenewSuccess(null);
        setCancelReason("");
        setCancelFeedback("");
        setShowCancelFeedbackPopup(true);
    }

    function applyCancellationReasonPreset(reason: string) {
        const prefix = reason.trim();
        if (!prefix) return;

        setCancelError(null);
        setCancelReason(prefix);
    }

    async function handleCancelSubscription() {
        const reason = cancelReason.trim();
        const feedback = cancelFeedback.trim();

        if (!reason && !feedback) {
            setCancelError("Pick a reason, add a note, or do both.");
            return;
        }

        setCancelBusy(true);
        setCancelError(null);
        setCancelSuccess(null);
        setRenewError(null);
        setRenewSuccess(null);

        try {
            const csrf = await ensureSessionAndCsrf();

            const res = await fetch("/api/billing/cancel-subscription", {
                method: "POST",
                credentials: "include",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({
                    atPeriodEnd: true,
                    cancellationReason: reason || null,
                    cancellationFeedback: feedback,
                }),
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data?.ok) {
                setCancelError(data?.error || `Cancel failed (HTTP ${res.status})`);
                return;
            }

            setCancelSuccess(
                onTrial
                    ? "Cancellation scheduled. Trial access is revoked immediately and website generation is disabled."
                    : "Cancellation scheduled. You’ll keep access until the end date."
            );
            setCancelReason("");
            setCancelFeedback("");
            setShowCancelFeedbackPopup(false);
            await loadTier();
        } catch (err: any) {
            console.error("Cancel subscription error", err);
            setCancelError(err?.message || "Cancel failed.");
        } finally {
            setCancelBusy(false);
        }
    }

    function handleKeepProjectsAndClose() {
        setShowCancelFeedbackPopup(false);
        router.push("/dashboard/view");
    }

    async function handleRenewSubscription() {
        setRenewBusy(true);
        setRenewError(null);
        setRenewSuccess(null);
        setCancelError(null);
        setCancelSuccess(null);

        try {
            const csrf = await ensureSessionAndCsrf();

            const res = await fetch("/api/billing/cancel-subscription", {
                method: "POST",
                credentials: "include",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                body: JSON.stringify({ atPeriodEnd: false }),
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data?.ok) {
                setRenewError(data?.error || `Renew failed (HTTP ${res.status})`);
                return;
            }

            setRenewSuccess("Cancellation removed. Subscription will continue normally.");
            await loadTier();
        } catch (err: any) {
            console.error("Renew subscription error", err);
            setRenewError(err?.message || "Renew failed.");
        } finally {
            setRenewBusy(false);
        }
    }

    const vercelBadgeLabel =
        vercelStatus === "connected"
            ? "connected"
            : vercelStatus === "loading" || vercelChecking
                ? "checking…"
                : vercelStatus === "error"
                    ? "error"
                    : "not connected";

    const vercelBadgeClasses =
        vercelStatus === "connected"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-neutral-100 text-neutral-600 border-neutral-200";

    const tierLabel = tier === "agency" ? "Agency" : tier === "pro" ? "Pro" : "Free";

    const tierBadgeClasses =
        tier === "agency"
            ? "bg-violet-50 text-violet-700 border-violet-200"
            : tier === "pro"
                ? "bg-[rgba(245,95,42,0.08)] text-[rgba(245,95,42,1)] border-[rgba(245,95,42,0.4)]"
                : "bg-neutral-100 text-neutral-600 border-neutral-200";

    const stripeStatusLabel = stripeStatus ?? "no active subscription";
    const downgradeNotice = stripeStatus === "canceled" || stripeStatus === "unpaid";

    const nowSec = Date.now() / 1000;

    const onTrial = !!trialEndSec && trialEndSec > nowSec && stripeStatus === "trialing";
    const trialDaysRemaining = onTrial ? daysUntilUnixSeconds(trialEndSec) : null;

    const nextBillingLabel = !onTrial && currentPeriodEndSec ? formatUnixSeconds(currentPeriodEndSec) : "";

    const endOfAccessSec = cancelAtPeriodEnd ? (onTrial ? trialEndSec : currentPeriodEndSec) : null;
    const endOfAccessDays = cancelAtPeriodEnd ? daysUntilUnixSeconds(endOfAccessSec) : null;

    const canCancel =
        tier !== "free" &&
        !tierLoading &&
        !!stripeStatus &&
        stripeStatus !== "canceled" &&
        stripeStatus !== "unpaid" &&
        cancelAtPeriodEnd !== true;

    const canRenew =
        tier !== "free" &&
        !tierLoading &&
        !!stripeStatus &&
        stripeStatus !== "canceled" &&
        stripeStatus !== "unpaid" &&
        cancelAtPeriodEnd === true;

    const showRenewSubscription =
        canRenew && stripeStatus !== "active" && stripeStatus !== "trialing";

    const unsubStatus = (searchParams.get("unsub") || "").toLowerCase();
    const unsubKindRaw = (searchParams.get("k") || "").toLowerCase();
    const unsubKind: "journey" | "product" | "all" =
        unsubKindRaw === "journey" || unsubKindRaw === "product" || unsubKindRaw === "all"
            ? (unsubKindRaw as any)
            : "journey";

    const canEvaluateUnsub = unsubStatus === "ok" && prefsLoaded && !prefsLoading && !prefsError;

    const unsubConfirmed =
        canEvaluateUnsub &&
        ((unsubKind === "journey" && prefs.journeyEmails === false) ||
            (unsubKind === "product" && prefs.productEmails === false) ||
            (unsubKind === "all" && prefs.journeyEmails === false && prefs.productEmails === false));

    const unsubMismatch = canEvaluateUnsub && !unsubConfirmed;

    return (
        <main className="min-h-screen bg-white pb-[30px] overflow-y-auto">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 py-8">
                <section className="mb-10">
                    <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                        <span>Kloner · Settings</span>
                    </div>

                    <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-8 sm:px-8 sm:py-10 shadow-sm">
                        <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">Settings</h1>
                        <p className="mt-1 text-sm text-neutral-600">
                            Manage account, subscription, connections, and notifications.
                        </p>

                        <div className="mt-4 inline-flex rounded-full border border-neutral-200 bg-white p-1">
                            <button
                                type="button"
                                onClick={() => setActiveTab("account")}
                                className={[
                                    "rounded-full px-3 py-1 text-[11px] font-semibold transition",
                                    activeTab === "account"
                                        ? "bg-accent text-white shadow-sm"
                                        : "text-neutral-900 hover:bg-neutral-100",
                                ].join(" ")}
                            >
                                Account
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("notifications")}
                                className={[
                                    "rounded-full px-3 py-1 text-[11px] font-semibold transition",
                                    activeTab === "notifications"
                                        ? "bg-accent text-white shadow-sm"
                                        : "text-neutral-900 hover:bg-neutral-100",
                                ].join(" ")}
                            >
                                Notifications
                            </button>
                        </div>
                    </div>
                </section>

                <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div
                            className="h-12 w-12 grid place-items-center rounded-full text-white font-semibold"
                            style={{ background: ACCENT }}
                        >
                            {initials}
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-neutral-800 truncate">
                                {profileNameDraft || user?.displayName || user?.email || "Signed in"}
                            </div>
                            <div className="text-xs text-neutral-500">{user && `User ID: ${user.uid.slice(0, 8)}…`}</div>
                        </div>
                    </div>
                </section>

                <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-neutral-700" />
                        <h2 className="text-sm font-semibold text-neutral-800">Profile</h2>
                    </div>

                    <p className="mt-2 text-xs text-neutral-600">
                        Keep your account name current. This saves to your Firebase account and your Kloner user record.
                    </p>

                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                        <label className="block">
                            <span className="text-[11px] font-semibold text-neutral-700">Display name</span>
                            <input
                                value={profileNameDraft}
                                onChange={(e) => setProfileNameDraft(e.target.value)}
                                placeholder="Your name"
                                className="mt-1 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                                maxLength={80}
                            />
                        </label>

                        <button
                            type="button"
                            onClick={() => void handleSaveProfileName()}
                            disabled={profileNameSaving}
                            className={btnClass({ kind: "primary", disabled: profileNameSaving })}
                        >
                            {profileNameSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                            Save name
                        </button>
                    </div>

                    <div className="mt-2 text-[11px] text-neutral-500">
                        Signed in as {user?.email || "unknown"}
                    </div>

                    {profileNameError && <p className="mt-2 text-xs text-red-600">{profileNameError}</p>}
                    {profileNameSuccess && <p className="mt-2 text-xs text-emerald-600">{profileNameSuccess}</p>}
                </section>

                {activeTab === "notifications" ? (
                    <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-2">
                            <Bell className="h-4 w-4 text-neutral-700" />
                            <h2 className="text-sm font-semibold text-neutral-800">Notification settings</h2>
                        </div>

                        <p className="mt-2 text-xs text-neutral-600">
                            Journey emails are triggered by where you stopped: scanned a URL, created a render, connected Vercel, or hit the paywall.
                        </p>

                        {unsubStatus === "ok" && (prefsLoading || !prefsLoaded) && !prefsError && !unsubConfirmed && (
                            <p className="mt-2 text-xs text-neutral-600">Updating your notification preferences…</p>
                        )}

                        {unsubConfirmed && (
                            <p className="mt-2 text-xs text-emerald-600">
                                {unsubKind === "journey" && "You are unsubscribed from journey emails."}
                                {unsubKind === "product" && "You are unsubscribed from product updates."}
                                {unsubKind === "all" && "You are unsubscribed from journey emails and product updates."}
                            </p>
                        )}

                        {unsubMismatch && (
                            <p className="mt-2 text-xs text-amber-700">
                                Unsubscribe was processed, but this account still has
                                {unsubKind === "product"
                                    ? " product updates"
                                    : unsubKind === "all"
                                      ? " journey emails and/or product updates"
                                      : " journey emails"} enabled.
                                You may be signed into a different account than the email link.
                            </p>
                        )}
                        {unsubStatus === "invalid" && (
                            <p className="mt-2 text-xs text-red-600">Unsubscribe link was invalid.</p>
                        )}
                        {unsubStatus === "missing" && (
                            <p className="mt-2 text-xs text-red-600">Unsubscribe link was missing data.</p>
                        )}

                        {prefsLoading ? (
                            <div className="mt-3 inline-flex items-center gap-2 text-xs text-neutral-600">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading preferences…
                            </div>
                        ) : (
                            <div className="mt-4 grid sm:grid-cols-2 gap-3">
                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-neutral-900 truncate">Journey emails</div>
                                            <div className="mt-1 text-xs text-neutral-600">
                                                Daily nudges based on your progress (paywall, Vercel, renders, scans).
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void savePrefs({ ...prefs, journeyEmails: !prefs.journeyEmails })}
                                            className={[
                                                "relative inline-flex h-7 w-12 items-center rounded-full transition",
                                                prefs.journeyEmails ? "bg-neutral-900" : "bg-neutral-300",
                                            ].join(" ")}
                                            role="switch"
                                            aria-checked={prefs.journeyEmails}
                                            aria-label="Toggle journey emails"
                                        >
                                            <span
                                                className={[
                                                    "inline-block h-5 w-5 transform rounded-full bg-white transition",
                                                    prefs.journeyEmails ? "translate-x-6" : "translate-x-1",
                                                ].join(" ")}
                                            />
                                        </button>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-neutral-900 truncate">Product updates</div>
                                            <div className="mt-1 text-xs text-neutral-600">
                                                Occasional feature updates and release notes.
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void savePrefs({ ...prefs, productEmails: !prefs.productEmails })}
                                            className={[
                                                "relative inline-flex h-7 w-12 items-center rounded-full transition",
                                                prefs.productEmails ? "bg-neutral-900" : "bg-neutral-300",
                                            ].join(" ")}
                                            role="switch"
                                            aria-checked={prefs.productEmails}
                                            aria-label="Toggle product update emails"
                                        >
                                            <span
                                                className={[
                                                    "inline-block h-5 w-5 transform rounded-full bg-white transition",
                                                    prefs.productEmails ? "translate-x-6" : "translate-x-1",
                                                ].join(" ")}
                                            />
                                        </button>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-neutral-900 truncate">Security emails</div>
                                            <div className="mt-1 text-xs text-neutral-600">
                                                Login and billing safety notices. Recommended.
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void savePrefs({ ...prefs, securityEmails: !prefs.securityEmails })}
                                            className={[
                                                "relative inline-flex h-7 w-12 items-center rounded-full transition",
                                                prefs.securityEmails ? "bg-neutral-900" : "bg-neutral-300",
                                            ].join(" ")}
                                            role="switch"
                                            aria-checked={prefs.securityEmails}
                                            aria-label="Toggle security emails"
                                        >
                                            <span
                                                className={[
                                                    "inline-block h-5 w-5 transform rounded-full bg-white transition",
                                                    prefs.securityEmails ? "translate-x-6" : "translate-x-1",
                                                ].join(" ")}
                                            />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {prefsError && <p className="mt-3 text-xs text-red-600">{prefsError}</p>}
                        {prefsSaved && <p className="mt-3 text-xs text-emerald-600">{prefsSaved}</p>}

                        <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-3">
                            <div className="text-xs font-semibold text-neutral-900">Email tracking</div>
                            <p className="mt-1 text-xs text-neutral-600">
                                Links include UTM parameters for analytics.
                            </p>
                        </div>
                    </section>
                ) : (
                    <>
                        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center gap-2">
                                <Plug className="h-4 w-4 text-neutral-700" />
                                <h2 className="text-sm font-semibold text-neutral-800">Connections</h2>
                            </div>

                            <div className="mt-3 grid sm:grid-cols-2 gap-3">
                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Rocket className="h-4 w-4 text-neutral-700" />
                                            <div className="text-sm font-medium text-neutral-800">Vercel</div>
                                        </div>
                                        {!isVercelConnected ? (
                                            <span
                                                className={
                                                    "rounded-full px-2 py-0.5 text-[10px] font-semibold border " + vercelBadgeClasses
                                                }
                                            >
                                                {vercelBadgeLabel}
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="mt-1 text-xs text-neutral-600">Deploy live sites and apps directly from Kloner.</p>

                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={handleConnectVercel}
                                            disabled={isVercelConnected || isVercelChecking}
                                            className={btnClass({
                                                kind: "soft",
                                                disabled: isVercelConnected || isVercelChecking,
                                            })}
                                        >
                                            {isVercelChecking && !isVercelConnected ? (
                                                <>
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    Checking…
                                                </>
                                            ) : isVercelConnected ? (
                                                <>
                                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                                    Connected
                                                </>
                                            ) : (
                                                <>
                                                    <Plug className="h-3.5 w-3.5" />
                                                    Connect
                                                </>
                                            )}
                                        </button>

                                        <details className="group relative">
                                            <summary
                                                className="list-none cursor-pointer select-none inline-flex items-center gap-1 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 [&::-webkit-details-marker]:hidden"
                                                title={
                                                    !isVercelConnected
                                                        ? "Already disconnected"
                                                        : isVercelChecking
                                                            ? "Checking integration…"
                                                            : "Manage Vercel connection"
                                                }
                                            >
                                                Manage
                                                <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
                                            </summary>

                                            <div className="absolute left-0 top-full z-20 mt-2 min-w-44 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleDisconnectVercelConfirmed()}
                                                    disabled={!isVercelConnected || isVercelChecking || disconnectBusy}
                                                    className="inline-flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] font-medium text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    {disconnectBusy ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        <XCircle className="h-3.5 w-3.5" />
                                                    )}
                                                    Disconnect Vercel
                                                </button>
                                            </div>
                                        </details>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Bell className="h-4 w-4 text-neutral-700" />
                                            <div className="text-sm font-medium text-neutral-800">Email Alerts</div>
                                        </div>
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                            managed in Notifications
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-neutral-600">
                                        Marketing and system alerts live in the Notifications tab.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab("notifications")}
                                        className={btnClass({ kind: "soft", disabled: false })}
                                    >
                                        Manage
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center gap-2">
                                <Shield className="h-4 w-4 text-neutral-700" />
                                <h2 className="text-sm font-semibold text-neutral-800">Security</h2>
                            </div>

                            <div className="mt-3 grid sm:grid-cols-2 gap-3">
                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-medium text-neutral-800">Two-Factor Auth</div>
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                            not available yet
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-neutral-600">
                                        Add an extra layer of protection to your account.
                                    </p>
                                    <button disabled className={btnClass({ kind: "soft", disabled: true })}>
                                        Enable
                                    </button>
                                </div>

                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-medium text-neutral-800">API Keys</div>
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                            coming soon
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-neutral-600">Generate API keys for advanced automation.</p>
                                    <button disabled className={btnClass({ kind: "soft", disabled: true })}>
                                        View Keys
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center gap-2">
                                <LayoutGrid className="h-4 w-4 text-neutral-700" />
                                <h2 className="text-sm font-semibold text-neutral-800">Workspace preferences</h2>
                            </div>

                            <p className="mt-2 text-xs text-neutral-600">
                                Typical builder controls that change how the dashboard behaves.
                            </p>

                            <div className="mt-3 space-y-3">
                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-medium text-neutral-800">Compact dashboard layout</div>
                                            <p className="mt-1 text-xs text-neutral-600">
                                                Shrink the main dashboard cards so more projects fit on screen.
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            disabled={dashboardPrefsSaving}
                                            onClick={() => void handleToggleDashboardPref("compactDashboardLayout", !dashboardPrefs.compactDashboardLayout)}
                                            className={btnClass({ kind: dashboardPrefs.compactDashboardLayout ? "primary" : "soft", disabled: dashboardPrefsSaving })}
                                        >
                                            {dashboardPrefs.compactDashboardLayout ? "On" : "Off"}
                                        </button>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-800">
                                                <ArchiveRestore className="h-4 w-4 text-neutral-700" />
                                                Show archived apps
                                            </div>
                                            <p className="mt-1 text-xs text-neutral-600">
                                                Keep archived apps visible in the dashboard list instead of hiding them.
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            disabled={dashboardPrefsSaving}
                                            onClick={() => void handleToggleDashboardPref("showArchivedApps", !dashboardPrefs.showArchivedApps)}
                                            className={btnClass({ kind: dashboardPrefs.showArchivedApps ? "primary" : "soft", disabled: dashboardPrefsSaving })}
                                        >
                                            {dashboardPrefs.showArchivedApps ? "On" : "Off"}
                                        </button>
                                    </div>
                                </div>

                                {dashboardPrefsError && <p className="text-[11px] text-red-600">{dashboardPrefsError}</p>}
                                {dashboardPrefsSaved && <p className="text-[11px] text-emerald-600">{dashboardPrefsSaved}</p>}
                            </div>
                        </section>

                        <section className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                            <div className="flex items-center gap-2 text-neutral-800">
                                <h2 className="text-sm font-semibold">Account and data</h2>
                            </div>

                            <p className="mt-2 text-xs text-neutral-600">
                                You can export your data or delete your account directly. If something fails, contact support and we&apos;ll
                                help finish the request.
                            </p>

                            <div className="mt-3 space-y-3">
                                <div className="flex flex-wrap items-center gap-2 font-normal">
                                    <button
                                        type="button"
                                        onClick={() => void handleExportAccountData()}
                                        disabled={accountActionBusy}
                                        className={btnClass({ kind: "soft", disabled: accountActionBusy })}
                                    >
                                        Export my data
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleDeleteAccount()}
                                        disabled={accountActionBusy}
                                        className={btnClass({ kind: "danger", disabled: accountActionBusy })}
                                    >
                                        Delete account
                                    </button>
                                </div>

                                <div className="flex flex-wrap font-normal items-center gap-2">
                                    <a
                                        href="mailto:support@kloner.app?subject=Kloner%20account%20closure%20or%20data%20deletion%20request"
                                        className={btnClass({ kind: "primary", disabled: false })}
                                    >
                                        Email Support
                                    </a>
                                    <span className="text-[11px] text-neutral-500">support@kloner.app</span>
                                </div>

                                {accountActionError && <p className="text-[11px] text-red-600">{accountActionError}</p>}
                                {accountActionSuccess && <p className="text-[11px] text-emerald-600">{accountActionSuccess}</p>}
                            </div>
                        </section>

                        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center gap-2">
                                <Rocket className="h-4 w-4 text-neutral-700" />
                                <h2 className="text-sm font-semibold text-neutral-800">Billing & subscription</h2>
                            </div>

                            <details className="group mt-3 px-1 py-1">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-medium text-neutral-800 [&::-webkit-details-marker]:hidden">
                                    <span className="inline-flex items-center gap-2">
                                        <span>Subscription status</span>
                                        <span
                                            className={
                                                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold " +
                                                tierBadgeClasses
                                            }
                                        >
                                            {tierLoading ? "Checking..." : tierLabel}
                                        </span>
                                    </span>

                                    <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500 transition-transform duration-200 group-open:rotate-180" />
                                </summary>

                                <div className="mt-3 space-y-3">
                                    <p className="text-xs text-neutral-600">
                                        {tier === "free" && "Free tier with low daily preview and snapshot limits."}
                                        {tier === "pro" && "Pro tier with higher limits and priority processing."}
                                        {tier === "agency" && "Agency tier for higher volume and team workflows."}
                                    </p>

                                    <p className="text-[11px] text-neutral-500">
                                        Stripe status: <span className="font-semibold">{stripeStatusLabel}</span>
                                        {downgradeNotice && <> · your account will fall back to the Free tier after this period.</>}
                                    </p>

                                    {onTrial && trialDaysRemaining !== null && (
                                        <p className="text-[11px] text-neutral-500">
                                            Trial ends in{" "}
                                            <span className="font-semibold">
                                                {trialDaysRemaining} day{trialDaysRemaining === 1 ? "" : "s"}
                                            </span>{" "}
                                            · {formatUnixSeconds(trialEndSec)}
                                        </p>
                                    )}

                                    {!onTrial && nextBillingLabel && (
                                        <p className="text-[11px] text-neutral-500">
                                            Next billing: <span className="font-semibold">{nextBillingLabel}</span>
                                        </p>
                                    )}

                                    {cancelAtPeriodEnd && endOfAccessDays !== null && endOfAccessSec && (
                                        <p className="text-[11px] text-amber-700">
                                            Cancellation scheduled · access ends in{" "}
                                            <span className="font-semibold">
                                                {endOfAccessDays} day{endOfAccessDays === 1 ? "" : "s"}
                                            </span>{" "}
                                            · {formatUnixSeconds(endOfAccessSec)}
                                        </p>
                                    )}

                                    {tierError && <p className="text-[11px] text-red-600">{tierError}</p>}
                                    {cancelError && <p className="text-[11px] text-red-600">{cancelError}</p>}
                                    {cancelSuccess && <p className="text-[11px] text-emerald-600">{cancelSuccess}</p>}

                                    {renewError && <p className="text-[11px] text-red-600">{renewError}</p>}
                                    {renewSuccess && <p className="text-[11px] text-emerald-600">{renewSuccess}</p>}
                                    <span className="text-[11px] text-neutral-500">Billing managed by Stripe</span>

                                    <div className="flex flex-col gap-2 pt-1">
                                        <a
                                            href="/price"
                                            className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-700 hover:text-neutral-900"
                                        >
                                            View plans
                                        </a>

                                        {showRenewSubscription && (
                                            <button
                                                type="button"
                                                onClick={() => void handleRenewSubscription()}
                                                disabled={!canRenew || renewBusy}
                                                className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 disabled:opacity-50 disabled:pointer-events-none"
                                                title={canRenew ? "Remove scheduled cancellation" : "No cancellation scheduled"}
                                            >
                                                {renewBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                                Renew
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={openCancelFeedbackPopup}
                                            disabled={!canCancel || cancelBusy}
                                            className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 disabled:opacity-50 disabled:pointer-events-none"
                                        >
                                            {cancelBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                                            Cancel subscription
                                        </button>

                                        {onTrial && (
                                            <p className="max-w-[18rem] text-right text-[11px] leading-5 text-amber-700 sm:max-w-[20rem]">
                                                Cancelling during trial ends website generation access immediately.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </details>
                        </section>

                        {showCancelFeedbackPopup && (
                            <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/35 px-3 py-3 sm:items-center">
                                <div className="w-full max-w-xl rounded-3xl border border-neutral-200 bg-white p-4 shadow-2xl sm:p-5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h3 className="text-base font-semibold text-neutral-900">Cancel subscription</h3>
                                            <p className="mt-1 text-sm text-neutral-600">
                                                Tell us why you’re leaving. This helps us understand what to improve.
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => setShowCancelFeedbackPopup(false)}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                                            aria-label="Close cancellation feedback"
                                        >
                                            <XCircle className="h-5 w-5" />
                                        </button>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                        <div className="space-y-2">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Choose a reason</p>
                                            {CANCELLATION_REASON_OPTIONS.map((reason) => {
                                                const selected = cancelReason.toLowerCase() === reason.toLowerCase();

                                                return (
                                                    <button
                                                        key={reason}
                                                        type="button"
                                                        onClick={() => applyCancellationReasonPreset(reason)}
                                                        className={[
                                                            "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition",
                                                            selected
                                                                ? "border-neutral-900 bg-neutral-50 text-neutral-900"
                                                                : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                                                        ].join(" ")}
                                                    >
                                                        <span
                                                            className={[
                                                                "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                                                                selected
                                                                    ? "border-neutral-900 bg-neutral-900"
                                                                    : "border-neutral-300 bg-white",
                                                            ].join(" ")}
                                                        >
                                                            <span
                                                                className={[
                                                                    "h-2.5 w-2.5 rounded-full bg-white transition",
                                                                    selected ? "scale-100" : "scale-0",
                                                                ].join(" ")}
                                                            />
                                                        </span>
                                                        {reason}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        <label className="block">
                                            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Feedback</span>
                                            <textarea
                                                value={cancelFeedback}
                                                onChange={(e) => setCancelFeedback(e.target.value.slice(0, 200))}
                                                placeholder="What should we improve?"
                                                rows={4}
                                                maxLength={200}
                                                className="mt-1 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                                            />
                                            <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
                                                <span>Add a note if you want, or just pick a reason.</span>
                                                <span>{cancelFeedback.length}/200</span>
                                            </div>
                                        </label>
                                    </div>

                                    {cancelError && <p className="mt-3 text-xs text-red-600">{cancelError}</p>}

                                    <div className="mt-5 flex items-center justify-end gap-2 border-t border-neutral-200 pt-4">
                                        <button
                                            type="button"
                                            onClick={handleKeepProjectsAndClose}
                                            className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                                        >
                                            No, don&apos;t stop my projects
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => void handleCancelSubscription()}
                                            disabled={cancelBusy || (!cancelReason.trim() && !cancelFeedback.trim())}
                                            className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {cancelBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                            <span className="ml-2">Confirm cancellation</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-700">
                            <Gauge className="h-3.5 w-3.5" />
                            <span>System status:</span>
                            <span className="font-semibold text-emerald-600">OK</span>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        </div>

                        <section className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                            <div className="mt-1">
                                <p className="text-[11px] font-semibold text-red-600">Danger zone</p>
                                <p className="mt-1 text-[11px] text-neutral-600">
                                    Delete deployments recorded by Kloner and their associated screenshots and render metadata. This does not close your Kloner account.
                                </p>
                            </div>

                            {deploymentsLoading ? (
                                <p className="mt-2 text-[11px] text-neutral-500">Loading deployments…</p>
                            ) : deploymentsError ? (
                                <p className="mt-2 text-[11px] text-red-600">{deploymentsError}</p>
                            ) : deployments.length === 0 ? (
                                <p className="mt-2 text-[11px] text-neutral-500">
                                    No deployments found for this account. Older Vercel projects that Kloner never recorded must be deleted directly in Vercel.
                                </p>
                            ) : (
                                <div className="mt-3 space-y-3">
                                    <div className="flex flex-wrap items-center gap-2 justify-between">
                                        <div className="inline-flex items-center gap-2 text-[11px] text-neutral-600">
                                            <span>
                                                {visibleDeployments.length} deployment{visibleDeployments.length === 1 ? "" : "s"} in view
                                            </span>
                                            <span className="h-1 w-1 rounded-full bg-neutral-300" />
                                            <span>{selectedDeploymentIds.length} selected</span>
                                        </div>

                                        <div className="flex items-center gap-2 text-[11px]">
                                            <button
                                                type="button"
                                                onClick={() => setDeploymentFilter("all")}
                                                className={btnClass({
                                                    kind: deploymentFilter === "all" ? "soft" : "ghost",
                                                    disabled: false,
                                                })}
                                            >
                                                All
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDeploymentFilter("live-only")}
                                                className={btnClass({
                                                    kind: deploymentFilter === "live-only" ? "soft" : "ghost",
                                                    disabled: false,
                                                })}
                                            >
                                                Live deployments
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDeploymentFilter("live-projects")}
                                                className={btnClass({
                                                    kind: deploymentFilter === "live-projects" ? "soft" : "ghost",
                                                    disabled: false,
                                                })}
                                            >
                                                Live projects + history
                                            </button>
                                        </div>
                                    </div>

                                    {visibleDeployments.length === 0 ? (
                                        <p className="text-[11px] text-neutral-500">
                                            No deployments in this filter. Switch filters to see others.
                                        </p>
                                    ) : (
                                        <div className="rounded-lg border border-red-100 bg-white">
                                            <div className="flex items-center px-3 py-2 border-b border-red-100 text-[11px] text-neutral-700">
                                                <label className="inline-flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={allVisibleSelected}
                                                        onChange={handleToggleAllVisible}
                                                        aria-checked={someVisibleSelected ? "mixed" : allVisibleSelected}
                                                    />
                                                    <span>Select all in view</span>
                                                </label>
                                                <span className="ml-auto text-[10px] text-neutral-400">
                                                    Only deployments recorded in Kloner are shown
                                                </span>
                                            </div>

                                            <div className="max-h-64 overflow-y-auto divide-y divide-red-50">
                                                {visibleDeployments.map((d) => {
                                                    const state = toUiState(d, latestReadyByProject);
                                                    const displayUrl =
                                                        d.publicDomain ||
                                                        d.publicUrl ||
                                                        (d.publicDomain ? `https://${d.publicDomain}` : null) ||
                                                        d.url ||
                                                        null;

                                                    const labelParts: string[] = [];
                                                    if (d.vercelProjectName) labelParts.push(d.vercelProjectName);
                                                    if (displayUrl) labelParts.push(displayUrl);

                                                    const label = labelParts.join(" · ") || d.id || "Unnamed deployment";

                                                    return (
                                                        <div key={d.id} className="flex items-center gap-3 px-3 py-2 text-[11px] text-neutral-800">
                                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedDeploymentIds.includes(d.id)}
                                                                    onChange={() => handleToggleDeployment(d.id)}
                                                                />
                                                                <div className="min-w-0">
                                                                    <div className="truncate">{label}</div>
                                                                    <div className="text-[10px] text-neutral-500">
                                                                        {formatUnixSeconds(d.createdAt ? Math.floor(d.createdAt / 1000) : null) ||
                                                                            "Unknown time"}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="text-[10px] text-neutral-600">{stateLabel(state)}</div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between mt-2">
                                        <button
                                            type="button"
                                            onClick={handleDeleteDeploymentBulk}
                                            disabled={selectedDeploymentIds.length === 0 || deleteDeploymentBusy}
                                            className={btnClass({
                                                kind: "danger",
                                                disabled: selectedDeploymentIds.length === 0 || deleteDeploymentBusy,
                                            })}
                                        >
                                            {deleteDeploymentBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                                            <span>
                                                Delete selected deployment{selectedDeploymentIds.length === 1 ? "" : "s"}
                                            </span>
                                        </button>

                                        <div className="text-[10px] text-neutral-500 max-w-xs text-right">
                                            Deletion here removes Firestore deployment docs, associated Kloner render docs, and any screenshots stored under that render. Older Vercel projects that Kloner never recorded must still be deleted directly in Vercel.
                                        </div>
                                    </div>

                                    {deleteDeploymentError && <p className="mt-1 text-[11px] text-red-600">{deleteDeploymentError}</p>}
                                    {deleteDeploymentSuccess && (
                                        <p className="mt-1 text-[11px] text-emerald-600">{deleteDeploymentSuccess}</p>
                                    )}
                                </div>
                            )}
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}
