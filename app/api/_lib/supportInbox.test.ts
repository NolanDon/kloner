// app/api/_lib/supportInbox.test.ts
import crypto from "node:crypto";
import {
    extractReferencedMessageIds,
    makeSnippet,
    normalizeMessageId,
    normalizeSubject,
    parseEmailAddress,
    recipientsIncludeSupport,
    replySubject,
    verifySvixSignature,
} from "./supportInbox";

const SECRET_KEY = Buffer.from("test-signing-key-0123456789abcdef");
const SECRET = `whsec_${SECRET_KEY.toString("base64")}`;

function sign(secret: string, msgId: string, timestamp: string, body: string): string {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const sig = crypto.createHmac("sha256", key).update(`${msgId}.${timestamp}.${body}`).digest("base64");
    return `v1,${sig}`;
}

describe("verifySvixSignature", () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
    const now = 1_763_000_000;

    it("accepts a correctly signed payload", () => {
        const ts = String(now);
        expect(
            verifySvixSignature({
                secret: SECRET,
                msgId: "msg_1",
                timestamp: ts,
                signatureHeader: sign(SECRET, "msg_1", ts, body),
                body,
                nowSeconds: now,
            })
        ).toBe(true);
    });

    it("accepts when one of several signatures matches", () => {
        const ts = String(now);
        const header = `v1,${Buffer.from("junk").toString("base64")} ${sign(SECRET, "msg_1", ts, body)}`;
        expect(
            verifySvixSignature({
                secret: SECRET,
                msgId: "msg_1",
                timestamp: ts,
                signatureHeader: header,
                body,
                nowSeconds: now,
            })
        ).toBe(true);
    });

    it("rejects a tampered body", () => {
        const ts = String(now);
        expect(
            verifySvixSignature({
                secret: SECRET,
                msgId: "msg_1",
                timestamp: ts,
                signatureHeader: sign(SECRET, "msg_1", ts, body),
                body: body + " ",
                nowSeconds: now,
            })
        ).toBe(false);
    });

    it("rejects the wrong secret", () => {
        const ts = String(now);
        const other = `whsec_${Buffer.from("another-key").toString("base64")}`;
        expect(
            verifySvixSignature({
                secret: other,
                msgId: "msg_1",
                timestamp: ts,
                signatureHeader: sign(SECRET, "msg_1", ts, body),
                body,
                nowSeconds: now,
            })
        ).toBe(false);
    });

    it("rejects a stale timestamp", () => {
        const ts = String(now - 3600);
        expect(
            verifySvixSignature({
                secret: SECRET,
                msgId: "msg_1",
                timestamp: ts,
                signatureHeader: sign(SECRET, "msg_1", ts, body),
                body,
                nowSeconds: now,
            })
        ).toBe(false);
    });

    it("rejects missing pieces", () => {
        expect(
            verifySvixSignature({ secret: "", msgId: "m", timestamp: "1", signatureHeader: "v1,x", body })
        ).toBe(false);
        expect(
            verifySvixSignature({ secret: SECRET, msgId: "", timestamp: "1", signatureHeader: "v1,x", body })
        ).toBe(false);
    });
});

describe("parseEmailAddress", () => {
    it("parses a display-name address", () => {
        expect(parseEmailAddress("Jane Doe <Jane@Example.com>")).toEqual({
            email: "jane@example.com",
            name: "Jane Doe",
        });
    });
    it("parses a bare address", () => {
        expect(parseEmailAddress("  Bob@Example.com ")).toEqual({ email: "bob@example.com", name: null });
    });
});

describe("recipientsIncludeSupport", () => {
    it("matches the bare support address", () => {
        expect(recipientsIncludeSupport(["support@kloner.app"])).toBe(true);
    });
    it("matches with a display name and different case", () => {
        expect(recipientsIncludeSupport(["Kloner Support <Support@Kloner.App>"])).toBe(true);
    });
    it("does not match other addresses", () => {
        expect(recipientsIncludeSupport(["hello@kloner.app", "nolan@kloner.app"])).toBe(false);
        expect(recipientsIncludeSupport([])).toBe(false);
        expect(recipientsIncludeSupport(undefined)).toBe(false);
    });
});

describe("subjects", () => {
    it("strips reply and forward prefixes", () => {
        expect(normalizeSubject("Re: Fwd: Re: Help with my site")).toBe("Help with my site");
        expect(normalizeSubject("Help")).toBe("Help");
        expect(normalizeSubject("")).toBe("(no subject)");
        expect(normalizeSubject(undefined)).toBe("(no subject)");
    });
    it("builds a reply subject", () => {
        expect(replySubject("Help with my site")).toBe("Re: Help with my site");
        expect(replySubject("Re: Help with my site")).toBe("Re: Help with my site");
    });
});

describe("message id helpers", () => {
    it("normalizes bare ids into brackets", () => {
        expect(normalizeMessageId("abc@host")).toBe("<abc@host>");
        expect(normalizeMessageId("<abc@host>")).toBe("<abc@host>");
    });
    it("extracts referenced ids case-insensitively and de-duplicated", () => {
        const headers = {
            "In-Reply-To": "<b@host>",
            References: "<a@host> <b@host> <c@host>",
            Subject: "ignored",
        };
        expect(extractReferencedMessageIds(headers)).toEqual(["<b@host>", "<a@host>", "<c@host>"]);
        expect(extractReferencedMessageIds(null)).toEqual([]);
        expect(extractReferencedMessageIds({})).toEqual([]);
    });
});

describe("makeSnippet", () => {
    it("collapses whitespace and truncates", () => {
        expect(makeSnippet("hello\n\n  world")).toBe("hello world");
        const long = "x".repeat(300);
        expect(makeSnippet(long).length).toBe(140);
        expect(makeSnippet(null)).toBe("");
    });
});
