// app/api/support/escalate/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { getAdminDb } from "../../_lib/auth";

const CHAT_COLLECTION = "support_chats";
const INBOX_COLLECTION = "support_inbox";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";

        if (!chatId) {
            return NextResponse.json(
                { ok: false, error: "Missing chatId" },
                { status: 400 },
            );
        }

        const db = getAdminDb();
        const chatRef = db.collection(CHAT_COLLECTION).doc(chatId);
        const chatSnap = await chatRef.get();

        if (!chatSnap.exists) {
            return NextResponse.json(
                { ok: false, error: "Chat not found" },
                { status: 404 },
            );
        }

        const chatData = chatSnap.data() || {};
        const now = admin.firestore.FieldValue.serverTimestamp();

        // Flip chat into agent mode
        await chatRef.set(
            {
                mode: "agent",
                status: "open",
                updatedAt: now,
            },
            { merge: true },
        );

        // Seed /support_inbox/{chatId}
        const inboxRef = db.collection(INBOX_COLLECTION).doc(chatId);

        await inboxRef.set(
            {
                mode: "agent",
                status: "open",
                userId: chatData.userId ?? null,
                createdAt: chatData.createdAt || now,
                updatedAt: now,
                lastMessage: chatData.lastMessage ?? "",       // optional, can stay empty
                lastMessageFrom: chatData.lastMessageFrom ?? "user",
                unreadCount: admin.firestore.FieldValue.increment(1),
                assignedTo: null,
            },
            { merge: true },
        );

        return NextResponse.json({ ok: true, mode: "agent" });
    } catch (err) {
        console.error("support escalate POST failed", err);
        return NextResponse.json(
            { ok: false, error: "Failed to escalate" },
            { status: 500 },
        );
    }
}
