// src/app/api/admin/gallery/list/route.ts
import { NextResponse } from "next/server";
import admin from "firebase-admin";
import { initAdmin } from "../../../_lib/auth";
import { fetchGalleryDocs } from "../../../_lib/gallery-feed";

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
    return { ok: true as const };
}

export async function GET(req: Request) {
    try {
        const gate = await requireAdmin(req);
        if (!gate.ok) return NextResponse.json({ ok: false, error: gate.msg }, { status: gate.status });

        const url = new URL(req.url);
        const mode = (url.searchParams.get("mode") || "all").toLowerCase();
        const approvedOnly = mode === "approved";
        const limitN = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 200)));

        const db = getAdminApp().firestore();

        const docs = approvedOnly
            ? await fetchGalleryDocs(db, { approvedOnly: true, limit: limitN })
            : await fetchGalleryDocs(db, { approvedOnly: false, limit: limitN });

        const items = docs.map((d) => {
            const data = d.data() as any;
            return {
                id: d.id,
                approved: !!data.approved,
                author: data.author || "",
                createdAt: data.createdAt || null,
                name: data.name || "",
                remixable: !!data.remixable,
                screenshotKey: data.screenshotKey || "",
                sourceRenderId: data.sourceRenderId || "",
                html: data.html || "",
            };
        });

        return NextResponse.json({ ok: true, items });
    } catch (e: any) {
        const status = typeof e?.status === "number" ? e.status : 500;
        return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status });
    }
}
