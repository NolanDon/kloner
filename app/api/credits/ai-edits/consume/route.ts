import { NextRequest, NextResponse } from "next/server";
import { assertCsrf, verifySession, getAdminDb } from "@/app/api/_lib/auth";
import { monthlyLimitFor, type UserTier } from "@/src/lib/credits";
import { getAuthoritativeUserTier } from "@/app/api/_lib/userTier";
import { captureCriticalEvent, captureException } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_COST = 3;

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

function toDateFromFirestoreTimestampLike(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === "function") {
        try {
            return v.toDate();
        } catch {
            return null;
        }
    }
    return null;
}

function getActiveCreditsOverride(data: any, now: Date): { tier: any; until: Date } | null {
    if (!data || typeof data !== "object") return null;
    const rawTier = typeof data.creditsOverrideTier === "string" ? data.creditsOverrideTier : null;
    const until = toDateFromFirestoreTimestampLike(data.creditsOverrideUntil);
    if (!rawTier || !until) return null;
    if (!(now < until)) return null;
    return { tier: rawTier, until };
}

function normalizeUserTier(raw: unknown): UserTier {
    const t = typeof raw === "string" ? raw.toLowerCase().trim() : "";
    if (t === "free" || t === "pro" || t === "agency" || t === "enterprise" || t === "unknown") {
        return t as UserTier;
    }
    return "free";
}

function minDate(a: Date, b: Date): Date {
    return a.getTime() <= b.getTime() ? a : b;
}

function normalizeNonNegativeInt(v: any): number | null {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v < 0) return null;
    return Math.floor(v);
}

function creditEventRef(db: any, uid: string, requestId: string) {
    return db.collection("kloner_users").doc(uid).collection("credit_events").doc(requestId);
}

export async function POST(req: NextRequest) {
    try {
        assertCsrf(req);
        const session = await verifySession(req);
        const uid = session.uid;

        const body = await req.json().catch(() => ({} as any));
        const requestIdRaw = typeof body?.requestId === "string" ? body.requestId.trim() : "";
        const requestId = requestIdRaw || "";

        const cost = typeof body?.cost === "number" && Number.isFinite(body.cost) ? Math.max(0, Math.floor(body.cost)) : DEFAULT_COST;
        if (!requestId) {
            await captureCriticalEvent({
                source: "vercel",
                severity: "error",
                statusCode: 400,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "credits.consumeAiEdits",
                userId: uid,
                message: "Missing requestId",
                service: "credits",
                url: req.url,
            });
            return NextResponse.json({ ok: false, error: "Missing requestId" }, { status: 400 });
        }

        const db = getAdminDb();
        const userRef = db.collection("kloner_users").doc(uid);
        const evtRef = creditEventRef(db, uid, requestId);

        const now = new Date();
        const periodEnd = nextPeriodEndUtc(now);

        // Determine authoritative tier for credits (supports tier overrides via getAuthoritativeUserTier).
        const baseTier = await getAuthoritativeUserTier(uid);

        // Apply credits override (e.g., cancel during trial caps credits to free).
        const userSnapForTier = await userRef.get();
        const userDataForTier = userSnapForTier.exists ? (userSnapForTier.data() as any) : {};
        const override = getActiveCreditsOverride(userDataForTier, now);
        const effectiveTier = override ? normalizeUserTier(override.tier) : baseTier;
        const limit = monthlyLimitFor(effectiveTier, "edit");

        if (!limit) {
            return NextResponse.json(
                { ok: true, remaining: null, monthlyLimit: null, periodEnd: null, alreadyCommitted: false },
                { status: 200 }
            );
        }

        const overrideEnd = override?.until || null;

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
                    const existingRemaining = normalizeNonNegativeInt(bucket.remaining);
                    const bonusRemaining = normalizeNonNegativeInt((bucket as any)?.bonusRemaining);
                    const inferredBonus =
                        bonusRemaining !== null
                            ? bonusRemaining
                            : existingRemaining !== null
                                ? Math.max(0, existingRemaining - limit)
                                : 0;

                    // If the period is inactive/expired, monthly credits reset but top-ups remain.
                    finalRemaining =
                        active && existingRemaining !== null
                            ? existingRemaining
                            : limit + inferredBonus;
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
            const existingRemaining = normalizeNonNegativeInt(bucket.remaining);
            const bonusRemaining = normalizeNonNegativeInt((bucket as any)?.bonusRemaining);
            const inferredBonus =
                bonusRemaining !== null
                    ? bonusRemaining
                    : existingRemaining !== null
                        ? Math.max(0, existingRemaining - limit)
                        : 0;

            const rawUseEnd = active ? (endDate as Date) : periodEnd;
            const usePeriodEnd = overrideEnd ? minDate(rawUseEnd, overrideEnd) : rawUseEnd;

            // IMPORTANT: remaining may be greater than the monthlyLimit due to paid credit top-ups.
            // Never cap it down to the tier limit here, otherwise top-ups appear to "reset" after a spend.
            const startRemaining =
                active && existingRemaining !== null
                    ? existingRemaining
                    : limit + inferredBonus;

            if (startRemaining < cost) {
                finalRemaining = Math.max(startRemaining, 0);
                ok = false;

                const newBonus = inferredBonus;
                tx.set(
                    userRef,
                    {
                        "credits.aiEdits": {
                            remaining: finalRemaining,
                            monthlyLimit: limit,
                            periodEnd: usePeriodEnd,
                            bonusRemaining: newBonus,
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
                        tier: effectiveTier,
                        createdAt: now,
                        createdAtMs: now.getTime(),
                    },
                    { merge: true }
                );

                return;
            }

            finalRemaining = Math.max(startRemaining - cost, 0);
            ok = true;

            const bonusSpent = Math.min(inferredBonus, cost);
            const newBonus = Math.max(inferredBonus - bonusSpent, 0);

            tx.set(
                userRef,
                {
                    "credits.aiEdits": {
                        remaining: finalRemaining,
                        monthlyLimit: limit,
                        periodEnd: usePeriodEnd,
                        bonusRemaining: newBonus,
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
                    tier: effectiveTier,
                    createdAt: now,
                    createdAtMs: now.getTime(),
                },
                { merge: true }
            );
        });

        if (!ok) {
            const origin = new URL(req.url).origin;
            const upgradeUrl = new URL("/price", origin).toString();
            const topupUrl = new URL("/topup", origin).toString();

            await captureCriticalEvent({
                source: "vercel",
                severity: "error",
                statusCode: 402,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "credits.consumeAiEdits",
                userId: uid,
                message: "Insufficient credits",
                service: "credits",
                url: req.url,
                extra: {
                    remaining: finalRemaining,
                    monthlyLimit: limit,
                    tier: effectiveTier,
                },
            });

            return NextResponse.json(
                {
                    ok: false,
                    error:
                        effectiveTier === "free"
                            ? `You have used all AI edit credits for this month. Upgrade to get more credits: ${upgradeUrl}`
                            : `You have used all AI edit credits for this month. Top up credits: ${topupUrl} (or upgrade: ${upgradeUrl})`,
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
        if (status >= 500) {
            await captureException({
                source: "vercel",
                error: err,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "credits.consumeAiEdits",
                statusCode: status,
                service: "credits",
                url: req.url,
            });
        } else {
            await captureCriticalEvent({
                source: "vercel",
                severity: "error",
                statusCode: status,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "credits.consumeAiEdits",
                message: msg,
                service: "credits",
                url: req.url,
            });
        }
        return NextResponse.json({ ok: false, error: msg }, { status });
    }
}
