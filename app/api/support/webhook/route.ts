// app/api/support/webhook/route.ts
// Resend inbound webhook. Resend posts metadata only for email.received;
// the full message is fetched from the Receiving API. Mail addressed to
// support@kloner.app is stored as an inbox thread; anything else on the
// domain is forwarded to the owner's mailbox, matching what Cloudflare
// Email Routing did before the move.
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminDb } from "../../_lib/auth";
import {
    FORWARD_FROM,
    FORWARD_TO_EMAIL,
    parseEmailAddress,
    recipientsIncludeSupport,
    verifySvixSignature,
    type ReceivedEmail,
} from "../../_lib/supportInbox";
import { storeInboundEmail } from "../../_lib/supportInboxStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function resendApiKey(): string | null {
    return process.env.RESEND_INBOX_API_KEY || process.env.RESEND_API_KEY || null;
}

async function fetchReceivedEmail(emailId: string, apiKey: string): Promise<ReceivedEmail> {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`Resend receiving fetch failed (${res.status})`);
    return (await res.json()) as ReceivedEmail;
}

async function forwardEmail(email: ReceivedEmail, apiKey: string): Promise<void> {
    const resend = new Resend(apiKey);
    const sender = parseEmailAddress(email.from);
    const header = `Forwarded from ${(email.to || []).join(", ") || "kloner.app"}\nOriginal sender: ${email.from}\n\n`;
    const result = await resend.emails.send({
        from: FORWARD_FROM,
        to: [FORWARD_TO_EMAIL],
        replyTo: sender.email || undefined,
        subject: email.subject || "(no subject)",
        text: header + (email.text || ""),
        html: email.html || undefined,
    });
    if (result?.error || !result?.data?.id) {
        throw new Error(result?.error?.message || "Forward send failed");
    }
}

export async function POST(req: NextRequest) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
        return NextResponse.json({ error: "webhook_not_configured" }, { status: 500 });
    }

    const body = await req.text();
    const verified = verifySvixSignature({
        secret,
        msgId: req.headers.get("svix-id") || "",
        timestamp: req.headers.get("svix-timestamp") || "",
        signatureHeader: req.headers.get("svix-signature") || "",
        body,
    });
    if (!verified) {
        return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
    }

    let event: any;
    try {
        event = JSON.parse(body);
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    if (event?.type !== "email.received") {
        return NextResponse.json({ ok: true, ignored: true });
    }

    const emailId = event?.data?.email_id;
    if (typeof emailId !== "string" || !emailId) {
        return NextResponse.json({ error: "missing_email_id" }, { status: 400 });
    }

    const apiKey = resendApiKey();
    if (!apiKey) {
        return NextResponse.json({ error: "resend_not_configured" }, { status: 500 });
    }

    try {
        const email = await fetchReceivedEmail(emailId, apiKey);
        if (recipientsIncludeSupport(email.to)) {
            const db = getAdminDb();
            const result = await storeInboundEmail(db, email);
            return NextResponse.json({
                ok: true,
                stored: true,
                threadId: result.threadId,
                duplicate: result.duplicate,
            });
        }
        await forwardEmail(email, apiKey);
        return NextResponse.json({ ok: true, forwarded: true });
    } catch (err) {
        // A 500 makes Resend retry the delivery, so transient failures
        // (Receiving API, Firestore, forward send) do not lose mail.
        console.error("[support-webhook] processing failed", err);
        return NextResponse.json({ error: "processing_failed" }, { status: 500 });
    }
}
