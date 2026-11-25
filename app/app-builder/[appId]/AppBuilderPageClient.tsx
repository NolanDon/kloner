"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppActivityHeartbeat } from "@/src/hooks/useAppActivityHeartbeat";
import AppBuilderEditor from "@/components/AppBuilderEditorRouted";
import { isDashboardProjectAccessLocked } from "@/app/dashboard/view/subscriptionAccess";
import type { UserTier } from "@/src/lib/credits";

type BillingState = "free" | "active" | "trialing" | "trial_cancelled";

function normalizeBillingState(value: unknown): BillingState {
    const state = String(value || "").trim().toLowerCase();
    return state === "active" || state === "trialing" || state === "trial_cancelled" ? state : "free";
}

function normalizeTier(value: unknown): UserTier {
    const tier = String(value || "").trim().toLowerCase();
    return tier === "pro" || tier === "agency" || tier === "enterprise" ? tier : "free";
}

type InitialAppData = {
    id: string;
    name: string;
    files: Record<string, { content: string; lastModified: number }>;
    fileManifest?: unknown;
    fileStorageCollection?: string | null;
    fileStorageMode?: string | null;
    containerCode?: string | null;
    containerCodeTimestamp?: number | null;
    htmlStoragePath?: string | null;
    htmlByteLength?: number | null;
    htmlEditIndex?: unknown;
    generationStatus?: string | null;
    generationError?: string | null;
    generationProgress?: number | null;
    generation?: any;
    isDeployed?: boolean;
    productionUrl?: string | null;
    previewUrl?: string | null;
    vercelProjectId?: string;
    vercelProtectionBypassSecret?: string | null;
    lastDeploymentId?: string | null;
    lastDeploymentState?: string | null;
    lastDeploymentErrorCode?: string | null;
    lastDeploymentErrorMessage?: string | null;
    lastDeploymentErrorAt?: unknown;
    lastDeploymentUrl?: string | null;
    updatedAt?: unknown;
};

export default function AppBuilderPageClient({
    appId,
    initialAppData,
    deployLocked,
}: {
    appId: string;
    initialAppData: InitialAppData;
    deployLocked: boolean;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialViewMode = searchParams.get("view") === "custom" ? "custom" : "ai";
    const [billingAccess, setBillingAccess] = useState<{
        loading: boolean;
        tier: UserTier;
        state: BillingState;
        hasSubscriptionHistory: boolean;
        locked: boolean;
    }>({ loading: true, tier: "free", state: "free", hasSubscriptionHistory: false, locked: false });

    useAppActivityHeartbeat("app-builder");

    useEffect(() => {
        let cancelled = false;

        void fetch("/api/billing/tier", {
            method: "GET",
            credentials: "include",
            cache: "no-store",
        }).then(async (response) => {
            if (!response.ok) throw new Error("Unable to load subscription access.");
            const data = await response.json().catch(() => ({}));
            if (cancelled) return;

            const state = normalizeBillingState(data?.billingState);
            const status = typeof data?.stripeStatus === "string" ? data.stripeStatus : null;
            setBillingAccess({
                loading: false,
                tier: normalizeTier(data?.tier),
                state,
                hasSubscriptionHistory: data?.hasSubscriptionHistory === true,
                locked: isDashboardProjectAccessLocked({
                    billingState: state,
                    stripeStatus: status,
                    cancelAtPeriodEnd: data?.cancelAtPeriodEnd === true,
                }),
            });
        }).catch(() => {
            if (cancelled) return;
            // Keep the editor unblocked while the authoritative billing lookup
            // is unavailable. Server actions still enforce subscription access.
            setBillingAccess((current) => ({ ...current, loading: true }));
        });

        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <AppBuilderEditor
            appId={appId}
            initialAppData={initialAppData as any}
            initialViewMode={initialViewMode}
            deployLocked={deployLocked}
            billingAccessLoading={billingAccess.loading}
            billingTier={billingAccess.tier}
            billingState={billingAccess.state}
            hasSubscriptionHistory={billingAccess.hasSubscriptionHistory}
            accessLocked={billingAccess.locked}
            showTour={true}
            onClose={() => {
                router.push("/dashboard/view", { scroll: false });
            }}
            onDeploy={(app) => {
                router.push(
                    `/dashboard/view?appDeploy=1&appId=${encodeURIComponent(app.id)}&appName=${encodeURIComponent(app.name)}`,
                    { scroll: false },
                );
            }}
            onCanonicalAppIdResolved={(canonicalAppId) => {
                const next = String(canonicalAppId || "").trim();
                if (!next || next === appId) return;
                const qs = new URLSearchParams(searchParams.toString());
                const query = qs.toString();
                router.replace(
                    query ? `/app-builder/${encodeURIComponent(next)}?${query}` : `/app-builder/${encodeURIComponent(next)}`,
                    { scroll: false },
                );
            }}
        />
    );
}
