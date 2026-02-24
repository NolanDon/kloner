import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { FieldValue } from "firebase-admin/firestore";
import { assertCsrf, getAdminDb, verifySession } from "@/app/api/_lib/auth";
import { captureCriticalEvent, captureException } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = getStripe();

function cleanStr(v: unknown, max = 512): string {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function cleanInt(v: unknown): number | null {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : NaN;
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.floor(n));
}

async function applyTopup(params: {
    uid: string;
    sessionId: string;
    stripeCustomerId?: string;
}): Promise<{ applied: boolean; credits?: number; newRemaining?: number }> {
    const { uid, sessionId, stripeCustomerId } = params;

    const db = getAdminDb();

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const meta = (session.metadata || {}) as Record<string, any>;
    if (cleanStr(meta.type) !== "ai_credit_topup") {
        return { applied: false };
    }

    const paymentStatus = typeof (session as any).payment_status === "string" ? (session as any).payment_status : "";
    if (paymentStatus && paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
        return { applied: false };
    }

    const sessionUid = cleanStr(meta.firebaseUid || meta.uid, 256);
    const credits = cleanInt(meta.aiEditCredits);

    const sessionCustomerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;

    // Require the session to belong to this authenticated user.
    // Prefer explicit metadata match; fallback to Stripe customer match.
    const uidMatches = sessionUid && sessionUid === uid;
    const customerMatches = !!stripeCustomerId && !!sessionCustomerId && stripeCustomerId === sessionCustomerId;

    if (!uidMatches && !customerMatches) {
        return { applied: false };
    }

    if (!credits) {
        return { applied: false };
    }

    const topupRef = db.collection("stripe_credit_topups").doc(session.id);
    const userRef = db.collection("kloner_users").doc(uid);

    let newRemaining: number | undefined;

    await db.runTransaction(async (tx: any) => {
        const topupSnap = await tx.get(topupRef);
        if (topupSnap.exists) return;

        const userSnap = await tx.get(userRef);
        const data = userSnap.exists ? (userSnap.data() as any) : {};
        const bucket = data["credits.aiEdits"] || (data.credits && data.credits.aiEdits) || {};

        const remainingRaw = bucket?.remaining;
        if (remainingRaw === null) {
            tx.set(
                topupRef,
                {
                    uid,
                    credits,
                    skipped: true,
                    reason: "unlimited_remaining_null",
                    createdAt: FieldValue.serverTimestamp(),
                    livemode: !!session.livemode,
                    customerId: sessionCustomerId || null,
                    paymentIntentId:
                        typeof session.payment_intent === "string"
                            ? session.payment_intent
                            : session.payment_intent?.id || null,
                    paymentStatus: paymentStatus || null,
                    source: "confirm",
                },
                { merge: true },
            );
            return;
        }

        const remaining =
            typeof remainingRaw === "number" && Number.isFinite(remainingRaw) && remainingRaw >= 0
                ? remainingRaw
                : 0;

        const monthlyLimitRaw = bucket?.monthlyLimit;
        const monthlyLimit =
            typeof monthlyLimitRaw === "number" && Number.isFinite(monthlyLimitRaw) && monthlyLimitRaw >= 0
                ? monthlyLimitRaw
                : null;

        const bonusRaw = (bucket as any)?.bonusRemaining;
        const existingBonus =
            typeof bonusRaw === "number" && Number.isFinite(bonusRaw) && bonusRaw >= 0
                ? Math.floor(bonusRaw)
                : monthlyLimit !== null
                    ? Math.max(0, remaining - monthlyLimit)
                    : 0;

        newRemaining = remaining + credits;
        const newBonusRemaining = existingBonus + credits;

        const nextBucket: Record<string, any> = {
            ...(bucket && typeof bucket === "object" ? bucket : {}),
            remaining: newRemaining,
            bonusRemaining: newBonusRemaining,
            lastTopUpAt: FieldValue.serverTimestamp(),
        };

        for (const k of Object.keys(nextBucket)) {
            if (nextBucket[k] === undefined) delete nextBucket[k];
        }

        tx.set(userRef, { "credits.aiEdits": nextBucket }, { merge: true });

        tx.set(
            topupRef,
            {
                uid,
                credits,
                createdAt: FieldValue.serverTimestamp(),
                livemode: !!session.livemode,
                customerId: sessionCustomerId || null,
                paymentIntentId:
                    typeof session.payment_intent === "string"
                        ? session.payment_intent
                        : session.payment_intent?.id || null,
                paymentStatus: paymentStatus || null,
                source: "confirm",
            },
            { merge: true },
        );
    });

    return { applied: true, credits, newRemaining };
}

export async function POST(req: NextRequest) {
    try {
        assertCsrf(req);
        const decoded = await verifySession(req);
        const uid = decoded.uid;

        const db = getAdminDb();

        const body = (await req.json().catch(() => ({}))) as any;
        const sessionId = cleanStr(body?.sessionId, 256);
        if (!sessionId) {
            return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
        }

        const userSnap = await db.collection("kloner_users").doc(uid).get();
        const userData = userSnap.exists ? (userSnap.data() as any) : {};
        const stripeCustomerId = typeof userData?.stripeCustomerId === "string" ? userData.stripeCustomerId : undefined;

        const result = await applyTopup({ uid, sessionId, stripeCustomerId });
        if (!result.applied) {
            await captureCriticalEvent({
                source: "vercel",
                severity: "error",
                statusCode: 400,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "billing.confirmCreditTopup",
                userId: uid,
                message: "Unable to confirm top-up",
                service: "billing",
                url: req.url,
            });
            return NextResponse.json({ error: "Unable to confirm top-up." }, { status: 400 });
        }

        return NextResponse.json({ ok: true, credits: result.credits ?? null, newRemaining: result.newRemaining ?? null });
    } catch (err: any) {
        const status = typeof err?.status === "number" ? err.status : 401;
        const msg = typeof err?.message === "string" ? err.message : "Unauthorized";
        if (status >= 500) {
            await captureException({
                source: "vercel",
                error: err,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "billing.confirmCreditTopup",
                statusCode: status,
                service: "billing",
                url: req.url,
            });
        } else {
            await captureCriticalEvent({
                source: "vercel",
                severity: "error",
                statusCode: status,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "billing.confirmCreditTopup",
                message: msg,
                service: "billing",
                url: req.url,
            });
        }
        return NextResponse.json({ error: msg }, { status });
    }
}
