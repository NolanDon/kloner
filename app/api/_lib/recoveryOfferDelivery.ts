import { randomUUID } from "node:crypto";
import { hasSentRecoveryOfferEmail } from "./recoveryOffer";

// All three triggers share a lease so cron, checkout returns, and webhooks
// cannot send the same offer concurrently. Failed attempts remain retryable.
export async function deliverRecoveryOfferEmail(args: {
    db: FirebaseFirestore.Firestore;
    userRef: FirebaseFirestore.DocumentReference;
    variant: "checkout" | "winback";
    send: () => Promise<unknown>;
}): Promise<boolean> {
    const token = randomUUID();
    const claimed = await args.db.runTransaction(async (tx) => {
        const snap = await tx.get(args.userRef);
        const data = snap.data() || {};
        if (hasSentRecoveryOfferEmail(data)) return false;
        if (Number(data.offers?.recoveryEmailLeaseUntil || 0) > Date.now()) return false;
        tx.set(args.userRef, { offers: {
            recoveryEmailLeaseToken: token,
            recoveryEmailLeaseUntil: Date.now() + 5 * 60 * 1000,
            recoveryEmailStatus: "sending",
            recoveryEmailLastAttemptAt: Date.now(),
        } }, { merge: true });
        return true;
    });
    if (!claimed) return false;

    try {
        const result = await args.send() as { data?: { id?: string }; error?: { message?: string } } | undefined;
        if (result?.error) throw new Error(result.error.message || "Recovery email send failed");
        if (!result?.data?.id) throw new Error("Resend did not return an email ID");
        const prefix = args.variant === "checkout" ? "exitOffer40" : "winback40";
        await args.userRef.set({ offers: {
            [`${prefix}RecoveryEmailSentAt`]: Date.now(),
            [`${prefix}RecoveryEmailId`]: result.data.id,
            recoveryEmailStatus: "sent",
            recoveryEmailLeaseUntil: 0,
        } }, { merge: true });
        return true;
    } catch (err) {
        await args.db.runTransaction(async (tx) => {
            const snap = await tx.get(args.userRef);
            if (snap.data()?.offers?.recoveryEmailLeaseToken !== token) return;
            tx.set(args.userRef, { offers: {
                recoveryEmailStatus: "error",
                recoveryEmailError: err instanceof Error ? err.message : String(err),
                recoveryEmailLeaseUntil: 0,
            } }, { merge: true });
        });
        throw err;
    }
}
