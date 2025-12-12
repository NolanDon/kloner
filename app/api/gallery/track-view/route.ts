// app/api/gallery/track-view/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const db = getAdminDb();

    const body = await req.json().catch(() => ({}));
    const buildId = String(body?.buildId || "");
    if (!buildId) {
        return NextResponse.json({ error: "Missing buildId" }, { status: 400 });
    }

    // expected: builds/{id}
    const ref = db.collection("gallery").doc(buildId);

    try {
        await ref.set(
            {
                views: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
        return NextResponse.json({ ok: true }, { status: 200 });
    } catch (e: any) {
        return NextResponse.json(
            { error: e?.message || "Failed to track view" },
            { status: 500 }
        );
    }
}
