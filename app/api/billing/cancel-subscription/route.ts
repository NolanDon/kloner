// app/api/billing/cancel-subscription/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getSubscriptionIdForUid } from "../../_lib/billing";
import { monthlyLimitFor, type UserTier } from "@/src/lib/credits";
import { captureCriticalEvent, captureException } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = getStripe() as unknown as Stripe;
const db = admin.firestore();

type GuardCtx = { uid: string };

function endOfMonthUtc(now: Date): Date {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const firstNext = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
    return new Date(firstNext.getTime() - 1);
}

function toFirestoreTsOrDate(date: Date): any {
    const ts = (admin as any)?.firestore?.Timestamp;
    if (ts && typeof ts.fromDate === "function") return ts.fromDate(date);
    return date;
}

function getBucketRemaining(data: any, field: "credits.preview" | "credits.snapshot" | "credits.aiEdits"): number | null {
    if (!data || typeof data !== "object") return null;
    const nested = data[field];
    const alt =
        field === "credits.preview"
            ? data.credits?.preview
            : field === "credits.snapshot"
                ? data.credits?.snapshot
                : data.credits?.aiEdits;
    const bucket = nested || alt || null;
    const r = bucket && typeof bucket.remaining === "number" ? bucket.remaining : null;
    return Number.isFinite(r as any) ? (r as number) : null;
}

function capToLimit(remaining: number | null, limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return 0;
    if (typeof remaining !== "number" || !Number.isFinite(remaining)) return limit;
    // Never increase remaining on cancel; only cap down.
    return Math.max(0, Math.min(remaining, limit));
}

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

    let updatedRaw: Record<string, any>;
    try {
        updatedRaw = (await stripe.subscriptions.update(subId, {
            cancel_at_period_end: atPeriodEnd,
        })) as unknown as Record<string, any>;
    } catch (error: any) {
        const status =
            typeof error?.statusCode === "number"
                ? error.statusCode
                : typeof error?.status === "number"
                  ? error.status
                  : 500;

        if (status >= 500) {
            await captureException({
                source: "vercel",
                error,
                route: "/api/billing/cancel-subscription",
                method: "POST",
                action: "billing.cancelSubscription.update",
                statusCode: status,
                service: "billing-subscription",
                userId: uid,
                extra: { subId, atPeriodEnd },
            });
        } else {
            await captureCriticalEvent({
                source: "vercel",
                severity: "critical",
                statusCode: status,
                route: "/api/billing/cancel-subscription",
                method: "POST",
                action: "billing.cancelSubscription.update",
                service: "billing-subscription",
                userId: uid,
                message: typeof error?.message === "string" ? error.message : "Stripe cancel subscription failed",
                errorName: typeof error?.type === "string" ? error.type : undefined,
                stack: typeof error?.stack === "string" ? error.stack : undefined,
                extra: { subId, atPeriodEnd },
            });
        }

        throw error;
    }

    const stripeStatus = typeof updatedRaw.status === "string" ? updatedRaw.status : null;
    const stripeTrialEnd = typeof updatedRaw.trial_end === "number" ? updatedRaw.trial_end : null;
    const cancelAtPeriodEnd = !!updatedRaw.cancel_at_period_end;

    const payload = {
        stripeSubscriptionId: String(updatedRaw.id || subId),
        stripeCancelAtPeriodEnd: cancelAtPeriodEnd,
        stripeCurrentPeriodEnd: typeof updatedRaw.current_period_end === "number" ? updatedRaw.current_period_end : null,
        stripeTrialEnd,
        stripeStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const userRef = db.collection("kloner_users").doc(uid);

    // Mirror directly onto your existing user doc fields (matches your schema)
    await userRef.set(payload, { merge: true });

    // If the user cancels while still in trial, immediately cap their credits down to free limits.
    // (They can keep trial access if you want, but they won't keep Pro/Agency credit allowances.)
    const now = new Date();
    const nowSec = Math.floor(now.getTime() / 1000);
    const isTrialing = stripeStatus === "trialing" || (typeof stripeTrialEnd === "number" && stripeTrialEnd > nowSec);

    if (atPeriodEnd && cancelAtPeriodEnd && isTrialing) {
        // Override window lasts until trial ends (preferred) or end-of-month fallback.
        const overrideUntilDate =
            typeof stripeTrialEnd === "number" && stripeTrialEnd > nowSec
                ? new Date(stripeTrialEnd * 1000)
                : endOfMonthUtc(now);
        const overrideUntilTs = toFirestoreTsOrDate(overrideUntilDate);

        const freeTier: UserTier = "free";
        const freePreview = monthlyLimitFor(freeTier, "preview");
        const freeSnapshot = monthlyLimitFor(freeTier, "screenshot");
        const freeEdits = monthlyLimitFor(freeTier, "edit");

        // Read existing remaining so we only cap down (never grant more on cancel).
        const snap = await userRef.get();
        const data = snap.exists ? (snap.data() as any) : {};

        const update: Record<string, any> = {
            // Prevent trial fraud: immediately downgrade access tier.
            tier: "free",
            tierSource: "override",
            tierOverrideTier: "free",
            tierOverrideUntil: overrideUntilTs,
            tierOverrideReason: "trial_cancelled",
            tierOverrideSetAt: admin.firestore.FieldValue.serverTimestamp(),

            creditsOverrideTier: "free",
            creditsOverrideUntil: overrideUntilTs,
            creditsOverrideReason: "trial_cancelled",
            creditsOverrideSetAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        update["credits.preview"] = {
            monthlyLimit: freePreview,
            remaining: capToLimit(getBucketRemaining(data, "credits.preview"), freePreview),
            periodEnd: overrideUntilTs,
        };
        update["credits.snapshot"] = {
            monthlyLimit: freeSnapshot,
            remaining: capToLimit(getBucketRemaining(data, "credits.snapshot"), freeSnapshot),
            periodEnd: overrideUntilTs,
        };
        update["credits.aiEdits"] = {
            monthlyLimit: freeEdits,
            remaining: capToLimit(getBucketRemaining(data, "credits.aiEdits"), freeEdits),
            periodEnd: overrideUntilTs,
        };

        await userRef.set(update, { merge: true });
    }

    // If user is undoing a pending cancellation, clear any trial-cancel override.
    if (!atPeriodEnd && !cancelAtPeriodEnd) {
        await userRef.set(
            {
                tierOverrideTier: admin.firestore.FieldValue.delete(),
                tierOverrideUntil: admin.firestore.FieldValue.delete(),
                tierOverrideReason: admin.firestore.FieldValue.delete(),
                tierOverrideSetAt: admin.firestore.FieldValue.delete(),
                creditsOverrideTier: admin.firestore.FieldValue.delete(),
                creditsOverrideUntil: admin.firestore.FieldValue.delete(),
                creditsOverrideReason: admin.firestore.FieldValue.delete(),
                creditsOverrideSetAt: admin.firestore.FieldValue.delete(),
            },
            { merge: true },
        );
    }

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
