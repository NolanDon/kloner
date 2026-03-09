// app/price/PriceClient.tsx (CLIENT)
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { useModal } from "@/components/ui/ModalContext";
import { useAuth } from "@/src/hooks/useAuth";
import { Check } from "lucide-react";

const ACCENT = "#f55f2a";
const AI_EDIT_CREDIT_COST = 3;

/* ───────── CSRF helper (reuse / centralize later) ───────── */

let csrfPromise: Promise<string | null> | null = null;

async function fetchCsrf(): Promise<string | null> {
    try {
        const res = await fetch("/api/auth/csrf", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            cache: "no-store",
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        return (data && data.csrf) || null;
    } catch {
        return null;
    }
}

async function ensureCsrf(): Promise<string | null> {
    if (!csrfPromise) csrfPromise = fetchCsrf();
    return csrfPromise;
}

/* ───────── Pricing config ───────── */

type Tier = {
    name: "Free" | "Pro" | "Agency";
    badge: string;
    price: string;
    period: string;
    highlight: boolean;
    blurb: string;
    topFeatures: string[];
    allFeatures: string[];
    cta: string;
    fineprint?: string;
};

const tiers: Tier[] = [
    {
        name: "Free",
        badge: "Try it",
        price: "$0",
        period: "/month",
        highlight: false,
        blurb: "Clone a few pages, test the workflow, learn the limits.",
        topFeatures: [
            "30 screenshot credits (3 site captures)",
            "60 preview credits (4 site generations)",
            "15 AI credits",
        ],
        allFeatures: [
            "Limited to 3 pages per generation",
            "Single user workspace",
            "Community-level email support",
        ],
        cta: "Start free",
        fineprint: "No card required.",
    },
    {
        name: "Pro",
        badge: "Most popular",
        price: "$29",
        period: "/month",
        highlight: true,
        blurb: "For shipping real client work fast without rebuilding from scratch.",
        topFeatures: [
            "100 screenshot credits (10 site captures)",
            "400 preview credits (15 site generations)",
            "AI editing support",
        ],
        allFeatures: [
            "300 monthly AI credits",
            "Up to 10 pages in every generation",
            "Access to AI editing",
            "Access to SEO generation tools",
            "Priority capture queue",
            "Multiple projects and workspaces",
            "Email support with faster response targets",
        ],
        cta: "Start 7-day free trial",
        fineprint: "Then $29/month. Cancel anytime. Secure checkout via Stripe.",
    },
    {
        name: "Agency",
        badge: "Scale",
        price: "$99",
        period: "/month",
        highlight: false,
        blurb: "For higher volume teams managing multiple projects and iterations.",
        topFeatures: [
            "400 screenshot credits (40 site captures)",
            "1500 preview credits (100 site generations)",
            "30 pages per generation + team seats",
        ],
        allFeatures: [
            "1200 monthly AI credits",
            "Up to 15 pages in every generation",
            "Team seats and client projects",
            "Change tracking and audit history",
            "Priority to new design tools",
            "Priority support",
        ],
        cta: "Subscribe to Agency",
        fineprint: "Starts immediately. Cancel anytime. Secure checkout via Stripe.",
    },
];

function Bullet({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex gap-2">
            <span
                className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: "rgba(245,95,42,0.10)" }}
                aria-hidden="true"
            >
                <Check className="h-3.5 w-3.5" style={{ color: ACCENT }} />
            </span>
            <span className="leading-5">{children}</span>
        </li>
    );
}

function clampPct(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, v));
}

export default function PriceClient(): JSX.Element {
    const TOPUP_COMING_SOON = false;
    const [loadingPlan, setLoadingPlan] = useState<null | "pro" | "agency">(null);
    const [loadingTopup, setLoadingTopup] = useState(false);
    const [topupCredits, setTopupCredits] = useState<number>(500);
    const [topupConfig, setTopupConfig] = useState<
        | {
              currency: string;
              unitPriceCents: number;
              minCredits: number;
              maxCredits: number;
              stepCredits: number;
          }
        | null
    >(null);
    const { showAlert } = useModal();
    const { user, userTier, loading: authLoading } = useAuth();

    const pendingAutoCheckoutAttemptedRef = useRef(false);

    const [aiCredits, setAiCredits] = useState<
        null | {
            remaining: number | null;
            monthlyLimit: number | null;
            bonusRemaining: number | null;
            periodEndMs: number | null;
        }
    >(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                if (typeof window === "undefined") return;

                const url = new URL(window.location.href);
                const topup = url.searchParams.get("topup");
                const sessionId = url.searchParams.get("session_id");

                if (topup !== "success" || !sessionId) return;
                if (authLoading) return;

                const csrf = await ensureCsrf();

                const res = await fetch("/api/billing/confirm-credit-topup", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    body: JSON.stringify({ sessionId }),
                });

                const data = (await res.json().catch(() => ({}))) as any;
                if (cancelled) return;

                if (res.ok) {
                    const credits = typeof data?.credits === "number" ? data.credits : null;
                    await showAlert(
                        credits ? `Added ${credits.toLocaleString()} AI credits to your account.` : "Top-up confirmed.",
                        "Credits added",
                    );
                } else {
                    console.warn("confirm-credit-topup failed", data);
                }

                // Clean up query params so refresh doesn't re-confirm.
                url.searchParams.delete("topup");
                url.searchParams.delete("session_id");
                window.history.replaceState({}, "", url.toString());
            } catch (e) {
                // ignore
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [authLoading, showAlert]);

    useEffect(() => {
        let cancelled = false;
        if (authLoading) return;

        void (async () => {
            try {
                const res = await fetch("/api/billing/tier", {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store",
                });
                const data = res.ok ? ((await res.json().catch(() => ({}))) as any) : null;
                if (cancelled) return;
                const bucket = data?.credits?.aiEdits ?? null;
                if (!bucket || typeof bucket !== "object") {
                    setAiCredits(null);
                    return;
                }
                setAiCredits({
                    remaining: typeof bucket.remaining === "number" ? bucket.remaining : null,
                    monthlyLimit: typeof bucket.monthlyLimit === "number" ? bucket.monthlyLimit : null,
                    bonusRemaining: typeof bucket.bonusRemaining === "number" ? bucket.bonusRemaining : null,
                    periodEndMs: typeof bucket.periodEndMs === "number" ? bucket.periodEndMs : null,
                });
            } catch {
                if (!cancelled) setAiCredits(null);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [authLoading]);

    // Intentionally no auto-checkout: billing flows are currently disabled.

    const creditsDisplay = useMemo(() => {
        const remaining = aiCredits?.remaining ?? null;
        const monthlyLimit = aiCredits?.monthlyLimit ?? null;
        const bonusRemaining = aiCredits?.bonusRemaining ?? null;

        if (remaining === null || monthlyLimit === null) {
            return {
                remainingLabel: remaining !== null ? remaining.toLocaleString() : "—",
                totalLabel: monthlyLimit !== null ? monthlyLimit.toLocaleString() : "—",
                pct: 0,
                showBar: false,
                hasBonus: false,
            };
        }

        const inferredBonus = remaining > monthlyLimit ? remaining - monthlyLimit : 0;
        const bonus = bonusRemaining !== null ? Math.max(0, bonusRemaining) : inferredBonus;
        const total = Math.max(1, monthlyLimit + bonus);
        const pct = clampPct((remaining / total) * 100);

        return {
            remainingLabel: remaining.toLocaleString(),
            totalLabel: total.toLocaleString(),
            pct,
            showBar: true,
            hasBonus: bonus > 0,
        };
    }, [aiCredits]);

    const periodEndLabel = useMemo(() => {
        const ms = aiCredits?.periodEndMs ?? null;
        if (!ms || !Number.isFinite(ms)) return null;
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return null;
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }, [aiCredits]);

    const planLabel = useMemo(() => {
        if (userTier === "pro") return "Pro";
        if (userTier === "agency") return "Agency";
        return "Free";
    }, [userTier]);

    const manageHref = useMemo(() => {
        if (!user) return "/login?next=%2Fprice";
        return "/dashboard/settings";
    }, [user]);

    const topupOptions = useMemo(() => {
        const cfg = topupConfig;
        const min = cfg?.minCredits ?? 50;
        const max = cfg?.maxCredits ?? 5000;

        const parseEnv = (raw: string | undefined): number[] => {
            const s = (raw || "").trim();
            if (!s) return [];
            const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
            const nums = parts
                .map((p) => Number.parseInt(p, 10))
                .filter((n) => Number.isFinite(n) && n > 0);
            return Array.from(new Set(nums)).sort((a, b) => a - b);
        };

        const override = parseEnv(process.env.NEXT_PUBLIC_AI_EDIT_TOPUP_OPTIONS);
        if (override.length) {
            const filtered = override.filter((n) => n >= min && n <= max);
            if (filtered.length) return filtered;
        }

        // Curated options (wide range, simple dropdown). Filter to config bounds.
        const base = [
            50,
            100,
            200,
            400,
            800,
            1200,
            2000,
            3000,
            4000,
            5000,
            7500,
            10000,
        ];

        const filtered = base.filter((n) => n >= min && n <= max);
        if (filtered.length) return filtered;

        // Fallback: generate a handful of stepped values.
        const step = cfg?.stepCredits ?? 50;
        const values: number[] = [];
        for (let v = min; v <= max && values.length < 20; v += Math.max(1, step)) values.push(v);
        return values.length ? values : [min];
    }, [topupConfig]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/billing/credit-topup-config", { cache: "no-store" });
                if (!res.ok) return;
                const data = (await res.json().catch(() => null)) as any;
                if (!data || cancelled) return;
                const unitPriceCents =
                    typeof data.unitPriceCents === "number" && Number.isFinite(data.unitPriceCents)
                        ? Math.max(1, Math.floor(data.unitPriceCents))
                        : 3;
                const minCredits =
                    typeof data.minCredits === "number" && Number.isFinite(data.minCredits)
                        ? Math.max(1, Math.floor(data.minCredits))
                        : 50;
                const maxCredits =
                    typeof data.maxCredits === "number" && Number.isFinite(data.maxCredits)
                        ? Math.max(minCredits, Math.floor(data.maxCredits))
                        : 5000;
                const stepCredits =
                    typeof data.stepCredits === "number" && Number.isFinite(data.stepCredits)
                        ? Math.max(1, Math.floor(data.stepCredits))
                        : 50;
                const currency = typeof data.currency === "string" ? data.currency : "usd";

                setTopupConfig({ currency, unitPriceCents, minCredits, maxCredits, stepCredits });

                setTopupCredits((prev) => {
                    const base = [50, 100, 200, 400, 800, 1200, 2000, 3000, 4000, 5000, 7500, 10000]
                        .filter((n) => n >= minCredits && n <= maxCredits);
                    const options = base.length ? base : [minCredits];

                    const clamped = Math.min(Math.max(prev, minCredits), maxCredits);
                    // Snap to the nearest available option.
                    let best = options[0]!;
                    let bestDist = Math.abs(best - clamped);
                    for (const n of options) {
                        const d = Math.abs(n - clamped);
                        if (d < bestDist) {
                            best = n;
                            bestDist = d;
                        }
                    }
                    return best;
                });
            } catch {
                // ignore
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    async function startCheckout(plan: "pro" | "agency") {
        if (loadingPlan) return;
        setLoadingPlan(plan);

        try {
            const csrf = await ensureCsrf();

            const res = await fetch("/api/billing/create-checkout-session", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                body: JSON.stringify({ plan }),
            });

            if (res.status === 401) {
                const next = encodeURIComponent("/price");
                window.location.href = `/login?next=${next}`;
                return;
            }

            const data = (await res.json().catch(() => ({}))) as {
                url?: string;
                error?: string;
            };

            if (!res.ok || !data.url) {
                console.error("Stripe checkout error", data?.error || res.statusText);
                await showAlert(data?.error || "Unable to start checkout. Please try again.", "Checkout Error");
                return;
            }

            window.location.href = data.url;
        } finally {
            setLoadingPlan(null);
        }
    }

    async function startTopup() {
        if (loadingTopup) return;
        setLoadingTopup(true);

        try {
            const csrf = await ensureCsrf();

            const res = await fetch("/api/billing/create-credit-topup-session", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                body: JSON.stringify({ credits: topupCredits, next: "/price#topup" }),
            });

            if (res.status === 401) {
                const next = encodeURIComponent("/price#topup");
                window.location.href = `/login?next=${next}`;
                return;
            }

            const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

            if (!res.ok || !data.url) {
                await showAlert(data?.error || "Unable to start top-up checkout. Please try again.", "Top Up Error");
                return;
            }

            window.location.href = data.url;
        } finally {
            setLoadingTopup(false);
        }
    }

    function handleClick(tierName: Tier["name"]) {
        if (tierName === "Pro") {
            void startCheckout("pro");
        } else if (tierName === "Agency") {
            void startCheckout("agency");
        } else {
            window.location.href = "/dashboard";
        }
    }

    return (
        <main className="min-h-screen bg-neutral-50 text-neutral-900">
            <NavBar />

            <div className="pt-28 pb-20 px-4">
                <section className="mx-auto max-w-6xl">
                    <header className="mb-10 max-w-3xl">
                        <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                            <span>Kloner · Pricing</span>
                        </div>

                        <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-7 sm:px-8 sm:py-9 shadow-sm">
                            <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                                Plans & credits
                            </h1>
                            <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                                Choose a plan, then top up AI credits any time you need extra runway.
                            </p>
                        </div>
                    </header>

                    <div className="mt-8 grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                        Your plan
                                    </p>
                                    <p className="mt-1 text-lg font-semibold text-neutral-900">
                                        You’re on {planLabel}
                                    </p>
                                    <p className="mt-1 text-[12px] text-neutral-600">
                                        Upgrade anytime. Cancel anytime.
                                    </p>
                                </div>

                                <a
                                    href={manageHref}
                                    className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                                >
                                    Manage
                                </a>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                                        AI credits
                                    </p>
                                    <p className="mt-1 text-lg font-semibold text-neutral-900">
                                        {creditsDisplay.remainingLabel} <span className="text-neutral-400">/</span>{" "}
                                        {creditsDisplay.totalLabel}
                                    </p>
                                    <p className="mt-1 text-[12px] text-neutral-600">
                                        Used for AI edits inside the builder. 1 AI edit = {AI_EDIT_CREDIT_COST} credits.
                                    </p>
                                </div>

                                <div className="inline-flex items-center gap-2">
                                    {TOPUP_COMING_SOON ? (
                                        <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800">
                                            Coming soon
                                        </span>
                                    ) : null}
                                    <a
                                        href="#topup"
                                        className="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-semibold text-white hover:brightness-95"
                                        style={{ backgroundColor: ACCENT }}
                                    >
                                        Details
                                    </a>
                                </div>
                            </div>

                            {creditsDisplay.showBar ? (
                                <div className="mt-4">
                                    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                                        <div
                                            className="h-full rounded-full"
                                            style={{ width: `${creditsDisplay.pct}%`, backgroundColor: ACCENT }}
                                        />
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-600">
                                        {periodEndLabel ? (
                                            <span className="inline-flex items-center gap-2">
                                                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT }} />
                                                Resets {periodEndLabel}
                                            </span>
                                        ) : null}
                                        {creditsDisplay.hasBonus ? (
                                            <span className="inline-flex items-center gap-2">
                                                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT }} />
                                                Includes top-ups
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-2">
                                                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT }} />
                                                No rollover
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-4 h-2 w-full rounded-full bg-neutral-100" />
                            )}
                        </div>
                    </div>

                    <div className="mt-10 grid gap-6 md:grid-cols-3">
                        {tiers.map((tier) => {
                            const isPro = tier.name === "Pro";
                            const isAgency = tier.name === "Agency";
                            const isLoading =
                                (isPro && loadingPlan === "pro") ||
                                (isAgency && loadingPlan === "agency");

                            return (
                                <article
                                    key={tier.name}
                                    className={
                                        "flex flex-col rounded-2xl border bg-white p-6 shadow-sm " +
                                        (tier.highlight
                                            ? "border-[rgba(245,95,42,0.45)] shadow-md"
                                            : "border-black/10")
                                    }
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h2 className="text-lg font-semibold tracking-tight">{tier.name}</h2>
                                            <p className="mt-1 text-xs text-neutral-600">{tier.blurb}</p>
                                        </div>

                                        <span
                                            className={
                                                "rounded-full px-2.5 py-1 text-[10px] whitespace-nowrap font-semibold uppercase tracking-wide " +
                                                (tier.highlight
                                                    ? "bg-[rgba(245,95,42,0.08)] text-[rgba(245,95,42,1)]"
                                                    : "bg-neutral-50 text-neutral-600")
                                            }
                                        >
                                            {tier.badge}
                                        </span>
                                    </div>

                                    <div className="mt-4 flex items-end justify-between gap-3">
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-3xl font-semibold">{tier.price}</span>
                                            <span className="text-xs text-neutral-500">{tier.period}</span>
                                        </div>

                                        {isPro ? (
                                            <span className="text-[11px] font-semibold text-neutral-900">
                                                7-day free trial
                                            </span>
                                        ) : null}
                                    </div>

                                    {tier.fineprint ? (
                                        <p className="mt-2 text-[11px] text-neutral-500">{tier.fineprint}</p>
                                    ) : null}

                                    <div className="mt-5">
                                        <p className="text-[11px] font-semibold text-neutral-900">What you get</p>

                                        <ul className="mt-2 space-y-1.5 text-xs text-neutral-700">
                                            {tier.topFeatures.map((f) => (
                                                <Bullet key={f}>{f}</Bullet>
                                            ))}
                                        </ul>

                                        <details className="mt-3">
                                            <summary className="cursor-pointer select-none text-[11px] font-semibold text-neutral-600 hover:text-neutral-900">
                                                See all limits
                                            </summary>
                                            <ul className="mt-2 space-y-1.5 text-xs text-neutral-700">
                                                {tier.allFeatures.map((f) => (
                                                    <Bullet key={f}>{f}</Bullet>
                                                ))}
                                            </ul>
                                        </details>
                                    </div>

                                    <div className="mt-6 flex-1" />

                                    <button
                                        type="button"
                                        onClick={() => handleClick(tier.name)}
                                        disabled={isLoading}
                                        className={
                                            "mt-2 w-full rounded-full px-4 py-2.5 text-sm font-semibold transition " +
                                            (tier.highlight
                                                ? "text-white"
                                                : "text-neutral-900 border border-neutral-300 bg-white hover:bg-neutral-50") +
                                            (isLoading ? " opacity-70 cursor-not-allowed" : "")
                                        }
                                        style={tier.highlight ? { backgroundColor: ACCENT } : undefined}
                                    >
                                        {isLoading ? "Redirecting to Stripe…" : tier.cta}
                                    </button>

                                    {isPro ? (
                                        <p className="mt-2 text-[11px] text-neutral-500">
                                            Trial starts today. Billing begins after 7 days unless canceled.
                                        </p>
                                    ) : isAgency ? (
                                        <p className="mt-2 text-[11px] text-neutral-500">
                                            Starts immediately. Cancel anytime.
                                        </p>
                                    ) : (
                                        <p className="mt-2 text-[11px] text-neutral-500">
                                            Start cloning immediately. Upgrade when you hit limits.
                                        </p>
                                    )}
                                </article>
                            );
                        })}
                    </div>

                    <div className="mx-auto mt-10 max-w-5xl rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm font-semibold text-neutral-900">
                                Minimal billing, secure checkout.
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-neutral-700 border border-black/10">
                                    Cancel anytime
                                </span>
                                <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-neutral-700 border border-black/10">
                                    Stripe-secured
                                </span>
                            </div>
                        </div>
                    </div>

                    <section
                        id="topup"
                        className="mx-auto mt-10 max-w-5xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm"
                    >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className="text-lg font-semibold tracking-tight">Top up AI credits</h2>
                                <p className="mt-1 text-[12px] text-neutral-600">One-time checkout. Credits apply after Stripe confirms.</p>
                            </div>

                            {TOPUP_COMING_SOON ? (
                                <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] font-semibold text-neutral-700">
                                    Coming soon
                                </span>
                            ) : null}

                            {userTier === "pro" || userTier === "agency" ? (
                                <span className="inline-flex items-center rounded-full border border-[rgba(245,95,42,0.35)] bg-white px-3 py-1 text-[11px] font-semibold text-[rgba(245,95,42,1)]">
                                    {userTier === "pro" ? "Pro" : "Agency"} detected
                                </span>
                            ) : null}
                        </div>

                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                                    Amount
                                </p>

                                <div className="mt-3">
                                    <label className="block text-[11px] font-semibold text-neutral-700">Credits</label>
                                    <select
                                        value={topupCredits}
                                        onChange={(e) => setTopupCredits(Number(e.target.value))}
                                        className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-black/5"
                                    >
                                        {topupOptions.map((n) => (
                                            <option key={n} value={n}>
                                                {n.toLocaleString()} credits
                                            </option>
                                        ))}
                                    </select>

                                    <p className="mt-2 text-[11px] text-neutral-600">
                                        ≈ {Math.max(1, Math.floor(topupCredits / AI_EDIT_CREDIT_COST)).toLocaleString()} AI edits
                                    </p>
                                </div>

                                <div className="mt-4">
                                    <ul className="space-y-2 text-[12px] text-neutral-700">
                                        <Bullet>Top-ups never expire</Bullet>
                                        <Bullet>Applied to your account immediately after Stripe confirms</Bullet>
                                    </ul>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                                    Total
                                </p>
                                <p className="mt-2 text-3xl font-semibold text-neutral-900">
                                    {topupConfig
                                        ? `$${((topupCredits * topupConfig.unitPriceCents) / 100).toFixed(2)}`
                                        : "—"}{" "}
                                    <span className="text-xs font-medium text-neutral-500">
                                        {topupConfig ? topupConfig.currency.toUpperCase() : ""}
                                    </span>
                                </p>

                                <div className="mt-5">
                                    <button
                                        type="button"
                                        disabled={
                                            loadingTopup ||
                                            authLoading ||
                                            TOPUP_COMING_SOON
                                        }
                                        onClick={() => void startTopup()}
                                        className={
                                            "w-full rounded-full px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-70 disabled:cursor-wait"
                                        }
                                        style={{ backgroundColor: ACCENT }}
                                    >
                                        {TOPUP_COMING_SOON ? "Coming soon" : loadingTopup ? "Redirecting to Stripe…" : "Top up credits"}
                                    </button>

                                    {user ? null : (
                                        <p className="mt-2 text-[11px] text-neutral-500">Sign in to purchase a top-up.</p>
                                    )}

                                </div>
                            </div>
                        </div>
                    </section>
                </section>
            </div>

            <div className="mx-auto max-w-6xl px-6 pb-10">
                <div className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-xs text-neutral-600">
                    <p className="font-semibold text-neutral-800">Helpful resources</p>
                    <p className="mt-1 leading-5">
                        Learn more about the underlying stack: {" "}
                        <a
                            className="text-neutral-700 hover:text-neutral-900 underline underline-offset-2"
                            href="https://nextjs.org/docs"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Next.js
                        </a>
                        {" · "}
                        <a
                            className="text-neutral-700 hover:text-neutral-900 underline underline-offset-2"
                            href="https://vercel.com/docs"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Vercel
                        </a>
                        {" · "}
                        <a
                            className="text-neutral-700 hover:text-neutral-900 underline underline-offset-2"
                            href="https://stripe.com/docs"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Stripe
                        </a>
                        .
                    </p>
                </div>
            </div>

            <Footer />
        </main>
    );
}
