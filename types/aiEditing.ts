// types/aiEditing.ts
export interface AiEditSnapshot {
    id: string;
    renderId: string;
    prompt: string;
    summary: string;
    beforeHtml: string;
    afterHtml: string;
    createdAt: FirebaseFirestore.Timestamp;
}
