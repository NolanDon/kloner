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
