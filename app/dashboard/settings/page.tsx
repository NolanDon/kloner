// app/settings/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
    CheckCircle2,
    Shield,
    Bell,
    Rocket,
    Plug,
    Gauge,
    Loader2,
    XCircle,
} from "lucide-react";
import NavBar from "@/components/NavBar";
import { useVercelIntegration } from "@/src/hooks/useVercelIntegration";
import { ensureSessionAndCsrf } from "../../login/LoginForm";

const ACCENT = "#f55f2a";
const VERCEL_INTEGRATION_SLUG =
    process.env.NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG || "kloner";

type BillingTier = "free" | "pro" | "agency";

type TierResponse = {
    uid: string;
    tier: BillingTier;
    stripeStatus: string | null;
    currentPeriodEnd: number | null; // unix seconds
    cancelAtPeriodEnd: boolean | null;
    trialEnd?: number | null; // unix seconds
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

type UiState =
    | "active"
    | "ready"
    | "offline"
    | "building"
    | "error"
    | "canceled"
    | "unknown";

function toDateFromUnixSeconds(v: number | null | undefined): Date | null {
    if (v === null || v === undefined) return null;
    const ms = v > 10_000_000_000 ? v : v * 1000; // tolerate ms accidentally
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

    if (d.vercelReadyState || d.vercelState || d.lastEventType) {
        return "building";
    }

    return "unknown";
}

function projectKeyForDeployment(d: DeploymentSummary): string {
    const pid = d.vercelProjectId || "no-id";
    const pname = d.vercelProjectName || "Unknown project";
    return `${pid}::${pname}`;
}

function toUiState(
    d: DeploymentSummary,
    latestReadyByProject: Map<string, string>,
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
    const [user, setUser] = useState<User | null>(null);
    const [disconnectBusy, setDisconnectBusy] = useState(false);

    const [tier, setTier] = useState<BillingTier>("free");
    const [tierLoading, setTierLoading] = useState(false);
    const [tierError, setTierError] = useState<string | null>(null);
    const [stripeStatus, setStripeStatus] = useState<string | null>(null);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState<boolean | null>(
        null,
    );

    const [currentPeriodEndSec, setCurrentPeriodEndSec] = useState<number | null>(
        null,
    );
    const [trialEndSec, setTrialEndSec] = useState<number | null>(null);

    const [cancelBusy, setCancelBusy] = useState(false);
    const [cancelError, setCancelError] = useState<string | null>(null);
    const [cancelSuccess, setCancelSuccess] = useState<string | null>(null);

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
    const [deleteDeploymentError, setDeleteDeploymentError] = useState<
        string | null
    >(null);
    const [deleteDeploymentSuccess, setDeleteDeploymentSuccess] = useState<
        string | null
    >(null);

    type DeploymentFilter = "all" | "live-only" | "live-projects";
    const [deploymentFilter, setDeploymentFilter] =
        useState<DeploymentFilter>("all");

    const [selectedDeploymentIds, setSelectedDeploymentIds] = useState<string[]>(
        [],
    );

    useEffect(() => {
        const off = onAuthStateChanged(auth, (u) => setUser(u));
        return () => off();
    }, []);

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
        const ctrl = new AbortController();
        void loadTier(ctrl.signal);
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
                setSelectedDeploymentIds((prev) =>
                    prev.filter((id) => list.some((d) => d.id === id)),
                );
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
            if (!map.has(key)) {
                map.set(key, d.vercelDeploymentId);
            }
        }
        return map;
    }, [deployments]);

    const liveProjectKeys = useMemo(() => {
        const set = new Set<string>();
        for (const d of deployments) {
            const state = toUiState(d, latestReadyByProject);
            if (state === "active") {
                set.add(projectKeyForDeployment(d));
            }
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

    const allVisibleIds = useMemo(
        () => visibleDeployments.map((d) => d.id),
        [visibleDeployments],
    );

    const allVisibleSelected =
        allVisibleIds.length > 0 &&
        allVisibleIds.every((id) => selectedDeploymentIds.includes(id));
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

        document.cookie = [
            `vercel_oauth_state=${state}`,
            "Path=/",
            "Max-Age=600",
            "SameSite=Lax",
        ].join("; ");

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

    function handleToggleDeployment(id: string) {
        setSelectedDeploymentIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    }

    function handleToggleAllVisible() {
        if (allVisibleSelected) {
            setSelectedDeploymentIds((prev) =>
                prev.filter((id) => !allVisibleIds.includes(id)),
            );
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

        const confirmed = window.confirm(
            `Delete ${label} and any associated screenshots? This cannot be undone.`,
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
                setDeleteDeploymentError(
                    data?.error || `Delete failed (HTTP ${res.status})`,
                );
                return;
            }

            const deletedIds = (data.results || [])
                .filter((r: any) => r && r.ok && r.firestoreDeleted)
                .map((r: any) => r.deploymentId as string);

            setDeployments((prev) => prev.filter((d) => !deletedIds.includes(d.id)));
            setSelectedDeploymentIds((prev) =>
                prev.filter((id) => !deletedIds.includes(id)),
            );

            setDeleteDeploymentSuccess(
                `Deleted ${deletedIds.length} deployment${deletedIds.length === 1 ? "" : "s"
                }.`,
            );
        } catch (err: any) {
            console.error("Delete deployment error", err);
            setDeleteDeploymentError(err?.message || "Delete failed.");
        } finally {
            setDeleteDeploymentBusy(false);
        }
    }

    async function handleCancelSubscription() {
        const confirmed = window.confirm(
            "Cancel your subscription at the end of the current period? You’ll keep access until then.",
        );
        if (!confirmed) return;

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
                body: JSON.stringify({ atPeriodEnd: true }),
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data?.ok) {
                setCancelError(data?.error || `Cancel failed (HTTP ${res.status})`);
                return;
            }

            setCancelSuccess("Cancellation scheduled. You’ll keep access until the end date.");
            await loadTier();
        } catch (err: any) {
            console.error("Cancel subscription error", err);
            setCancelError(err?.message || "Cancel failed.");
        } finally {
            setCancelBusy(false);
        }
    }

    async function handleRenewSubscription() {
        // This is NOT “charge now”. This only unsets cancel_at_period_end.
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

    // Trial status remains "trialing" in Stripe until trial_end.
    const onTrial =
        !!trialEndSec &&
        trialEndSec > nowSec &&
        stripeStatus === "trialing";

    const trialDaysRemaining = onTrial ? daysUntilUnixSeconds(trialEndSec) : null;

    const nextBillingLabel = !onTrial && currentPeriodEndSec
        ? formatUnixSeconds(currentPeriodEndSec)
        : "";

    // On trial, “end of access” is effectively the trial end when cancellation is scheduled.
    const endOfAccessSec =
        cancelAtPeriodEnd ? (onTrial ? trialEndSec : currentPeriodEndSec) : null;

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

    return (
        <>
            {/* <NavBar /> */}
            <main className="min-h-screen bg-white pb-[30px] overflow-y-auto">
                <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 py-8">
                    {/* Hero */}
                    <section className="mb-10">
                        <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                            <span>Kloner · Settings</span>
                        </div>

                        <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-8 sm:px-8 sm:py-10 shadow-sm">
                            <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                                Settings
                            </h1>
                            <p className="mt-1 text-sm text-neutral-600">
                                Manage account, subscription, connections, and notifications.
                            </p>
                        </div>
                    </section>

                    {/* Profile */}
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
                                    {user?.displayName || user?.email || "Signed in"}
                                </div>
                                <div className="text-xs text-neutral-500">
                                    {user && `User ID: ${user.uid.slice(0, 8)}…`}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Subscription / plan */}
                    <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-2">
                            <Rocket className="h-4 w-4 text-neutral-700" />
                            <h2 className="text-sm font-semibold text-neutral-800">
                                Subscription
                            </h2>
                        </div>

                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-neutral-800">
                                        Current plan:
                                    </span>
                                    <span
                                        className={
                                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold " +
                                            tierBadgeClasses
                                        }
                                    >
                                        {tierLoading ? "Checking..." : tierLabel}
                                    </span>
                                </div>

                                <p className="mt-1 text-xs text-neutral-600">
                                    {tier === "free" &&
                                        "Free tier with low daily preview and snapshot limits."}
                                    {tier === "pro" &&
                                        "Pro tier with higher limits and priority processing."}
                                    {tier === "agency" &&
                                        "Agency tier for higher volume and team workflows."}
                                </p>

                                {tierError && (
                                    <p className="mt-1 text-xs text-red-600">{tierError}</p>
                                )}

                                {!tierError && !tierLoading && (
                                    <div className="mt-2 space-y-1">
                                        <p className="text-[11px] text-neutral-500">
                                            Stripe status:{" "}
                                            <span className="font-semibold">{stripeStatusLabel}</span>
                                            {downgradeNotice && (
                                                <>
                                                    {" "}
                                                    · your account will fall back to the Free tier after this period.
                                                </>
                                            )}
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
                                                Next billing:{" "}
                                                <span className="font-semibold">{nextBillingLabel}</span>
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

                                        {cancelError && (
                                            <p className="text-[11px] text-red-600">{cancelError}</p>
                                        )}
                                        {cancelSuccess && (
                                            <p className="text-[11px] text-emerald-600">{cancelSuccess}</p>
                                        )}

                                        {renewError && (
                                            <p className="text-[11px] text-red-600">{renewError}</p>
                                        )}
                                        {renewSuccess && (
                                            <p className="text-[11px] text-emerald-600">{renewSuccess}</p>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col items-start gap-2 sm:items-end">
                                <a
                                    href="/price"
                                    className={btnClass({
                                        kind: "soft",
                                        disabled: false,
                                    })}
                                >
                                    View plans
                                </a>

                                <button
                                    type="button"
                                    onClick={() => void handleRenewSubscription()}
                                    disabled={!canRenew || renewBusy}
                                    className={btnClass({
                                        kind: canRenew ? "warn" : "ghost",
                                        disabled: !canRenew || renewBusy,
                                    })}
                                    title={
                                        canRenew
                                            ? "Remove scheduled cancellation"
                                            : "No cancellation scheduled"
                                    }
                                >
                                    {renewBusy ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                    )}
                                    Renew
                                </button>

                                <button
                                    type="button"
                                    onClick={() => void handleCancelSubscription()}
                                    disabled={!canCancel || cancelBusy}
                                    className={btnClass({
                                        kind: canCancel ? "danger" : "ghost",
                                        disabled: !canCancel || cancelBusy,
                                    })}
                                >
                                    {cancelBusy ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <XCircle className="h-3.5 w-3.5" />
                                    )}
                                    Cancel subscription
                                </button>

                                <span className="text-[11px] text-neutral-500">
                                    Billing managed by Stripe
                                </span>
                            </div>
                        </div>
                    </section>

                    {/* Connections */}
                    <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-2">
                            <Plug className="h-4 w-4 text-neutral-700" />
                            <h2 className="text-sm font-semibold text-neutral-800">
                                Connections
                            </h2>
                        </div>

                        <div className="mt-3 grid sm:grid-cols-2 gap-3">
                            {/* Vercel connection card */}
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Rocket className="h-4 w-4 text-neutral-700" />
                                        <div className="text-sm font-medium text-neutral-800">
                                            Vercel
                                        </div>
                                    </div>
                                    <span
                                        className={
                                            "rounded-full px-2 py-0.5 text-[10px] font-semibold border " +
                                            vercelBadgeClasses
                                        }
                                    >
                                        {vercelBadgeLabel}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-600">
                                    Deploy previews directly from Kloner.
                                </p>

                                <div className="mt-2 flex gap-2">
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

                                    <button
                                        type="button"
                                        onClick={() => void handleDisconnectVercel()}
                                        disabled={!isVercelConnected || isVercelChecking || disconnectBusy}
                                        className={btnClass({
                                            kind: "warn",
                                            disabled: !isVercelConnected || isVercelChecking || disconnectBusy,
                                        })}
                                        title={
                                            !isVercelConnected
                                                ? "Already disconnected"
                                                : isVercelChecking
                                                    ? "Checking integration…"
                                                    : undefined
                                        }
                                    >
                                        {disconnectBusy ? (
                                            <>
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                Disconnecting…
                                            </>
                                        ) : (
                                            <>
                                                <XCircle className="h-3.5 w-3.5" />
                                                Disconnect
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Email alerts placeholder */}
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Bell className="h-4 w-4 text-neutral-700" />
                                        <div className="text-sm font-medium text-neutral-800">
                                            Email Alerts
                                        </div>
                                    </div>
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                        coming soon
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-600">
                                    Notify on render completion and deploy status.
                                </p>
                                <button
                                    disabled
                                    className={btnClass({ kind: "soft", disabled: true })}
                                >
                                    Manage
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Security */}
                    <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-neutral-700" />
                            <h2 className="text-sm font-semibold text-neutral-800">
                                Security
                            </h2>
                        </div>

                        <div className="mt-3 grid sm:grid-cols-2 gap-3">
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium text-neutral-800">
                                        Two-Factor Auth
                                    </div>
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                        not available yet
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-600">
                                    Add an extra layer of protection to your account.
                                </p>
                                <button
                                    disabled
                                    className={btnClass({ kind: "soft", disabled: true })}
                                >
                                    Enable
                                </button>
                            </div>

                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium text-neutral-800">
                                        API Keys
                                    </div>
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                        coming soon
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-600">
                                    Generate API keys for advanced automation.
                                </p>
                                <button
                                    disabled
                                    className={btnClass({ kind: "soft", disabled: true })}
                                >
                                    View Keys
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Account & data */}
                    <section className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                        <div className="flex items-center gap-2 text-neutral-800">
                            <h2 className="text-sm font-semibold">Account and data</h2>
                        </div>

                        <p className="mt-2 text-xs text-neutral-600">
                            If you want to close your Kloner account or request data deletion,
                            contact our team. We&apos;ll help export your data, review any active
                            deployments, and process deletion safely.
                        </p>

                        <div className="mt-3 flex flex-wrap font-normal items-center gap-2">
                            <a
                                href="mailto:support@kloner.app?subject=Kloner%20account%20closure%20or%20data%20deletion%20request"
                                className={btnClass({ kind: "primary", disabled: false })}
                            >
                                Email Support
                            </a>
                            <span className="text-[11px] text-neutral-500">
                                support@kloner.app
                            </span>
                        </div>
                    </section>

                    {/* Danger zone: bulk delete deployments + screenshots */}
                    <section className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                        <div className="mt-1">
                            <p className="text-[11px] font-semibold text-red-600">
                                Danger zone
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-600">
                                Delete deployments recorded by Kloner and their associated
                                screenshots and render metadata. This does not close your Kloner
                                account.
                            </p>
                        </div>

                        {deploymentsLoading ? (
                            <p className="mt-2 text-[11px] text-neutral-500">
                                Loading deployments…
                            </p>
                        ) : deploymentsError ? (
                            <p className="mt-2 text-[11px] text-red-600">
                                {deploymentsError}
                            </p>
                        ) : deployments.length === 0 ? (
                            <p className="mt-2 text-[11px] text-neutral-500">
                                No deployments found for this account. Older Vercel projects
                                that Kloner never recorded must be deleted directly in Vercel.
                            </p>
                        ) : (
                            <div className="mt-3 space-y-3">
                                <div className="flex flex-wrap items-center gap-2 justify-between">
                                    <div className="inline-flex items-center gap-2 text-[11px] text-neutral-600">
                                        <span>
                                            {visibleDeployments.length} deployment
                                            {visibleDeployments.length === 1 ? "" : "s"} in view
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
                                        No deployments in this filter. Switch filters to see
                                        others.
                                    </p>
                                ) : (
                                    <div className="rounded-lg border border-red-100 bg-white">
                                        <div className="flex items-center px-3 py-2 border-b border-red-100 text-[11px] text-neutral-700">
                                            <label className="inline-flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={allVisibleSelected}
                                                    onChange={handleToggleAllVisible}
                                                    aria-checked={
                                                        someVisibleSelected ? "mixed" : allVisibleSelected
                                                    }
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
                                                    <div
                                                        key={d.id}
                                                        className="flex items-center gap-3 px-3 py-2 text-[11px] text-neutral-800"
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedDeploymentIds.includes(d.id)}
                                                                onChange={() => handleToggleDeployment(d.id)}
                                                            />
                                                            <div className="min-w-0">
                                                                <div className="truncate">{label}</div>
                                                                <div className="text-[10px] text-neutral-500">
                                                                    {formatUnixSeconds(
                                                                        d.createdAt ? Math.floor(d.createdAt / 1000) : null,
                                                                    ) || "Unknown time"}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-[10px] text-neutral-600">
                                                            {stateLabel(state)}
                                                        </div>
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
                                        {deleteDeploymentBusy && (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        )}
                                        <span>
                                            Delete selected deployment
                                            {selectedDeploymentIds.length === 1 ? "" : "s"}
                                        </span>
                                    </button>

                                    <div className="text-[10px] text-neutral-500 max-w-xs text-right">
                                        Deletion here removes Firestore deployment docs,
                                        associated Kloner render docs, and any screenshots
                                        stored under that render. Older Vercel projects that
                                        Kloner never recorded must still be deleted directly in
                                        Vercel.
                                    </div>
                                </div>

                                {deleteDeploymentError && (
                                    <p className="mt-1 text-[11px] text-red-600">
                                        {deleteDeploymentError}
                                    </p>
                                )}
                                {deleteDeploymentSuccess && (
                                    <p className="mt-1 text-[11px] text-emerald-600">
                                        {deleteDeploymentSuccess}
                                    </p>
                                )}
                            </div>
                        )}
                    </section>

                    {/* System status */}
                    <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-700">
                        <Gauge className="h-3.5 w-3.5" />
                        <span>System status:</span>
                        <span className="font-semibold text-emerald-600">OK</span>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    </div>
                </div>
            </main>
        </>
    );
}
