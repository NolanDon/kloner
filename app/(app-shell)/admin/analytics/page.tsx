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

type AiChatAuditEntry = {
    appId: string;
    at: Date | null;
    userPrompt: string;
    assistantReply: string;
};

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

    appCount?: number;
    activeAppCount?: number;
    archivedAppCount?: number;
    appWithSupabaseCount?: number;
    appWithVercelCount?: number;
    appWithStripeCount?: number;
    appAiChatUserMessageCount?: number;
    appAiChatRecentEntries?: AiChatAuditEntry[];
    appCreationDates?: Date[];

    appBuilderSessionTotalMinutes?: number | null;
    appBuilderSessionCount?: number | null;
    appBuilderAvgSessionMinutes?: number | null;
    appBuilderAiUserMessageTotal?: number | null;
};

type DailyBucket = {
    date: string; // YYYY-MM-DD
    count: number;
};

type TabId = "overview" | "usage" | "power" | "credits" | "churn";
type AnalyticsScope = "legacy" | "apps";

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

function appFilesHaveStripeKeys(files: any): boolean {
    if (!files || typeof files !== "object") return false;

    const stripeKeyHints = [
        "STRIPE_SECRET_KEY",
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
        "STRIPE_PUBLISHABLE_KEY",
        "STRIPE_WEBHOOK_SECRET",
    ];

    for (const [path, file] of Object.entries(files as Record<string, any>)) {
        const lowerPath = String(path || "").toLowerCase();
        if (
            !lowerPath.endsWith(".env") &&
            !lowerPath.endsWith(".env.local") &&
            !lowerPath.endsWith(".env.production") &&
            !lowerPath.endsWith(".env.development")
        ) {
            continue;
        }
        const content = typeof file?.content === "string" ? file.content : "";
        if (!content) continue;
        if (stripeKeyHints.some((k) => content.includes(k))) return true;
    }

    return false;
}

function countUserMessagesFromAiChatDoc(data: any): number {
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    return messages.reduce((sum: number, m: any) => {
        const role = typeof m?.role === "string" ? m.role.toLowerCase() : "";
        return role === "user" ? sum + 1 : sum;
    }, 0);
}

function getAiChatMessageDate(m: any): Date | null {
    if (typeof m?.timestampMs === "number" && Number.isFinite(m.timestampMs)) {
        const d = new Date(m.timestampMs);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return tsToDate(m?.timestamp);
}

function normalizeAiChatText(v: unknown, max = 420): string {
    if (typeof v !== "string") return "";
    const oneLine = v.replace(/\s+/g, " ").trim();
    if (!oneLine) return "";
    return oneLine.length > max ? `${oneLine.slice(0, max - 1)}...` : oneLine;
}

function extractRecentAiChatEntries(data: any, appId: string): AiChatAuditEntry[] {
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const out: AiChatAuditEntry[] = [];

    for (let i = 0; i < messages.length; i += 1) {
        const msg = messages[i];
        const role = typeof msg?.role === "string" ? msg.role.toLowerCase() : "";
        if (role !== "user") continue;

        const userPrompt = normalizeAiChatText(msg?.content);
        if (!userPrompt) continue;

        let assistantReply = "";
        let assistantAt: Date | null = null;
        for (let j = i + 1; j < messages.length; j += 1) {
            const next = messages[j];
            const nextRole = typeof next?.role === "string" ? next.role.toLowerCase() : "";
            if (nextRole !== "assistant") continue;
            assistantReply = normalizeAiChatText(next?.content);
            assistantAt = getAiChatMessageDate(next);
            break;
        }

        const at = assistantAt || getAiChatMessageDate(msg);
        out.push({
            appId,
            at,
            userPrompt,
            assistantReply,
        });
    }

    out.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    return out;
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
    const [analyticsScope, setAnalyticsScope] = useState<AnalyticsScope>("apps");
    const [tierFilter, setTierFilter] = useState<"all" | "free" | "pro" | "agency">("all");

    const [usageRangeDays, setUsageRangeDays] = useState<7 | 14 | 30 | 90>(30);

    // returning users list controls
    const [returningOnly, setReturningOnly] = useState(true);

    // ---- hard exclusions ----
    const EXCLUDE_UIDS = useMemo(() => new Set(["FJPVD2BuHrXBLhOFOBWi9oW7Apt1"]), []);
    const EXCLUDE_EMAILS = useMemo(() => new Set(["nolan796@live.ca"]), []);

    const isExcluded = useCallback((uid: string, email?: string | null) => {
        if (EXCLUDE_UIDS.has(uid)) return true;
        const e = (email ?? "").trim().toLowerCase();
        if (e && EXCLUDE_EMAILS.has(e)) return true;
        return false;
    }, [EXCLUDE_EMAILS, EXCLUDE_UIDS]);

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
                        appCount: 0,
                        activeAppCount: 0,
                        archivedAppCount: 0,
                        appWithSupabaseCount: 0,
                        appWithVercelCount: 0,
                        appWithStripeCount: 0,
                        appAiChatUserMessageCount: 0,
                        appCreationDates: [],
                        appBuilderSessionTotalMinutes: 0,
                        appBuilderSessionCount: 0,
                        appBuilderAvgSessionMinutes: 0,
                        appBuilderAiUserMessageTotal: 0,
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
                                const appBuilderMetaRef = doc(db, "kloner_users", uid, "meta", "app_builder");
                                const appBuilderMetaSnap = await getDoc(appBuilderMetaRef);
                                if (appBuilderMetaSnap.exists()) {
                                    const data = appBuilderMetaSnap.data() as any;
                                    const existing = map.get(uid);
                                    if (existing) {
                                        map.set(uid, {
                                            ...existing,
                                            appBuilderSessionTotalMinutes:
                                                typeof data.appBuilderSessionTotalMinutes === "number"
                                                    ? data.appBuilderSessionTotalMinutes
                                                    : 0,
                                            appBuilderSessionCount:
                                                typeof data.appBuilderSessionCount === "number"
                                                    ? data.appBuilderSessionCount
                                                    : 0,
                                            appBuilderAvgSessionMinutes:
                                                typeof data.appBuilderAvgSessionMinutes === "number"
                                                    ? data.appBuilderAvgSessionMinutes
                                                    : 0,
                                            appBuilderAiUserMessageTotal:
                                                typeof data.appBuilderAiUserMessageTotal === "number"
                                                    ? data.appBuilderAiUserMessageTotal
                                                    : 0,
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

                            try {
                                const appsCol = collection(db, "kloner_users", uid, "kloner_apps");
                                const appsSnap = await getDocs(appsCol);
                                const appDocs = appsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

                                let activeAppCount = 0;
                                let archivedAppCount = 0;
                                let appWithSupabaseCount = 0;
                                let appWithVercelCount = 0;
                                let appWithStripeCount = 0;
                                let appAiChatUserMessageCount = 0;
                                const appAiChatRecentEntries: AiChatAuditEntry[] = [];
                                const appCreationDates: Date[] = [];

                                await Promise.all(
                                    appDocs.map(async (appData) => {
                                        const archived = appData?.archived === true;
                                        if (archived) archivedAppCount += 1;
                                        else activeAppCount += 1;

                                        const appCreatedAt = tsToDate(appData?.createdAt);
                                        if (appCreatedAt) appCreationDates.push(appCreatedAt);

                                        if (
                                            (typeof appData?.vercelProjectId === "string" && appData.vercelProjectId.trim()) ||
                                            (typeof appData?.productionUrl === "string" && appData.productionUrl.trim()) ||
                                            appData?.isDeployed === true
                                        ) {
                                            appWithVercelCount += 1;
                                        }

                                        if (appFilesHaveStripeKeys(appData?.files)) {
                                            appWithStripeCount += 1;
                                        }

                                        try {
                                            const supabaseRef = doc(
                                                db,
                                                "kloner_users",
                                                uid,
                                                "kloner_apps",
                                                String(appData.id),
                                                "integrations",
                                                "supabase",
                                            );
                                            const supabaseSetupRef = doc(
                                                db,
                                                "kloner_users",
                                                uid,
                                                "kloner_apps",
                                                String(appData.id),
                                                "integrations",
                                                "supabase_setup",
                                            );

                                            const [supabaseSnap, supabaseSetupSnap] = await Promise.all([
                                                getDoc(supabaseRef),
                                                getDoc(supabaseSetupRef),
                                            ]);

                                            const hasSupabase = supabaseSnap.exists() || supabaseSetupSnap.exists();
                                            if (hasSupabase) appWithSupabaseCount += 1;
                                        } catch { }

                                        try {
                                            const aiChatRef = doc(
                                                db,
                                                "kloner_users",
                                                uid,
                                                "kloner_apps",
                                                String(appData.id),
                                                "ai_chat",
                                                "default",
                                            );
                                            const aiChatSnap = await getDoc(aiChatRef);
                                            if (aiChatSnap.exists()) {
                                                const aiChatData = aiChatSnap.data();
                                                appAiChatUserMessageCount += countUserMessagesFromAiChatDoc(aiChatData);
                                                appAiChatRecentEntries.push(
                                                    ...extractRecentAiChatEntries(aiChatData, String(appData.id)),
                                                );
                                            }
                                        } catch { }
                                    }),
                                );

                                appAiChatRecentEntries.sort(
                                    (a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0),
                                );

                                const existing = map.get(uid);
                                if (existing) {
                                    map.set(uid, {
                                        ...existing,
                                        appCount: appDocs.length,
                                        activeAppCount,
                                        archivedAppCount,
                                        appWithSupabaseCount,
                                        appWithVercelCount,
                                        appWithStripeCount,
                                        appAiChatUserMessageCount,
                                        appAiChatRecentEntries,
                                        appCreationDates,
                                    });
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
    }, [gate, isExcluded]);

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

    const appDailyBuckets: DailyBucket[] = useMemo(() => {
        const byDate = new Map<string, number>();
        for (const r of filteredRows) {
            const createdDates = Array.isArray(r.appCreationDates) ? r.appCreationDates : [];
            for (const created of createdDates) {
                if (!created) continue;
                const key = toYYYYMMDD(created);
                byDate.set(key, (byDate.get(key) || 0) + 1);
            }
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

        // Tier breakdown
        const tierBreakdown = { free: 0, pro: 0, agency: 0, trial: 0 };
        for (const r of filteredRows) {
            const tier = (r.tier ?? "free").toLowerCase();
            if (tier === "agency") tierBreakdown.agency++;
            else if (tier === "pro") tierBreakdown.pro++;
            else if (tier === "trial") tierBreakdown.trial++;
            else tierBreakdown.free++;
        }

        // Conversion metrics
        const conversionMetrics = {
            signupToActive: totalUsers > 0 ? Math.round((activeThisWeek / totalUsers) * 100) : 0,
            activeToVercel: activeThisWeek > 0 ? Math.round((vercelConnectedCount / activeThisWeek) * 100) : 0,
            vercelToDeploy: vercelConnectedCount > 0 ? Math.round((usersWithDeployments / vercelConnectedCount) * 100) : 0,
        };

        return {
            totalUsers,
            vercelConnectedCount,
            usersWithDeployments,
            totalDeployments,
            totalEditorMinutes: Math.round(totalMinutes * 10) / 10,
            avgMinutesPerUser,
            activeThisWeek,
            lastSignupDate,
            tierBreakdown,
            conversionMetrics,
        };
    }, [filteredRows, dailyBuckets]);

    const appBuilderOverview = useMemo(() => {
        const totalUsers = filteredRows.length;
        let usersWithApps = 0;
        let totalApps = 0;
        let activeApps = 0;
        let archivedApps = 0;

        let appsWithSupabase = 0;
        let appsWithVercel = 0;
        let appsWithStripe = 0;

        let totalAppBuilderMinutes = 0;
        let totalAppBuilderSessions = 0;
        let totalAiUserMessages = 0;

        for (const r of filteredRows) {
            const appCount = r.appCount ?? 0;
            const active = r.activeAppCount ?? 0;
            const archived = r.archivedAppCount ?? 0;
            const supabase = r.appWithSupabaseCount ?? 0;
            const vercel = r.appWithVercelCount ?? 0;
            const stripe = r.appWithStripeCount ?? 0;

            if (appCount > 0) usersWithApps += 1;

            totalApps += appCount;
            activeApps += active;
            archivedApps += archived;
            appsWithSupabase += supabase;
            appsWithVercel += vercel;
            appsWithStripe += stripe;

            totalAppBuilderMinutes += r.appBuilderSessionTotalMinutes ?? 0;
            totalAppBuilderSessions += r.appBuilderSessionCount ?? 0;
            totalAiUserMessages += r.appAiChatUserMessageCount ?? 0;
        }

        const avgAppsPerUser = totalUsers > 0 ? Math.round((totalApps / totalUsers) * 10) / 10 : 0;
        const avgAppBuilderSessionMinutes =
            totalAppBuilderSessions > 0 ? Math.round((totalAppBuilderMinutes / totalAppBuilderSessions) * 10) / 10 : 0;
        const avgAiMessagesPerApp = totalApps > 0 ? Math.round((totalAiUserMessages / totalApps) * 10) / 10 : 0;

        return {
            usersWithApps,
            totalApps,
            activeApps,
            archivedApps,
            appsWithSupabase,
            appsWithVercel,
            appsWithStripe,
            totalAppBuilderMinutes: Math.round(totalAppBuilderMinutes * 10) / 10,
            totalAppBuilderSessions,
            totalAiUserMessages,
            avgAppsPerUser,
            avgAppBuilderSessionMinutes,
            avgAiMessagesPerApp,
        };
    }, [filteredRows]);

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

    const churnMetrics = useMemo(() => {
        const now = new Date();
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

        let inactive1Month = 0;
        let inactive3Months = 0;
        let inactive6Months = 0;
        let neverActive = 0;

        let longestInactiveReturners: Array<{ user: UserAnalyticsRow; daysInactive: number }> = [];

        for (const r of filteredRows) {
            const lastSession = r.lastSessionEndedAt;
            if (!lastSession) {
                neverActive++;
                continue;
            }

            const daysSinceLastSession = Math.floor((now.getTime() - lastSession.getTime()) / (1000 * 60 * 60 * 24));

            if (lastSession < sixMonthsAgo) inactive6Months++;
            else if (lastSession < threeMonthsAgo) inactive3Months++;
            else if (lastSession < monthAgo) inactive1Month++;

            // Track users who returned after being inactive
            if (daysSinceLastSession > 30 && (r.editorSessionCount ?? 0) >= 2) {
                longestInactiveReturners.push({ user: r, daysInactive: daysSinceLastSession });
            }
        }

        // Sort by longest inactivity period
        longestInactiveReturners.sort((a, b) => b.daysInactive - a.daysInactive);

        const churnRate = filteredRows.length > 0 ? Math.round((inactive3Months / filteredRows.length) * 100) : 0;

        return {
            inactive1Month,
            inactive3Months,
            inactive6Months,
            neverActive,
            churnRate,
            longestInactiveReturners: longestInactiveReturners.slice(0, 10), // Top 10
        };
    }, [filteredRows]);

    const creditsSummary = useMemo(() => {
        let aiRemaining = 0;
        let previewRemaining = 0;
        let snapshotRemaining = 0;

        let aiLow = 0;
        let previewLow = 0;
        let snapshotLow = 0;

        let usersWithCredits = 0;
        let usersOutOfAi = 0;
        let usersOutOfPreview = 0;
        let usersOutOfSnapshot = 0;

        const creditDetails: Array<{
            user: UserAnalyticsRow;
            ai: number;
            preview: number;
            snapshot: number;
            totalCredits: number;
        }> = [];

        for (const r of filteredRows) {
            const ai = r.creditsAiEditsRemaining ?? 0;
            const pv = r.creditsPreviewRemaining ?? 0;
            const sn = r.creditsSnapshotRemaining ?? 0;

            aiRemaining += ai;
            previewRemaining += pv;
            snapshotRemaining += sn;

            if (ai > 0 || pv > 0 || sn > 0) {
                usersWithCredits++;
            }

            if (ai <= 0) usersOutOfAi++;
            if (pv <= 0) usersOutOfPreview++;
            if (sn <= 0) usersOutOfSnapshot++;

            if (ai > 0 && ai <= 5) aiLow++;
            if (pv > 0 && pv <= 5) previewLow++;
            if (sn > 0 && sn <= 5) snapshotLow++;

            creditDetails.push({
                user: r,
                ai,
                preview: pv,
                snapshot: sn,
                totalCredits: ai + pv + sn,
            });
        }

        // Sort by total credits remaining (ascending - users running out first)
        creditDetails.sort((a, b) => a.totalCredits - b.totalCredits);

        return {
            aiRemaining,
            previewRemaining,
            snapshotRemaining,
            aiLow,
            previewLow,
            snapshotLow,
            usersWithCredits,
            usersOutOfAi,
            usersOutOfPreview,
            usersOutOfSnapshot,
            creditDetails: creditDetails.slice(0, 20), // Top 20 users by lowest credits
        };
    }, [filteredRows]);

    const usageKeys = useMemo(() => buildLastNDaysKeys(usageRangeDays), [usageRangeDays]);

    const signupsSeries = useMemo(() => buildSeriesFromBuckets(usageKeys, dailyBuckets), [usageKeys, dailyBuckets]);

    const appCreationsSeries = useMemo(
        () => buildSeriesFromBuckets(usageKeys, appDailyBuckets),
        [usageKeys, appDailyBuckets],
    );

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

    const appAiChatAuditEntries = useMemo(() => {
        const out: Array<{
            uid: string;
            email?: string | null;
            tier?: string | null;
            appId: string;
            at: Date | null;
            userPrompt: string;
            assistantReply: string;
        }> = [];

        for (const r of filteredRows) {
            const entries = Array.isArray(r.appAiChatRecentEntries) ? r.appAiChatRecentEntries : [];
            for (const e of entries) {
                out.push({
                    uid: r.id,
                    email: r.email ?? null,
                    tier: r.tier ?? "free",
                    appId: e.appId,
                    at: e.at,
                    userPrompt: e.userPrompt,
                    assistantReply: e.assistantReply,
                });
            }
        }

        out.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
        return out.slice(0, 500);
    }, [filteredRows]);

    const visibleTabs = useMemo(() => {
        if (analyticsScope === "apps") {
            return [
                { id: "overview" as TabId, label: "Overview" },
                { id: "usage" as TabId, label: "Usage" },
            ];
        }
        return [
            { id: "overview" as TabId, label: "Overview" },
            { id: "usage" as TabId, label: "Usage" },
            { id: "power" as TabId, label: "Power users" },
            { id: "credits" as TabId, label: "Credits" },
            { id: "churn" as TabId, label: "Churn" },
        ];
    }, [analyticsScope]);

    useEffect(() => {
        if (analyticsScope === "apps" && activeTab !== "overview" && activeTab !== "usage") {
            setActiveTab("overview");
        }
    }, [analyticsScope, activeTab]);

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
                <div className="mr-4 inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
                    <button
                        type="button"
                        onClick={() => setAnalyticsScope("legacy")}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${analyticsScope === "legacy"
                            ? "bg-white text-neutral-900 shadow-sm"
                            : "text-neutral-600 hover:text-neutral-900"
                            }`}
                    >
                        Legacy (kloner_renders)
                    </button>
                    <button
                        type="button"
                        onClick={() => setAnalyticsScope("apps")}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${analyticsScope === "apps"
                            ? "bg-white text-neutral-900 shadow-sm"
                            : "text-neutral-600 hover:text-neutral-900"
                            }`}
                    >
                        Apps (kloner_apps)
                    </button>
                </div>

                {visibleTabs.map((t) => (
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
                            {analyticsScope === "apps" ? (
                                <>
                                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">App builder health (kloner_apps)</p>
                                        <div className="grid gap-4 md:grid-cols-4 text-sm">
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">Users with apps</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.usersWithApps}</p>
                                                <p className="mt-1 text-[11px] text-neutral-500">Out of {overview.totalUsers} users</p>
                                            </div>
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">Total apps</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.totalApps}</p>
                                                <p className="mt-1 text-[11px] text-neutral-500">Avg/user: {appBuilderOverview.avgAppsPerUser}</p>
                                            </div>
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">Active apps</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.activeApps}</p>
                                                <p className="mt-1 text-[11px] text-neutral-500">Archived: {appBuilderOverview.archivedApps}</p>
                                            </div>
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">AI chat messages</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.totalAiUserMessages}</p>
                                                <p className="mt-1 text-[11px] text-neutral-500">Avg/app: {appBuilderOverview.avgAiMessagesPerApp}</p>
                                            </div>
                                        </div>
                                        <div className="mt-4 grid gap-4 md:grid-cols-4 text-sm">
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">Supabase-integrated apps</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.appsWithSupabase}</p>
                                            </div>
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">Vercel-integrated apps</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.appsWithVercel}</p>
                                            </div>
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">Stripe-configured apps</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.appsWithStripe}</p>
                                            </div>
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">Avg app-builder session</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.avgAppBuilderSessionMinutes} min</p>
                                                <p className="mt-1 text-[11px] text-neutral-500">Sessions: {appBuilderOverview.totalAppBuilderSessions}</p>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">AI chat moderation preview</p>
                                                <p className="mt-1 text-xs text-neutral-500">
                                                    Recent prompt/response pairs to quickly spot suspicious behavior.
                                                </p>
                                            </div>
                                            <p className="text-[11px] text-neutral-500">{"Full feed is in Apps -> Usage"}</p>
                                        </div>

                                        {appAiChatAuditEntries.length === 0 ? (
                                            <p className="mt-3 text-xs text-neutral-500">No AI chat entries found for this filter.</p>
                                        ) : (
                                            <div className="mt-3 space-y-2">
                                                {appAiChatAuditEntries.slice(0, 8).map((entry, idx) => (
                                                    <div
                                                        key={`overview:${entry.uid}:${entry.appId}:${entry.at?.getTime() || 0}:${idx}`}
                                                        className="rounded-lg border border-neutral-100 bg-neutral-50 p-3"
                                                    >
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-600">
                                                            <span className="font-medium text-neutral-800">{entry.email || entry.uid}</span>
                                                            <span>App: {entry.appId}</span>
                                                            <span>
                                                                {entry.at
                                                                    ? entry.at.toLocaleString(undefined, {
                                                                        dateStyle: "medium",
                                                                        timeStyle: "short",
                                                                    })
                                                                    : "Unknown time"}
                                                            </span>
                                                        </div>
                                                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                                                            <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
                                                                <p className="text-[10px] uppercase tracking-[0.12em] text-amber-800">User prompt</p>
                                                                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-amber-900">
                                                                    {entry.userPrompt || "(empty)"}
                                                                </p>
                                                            </div>
                                                            <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2">
                                                                <p className="text-[10px] uppercase tracking-[0.12em] text-blue-800">Assistant response</p>
                                                                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-blue-900">
                                                                    {entry.assistantReply || "(no assistant response captured)"}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </section>
                                </>
                            ) : null}

                            {analyticsScope === "legacy" ? (
                                <>

                            {/* Tier Breakdown */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">User tier breakdown</p>
                                <div className="grid gap-4 md:grid-cols-4 text-sm">
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Free tier</p>
                                        <p className="text-xl font-semibold text-neutral-900">{overview.tierBreakdown.free}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Users</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Pro tier</p>
                                        <p className="text-xl font-semibold text-neutral-900">{overview.tierBreakdown.pro}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Users</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Agency tier</p>
                                        <p className="text-xl font-semibold text-neutral-900">{overview.tierBreakdown.agency}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Users</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Trial</p>
                                        <p className="text-xl font-semibold text-neutral-900">{overview.tierBreakdown.trial}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Users</p>
                                    </div>
                                </div>
                            </section>

                            {/* Conversion Funnel */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Conversion funnel</p>
                                <div className="grid gap-4 md:grid-cols-3 text-sm">
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Signup → Active (7d)</p>
                                        <p className="text-xl font-semibold text-neutral-900">{overview.conversionMetrics.signupToActive}%</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Of total signups</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Active → Vercel</p>
                                        <p className="text-xl font-semibold text-neutral-900">{overview.conversionMetrics.activeToVercel}%</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Of active users</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Vercel → Deploy</p>
                                        <p className="text-xl font-semibold text-neutral-900">{overview.conversionMetrics.vercelToDeploy}%</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Of Vercel users</p>
                                    </div>
                                </div>
                            </section>

                            {/* Churn Metrics */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Churn analysis</p>
                                <div className="grid gap-4 md:grid-cols-4 text-sm">
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Never active</p>
                                        <p className="text-xl font-semibold text-neutral-900">{churnMetrics.neverActive}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">No editor sessions</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Inactive &gt;1 month</p>
                                        <p className="text-xl font-semibold text-neutral-900">{churnMetrics.inactive1Month}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Last session &gt;30d ago</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Inactive &gt;3 months</p>
                                        <p className="text-xl font-semibold text-neutral-900">{churnMetrics.inactive3Months}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Last session &gt;90d ago</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Churn rate (3mo)</p>
                                        <p className="text-xl font-semibold text-neutral-900">{churnMetrics.churnRate}%</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Of total users</p>
                                    </div>
                                </div>
                            </section>

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
                                                <div key={b.date} className="whitespace-nowrap flex flex-col items-center gap-1">
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
                                </>
                            ) : null}
                        </div>
                    )}

                    {activeTab === "usage" && (
                        <div className="space-y-6">
                            {analyticsScope === "apps" ? (
                                <>
                                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">App builder usage</p>
                                                <p className="mt-1 text-xs text-neutral-500">
                                                    Session time and build activity for kloner_apps only.
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
                                                <p className="text-[11px] text-neutral-500 mb-1">Total app-builder minutes</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.totalAppBuilderMinutes}</p>
                                            </div>
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">App-builder sessions</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.totalAppBuilderSessions}</p>
                                            </div>
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">Avg session length</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.avgAppBuilderSessionMinutes} min</p>
                                            </div>
                                            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="text-[11px] text-neutral-500 mb-1">AI user messages</p>
                                                <p className="text-xl font-semibold text-neutral-900">{appBuilderOverview.totalAiUserMessages}</p>
                                            </div>
                                        </div>
                                    </section>

                                    <div className="grid gap-4 xl:grid-cols-2">
                                        <LineChartCard
                                            title="App creations per day"
                                            subtitle="New kloner_apps created per day"
                                            points={appCreationsSeries}
                                        />
                                        <LineChartCard
                                            title="Signups per day"
                                            subtitle="New kloner_users created (createdAt) per day"
                                            points={signupsSeries}
                                        />
                                    </div>

                                    <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">AI chat moderation feed</p>
                                                <p className="mt-1 text-xs text-neutral-500">
                                                    Recent user prompts and assistant responses from kloner_apps. Use this to spot suspicious or malicious requests.
                                                </p>
                                            </div>
                                            <p className="text-[11px] text-neutral-500">Showing {appAiChatAuditEntries.length} recent pairs (cap 500)</p>
                                        </div>

                                        {appAiChatAuditEntries.length === 0 ? (
                                            <p className="mt-3 text-xs text-neutral-500">No AI chat entries found for this filter.</p>
                                        ) : (
                                            <div className="mt-3 space-y-2">
                                                {appAiChatAuditEntries.map((entry, idx) => (
                                                    <div
                                                        key={`${entry.uid}:${entry.appId}:${entry.at?.getTime() || 0}:${idx}`}
                                                        className="rounded-lg border border-neutral-100 bg-neutral-50 p-3"
                                                    >
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-600">
                                                            <span className="font-medium text-neutral-800">{entry.email || entry.uid}</span>
                                                            <span>UID: {entry.uid}</span>
                                                            <span>Tier: {entry.tier || "free"}</span>
                                                            <span>App: {entry.appId}</span>
                                                            <span>
                                                                {entry.at
                                                                    ? entry.at.toLocaleString(undefined, {
                                                                        dateStyle: "medium",
                                                                        timeStyle: "short",
                                                                    })
                                                                    : "Unknown time"}
                                                            </span>
                                                        </div>

                                                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                                                            <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
                                                                <p className="text-[10px] uppercase tracking-[0.12em] text-amber-800">User prompt</p>
                                                                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-amber-900">
                                                                    {entry.userPrompt || "(empty)"}
                                                                </p>
                                                            </div>
                                                            <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2">
                                                                <p className="text-[10px] uppercase tracking-[0.12em] text-blue-800">Assistant response</p>
                                                                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-blue-900">
                                                                    {entry.assistantReply || "(no assistant response captured)"}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </section>
                                </>
                            ) : null}

                            {analyticsScope === "legacy" ? (
                                <>
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

                            <div className="grid gap-4 xl:grid-cols-4">
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
                                <LineChartCard
                                    title="App creations per day"
                                    subtitle="New kloner_apps created per day"
                                    points={appCreationsSeries}
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
                                </>
                            ) : null}
                        </div>
                    )}

                    {analyticsScope === "legacy" && activeTab === "power" && (
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

                    {analyticsScope === "legacy" && activeTab === "credits" && (
                        <div className="space-y-6">
                            {/* Most Recent Returners */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Users who returned after long inactivity</p>
                                <p className="mb-3 text-xs text-neutral-500">Most recent 5 users who returned after being inactive for 30+ days</p>
                                <div className="space-y-1 text-xs">
                                    {churnMetrics.longestInactiveReturners
                                        .sort((a, b) => (b.user.lastSessionEndedAt?.getTime() ?? 0) - (a.user.lastSessionEndedAt?.getTime() ?? 0))
                                        .slice(0, 5)
                                        .length === 0 ? (
                                        <p className="text-neutral-500">No users match this criteria.</p>
                                    ) : (
                                        churnMetrics.longestInactiveReturners
                                            .sort((a, b) => (b.user.lastSessionEndedAt?.getTime() ?? 0) - (a.user.lastSessionEndedAt?.getTime() ?? 0))
                                            .slice(0, 5)
                                            .map((item) => (
                                                <div
                                                    key={item.user.id}
                                                    className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                                >
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="font-medium text-neutral-900 truncate">{item.user.email ?? item.user.id}</span>
                                                        <span className="text-[10px] text-neutral-500">Tier: {item.user.tier ?? "free"}</span>
                                                    </div>
                                                    <div className="text-right flex-shrink-0">
                                                        <div className="text-[11px] text-neutral-700">
                                                            Returned after {item.daysInactive} days
                                                        </div>
                                                        <div className="text-[10px] text-neutral-500">
                                                            Last active: {item.user.lastSessionEndedAt?.toLocaleDateString() ?? 'Never'}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                    )}
                                </div>
                            </section>

                            {/* Credit Pool Summary */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Credit pools overview</p>
                                <div className="grid gap-4 md:grid-cols-4 text-sm">
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Users with credits</p>
                                        <p className="text-xl font-semibold text-neutral-900">{creditsSummary.usersWithCredits}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Have any credits left</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Out of AI credits</p>
                                        <p className="text-xl font-semibold text-neutral-900">{creditsSummary.usersOutOfAi}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">AI edits ≤ 0</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Out of previews</p>
                                        <p className="text-xl font-semibold text-neutral-900">{creditsSummary.usersOutOfPreview}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Previews ≤ 0</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Out of snapshots</p>
                                        <p className="text-xl font-semibold text-neutral-900">{creditsSummary.usersOutOfSnapshot}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Snapshots ≤ 0</p>
                                    </div>
                                </div>
                            </section>

                            {/* Individual Credit Types */}
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

                            {/* Users Running Out */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Users running out of credits (lowest first)</p>
                                <div className="space-y-1 text-xs">
                                    {creditsSummary.creditDetails.length === 0 ? (
                                        <p className="text-neutral-500">No users with credit data.</p>
                                    ) : (
                                        creditsSummary.creditDetails.map((detail) => (
                                            <div
                                                key={detail.user.id}
                                                className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                            >
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-medium text-neutral-900 truncate">{detail.user.email ?? detail.user.id}</span>
                                                    <span className="text-[10px] text-neutral-500">Tier: {detail.user.tier ?? "free"}</span>
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <div className="text-[11px] text-neutral-700">
                                                        Total: {detail.totalCredits} credits
                                                    </div>
                                                    <div className="text-[10px] text-neutral-500">
                                                        AI: {detail.ai} · Prev: {detail.preview} · Snap: {detail.snapshot}
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>

                            {/* Longest Inactive Returners */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Longest inactive returners</p>
                                <p className="mb-3 text-xs text-neutral-500">Users who returned after being inactive for 30+ days (top 10)</p>
                                <div className="space-y-1 text-xs">
                                    {churnMetrics.longestInactiveReturners.length === 0 ? (
                                        <p className="text-neutral-500">No users match this criteria.</p>
                                    ) : (
                                        churnMetrics.longestInactiveReturners.map((item, idx) => (
                                            <div
                                                key={item.user.id}
                                                className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                            >
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-medium text-neutral-900 truncate">{item.user.email ?? item.user.id}</span>
                                                    <span className="text-[10px] text-neutral-500">Tier: {item.user.tier ?? "free"}</span>
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <div className="text-[11px] text-neutral-700">
                                                        {item.daysInactive} days inactive
                                                    </div>
                                                    <div className="text-[10px] text-neutral-500">
                                                        Sessions: {item.user.editorSessionCount ?? 0} · Last: {item.user.lastSessionEndedAt?.toLocaleDateString() ?? 'Never'}
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>
                        </div>
                    )}

                    {analyticsScope === "legacy" && activeTab === "churn" && (
                        <div className="space-y-6">
                            {/* Churn Overview */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Churn overview</p>
                                <div className="grid gap-4 md:grid-cols-4 text-sm">
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Never active</p>
                                        <p className="text-xl font-semibold text-neutral-900">{churnMetrics.neverActive}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Signed up but never used editor</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Inactive &gt;1 month</p>
                                        <p className="text-xl font-semibold text-neutral-900">{churnMetrics.inactive1Month}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Last session &gt;30 days ago</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Inactive &gt;3 months</p>
                                        <p className="text-xl font-semibold text-neutral-900">{churnMetrics.inactive3Months}</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Last session &gt;90 days ago</p>
                                    </div>
                                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                                        <p className="text-[11px] text-neutral-500 mb-1">Churn rate (3mo)</p>
                                        <p className="text-xl font-semibold text-neutral-900">{churnMetrics.churnRate}%</p>
                                        <p className="mt-1 text-[11px] text-neutral-500">Users inactive &gt;3 months</p>
                                    </div>
                                </div>
                            </section>

                            {/* Inactive Users by Time Period */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Inactive users by time period</p>
                                <div className="space-y-1 text-xs">
                                    {filteredRows
                                        .filter(r => r.lastSessionEndedAt)
                                        .sort((a, b) => {
                                            const aDays = Math.floor((new Date().getTime() - (a.lastSessionEndedAt?.getTime() ?? 0)) / (1000 * 60 * 60 * 24));
                                            const bDays = Math.floor((new Date().getTime() - (b.lastSessionEndedAt?.getTime() ?? 0)) / (1000 * 60 * 60 * 24));
                                            return bDays - aDays; // Most inactive first
                                        })
                                        .slice(0, 20)
                                        .map((r) => {
                                            const daysSince = Math.floor((new Date().getTime() - (r.lastSessionEndedAt?.getTime() ?? 0)) / (1000 * 60 * 60 * 24));
                                            return (
                                                <div
                                                    key={r.id}
                                                    className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                                >
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="font-medium text-neutral-900 truncate">{r.email ?? r.id}</span>
                                                        <span className="text-[10px] text-neutral-500">Tier: {r.tier ?? "free"}</span>
                                                    </div>
                                                    <div className="text-right flex-shrink-0">
                                                        <div className="text-[11px] text-neutral-700">
                                                            {daysSince} days inactive
                                                        </div>
                                                        <div className="text-[10px] text-neutral-500">
                                                            Sessions: {r.editorSessionCount ?? 0} · Minutes: {r.editorSessionTotalMinutes ?? 0}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            </section>

                            {/* Returners Analysis */}
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">Users who returned after long inactivity</p>
                                <p className="mb-3 text-xs text-neutral-500">Users with 2+ sessions who returned after being inactive for 30+ days</p>
                                <div className="space-y-1 text-xs">
                                    {churnMetrics.longestInactiveReturners.length === 0 ? (
                                        <p className="text-neutral-500">No users match this criteria.</p>
                                    ) : (
                                        churnMetrics.longestInactiveReturners.map((item) => (
                                            <div
                                                key={item.user.id}
                                                className="flex items-center justify-between rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2"
                                            >
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-medium text-neutral-900 truncate">{item.user.email ?? item.user.id}</span>
                                                    <span className="text-[10px] text-neutral-500">Tier: {item.user.tier ?? "free"}</span>
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <div className="text-[11px] text-neutral-700">
                                                        Returned after {item.daysInactive} days
                                                    </div>
                                                    <div className="text-[10px] text-neutral-500">
                                                        Sessions: {item.user.editorSessionCount ?? 0} · Last active: {item.user.lastSessionEndedAt?.toLocaleDateString() ?? 'Never'}
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
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
