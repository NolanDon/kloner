// app/api/support/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import OpenAI from "openai";
import { getAdminDb } from "../../_lib/auth";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

type Sender = "user" | "ai" | "agent" | "system";

type MessageDoc = {
    sender: Sender;
    text: string;
    createdAt: FirebaseFirestore.FieldValue;
};

const CHAT_COLLECTION = "support_chats";
const SUPPORT_DOC_COLLECTION = "support_doc";

// ---------- small helpers ----------

type SupportDoc = {
    id: string;
    text: string;
    embedding: number[];
};

function cosineSim(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const av = a[i];
        const bv = b[i];
        dot += av * bv;
        na += av * av;
        nb += bv * bv;
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function loadSupportDocs(
    db: FirebaseFirestore.Firestore,
): Promise<SupportDoc[]> {
    const snap = await db.collection(SUPPORT_DOC_COLLECTION).get();
    return snap.docs
        .map((d) => {
            const data = d.data() as any;
            const text = (data.text as string) || "";
            const embedding = (data.embedding as number[]) || [];
            return { id: d.id, text, embedding };
        })
        .filter((d) => d.text && d.embedding && d.embedding.length > 0);
}

async function buildContextFromDocs(question: string): Promise<string | null> {
    const db = getAdminDb();
    const docs = await loadSupportDocs(db);
    if (!docs.length) return null;

    let queryEmbedding: number[] | null = null;
    try {
        const embRes = await client.embeddings.create({
            model: "text-embedding-3-small",
            input: question,
        });
        queryEmbedding = embRes.data[0]?.embedding ?? null;
    } catch (err) {
        console.warn("[support-chat] embedding failed, falling back to no-docs", err);
        return null;
    }

    if (!queryEmbedding) return null;

    const ranked = docs
        .map((doc) => ({
            ...doc,
            score: cosineSim(queryEmbedding!, doc.embedding),
        }))
        .sort((a, b) => b.score - a.score);

    const top = ranked.slice(0, 3);
    if (!top.length || top[0].score < 0.1) return null;

    return top
        .map(
            (d) =>
                `### ${d.id}\n` +
                d.text.trim().slice(0, 3000),
        )
        .join("\n\n---\n\n");
}

// ---------- GET: load chat + messages ----------

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const chatId = searchParams.get("chatId");
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

        const status =
            (chatData.status as "open" | "pending" | "closed" | undefined) || "open";

        const mode = (chatData.mode as "ai" | "agent") || "ai";

        const msgsSnap = await chatRef
            .collection("messages")
            .orderBy("createdAt", "asc")
            .limit(100)
            .get();

        const messages = msgsSnap.docs.map((d) => {
            const data = d.data() as any;
            return {
                id: d.id,
                sender: data.sender as Sender,
                status,
                text: data.text as string,
                createdAt: (data.createdAt?.toDate?.() || new Date()).toISOString(),
            };
        });

        return NextResponse.json({
            ok: true,
            chatId,
            mode,
            messages,
        });
    } catch (err: any) {
        console.error("support chat GET failed", err);
        return NextResponse.json(
            { ok: false, error: "Failed to load chat" },
            { status: 500 },
        );
    }
}

// ---------- POST: add user message + AI reply (with docs) ----------

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const textRaw = typeof body.text === "string" ? body.text.trim() : "";
        const existingChatId =
            typeof body.chatId === "string" ? body.chatId.trim() : "";

        const status =
            (textRaw.status as "open" | "pending" | "closed" | undefined) || "open";

        if (status === "closed") {
            return NextResponse.json(
                {
                    ok: false,
                    error:
                        "This conversation has been closed. Please start a new chat if you need more help.",
                    status: "closed",
                },
                { status: 409 },
            );
        }

        if (!textRaw) {
            return NextResponse.json(
                { ok: false, error: "Missing message text" },
                { status: 400 },
            );
        }

        const db = getAdminDb();
        const uid = (req as any).user?.uid || null;

        let chatRef: FirebaseFirestore.DocumentReference;
        let existingData: any | null = null;

        if (existingChatId) {
            chatRef = db.collection(CHAT_COLLECTION).doc(existingChatId);
            const snap = await chatRef.get();
            existingData = snap.exists ? snap.data() : null;
        } else {
            chatRef = db.collection(CHAT_COLLECTION).doc();
        }

        const now = admin.firestore.FieldValue.serverTimestamp();

        // new chat – initialise mode as "ai"
        if (!existingData) {
            await chatRef.set(
                {
                    userId: uid,
                    createdAt: now,
                    updatedAt: now,
                    mode: "ai",
                    status: "open",
                    lastMessageFrom: "user",
                },
                { merge: true },
            );
        } else {
            // existing chat – DO NOT touch `mode` here
            await chatRef.set(
                {
                    userId: existingData.userId ?? uid ?? null,
                    updatedAt: now,
                    status: existingData.status || "open",
                    lastMessageFrom: "user",
                },
                { merge: true },
            );
        }

        // reload chat to get latest mode (including "agent" after escalation)
        const chatSnap = await chatRef.get();
        const chatData = chatSnap.data() || {};
        const mode = (chatData.mode as "ai" | "agent") || "ai";

        const userMsg: MessageDoc = {
            sender: "user",
            text: textRaw,
            createdAt: now,
        };
        const userMsgRef = await chatRef.collection("messages").add(userMsg);

        let aiMsgId: string | null = null;

        if (mode === "ai") {
            const msgsSnap = await chatRef
                .collection("messages")
                .orderBy("createdAt", "asc")
                .limit(30)
                .get();

            const history = msgsSnap.docs.map((d) => {
                const data = d.data() as any;
                const sender = data.sender as Sender;
                const role =
                    sender === "user"
                        ? "user"
                        : sender === "ai" || sender === "agent"
                            ? "assistant"
                            : "system";
                return {
                    role,
                    text: data.text as string,
                };
            });

            const contextBlob = await buildContextFromDocs(textRaw);

            const messagesForModel: any[] = [];

            const baseSystem =
                "You are the support assistant for Kloner, a tool for cloning and editing websites. " +
                "Answer ONLY using the Kloner docs provided. If the answer is not clearly in the docs, " +
                "say you don't know and suggest the user contact support.";

            messagesForModel.push({
                role: "system",
                content: [{ type: "input_text", text: baseSystem }],
            });

            if (contextBlob) {
                messagesForModel.push({
                    role: "system",
                    content: [
                        {
                            type: "input_text",
                            text: `Kloner support docs:\n\n${contextBlob}`,
                        },
                    ],
                });
            }

            for (const msg of history) {
                const isAssistant = msg.role === "assistant";
                const contentType = isAssistant ? "output_text" : "input_text";
                messagesForModel.push({
                    role: msg.role,
                    content: [
                        {
                            type: contentType,
                            text: msg.text,
                        },
                    ],
                });
            }

            const completion: any = await client.responses.create({
                model: "gpt-4.1-mini",
                input: messagesForModel as any,
            });

            const aiText = String(completion.output_text || "").trim();

            if (aiText) {
                const aiMsg: MessageDoc = {
                    sender: "ai",
                    text: aiText,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                };
                const aiRef = await chatRef.collection("messages").add(aiMsg);
                aiMsgId = aiRef.id;
            }
        }

        await chatRef.set(
            {
                updatedAt: now,
                lastMessageFrom: "user",
            },
            { merge: true },
        );

        const finalSnap = await chatRef
            .collection("messages")
            .orderBy("createdAt", "asc")
            .limit(100)
            .get();

        const messages = finalSnap.docs.map((d) => {
            const data = d.data() as any;
            return {
                id: d.id,
                sender: data.sender as Sender,
                text: data.text as string,
                createdAt: (data.createdAt?.toDate?.() || new Date()).toISOString(),
            };
        });

        return NextResponse.json({
            ok: true,
            chatId: chatRef.id,
            mode,
            messages,
            lastUserId: userMsgRef.id,
            status,
            lastAiId: aiMsgId,
        });
    } catch (err: any) {
        console.error("support chat POST failed", err);
        return NextResponse.json(
            { ok: false, error: "Failed to send message" },
            { status: 500 },
        );
    }
}
