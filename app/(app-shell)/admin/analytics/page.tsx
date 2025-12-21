// app/(app-shell)/admin/analytics/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs, Timestamp } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

type GateState = "loading" | "allowed" | "denied";

const ACCENT = "#f55f2a";

type UserAnalyticsRow = {
    id: string;
    email?: string | null;
    tier?: string | null;
    createdAt?: Date | null;

    creditsAiEditsRemaining?: number | null;
    creditsPreviewRemaining?: number | null;
    creditsSnapshotRemaining?: number | null;

    editorSessionTotalMinutes?: number | null;
    editorSessionCount?: number | null;
    editorSaveTotal?: number | null;
    lastSessionEndedAt?: Date | null;

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
    if (typeof v === "object" && typeof v.toDate === "function") return v.toDate();
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

function toYYYYMMDD(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function buildLastNDaysKeys(n: number): string[] {
    const now = new Date();
    const base = startOfDay(now);
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(base.getTime() - i * 24 * 60 * 60 * 1000);
        out.push(toYYYYMMDD(d));
    }
    return out;
}

function buildSeriesFromBuckets(keys: string[], buckets: DailyBucket[]) {
    const m = new Map<string, number>();
    for (const b of buckets) m.set(b.date, b.count);
    return keys.map((k) => ({ x: k, y: m.get(k) ?? 0 }));
}

function buildActiveUsersByDay(keys: string[], rows: UserAnalyticsRow[]) {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, 0);

    for (const r of rows) {
        const t = r.lastSessionEndedAt;
        if (!t) continue;
        const key = toYYYYMMDD(t);
        if (!m.has(key)) continue;
        m.set(key, (m.get(key) ?? 0) + 1);
    }

    return keys.map((k) => ({ x: k, y: m.get(k) ?? 0 }));
}

function buildReturningActiveUsersByDay(keys: string[], rows: UserAnalyticsRow[]) {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, 0);

    for (const r of rows) {
        const t = r.lastSessionEndedAt;
        if (!t) continue;

        const sessions = r.editorSessionCount ?? 0;
        if (sessions < 2) continue;

        const key = toYYYYMMDD(t);
        if (!m.has(key)) continue;
        m.set(key, (m.get(key) ?? 0) + 1);
    }

    return keys.map((k) => ({ x: k, y: m.get(k) ?? 0 }));
}

function buildTotalMinutesByTier(rows: UserAnalyticsRow[]) {
    const out = { free: 0, pro: 0, agency: 0 };
    for (const r of rows) {
        const tier = (r.tier ?? "free").toLowerCase();
        const mins = r.editorSessionTotalMinutes ?? 0;
        if (tier === "pro") out.pro += mins;
        else if (tier === "agency") out.agency += mins;
        else out.free += mins;
    }
    return {
        free: Math.round(out.free * 10) / 10,
        pro: Math.round(out.pro * 10) / 10,
        agency: Math.round(out.agency * 10) / 10,
    };
}

function LineChartCard(props: {
    title: string;
    subtitle?: string;
    points: Array<{ x: string; y: number }>;
    height?: number;
}) {
    const { title, subtitle, points, height = 180 } = props;

    const w = 640;
    const h = 200;

    const padL = 44;
    const padR = 14;
    const padT = 18;
    const padB = 34;

    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    const ys = points.map((p) => p.y);
    const maxYRaw = ys.length ? Math.max(...ys) : 0;
    const maxY = Math.max(1, maxYRaw);
    const minY = 0;

    const xCount = Math.max(1, points.length - 1);

    const toX = (i: number) => padL + (i / xCount) * innerW;
    const toY = (v: number) => padT + (1 - (v - minY) / (maxY - minY || 1)) * innerH;

    const path = points
        .map((p, i) => {
            const x = toX(i);
            const y = toY(p.y);
            return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");

    const last = points.length ? points[points.length - 1] : null;
    const lastVal = last ? last.y : 0;

    const tickCount = 4;
    const yTicks = Array.from({ length: tickCount + 1 }).map((_, i) => Math.round((maxY * i) / tickCount));

    const labelEvery = points.length <= 10 ? 1 : points.length <= 20 ? 2 : points.length <= 45 ? 5 : 7;

    return (
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">{title}</p>
                    {subtitle ? <p className="mt-1 text-xs text-neutral-500">{subtitle}</p> : null}
                </div>
                <div className="text-right">
                    <p className="text-[11px] text-neutral-500">Latest</p>
                    <p className="text-lg font-semibold text-neutral-900">{lastVal}</p>
                </div>
            </div>

            <div className="mt-3 overflow-x-auto">
                <div style={{ minWidth: 640 }}>
                    <svg width="100%" height={height} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title}>
                        <rect x="0" y="0" width={w} height={h} fill="transparent" />

                        {yTicks.map((v, i) => {
                            const y = toY(v);
                            return (
                                <g key={`yt-${i}`}>
                                    <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#e5e7eb" strokeWidth="1" />
                                    <text x={padL - 10} y={y + 4} fontSize="10" textAnchor="end" fill="#6b7280">
                                        {v}
                                    </text>
                                </g>
                            );
                        })}

                        {points.map((p, i) => {
                            if (i % labelEvery !== 0 && i !== points.length - 1) return null;
                            const x = toX(i);
                            const label = p.x.slice(5); // MM-DD
                            return (
                                <text key={`xl-${i}`} x={x} y={h - 12} fontSize="10" textAnchor="middle" fill="#6b7280">
                                    {label}
                                </text>
                            );
                        })}

                        <path d={path} fill="none" stroke="currentColor" strokeWidth="2.2" className="text-neutral-900" />

                        {points.map((p, i) => {
                            const x = toX(i);
                            const y = toY(p.y);
                            const r = i === points.length - 1 ? 3.4 : 2.2;
                            return (
                                <circle key={`pt-${i}`} cx={x} cy={y} r={r} fill="currentColor" className="text-neutral-900" />
                            );
                        })}

                        <line x1={padL} y1={padT} x2={padL} y2={h - padB} stroke="#d1d5db" strokeWidth="1" />
                        <line x1={padL} y1={h - padB} x2={w - padR} y2={h - padB} stroke="#d1d5db" strokeWidth="1" />
                    </svg>
                </div>
            </div>
        </section>
    );
}

export default function AdminAnalyticsPage() {
    const router = useRouter();

    const [gate, setGate] = useState<GateState>("loading");
    const [loadingData, setLoadingData] = useState(true);
    const [rows, setRows] = useState<UserAnalyticsRow[]>([]);
    const [activeTab, setActiveTab] = useState<TabId>("overview");
    const [tierFilter, setTierFilter] = useState<"all" | "free" | "pro" | "agency">("all");

    const [usageRangeDays, setUsageRangeDays] = useState<7 | 14 | 30 | 90>(30);

    // returning users list controls
    const [returningOnly, setReturningOnly] = useState(true);

    // ---- hard exclusions ----
    const EXCLUDE_UIDS = useMemo(() => new Set(["FJPVD2BuHrXBLhOFOBWi9oW7Apt1"]), []);
    const EXCLUDE_EMAILS = useMemo(() => new Set(["nolan796@live.ca"]), []);

    const isExcluded = (uid: string, email?: string | null) => {
        if (EXCLUDE_UIDS.has(uid)) return true;
        const e = (email ?? "").trim().toLowerCase();
        if (e && EXCLUDE_EMAILS.has(e)) return true;
        return false;
    };

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
                if (claims.admin) setGate("allowed");
                else setGate("denied");
            } catch {
                setGate("denied");
            }
        });
        return () => off();
    }, []);

    useEffect(() => {
        if (gate === "denied") router.replace("/dashboard");
    }, [gate, router]);

    // ---- load analytics ----
    useEffect(() => {
        if (gate !== "allowed") return;

        let cancelled = false;

        const load = async () => {
            setLoadingData(true);
            try {
                const userSnap = await getDocs(collection(db, "kloner_users"));
                const map = new Map<string, UserAnalyticsRow>();

                userSnap.forEach((docSnap) => {
                    const data = docSnap.data() as any;
                    const email = (data.email ?? data.stripeCustomerEmail ?? null) as string | null;

                    if (isExcluded(docSnap.id, email)) return;

                    const createdAt = tsToDate(data.createdAt);
                    const tier = (data.tier ?? data.userTier ?? "free") as string | null;

                    const credits = (data.credits ?? {}) as any;
                    const creditsAiEditsRemaining = credits.aiEdits?.remaining ?? null;
                    const creditsPreviewRemaining = credits.preview?.remaining ?? null;
                    const creditsSnapshotRemaining = credits.snapshot?.remaining ?? null;

                    map.set(docSnap.id, {
                        id: docSnap.id,
                        email,
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
                    });
                });

                const perUserTasks: Promise<void>[] = [];

                for (const [uid] of map.entries()) {
                    perUserTasks.push(
                        (async () => {
                            try {
                                const metaRef = doc(db, "kloner_users", uid, "meta", "editor");
                                const metaSnap = await getDoc(metaRef);
                                if (metaSnap.exists()) {
                                    const data = metaSnap.data() as any;

                                    const editorSessionTotalMinutes =
                                        data.editorSessionTotalMinutes ?? data.durationMinutes ?? null;
                                    const editorSessionCount = data.editorSessionCount ?? data.sessionCount ?? null;
                                    const editorSaveTotal = data.editorSaveTotal ?? data.saveCount ?? null;
                                    const lastSessionEndedAt = tsToDate(data.lastSessionEndedAt ?? data.endedAt);
                                    const metaCreatedAt = tsToDate(data.createdAt);

                                    const existing = map.get(uid);
                                    if (existing) {
                                        map.set(uid, {
                                            ...existing,
                                            createdAt: existing.createdAt ?? metaCreatedAt ?? null,
                                            editorSessionTotalMinutes,
                                            editorSessionCount,
                                            editorSaveTotal,
                                            lastSessionEndedAt,
                                        });
                                    }
                                }
                            } catch { }

                            try {
                                const integRef = doc(db, "kloner_users", uid, "integrations", "vercel");
                                const integSnap = await getDoc(integRef);
                                if (integSnap.exists()) {
                                    const data = integSnap.data() as any;
                                    const connected = !!data.connected;
                                    const existing = map.get(uid);
                                    if (existing) map.set(uid, { ...existing, vercelConnected: connected });
                                }
                            } catch { }

                            try {
                                const depCol = collection(db, "kloner_users", uid, "deployments");
                                const depSnap = await getDocs(depCol);
                                const count = depSnap.size;
                                if (count > 0) {
                                    const existing = map.get(uid);
                                    if (existing) map.set(uid, { ...existing, deploymentCount: count });
                                }
                            } catch { }
                        })(),
                    );
                }

                await Promise.all(perUserTasks);

                if (!cancelled) setRows(Array.from(map.values()));
            } catch (err) {
                console.error("[AdminAnalytics] failed to load analytics", err);
            } finally {
                if (!cancelled) setLoadingData(false);
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [gate, EXCLUDE_UIDS, EXCLUDE_EMAILS]);

    const filteredRows = useMemo(() => {
        const base = rows;
        if (tierFilter === "all") return base;
        return base.filter((r) => (r.tier ?? "free").toLowerCase() === tierFilter.toLowerCase());
    }, [rows, tierFilter]);

    const dailyBuckets: DailyBucket[] = useMemo(() => {
        const byDate = new Map<string, number>();
        for (const r of filteredRows) {
            const created = r.createdAt;
            if (!created) continue;
            const key = toYYYYMMDD(created);
            byDate.set(key, (byDate.get(key) || 0) + 1);
        }
        return Array.from(byDate.entries())
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([date, count]) => ({ date, count }));
    }, [filteredRows]);

    const maxDailyCount = useMemo(
        () => dailyBuckets.reduce((m, b) => (b.count > m ? b.count : m), 0) || 1,
        [dailyBuckets],
    );

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

            if (r.lastSessionEndedAt && r.lastSessionEndedAt >= weekAgo) activeThisWeek++;
        }

        const avgMinutesPerUser = totalUsers > 0 ? Math.round((totalMinutes / totalUsers) * 10) / 10 : 0;

        const lastSignupDate = dailyBuckets.length > 0 ? dailyBuckets[dailyBuckets.length - 1]!.date : null;

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

    const topByMinutes = useMemo(
        () =>
            [...filteredRows]
                .filter((r) => (r.editorSessionTotalMinutes ?? 0) > 0)
                .sort((a, b) => (b.editorSessionTotalMinutes ?? 0) - (a.editorSessionTotalMinutes ?? 0))
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

        return { aiRemaining, previewRemaining, snapshotRemaining, aiLow, previewLow, snapshotLow };
    }, [filteredRows]);

    const usageKeys = useMemo(() => buildLastNDaysKeys(usageRangeDays), [usageRangeDays]);

    const signupsSeries = useMemo(() => buildSeriesFromBuckets(usageKeys, dailyBuckets), [usageKeys, dailyBuckets]);

    const activeUsersSeries = useMemo(() => buildActiveUsersByDay(usageKeys, filteredRows), [usageKeys, filteredRows]);

    const returningActiveUsersSeries = useMemo(
        () => buildReturningActiveUsersByDay(usageKeys, filteredRows),
        [usageKeys, filteredRows],
    );

    // returning users identity list (definition: editorSessionCount >= 2)
    const returningUsers = useMemo(() => {
        return [...filteredRows]
            .filter((r) => (r.editorSessionCount ?? 0) >= 2)
            .sort((a, b) => (b.lastSessionEndedAt?.getTime() ?? 0) - (a.lastSessionEndedAt?.getTime() ?? 0));
    }, [filteredRows]);

    // optional: show only returning vs show all active (still ordered by last session)
    const userListForUsage = useMemo(() => {
        const base = returningOnly
            ? returningUsers
            : [...filteredRows].sort(
                (a, b) => (b.lastSessionEndedAt?.getTime() ?? 0) - (a.lastSessionEndedAt?.getTime() ?? 0),
            );

        return base.slice(0, 50);
    }, [returningOnly, returningUsers, filteredRows]);

    const usageTotals = useMemo(() => {
        const usersWithAnyEditor = filteredRows.filter((r) => (r.editorSessionTotalMinutes ?? 0) > 0).length;

        const returningUsersAllTime = filteredRows.filter((r) => (r.editorSessionCount ?? 0) >= 2).length;

        const keySet = new Set(usageKeys);
        let activeInWindow = 0;
        let returningActiveInWindow = 0;

        for (const r of filteredRows) {
            if (!r.lastSessionEndedAt) continue;
            const k = toYYYYMMDD(r.lastSessionEndedAt);
            if (!keySet.has(k)) continue;

            activeInWindow++;
            if ((r.editorSessionCount ?? 0) >= 2) returningActiveInWindow++;
        }

        const byTierMinutes = buildTotalMinutesByTier(filteredRows);

        return {
            usersWithAnyEditor,
            returningUsersAllTime,
            activeInWindow,
            returningActiveInWindow,
            byTierMinutes,
        };
    }, [filteredRows, usageKeys]);

    if (gate === "loading") {
        return <div className="p-6 text-sm text-neutral-600">Checking admin access…</div>;
    }

    if (gate === "denied") {
        return null;
    }

    return (
        <div className="p-6 space-y-6">
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-lg font-semibold text-neutral-900">Admin · Analytics</h1>
                    <p className="text-xs text-neutral-500">Aggregated usage from kloner_users (not shared auth users).</p>
                </div>

                <div className="flex items-center gap-3">
                    <select
                        value={tierFilter}
                        onChange={(e) => setTierFilter(e.target.value as "all" | "free" | "pro" | "agency")}
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-800 shadow-sm"
                    >
                        <option value="all">All tiers</option>
                        <option value="free">Free</option>
                        <option value="pro">Pro</option>
                        <option value="agency">Agency</option>
                    </select>

                    {loadingData && <span className="text-[11px] text-neutral-500">Loading latest metrics…</span>}
                </div>
            </header>



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
            {!loadingData ? (
                <>
                    {activeTab === "overview" && (
                        <div className="space-y-6">
                            <section className="grid gap-4 md:grid-cols-3">
                                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                                    <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Total kloner users</p>
                                    <p className="text-2xl font-semibold text-neutral-900">{overview.totalUsers}</p>
                                    <p className="mt-1 text-[11px] text-neutral-500">
                                        Last signup: {overview.lastSignupDate ?? "No signups in this filter"}
                                    </p>
                                </div>

                                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                                    <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Vercel connected</p>
                                    <p className="text-2xl font-semibold text-neutral-900">{overview.vercelConnectedCount}</p>
                                    <p className="mt-1 text-[11px] text-neutral-500">Users with a Vercel integration doc</p>
                                </div>

                                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                                    <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Active this week</p>
                                    <p className="text-2xl font-semibold text-neutral-900">{overview.activeThisWeek}</p>
                                    <p className="mt-1 text-[11px] text-neutral-500">Based on last editor session end time</p>
                                </div>
                            </section>

                            <section className="grid gap-4 md:grid-cols-3">
                                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                                    <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Users with deployments</p>
                                    <p className="text-2xl font-semibold text-neutral-900">{overview.usersWithDeployments}</p>
                                    <p className="mt-1 text-[11px] text-neutral-500">Total deployments: {overview.totalDeployments}</p>
                                </div>

                                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                                    <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Total editor minutes</p>
                                    <p className="text-2xl font-semibold text-neutral-900">{overview.totalEditorMinutes}</p>
                                    <p className="mt-1 text-[11px] text-neutral-500">Across all editor meta docs</p>
                                </div>

                                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                                    <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Avg minutes per user</p>
                                    <p className="text-2xl font-semibold text-neutral-900">{overview.avgMinutesPerUser}</p>
                                </div>
                            </section>

                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">New kloner users per day</p>
                                {dailyBuckets.length === 0 ? (
                                    <p className="text-xs text-neutral-500">No signups recorded for this filter.</p>
                                ) : (
                                    <div className="flex items-end gap-2 overflow-x-auto pb-2">
                                        {dailyBuckets.map((b) => {
                                            const height = (b.count / maxDailyCount) * 140;
                                            return (
                                                <div key={b.date} className="flex flex-col items-center gap-1">
                                                    <div
                                                        className="w-6 rounded-t-md bg-accent"
                                                        style={{ height }}
                                                        title={`${b.date}: ${b.count}`}
                                                    />
                                                    <span className="text-[9px] text-neutral-500">{b.date.slice(5)}</span>
                                                    <span className="text-[9px] text-neutral-700">{b.count}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        </div>
                    )}

                    {activeTab === "usage" && (
                        <div className="space-y-6">
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Usage performance</p>
                                        <p className="mt-1 text-xs text-neutral-500">
                                            Returning users are users with editorSessionCount ≥ 2.
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {([7, 14, 30, 90] as const).map((d) => (
                                            <button
                                                key={d}
                                                type="button"
                                                onClick={() => setUsageRangeDays(d)}
                                                className={`rounded-lg border px-3 py-1.5 text-xs ${usageRangeDays === d
                                                    ? "border-neutral-300 bg-neutral-900 text-white"
                                                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                                                    }`}
                                            >
                                                Last {d}d
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-4 grid gap-4 md:grid-cols-4 text-sm">
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Active users (window)</p>
                                        <p className="text-xl font-semibold text-neutral-900">{usageTotals.activeInWindow}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Last session ended inside window</p>
                                    </div>

                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Returning active (window)</p>
                                        <p className="text-xl font-semibold text-neutral-900">{usageTotals.returningActiveInWindow}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Active + 2+ sessions</p>
                                    </div>

                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Returning users (all time)</p>
                                        <p className="text-xl font-semibold text-neutral-900">{usageTotals.returningUsersAllTime}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">editorSessionCount ≥ 2</p>
                                    </div>

                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Avg minutes per user</p>
                                        <p className="text-xl font-semibold text-neutral-900">{overview.avgMinutesPerUser}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">All-time minutes / users</p>
                                    </div>
                                </div>
                            </section>

                            <div className="grid gap-4 xl:grid-cols-3">
                                <LineChartCard
                                    title="Active users per day"
                                    subtitle="Users whose last session ended on each day"
                                    points={activeUsersSeries}
                                />
                                <LineChartCard
                                    title="Returning active users per day"
                                    subtitle="Active users with 2+ sessions total"
                                    points={returningActiveUsersSeries}
                                />
                                <LineChartCard
                                    title="Signups per day"
                                    subtitle="New kloner_users created (createdAt) per day"
                                    points={signupsSeries}
                                />
                            </div>

                            {/* WHO the returning users are */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                            Returning users (identity)
                                        </p>
                                        <p className="mt-1 text-xs text-neutral-500">
                                            Sorted by most recent session end. Showing up to 50.
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setReturningOnly(true)}
                                            className={`rounded-lg border px-3 py-1.5 text-xs ${returningOnly
                                                ? "border-neutral-300 bg-neutral-900 text-white"
                                                : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                                                }`}
                                        >
                                            Returning only
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setReturningOnly(false)}
                                            className={`rounded-lg border px-3 py-1.5 text-xs ${!returningOnly
                                                ? "border-neutral-300 bg-neutral-900 text-white"
                                                : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                                                }`}
                                        >
                                            All active
                                        </button>
                                    </div>
                                </div>

                                {userListForUsage.length === 0 ? (
                                    <p className="mt-3 text-xs text-neutral-500">No users match this list.</p>
                                ) : (
                                    <div className="mt-3 space-y-1 text-xs">
                                        {userListForUsage.map((r) => (
                                            <div
                                                key={r.id}
                                                className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                            >
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-medium text-neutral-900 truncate">{r.email ?? r.id}</span>
                                                    <span className="text-[10px] text-neutral-500">
                                                        UID: {r.id} · Tier: {r.tier ?? "free"}
                                                    </span>
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <div className="text-[11px] text-neutral-700">
                                                        {r.lastSessionEndedAt
                                                            ? r.lastSessionEndedAt.toLocaleString(undefined, {
                                                                dateStyle: "medium",
                                                                timeStyle: "short",
                                                            })
                                                            : "No activity"}
                                                    </div>
                                                    <div className="text-[10px] text-neutral-500">
                                                        Sessions: {r.editorSessionCount ?? 0} · Minutes: {r.editorSessionTotalMinutes ?? 0}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </div>
                    )}

                    {activeTab === "power" && (
                        <div className="space-y-6">
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Top editor usage (minutes)</p>
                                <div className="space-y-1 text-xs">
                                    {topByMinutes.length === 0 && <p className="text-neutral-500">No editor activity yet.</p>}
                                    {topByMinutes.map((r, idx) => (
                                        <div
                                            key={r.id}
                                            className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="w-5 text-[10px] text-neutral-500">#{idx + 1}</span>
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-neutral-900">{r.email ?? r.id}</span>
                                                    <span className="text-[10px] text-neutral-500">Tier: {r.tier ?? "free"}</span>
                                                </div>
                                            </div>
                                            <div className="text-right text-[11px] text-neutral-700">
                                                {r.editorSessionTotalMinutes ?? 0} min · saves {r.editorSaveTotal ?? 0}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Top by deployments</p>
                                <div className="space-y-1 text-xs">
                                    {topByDeployments.length === 0 && <p className="text-neutral-500">No deployments yet.</p>}
                                    {topByDeployments.map((r, idx) => (
                                        <div
                                            key={r.id}
                                            className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="w-5 text-[10px] text-neutral-500">#{idx + 1}</span>
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-neutral-900">{r.email ?? r.id}</span>
                                                    <span className="text-[10px] text-neutral-500">Tier: {r.tier ?? "free"}</span>
                                                </div>
                                            </div>
                                            <div className="text-right text-[11px] text-neutral-700">
                                                {r.deploymentCount ?? 0} deployments · {r.vercelConnected ? "Vercel linked" : "No Vercel"}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === "credits" && (
                        <div className="space-y-6">
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Credit pools (remaining)</p>
                                <div className="grid gap-4 md:grid-cols-3 text-sm">
                                    <div>
                                        <p className="text-[11px] text-neutral-500 mb-1">AI edits</p>
                                        <p className="text-xl font-semibold">{creditsSummary.aiRemaining}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Users ≤ 5 remaining: {creditsSummary.aiLow}</p>
                                    </div>
                                    <div>
                                        <p className="text-[11px] text-neutral-500 mb-1">Previews</p>
                                        <p className="text-xl font-semibold">{creditsSummary.previewRemaining}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Users ≤ 5 remaining: {creditsSummary.previewLow}</p>
                                    </div>
                                    <div>
                                        <p className="text-[11px] text-neutral-500 mb-1">Snapshots</p>
                                        <p className="text-xl font-semibold">{creditsSummary.snapshotRemaining}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Users ≤ 5 remaining: {creditsSummary.snapshotLow}</p>
                                    </div>
                                </div>
                            </section>

                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Users closest to running out</p>
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
                                                    <span className="font-medium text-neutral-900">{r.email ?? r.id}</span>
                                                    <span className="text-[10px] text-neutral-500">Tier: {r.tier ?? "free"}</span>
                                                </div>
                                                <div className="text-right text-[10px] text-neutral-700">
                                                    AI: {r.creditsAiEditsRemaining ?? 0} · Prev: {r.creditsPreviewRemaining ?? 0} · Snap:{" "}
                                                    {r.creditsSnapshotRemaining ?? 0}
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </section>
                        </div>
                    )}
                </>
            ) : (
                <>
                    <motion.div
                        className="relative mt-20 mx-auto flex h-20 w-20 items-center justify-center"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.25 }}
                    >
                        <motion.span
                            className="absolute inset-1 rounded-full border-2 border-t-transparent"
                            style={{
                                borderColor: ACCENT,
                                borderTopColor: "transparent",
                            }}
                            initial={{ rotate: 0 }}
                            animate={{ rotate: 360 }}
                            transition={{
                                duration: 1.1,
                                repeat: Infinity,
                                repeatType: "loop",
                                ease: "linear",
                            }}
                        />
                    </motion.div>
                </>
            )}
        </div>
    );
}
