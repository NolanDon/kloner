import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb, requireAdmin } from "@/app/api/_lib/auth";

function str(v: any) {
    return typeof v === "string" ? v : "";
}
function num(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function ms(v: any) {
    if (!v) return null;
    if (typeof v?.toMillis === "function") return v.toMillis();
    if (typeof v?.toDate === "function") return v.toDate().getTime();
    return null;
}

export async function GET(req: NextRequest, ctx: any) {
    try {
        await requireAdmin(req);

        const affiliateRef = ((await Promise.resolve(ctx.params))?.affiliateRef || "").trim();
        if (!affiliateRef) return NextResponse.json({ ok: false, error: "Missing affiliateRef" }, { status: 400 });

        const url = new URL(req.url);
        const entriesLimit = Math.min(Math.max(parseInt(url.searchParams.get("entriesLimit") || "200", 10) || 200, 1), 500);
        const payoutsLimit = Math.min(Math.max(parseInt(url.searchParams.get("payoutsLimit") || "50", 10) || 50, 1), 200);

        const db = getAdminDb()

        const affSnap = await db.collection("affiliates").doc(affiliateRef).get();
        if (!affSnap.exists) return NextResponse.json({ ok: false, error: "Affiliate not found" }, { status: 404 });

        const aff = affSnap.data() as any;

        const entriesSnap = await db
            .collection("affiliates")
            .doc(affiliateRef)
            .collection("entries")
            .orderBy("createdAt", "desc")
            .limit(entriesLimit)
            .get();

        const payoutsSnap = await db
            .collection("affiliates")
            .doc(affiliateRef)
            .collection("payouts")
            .orderBy("createdAt", "desc")
            .limit(payoutsLimit)
            .get();

        const entries = entriesSnap.docs.map((d) => {
            const x = d.data() as any;
            return {
                id: d.id,
                uid: str(x.uid) || null,
                invoiceId: str(x.invoiceId) || d.id,
                commissionCents: num(x.commissionCents),
                status: str(x.status) || "pending",
                payoutHold: !!x.payoutHold,
                eligibleAtMs: ms(x.eligibleAt),
                createdAtMs: ms(x.createdAt),
                paidAtMs: ms(x.paidAt),
                payoutId: str(x.payoutId) || null,
            };
        });

        const payouts = payoutsSnap.docs.map((d) => {
            const x = d.data() as any;
            return {
                id: d.id,
                uid: str(x.uid) || null,
                amountCents: num(x.amountCents),
                status: str(x.status) || "scheduled",
                scheduledForMs: ms(x.scheduledFor),
                sentAtMs: ms(x.sentAt),
                createdAtMs: ms(x.createdAt),
                notes: str(x.notes) || null,
            };
        });

        const now = Date.now();
        let nextEligibleAtMs: number | null = null;
        let nextPayoutCents = 0;

        for (const e of entries) {
            if (e.status !== "pending") continue;
            if (e.payoutHold) continue;
            if (typeof e.eligibleAtMs !== "number") continue;

            if (e.eligibleAtMs <= now) nextPayoutCents += e.commissionCents;
            if (nextEligibleAtMs == null || e.eligibleAtMs < nextEligibleAtMs) nextEligibleAtMs = e.eligibleAtMs;
        }

        return NextResponse.json({
            ok: true,
            affiliate: {
                affiliateRef,
                uid: str(aff.uid) || null,
                code: str(aff.code) || null,
                email: str(aff.email) || null,
                displayName: str(aff.displayName) || null,
                createdAtMs: ms(aff.createdAt),
                updatedAtMs: ms(aff.updatedAt),
            },
            entries,
            payouts,
            computed: {
                nextEligibleAtMs,
                nextPayoutCents,
            },
        });
    } catch (e: any) {
        const status = typeof e?.status === "number" ? e.status : 500;
        return NextResponse.json({ ok: false, error: String(e?.message || "Failed") }, { status });
    }
}
