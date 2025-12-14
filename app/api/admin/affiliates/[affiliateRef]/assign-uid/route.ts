import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb, requireAdmin } from "@/app/api/_lib/auth";

function str(v: any) {
    return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: NextRequest, ctx: { params: { affiliateRef: string } }) {
    try {
        await requireAdmin(req);

        const affiliateRef = (ctx.params.affiliateRef || "").trim();
        if (!affiliateRef) return NextResponse.json({ ok: false, error: "Missing affiliateRef" }, { status: 400 });

        const body = await req.json().catch(() => null);
        const uid = str(body?.uid);
        if (!uid) return NextResponse.json({ ok: false, error: "Missing uid" }, { status: 400 });

        const db = getAdminDb();
        const ref = db.collection("affiliates").doc(affiliateRef);

        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) throw new Error("Affiliate not found");

            const data = snap.data() as any;
            const current = str(data?.uid);

            // only assign if unassigned OR explicitly forced
            const force = body?.force === true;
            if (current && !force) throw new Error("Affiliate already has a uid");

            tx.set(
                ref,
                { uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                { merge: true }
            );

            // Optional: backfill entries missing uid
            const entries = await ref.collection("entries").where("uid", "==", null).limit(200).get();
            for (const d of entries.docs) {
                tx.set(d.ref, { uid }, { merge: true });
            }
        });

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        const msg = String(e?.message || "Failed");
        const status = msg.includes("already has a uid") ? 409 : typeof e?.status === "number" ? e.status : 500;
        return NextResponse.json({ ok: false, error: msg }, { status });
    }
}
