// app/api/billing/cancel-subscription/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getSubscriptionIdForUid } from "../../_lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = getStripe() as unknown as Stripe;
const db = admin.firestore();

type GuardCtx = { uid: string };

async function handler(req: NextRequest, uid: string) {
    const body = (await req.json().catch(() => ({}))) as { atPeriodEnd?: boolean };
    const atPeriodEnd = body?.atPeriodEnd !== false;

    const subId = await getSubscriptionIdForUid(uid);
    if (!subId) {
        return NextResponse.json(
            { ok: false, error: "No Stripe subscription linked to this account." },
            { status: 400 },
        );
    }

    const updatedRaw = (await stripe.subscriptions.update(subId, {
        cancel_at_period_end: atPeriodEnd,
    })) as unknown as Record<string, any>;

    const payload = {
        stripeSubscriptionId: String(updatedRaw.id || subId),
        stripeCancelAtPeriodEnd: !!updatedRaw.cancel_at_period_end,
        stripeCurrentPeriodEnd: typeof updatedRaw.current_period_end === "number" ? updatedRaw.current_period_end : null,
        stripeTrialEnd: typeof updatedRaw.trial_end === "number" ? updatedRaw.trial_end : null,
        stripeStatus: typeof updatedRaw.status === "string" ? updatedRaw.status : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Mirror directly onto your existing user doc fields (matches your schema)
    await db.collection("kloner_users").doc(uid).set(payload, { merge: true });

    return NextResponse.json({
        ok: true,
        subscriptionId: payload.stripeSubscriptionId,
        cancelAtPeriodEnd: payload.stripeCancelAtPeriodEnd,
        currentPeriodEnd: payload.stripeCurrentPeriodEnd,
        trialEnd: payload.stripeTrialEnd,
        status: payload.stripeStatus,
    });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async (ctx: GuardCtx) => handler(req, ctx.uid));
}
