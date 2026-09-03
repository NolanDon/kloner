// app/api/billing/cancel-subscription/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import Stripe from "stripe";
import { Resend } from "resend";
import { getStripe } from "@/lib/stripe";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getSubscriptionIdForUid } from "../../_lib/billing";
import { monthlyLimitFor, type UserTier } from "@/src/lib/credits";
import { captureAuditEvent, captureCriticalEvent, captureException } from "@/lib/observability";
import {
    enqueueSiteAccessJob,
    claimSiteAccessJob,
    completeSiteAccessJob,
    isProductionSiteAccessRuntime,
    reportSiteAccessChangeRequested,
    sendSiteAccessSuspendedEmail,
    shouldEnforceLiveSiteAccess,
    suspendUserLiveSites,
    restoreUserLiveSites,
} from "@/app/api/_lib/subscriptionSiteAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

function getResend() {
        const key = process.env.RESEND_API_KEY;
        if (!key) throw new Error("RESEND_API_KEY env not set");
        return new Resend(key);
}

function cleanStr(v: unknown, max = 200): string {
        return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function retentionCouponId(): string {
        const isProd = process.env.NODE_ENV === "production";
        return cleanStr(
                isProd
                        ? process.env.STRIPE_RETENTION_COUPON_PROD || process.env.STRIPE_EXIT40_COUPON_PROD
                        : process.env.STRIPE_RETENTION_COUPON_TEST || process.env.STRIPE_EXIT40_COUPON_TEST,
                200,
        );
}

function buildCancellationFeedbackText(args: {
        uid: string;
        email?: string | null;
        name?: string | null;
    reason?: string | null;
        feedback: string;
        stripeStatus: string | null;
        cancelAtPeriodEnd: boolean;
        subscriptionId: string;
}) {
        return [
                "Kloner cancellation feedback",
                "",
                `uid: ${args.uid}`,
                `email: ${args.email || "n/a"}`,
                `name: ${args.name || "n/a"}`,
                `reason: ${args.reason || "n/a"}`,
                `subscriptionId: ${args.subscriptionId}`,
                `stripeStatus: ${args.stripeStatus || "n/a"}`,
                `cancelAtPeriodEnd: ${args.cancelAtPeriodEnd ? "yes" : "no"}`,
                "",
                "Feedback:",
                args.feedback,
        ].join("\n");
}

function buildCancellationFeedbackHtml(args: {
        uid: string;
        email?: string | null;
        name?: string | null;
    reason?: string | null;
        feedback: string;
        stripeStatus: string | null;
        cancelAtPeriodEnd: boolean;
        subscriptionId: string;
}) {
        const accent = "#FF8D21";
        const dark = "#111827";
        const muted = "#6b7280";

        return `
<!doctype html>
<html lang="en">
    <head><meta charSet="utf-8" /><title>Kloner cancellation feedback</title></head>
    <body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:24px 0;background:#ffffff;">
            <tr>
                <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;border:1px solid #fee2d5;border-radius:16px;overflow:hidden;">
                        <tr>
                            <td style="padding:18px 24px;background:${accent};">
                                <div style="font-size:14px;font-weight:700;color:#ffffff;">Cancellation feedback</div>
                                <div style="margin-top:4px;font-size:12px;color:#ffe7dc;">A user submitted feedback before canceling.</div>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding:18px 24px;">
                                <div style="font-size:12px;color:${muted};margin-bottom:8px;">User</div>
                                <div style="font-size:13px;color:${dark};font-weight:600;">${args.name || args.email || args.uid}</div>

                                <div style="margin-top:14px;font-size:12px;color:${muted};margin-bottom:8px;">Account</div>
                                <div style="font-size:13px;color:${dark};line-height:1.6;">
                                    <div><strong>UID:</strong> ${args.uid}</div>
                                    <div><strong>Email:</strong> ${args.email || "n/a"}</div>
                                    <div><strong>Reason:</strong> ${args.reason || "n/a"}</div>
                                    <div><strong>Subscription:</strong> ${args.subscriptionId}</div>
                                    <div><strong>Status:</strong> ${args.stripeStatus || "n/a"}</div>
                                    <div><strong>Cancel at period end:</strong> ${args.cancelAtPeriodEnd ? "yes" : "no"}</div>
                                </div>

                                <div style="margin-top:14px;font-size:12px;color:${muted};margin-bottom:8px;">Feedback</div>
                                <div style="font-size:13px;color:${dark};line-height:1.7;white-space:pre-wrap;border:1px solid #f3f4f6;border-radius:12px;padding:12px;background:#fafafa;">
                                    ${args.feedback.replace(/[<>]/g, "")}
                                </div>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
</html>
`;
}

async function sendCancellationFeedbackEmail(args: {
        uid: string;
        email?: string | null;
        name?: string | null;
    reason?: string | null;
        feedback: string;
        stripeStatus: string | null;
        cancelAtPeriodEnd: boolean;
        subscriptionId: string;
}) {
        const to = process.env.CANCELLATION_FEEDBACK_TO || process.env.SUPPORT_EMAIL || "support@kloner.app";
        const from = process.env.SUPPORT_ESCALATION_FROM || process.env.WELCOME_EMAIL_FROM || "hello@kloner.app";
        const resend = getResend();

        const result = await resend.emails.send({
                from,
                to,
                subject: `Kloner cancellation feedback from ${args.email || args.uid}`,
                text: buildCancellationFeedbackText(args),
                html: buildCancellationFeedbackHtml(args),
        });

        if ("error" in result && result.error) {
                throw new Error(result.error.message || "Cancellation feedback email failed");
        }
}

async function handler(req: NextRequest, uid: string) {
    const body = (await req.json().catch(() => ({}))) as {
        atPeriodEnd?: boolean;
        cancellationReason?: string | null;
        cancellationFeedback?: string;
        retentionOffer?: boolean;
    };
    const atPeriodEnd = body?.atPeriodEnd !== false;
    const cancellationReason = cleanStr(body?.cancellationReason, 80);
        const cancellationFeedback = cleanStr(body?.cancellationFeedback, 200);
    const retentionOfferRequested = body?.retentionOffer === true;
    let siteAccessResult: Record<string, unknown> = { status: "not_requested" };

    if (atPeriodEnd && !cancellationReason && !cancellationFeedback) {
                return NextResponse.json(
            { ok: false, error: "Cancellation reason or feedback is required." },
                        { status: 400 },
                );
        }

    const subId = await getSubscriptionIdForUid(uid);
    if (!subId) {
        return NextResponse.json(
            { ok: false, error: "No Stripe subscription linked to this account." },
            { status: 400 },
        );
    }

    const userRef = db.collection("kloner_users").doc(uid);

    const retentionCoupon = retentionOfferRequested ? retentionCouponId() : "";
    if (retentionOfferRequested && !retentionCoupon) {
        return NextResponse.json(
            { ok: false, error: "The retention offer is not configured yet." },
            { status: 503 },
        );
    }

    if (retentionOfferRequested) {
        try {
            const coupon = await stripe.coupons.retrieve(retentionCoupon);
            if (coupon.percent_off !== 40 || coupon.duration !== "once") {
                return NextResponse.json(
                    { ok: false, error: "The retention coupon must be a one-time 40% Stripe coupon." },
                    { status: 503 },
                );
            }
        } catch {
            return NextResponse.json(
                { ok: false, error: "The retention coupon could not be found in Stripe." },
                { status: 503 },
            );
        }

        try {
            const currentSubscription = await stripe.subscriptions.retrieve(subId, { expand: ["discounts"] });
            const currentAny = currentSubscription as any;
            const currentDiscounts = Array.isArray(currentAny?.discounts)
                ? currentAny.discounts
                : Array.isArray(currentAny?.discounts?.data)
                    ? currentAny.discounts.data
                    : [];
            const alreadyDiscounted = currentDiscounts.some((discount: any) =>
                String(discount?.coupon?.id || discount?.coupon || "") === retentionCoupon,
            );
            const alreadyMarked = currentAny?.metadata?.klonerRetentionOfferUsed === "1";
            if (alreadyDiscounted || alreadyMarked) {
                if (alreadyDiscounted) {
                    await userRef.set(
                        {
                            billingRetentionOfferUsedAt: admin.firestore.FieldValue.serverTimestamp(),
                            billingRetentionOfferSubscriptionId: subId,
                        },
                        { merge: true },
                    );
                }
                return NextResponse.json(
                    { ok: false, error: "The retention offer has already been used on this subscription." },
                    { status: 409 },
                );
            }
        } catch {
            return NextResponse.json(
                { ok: false, error: "Unable to verify retention-offer eligibility." },
                { status: 503 },
            );
        }

        const userSnap = await userRef.get();
        const userData = userSnap.exists ? (userSnap.data() as any) : {};
        if (userData?.billingRetentionOfferUsedAt) {
            return NextResponse.json(
                { ok: false, error: "The retention offer has already been used on this account." },
                { status: 409 },
            );
        }
        await userRef.set(
            {
                billingRetentionOfferUsedAt: admin.firestore.FieldValue.serverTimestamp(),
                billingRetentionOfferSubscriptionId: subId,
            },
            { merge: true },
        );
    }

    let updatedRaw: Record<string, any>;
    try {
        updatedRaw = (await stripe.subscriptions.update(subId, {
            cancel_at_period_end: retentionOfferRequested ? false : atPeriodEnd,
            ...(retentionOfferRequested ? { discounts: [{ coupon: retentionCoupon }] } : {}),
            ...(retentionOfferRequested ? { metadata: { klonerRetentionOfferUsed: "1" } } : {}),
        })) as unknown as Record<string, any>;
    } catch (error: any) {
        if (retentionOfferRequested) {
            await userRef.set(
                {
                    billingRetentionOfferUsedAt: admin.firestore.FieldValue.delete(),
                    billingRetentionOfferSubscriptionId: admin.firestore.FieldValue.delete(),
                },
                { merge: true },
            ).catch(() => undefined);
        }
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
                alwaysNotifySlack: true,
                statusCode: status,
                route: "/api/billing/cancel-subscription",
                method: "POST",
                action: "billing.cancelSubscription.update",
                service: "billing-subscription",
                userId: uid,
                requestId: error?.requestId || req.headers.get("x-request-id") || req.headers.get("x-vercel-id") || undefined,
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
            bonusRemaining: 0,
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

    if (atPeriodEnd && shouldEnforceLiveSiteAccess()) {
        try {
            await enqueueSiteAccessJob(uid, "suspend", "subscription_cancelled");
            await reportSiteAccessChangeRequested(uid, "suspend");
            const claimed = isProductionSiteAccessRuntime() && await claimSiteAccessJob(uid, "suspend");
            if (!claimed) {
                siteAccessResult = { status: "queued", reason: "A site-access worker is already processing this request." };
            } else {
            // Process from the backend request as well as the Stripe webhook. This
            // makes local/test cancellations work without waiting for a webhook or
            // a Vercel cron invocation; the job remains as the retry record.
            const result = await suspendUserLiveSites(uid, "subscription_cancelled");
            const authUser = await admin.auth().getUser(uid).catch(() => null);
            if (authUser?.email && result.suspended > 0) {
                await sendSiteAccessSuspendedEmail({ uid, email: authUser.email, name: authUser.displayName || null, reason: "subscription_cancelled" });
            }
            await completeSiteAccessJob(uid, "suspend");
            siteAccessResult = { status: "completed", suspended: result.suspended, failed: result.failed };
            }
        } catch (error) {
            siteAccessResult = { status: "failed", error: error instanceof Error ? error.message : String(error) };
            await captureAuditEvent({
                source: "vercel",
                severity: "critical",
                alwaysNotifySlack: true,
                route: "/api/billing/cancel-subscription",
                method: "POST",
                action: "billing.liveSites.suspension_failed",
                service: "vercel-project-access",
                userId: uid,
                message: `Live-site pause execution failed for canceled user ${uid}: ${error instanceof Error ? error.message : String(error)}`,
                extra: { error: error instanceof Error ? error.stack || error.message : String(error) },
            });
            await captureCriticalEvent({
                source: "vercel",
                severity: "critical",
                alwaysNotifySlack: true,
                statusCode: 500,
                route: "/api/billing/cancel-subscription",
                method: "POST",
                action: "billing.cancelSubscription.siteAccess",
                service: "billing-subscription",
                userId: uid,
                message: typeof (error as any)?.message === "string" ? (error as any).message : "Failed to suspend live sites",
            });
        }
    } else if (atPeriodEnd) {
        siteAccessResult = { status: "skipped", reason: "STRIPE_ENFORCE_LIVE_SITE_ACCESS is disabled" };
        await captureAuditEvent({
            source: "vercel",
            severity: "critical",
            alwaysNotifySlack: true,
            route: "/api/billing/cancel-subscription",
            method: "POST",
            action: "billing.liveSites.pause_skipped",
            service: "vercel-project-access",
            userId: uid,
            message: `Live-site pause was skipped for canceled user ${uid}: STRIPE_ENFORCE_LIVE_SITE_ACCESS is disabled.`,
        });
    }

    if (!atPeriodEnd && shouldEnforceLiveSiteAccess()) {
        try {
            await enqueueSiteAccessJob(uid, "restore", "subscription_resumed");
            await reportSiteAccessChangeRequested(uid, "restore");
            const claimed = isProductionSiteAccessRuntime() && await claimSiteAccessJob(uid, "restore");
            if (!claimed) {
                siteAccessResult = { status: "queued", reason: "A site-access worker is already processing this request." };
            } else {
                const result = await restoreUserLiveSites(uid);
                await completeSiteAccessJob(uid, "restore");
                siteAccessResult = { status: "completed", restored: result.restored, failed: result.failed };
            }
        } catch (error) {
            siteAccessResult = { status: "failed", error: error instanceof Error ? error.message : String(error) };
            await captureCriticalEvent({
                source: "vercel",
                severity: "critical",
                alwaysNotifySlack: true,
                statusCode: 500,
                route: "/api/billing/cancel-subscription",
                method: "POST",
                action: "billing.cancelSubscription.siteAccessRestore",
                service: "billing-subscription",
                userId: uid,
                message: typeof (error as any)?.message === "string" ? (error as any).message : "Failed to restore live sites",
            });
        }
    }

    if (atPeriodEnd && (cancellationReason || cancellationFeedback)) {
        const feedbackDoc = db.collection("billing_cancellation_feedback").doc();
        const authUser = await admin.auth().getUser(uid).catch(() => null);
        const feedbackPayload = {
            uid,
            subscriptionId: payload.stripeSubscriptionId,
            stripeStatus: payload.stripeStatus,
            cancelAtPeriodEnd: payload.stripeCancelAtPeriodEnd,
            feedback: {
                reason: cancellationReason || null,
                note: cancellationFeedback || null,
            },
            authEmail: authUser?.email || null,
            authDisplayName: authUser?.displayName || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await feedbackDoc.set(feedbackPayload, { merge: false });

        try {
            await sendCancellationFeedbackEmail({
                uid,
                email: authUser?.email || null,
                name: authUser?.displayName || null,
                reason: cancellationReason || null,
                feedback: cancellationFeedback,
                stripeStatus: payload.stripeStatus,
                cancelAtPeriodEnd: payload.stripeCancelAtPeriodEnd,
                subscriptionId: payload.stripeSubscriptionId,
            });

            await feedbackDoc.set(
                {
                    emailedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
        } catch (error) {
            await captureCriticalEvent({
                source: "vercel",
                severity: "critical",
                statusCode: 500,
                route: "/api/billing/cancel-subscription",
                method: "POST",
                action: "billing.cancelSubscription.feedbackEmail",
                service: "billing-subscription",
                userId: uid,
                message: typeof (error as any)?.message === "string" ? (error as any).message : "Cancellation feedback email failed",
                stack: typeof (error as any)?.stack === "string" ? (error as any).stack : undefined,
                extra: {
                    subscriptionId: payload.stripeSubscriptionId,
                    reason: cancellationReason || null,
                    feedbackPreview: cancellationFeedback.slice(0, 80),
                },
            });
        }
    }

    return NextResponse.json({
        ok: true,
        subscriptionId: payload.stripeSubscriptionId,
        cancelAtPeriodEnd: payload.stripeCancelAtPeriodEnd,
        currentPeriodEnd: payload.stripeCurrentPeriodEnd,
        trialEnd: payload.stripeTrialEnd,
        status: payload.stripeStatus,
        siteAccess: siteAccessResult,
    });
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async (ctx: GuardCtx) => handler(req, ctx.uid));
}
