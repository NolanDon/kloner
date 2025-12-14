import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb, requireAdmin } from "../../_lib/auth";

function str(v: any) {
    return typeof v === "string" ? v : "";
}
function num(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
    try {
        await requireAdmin(req);

        const url = new URL(req.url);
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const lim = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);

        const db = getAdminDb()
        let snap: admin.firestore.QuerySnapshot;

        if (q) {
            // Search priority:
            // 1) exact affiliateRef doc id lookup
            const byId = await db.collection("affiliates").doc(q).get();
            if (byId.exists) {
                const d = byId.data() as any;
                return NextResponse.json({
                    ok: true,
                    affiliates: [
                        {
                            affiliateRef: byId.id,
                            uid: str(d.uid) || null,
                            code: str(d.code) || null,
                            email: str(d.email) || null,
                            displayName: str(d.displayName) || null,
                            updatedAtMs: typeof d.updatedAt?.toMillis === "function" ? d.updatedAt.toMillis() : null,
                            stats: d.stats || null,
                        },
                    ],
                });
            }

            // 2) query by code (exact match)
            snap = await db.collection("affiliates").where("code", "==", q).limit(lim).get();
        } else {
            snap = await db.collection("affiliates").orderBy("updatedAt", "desc").limit(lim).get();
        }

        const affiliates = snap.docs.map((d) => {
            const x = d.data() as any;
            return {
                affiliateRef: d.id,
                uid: str(x.uid) || null,
                code: str(x.code) || null,
                email: str(x.email) || null,
                displayName: str(x.displayName) || null,
                updatedAtMs: typeof x.updatedAt?.toMillis === "function" ? x.updatedAt.toMillis() : null,
                stats: x.stats || null,
            };
        });

        return NextResponse.json({ ok: true, affiliates });
    } catch (e: any) {
        const status = typeof e?.status === "number" ? e.status : 500;
        return NextResponse.json({ ok: false, error: String(e?.message || "Failed") }, { status });
    }
}
