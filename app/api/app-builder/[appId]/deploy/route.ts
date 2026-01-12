// app/api/app-builder/[appId]/deploy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
    req: NextRequest,
    { params }: { params: { appId: string } }
) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();
        const appId = params.appId;

        const docRef = db.collection("user_apps").doc(appId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return NextResponse.json({ error: "App not found" }, { status: 404 });
        }

        const data = doc.data();
        if (data?.userId !== uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        // TODO: Integrate with Vercel API for real deployment
        // For MVP, simulate deployment
        const previewUrl = `https://preview.vercel.app/${appId}`;

        await docRef.update({
            previewUrl,
            updatedAt: new Date(),
        });

        return NextResponse.json({ previewUrl });
    });
}