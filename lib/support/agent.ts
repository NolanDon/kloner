// src/lib/support/agent.ts
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export async function markAgentConnected(chatId: string, assignedTo: string | null) {
    if (!chatId) return;

    await updateDoc(doc(db, "support_chats", chatId), {
        status: "open",
        updatedAt: serverTimestamp(),
        agentConnectedAt: serverTimestamp(),
        assignedTo: assignedTo || null,
        inactivityPromptAt: null,
        pendingAutoCloseAt: null,
    } as any);
}
