import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { randomUUID } from "crypto";
import { getAdminAuth, getAdminDb } from "@/app/api/_lib/auth";
import { hydrateAppBuilderFiles } from "@/app/api/_lib/htmlStorage";
import AppBuilderPageClient from "./AppBuilderPageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FILES_HYDRATION_TIMEOUT_MS = 45_000;

async function hydrateFilesWithTimeout(params: {
    db: any;
    uid: string;
    appId: string;
    files: Record<string, any>;
    fileManifest?: any;
    fileStorageCollection?: string | null;
    fileStorageMode?: string | null;
    containerCode?: string | null;
    htmlStoragePath?: string | null;
    htmlEditIndex?: unknown;
}) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            hydrateAppBuilderFiles(params).then((files) => ({ files, timedOut: false as const })),
            new Promise<{ files: any; timedOut: true }>((resolve) => {
                timeoutId = setTimeout(() => {
                    resolve({
                        files: params.files,
                        timedOut: true,
                    });
                }, FILES_HYDRATION_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function toPlainClientValue<T>(value: T): T {
    if (value == null) return value;
    if (typeof value !== "object") return value;
    if (value instanceof Date) return value.toISOString() as T;
    if (Array.isArray(value)) return value.map((item) => toPlainClientValue(item)) as T;

    const result: Record<string, unknown> = {};
    for (const [key, nextValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof nextValue === "undefined") continue;
        result[key] = toPlainClientValue(nextValue);
    }
    return result as T;
}

export default async function AppBuilderPage({ params }: { params: Promise<{ appId: string }> }) {
    const resolvedParams = await Promise.resolve(params);
    const appId = String(resolvedParams?.appId || "").trim();
    if (!appId) notFound();

    const cookieStore = await Promise.resolve(cookies());
    const sessionCookie = cookieStore.get("__session")?.value;
    if (!sessionCookie) redirect("/login");

    let uid = "";
    try {
        const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
        uid = String(decoded?.uid || "").trim();
    } catch {
        redirect("/login");
    }

    if (!uid) redirect("/login");

    const db = getAdminDb();
    const requestId = typeof randomUUID === "function" ? randomUUID() : String(Date.now());
    const appSnap = await db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).get();
    if (!appSnap.exists) notFound();

    const data = appSnap.data() || {};
    const startedAt = Date.now();
    console.info("[app-builder/page] file hydration start", {
        requestId,
        uid,
        appId,
        fileCount: Object.keys((data.files || {}) as Record<string, unknown>).length,
        hasManifest: Boolean((data as any).fileManifest),
        htmlStoragePath: Boolean((data as any).htmlStoragePath),
    });
    const hydrationResult = await hydrateFilesWithTimeout({
        db,
        uid,
        appId,
        files: (data.files || {}) as any,
        fileManifest: (data as any).fileManifest || null,
        fileStorageCollection: typeof (data as any).fileStorageCollection === "string" ? (data as any).fileStorageCollection : null,
        fileStorageMode: typeof (data as any).fileStorageMode === "string" ? (data as any).fileStorageMode : null,
        containerCode: typeof (data as any).containerCode === "string" ? (data as any).containerCode : null,
        htmlStoragePath: (data as any).htmlStoragePath || null,
        htmlEditIndex: (data as any).htmlEditIndex,
    });
    const elapsedMs = Date.now() - startedAt;
    if (hydrationResult.timedOut) {
        console.warn("[app-builder/page] file hydration timed out; rendering raw files", {
            requestId,
            uid,
            appId,
            elapsedMs,
            timeoutMs: FILES_HYDRATION_TIMEOUT_MS,
        });
    } else {
        console.info("[app-builder/page] file hydration complete", {
            requestId,
            uid,
            appId,
            elapsedMs,
        });
    }
    const files = hydrationResult.files;

    const initialAppData = toPlainClientValue({
        id: appId,
        name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Untitled Project",
        files,
        fileManifest: (data as any).fileManifest || null,
        fileStorageCollection: (data as any).fileStorageCollection || null,
        fileStorageMode: (data as any).fileStorageMode || null,
        containerCode: (data as any).containerCode || null,
        containerCodeTimestamp: typeof (data as any).containerCodeTimestamp === "number" ? (data as any).containerCodeTimestamp : null,
        htmlStoragePath: (data as any).htmlStoragePath || null,
        htmlByteLength: typeof (data as any).htmlByteLength === "number" ? (data as any).htmlByteLength : null,
        htmlEditIndex: (data as any).htmlEditIndex || null,
        generationStatus: (data as any).generationStatus || null,
        generationError: (data as any).generationError || null,
        generationProgress: typeof (data as any).generationProgress === "number"
            ? (data as any).generationProgress
            : typeof (data as any).progress === "number"
                ? (data as any).progress
                : null,
        generation: (data as any).generation || null,
        isDeployed: Boolean((data as any).isDeployed),
        productionUrl: (data as any).productionUrl || null,
        previewUrl: (data as any).previewUrl || null,
        vercelProjectId: (data as any).vercelProjectId || undefined,
        vercelProtectionBypassSecret: (data as any).vercelProtectionBypassSecret || null,
        lastDeploymentId: (data as any).lastDeploymentId || null,
        lastDeploymentState: (data as any).lastDeploymentState || null,
        lastDeploymentErrorCode: (data as any).lastDeploymentErrorCode || null,
        lastDeploymentErrorMessage: (data as any).lastDeploymentErrorMessage || null,
        lastDeploymentErrorAt: (data as any).lastDeploymentErrorAt || null,
        lastDeploymentUrl: (data as any).lastDeploymentUrl || null,
        updatedAt: (data as any).updatedAt || null,
    });

    return <AppBuilderPageClient appId={appId} initialAppData={initialAppData} />;
}
