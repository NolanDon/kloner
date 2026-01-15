// src/app/api/admin/renders/route.ts
import { NextResponse } from "next/server";
import admin from "firebase-admin";
import { initAdmin } from "../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function getAdminApp() {
    initAdmin();
    return admin.app();
}

async function isRequestAdmin(req: Request) {
    const authHeader = req.headers.get("authorization") || "";
    const m = authHeader.match(/^Bearer (.+)$/i);
    const token = m?.[1];
    if (!token) return false;

    const app = getAdminApp();
    const decoded = await app.auth().verifyIdToken(token, true);
    const adminClaim = (decoded as any)?.admin;

    return adminClaim === true || adminClaim === "true" || adminClaim === 1;
}

function pickHtml(data: any): string {
    const candidates = [
        data?.html,
        data?.renderedHtml,
        data?.sanitizedHtml,
        data?.finalHtml,
        data?.docHtml,
        data?.pageHtml,
        data?.contentHtml,
    ];

    for (const v of candidates) {
        if (typeof v === "string" && v.trim()) return v;
    }
    return "";
}

export async function GET(req: Request) {
    try {
        const ok = await isRequestAdmin(req);
        if (!ok) {
            return NextResponse.json({ error: "admin_only" }, { status: 403 });
        }

        const app = getAdminApp();
        const db = app.firestore();

        const url = new URL(req.url);

        const uid = (url.searchParams.get("uid") || "").trim();
        const renderId = (url.searchParams.get("renderId") || "").trim();
        const includeHtml =
            url.searchParams.get("includeHtml") === "1" ||
            url.searchParams.get("includeHtml") === "true";

        // MODE 1: fetch a single render doc with HTML
        if (uid && renderId) {
            const ref = db.doc(`kloner_users/${uid}/kloner_renders/${renderId}`);
            const snap = await ref.get();

            if (!snap.exists) {
                return NextResponse.json({ error: "not_found" }, { status: 404 });
            }

            const data = snap.data() as any;

            const createdAt = data?.createdAt || null;

            const item = {
                uid,
                renderId: snap.id,
                name:
                    (typeof data?.name === "string" && data.name) ||
                    (typeof data?.title === "string" && data.title) ||
                    "Untitled render",
                createdAt,
                updatedAt: data?.updatedAt || null,
                referenceImage: data?.referenceImage || null,
                url: data?.url || null,
                status: typeof data?.status === "string" ? data.status : "",
                path: ref.path,
                html: pickHtml(data),
            };

            return NextResponse.json({ item });
        }

        // MODE 2: list renders (optionally includeHtml)
        const snap = await db.collectionGroup("kloner_renders").limit(250).get();

        const items = snap.docs
            .map((d) => {
                const data = d.data() as any;
                const pathParts = d.ref.path.split("/");
                const uidIdx = pathParts.indexOf("kloner_users");
                const resolvedUid =
                    (typeof data?.uid === "string" && data.uid) ||
                    (uidIdx >= 0 ? pathParts[uidIdx + 1] : "");

                const createdAt = data?.createdAt || null;

                return {
                    uid: resolvedUid,
                    renderId: d.id,
                    name:
                        (typeof data?.name === "string" && data.name) ||
                        (typeof data?.title === "string" && data.title) ||
                        "Untitled render",
                    createdAt,
                    updatedAt: data?.updatedAt || null,
                    referenceImage: data?.referenceImage || null,
                    url: data?.url || null,
                    status: typeof data?.status === "string" ? data.status : "",
                    path: d.ref.path,
                    ...(includeHtml ? { html: pickHtml(data) } : {}),
                    _createdAtMs:
                        createdAt && typeof createdAt?.toMillis === "function"
                            ? createdAt.toMillis()
                            : typeof createdAt === "number"
                                ? createdAt
                                : 0,
                };
            })
            .sort((a: any, b: any) => (b._createdAtMs || 0) - (a._createdAtMs || 0))
            .map(({ _createdAtMs, ...rest }: any) => rest);

        return NextResponse.json({ items });
    } catch (e: any) {
        console.error("[api/admin/renders] failed", e);
        return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
    }
}
