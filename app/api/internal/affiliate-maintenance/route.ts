// app/api/internal/affiliate-maintenance/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Auth:
 * Uses the same internal header scheme you already use elsewhere.
 * Set env:
 * - INTERNAL_HEADER_NAME
 * - INTERNAL_API_KEY
 * - FIREBASE_SERVICE_ACCOUNT
 */

const HDR_NAME = process.env.INTERNAL_HEADER_NAME || "";
const HDR_VALUE = process.env.INTERNAL_API_KEY || "";

function requireInternalAuth(req: NextRequest): { ok: true } | { ok: false; res: NextResponse } {
    if (!HDR_NAME || !HDR_VALUE) {
        return {
            ok: false,
            res: NextResponse.json({ error: "Internal auth not configured" }, { status: 500 }),
        };
    }
    const got = req.headers.get(HDR_NAME);
    if (got !== HDR_VALUE) {
        return {
            ok: false,
            res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        };
    }
    return { ok: true };
}

// minimal admin init (same pattern as your webhook)
if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing for affiliate maintenance");

    let credJson: admin.ServiceAccount;
    try {
        credJson = JSON.parse(raw);
    } catch {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        credJson = JSON.parse(decoded);
    }

    admin.initializeApp({
        credential: admin.credential.cert(credJson),
    });
}

const db = admin.firestore();

type PromoteResult = {
    scanned: number;
    promoted: number;
    skippedAlreadyEarned: number;
    skippedReversed: number;
    skippedNotEligible: number;
    errors: number;
};

async function promotePendingToEarned(params: { limit?: number }): Promise<PromoteResult> {
    const limit = Math.min(Math.max(params.limit ?? 200, 1), 1000);

    const nowTs = admin.firestore.Timestamp.now();

    // eligible pending entries across all affiliates
    const q = db
        .collectionGroup("entries")
        .where("status", "==", "pending")
        .where("eligibleAt", "<=", nowTs)
        .orderBy("eligibleAt", "asc")
        .limit(limit);

    const snap = await q.get();

    const result: PromoteResult = {
        scanned: snap.size,
        promoted: 0,
        skippedAlreadyEarned: 0,
        skippedReversed: 0,
        skippedNotEligible: 0,
        errors: 0,
    };

    if (snap.empty) return result;

    // batch writes in chunks
    const now = admin.firestore.FieldValue.serverTimestamp();
    const incrementsByAffiliate: Record<
        string,
        { earnedCents: number; earnedCount: number; currency: string }
    > = {};

    let batch = db.batch();
    let ops = 0;

    const commitIfNeeded = async () => {
        if (ops === 0) return;
        await batch.commit();
        batch = db.batch();
        ops = 0;
    };

    for (const docSnap of snap.docs) {
        try {
            const d = docSnap.data() as any;

            // defensive guards
            const status = typeof d.status === "string" ? d.status : "";
            if (status !== "pending") {
                result.skippedAlreadyEarned += 1;
                continue;
            }

            if (d.reversedAt || d.status === "reversed") {
                result.skippedReversed += 1;
                continue;
            }

            // eligibleAt check (should already be filtered)
            const eligibleAt = d.eligibleAt as admin.firestore.Timestamp | undefined;
            if (!eligibleAt || eligibleAt.toMillis() > Date.now()) {
                result.skippedNotEligible += 1;
                continue;
            }

            const affiliateRef = typeof d.affiliateRef === "string" ? d.affiliateRef : "";
            const currency = typeof d.currency === "string" ? d.currency : "usd";
            const commissionCents = Number(d.commissionCents ?? 0);

            // promote entry
            batch.set(
                docSnap.ref,
                {
                    status: "earned",
                    earnedAt: now,
                    updatedAt: now,
                },
                { merge: true }
            );
            ops += 1;
            result.promoted += 1;

            // accumulate stats
            if (affiliateRef && Number.isFinite(commissionCents) && commissionCents > 0) {
                if (!incrementsByAffiliate[affiliateRef]) {
                    incrementsByAffiliate[affiliateRef] = {
                        earnedCents: 0,
                        earnedCount: 0,
                        currency,
                    };
                }
                incrementsByAffiliate[affiliateRef].earnedCents += commissionCents;
                incrementsByAffiliate[affiliateRef].earnedCount += 1;
            }

            // keep batches under limit
            if (ops >= 400) {
                await commitIfNeeded();
            }
        } catch {
            result.errors += 1;
        }
    }

    await commitIfNeeded();

    // write/update small per-affiliate aggregates for future UI
    const statsNow = admin.firestore.FieldValue.serverTimestamp();
    const statBatch = db.batch();
    let statOps = 0;

    for (const [affiliateRef, agg] of Object.entries(incrementsByAffiliate)) {
        const ref = db
            .collection("affiliate_ledger")
            .doc(affiliateRef)
            .collection("stats")
            .doc("current");

        statBatch.set(
            ref,
            {
                earnedCents: admin.firestore.FieldValue.increment(agg.earnedCents),
                earnedCount: admin.firestore.FieldValue.increment(agg.earnedCount),
                currency: agg.currency,
                updatedAt: statsNow,
            },
            { merge: true }
        );
        statOps += 1;

        if (statOps >= 450) {
            await statBatch.commit();
            statOps = 0;
        }
    }

    if (statOps > 0) await statBatch.commit();

    return result;
}

export async function POST(req: NextRequest) {
    const auth = requireInternalAuth(req);
    if (!auth.ok) return auth.res;

    const body = await req.json().catch(() => ({} as any));
    const limit = Number(body?.limit ?? 200);

    try {
        const res = await promotePendingToEarned({ limit });
        return NextResponse.json({ ok: true, ...res }, { status: 200 });
    } catch (e: any) {
        return NextResponse.json(
            { ok: false, error: e?.message || "affiliate maintenance failed" },
            { status: 500 }
        );
    }
}
