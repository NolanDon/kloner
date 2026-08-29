import admin from "firebase-admin";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminAuth, getAdminDb } from "../../_lib/auth";
import { makeRecoveryCheckoutUrl, makeUnsubUrl } from "@/app/api/private/email-links";
import {
    canSendWinbackOfferEmail,
    hasActiveOrTrialingStripeSubscription,
    hasLikelyActivePaidAccess,
} from "@/app/api/_lib/recoveryOffer";
import { buildRecoveryOfferEmail } from "@/app/api/_lib/recoveryOfferEmail";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const JOURNEY_SENDER = "Kloner Team <hello@kloner.app>";
const DEFAULT_BATCH_LIMIT = 100;

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

function getCronSecret(): string {
    const s = (process.env.CRON_SECRET || "").trim();
    if (!s) throw new Error("CRON_SECRET env not set");
    return s;
}

function getInternalKey(): string {
    const s = (process.env.INTERNAL_API_KEY || "").trim();
    if (!s) throw new Error("INTERNAL_API_KEY env not set");
    return s;
}

function parseBatchLimit(req: NextRequest): number {
    const raw = new URL(req.url).searchParams.get("limit");
    const parsed = Number.parseInt(raw || "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_LIMIT;
    return Math.min(parsed, 250);
}

function requireCronAuth(req: NextRequest): NextResponse | null {
    let expected: string;
    try {
        expected = getCronSecret();
    } catch (err) {
        console.error("[send-journey-emails] cron auth is not configured", err);
        return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 500 });
    }
    const auth = (req.headers.get("authorization") || "").trim();
    if (auth === `Bearer ${expected}`) return null;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function requireInternalAuth(req: NextRequest): NextResponse | null {
    const expected = getInternalKey();
    const got = (req.headers.get("x-internal-key") || "").trim();
    if (got === expected) return null;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function getUserEmail(userData: Record<string, any> | null | undefined): string {
    const candidates = [
        userData?.email,
        userData?.primaryEmail,
        userData?.contactEmail,
    ];
    for (const value of candidates) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

function getUserName(userData: Record<string, any> | null | undefined, authUser?: { displayName?: string | null } | null): string | null {
    const candidates = [
        userData?.displayName,
        userData?.name,
        authUser?.displayName,
    ];

    for (const value of candidates) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }

    return null;
}

async function sendWinbackBatch(limit: number) {
    const db = getAdminDb();
    const stripe = getStripe();
    const resend = getResend();
    const auth = getAdminAuth();
    const from = process.env.WELCOME_EMAIL_FROM || JOURNEY_SENDER;

    const stats = {
        scanned: 0,
        sent: 0,
        skipped: 0,
        skippedAlreadySent: 0,
        skippedUnsubscribed: 0,
        skippedTooRecent: 0,
        skippedActivePaid: 0,
        skippedActiveStripe: 0,
        skippedMissingEmail: 0,
        errors: 0,
    };

    let cursor: any = null;

    while (true) {
        let query: any = db.collection("kloner_users")
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(limit);

        if (cursor) {
            query = query.startAfter(cursor);
        }

        const snap = await query.get();
        if (snap.empty) break;

        for (const docSnap of snap.docs) {
            stats.scanned += 1;

            try {
                const data = docSnap.data() as Record<string, any>;
                const gate = canSendWinbackOfferEmail(data);
                if (!gate.ok) {
                    stats.skipped += 1;
                    if (gate.reason === "unsubscribed") stats.skippedUnsubscribed += 1;
                    else if (gate.reason === "already_sent") stats.skippedAlreadySent += 1;
                    else if (gate.reason === "active_subscription") stats.skippedActivePaid += 1;
                    else stats.skippedTooRecent += 1;
                    continue;
                }

                if (hasLikelyActivePaidAccess(data)) {
                    stats.skipped += 1;
                    stats.skippedActivePaid += 1;
                    continue;
                }

                const customerId =
                    typeof data?.stripeCustomerId === "string" && data.stripeCustomerId.trim()
                        ? data.stripeCustomerId.trim()
                        : null;

                if (customerId) {
                    const hasActiveSub = await hasActiveOrTrialingStripeSubscription(stripe, customerId).catch(() => false);
                    if (hasActiveSub) {
                        stats.skipped += 1;
                        stats.skippedActiveStripe += 1;
                        continue;
                    }
                }

                const authUser = await auth.getUser(docSnap.id).catch(() => null);
                const email = getUserEmail(data) || authUser?.email?.trim() || "";
                if (!email) {
                    stats.skipped += 1;
                    stats.skippedMissingEmail += 1;
                    continue;
                }

                const linkUrl = makeRecoveryCheckoutUrl({ uid: docSnap.id, kind: "exit40" });
                const unsubUrl = makeUnsubUrl({ uid: docSnap.id, kind: "journey" });
                const offer = buildRecoveryOfferEmail({
                    name: getUserName(data, authUser),
                    linkUrl,
                    unsubUrl,
                    variant: "winback",
                });

                await docSnap.ref.set(
                    {
                        offers: {
                            ...(data?.offers && typeof data.offers === "object" ? data.offers : {}),
                            winback40RecoveryEmailLastAttemptAt: Date.now(),
                            winback40RecoveryEmailStatus: "sending",
                        },
                    },
                    { merge: true },
                ).catch((trackingError: any) => {
                    console.error("[send-journey-emails] failed to record send attempt", trackingError);
                });

                const result = await resend.emails.send({
                    from,
                    to: email,
                    subject: offer.subject,
                    text: offer.text,
                    html: offer.html,
                });

                if (result && typeof result === "object" && "error" in result && (result as any).error) {
                    throw new Error(((result as any).error?.message as string) || "Winback email send failed");
                }

                await docSnap.ref.set(
                    {
                        offers: {
                            ...(data?.offers && typeof data.offers === "object" ? data.offers : {}),
                            winback40RecoveryEmailSentAt: Date.now(),
                            winback40RecoveryEmailStatus: "sent",
                            winback40RecoveryEmailId: (result as any)?.data?.id || null,
                        },
                    },
                    { merge: true },
                );

                stats.sent += 1;
            } catch (err) {
                stats.errors += 1;
                await docSnap.ref.set(
                    {
                        offers: {
                            winback40RecoveryEmailLastAttemptAt: Date.now(),
                            winback40RecoveryEmailStatus: "error",
                            winback40RecoveryEmailError: err instanceof Error ? err.message : String(err),
                        },
                    },
                    { merge: true },
                ).catch(() => null);
                console.error("[send-journey-emails] failed to send", err);
            }
        }

        cursor = snap.docs[snap.docs.length - 1] || null;
        if (snap.size < limit) break;
    }

    return stats;
}

function makeRunId(): string {
    return `journey_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function startTrackedRun(): Promise<{ id: string; ref: any } | null> {
    try {
        const id = makeRunId();
        const runDoc = getAdminDb().collection("kloner_email_job_runs").doc(id);
        // Admin SDK returns a DocumentReference directly; the fallback keeps this
        // compatible with the lightweight collection mock used by the route tests.
        const ref = (runDoc as any).ref || runDoc;
        await ref.set({
            job: "send-journey-emails",
            status: "running",
            startedAt: Date.now(),
        });
        return { id, ref };
    } catch (err) {
        console.error("[send-journey-emails] failed to start run tracking", err);
        return null;
    }
}

async function finishTrackedRun(run: { id: string; ref: any } | null, patch: Record<string, any>): Promise<void> {
    if (!run) return;
    await run.ref.set({ ...patch, finishedAt: Date.now() }, { merge: true }).catch((err: any) => {
        console.error("[send-journey-emails] failed to finish run tracking", { runId: run.id, err });
    });
}

export async function GET(req: NextRequest) {
    const authError = requireCronAuth(req);
    if (authError) return authError;

    const run = await startTrackedRun();
    try {
        const stats = await sendWinbackBatch(parseBatchLimit(req));
        await finishTrackedRun(run, { status: "completed", stats });
        return NextResponse.json({ ok: true, runId: run?.id || null, ...stats }, { headers: { "Cache-Control": "no-store" } });
    } catch (err: any) {
        await finishTrackedRun(run, { status: "failed", error: err?.message || "Failed to send journey emails" });
        console.error("[send-journey-emails] cron failed", err);
        return NextResponse.json(
            { ok: false, error: err?.message || "Failed to send journey emails" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
        );
    }
}

export async function POST(req: NextRequest) {
    const authError = requireInternalAuth(req);
    if (authError) return authError;

    const run = await startTrackedRun();
    try {
        const stats = await sendWinbackBatch(parseBatchLimit(req));
        await finishTrackedRun(run, { status: "completed", stats });
        return NextResponse.json({ ok: true, runId: run?.id || null, ...stats }, { headers: { "Cache-Control": "no-store" } });
    } catch (err: any) {
        await finishTrackedRun(run, { status: "failed", error: err?.message || "Failed to send journey emails" });
        console.error("[send-journey-emails] internal run failed", err);
        return NextResponse.json(
            { ok: false, error: err?.message || "Failed to send journey emails" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
        );
    }
}
