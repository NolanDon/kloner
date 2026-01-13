// app/api/app-builder/[appId]/rename/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";

export async function POST(
    request: NextRequest,
    { params }: { params: { appId: string } }
) {
    return requireSessionAndMaybeCsrf(request, async ({ uid }) => {
        const db = getAdminDb();
        const appId = params.appId;

        const { name } = await request.json();

        if (!name || typeof name !== "string" || name.trim().length === 0) {
            return NextResponse.json({ error: "Invalid name" }, { status: 400 });
        }

        // Check if the app belongs to the user
        const appRef = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return NextResponse.json({ error: "App not found" }, { status: 404 });
        }

        // Update the app name
        await appRef.update({
            name: name.trim(),
            updatedAt: new Date(),
        });

        return NextResponse.json({ success: true });
    });
}