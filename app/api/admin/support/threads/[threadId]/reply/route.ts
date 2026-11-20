// app/api/admin/support/threads/[threadId]/reply/route.ts
// Sends a reply as support@kloner.app through Resend and stores it on the
// thread. In-Reply-To / References headers keep the conversation threaded
// in the customer's mail app.
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminDb, requireAdmin } from "../../../../../_lib/auth";
import { SUPPORT_FROM, replySubject } from "../../../../../_lib/supportInbox";
import {
    appendOutboundMessage,
    getThread,
    listMessages,
} from "../../../../../_lib/supportInboxStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ threadId: string }> };

const MAX_REPLY_CHARS = 20_000;

export async function POST(req: NextRequest, context: RouteContext) {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
        return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
    }
    const { threadId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
        return NextResponse.json({ ok: false, error: "Write a reply first." }, { status: 400 });
    }
    if (text.length > MAX_REPLY_CHARS) {
        return NextResponse.json({ ok: false, error: "That reply is too long." }, { status: 400 });
    }

    const apiKey = process.env.RESEND_INBOX_API_KEY || process.env.RESEND_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ ok: false, error: "Email sending is not configured." }, { status: 500 });
    }

    const db = getAdminDb();
    const thread = await getThread(db, threadId);
    if (!thread) {
        return NextResponse.json({ ok: false, error: "Thread not found." }, { status: 404 });
    }

    const messages = await listMessages(db, threadId);
    const lastInbound = [...messages].reverse().find((m) => m.direction === "in" && m.messageId);
    const headers: Record<string, string> = {};
    if (lastInbound?.messageId) headers["In-Reply-To"] = lastInbound.messageId;
    if (thread.messageIds.length) headers["References"] = thread.messageIds.join(" ");

    const subject = replySubject(thread.subject);
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
        from: SUPPORT_FROM,
        to: [thread.fromEmail],
        subject,
        text,
        headers: Object.keys(headers).length ? headers : undefined,
    });
    if (result?.error || !result?.data?.id) {
        return NextResponse.json(
            { ok: false, error: result?.error?.message || "The reply could not be sent." },
            { status: 502 }
        );
    }

    await appendOutboundMessage(db, threadId, {
        from: SUPPORT_FROM,
        to: thread.fromEmail,
        subject,
        text,
        resendId: result.data.id,
    });
    return NextResponse.json(
        { ok: true, resendId: result.data.id },
        { headers: { "Cache-Control": "no-store" } }
    );
}
