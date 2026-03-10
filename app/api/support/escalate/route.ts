// app/api/support/escalate/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { Resend } from "resend";
import { getAdminDb } from "../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { captureCriticalEvent, captureException } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const CHAT_COLLECTION = "support_chats";
const INBOX_COLLECTION = "support_inbox";

const CONNECTING_TEXT = "__CONNECTING__";

function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY env not set");
    return new Resend(key);
}

function buildEscalationHtml(args: {
    chatId: string;
    userId?: string | null;
    lastMessage?: string | null;
    whenIso: string;
}) {
    const accent = "#f55f2a";
    const dark = "#111827";
    const muted = "#6b7280";

    return `
<!doctype html>
<html lang="en">
  <head><meta charSet="utf-8" /><title>Kloner Support Escalation</title></head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:24px 0;background:#ffffff;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;border:1px solid #fee2d5;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:18px 24px;background:${accent};">
                <div style="font-size:14px;font-weight:700;color:#ffffff;">Support escalation</div>
                <div style="margin-top:4px;font-size:12px;color:#ffe7dc;">A user requested a human in chat.</div>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 24px;">
                <div style="font-size:12px;color:${muted};margin-bottom:8px;">Chat</div>
                <div style="font-size:13px;color:${dark};font-weight:600;">${args.chatId}</div>

                <div style="margin-top:14px;font-size:12px;color:${muted};margin-bottom:8px;">User</div>
                <div style="font-size:13px;color:${dark};font-weight:600;">${args.userId || "Anonymous"}</div>

                <div style="margin-top:14px;font-size:12px;color:${muted};margin-bottom:8px;">Last message</div>
                <div style="font-size:13px;color:${dark};line-height:1.6;white-space:pre-wrap;border:1px solid #f3f4f6;border-radius:12px;padding:12px;background:#fafafa;">
                  ${String(args.lastMessage || "").replace(/[<>]/g, "")}
                </div>

                <div style="margin-top:14px;font-size:12px;color:${muted};">Time</div>
                <div style="font-size:12px;color:${dark};margin-top:4px;">${args.whenIso}</div>

                <div style="margin-top:18px;">
                  <a href="https://kloner.app/support/agent/${encodeURIComponent(
        args.chatId,
    )}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:999px;">
                    Open agent thread
                  </a>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 24px;background:#fff7f3;border-top:1px solid #fee2d5;">
                <div style="font-size:11px;color:#9ca3af;">Kloner Support</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

export async function POST(req: NextRequest) {
  return requireSessionAndMaybeCsrf(
    req,
    async ({ uid }) => {
      try {
        const body = await req.json().catch(() => ({}));
        const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";

        if (!chatId) {
          await captureCriticalEvent({
            source: "vercel",
            severity: "error",
            statusCode: 400,
            route: req.nextUrl?.pathname,
            method: "POST",
            action: "support.escalate",
            message: "Missing chatId",
            service: "support-chat",
            url: req.url,
            userId: uid,
          });
          return NextResponse.json(
            { ok: false, error: "Missing chatId" },
            { status: 400 },
          );
        }

        const db = getAdminDb();
        const chatRef = db.collection(CHAT_COLLECTION).doc(chatId);
        const chatSnap = await chatRef.get();

        if (!chatSnap.exists) {
          await captureCriticalEvent({
            source: "vercel",
            severity: "error",
            statusCode: 404,
            route: req.nextUrl?.pathname,
            method: "POST",
            action: "support.escalate",
            message: "Chat not found",
            service: "support-chat",
            url: req.url,
            userId: uid,
            extra: { chatId },
          });
          return NextResponse.json(
            { ok: false, error: "Chat not found" },
            { status: 404 },
          );
        }

        const chatData = chatSnap.data() || {};
        const existingUserId = typeof chatData.userId === "string" ? chatData.userId : null;
        if (existingUserId && existingUserId !== uid) {
          return NextResponse.json(
            { ok: false, error: "Forbidden" },
            { status: 403 },
          );
        }

        const nowTs = admin.firestore.Timestamp.now();
        const resolvedUserId = existingUserId || uid;

        // Move into agent lane, but "pending" until an agent actually picks it up.
        await chatRef.set(
          {
            userId: resolvedUserId,
            mode: "agent",
            status: "pending",
            updatedAt: nowTs,
            lastActivityAt: nowTs,
            connectingSince: nowTs,

            // stop any inactivity timers immediately
            inactivityPromptAt: admin.firestore.FieldValue.delete(),
            pendingAutoCloseAt: admin.firestore.FieldValue.delete(),
          } as any,
          { merge: true },
        );

        // Persist a connecting system message in Firestore (so it doesn't "disappear" on polling).
        await chatRef.collection("messages").add({
          sender: "system",
          text: CONNECTING_TEXT,
          createdAt: nowTs,
        });

        await chatRef.set(
          {
            lastMessageFrom: "system",
            lastMessage: CONNECTING_TEXT,
            lastMessageAt: nowTs,
          } as any,
          { merge: true },
        );

        // Seed /support_inbox/{chatId}
        const inboxRef = db.collection(INBOX_COLLECTION).doc(chatId);
        await inboxRef.set(
          {
            mode: "agent",
            status: "pending",
            userId: resolvedUserId,
            createdAt: chatData.createdAt || nowTs,
            updatedAt: nowTs,
            lastMessage: CONNECTING_TEXT,
            lastMessageFrom: "system",
            unreadCount: admin.firestore.FieldValue.increment(1),
            assignedTo: null,
            connectingSince: nowTs,
          } as any,
          { merge: true },
        );

        // Email support
        try {
          const resend = getResend();
          const to = "support@kloner.app";
          const from = process.env.SUPPORT_ESCALATION_FROM || "hello@kloner.app";

          const whenIso = new Date().toISOString();
          const subject = `Kloner support escalation: ${chatId}`;

          const html = buildEscalationHtml({
            chatId,
            userId: resolvedUserId,
            lastMessage: chatData.lastMessage ?? null,
            whenIso,
          });

          const text =
            `Support escalation\n\n` +
            `Chat: ${chatId}\n` +
            `User: ${resolvedUserId || "Anonymous"}\n` +
            `Time: ${whenIso}\n\n` +
            `Open: https://kloner.app/support/agent/${chatId}\n`;

          const result = await resend.emails.send({
            from,
            to,
            subject,
            text,
            html,
          });

          if ("error" in result && result.error) {
            console.error("Resend error (escalation):", result.error);
          }
        } catch (e) {
          console.error("Escalation email failed:", e);
        }

        return NextResponse.json({ ok: true, mode: "agent", status: "pending" });
      } catch (err) {
        console.error("support escalate POST failed", err);
        await captureException({
          source: "vercel",
          error: err,
          route: req.nextUrl?.pathname,
          method: "POST",
          action: "support.escalate",
          statusCode: 500,
          service: "support-chat",
          url: req.url,
          userId: uid,
        });
        return NextResponse.json(
          { ok: false, error: "Failed to escalate" },
          { status: 500 },
        );
      }
    },
    { methods: ["POST"] },
  );
}
