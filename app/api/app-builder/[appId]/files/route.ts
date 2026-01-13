// app/api/app-builder/[appId]/files/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    req: NextRequest,
    { params }: { params: { appId: string } }
) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();
        const appId = params.appId;

        const doc = await db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).get();
        if (!doc.exists) {
            return NextResponse.json({ error: "App not found" }, { status: 404 });
        }

        const data = doc.data();
        if (!data) {
            return NextResponse.json({ error: "App data not found" }, { status: 404 });
        }

        return NextResponse.json({
            id: appId,
            name: data.name,
            files: data.files || {},
            vercelProjectId: data.vercelProjectId,
            previewUrl: data.previewUrl,
        });
    });
}