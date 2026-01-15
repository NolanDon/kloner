// src/app/api/admin/gallery/approve/route.ts
import { NextResponse } from "next/server";
import admin from "firebase-admin";
import { initAdmin } from "../../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminApp() {
    initAdmin();
    return admin.app();
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

        const updateData: any = {
            approved,
            approvedAt: approved ? admin.firestore.FieldValue.serverTimestamp() : null,
            approvedBy: approved ? actorUid : null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (approved) {
            // Generate realistic random counts: likes lowest, views highest, remixes in between
            const likes = Math.floor(Math.random() * (500 - 100 + 1)) + 100; // 100-500
            const remixes = Math.floor(Math.random() * (1000 - likes + 1)) + likes; // likes to 1000
            const views = Math.floor(Math.random() * (1500 - remixes + 1)) + remixes; // remixes to 1500

            updateData.likes = likes;
            updateData.remixes = remixes;
            updateData.views = views;
        }

        await db.collection("gallery").doc(id).set(updateData, { merge: true });

        return NextResponse.json({ ok: true, id, approved });
    } catch (e: any) {
        const status = typeof e?.status === "number" ? e.status : 500;
        return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status });
    }
}
