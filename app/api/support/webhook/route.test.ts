// app/api/support/webhook/route.test.ts

export {};

import crypto from "node:crypto";

const resendSend = jest.fn();
const storeInboundEmail = jest.fn();
const fakeDb = { __fake: true };

jest.mock("next/server", () => ({
    __esModule: true,
    NextResponse: {
        json: (body: any, init?: { status?: number }) => ({
            status: init?.status ?? 200,
            async json() {
                return body;
            },
        }),
    },
}));

jest.mock("resend", () => ({
    __esModule: true,
    Resend: jest.fn(() => ({ emails: { send: resendSend } })),
}));

jest.mock("../../_lib/auth", () => ({
    __esModule: true,
    getAdminDb: () => fakeDb,
}));

jest.mock("../../_lib/supportInboxStore", () => ({
    __esModule: true,
    storeInboundEmail: (...args: any[]) => storeInboundEmail(...args),
}));

import { POST } from "./route";

const SECRET = `whsec_${Buffer.from("route-test-key-0123456789abcdef").toString("base64")}`;

function sign(body: string, msgId = "msg_1", ts = String(Math.floor(Date.now() / 1000))): Record<string, string> {
    const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
    const sig = crypto.createHmac("sha256", key).update(`${msgId}.${ts}.${body}`).digest("base64");
    return { "svix-id": msgId, "svix-timestamp": ts, "svix-signature": `v1,${sig}` };
}

function makeReq(body: string, headers: Record<string, string>) {
    return {
        text: async () => body,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    } as any;
}

const receivedEmail = {
    id: "resend_email_1",
    from: "Jane Doe <jane@example.com>",
    to: ["support@kloner.app"],
    subject: "Help with my site",
    text: "My site will not publish.",
    html: null,
    message_id: "<m1@example.com>",
    headers: {},
    attachments: [],
};

function eventBody(type = "email.received", emailId = "resend_email_1"): string {
    return JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: emailId } });
}

describe("support webhook route", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.RESEND_WEBHOOK_SECRET = SECRET;
        process.env.RESEND_API_KEY = "re_test";
        delete process.env.RESEND_INBOX_API_KEY;
        (globalThis as any).fetch = fetchMock;
        fetchMock.mockResolvedValue({ ok: true, json: async () => receivedEmail });
        storeInboundEmail.mockResolvedValue({ threadId: "thread_1", created: true, duplicate: false });
        resendSend.mockResolvedValue({ data: { id: "sent_1" }, error: null });
    });

    afterEach(() => {
        delete process.env.RESEND_WEBHOOK_SECRET;
        delete process.env.RESEND_API_KEY;
    });

    it("stores a support email after verifying the signature", async () => {
        const body = eventBody();
        const res: any = await POST(makeReq(body, sign(body)));
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ ok: true, stored: true, threadId: "thread_1" });
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.resend.com/emails/receiving/resend_email_1",
            expect.objectContaining({ headers: { Authorization: "Bearer re_test" } })
        );
        expect(storeInboundEmail).toHaveBeenCalledWith(fakeDb, receivedEmail);
        expect(resendSend).not.toHaveBeenCalled();
    });

    it("rejects a bad signature before doing any work", async () => {
        const body = eventBody();
        const headers = sign(body);
        headers["svix-signature"] = `v1,${Buffer.from("forged").toString("base64")}`;
        const res: any = await POST(makeReq(body, headers));
        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(storeInboundEmail).not.toHaveBeenCalled();
    });

    it("forwards mail that is not addressed to support", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ ...receivedEmail, to: ["hello@kloner.app"] }),
        });
        const body = eventBody();
        const res: any = await POST(makeReq(body, sign(body)));
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ ok: true, forwarded: true });
        expect(storeInboundEmail).not.toHaveBeenCalled();
        expect(resendSend).toHaveBeenCalledWith(
            expect.objectContaining({ to: ["nolan.donb@gmail.com"], replyTo: "jane@example.com" })
        );
    });

    it("ignores events that are not email.received", async () => {
        const body = eventBody("email.delivered");
        const res: any = await POST(makeReq(body, sign(body)));
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ ok: true, ignored: true });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns 500 when the Receiving API fails so Resend retries", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
        const body = eventBody();
        const res: any = await POST(makeReq(body, sign(body)));
        expect(res.status).toBe(500);
        expect(storeInboundEmail).not.toHaveBeenCalled();
    });

    it("returns 500 when the webhook secret is not configured", async () => {
        delete process.env.RESEND_WEBHOOK_SECRET;
        const body = eventBody();
        const res: any = await POST(makeReq(body, sign(body)));
        expect(res.status).toBe(500);
    });
});
