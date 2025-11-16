// app/price/page.tsx
"use client";

import { useState } from "react";
import NavBar from "@/components/NavBar";

const ACCENT = "#f55f2a";

const tiers = [
    {
        name: "Free",
        badge: "Get started",
        price: "$0",
        period: "/month",
        highlight: false,
        blurb: "Experiment with cloning and previews on a small scale.",
        features: [
            "Limited previews and screenshots per day",
            "Single user workspace",
            "Basic URL history",
            "Community-level email support",
        ],
        cta: "Start for free",
    },
    {
        name: "Pro",
        badge: "Most popular",
        price: "$29",
        period: "/month",
        highlight: true,
        blurb: "For freelancers and small teams running live projects.",
        features: [
            "Higher daily preview and screenshot limits",
            "Priority capture queue",
            "Multiple projects and workspaces",
            "Email support with faster response targets",
        ],
        cta: "Upgrade with Stripe",
    },
    {
        name: "Agency",
        badge: "Scale",
        price: "$99",
        period: "/month",
        highlight: false,
        blurb: "For agencies managing many clients and active deployments.",
        features: [
            "Generous monthly usage pool for previews and screenshots",
            "Team seats and client projects",
            "Change tracking and audit history",
            "Priority support and onboarding call",
        ],
        cta: "Talk to sales",
    },
];

export default function PricingPage(): JSX.Element {
    const [loadingPlan, setLoadingPlan] = useState<null | "pro" | "agency">(null);

    async function startCheckout(plan: "pro" | "agency") {
        if (loadingPlan) return;
        setLoadingPlan(plan);

        try {
            const res = await fetch("/api/billing/create-checkout-session", {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ plan }),
            });

            if (res.status === 401) {
                const next = encodeURIComponent("/price");
                window.location.href = `/login?next=${next}`;
                return;
            }

            const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

            if (!res.ok || !data.url) {
                console.error("Stripe checkout error", data?.error || res.statusText);
                alert(data?.error || "Unable to start checkout. Please try again.");
                return;
            }

            window.location.href = data.url;
        } finally {
            setLoadingPlan(null);
        }
    }

    function handleClick(tierName: string) {
        if (tierName === "Pro") {
            void startCheckout("pro");
        } else if (tierName === "Agency") {
            void startCheckout("agency");
        } else {
            // Free – send to dashboard or signup; adjust if you want different behaviour
            window.location.href = "/dashboard";
        }
    }

    return (
        <main className="min-h-screen bg-white text-neutral-900">
            <NavBar />
            <div className="pt-28 pb-20 px-4">
                <section className="mx-auto max-w-5xl">
                    <header className="max-w-3xl">
                        <span
                            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide"
                            style={{ backgroundColor: "#fef3e7", color: ACCENT }}
                        >
                            Pricing
                        </span>
                        <h1 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight">
                            Simple plans, clear limits, no surprises.
                        </h1>
                        <p className="mt-3 text-sm sm:text-base text-neutral-600">
                            Kloner uses a credit system tied to your plan. Each preview or
                            screenshot consumes a small number of credits. Free users get a
                            limited amount to experiment. Paid plans unlock higher limits and
                            features suited for real client work.
                        </p>
                        <p className="mt-2 text-xs text-neutral-500">
                            All paid payments are processed securely by Stripe. You will be
                            able to upgrade or cancel at any time from your account settings.
                        </p>
                    </header>

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
                                            ? "border-[rgba(245,95,42,0.6)] shadow-md"
                                            : "border-black/10")
                                    }
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h2 className="text-lg font-semibold tracking-tight">
                                                {tier.name}
                                            </h2>
                                            <p className="mt-1 text-xs text-neutral-600">
                                                {tier.blurb}
                                            </p>
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

                                    <div className="mt-4 flex items-baseline gap-1">
                                        <span className="text-2xl font-semibold">{tier.price}</span>
                                        <span className="text-xs text-neutral-500">
                                            {tier.period}
                                        </span>
                                    </div>

                                    <ul className="mt-4 space-y-1.5 text-xs text-neutral-700">
                                        {tier.features.map((f) => (
                                            <li key={f} className="flex gap-2">
                                                <span
                                                    className="mt-[5px] h-1.5 w-1.5 rounded-full"
                                                    style={{ backgroundColor: ACCENT }}
                                                />
                                                <span>{f}</span>
                                            </li>
                                        ))}
                                    </ul>

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
                                            (isLoading ? " opacity-70 cursor-wait" : "")
                                        }
                                        style={
                                            tier.highlight
                                                ? { backgroundColor: ACCENT }
                                                : undefined
                                        }
                                    >
                                        {isLoading
                                            ? "Redirecting to Stripe…"
                                            : tier.cta}
                                    </button>

                                    {tier.name === "Pro" && (
                                        <p className="mt-2 text-[11px] text-neutral-500">
                                            This button opens a secure Stripe Checkout session.
                                            Card details are handled by Stripe, not Kloner.
                                        </p>
                                    )}

                                    {tier.name === "Free" && (
                                        <p className="mt-2 text-[11px] text-neutral-500">
                                            Ideal for testing a few URLs and understanding how the
                                            preview and credit system work before upgrading.
                                        </p>
                                    )}

                                    {tier.name === "Agency" && (
                                        <p className="mt-2 text-[11px] text-neutral-500">
                                            For higher volumes or custom terms, you can start with
                                            Stripe checkout now and adjust with the founder later if
                                            you need a tailored agreement.
                                        </p>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </section>
            </div>
        </main>
    );
}
