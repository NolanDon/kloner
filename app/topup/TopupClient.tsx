"use client";

import { useEffect, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import CreditTopupReturnHandler from "@/components/CreditTopupReturnHandler";
import BillingBanner from "@/components/BillingBanner";
import { useAuth } from "@/src/hooks/useAuth";
import { useModal } from "@/components/ui/ModalContext";
import { Check, Loader2 } from "lucide-react";

const ACCENT = "#FF8D21";
const AI_EDIT_CREDIT_COST = 3;
type TopupPreset = {
    id: "popular" | "starter" | "boost";
    label: string;
    badge: string;
    credits: number;
    priceId: string | null;
    priceEnvKey: string;
    amountCents: number;
    available: boolean;
};

type TopupCatalog = {
    currency: string;
    unitPriceCents: number;
    minCredits: number;
    maxCredits: number;
    stepCredits: number;
    presets: TopupPreset[];
};

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
        return (data && (data as any).csrf) || null;
    } catch {
        return null;
    }
}

async function ensureCsrf(): Promise<string | null> {
    if (!csrfPromise) csrfPromise = fetchCsrf();
    return csrfPromise;
}

function Bullet({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex gap-2">
            <span
                className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: "rgba(255,141,33,0.10)" }}
                aria-hidden="true"
            >
                <Check className="h-3.5 w-3.5" style={{ color: ACCENT }} />
            </span>
            <span className="leading-5">{children}</span>
        </li>
    );
}

export default function TopupClient(): JSX.Element {
    const { user, loading: authLoading } = useAuth();
    const { showAlert } = useModal();

    const [selectedTopupId, setSelectedTopupId] = useState<string>("popular");
    const [customCredits, setCustomCredits] = useState<number>(500);
    const [loadingTopup, setLoadingTopup] = useState(false);
    const [topupConfig, setTopupConfig] = useState<TopupCatalog | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/billing/credit-topup-config", { cache: "no-store" });
                if (!res.ok) return;
                const data = (await res.json().catch(() => null)) as TopupCatalog | null;
                if (!data || cancelled) return;
                setTopupConfig(data);

                const minCredits = Math.max(1, Math.floor(data.minCredits || 50));
                const maxCredits = Math.max(minCredits, Math.floor(data.maxCredits || 5000));
                setCustomCredits((prev) => Math.min(Math.max(prev, minCredits), maxCredits));
            } catch {
                // ignore
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const presets = useMemo(() => {
        const items = topupConfig?.presets || [];
        return [...items].sort((a, b) => {
            if (a.id === "popular") return -1;
            if (b.id === "popular") return 1;
            return a.credits - b.credits;
        });
    }, [topupConfig]);

    const selectedPreset = useMemo(
        () => (selectedTopupId === "custom" ? null : presets.find((preset) => preset.id === selectedTopupId) || null),
        [presets, selectedTopupId],
    );

    const selectedCredits = selectedPreset?.credits ?? customCredits;
    const selectedAmountCents = selectedPreset ? selectedPreset.amountCents : Math.max(1, selectedCredits) * (topupConfig?.unitPriceCents ?? 10);
    const selectedEdits = Math.max(1, Math.floor(selectedCredits / AI_EDIT_CREDIT_COST));
    const checkoutOverlayVisible = loadingTopup;

    const topupChoices = useMemo(
        () => [
            ...presets.map((preset) => ({
                value: preset.id,
                label: `${preset.credits.toLocaleString()} credits`,
                sublabel: preset.badge,
                disabled: !preset.available,
            })),
            {
                value: "custom",
                label: "Custom amount",
                sublabel: "Pick your own credits",
                disabled: false,
            },
        ],
        [presets],
    );

    async function startCheckout(args: { presetId?: string; credits?: number }) {
        if (loadingTopup) return;

        const presetId = typeof args.presetId === "string" ? args.presetId : null;
        const credits = typeof args.credits === "number" ? Math.max(1, Math.floor(args.credits)) : null;
        if (!presetId && !credits) return;

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
                body: JSON.stringify({ ...(presetId ? { presetId } : { credits }), next: "/topup" }),
            });

            if (res.status === 401) {
                const next = encodeURIComponent("/topup");
                window.location.href = `/login?next=${next}`;
                return;
            }

            const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

            if (!res.ok || !data.url) {
                await showAlert(data?.error || "Unable to start checkout. Please try again.", "Checkout Error");
                return;
            }

            window.location.href = data.url;
        } finally {
            setLoadingTopup(false);
        }
    }

    return (
        <main className="min-h-screen bg-neutral-50 text-neutral-900">
            <CreditTopupReturnHandler />

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

            <div className="px-4 pb-20 pt-28">
                <section className="mx-auto max-w-6xl">
                    <header className="mb-10 max-w-3xl">
                        <div className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-[11px] text-neutral-50 mb-4">
                            <span>Kloner · Top up</span>
                        </div>

                        <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-7 shadow-sm sm:px-8 sm:py-9">
                            <h1 className="text-3xl tracking-tight text-neutral-900 sm:text-4xl">
                                Top up AI credits
                            </h1>
                            <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                                One-time checkout. Credits apply after Stripe confirms. Choose a preset or pick a custom amount.
                            </p>
                        </div>
                    </header>

                    <section className="mx-auto max-w-4xl rounded-[30px] border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                            <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-5">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                                    Amount
                                </p>
                                <h2 className="mt-1 text-lg font-semibold tracking-tight text-neutral-900">
                                    Choose a top-up amount
                                </h2>

                                {topupChoices.length ? (
                                    <div className="mt-4">
                                        <label className="block text-[11px] font-semibold text-neutral-700">Top up amount</label>
                                        <select
                                            value={selectedTopupId}
                                            onChange={(e) => setSelectedTopupId(e.target.value)}
                                            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-black/5"
                                        >
                                            {topupChoices.map((choice) => (
                                                <option key={choice.value} value={choice.value} disabled={choice.disabled}>
                                                    {choice.label}{choice.sublabel ? ` · ${choice.sublabel}` : ""}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ) : null}

                                {selectedTopupId === "custom" ? (
                                    <div className="mt-4">
                                        <label className="block text-[11px] font-semibold text-neutral-700">Custom credits</label>
                                        <input
                                            type="number"
                                            min={topupConfig?.minCredits ?? 50}
                                            max={topupConfig?.maxCredits ?? 5000}
                                            step={topupConfig?.stepCredits ?? 50}
                                            value={customCredits}
                                            onChange={(e) => setCustomCredits(Number(e.target.value))}
                                            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-black/5"
                                        />
                                        <p className="mt-2 text-[11px] text-neutral-600">
                                            Pick between {topupConfig?.minCredits ?? 50} and {topupConfig?.maxCredits ?? 5000} credits.
                                        </p>
                                    </div>
                                ) : null}

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
                                    ${((selectedAmountCents || 0) / 100).toFixed(2)}{" "}
                                    <span className="text-xs font-medium text-neutral-500">
                                        {topupConfig ? topupConfig.currency.toUpperCase() : "USD"}
                                    </span>
                                </p>

                                <p className="mt-3 text-sm text-neutral-600">
                                    {selectedCredits.toLocaleString()} credits, about {selectedEdits.toLocaleString()} AI edits.
                                </p>

                                <button
                                    type="button"
                                    disabled={loadingTopup || authLoading || (selectedPreset !== null && !selectedPreset.available)}
                                    onClick={() => void startCheckout(
                                        selectedPreset ? { presetId: selectedPreset.id } : { credits: customCredits }
                                    )}
                                    className="mt-5 w-full rounded-full px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
                                    style={{ backgroundColor: ACCENT }}
                                >
                                    {loadingTopup ? "Redirecting to Stripe…" : "Top up credits"}
                                </button>

                                {selectedPreset && !selectedPreset.available ? (
                                    <p className="mt-2 text-[11px] text-amber-700">
                                        Stripe price is missing for this amount. Check the env vars below.
                                    </p>
                                ) : null}

                                {user ? null : (
                                    <p className="mt-2 text-[11px] text-neutral-500">Sign in to purchase a top-up.</p>
                                )}
                            </div>
                        </div>
                    </section>

                    {presets.some((preset) => !preset.available) ? (
                        <div className="mx-auto mt-5 max-w-4xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            Missing Stripe price IDs for: {presets.filter((preset) => !preset.available).map((preset) => preset.label).join(", ")}.
                            The dropdown falls back to custom amount until you paste the env vars into Vercel.
                        </div>
                    ) : null}

                    <BillingBanner ctaHref="/price" ctaLabel="View pricing" />
                </section>
            </div>

            <Footer />
        </main>
    );
}
