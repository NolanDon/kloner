// app/api/support/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getAdminDb } from "../../_lib/auth";
import { captureCriticalEvent, captureException } from "@/lib/observability";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const geminiClient = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// Using flash model for cost efficiency while maintaining good performance
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-1.5-flash";
const GEMINI_EMBEDDING_MODEL = "models/embedding-001";
const MODEL_DISCOVERY_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const CHAT_MODEL_PREFERENCES = [
    GEMINI_CHAT_MODEL,
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-pro",
];
const CHAT_MODEL_EXCLUDE = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
];

let cachedResolvedChatModels: string[] = [];
let cachedResolvedChatModelsAt = 0;

type Sender = "user" | "ai" | "agent" | "system";

type MessageDoc = {
    sender: Sender;
    text: string;
    createdAt: FirebaseFirestore.Timestamp;
};

const CHAT_COLLECTION = "support_chats";
const SUPPORT_DOC_COLLECTION = "support_doc";

// ---------- inactivity controls ----------
const INACTIVITY_PROMPT_MS = 5 * 60 * 1000;   // 5 minutes
const PROMPT_GRACE_MS = 2 * 60 * 1000;        // 2 minutes after the prompt
const INACTIVITY_AUTO_CLOSE_MS = 15 * 60 * 1000; // 15 minutes total idle time

const STILL_THERE_TEXT =
    "Still there? Reply to keep this chat open. If you don’t respond, it will auto-close soon.";

type SupportDoc = {
    id: string;
    text: string;
    embedding?: number[];
};

type GeminiModelInfo = {
    name?: string;
    supportedGenerationMethods?: string[];
};

function normalizeModelName(name: string): string {
    return name.replace(/^models\//, "");
}

function isModelNotFoundError(err: unknown): boolean {
    const status = (err as any)?.status;
    const msg = String((err as any)?.message ?? "").toLowerCase();
    return status === 404 || (msg.includes("model") && msg.includes("not found"));
}

function isModelRetiredError(err: unknown): boolean {
    const msg = String((err as any)?.message ?? "").toLowerCase();
    return msg.includes("no longer available") || msg.includes("update your code to use a newer model");
}

function isGeminiSafetyOrRecitationError(err: unknown): boolean {
    const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
    return (
        msg.includes("candidate was blocked") ||
        msg.includes("blocked") ||
        msg.includes("safety") ||
        msg.includes("policy") ||
        msg.includes("recitation")
    );
}

function uniqueModels(list: string[]): string[] {
    return Array.from(new Set(list.filter(Boolean)));
}

function isExcludedModel(name: string): boolean {
    return CHAT_MODEL_EXCLUDE.includes(name);
}

async function listGenerateContentModels(): Promise<string[]> {
    if (!GEMINI_API_KEY) return [];
    const url = `${MODEL_DISCOVERY_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) {
        throw new Error(`ListModels failed: ${res.status} ${res.statusText}`);
    }
    const payload = (await res.json()) as { models?: GeminiModelInfo[] };
    const models = payload.models || [];
    return models
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => normalizeModelName(model.name || ""))
        .filter(Boolean);
}

async function resolveChatModels(forceRefresh = false): Promise<string[]> {
    const now = Date.now();
    if (
        !forceRefresh &&
        cachedResolvedChatModels.length > 0 &&
        now - cachedResolvedChatModelsAt < MODEL_CACHE_TTL_MS
    ) {
        return cachedResolvedChatModels;
    }

    try {
        const available = await listGenerateContentModels();
        const filteredAvailable = available.filter((name) => !isExcludedModel(name));
        if (filteredAvailable.length) {
            const preferred = CHAT_MODEL_PREFERENCES.filter((name) => filteredAvailable.includes(name));
            const rest = filteredAvailable.filter((name) => !preferred.includes(name));
            const selected = uniqueModels([...preferred, ...rest]);
            cachedResolvedChatModels = selected;
            cachedResolvedChatModelsAt = now;
            return selected;
        }
    } catch (err) {
        console.warn("[support-chat] Failed to discover models; using fallback", err);
    }

    cachedResolvedChatModels = uniqueModels(
        [
            GEMINI_CHAT_MODEL,
            "gemini-1.5-flash",
            "gemini-1.5-pro",
            "gemini-pro",
        ].filter((name) => !isExcludedModel(name)),
    );
    cachedResolvedChatModelsAt = now;
    return cachedResolvedChatModels;
}

async function generateSupportReply(
    modelName: string,
    systemPrompt: string,
    chatHistory: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>,
): Promise<string> {
    if (!geminiClient) {
        throw new Error("Gemini client not initialized");
    }

    const model = geminiClient.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
    });

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage("");
    return result.response.text().trim();
}

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
            const embedding = Array.isArray(data.embedding) ? (data.embedding as number[]) : undefined;
            return { id: d.id, text, embedding };
        })
        .filter((d) => d.text);
}

async function buildContextFromDocs(question: string): Promise<string | null> {
    const db = getAdminDb();
    const docs = await loadSupportDocs(db);
    if (!docs.length) {
        console.warn("[support-chat] No support docs loaded from database");
        return null;
    }

    const normalizedQuestion = question.trim().toLowerCase();
    if (!normalizedQuestion) return null;

    const tokenize = (text: string): string[] =>
        text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((token) => token.length >= 3);

    const keywordScore = (query: string, body: string): number => {
        const queryTokens = tokenize(query);
        const bodyTokens = tokenize(body);
        if (!queryTokens.length || !bodyTokens.length) return 0;
        const bodySet = new Set(bodyTokens);
        let matches = 0;
        for (const token of queryTokens) {
            if (bodySet.has(token)) matches += 1;
        }
        return matches / queryTokens.length;
    };

    let ranked: Array<SupportDoc & { score: number }> = [];

    // Prefer vector retrieval when embeddings are available and query embedding succeeds.
    try {
        const embeddedDocs = docs.filter((doc) => Array.isArray(doc.embedding) && doc.embedding.length > 0);
        if (geminiClient && embeddedDocs.length > 0) {
            const embModel = geminiClient.getGenerativeModel({ model: GEMINI_EMBEDDING_MODEL });
            const embRes = await embModel.embedContent(question);
            const queryEmbedding = embRes.embedding?.values ? Array.from(embRes.embedding.values) : null;

            if (queryEmbedding && Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
                ranked = embeddedDocs
                    .map((doc) => ({
                        ...doc,
                        score: cosineSim(queryEmbedding, doc.embedding as number[]),
                    }))
                    .sort((a, b) => b.score - a.score);
            }
        }
    } catch (err) {
        console.warn("[support-chat] embedding retrieval failed, falling back to lexical ranking", err);
    }

    if (!ranked.length) {
        ranked = docs
            .map((doc) => ({ ...doc, score: keywordScore(normalizedQuestion, doc.text) }))
            .sort((a, b) => b.score - a.score);
    }

    const top = ranked.filter((doc) => doc.score > 0).slice(0, 3);
    if (!top.length) {
        console.warn("[support-chat] No relevant support docs found for question");
        return null;
    }

    return top
        .map((doc) => `### ${doc.id}\n${doc.text.trim().slice(0, 3000)}`)
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
            await captureCriticalEvent({
                source: "vercel",
                severity: "error",
                statusCode: 400,
                route: req.nextUrl?.pathname,
                method: "GET",
                action: "support.chat.get",
                message: "Missing chatId",
                service: "support-chat",
                url: req.url,
            });
            return NextResponse.json({ ok: false, error: "Missing chatId" }, { status: 400 });
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
                method: "GET",
                action: "support.chat.get",
                message: "Chat not found",
                service: "support-chat",
                url: req.url,
                extra: { chatId },
            });
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
        await captureException({
            source: "vercel",
            error: err,
            route: req.nextUrl?.pathname,
            method: "GET",
            action: "support.chat.get",
            statusCode: 500,
            service: "support-chat",
            url: req.url,
        });
        return NextResponse.json({ ok: false, error: "Failed to load chat" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const textRaw = typeof body.text === "string" ? body.text.trim() : "";
        const existingChatId = typeof body.chatId === "string" ? body.chatId.trim() : "";

        if (!textRaw) {
            await captureCriticalEvent({
                source: "vercel",
                severity: "error",
                statusCode: 400,
                route: req.nextUrl?.pathname,
                method: "POST",
                action: "support.chat.post",
                message: "Missing message text",
                service: "support-chat",
                url: req.url,
            });
            return NextResponse.json({ ok: false, error: "Missing message text" }, { status: 400 });
        }

        if (!geminiClient) {
            console.error("[support-chat] Gemini API key not configured");
            return NextResponse.json(
                { ok: false, error: "AI service not configured. Please contact support." },
                { status: 503 }
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

            const baseSystem =
                "You are the support assistant for Kloner, a tool for cloning and editing websites. " +
                "Answer ONLY using the Kloner docs provided. If the answer is not clearly in the docs, " +
                "say you don't know and suggest the user contact support.";

            let systemPrompt = baseSystem;
            if (contextBlob) {
                systemPrompt += `\n\nKloner support docs:\n\n${contextBlob}`;
            }

            const chatHistory: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = history
                .map((msg) => {
                    const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
                    return { role, parts: [{ text: msg.text }] };
                });

            let aiText = "";
            try {
                const triedModels = new Set<string>();

                const tryModels = async (candidates: string[]): Promise<boolean> => {
                    for (const modelName of candidates) {
                        if (!modelName || triedModels.has(modelName)) continue;
                        triedModels.add(modelName);
                        try {
                            aiText = await generateSupportReply(modelName, systemPrompt, chatHistory);
                            if (aiText) return true;
                        } catch (modelErr) {
                            console.warn(`[support-chat] model failed: ${modelName}`, modelErr);

                            // Safety/recitation blocks are expected sometimes; respond with a friendly message
                            // instead of leaking provider error strings to the user.
                            if (isGeminiSafetyOrRecitationError(modelErr)) {
                                aiText =
                                    "I can’t help with that request as written. Try rephrasing in your own words " +
                                    "(e.g. ask for a summary or ask about Kloner features), or contact support.";
                                return true;
                            }

                            if (!isModelNotFoundError(modelErr) && !isModelRetiredError(modelErr)) {
                                throw modelErr;
                            }
                        }
                    }
                    return false;
                };

                const primaryCandidates = await resolveChatModels();
                const primaryOk = await tryModels(primaryCandidates);
                if (!primaryOk) {
                    const refreshedCandidates = await resolveChatModels(true);
                    await tryModels(refreshedCandidates);
                }
            } catch (err) {
                console.warn("[support-chat] primary model failed", err);
            }

            if (!aiText) {
                aiText =
                    "I’m having trouble reaching the AI model right now. Please try again in a minute, " +
                    "or contact support and we’ll help directly.";
            }

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
        await captureException({
            source: "vercel",
            error: err,
            route: req.nextUrl?.pathname,
            method: "POST",
            action: "support.chat.post",
            statusCode: 500,
            service: "support-chat",
            url: req.url,
        });
        return NextResponse.json({ ok: false, error: "Failed to send message" }, { status: 500 });
    }
}
