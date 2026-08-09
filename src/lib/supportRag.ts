import type FirebaseFirestore from "firebase-admin/firestore";

export type SupportDoc = {
    id: string;
    text: string;
    embedding?: number[];
};

export type RankedSupportDoc = SupportDoc & { score: number };

const CODE_EXPORT_HINTS = [
    /(?:export|exporting|download|downloadable|downloading)\s+(?:the\s+)?(?:code|source|project|repo|repository)/i,
    /(?:code|source|project|repo|repository)\s+(?:export|exporting|download|downloadable|downloaded)/i,
    /\bcode export\b/i,
    /\bexport code\b/i,
];

const CODE_EXPORT_POLICY_DOC: SupportDoc = {
    id: "code-export-policy",
    text:
        "Kloner does not currently offer code exporting. If a user asks to export, download, or move the source code out of Kloner, answer clearly that code export is not available right now. " +
        "You can suggest continuing to edit inside Kloner, deploying the app, or asking for help with a specific change instead.",
};

function tokenize(text: string): string[] {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3);
}

function keywordScore(query: string, body: string): number {
    const queryTokens = tokenize(query);
    const bodyTokens = tokenize(body);
    if (!queryTokens.length || !bodyTokens.length) return 0;
    const bodySet = new Set(bodyTokens);
    let matches = 0;
    for (const token of queryTokens) {
        if (bodySet.has(token)) matches += 1;
    }
    return matches / queryTokens.length;
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

export function rankSupportDocs(question: string, docs: SupportDoc[], queryEmbedding?: number[] | null): RankedSupportDoc[] {
    const normalizedQuestion = String(question || "").trim().toLowerCase();
    const embeddedDocs = Array.isArray(queryEmbedding) && queryEmbedding.length > 0
        ? docs.filter((doc) => Array.isArray(doc.embedding) && doc.embedding.length > 0)
        : [];

    const ranked = (embeddedDocs.length > 0 && Array.isArray(queryEmbedding) && queryEmbedding.length > 0)
        ? embeddedDocs
            .map((doc) => ({ ...doc, score: cosineSim(queryEmbedding, doc.embedding as number[]) }))
            .sort((a, b) => b.score - a.score)
        : docs
            .map((doc) => ({ ...doc, score: keywordScore(normalizedQuestion, doc.text) }))
            .sort((a, b) => b.score - a.score);

    return ranked;
}

export function buildSupportDocsContext(question: string, docs: SupportDoc[], queryEmbedding?: number[] | null, maxDocs = 3): string | null {
    const top = rankSupportDocs(question, docs, queryEmbedding).filter((doc) => doc.score > 0).slice(0, maxDocs);
    const query = String(question || "").trim();
    const shouldAddCodeExportPolicy = CODE_EXPORT_HINTS.some((pattern) => pattern.test(query));
    const contextDocs = shouldAddCodeExportPolicy
        ? [CODE_EXPORT_POLICY_DOC, ...top]
        : top;
    if (!contextDocs.length) return null;

    return contextDocs
        .map((doc) => `### ${doc.id}\n${doc.text.trim().slice(0, 3000)}`)
        .join("\n\n---\n\n");
}

export function buildSupportPolicyContext(question: string): string | null {
    const query = String(question || "").trim();
    if (!query) return null;
    if (!CODE_EXPORT_HINTS.some((pattern) => pattern.test(query))) return null;
    return `### ${CODE_EXPORT_POLICY_DOC.id}\n${CODE_EXPORT_POLICY_DOC.text.trim()}`;
}

export async function loadSupportDocs(db: FirebaseFirestore.Firestore, collectionName = "support_doc"): Promise<SupportDoc[]> {
    const snap = await db.collection(collectionName).get();
    return snap.docs
        .map((d) => {
            const data = d.data() as any;
            const text = (data.text as string) || "";
            const embedding = Array.isArray(data.embedding) ? (data.embedding as number[]) : undefined;
            return { id: d.id, text, embedding };
        })
        .filter((d) => d.text);
}
