import { NextRequest, NextResponse } from "next/server";
import { assertCsrf, verifySession, getAdminDb } from "@/app/api/_lib/auth";
import { monthlyLimitFor, tierFromClaims } from "@/src/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_COST = 5;

function nextPeriodEndUtc(now: Date) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const firstNext = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
    return new Date(firstNext.getTime() - 1);
}

function getAiEditsBucket(data: any): any {
    if (!data || typeof data !== "object") return {};
    return data["credits.aiEdits"] || (data.credits && data.credits.aiEdits) || {};
}

function creditEventRef(db: any, uid: string, requestId: string) {
    return db.collection("kloner_users").doc(uid).collection("credit_events").doc(requestId);
}

export async function POST(req: NextRequest) {
    try {
        assertCsrf(req);
        const session = await verifySession(req);
        const uid = session.uid;
        const tier = tierFromClaims(session as any);

        const body = await req.json().catch(() => ({} as any));
        const requestIdRaw = typeof body?.requestId === "string" ? body.requestId.trim() : "";
        const requestId = requestIdRaw || "";

        const cost = typeof body?.cost === "number" && Number.isFinite(body.cost) ? Math.max(0, Math.floor(body.cost)) : DEFAULT_COST;
        if (!requestId) {
            return NextResponse.json({ ok: false, error: "Missing requestId" }, { status: 400 });
        }

        const limit = monthlyLimitFor(tier, "edit");
        if (!limit) {
            return NextResponse.json(
                { ok: true, remaining: null, monthlyLimit: null, periodEnd: null, alreadyCommitted: false },
                { status: 200 }
            );
        }

        const db = getAdminDb();
        const userRef = db.collection("kloner_users").doc(uid);
        const evtRef = creditEventRef(db, uid, requestId);

        const now = new Date();
        const periodEnd = nextPeriodEndUtc(now);

        let finalRemaining = 0;
        let alreadyCommitted = false;
        let ok = false;

        await db.runTransaction(async (tx: any) => {
            const evtSnap = await tx.get(evtRef);
            if (evtSnap.exists) {
                const evt = evtSnap.data() as any;
                const status = String(evt?.status || "");
                if (status === "committed") {
                    alreadyCommitted = true;

                    const userSnap = await tx.get(userRef);
                    const data = userSnap.exists ? (userSnap.data() as any) : {};
                    const bucket = getAiEditsBucket(data);

                    const rawEnd = bucket.periodEnd;
                    const endDate: Date | null = rawEnd && typeof rawEnd.toDate === "function" ? (rawEnd.toDate() as Date) : rawEnd instanceof Date ? rawEnd : null;
                    const active = endDate !== null && now < endDate;
                    const existingRemaining = typeof bucket.remaining === "number" && bucket.remaining >= 0 ? bucket.remaining : null;

                    finalRemaining = active && existingRemaining !== null ? existingRemaining : limit;
                    ok = true;
                    return;
                }
            }

            const userSnap = await tx.get(userRef);
            const data = userSnap.exists ? (userSnap.data() as any) : {};
            const bucket = getAiEditsBucket(data);

            const rawEnd = bucket.periodEnd;
            const endDate: Date | null = rawEnd && typeof rawEnd.toDate === "function" ? (rawEnd.toDate() as Date) : rawEnd instanceof Date ? rawEnd : null;
            const active = endDate !== null && now < endDate;
            const existingRemaining = typeof bucket.remaining === "number" && bucket.remaining >= 0 ? bucket.remaining : null;

            const usePeriodEnd = active ? (endDate as Date) : periodEnd;
            const startRemaining = active && existingRemaining !== null ? existingRemaining : limit;

            if (startRemaining < cost) {
                finalRemaining = Math.max(startRemaining, 0);
                ok = false;

                tx.set(
                    userRef,
                    {
                        "credits.aiEdits": {
                            remaining: finalRemaining,
                            monthlyLimit: limit,
                            periodEnd: usePeriodEnd,
                        },
                    },
                    { merge: true }
                );

                tx.set(
                    evtRef,
                    {
                        feature: "ai_agent_edit",
                        status: "blocked",
                        reason: "insufficient_credits",
                        cost,
                        tier,
                        createdAt: now,
                        createdAtMs: now.getTime(),
                    },
                    { merge: true }
                );

                return;
            }

            finalRemaining = Math.max(startRemaining - cost, 0);
            ok = true;

            tx.set(
                userRef,
                {
                    "credits.aiEdits": {
                        remaining: finalRemaining,
                        monthlyLimit: limit,
                        periodEnd: usePeriodEnd,
                    },
                },
                { merge: true }
            );

            tx.set(
                evtRef,
                {
                    feature: "ai_agent_edit",
                    status: "committed",
                    cost,
                    tier,
                    createdAt: now,
                    createdAtMs: now.getTime(),
                },
                { merge: true }
            );
        });

        if (!ok) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "You have used all AI edit credits for this month.",
                    remaining: finalRemaining,
                    monthlyLimit: limit,
                    periodEnd: periodEnd.toISOString(),
                    alreadyCommitted,
                },
                { status: 402 }
            );
        }

        return NextResponse.json(
            {
                ok: true,
                remaining: finalRemaining,
                monthlyLimit: limit,
                periodEnd: periodEnd.toISOString(),
                alreadyCommitted,
            },
            { status: 200 }
        );
    } catch (err: any) {
        const msg = typeof err?.message === "string" ? err.message : "Failed to consume credits";
        const status = typeof err?.status === "number" ? err.status : 500;
        return NextResponse.json({ ok: false, error: msg }, { status });
    }
}
