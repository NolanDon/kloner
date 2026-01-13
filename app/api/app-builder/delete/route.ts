import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();

        const body = await req.json();
        const { appId } = body;

        if (!appId || typeof appId !== "string") {
            return NextResponse.json({ error: "App ID required" }, { status: 400 });
        }

        try {
            // Delete the app document from Firestore
            await db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).delete();

            return NextResponse.json({ success: true });
        } catch (error) {
            console.error("Failed to delete app:", error);
            return NextResponse.json({ error: "Failed to delete app" }, { status: 500 });
        }
    });
}
