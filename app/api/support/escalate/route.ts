// app/api/support/escalate/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";

function getDb() {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
        });
    }
    return admin.firestore();
}

const CHAT_COLLECTION = "support_chats";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const chatId =
            typeof body.chatId === "string" ? body.chatId.trim() : "";

        if (!chatId) {
            return NextResponse.json(
                { ok: false, error: "Missing chatId" },
                { status: 400 }
            );
        }

        const db = getDb();
        const chatRef = db.collection(CHAT_COLLECTION).doc(chatId);
        const snap = await chatRef.get();

        if (!snap.exists) {
            return NextResponse.json(
                { ok: false, error: "Chat not found" },
                { status: 404 }
            );
        }

        await chatRef.set(
            {
                mode: "agent",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        // Optional: record a system event inside messages
        await chatRef.collection("messages").add({
            sender: "system",
            text: "User requested a human agent.",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return NextResponse.json({ ok: true, mode: "agent" });
    } catch (err: any) {
        console.error("support escalate failed", err);
        return NextResponse.json(
            { ok: false, error: "Failed to escalate" },
            { status: 500 }
        );
    }
}
