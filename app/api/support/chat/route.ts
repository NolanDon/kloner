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
    createdAt: FirebaseFirestore.Timestamp;
};

const CHAT_COLLECTION = "support_chats";
const SUPPORT_DOC_COLLECTION = "support_doc";

// ---------- inactivity controls ----------
const INACTIVITY_PROMPT_MS = 10 * 1000; // 10s
const INACTIVITY_AUTO_CLOSE_MS = 30 * 1000; // 30s
const PROMPT_GRACE_MS = 10 * 1000; // 10s

const STILL_THERE_TEXT =
    "Still there? Reply to keep this chat open. If you don’t respond, it will auto-close soon.";

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

async function loadSupportDocs(db: FirebaseFirestore.Firestore): Promise<SupportDoc[]> {
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
        .map((doc) => ({ ...doc, score: cosineSim(queryEmbedding!, doc.embedding) }))
        .sort((a, b) => b.score - a.score);

    const top = ranked.slice(0, 3);
    if (!top.length || top[0].score < 0.1) return null;

    return top
        .map((d) => `### ${d.id}\n` + d.text.trim().slice(0, 3000))
        .join("\n\n---\n\n");
}

function tsToMs(v: any): number | null {
    try {
        if (!v) return null;
        if (typeof v === "number") return Number.isFinite(v) ? v : null;
        if (typeof v?.toMillis === "function") return v.toMillis();
        if (typeof v?.toDate === "function") return v.toDate().getTime();
        return null;
    } catch {
        return null;
    }
}

async function maybeAutoManageInactivity(
    chatRef: FirebaseFirestore.DocumentReference,
    chatData: any,
) {
    const status =
        (chatData.status as "open" | "pending" | "closed" | undefined) || "open";
    if (status === "closed") return;

    const mode = (chatData.mode as "ai" | "agent" | undefined) || "ai";

    // Never prompt/close while waiting for a human or during live agent mode.
    // This prevents inbox entries "disappearing" (status flipping to closed) while connecting.
    if (mode === "agent" || status === "pending") {
        const hasTimers =
            chatData.inactivityPromptAt != null || chatData.pendingAutoCloseAt != null;
        if (hasTimers) {
            const nowTs = admin.firestore.Timestamp.now();
            await chatRef.set(
                {
                    updatedAt: nowTs,
                    lastActivityAt: nowTs,
                    inactivityPromptAt: admin.firestore.FieldValue.delete(),
                    pendingAutoCloseAt: admin.firestore.FieldValue.delete(),
                } as any,
                { merge: true },
            );
        }
        return;
    }

    const nowMs = Date.now();
    const nowTs = admin.firestore.Timestamp.now();

    let lastActivityMs =
        tsToMs(chatData.lastActivityAt) ??
        tsToMs(chatData.updatedAt) ??
        tsToMs(chatData.lastMessageAt) ??
        null;

    if (!lastActivityMs) {
        const lastMsgSnap = await chatRef
            .collection("messages")
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();
        const lastMsg = lastMsgSnap.docs[0]?.data() as any;
        lastActivityMs = tsToMs(lastMsg?.createdAt) ?? null;
    }
    if (!lastActivityMs) return;

    const idleMs = nowMs - lastActivityMs;

    const pendingAutoCloseAtMs = tsToMs(chatData.pendingAutoCloseAt);
    if (pendingAutoCloseAtMs && nowMs >= pendingAutoCloseAtMs) {
        await chatRef.set(
            {
                status: "closed",
                closedAt: nowTs,
                closedBy: "system",
                updatedAt: nowTs,
                lastActivityAt: nowTs,
                inactivityPromptAt: admin.firestore.FieldValue.delete(),
                pendingAutoCloseAt: admin.firestore.FieldValue.delete(),
            } as any,
            { merge: true },
        );
        return;
    }

    if (idleMs >= INACTIVITY_AUTO_CLOSE_MS) {
        await chatRef.set(
            {
                status: "closed",
                closedAt: nowTs,
                closedBy: "system",
                updatedAt: nowTs,
                lastActivityAt: nowTs,
                inactivityPromptAt: admin.firestore.FieldValue.delete(),
                pendingAutoCloseAt: admin.firestore.FieldValue.delete(),
            } as any,
            { merge: true },
        );
        return;
    }

    if (idleMs >= INACTIVITY_PROMPT_MS) {
        const inactivityPromptAtMs = tsToMs(chatData.inactivityPromptAt);
        const promptRecently =
            inactivityPromptAtMs != null && nowMs - inactivityPromptAtMs < INACTIVITY_PROMPT_MS;

        if (!promptRecently) {
            const promptMsg: MessageDoc = {
                sender: "system",
                text: STILL_THERE_TEXT,
                createdAt: nowTs,
            };

            await chatRef.collection("messages").add(promptMsg);

            await chatRef.set(
                {
                    updatedAt: nowTs,
                    lastActivityAt: nowTs,
                    inactivityPromptAt: nowTs,
                    pendingAutoCloseAt: admin.firestore.Timestamp.fromMillis(
                        nowMs + PROMPT_GRACE_MS,
                    ),
                    lastMessageFrom: "system",
                    lastMessage: STILL_THERE_TEXT,
                    lastMessageAt: nowTs,
                } as any,
                { merge: true },
            );
        }
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const chatId = searchParams.get("chatId");
        if (!chatId) {
            return NextResponse.json({ ok: false, error: "Missing chatId" }, { status: 400 });
        }

        const db = getAdminDb();
        const chatRef = db.collection(CHAT_COLLECTION).doc(chatId);
        const chatSnap = await chatRef.get();
        if (!chatSnap.exists) {
            return NextResponse.json({ ok: false, error: "Chat not found" }, { status: 404 });
        }

        const chatDataBefore = chatSnap.data() || {};
        await maybeAutoManageInactivity(chatRef, chatDataBefore);

        const chatSnap2 = await chatRef.get();
        const chatData = chatSnap2.data() || {};

        const status =
            (chatData.status as "open" | "pending" | "closed" | undefined) || "open";
        const mode = (chatData.mode as "ai" | "agent") || "ai";

        const msgsSnap = await chatRef
            .collection("messages")
            .orderBy("createdAt", "asc")
            .limit(200)
            .get();

        const messages = msgsSnap.docs.map((d) => {
            const data = d.data() as any;
            return {
                id: d.id,
                sender: data.sender as Sender,
                text: data.text as string,
                createdAt: (data.createdAt?.toDate?.() || new Date()).toISOString(),
            };
        });

        return NextResponse.json({ ok: true, chatId, mode, status, messages });
    } catch (err: any) {
        console.error("support chat GET failed", err);
        return NextResponse.json({ ok: false, error: "Failed to load chat" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const textRaw = typeof body.text === "string" ? body.text.trim() : "";
        const existingChatId = typeof body.chatId === "string" ? body.chatId.trim() : "";

        if (!textRaw) {
            return NextResponse.json({ ok: false, error: "Missing message text" }, { status: 400 });
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

        const nowTs = admin.firestore.Timestamp.now();

        if (existingData) {
            const existingStatus =
                (existingData.status as "open" | "pending" | "closed" | undefined) || "open";
            if (existingStatus === "closed") {
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
        }

        if (!existingData) {
            await chatRef.set(
                {
                    userId: uid,
                    createdAt: nowTs,
                    updatedAt: nowTs,
                    lastActivityAt: nowTs,
                    mode: "ai",
                    status: "open",
                    lastMessageFrom: "user",
                    lastMessage: textRaw,
                    lastMessageAt: nowTs,
                    inactivityPromptAt: admin.firestore.FieldValue.delete(),
                    pendingAutoCloseAt: admin.firestore.FieldValue.delete(),
                },
                { merge: true },
            );
        } else {
            await chatRef.set(
                {
                    userId: existingData.userId ?? uid ?? null,
                    updatedAt: nowTs,
                    lastActivityAt: nowTs,
                    status: existingData.status || "open",
                    lastMessageFrom: "user",
                    lastMessage: textRaw,
                    lastMessageAt: nowTs,
                    inactivityPromptAt: admin.firestore.FieldValue.delete(),
                    pendingAutoCloseAt: admin.firestore.FieldValue.delete(),
                },
                { merge: true },
            );
        }

        const chatSnap = await chatRef.get();
        const chatData = chatSnap.data() || {};
        const mode = (chatData.mode as "ai" | "agent") || "ai";

        await chatRef.collection("messages").add({
            sender: "user",
            text: textRaw,
            createdAt: nowTs,
        } as MessageDoc);

        // If we're in agent lane, do not auto-reply with AI.
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
                return { role, text: data.text as string };
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
                    content: [{ type: "input_text", text: `Kloner support docs:\n\n${contextBlob}` }],
                });
            }

            for (const msg of history) {
                const isAssistant = msg.role === "assistant";
                const contentType = isAssistant ? "output_text" : "input_text";
                messagesForModel.push({
                    role: msg.role,
                    content: [{ type: contentType, text: msg.text }],
                });
            }

            const completion: any = await client.responses.create({
                model: "gpt-4.1-mini",
                input: messagesForModel as any,
            });

            const aiText = String(completion.output_text || "").trim();
            if (aiText) {
                const aiTs = admin.firestore.Timestamp.now();
                const aiRef = await chatRef.collection("messages").add({
                    sender: "ai",
                    text: aiText,
                    createdAt: aiTs,
                } as MessageDoc);
                aiMsgId = aiRef.id;

                await chatRef.set(
                    {
                        updatedAt: aiTs,
                        lastActivityAt: aiTs,
                        lastMessageFrom: "ai",
                        lastMessage: aiText,
                        lastMessageAt: aiTs,
                    },
                    { merge: true },
                );
            }
        }

        await chatRef.set(
            {
                updatedAt: nowTs,
                lastActivityAt: nowTs,
                lastMessageFrom: "user",
                lastMessage: textRaw,
                lastMessageAt: nowTs,
            },
            { merge: true },
        );

        const finalSnap = await chatRef
            .collection("messages")
            .orderBy("createdAt", "asc")
            .limit(200)
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

        const status =
            (chatData.status as "open" | "pending" | "closed" | undefined) || "open";

        return NextResponse.json({
            ok: true,
            chatId: chatRef.id,
            mode,
            status,
            messages,
            lastAiId: aiMsgId,
        });
    } catch (err: any) {
        console.error("support chat POST failed", err);
        return NextResponse.json({ ok: false, error: "Failed to send message" }, { status: 500 });
    }
}
