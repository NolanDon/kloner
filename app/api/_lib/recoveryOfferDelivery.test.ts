import { deliverRecoveryOfferEmail } from "./recoveryOfferDelivery";

function setup() {
    let data: any = { offers: { existingOffer: true } };
    const userRef: any = {
        get: async () => ({ data: () => data }),
        set: async (patch: any) => { data = { ...data, offers: { ...data.offers, ...patch.offers } }; },
    };
    const db: any = {
        runTransaction: async (fn: any) => fn({ get: (ref: any) => ref.get(), set: (ref: any, patch: any) => ref.set(patch) }),
    };
    return { userRef, db, read: () => data };
}

test("another trigger skips while an email is in flight, then skips the confirmed delivery", async () => {
    const { db, userRef, read } = setup();
    let finish!: (result: unknown) => void;
    let started!: () => void;
    const inFlight = new Promise<void>((resolve) => { started = resolve; });
    const send = jest.fn(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
    const delivery = deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", send });
    await inFlight;
    expect(read().offers.exitOffer40RecoveryEmailSentAt).toBeUndefined();
    expect(await deliverRecoveryOfferEmail({ db, userRef, variant: "winback", send })).toBe(false);
    finish({ data: { id: "email_123" } });
    expect(await delivery).toBe(true);
    expect(await deliverRecoveryOfferEmail({ db, userRef, variant: "winback", send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(read().offers.existingOffer).toBe(true);
});

test("an expired lease from a terminated function can be retried", async () => {
    const { db, userRef } = setup();
    await userRef.set({ offers: { recoveryEmailLeaseUntil: Date.now() - 1, recoveryEmailStatus: "sending" } });
    const send = jest.fn(async () => ({ data: { id: "email_retry" } }));
    expect(await deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", send })).toBe(true);
});

test("an empty Resend response is not recorded as delivered", async () => {
    const { db, userRef, read } = setup();
    await expect(deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", send: async () => undefined })).rejects.toThrow("email ID");
    expect(read().offers.exitOffer40RecoveryEmailSentAt).toBeUndefined();
    expect(read().offers.recoveryEmailLeaseUntil).toBe(0);
});

const payload = { from: "hello@kloner.app", to: "test@example.com", subject: "Checkout", text: "text", html: "<p>text</p>" };

test("a retry uses the frozen request and the same provider key across triggers", async () => {
    const { db, userRef, read } = setup();
    const send = jest.fn().mockRejectedValueOnce(new Error("network timeout")).mockResolvedValueOnce({ data: { id: "replayed" } });
    await expect(deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send })).rejects.toThrow("network timeout");
    await deliverRecoveryOfferEmail({ db, userRef, variant: "winback", payload: { ...payload, subject: "different" }, send });
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(send.mock.calls[0][1].idempotencyKey).toMatch(/^recovery-offer\//);
    expect(read().offers.exitOffer40RecoveryEmailId).toBe("replayed");
    expect(read().offers.winback40RecoveryEmailId).toBeUndefined();
    expect(read().offers.recoveryEmailPayload).toBeNull();
});

test.each([{ notificationPrefs: { journeyEmails: false } }, { stripeStatus: "trialing" }, { tier: "pro" }])("rechecks subscriber and unsubscribe exclusions when claiming: %p", async exclusions => {
    const { db, userRef, read } = setup();
    await userRef.set(exclusions);
    // This mock merges only offers; overlay eligibility fields for transaction reads.
    const original = userRef.get;
    userRef.get = async () => ({ data: () => ({ ...read(), ...exclusions }) });
    const send = jest.fn();
    expect(await deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    userRef.get = original;
});

test("an ambiguous send outside the provider deduplication window needs review", async () => {
    const { db, userRef, read } = setup();
    await userRef.set({ offers: { recoveryEmailRequestStartedAt: Date.now() - 24 * 60 * 60 * 1000 } });
    const send = jest.fn();
    expect(await deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(read().offers.recoveryEmailStatus).toBe("needs_review");
});

test("a legacy session marker remains excluded until delivery is reconciled", async () => {
    const { db, userRef } = setup();
    await userRef.set({ offers: { exitOffer40RecoveryEmailSessionId: "cs_failed" } });
    expect(await deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send: async () => ({ data: { id: "confirmed" } }) })).toBe(false);
});

test("known provider rejections remain retryable after the deduplication window", async () => {
    const { db, userRef, read } = setup();
    await expect(deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send: async () => ({ error: { name: "rate_limit_exceeded", message: "slow down" } }) })).rejects.toThrow("slow down");
    const oldKey = read().offers.recoveryEmailIdempotencyKey;
    await userRef.set({ offers: { recoveryEmailRequestStartedAt: Date.now() - 24 * 60 * 60 * 1000 } });
    const send = jest.fn(async () => ({ data: { id: "retry_later" } }));
    expect(await deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send })).toBe(true);
    expect(read().offers.recoveryEmailIdempotencyKey).not.toBe(oldKey);
});

test("a stale lease owner cannot overwrite the newer delivery state", async () => {
    const { db, userRef, read } = setup();
    const sent = await deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send: async () => {
        await userRef.set({ offers: { recoveryEmailLeaseToken: "new-owner", recoveryEmailStatus: "sending" } });
        return { data: { id: "old-owner-response" } };
    } });
    expect(sent).toBe(false);
    expect(read().offers.recoveryEmailStatus).toBe("sending");
    expect(read().offers.exitOffer40RecoveryEmailId).toBeUndefined();
});

test("accepted emails whose confirmation write fails reuse the same request on retry", async () => {
    const { db, userRef } = setup();
    const run = db.runTransaction;
    let calls = 0;
    db.runTransaction = async (fn: any) => { if (++calls === 2) throw new Error("Firestore unavailable"); return run(fn); };
    const send = jest.fn(async () => ({ data: { id: "accepted_once" } }));
    await expect(deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send })).rejects.toThrow("Firestore unavailable");
    expect(await deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload: { ...payload, text: "changed" }, send })).toBe(true);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
});

test("a later rate limit does not erase uncertainty about an earlier timeout", async () => {
    const { db, userRef, read } = setup();
    await expect(deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send: async () => { throw new Error("timeout"); } })).rejects.toThrow("timeout");
    await expect(deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send: async () => ({ error: { name: "rate_limit_exceeded", message: "slow down" } }) })).rejects.toThrow("slow down");
    expect(read().offers.recoveryEmailConfirmedRejected).toBe(false);
    await userRef.set({ offers: { recoveryEmailRequestStartedAt: Date.now() - 24 * 60 * 60 * 1000 } });
    const send = jest.fn();
    expect(await deliverRecoveryOfferEmail({ db, userRef, variant: "checkout", payload, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
});
