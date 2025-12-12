// app/api/gallery/toggle-like/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler({ req, uid }: { req: NextRequest; uid: string }) {
    const db = getAdminDb();

    const body = await req.json().catch(() => ({}));
    const buildId = String(body?.buildId || "");
    if (!buildId) return NextResponse.json({ error: "Missing buildId" }, { status: 400 });

    const buildRef = db.collection("gallery").doc(buildId);
    const likeRef = buildRef.collection("likes").doc(uid);

    try {
        const result = await db.runTransaction(async (tx) => {
            const [likeSnap, buildSnap] = await Promise.all([tx.get(likeRef), tx.get(buildRef)]);
            const curLikes = buildSnap.exists ? Number(buildSnap.get("likes") || 0) : 0;

            if (likeSnap.exists) {
                const next = Math.max(0, curLikes - 1);
                tx.delete(likeRef);
                tx.set(
                    buildRef,
                    { likes: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                    { merge: true }
                );
                return { likedByMe: false, likes: next };
            }

            tx.set(likeRef, { uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
            tx.set(
                buildRef,
                { likes: curLikes + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                { merge: true }
            );
            return { likedByMe: true, likes: curLikes + 1 };
        });

        return NextResponse.json(result, { status: 200 });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Failed to toggle like" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, handler, {
        csrf: false,          // <-- change
        methods: ["POST"],
    });
}
