import { randomUUID } from "node:crypto";
import { hasLikelyActivePaidAccess, hasSentRecoveryOfferEmail } from "./recoveryOffer";

export type RecoveryEmailPayload = { from: string; to: string; subject: string; text: string; html: string; replyTo?: string };

// Freeze the complete request, including signed URLs, so all triggers can safely
// replay it with the same provider key after a timeout or Firestore write failure.
export async function deliverRecoveryOfferEmail(args: {
    db: FirebaseFirestore.Firestore;
    userRef: FirebaseFirestore.DocumentReference;
    variant: "checkout" | "winback";
    payload?: RecoveryEmailPayload;
    send: (payload?: RecoveryEmailPayload, options?: { idempotencyKey: string }) => Promise<unknown>;
}): Promise<boolean> {
    const token = randomUUID();
    const claim = await args.db.runTransaction(async (tx) => {
        const snap = await tx.get(args.userRef);
        const data = snap.data() || {};
        const offers = data.offers || {};
        if (hasSentRecoveryOfferEmail(data) || hasLikelyActivePaidAccess(data) || data.notificationPrefs?.journeyEmails === false) return null;
        if (Number(offers.recoveryEmailLeaseUntil || 0) > Date.now()) return null;
        // Provider keys expire after 24h. An unconfirmed request older than the
        // safety window needs reconciliation rather than risking a second email.
        const expiredRequest = offers.recoveryEmailRequestStartedAt && Date.now() - offers.recoveryEmailRequestStartedAt >= 23 * 60 * 60 * 1000;
        if (expiredRequest && !offers.recoveryEmailConfirmedRejected) {
            tx.set(args.userRef, { offers: { recoveryEmailStatus: "needs_review", recoveryEmailLeaseUntil: 0 } }, { merge: true });
            return null;
        }
        const payload = offers.recoveryEmailPayload || args.payload;
        const key = (!expiredRequest && offers.recoveryEmailIdempotencyKey) || `recovery-offer/${randomUUID()}`;
        const variant = offers.recoveryEmailVariant || args.variant;
        tx.set(args.userRef, { offers: {
            recoveryEmailLeaseToken: token,
            recoveryEmailLeaseUntil: Date.now() + 5 * 60 * 1000,
            recoveryEmailStatus: "sending",
            recoveryEmailLastAttemptAt: Date.now(),
            recoveryEmailRequestStartedAt: (!expiredRequest && offers.recoveryEmailRequestStartedAt) || Date.now(),
            recoveryEmailConfirmedRejected: false,
            recoveryEmailIdempotencyKey: key,
            recoveryEmailVariant: variant,
            ...(payload ? { recoveryEmailSubject: payload.subject, recoveryEmailTemplateVersion: "2026-10-10" } : {}),
            ...(payload ? { recoveryEmailPayload: payload } : {}),
        } }, { merge: true });
        return { payload, key, variant, mayHaveBeenAccepted: Boolean(offers.recoveryEmailRequestStartedAt && !offers.recoveryEmailConfirmedRejected) && !expiredRequest };
    });
    if (!claim) return false;

    let confirmedRejected = false;
    try {
        const result = await args.send(claim.payload, { idempotencyKey: claim.key }) as { data?: { id?: string }; error?: { name?: string; message?: string } } | undefined;
        if (result?.error) {
            // These explicit API rejections prove no message was accepted. Network
            // failures and idempotency conflicts remain uncertain and need review.
            confirmedRejected = ["rate_limit_exceeded", "daily_quota_exceeded", "monthly_quota_exceeded", "validation_error", "invalid_api_key", "restricted_api_key"].includes(result.error.name || "");
            throw new Error(result.error.message || "Recovery email send failed");
        }
        if (!result?.data?.id) throw new Error("Resend did not return an email ID");
        const prefix = claim.variant === "checkout" ? "exitOffer40" : "winback40";
        return await args.db.runTransaction(async tx => {
            const snap = await tx.get(args.userRef);
            if (snap.data()?.offers?.recoveryEmailLeaseToken !== token) return false;
            tx.set(args.userRef, { offers: {
                [`${prefix}RecoveryEmailSentAt`]: Date.now(),
                [`${prefix}RecoveryEmailId`]: result.data!.id,
                recoveryEmailStatus: "sent",
                recoveryEmailError: null,
                recoveryEmailLeaseUntil: 0,
                recoveryEmailPayload: null,
            } }, { merge: true });
            return true;
        });
    } catch (err) {
        await args.db.runTransaction(async (tx) => {
            const snap = await tx.get(args.userRef);
            if (snap.data()?.offers?.recoveryEmailLeaseToken !== token) return;
            tx.set(args.userRef, { offers: {
                recoveryEmailStatus: "error",
                recoveryEmailConfirmedRejected: confirmedRejected && !claim.mayHaveBeenAccepted,
                recoveryEmailError: err instanceof Error ? err.message : String(err),
                recoveryEmailLeaseUntil: 0,
            } }, { merge: true });
        });
        throw err;
    }
}
