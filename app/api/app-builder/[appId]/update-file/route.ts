// app/api/app-builder/[appId]/update-file/route.ts
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

        const body = await req.json();
        const { path, content } = body;

        if (!path || typeof content !== "string") {
            return NextResponse.json({ error: "Invalid request" }, { status: 400 });
        }

        const docRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return NextResponse.json({ error: "App not found" }, { status: 404 });
        }

        const data = doc.data();
        if (!data) {
            return NextResponse.json({ error: "App data not found" }, { status: 404 });
        }

        const files = data?.files || {};
        files[path] = { content, lastModified: Date.now() };

        await docRef.update({
            files,
            updatedAt: new Date(),
        });

        return NextResponse.json({ success: true });
    });
}