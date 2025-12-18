// src/app/api/admin/gallery/get/route.ts
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
        throw new Error(
            "Missing Firebase Admin env vars (PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY)"
        );
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
    return { ok: true as const };
}

export async function GET(req: Request) {
    try {
        const gate = await requireAdmin(req);
        if (!gate.ok) {
            return NextResponse.json({ ok: false, error: gate.msg }, { status: gate.status });
        }

        const url = new URL(req.url);
        const id = (url.searchParams.get("id") || "").trim();
        if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

        const db = getAdminApp().firestore();
        const doc = await db.collection("gallery").doc(id).get();

        if (!doc.exists) {
            return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
        }

        const data = doc.data() as any;

        return NextResponse.json({
            ok: true,
            item: {
                id: doc.id,
                approved: !!data.approved,
                author: data.author || "",
                createdAt: data.createdAt || null,
                name: data.name || "",
                remixable: !!data.remixable,
                screenshotKey: data.screenshotKey || "",
                sourceRenderId: data.sourceRenderId || "",
                html: data.html || "",
            },
        });
    } catch (e: any) {
        const status = typeof e?.status === "number" ? e.status : 500;
        return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status });
    }
}
