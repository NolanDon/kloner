// app/price/PriceClient.tsx (CLIENT)
"use client";

import { useEffect, useState } from "react";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import BillingBanner from "@/components/BillingBanner";
import { AnimatedCreditCard } from "@/components/AnimatedCreditCard";
import { useModal } from "@/components/ui/ModalContext";
import { useAuth } from "@/src/hooks/useAuth";
import { useAppActivityHeartbeat } from "@/src/hooks/useAppActivityHeartbeat";
import { BASIC_MONTHLY_PRICE_USD, STRIPE_TRIAL_DAYS, TRIAL_CTA_LABEL } from "@/src/lib/billingAccess";
import { Loader2 } from "lucide-react";
import SuccessConfetti from "@/components/tools/SuccessConfetti";

const ACCENT = "#FF8D21";
const RECOVERY_PENDING_KEY_PREFIX = "kloner.billing.recovery.pending:";
const TRIAL_ENABLED = STRIPE_TRIAL_DAYS > 0;

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
    billedAs?: string;
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
        period: "/week",
        highlight: false,
        blurb: "No website generations. Copy community templates to get started.",
        topFeatures: [
            "30 screenshot credits (3 site captures /mo)",
            "No website generations",
            "15 AI credits",
        ],
        allFeatures: [
            "Copy templates from the community templates gallery",
            "Single user workspace",
            "Community-level email support",
        ],
        cta: "Start free",
        fineprint: "No card required. Community templates only.",
    },
    {
        name: "Pro",
        badge: "Most popular",
        price: "$4.99",
        period: "/week",
        billedAs: `Billed as $${BASIC_MONTHLY_PRICE_USD.toFixed(2)}/month`,
        highlight: true,
        blurb: "For shipping real client work fast without rebuilding from scratch.",
        topFeatures: [
            "100 screenshot credits (10 site captures /mo)",
            "400 preview credits (25 site generations /mo)",
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
        cta: TRIAL_CTA_LABEL,
        fineprint: TRIAL_ENABLED
            ? `Includes a 7-day free trial. Billed monthly at $${BASIC_MONTHLY_PRICE_USD.toFixed(2)}/month. Cancel anytime. Secure checkout via Stripe.`
            : `Billed immediately at $${BASIC_MONTHLY_PRICE_USD.toFixed(2)}/month. Cancel anytime. Secure checkout via Stripe.`,
    },
    {
        name: "Agency",
        badge: "Scale",
        price: "$1.90",
        period: "/week",
        billedAs: "Billed as $99/year",
        highlight: false,
        blurb: "For higher volume teams managing multiple projects and iterations.",
        topFeatures: [
            "400 screenshot credits (40 site captures /mo)",
            "1500 preview credits (100 site generations /mo)",
            "30 pages per generation + team seats",
        ],
        allFeatures: [
            "1200 monthly AI credits",
            "Up to 15 pages in every generation",
            "Team seats and client projects",
            "Change tracking and audit history",
            "Priority to new design tools",
            "24/7 Human support",
        ],
        cta: "Subscribe to Agency",
        fineprint: "Billed yearly at $99/year. Cancel anytime. Secure checkout via Stripe.",
    },
];

export default function PriceClient(): JSX.Element {
    const [loadingPlan, setLoadingPlan] = useState<null | "pro" | "agency">(null);
    const [topupSuccessCredits, setTopupSuccessCredits] = useState<number | null>(null);
    const { showAlert } = useModal();
    const { user, loading: authLoading } = useAuth();
    const PRICE_TOPUP_HANDLED_PREFIX = "kloner.price.topup.handled:";

    useAppActivityHeartbeat("price-page");

    function markRecoveryCheckoutPending() {
        if (typeof window === "undefined" || !user?.uid) return;
        try {
            window.sessionStorage.setItem(`${RECOVERY_PENDING_KEY_PREFIX}${user.uid}`, String(Date.now()));
        } catch {
            // ignore
        }
    }

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

                const handledKey = `${PRICE_TOPUP_HANDLED_PREFIX}${sessionId}`;
                const alreadyHandled = (() => {
                    try {
                        return window.sessionStorage.getItem(handledKey) === "1";
                    } catch {
                        return false;
                    }
                })();

                if (alreadyHandled) {
                    url.searchParams.delete("topup");
                    url.searchParams.delete("session_id");
                    window.history.replaceState({}, "", url.toString());
                    return;
                }

                try {
                    window.sessionStorage.setItem(handledKey, "1");
                } catch {
                    // ignore
                }

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
                    setTopupSuccessCredits(credits);
                } else {
                    console.warn("confirm-credit-topup failed", data);
                }

                // Clean up query params so refresh doesn't re-confirm.
                url.searchParams.delete("topup");
                url.searchParams.delete("session_id");
                window.history.replaceState({}, "", url.toString());
            } catch {
                // ignore
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [authLoading]);

    useEffect(() => {
        if (authLoading || !user) return;

        let cancelled = false;

        (async () => {
            try {
                if (typeof window === "undefined") return;

                const url = new URL(window.location.href);
                const billing = url.searchParams.get("billing");
                const recovery = url.searchParams.get("recovery");

                if (billing !== "cancelled" || recovery !== "1") return;

                const handledKey = `kloner.price.recovery.offer.sent:${user.uid}`;
                const alreadyHandled = (() => {
                    try {
                        return window.sessionStorage.getItem(handledKey) === "1";
                    } catch {
                        return false;
                    }
                })();

                if (alreadyHandled) {
                    url.searchParams.delete("billing");
                    url.searchParams.delete("recovery");
                    window.history.replaceState({}, "", url.toString());
                    return;
                }

                try {
                    window.sessionStorage.setItem(handledKey, "1");
                } catch {
                    // ignore
                }

                const csrf = await ensureCsrf();
                if (cancelled) return;

                await fetch("/api/billing/send-recovery-offer", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                }).catch(() => null);

                url.searchParams.delete("billing");
                url.searchParams.delete("recovery");
                window.history.replaceState({}, "", url.toString());
            } catch {
                // ignore
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [authLoading, user]);

    const checkoutOverlayVisible = loadingPlan !== null;

    async function startCheckout(plan: "pro" | "agency") {
        if (loadingPlan) return;
        setLoadingPlan(plan);

        try {
            markRecoveryCheckoutPending();
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

    function handleClick(tierName: Tier["name"]) {
        if (tierName === "Pro") {
            void startCheckout("pro");
        } else if (tierName === "Agency") {
            void startCheckout("agency");
        } else {
            window.location.href = "/login?mode=signup";
        }
    }

    return (
        <main className="min-h-screen bg-neutral-50 text-neutral-900">
            <SuccessConfetti
                open={topupSuccessCredits !== null}
                title="Credits added"
                message={topupSuccessCredits !== null
                    ? `Added ${topupSuccessCredits.toLocaleString()} AI credits to your account.`
                    : "Top-up confirmed."}
                onDismiss={() => setTopupSuccessCredits(null)}
            />

            {checkoutOverlayVisible ? (
                <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-3 rounded-3xl border border-white/10 bg-neutral-950/95 px-6 py-5 text-center text-white shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
                        <Loader2 className="h-6 w-6 animate-spin text-[#FF8D21]" />
                        <div>
                            <p className="text-sm font-semibold">Opening secure Stripe checkout...</p>
                            <p className="mt-1 text-xs text-neutral-300">Please wait while we prepare your session.</p>
                        </div>
                    </div>
                </div>
            ) : null}

            <NavBar />

            <div className="pt-28 pb-20 px-4">
                <section className="mx-auto max-w-6xl">
                    <header className="mb-10 max-w-3xl">
                        <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                            <span>Kloner · Pricing</span>
                        </div>

                        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(220px,294px)] lg:items-center lg:gap-8">
                            <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-7 shadow-sm sm:px-8 sm:py-9">
                                <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                                    Plans for every stage
                                </h1>
                                <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                                    Choose a plan, then top up AI credits any time you need extra runway.
                                </p>
                            </div>

                            <div className="flex justify-center lg:justify-end">
                                <AnimatedCreditCard />
                            </div>
                        </div>
                    </header>

                    <div className="mt-10 grid gap-6 md:grid-cols-3">
                        {tiers.map((tier) => {
                            const isPro = tier.name === "Pro";
                            const isAgency = tier.name === "Agency";
                            const isLoading =
                                (isPro && loadingPlan === "pro") ||
                                (isAgency && loadingPlan === "agency");
                            const rows = isPro
                                ? [
                                      { label: "Screenshot credits", value: "100 / month" },
                                      { label: "Preview credits", value: "450 / month" },
                                      { label: "AI credits", value: "300 / month" },
                                      { label: "Pages per build", value: "10" },
                                      { label: "Support", value: "Priority" },
                                  ]
                                : isAgency
                                    ? [
                                          { label: "Screenshot credits", value: "400 / month" },
                                          { label: "Preview credits", value: "1500 / month" },
                                          { label: "AI credits", value: "1200 / month" },
                                          { label: "Pages per build", value: "15" },
                                          { label: "Support", value: "Priority" },
                                      ]
                                    : [
                                          { label: "Screenshot credits", value: "30 / month" },
                                          { label: "Preview credits", value: "90 / month" },
                                          { label: "AI credits", value: "2 / month" },
                                          { label: "Pages per build", value: "0" },
                                          { label: "Support", value: "Community" },
                                      ];
                            const headerClass = isPro
                                ? "bg-gradient-to-r from-[#FF8D21] via-[#f5c78f] to-[#f8d8b0] text-white"
                                : isAgency
                                    ? "bg-gradient-to-r from-[#fff0e3] via-[#fff7f0] to-[#ffe0c6] text-neutral-900"
                                    : "bg-gradient-to-r from-[#fffaf6] via-[#fff2e8] to-[#fffaf3] text-neutral-900";
                            const headerBadgeClass = isPro
                                ? "border-white/20 bg-white/15 text-white"
                                : "border-neutral-200 bg-white/70 text-neutral-700";
                            const cardClass = isPro
                                ? "relative z-10 border-[rgba(255,141,33,0.35)] shadow-[0_22px_52px_rgba(255,141,33,0.14)] md:-translate-y-2 md:scale-[1.03]"
                                : "border-neutral-200 shadow-[0_16px_36px_rgba(15,23,42,0.07)]";
                            const buttonClass = isPro
                                ? "border border-[rgba(255,141,33,0.2)] bg-[#FF8D21] text-white shadow-[0_16px_30px_rgba(255,141,33,0.22)] hover:bg-[#D96E11]"
                                : isAgency
                                    ? "border border-[rgba(255,141,33,0.18)] bg-[#ffefe4] text-[#c86f1f] hover:bg-[#ffe3cf]"
                                    : "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50";

                            return (
                                <article
                                    key={tier.name}
                                    className={
                                        "overflow-hidden rounded-[30px] border bg-white transition-transform " + cardClass
                                    }
                                >
                                    <div className={"px-5 py-4 " + headerClass}>
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className={"text-[10px] font-semibold uppercase tracking-[0.22em] " + (isPro ? "text-white/85" : "text-neutral-500")}>
                                                    {tier.badge}
                                                </p>
                                                <h2 className={"mt-1 text-xl font-semibold tracking-tight " + (isPro ? "text-white" : "text-neutral-900")}>
                                                    {tier.name}
                                                </h2>
                                            </div>

                                            {isPro ? (
                                                <span className={"rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide " + headerBadgeClass}>
                                                    Recommended
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>

                                    <div className="px-5 py-5">
                                        <p className="text-sm text-neutral-600">{tier.blurb}</p>

                                        <div className="mt-4 flex items-end justify-between gap-3">
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-4xl font-semibold tracking-tight">{tier.price}</span>
                                                <span className="text-sm text-neutral-500">{tier.period}</span>
                                            </div>

                                            {isPro ? (
                                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(255,141,33,1)]">
                                                    {TRIAL_ENABLED ? "7-day free trial" : "Billed immediately"}
                                                </span>
                                            ) : null}
                                        </div>

                                        {tier.billedAs ? (
                                            <p className="mt-1 text-[11px] font-medium text-neutral-500">
                                                {tier.billedAs}
                                            </p>
                                        ) : null}

                                        <div className="mt-5 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50/80">
                                            {rows.map((row, index) => (
                                                <div
                                                    key={row.label}
                                                    className={
                                                        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 " +
                                                        (index < rows.length - 1 ? "border-b border-neutral-200" : "")
                                                    }
                                                >
                                                    <span className="text-[12px] text-neutral-600">{row.label}</span>
                                                    <span className={"text-[12px] font-semibold " + (isPro ? "text-neutral-900" : "text-neutral-800")}>
                                                        {row.value}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => handleClick(tier.name)}
                                            disabled={isLoading}
                                            className={"mt-5 w-full rounded-full px-4 py-3 text-sm font-semibold transition " + buttonClass + (isLoading ? " opacity-70 cursor-not-allowed" : "")}
                                            style={isPro ? { backgroundColor: ACCENT } : undefined}
                                        >
                                            {isLoading ? "Redirecting to Stripe…" : tier.cta}
                                        </button>

                                        <p className="mt-3 text-[11px] text-neutral-500">
                                            {isPro
                                                ? "Billed immediately. Cancel anytime."
                                                : isAgency
                                                    ? "Starts immediately. Cancel anytime."
                                                    : "Start cloning immediately. Upgrade when you hit limits."}
                                        </p>
                                    </div>
                                </article>
                            );
                        })}
                    </div>

                    <BillingBanner ctaHref="/topup" ctaLabel="Top up credits" />
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
