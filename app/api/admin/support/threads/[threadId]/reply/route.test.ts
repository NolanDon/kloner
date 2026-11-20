// app/api/admin/support/threads/[threadId]/reply/route.test.ts

export {};

const resendSend = jest.fn();
const requireAdmin = jest.fn();
const getThread = jest.fn();
const listMessages = jest.fn();
const appendOutboundMessage = jest.fn();

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

jest.mock("../../../../../_lib/auth", () => ({
    __esModule: true,
    requireAdmin: (...args: any[]) => requireAdmin(...args),
    getAdminDb: () => ({ __fake: true }),
}));

jest.mock("../../../../../_lib/supportInboxStore", () => ({
    __esModule: true,
    getThread: (...args: any[]) => getThread(...args),
    listMessages: (...args: any[]) => listMessages(...args),
    appendOutboundMessage: (...args: any[]) => appendOutboundMessage(...args),
}));

import { POST } from "./route";

function makeReq(body: unknown) {
    return {
        json: async () => body,
        headers: { get: () => null },
    } as any;
}

const context = { params: Promise.resolve({ threadId: "thread_1" }) };

const thread = {
    id: "thread_1",
    subject: "Help with my site",
    normalizedSubject: "Help with my site",
    fromEmail: "jane@example.com",
    fromName: "Jane Doe",
    status: "open",
    unread: false,
    snippet: "",
    messageIds: ["<m1@example.com>"],
    messageCount: 1,
    lastMessageAt: 1000,
    createdAt: 1000,
};

describe("support reply route", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.RESEND_API_KEY = "re_test";
        delete process.env.RESEND_INBOX_API_KEY;
        requireAdmin.mockResolvedValue({ ok: true, uid: "admin_1" });
        getThread.mockResolvedValue(thread);
        listMessages.mockResolvedValue([
            { id: "msg_1", direction: "in", messageId: "<m1@example.com>" },
        ]);
        resendSend.mockResolvedValue({ data: { id: "sent_1" }, error: null });
        appendOutboundMessage.mockResolvedValue(undefined);
    });

    afterEach(() => {
        delete process.env.RESEND_API_KEY;
    });

    it("sends the reply as support@kloner.app, threaded, and stores it", async () => {
        const res: any = await POST(makeReq({ text: "Fixed. Try again." }), context);
        expect(res.status).toBe(200);
        expect(resendSend).toHaveBeenCalledWith({
            from: "Kloner Support <support@kloner.app>",
            to: ["jane@example.com"],
            subject: "Re: Help with my site",
            text: "Fixed. Try again.",
            headers: { "In-Reply-To": "<m1@example.com>", References: "<m1@example.com>" },
        });
        expect(appendOutboundMessage).toHaveBeenCalledWith(
            expect.anything(),
            "thread_1",
            expect.objectContaining({ to: "jane@example.com", resendId: "sent_1" })
        );
    });

    it("blocks non-admins", async () => {
        requireAdmin.mockResolvedValue({ ok: false });
        const res: any = await POST(makeReq({ text: "Hi" }), context);
        expect(res.status).toBe(403);
        expect(resendSend).not.toHaveBeenCalled();
    });

    it("rejects an empty reply", async () => {
        const res: any = await POST(makeReq({ text: "   " }), context);
        expect(res.status).toBe(400);
        expect(resendSend).not.toHaveBeenCalled();
    });

    it("returns 404 for a missing thread", async () => {
        getThread.mockResolvedValue(null);
        const res: any = await POST(makeReq({ text: "Hi" }), context);
        expect(res.status).toBe(404);
        expect(resendSend).not.toHaveBeenCalled();
    });

    it("returns 502 and stores nothing when Resend rejects the send", async () => {
        resendSend.mockResolvedValue({ data: null, error: { message: "Domain not verified" } });
        const res: any = await POST(makeReq({ text: "Hi" }), context);
        expect(res.status).toBe(502);
        expect(appendOutboundMessage).not.toHaveBeenCalled();
    });
});
