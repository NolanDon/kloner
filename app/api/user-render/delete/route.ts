// app/api/user-render/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler({ req, uid }: { req: NextRequest; uid: string }) {
    const body = await req.json().catch(() => ({}));
    const renderId = String(body?.renderId || "").trim();

    if (!renderId) {
        return NextResponse.json({ error: "Missing renderId" }, { status: 400 });
    }

    const db = getAdminDb ? getAdminDb() : admin.firestore();

    const renderRef = db
        .collection("kloner_users")
        .doc(uid)
        .collection("kloner_renders")
        .doc(renderId);

    // delete ai_edits subcollection first (if it exists)
    const aiEditsCol = renderRef.collection("ai_edits");

    // Admin SDK supports recursiveDelete in Node
    if (typeof (db as any).recursiveDelete === "function") {
        // deletes all docs under ai_edits (and any nested subcollections if they ever exist)
        await (db as any).recursiveDelete(aiEditsCol);
    } else {
        // fallback: batch delete docs in ai_edits (covers older admin SDKs)
        const snap = await aiEditsCol.get();
        if (!snap.empty) {
            const chunks: FirebaseFirestore.QueryDocumentSnapshot[] = snap.docs;
            const BATCH_LIMIT = 450;

            for (let i = 0; i < chunks.length; i += BATCH_LIMIT) {
                const batch = db.batch();
                chunks.slice(i, i + BATCH_LIMIT).forEach((d) => batch.delete(d.ref));
                await batch.commit();
            }
        }
    }

    // now delete the render doc itself
    await renderRef.delete();

    return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, handler);
}
