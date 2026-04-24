// app/api/app-builder/[appId]/files/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { issueAppBuilderScopeCookie } from "../../../_lib/appBuilderScope";
import { hydrateAppBuilderFiles } from "../../../_lib/htmlStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    req: NextRequest,
    { params }: any
) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();
        const appId = (await Promise.resolve(params))?.appId;

        const doc = await db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).get();
        if (!doc.exists) {
            return NextResponse.json({ error: "App not found" }, { status: 404 });
        }

        const data = doc.data();
        if (!data) {
            return NextResponse.json({ error: "App data not found" }, { status: 404 });
        }

        const files = await hydrateAppBuilderFiles({
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

        const res = NextResponse.json({
            id: appId,
            name: data.name,
            files,
            fileManifest: (data as any).fileManifest || null,
            fileStorageCollection: (data as any).fileStorageCollection || null,
            fileStorageMode: (data as any).fileStorageMode || null,
            containerCode: (data as any).containerCode || null,
            containerCodeTimestamp:
                typeof (data as any).containerCodeTimestamp === "number" ? (data as any).containerCodeTimestamp : null,
            vercelProjectId: data.vercelProjectId,
            previewUrl: data.previewUrl,
            isDeployed: Boolean((data as any).isDeployed),
            productionUrl: (data as any).productionUrl || null,
            vercelProtectionBypassSecret: (data as any).vercelProtectionBypassSecret || null,
            htmlStoragePath: (data as any).htmlStoragePath || null,
            htmlByteLength: typeof (data as any).htmlByteLength === "number" ? (data as any).htmlByteLength : null,
            htmlEditIndex: (data as any).htmlEditIndex || null,
            generationStatus: (data as any).generationStatus || null,
            generationError: (data as any).generationError || null,
            generationProgress:
                typeof (data as any).generationProgress === "number"
                    ? (data as any).generationProgress
                    : typeof (data as any).progress === "number"
                      ? (data as any).progress
                      : null,
        });

        // Bind the browser session to this specific appId for all follow-up writes.
        issueAppBuilderScopeCookie(res, uid, appId);

        return res;
    });
}