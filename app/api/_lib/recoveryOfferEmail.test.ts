import { buildRecoveryOfferEmail } from "./recoveryOfferEmail";

const base = { linkUrl: "https://kloner.app/checkout?a=1&b=2", unsubUrl: "https://kloner.app/unsubscribe", variant: "checkout" as const };

test("personalizes subjects with a real first name and assigns a stable variant", () => {
    const first = buildRecoveryOfferEmail({ ...base, name: "Dana Example", seed: "user-123" });
    expect(first).toEqual(buildRecoveryOfferEmail({ ...base, name: "Dana Example", seed: "user-123" }));
    expect(buildRecoveryOfferEmail({ ...base, name: "Dana Example" }).subject).toBe("Psssst, Dana — your Kloner checkout");
    expect(first.text).toContain("just reply");
    expect(first.text).not.toMatch(/card was declined|payment failed/i);
});

test("untrusted names cannot inject headers or email HTML", () => {
    const email = buildRecoveryOfferEmail({ ...base, name: '<img src=x onerror=alert(1)>\r\nBcc: other@example.com' });
    expect(email.subject).toBe("Psssst, there — your Kloner checkout");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("a=1&amp;b=2");
    expect(buildRecoveryOfferEmail({ ...base, name: "O'Neil" }).html).toContain("O&#39;Neil");
});

test("supports international names without inventing a name from an email address", () => {
    expect(buildRecoveryOfferEmail({ ...base, name: "Émilie Dupont" }).subject).toContain("Émilie");
    expect(buildRecoveryOfferEmail({ ...base, name: "random123@example.com" }).subject).toContain("there");
});
