// src/app/affiliate/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    BarChart3,
    DollarSign,
    Users,
    Calendar,
    ShieldCheck,
    Link as LinkIcon,
} from "lucide-react";

type ViewState = "loading" | "signedOut" | "hasCode" | "noCode";

type AffiliateCodeRow = {
    code: string;
    uid: string | null;
    status?: string | null;
    createdAtMs?: number | null;
    updatedAtMs?: number | null;
};

type AffiliateStats = {
    code: string;
    totalEarnedCents: number;
    pendingCents: number;
    nextPayoutAtMs: number | null;
    referralsCount: number;
    canceledCount: number;
    subscribedSinceMs: number | null;
    overallHealthStatus?: string | null; // active | canceled | refunded | —
};

type ReferralStart = {
    startedAtMs: number;
    status: "active" | "canceled" | "refunded";
    canceledAtMs: number | null;
};

type SeriesRow = {
    date: string; // YYYY-MM-DD
    active: number;
    canceled: number;
    refunded: number;
    total: number;
};

function cleanStr(v: unknown, max = 256) {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function isEmailLike(v: string) {
    const s = v.trim();
    return s.includes("@") && s.includes(".");
}

function cents(n: number) {
    const v = Number.isFinite(n) ? n : 0;
    return Math.max(0, Math.floor(v));
}

function fmtMoney(centsVal: number) {
    const v = cents(centsVal) / 100;
    return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function prettyStatus(v: string | null | undefined) {
    const s = String(v || "").toLowerCase();
    if (!s || s === "—") return "—";
    if (s === "active") return "Active";
    if (s === "trialing") return "Trialing";
    if (s === "pending") return "Pending";
    if (s === "canceled" || s === "cancelled") return "Canceled";
    if (s === "refunded" || s === "void") return "Refunded";
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function Badge({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-[11px] text-neutral-700 shadow-sm">
            <span className="text-neutral-600">{icon}</span>
            <span className="font-medium">{label}</span>
        </span>
    );
}

function yyyyMmDd(ms: number) {
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function startOfDayMs(ms: number) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function startOfWeekMs(ms: number) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    // Monday start
    const day = d.getDay(); // 0 Sun, 1 Mon...
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    return d.getTime();
}

type RangeKey = "7d" | "30d" | "90d" | "365d" | "all";
type GroupKey = "day" | "week";
type MetricKey = "total" | "active" | "canceled" | "refunded";

export default function AffiliatePage() {
    const [view, setView] = useState<ViewState>("loading");
    const [uid, setUid] = useState<string | null>(null);

    const [codeRow, setCodeRow] = useState<AffiliateCodeRow | null>(null);
    const [stats, setStats] = useState<AffiliateStats | null>(null);

    // chart data (no member identifiers)
    const [referralStarts, setReferralStarts] = useState<ReferralStart[]>([]);
    const [series, setSeries] = useState<SeriesRow[]>([]);

    const [showApply, setShowApply] = useState(false);
    const [applyBusy, setApplyBusy] = useState(false);
    const [applyErr, setApplyErr] = useState<string | null>(null);
    const [applyOk, setApplyOk] = useState<string | null>(null);

    const [linkCopied, setLinkCopied] = useState(false);

    const [range, setRange] = useState<RangeKey>("30d");
    const [group, setGroup] = useState<GroupKey>("day");
    const [metric, setMetric] = useState<MetricKey>("total");

    const formRef = useRef<HTMLDivElement | null>(null);

    const scrollToForm = () => {
        requestAnimationFrame(() => {
            formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    };

    async function apiGetMe() {
        const token = await auth.currentUser?.getIdToken(true);
        if (!token) throw new Error("Not authenticated");

        const res = await fetch("/api/affiliate/me", {
            headers: { authorization: `Bearer ${token}` },
            cache: "no-store",
        });

        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Request failed");

        return json as {
            ok: true;
            hasCode: boolean;
            codeRow?: AffiliateCodeRow | null;
            stats?: AffiliateStats | null;
            referralStarts?: ReferralStart[] | null;
            series?: SeriesRow[] | null;
        };
    }

    useEffect(() => {
        const off = onAuthStateChanged(auth, async (u) => {
            setApplyErr(null);
            setApplyOk(null);

            setStats(null);
            setCodeRow(null);
            setReferralStarts([]);
            setSeries([]);
            setShowApply(false);

            if (!u) {
                setUid(null);
                setView("signedOut");
                return;
            }

            setUid(u.uid);
            setView("loading");

            try {
                const me = await apiGetMe();

                if (me.hasCode && me.codeRow?.code) {
                    setCodeRow(me.codeRow);
                    setStats(me.stats || null);
                    setReferralStarts(Array.isArray(me.referralStarts) ? me.referralStarts : []);
                    setSeries(Array.isArray(me.series) ? me.series : []);
                    setView("hasCode");
                    setShowApply(false);
                } else {
                    setView("noCode");
                }
            } catch {
                setView("noCode");
            }
        });

        return () => off();
    }, []);

    const affiliateLink = useMemo(() => {
        if (!codeRow?.code) return null;
        return `${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${encodeURIComponent(codeRow.code)}`;
    }, [codeRow?.code]);

    async function submitApplication(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!uid) return;

        setApplyBusy(true);
        setApplyErr(null);
        setApplyOk(null);

        try {
            const fd = new FormData(e.currentTarget);

            const payload = {
                fullName: cleanStr(fd.get("fullName")),
                email: cleanStr(fd.get("email")).toLowerCase(),
                country: cleanStr(fd.get("country")),
                website: cleanStr(fd.get("website")),
                primaryChannel: cleanStr(fd.get("primaryChannel")),
                socialHandle: cleanStr(fd.get("socialHandle")),
                audienceSize: cleanStr(fd.get("audienceSize")),
                niche: cleanStr(fd.get("niche"), 500),
                promoPlan: cleanStr(fd.get("promoPlan"), 1000),
                payoutEmail: cleanStr(fd.get("payoutEmail")).toLowerCase(),
                agreed: String(fd.get("agreed") || "") === "on",
            };

            if (!payload.fullName) throw new Error("Name is required");
            if (!isEmailLike(payload.email)) throw new Error("Valid email is required");
            if (!payload.primaryChannel) throw new Error("Primary channel is required");
            if (!payload.socialHandle) throw new Error("Social handle is required");
            if (!payload.promoPlan) throw new Error("Promotion plan is required");
            if (payload.payoutEmail && !isEmailLike(payload.payoutEmail)) throw new Error("Payout email must be a valid email");
            if (!payload.agreed) throw new Error("You must agree to the terms");

            const token = await auth.currentUser?.getIdToken(true);

            const res = await fetch("/api/affiliate/apply", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(payload),
                cache: "no-store",
            });

            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.ok) throw new Error(json?.error || "Application failed");

            setApplyOk("Application received. You’ll get an email when it’s approved.");
            (e.currentTarget as HTMLFormElement).reset();
            setShowApply(false);
        } catch (err: any) {
            setApplyErr(err?.message || "Application failed");
        } finally {
            setApplyBusy(false);
        }
    }

    const affiliateHealthStatus = useMemo(() => {
        const s = (stats?.overallHealthStatus || "").toLowerCase();
        if (s) return prettyStatus(s);
        if ((stats?.referralsCount ?? 0) > 0) return "Active";
        return "—";
    }, [stats?.overallHealthStatus, stats?.referralsCount]);

    const subscribedSinceLabel = useMemo(() => {
        if (!stats?.subscribedSinceMs) return "—";
        return new Date(stats.subscribedSinceMs).toLocaleDateString();
    }, [stats?.subscribedSinceMs]);

    const chartBuckets = useMemo(() => {
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;

        const earliest = referralStarts.length
            ? Math.min(...referralStarts.map((r) => r.startedAtMs))
            : null;

        const rangeStartMs =
            range === "7d" ? now - 7 * dayMs :
                range === "30d" ? now - 30 * dayMs :
                    range === "90d" ? now - 90 * dayMs :
                        range === "365d" ? now - 365 * dayMs :
                            earliest ?? now;

        const map = new Map<
            string,
            { key: string; ms: number; total: number; active: number; canceled: number; refunded: number }
        >();

        for (const r of referralStarts) {
            if (r.startedAtMs < rangeStartMs) continue;

            const bucketMs = group === "week" ? startOfWeekMs(r.startedAtMs) : startOfDayMs(r.startedAtMs);
            const key = yyyyMmDd(bucketMs);

            const cur =
                map.get(key) || {
                    key,
                    ms: bucketMs,
                    total: 0,
                    active: 0,
                    canceled: 0,
                    refunded: 0,
                };

            cur.total += 1;
            if (r.status === "active") cur.active += 1;
            if (r.status === "canceled") cur.canceled += 1;
            if (r.status === "refunded") cur.refunded += 1;

            map.set(key, cur);
        }

        const arr = Array.from(map.values()).sort((a, b) => a.ms - b.ms);

        // backfill empty buckets so the graph doesn’t look broken
        if (arr.length === 0) return [];

        const minMs = arr[0]!.ms;
        const maxMs = arr[arr.length - 1]!.ms;

        const step = group === "week" ? 7 * dayMs : dayMs;
        const filled: typeof arr = [];

        for (let t = minMs; t <= maxMs; t += step) {
            const k = yyyyMmDd(t);
            const found = map.get(k);
            filled.push(
                found || { key: k, ms: t, total: 0, active: 0, canceled: 0, refunded: 0 }
            );
        }

        return filled;
    }, [referralStarts, range, group]);

    const maxChartValue = useMemo(() => {
        const m = chartBuckets.reduce((acc, b) => {
            const v = metric === "active" ? b.active : metric === "canceled" ? b.canceled : metric === "refunded" ? b.refunded : b.total;
            return v > acc ? v : acc;
        }, 0);
        return Math.max(1, m);
    }, [chartBuckets, metric]);

    const chartSummary = useMemo(() => {
        let total = 0, active = 0, canceled = 0, refunded = 0;
        for (const b of chartBuckets) {
            total += b.total;
            active += b.active;
            canceled += b.canceled;
            refunded += b.refunded;
        }
        return { total, active, canceled, refunded };
    }, [chartBuckets]);

    return (
        <div className="p-6">
            <section className="mb-10">
                <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                    <span>Kloner · Affiliate Program</span>
                </div>

                <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-7 sm:px-8 sm:py-9 shadow-sm">
                    <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">Earn recurring revenue from referrals</h1>
                    <p className="mt-3 max-w-2xl text-sm sm:text-base text-neutral-600">
                        Share Kloner with your audience. Track commission, eligibility dates, and referral activity in one place.
                    </p>

                    <div className="mt-6 flex flex-wrap gap-2.5 text-xs">
                        <Badge icon={<DollarSign className="h-3 w-3" />} label="Recurring commissions" />
                        <Badge icon={<BarChart3 className="h-3 w-3" />} label="Earnings dashboard" />
                        <Badge icon={<Calendar className="h-3 w-3" />} label="Eligibility tracking" />
                        <Badge icon={<ShieldCheck className="h-3 w-3" />} label="Fraud-resistant tracking" />
                    </div>
                </div>
            </section>

            {(applyErr || applyOk) && (
                <div
                    className={[
                        "mb-6 rounded border px-3 py-2 text-sm",
                        applyErr ? "border-red-300 bg-red-50 text-red-700" : "border-green-300 bg-green-50 text-green-700",
                    ].join(" ")}
                >
                    {applyErr ?? applyOk}
                </div>
            )}

            {view === "loading" && <div className="text-sm text-neutral-600">Loading…</div>}

            {view === "signedOut" && (
                <div className="rounded-2xl border border-neutral-200 bg-white p-6">
                    <div className="text-sm font-semibold text-neutral-900">Sign in to continue</div>
                    <div className="mt-1 text-sm text-neutral-600">The affiliate dashboard and application are tied to your account.</div>
                </div>
            )}

            {view === "hasCode" && codeRow?.code && (
                <div className="space-y-6">
                    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-sm font-semibold text-neutral-900">Your affiliate code</div>
                                <div className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">{codeRow.code}</div>
                                <div className="mt-1 text-xs text-neutral-500">Status: {codeRow.status || "-"}</div>
                            </div>

                            {affiliateLink && (
                                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                                    <div className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <LinkIcon className="h-3.5 w-3.5" />
                                            Referral link
                                        </div>

                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    await navigator.clipboard.writeText(affiliateLink);
                                                    setLinkCopied(true);
                                                    window.setTimeout(() => setLinkCopied(false), 1600);
                                                } catch {
                                                    try {
                                                        const ta = document.createElement("textarea");
                                                        ta.value = affiliateLink;
                                                        ta.style.position = "fixed";
                                                        ta.style.left = "-9999px";
                                                        document.body.appendChild(ta);
                                                        ta.focus();
                                                        ta.select();
                                                        document.execCommand("copy");
                                                        document.body.removeChild(ta);
                                                        setLinkCopied(true);
                                                        window.setTimeout(() => setLinkCopied(false), 1600);
                                                    } catch {
                                                        // silent
                                                    }
                                                }
                                            }}
                                            className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold active:scale-[0.99] border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100"
                                            aria-label="Copy referral link"
                                            title="Copy"
                                        >
                                            {linkCopied ? "Copied" : "Copy"}
                                        </button>
                                    </div>

                                    <div className="mt-1 text-xs text-neutral-700 break-all">{affiliateLink}</div>
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                            <div className="text-[11px] font-semibold text-neutral-600">Total paid out</div>
                            <div className="mt-2 text-xl font-semibold text-neutral-900">{fmtMoney(stats?.totalEarnedCents ?? 0)}</div>
                            <div className="mt-1 text-[11px] text-neutral-500">Affiliate payouts only</div>
                        </div>

                        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                            <div className="text-[11px] font-semibold text-neutral-600">Pending commission</div>
                            <div className="mt-2 text-xl font-semibold text-neutral-900">{fmtMoney(stats?.pendingCents ?? 0)}</div>
                            <div className="mt-1 text-[11px] text-neutral-500">Not held, not paid out</div>
                        </div>

                        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                            <div className="text-[11px] font-semibold text-neutral-600">Referrals</div>
                            <div className="mt-2 text-xl font-semibold text-neutral-900">{stats?.referralsCount ?? 0}</div>
                            <div className="mt-1 text-xs text-neutral-500 flex items-center gap-2">
                                <Users className="h-3.5 w-3.5" />
                                Unique members
                            </div>
                        </div>

                        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                            <div className="text-[11px] font-semibold text-neutral-600">Next eligible date</div>
                            <div className="mt-2 text-xl font-semibold text-neutral-900">
                                {stats?.nextPayoutAtMs ? new Date(stats.nextPayoutAtMs).toLocaleDateString() : "—"}
                            </div>
                            <div className="mt-1 text-xs text-neutral-500 flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5" />
                                From ledger eligibleAt
                            </div>
                        </div>
                    </section>

                    {/* NEW: de-identified subscriptions graph */}
                    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <div className="text-sm font-semibold text-neutral-900">Subscriptions over time</div>
                                <div className="mt-1 text-xs text-neutral-500">
                                    No member identifiers. One subscription start per referred customer.
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    value={range}
                                    onChange={(e) => setRange(e.target.value as RangeKey)}
                                    className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-800 shadow-sm"
                                >
                                    <option value="7d">Last 7 days</option>
                                    <option value="30d">Last 30 days</option>
                                    <option value="90d">Last 90 days</option>
                                    <option value="365d">Last 365 days</option>
                                    <option value="all">All time</option>
                                </select>

                                <select
                                    value={group}
                                    onChange={(e) => setGroup(e.target.value as GroupKey)}
                                    className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-800 shadow-sm"
                                >
                                    <option value="day">Daily</option>
                                    <option value="week">Weekly</option>
                                </select>

                                <select
                                    value={metric}
                                    onChange={(e) => setMetric(e.target.value as MetricKey)}
                                    className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-800 shadow-sm"
                                >
                                    <option value="total">All starts</option>
                                    <option value="active">Active starts</option>
                                    <option value="canceled">Canceled starts</option>
                                    <option value="refunded">Refunded starts</option>
                                </select>
                            </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-4">
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                                <div className="text-[11px] font-semibold text-neutral-600">Starts</div>
                                <div className="mt-1 text-lg font-semibold text-neutral-900">{chartSummary.total}</div>
                            </div>
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                                <div className="text-[11px] font-semibold text-neutral-600">Active</div>
                                <div className="mt-1 text-lg font-semibold text-neutral-900">{chartSummary.active}</div>
                            </div>
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                                <div className="text-[11px] font-semibold text-neutral-600">Canceled</div>
                                <div className="mt-1 text-lg font-semibold text-neutral-900">{chartSummary.canceled}</div>
                            </div>
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                                <div className="text-[11px] font-semibold text-neutral-600">Refunded</div>
                                <div className="mt-1 text-lg font-semibold text-neutral-900">{chartSummary.refunded}</div>
                            </div>
                        </div>

                        <div className="mt-4">
                            {chartBuckets.length === 0 ? (
                                <div className="text-sm text-neutral-600">No subscription starts in this range.</div>
                            ) : (
                                <div className="flex items-end gap-2 overflow-x-auto pb-2">
                                    {chartBuckets.map((b) => {
                                        const v =
                                            metric === "active"
                                                ? b.active
                                                : metric === "canceled"
                                                    ? b.canceled
                                                    : metric === "refunded"
                                                        ? b.refunded
                                                        : b.total;

                                        const height = (v / maxChartValue) * 140;

                                        const label =
                                            group === "week"
                                                ? `${b.key} (week)`
                                                : b.key;

                                        return (
                                            <div key={b.key} className="flex flex-col items-center gap-1">
                                                <div
                                                    className="w-6 rounded-t-md bg-accent"
                                                    style={{ height }}
                                                    title={`${label}: ${v}\nActive ${b.active} · Canceled ${b.canceled} · Refunded ${b.refunded}`}
                                                />
                                                <span className="text-[9px] text-neutral-500">
                                                    {group === "week" ? b.key.slice(5) : b.key.slice(5)}
                                                </span>
                                                <span className="text-[9px] text-neutral-700">{v}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
                        <div className="text-sm font-semibold text-neutral-900">Referral health</div>

                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                            <div className="text-sm text-neutral-600">
                                Status: <span className="font-semibold text-neutral-900">{affiliateHealthStatus}</span>
                            </div>
                            <div className="text-sm text-neutral-600">
                                Cancellations: <span className="font-semibold text-neutral-900">{stats?.canceledCount ?? 0}</span>
                            </div>
                            <div className="text-sm text-neutral-600">
                                Subscribed since: <span className="font-semibold text-neutral-900">{subscribedSinceLabel}</span>
                            </div>
                        </div>

                        <div className="mt-3 text-xs text-neutral-500">
                            Status is Stripe-first. Refunded/void invoices are treated as refunded, eligibility is removed for that payout, and the ledger entry is put on hold.
                        </div>
                    </section>
                </div>
            )}

            {view === "noCode" && (
                <div className="space-y-6">
                    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
                        <div className="text-sm font-semibold text-neutral-900">Affiliate benefits</div>

                        <div className="mt-3 space-y-3 text-sm text-neutral-600">
                            <div className="flex items-start gap-3">
                                <DollarSign className="h-4 w-4 mt-0.5 text-neutral-700" />
                                <div>Earn recurring commission on referrals that stay subscribed.</div>
                            </div>

                            <div className="flex items-start gap-3">
                                <BarChart3 className="h-4 w-4 mt-0.5 text-neutral-700" />
                                <div>Track pending commission and eligibility dates in your dashboard.</div>
                            </div>

                            <div className="flex items-start gap-3">
                                <Calendar className="h-4 w-4 mt-0.5 text-neutral-700" />
                                <div>Clear payout timing based on eligibility windows.</div>
                            </div>

                            <div className="flex items-start gap-3">
                                <ShieldCheck className="h-4 w-4 mt-0.5 text-neutral-700" />
                                <div>Fraud-resistant tracking designed for real customers.</div>
                            </div>
                        </div>

                        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                            <button
                                onClick={() => {
                                    setShowApply(true);
                                    scrollToForm();
                                }}
                                className="rounded-full bg-accent px-5 py-2.5 text-sm text-white"
                            >
                                Start application
                            </button>

                            <button
                                onClick={() => setShowApply(false)}
                                className="rounded-full border border-neutral-200 bg-white px-5 py-2.5 text-sm text-neutral-800"
                            >
                                Not now
                            </button>
                        </div>
                    </section>

                    {showApply && (
                        <section ref={formRef} className="rounded-2xl border border-neutral-200 bg-white p-6">
                            <div className="text-sm font-semibold text-neutral-900">Affiliate application</div>
                            <div className="mt-1 text-xs text-neutral-500">Basic onboarding. You can update details later.</div>

                            <form onSubmit={submitApplication} className="mt-5 space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="text-[11px] font-semibold text-neutral-700">Full name</label>
                                        <input
                                            name="fullName"
                                            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
                                            placeholder="Your name"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-semibold text-neutral-700">Email</label>
                                        <input
                                            name="email"
                                            type="email"
                                            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
                                            placeholder="you@domain.com"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-semibold text-neutral-700">Country</label>
                                        <input
                                            name="country"
                                            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
                                            placeholder="Canada"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-semibold text-neutral-700">Website</label>
                                        <input
                                            name="website"
                                            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
                                            placeholder="https://..."
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="text-[11px] font-semibold text-neutral-700">Primary channel</label>
                                        <select
                                            name="primaryChannel"
                                            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
                                            required
                                            defaultValue=""
                                        >
                                            <option value="" disabled>
                                                Select one
                                            </option>
                                            <option value="YouTube">YouTube</option>
                                            <option value="TikTok">TikTok</option>
                                            <option value="Instagram">Instagram</option>
                                            <option value="X">X</option>
                                            <option value="Newsletter">Newsletter</option>
                                            <option value="Blog">Blog</option>
                                            <option value="Community">Community</option>
                                            <option value="Other">Other</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-semibold text-neutral-700">Social handle or link</label>
                                        <input
                                            name="socialHandle"
                                            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
                                            placeholder="@handle or https://profile"
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="text-[11px] font-semibold text-neutral-700">Audience size</label>
                                        <input
                                            name="audienceSize"
                                            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
                                            placeholder="10k"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-semibold text-neutral-700">Payout email</label>
                                        <input
                                            name="payoutEmail"
                                            type="email"
                                            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
                                            placeholder="payouts@domain.com"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[11px] font-semibold text-neutral-700">What do you promote?</label>
                                    <input
                                        name="niche"
                                        className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
                                        placeholder="Web design, SaaS, indie hacking, marketing..."
                                    />
                                </div>

                                <div>
                                    <label className="text-[11px] font-semibold text-neutral-700">How will you promote Kloner?</label>
                                    <textarea
                                        name="promoPlan"
                                        className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
                                        rows={4}
                                        placeholder="A short plan: content type, cadence, placement, link strategy..."
                                        required
                                    />
                                </div>

                                <label className="flex items-start gap-2 text-xs text-neutral-600">
                                    <input name="agreed" type="checkbox" className="mt-0.5" required />
                                    <span>I agree to use honest disclosures and not mislead users.</span>
                                </label>

                                <button
                                    type="submit"
                                    disabled={applyBusy}
                                    className="rounded-full bg-accent px-5 py-2.5 text-sm text-white disabled:opacity-60"
                                >
                                    {applyBusy ? "Submitting…" : "Submit application"}
                                </button>
                            </form>
                        </section>
                    )}
                </div>
            )}
        </div>
    );
}
