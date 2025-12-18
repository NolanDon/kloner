// src/app/api/admin/gallery/approve/route.ts
import { NextResponse } from "next/server";
import admin from "firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminApp() {
    if (admin.apps.length) return admin.app();

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error("Missing Firebase Admin env vars (PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY)");
    }

    privateKey = privateKey.replace(/\\n/g, "\n");

    return admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
}

function pickBearer(req: Request): string | null {
    const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
}

async function requireAdmin(req: Request) {
    const token = pickBearer(req);
    if (!token) return { ok: false as const, status: 401, msg: "Missing Bearer token" };

    getAdminApp();

    const decoded = await admin.auth().verifyIdToken(token);
    const adminClaim = (decoded as any)?.admin;
    const ok = adminClaim === true || adminClaim === "true" || adminClaim === 1;

    if (!ok) return { ok: false as const, status: 403, msg: "Not admin" };
    return { ok: true as const, decoded };
}

export async function POST(req: Request) {
    try {
        const gate = await requireAdmin(req);
        if (!gate.ok) return NextResponse.json({ ok: false, error: gate.msg }, { status: gate.status });

        const body = await req.json().catch(() => ({}));
        const id = typeof body?.id === "string" ? body.id.trim() : "";
        const approved = body?.approved === true;

        if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

        const actorUid = (gate as any)?.decoded?.uid || null;
        const db = getAdminApp().firestore();

        await db.collection("gallery").doc(id).set(
            {
                approved,
                approvedAt: approved ? admin.firestore.FieldValue.serverTimestamp() : null,
                approvedBy: approved ? actorUid : null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        return NextResponse.json({ ok: true, id, approved });
    } catch (e: any) {
        const status = typeof e?.status === "number" ? e.status : 500;
        return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status });
    }
}
