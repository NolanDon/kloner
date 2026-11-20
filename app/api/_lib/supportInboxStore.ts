// app/api/_lib/supportInboxStore.ts
// Firestore storage for the admin support inbox.
// Threads live in "support_threads" with a "messages" subcollection;
// "support_inbound_index" maps each Resend received-email id to its thread
// so webhook retries never store the same email twice.
import { FieldValue } from "firebase-admin/firestore";
import {
    extractReferencedMessageIds,
    makeSnippet,
    normalizeMessageId,
    normalizeSubject,
    parseEmailAddress,
    type ReceivedEmail,
} from "./supportInbox";

export type SupportThreadStatus = "open" | "closed";

export type SupportThread = {
    id: string;
    subject: string;
    normalizedSubject: string;
    fromEmail: string;
    fromName: string | null;
    status: SupportThreadStatus;
    unread: boolean;
    snippet: string;
    messageIds: string[];
    messageCount: number;
    lastMessageAt: number;
    createdAt: number;
};

export type SupportMessage = {
    id: string;
    direction: "in" | "out";
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string | null;
    messageId: string | null;
    resendId: string | null;
    attachments: Array<{
        filename: string;
        contentType: string | null;
        size: number | null;
    }>;
    at: number;
};

const THREADS = "support_threads";
const INBOUND_INDEX = "support_inbound_index";

type Db = FirebaseFirestore.Firestore;

function toThread(doc: FirebaseFirestore.DocumentSnapshot): SupportThread {
    const data = doc.data() || {};
    return {
        id: doc.id,
        subject: typeof data.subject === "string" ? data.subject : "(no subject)",
        normalizedSubject: typeof data.normalizedSubject === "string" ? data.normalizedSubject : "",
        fromEmail: typeof data.fromEmail === "string" ? data.fromEmail : "",
        fromName: typeof data.fromName === "string" ? data.fromName : null,
        status: data.status === "closed" ? "closed" : "open",
        unread: data.unread === true,
        snippet: typeof data.snippet === "string" ? data.snippet : "",
        messageIds: Array.isArray(data.messageIds) ? data.messageIds.filter((v: unknown) => typeof v === "string") : [],
        messageCount: typeof data.messageCount === "number" ? data.messageCount : 0,
        lastMessageAt: typeof data.lastMessageAt === "number" ? data.lastMessageAt : 0,
        createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    };
}

function toMessage(doc: FirebaseFirestore.DocumentSnapshot): SupportMessage {
    const data = doc.data() || {};
    return {
        id: doc.id,
        direction: data.direction === "out" ? "out" : "in",
        from: typeof data.from === "string" ? data.from : "",
        to: Array.isArray(data.to) ? data.to.filter((v: unknown) => typeof v === "string") : [],
        subject: typeof data.subject === "string" ? data.subject : "",
        text: typeof data.text === "string" ? data.text : "",
        html: typeof data.html === "string" ? data.html : null,
        messageId: typeof data.messageId === "string" ? data.messageId : null,
        resendId: typeof data.resendId === "string" ? data.resendId : null,
        attachments: Array.isArray(data.attachments)
            ? data.attachments.map((a: any) => ({
                  filename: typeof a?.filename === "string" ? a.filename : "attachment",
                  contentType: typeof a?.contentType === "string" ? a.contentType : null,
                  size: typeof a?.size === "number" ? a.size : null,
              }))
            : [],
        at: typeof data.at === "number" ? data.at : 0,
    };
}

/**
 * Store one received email, threading it onto an existing conversation when
 * its headers reference a known message, or when the same sender already has
 * a thread with the same root subject.
 */
export async function storeInboundEmail(
    db: Db,
    email: ReceivedEmail,
    now: number = Date.now()
): Promise<{ threadId: string; created: boolean; duplicate: boolean }> {
    const indexRef = db.collection(INBOUND_INDEX).doc(email.id);
    const existing = await indexRef.get();
    if (existing.exists) {
        return { threadId: String(existing.data()?.threadId || ""), created: false, duplicate: true };
    }

    const from = parseEmailAddress(email.from);
    const messageId = email.message_id ? normalizeMessageId(email.message_id) : null;
    const referenced = extractReferencedMessageIds(email.headers);
    const normalizedSubject = normalizeSubject(email.subject);
    const threadsCol = db.collection(THREADS);

    let threadRef: FirebaseFirestore.DocumentReference | null = null;
    for (const refId of referenced) {
        const snap = await threadsCol.where("messageIds", "array-contains", refId).limit(1).get();
        if (!snap.empty) {
            threadRef = snap.docs[0].ref;
            break;
        }
    }
    if (!threadRef) {
        const snap = await threadsCol
            .where("fromEmail", "==", from.email)
            .where("normalizedSubject", "==", normalizedSubject)
            .limit(1)
            .get();
        if (!snap.empty) threadRef = snap.docs[0].ref;
    }

    let created = false;
    if (!threadRef) {
        created = true;
        threadRef = threadsCol.doc();
        await threadRef.set({
            subject: email.subject || "(no subject)",
            normalizedSubject,
            fromEmail: from.email,
            fromName: from.name,
            status: "open",
            unread: true,
            snippet: "",
            messageIds: [],
            messageCount: 0,
            lastMessageAt: now,
            createdAt: now,
        });
    }

    const text = email.text || "";
    await threadRef.collection("messages").add({
        direction: "in",
        from: email.from,
        to: email.to || [],
        subject: email.subject || "",
        text,
        html: email.html || null,
        messageId,
        resendId: email.id,
        attachments: (email.attachments || []).map((a) => ({
            filename: a.filename || "attachment",
            contentType: a.content_type || null,
            size: typeof a.size === "number" ? a.size : null,
        })),
        at: now,
    });

    const updates: Record<string, unknown> = {
        unread: true,
        status: "open",
        snippet: makeSnippet(text),
        lastMessageAt: now,
        messageCount: FieldValue.increment(1),
    };
    if (messageId) updates.messageIds = FieldValue.arrayUnion(messageId);
    await threadRef.update(updates);
    await indexRef.set({ threadId: threadRef.id, messageId, at: now });

    return { threadId: threadRef.id, created, duplicate: false };
}

export async function listThreads(db: Db, limit = 100): Promise<SupportThread[]> {
    const snap = await db.collection(THREADS).orderBy("lastMessageAt", "desc").limit(limit).get();
    return snap.docs.map(toThread);
}

export async function countUnreadThreads(db: Db): Promise<number> {
    const snap = await db.collection(THREADS).where("unread", "==", true).get();
    return snap.size;
}

export async function getThread(db: Db, threadId: string): Promise<SupportThread | null> {
    const doc = await db.collection(THREADS).doc(threadId).get();
    return doc.exists ? toThread(doc) : null;
}

export async function listMessages(db: Db, threadId: string): Promise<SupportMessage[]> {
    const snap = await db
        .collection(THREADS)
        .doc(threadId)
        .collection("messages")
        .orderBy("at", "asc")
        .get();
    return snap.docs.map(toMessage);
}

export async function markThreadRead(db: Db, threadId: string): Promise<void> {
    await db.collection(THREADS).doc(threadId).update({ unread: false });
}

export async function setThreadStatus(
    db: Db,
    threadId: string,
    status: SupportThreadStatus
): Promise<void> {
    await db.collection(THREADS).doc(threadId).update({ status });
}

export async function appendOutboundMessage(
    db: Db,
    threadId: string,
    message: { from: string; to: string; subject: string; text: string; resendId: string },
    now: number = Date.now()
): Promise<void> {
    const threadRef = db.collection(THREADS).doc(threadId);
    await threadRef.collection("messages").add({
        direction: "out",
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: null,
        messageId: null,
        resendId: message.resendId,
        attachments: [],
        at: now,
    });
    await threadRef.update({
        snippet: makeSnippet(message.text),
        lastMessageAt: now,
        messageCount: FieldValue.increment(1),
    });
}
