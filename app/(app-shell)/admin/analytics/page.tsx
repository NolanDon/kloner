// app/(app-shell)/admin/analytics/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    Timestamp,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";

type GateState = "loading" | "allowed" | "denied";

type UserAnalyticsRow = {
    id: string;
    email?: string | null;
    tier?: string | null;
    createdAt?: Date | null;

    // credits from kloner_users root doc
    creditsAiEditsRemaining?: number | null;
    creditsPreviewRemaining?: number | null;
    creditsSnapshotRemaining?: number | null;

    // editor meta from kloner_users/{uid}/meta/editor
    editorSessionTotalMinutes?: number | null;
    editorSessionCount?: number | null;
    editorSaveTotal?: number | null;
    lastSessionEndedAt?: Date | null;

    // usage flags
    vercelConnected?: boolean;
    deploymentCount?: number;
};

type DailyBucket = {
    date: string; // YYYY-MM-DD
    count: number;
};

type TabId = "overview" | "usage" | "power" | "credits";

function tsToDate(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (v instanceof Timestamp) return v.toDate();
    if (typeof v === "object" && typeof v.toDate === "function") {
        return v.toDate();
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

export default function AdminAnalyticsPage() {
    const router = useRouter();

    const [gate, setGate] = useState<GateState>("loading");
    const [loadingData, setLoadingData] = useState(true);
    const [rows, setRows] = useState<UserAnalyticsRow[]>([]);
    const [activeTab, setActiveTab] = useState<TabId>("overview");
    const [tierFilter, setTierFilter] = useState<"all" | "free" | "pro" | "agency">(
        "all",
    );

    // ---- auth / admin gate ----
    useEffect(() => {
        const off = onAuthStateChanged(auth, async (u) => {
            if (!u) {
                setGate("denied");
                return;
            }
            try {
                const tokenResult = await u.getIdTokenResult(true);
                const claims = tokenResult.claims as any;
                if (claims.admin) {
                    setGate("allowed");
                } else {
                    setGate("denied");
                }
            } catch {
                setGate("denied");
            }
        });
        return () => off();
    }, []);

    // redirect if not allowed
    useEffect(() => {
        if (gate === "denied") {
            router.replace("/dashboard");
        }
    }, [gate, router]);

    // ---- load analytics from kloner_users + subcollections ----
    useEffect(() => {
        if (gate !== "allowed") return;

        let cancelled = false;

        const load = async () => {
            setLoadingData(true);
            try {
                // 1) base rows from kloner_users root docs
                const userSnap = await getDocs(collection(db, "kloner_users"));
                const map = new Map<string, UserAnalyticsRow>();

                userSnap.forEach((docSnap) => {
                    const data = docSnap.data() as any;
                    const createdAt = tsToDate(data.createdAt);
                    const tier = (data.tier ?? data.userTier ?? "free") as string | null;

                    const credits = (data.credits ?? {}) as any;
                    const creditsAiEditsRemaining =
                        credits.aiEdits?.remaining ?? null;
                    const creditsPreviewRemaining =
                        credits.preview?.remaining ?? null;
                    const creditsSnapshotRemaining =
                        credits.snapshot?.remaining ?? null;

                    const row: UserAnalyticsRow = {
                        id: docSnap.id,
                        email: (data.email ?? data.stripeCustomerEmail ?? null) as
                            | string
                            | null,
                        tier,
                        createdAt,
                        creditsAiEditsRemaining,
                        creditsPreviewRemaining,
                        creditsSnapshotRemaining,
                        editorSessionTotalMinutes: null,
                        editorSessionCount: null,
                        editorSaveTotal: null,
                        lastSessionEndedAt: null,
                        vercelConnected: false,
                        deploymentCount: 0,
                    };

                    map.set(docSnap.id, row);
                });

                // 2) per-user nested docs: meta/editor, integrations/vercel, deployments/*
                const perUserTasks: Promise<void>[] = [];

                for (const [uid] of map.entries()) {
                    perUserTasks.push(
                        (async () => {
                            // meta/editor
                            try {
                                const metaRef = doc(
                                    db,
                                    "kloner_users",
                                    uid,
                                    "meta",
                                    "editor",
                                );
                                const metaSnap = await getDoc(metaRef);
                                if (metaSnap.exists()) {
                                    const data = metaSnap.data() as any;
                                    const editorSessionTotalMinutes =
                                        data.editorSessionTotalMinutes ??
                                        data.durationMinutes ??
                                        null;
                                    const editorSessionCount =
                                        data.editorSessionCount ??
                                        data.sessionCount ??
                                        null;
                                    const editorSaveTotal =
                                        data.editorSaveTotal ?? data.saveCount ?? null;
                                    const lastSessionEndedAt = tsToDate(
                                        data.lastSessionEndedAt ?? data.endedAt,
                                    );
                                    const metaCreatedAt = tsToDate(data.createdAt);

                                    const existing = map.get(uid);
                                    if (existing) {
                                        map.set(uid, {
                                            ...existing,
                                            createdAt:
                                                existing.createdAt ?? metaCreatedAt ?? null,
                                            editorSessionTotalMinutes,
                                            editorSessionCount,
                                            editorSaveTotal,
                                            lastSessionEndedAt,
                                        });
                                    }
                                }
                            } catch {
                                // ignore meta errors per user
                            }

                            // integrations/vercel
                            try {
                                const integRef = doc(
                                    db,
                                    "kloner_users",
                                    uid,
                                    "integrations",
                                    "vercel",
                                );
                                const integSnap = await getDoc(integRef);
                                if (integSnap.exists()) {
                                    const data = integSnap.data() as any;
                                    const connected = !!data.connected;
                                    const existing = map.get(uid);
                                    if (existing) {
                                        map.set(uid, {
                                            ...existing,
                                            vercelConnected: connected,
                                        });
                                    }
                                }
                            } catch {
                                // ignore integration errors per user
                            }

                            // deployments collection
                            try {
                                const depCol = collection(
                                    db,
                                    "kloner_users",
                                    uid,
                                    "deployments",
                                );
                                const depSnap = await getDocs(depCol);
                                const count = depSnap.size;
                                if (count > 0) {
                                    const existing = map.get(uid);
                                    if (existing) {
                                        map.set(uid, {
                                            ...existing,
                                            deploymentCount: count,
                                        });
                                    }
                                }
                            } catch {
                                // ignore deployment errors per user
                            }
                        })(),
                    );
                }

                await Promise.all(perUserTasks);

                if (!cancelled) {
                    setRows(Array.from(map.values()));
                }
            } catch (err) {
                console.error("[AdminAnalytics] failed to load analytics", err);
            } finally {
                if (!cancelled) {
                    setLoadingData(false);
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [gate]);

    // filter by tier
    const filteredRows = useMemo(() => {
        if (tierFilter === "all") return rows;
        return rows.filter(
            (r) => (r.tier ?? "free").toLowerCase() === tierFilter.toLowerCase(),
        );
    }, [rows, tierFilter]);

    // new users per day, based on createdAt (kloner_users or meta/editor fallback)
    const dailyBuckets: DailyBucket[] = useMemo(() => {
        const byDate = new Map<string, number>();

        for (const r of filteredRows) {
            const created = r.createdAt;
            if (!created) continue;
            const yyyy = created.getFullYear();
            const mm = String(created.getMonth() + 1).padStart(2, "0");
            const dd = String(created.getDate()).padStart(2, "0");
            const key = `${yyyy}-${mm}-${dd}`;
            byDate.set(key, (byDate.get(key) || 0) + 1);
        }

        return Array.from(byDate.entries())
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([date, count]) => ({ date, count }));
    }, [filteredRows]);

    const maxDailyCount = useMemo(
        () =>
            dailyBuckets.reduce((m, b) => (b.count > m ? b.count : m), 0) || 1,
        [dailyBuckets],
    );

    // high-level metrics
    const overview = useMemo(() => {
        const totalUsers = filteredRows.length;

        let vercelConnectedCount = 0;
        let usersWithDeployments = 0;
        let totalDeployments = 0;

        let totalMinutes = 0;
        let activeThisWeek = 0;

        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        for (const r of filteredRows) {
            if (r.vercelConnected) vercelConnectedCount++;
            if ((r.deploymentCount ?? 0) > 0) {
                usersWithDeployments++;
                totalDeployments += r.deploymentCount ?? 0;
            }

            const minutes = r.editorSessionTotalMinutes ?? 0;
            totalMinutes += minutes;

            if (r.lastSessionEndedAt && r.lastSessionEndedAt >= weekAgo) {
                activeThisWeek++;
            }
        }

        const avgMinutesPerUser =
            totalUsers > 0 ? Math.round((totalMinutes / totalUsers) * 10) / 10 : 0;

        const lastSignupDate =
            dailyBuckets.length > 0
                ? dailyBuckets[dailyBuckets.length - 1]!.date
                : null;

        return {
            totalUsers,
            vercelConnectedCount,
            usersWithDeployments,
            totalDeployments,
            totalEditorMinutes: Math.round(totalMinutes * 10) / 10,
            avgMinutesPerUser,
            activeThisWeek,
            lastSignupDate,
        };
    }, [filteredRows, dailyBuckets]);

    // power users
    const topByMinutes = useMemo(
        () =>
            [...filteredRows]
                .filter((r) => (r.editorSessionTotalMinutes ?? 0) > 0)
                .sort(
                    (a, b) =>
                        (b.editorSessionTotalMinutes ?? 0) -
                        (a.editorSessionTotalMinutes ?? 0),
                )
                .slice(0, 10),
        [filteredRows],
    );

    const topByDeployments = useMemo(
        () =>
            [...filteredRows]
                .filter((r) => (r.deploymentCount ?? 0) > 0)
                .sort((a, b) => (b.deploymentCount ?? 0) - (a.deploymentCount ?? 0))
                .slice(0, 10),
        [filteredRows],
    );

    // credits summary
    const creditsSummary = useMemo(() => {
        let aiRemaining = 0;
        let previewRemaining = 0;
        let snapshotRemaining = 0;

        let aiLow = 0;
        let previewLow = 0;
        let snapshotLow = 0;

        for (const r of filteredRows) {
            const ai = r.creditsAiEditsRemaining ?? 0;
            const pv = r.creditsPreviewRemaining ?? 0;
            const sn = r.creditsSnapshotRemaining ?? 0;

            aiRemaining += ai;
            previewRemaining += pv;
            snapshotRemaining += sn;

            if (ai > 0 && ai <= 5) aiLow++;
            if (pv > 0 && pv <= 5) previewLow++;
            if (sn > 0 && sn <= 5) snapshotLow++;
        }

        return {
            aiRemaining,
            previewRemaining,
            snapshotRemaining,
            aiLow,
            previewLow,
            snapshotLow,
        };
    }, [filteredRows]);

    if (gate === "loading") {
        return (
            <div className="p-6 text-sm text-neutral-600">
                Checking admin access…
            </div>
        );
    }

    if (gate === "denied") {
        // redirect handled in effect; render nothing here
        return null;
    }

    return (
        <div className="p-6 space-y-6">
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-lg font-semibold text-neutral-900">
                        Admin · Analytics
                    </h1>
                    <p className="text-xs text-neutral-500">
                        Aggregated usage from kloner_users (not shared auth users).
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <select
                        value={tierFilter}
                        onChange={(e) =>
                            setTierFilter(
                                e.target.value as "all" | "free" | "pro" | "agency",
                            )
                        }
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-800 shadow-sm"
                    >
                        <option value="all">All tiers</option>
                        <option value="free">Free</option>
                        <option value="pro">Pro</option>
                        <option value="agency">Agency</option>
                    </select>

                    {loadingData && (
                        <span className="text-[11px] text-neutral-500">
                            Loading latest metrics…
                        </span>
                    )}
                </div>
            </header>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-neutral-200 text-xs">
                {[
                    { id: "overview", label: "Overview" },
                    { id: "usage", label: "Usage" },
                    { id: "power", label: "Power users" },
                    { id: "credits", label: "Credits" },
                ].map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setActiveTab(t.id as TabId)}
                        className={`rounded-t-lg px-3 py-1.5 ${activeTab === t.id
                                ? "border border-b-transparent border-neutral-200 bg-white text-neutral-900"
                                : "border border-transparent text-neutral-500 hover:text-neutral-800"
                            }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Overview tab */}
            {activeTab === "overview" && (
                <div className="space-y-6">
                    <section className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-xl border border-neutral-200 bg-white p-4">
                            <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                Total kloner users
                            </p>
                            <p className="text-2xl font-semibold text-neutral-900">
                                {overview.totalUsers}
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-500">
                                Last signup:{" "}
                                {overview.lastSignupDate ?? "No signups in this filter"}
                            </p>
                        </div>

                        <div className="rounded-xl border border-neutral-200 bg-white p-4">
                            <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                Vercel connected
                            </p>
                            <p className="text-2xl font-semibold text-neutral-900">
                                {overview.vercelConnectedCount}
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-500">
                                Users with a Vercel integration doc
                            </p>
                        </div>

                        <div className="rounded-xl border border-neutral-200 bg-white p-4">
                            <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                Active this week
                            </p>
                            <p className="text-2xl font-semibold text-neutral-900">
                                {overview.activeThisWeek}
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-500">
                                Based on last editor session end time
                            </p>
                        </div>
                    </section>

                    <section className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-xl border border-neutral-200 bg-white p-4">
                            <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                Users with deployments
                            </p>
                            <p className="text-2xl font-semibold text-neutral-900">
                                {overview.usersWithDeployments}
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-500">
                                Total deployments: {overview.totalDeployments}
                            </p>
                        </div>

                        <div className="rounded-xl border border-neutral-200 bg-white p-4">
                            <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                Total editor minutes
                            </p>
                            <p className="text-2xl font-semibold text-neutral-900">
                                {overview.totalEditorMinutes}
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-500">
                                Across all editor meta docs
                            </p>
                        </div>

                        <div className="rounded-xl border border-neutral-200 bg-white p-4">
                            <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                Avg minutes per user
                            </p>
                            <p className="text-2xl font-semibold text-neutral-900">
                                {overview.avgMinutesPerUser}
                            </p>
                        </div>
                    </section>

                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                            New kloner users per day
                        </p>
                        {dailyBuckets.length === 0 ? (
                            <p className="text-xs text-neutral-500">
                                No signups recorded for this filter.
                            </p>
                        ) : (
                            <div className="flex items-end gap-2 overflow-x-auto pb-2">
                                {dailyBuckets.map((b) => {
                                    const height = (b.count / maxDailyCount) * 140;
                                    return (
                                        <div
                                            key={b.date}
                                            className="flex flex-col items-center gap-1"
                                        >
                                            <div
                                                className="w-6 rounded-t-md bg-accent"
                                                style={{ height }}
                                                title={`${b.date}: ${b.count}`}
                                            />
                                            <span className="text-[9px] text-neutral-500">
                                                {b.date.slice(5)}
                                            </span>
                                            <span className="text-[9px] text-neutral-700">
                                                {b.count}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                </div>
            )}

            {/* Usage tab */}
            {activeTab === "usage" && (
                <div className="space-y-6">
                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                            Editor usage snapshot
                        </p>
                        <div className="grid gap-4 md:grid-cols-3 text-sm">
                            <div>
                                <p className="text-[11px] text-neutral-500 mb-1">
                                    Total editor minutes
                                </p>
                                <p className="text-xl font-semibold">
                                    {overview.totalEditorMinutes}
                                </p>
                            </div>
                            <div>
                                <p className="text-[11px] text-neutral-500 mb-1">
                                    Avg minutes per user
                                </p>
                                <p className="text-xl font-semibold">
                                    {overview.avgMinutesPerUser}
                                </p>
                            </div>
                            <div>
                                <p className="text-[11px] text-neutral-500 mb-1">
                                    Users with any editor activity
                                </p>
                                <p className="text-xl font-semibold">
                                    {
                                        filteredRows.filter(
                                            (r) =>
                                                (r.editorSessionTotalMinutes ?? 0) > 0,
                                        ).length
                                    }
                                </p>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                            Recent activity (last 20 users by last session)
                        </p>
                        <div className="space-y-1 text-xs">
                            {[...filteredRows]
                                .filter((r) => r.lastSessionEndedAt)
                                .sort(
                                    (a, b) =>
                                        (b.lastSessionEndedAt?.getTime() ?? 0) -
                                        (a.lastSessionEndedAt?.getTime() ?? 0),
                                )
                                .slice(0, 20)
                                .map((r) => (
                                    <div
                                        key={r.id}
                                        className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                    >
                                        <div className="flex flex-col">
                                            <span className="font-medium text-neutral-900">
                                                {r.email ?? r.id}
                                            </span>
                                            <span className="text-[10px] text-neutral-500">
                                                Tier: {r.tier ?? "free"}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[11px] text-neutral-700">
                                                {r.lastSessionEndedAt?.toLocaleString(
                                                    undefined,
                                                    {
                                                        dateStyle: "medium",
                                                        timeStyle: "short",
                                                    },
                                                )}
                                            </div>
                                            <div className="text-[10px] text-neutral-500">
                                                Minutes:{" "}
                                                {r.editorSessionTotalMinutes ?? 0} · Sessions:{" "}
                                                {r.editorSessionCount ?? 0}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </section>
                </div>
            )}

            {/* Power users tab */}
            {activeTab === "power" && (
                <div className="space-y-6">
                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                            Top editor usage (minutes)
                        </p>
                        <div className="space-y-1 text-xs">
                            {topByMinutes.length === 0 && (
                                <p className="text-neutral-500">No editor activity yet.</p>
                            )}
                            {topByMinutes.map((r, idx) => (
                                <div
                                    key={r.id}
                                    className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-5 text-[10px] text-neutral-500">
                                            #{idx + 1}
                                        </span>
                                        <div className="flex flex-col">
                                            <span className="font-medium text-neutral-900">
                                                {r.email ?? r.id}
                                            </span>
                                            <span className="text-[10px] text-neutral-500">
                                                Tier: {r.tier ?? "free"}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right text-[11px] text-neutral-700">
                                        {r.editorSessionTotalMinutes ?? 0} min · saves{" "}
                                        {r.editorSaveTotal ?? 0}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                            Top by deployments
                        </p>
                        <div className="space-y-1 text-xs">
                            {topByDeployments.length === 0 && (
                                <p className="text-neutral-500">No deployments yet.</p>
                            )}
                            {topByDeployments.map((r, idx) => (
                                <div
                                    key={r.id}
                                    className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="w-5 text-[10px] text-neutral-500">
                                            #{idx + 1}
                                        </span>
                                        <div className="flex flex-col">
                                            <span className="font-medium text-neutral-900">
                                                {r.email ?? r.id}
                                            </span>
                                            <span className="text-[10px] text-neutral-500">
                                                Tier: {r.tier ?? "free"}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right text-[11px] text-neutral-700">
                                        {r.deploymentCount ?? 0} deployments ·{" "}
                                        {r.vercelConnected ? "Vercel linked" : "No Vercel"}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            )}

            {/* Credits tab */}
            {activeTab === "credits" && (
                <div className="space-y-6">
                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                            Credit pools (remaining)
                        </p>
                        <div className="grid gap-4 md:grid-cols-3 text-sm">
                            <div>
                                <p className="text-[11px] text-neutral-500 mb-1">AI edits</p>
                                <p className="text-xl font-semibold">
                                    {creditsSummary.aiRemaining}
                                </p>
                                <p className="mt-1 text-[11px] text-neutral-500">
                                    Users &le; 5 remaining: {creditsSummary.aiLow}
                                </p>
                            </div>
                            <div>
                                <p className="text-[11px] text-neutral-500 mb-1">Previews</p>
                                <p className="text-xl font-semibold">
                                    {creditsSummary.previewRemaining}
                                </p>
                                <p className="mt-1 text-[11px] text-neutral-500">
                                    Users &le; 5 remaining: {creditsSummary.previewLow}
                                </p>
                            </div>
                            <div>
                                <p className="text-[11px] text-neutral-500 mb-1">
                                    Snapshots
                                </p>
                                <p className="text-xl font-semibold">
                                    {creditsSummary.snapshotRemaining}
                                </p>
                                <p className="mt-1 text-[11px] text-neutral-500">
                                    Users &le; 5 remaining: {creditsSummary.snapshotLow}
                                </p>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                            Users closest to running out
                        </p>
                        <div className="space-y-1 text-xs">
                            {[...filteredRows]
                                .sort((a, b) => {
                                    const aMin = Math.min(
                                        a.creditsAiEditsRemaining ?? Infinity,
                                        a.creditsPreviewRemaining ?? Infinity,
                                        a.creditsSnapshotRemaining ?? Infinity,
                                    );
                                    const bMin = Math.min(
                                        b.creditsAiEditsRemaining ?? Infinity,
                                        b.creditsPreviewRemaining ?? Infinity,
                                        b.creditsSnapshotRemaining ?? Infinity,
                                    );
                                    return aMin - bMin;
                                })
                                .slice(0, 15)
                                .map((r) => (
                                    <div
                                        key={r.id}
                                        className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                    >
                                        <div className="flex flex-col">
                                            <span className="font-medium text-neutral-900">
                                                {r.email ?? r.id}
                                            </span>
                                            <span className="text-[10px] text-neutral-500">
                                                Tier: {r.tier ?? "free"}
                                            </span>
                                        </div>
                                        <div className="text-right text-[10px] text-neutral-700">
                                            AI: {r.creditsAiEditsRemaining ?? 0} · Prev:{" "}
                                            {r.creditsPreviewRemaining ?? 0} · Snap:{" "}
                                            {r.creditsSnapshotRemaining ?? 0}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
