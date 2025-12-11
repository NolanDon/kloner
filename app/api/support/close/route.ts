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
        const by = body.by === "agent" ? "agent" : "user"; // default to user

        if (!chatId) {
            return NextResponse.json(
                { ok: false, error: "Missing chatId" },
                { status: 400 },
            );
        }

        const db = getAdminDb();
        const chatRef = db.collection(CHAT_COLLECTION).doc(chatId);
        const inboxRef = db.collection(INBOX_COLLECTION).doc(chatId);
        const now = admin.firestore.FieldValue.serverTimestamp();

        // mark chat closed but keep history
        await chatRef.set(
            {
                status: "closed",
                closedAt: now,
                closedBy: by,
                updatedAt: now,
                unreadCount: 0,
            } as any,
            { merge: true },
        );

        // remove from inbox list
        await inboxRef.delete().catch(() => { });

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("support close POST failed", err);
        return NextResponse.json(
            { ok: false, error: "Failed to close chat" },
            { status: 500 },
        );
    }
}
