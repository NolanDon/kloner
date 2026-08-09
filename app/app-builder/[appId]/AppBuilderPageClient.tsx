"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useAppActivityHeartbeat } from "@/src/hooks/useAppActivityHeartbeat";
import AppBuilderEditor from "@/components/AppBuilderEditor";

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
}: {
    appId: string;
    initialAppData: InitialAppData;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialViewMode = searchParams.get("view") === "custom" ? "custom" : "ai";

    useAppActivityHeartbeat("app-builder");

    return (
        <AppBuilderEditor
            appId={appId}
            initialAppData={initialAppData as any}
            initialViewMode={initialViewMode}
            showTour={true}
            onClose={() => {
                router.push("/dashboard/view", { scroll: false });
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
