// app/api/support/close/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "../../_lib/auth";

const CHAT_COLLECTION = "support_chats";
const INBOX_COLLECTION = "support_inbox";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
        const by =
            body.by === "agent" || body.by === "user" || body.by === "system"
                ? body.by
                : "user";

        if (!chatId) {
            return NextResponse.json({ ok: false, error: "Missing chatId" }, { status: 400 });
        }

        const db = getAdminDb();
        const nowTs = admin.firestore.Timestamp.now();

        const chatRef = db.collection(CHAT_COLLECTION).doc(chatId);
        const inboxRef = db.collection(INBOX_COLLECTION).doc(chatId);

        await chatRef.set(
            {
                status: "closed",
                closedAt: nowTs,
                closedBy: by,
                updatedAt: nowTs,
                unreadCount: 0,
                inactivityPromptAt: admin.firestore.FieldValue.delete(),
                pendingAutoCloseAt: admin.firestore.FieldValue.delete(),
            } as any,
            { merge: true }
        );

        await inboxRef.set(
            {
                status: "closed",
                closedAt: nowTs,
                closedBy: by,
                updatedAt: nowTs,
                unreadCount: 0,
            } as any,
            { merge: true }
        );

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("support close POST failed", err);
        return NextResponse.json({ ok: false, error: "Failed to close chat" }, { status: 500 });
    }
}
