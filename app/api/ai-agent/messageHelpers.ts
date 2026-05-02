function safeString(val: unknown, maxLen: number): string {
    if (typeof val !== "string") return "";
    return val.length > maxLen ? val.slice(0, maxLen) : val;
}

function looksLikeProviderLeak(text: unknown): boolean {
    const value = typeof text === "string" ? text.trim() : "";
    if (!value) return false;

    const lower = value.toLowerCase();
    return (
        lower.includes("googlegenerativeai error") ||
        lower.includes("candidate was blocked") ||
        lower.includes("recitation") ||
        lower.includes("finishreason") ||
        lower.includes("safety") ||
        lower.includes("model not found")
    );
}

function isInternalAiResponseLeak(text: string): boolean {
    const value = String(text || "").toLowerCase();
    if (!value.trim()) return false;
    return [
        "relevant_chunks",
        "relevant chunks",
        "retrieved embedding chunks",
        "embedding",
        "search trace",
        "search results",
        "file content was not provided",
        "content of relevant",
        "underhood",
        "chunk",
        "chunks",
        "planner selected",
        "assistantmessage",
        "filepaths",
    ].some((needle) => value.includes(needle));
}

export function buildUserFacingNoOpMessage(params: { currentFile: string | null; needsMoreContext?: boolean }): string {
    const { currentFile, needsMoreContext } = params;
    if (needsMoreContext) {
        return currentFile
            ? "I’m close, but I need one more detail to make the right change. Point me to the footer or the section where this link should go, and I’ll update it."
            : "I’m close, but I need one more detail to make the right change. Point me to the part of the page where this link should go, and I’ll update it.";
    }

    return currentFile
        ? "I couldn’t place that link confidently yet. Point me to the footer or navigation area, and I’ll add it there."
        : "I couldn’t place that link confidently yet. Point me to the footer or navigation area, and I’ll add it there.";
}

export function sanitizeUserFacingAiMessage(params: { text: unknown; fallback: string }): string {
    const raw = safeString(params.text || "", 1200).trim();
    if (!raw) return params.fallback;
    if (looksLikeProviderLeak(raw)) return params.fallback;
    if (isInternalAiResponseLeak(raw)) return params.fallback;

    const lower = raw.toLowerCase();
    if (lower.includes("could not add") && (lower.includes("file") || lower.includes("layout") || lower.includes("content") || lower.includes("chunks"))) {
        return params.fallback;
    }

    return raw;
}

export type RetrievedChunk = {
    path?: string;
    chunkId?: string;
    chunkIndex?: number;
    lineRange?: { start?: number; end?: number };
    startLine?: number;
    endLine?: number;
    score?: number;
    chunkText?: string;
    text?: string;
    excerpt?: string;
    source?: string;
};

export function formatRetrievedChunksSection(chunks: unknown): string {
    if (!Array.isArray(chunks) || chunks.length === 0) return "";

    const lines: string[] = ["Retrieved embedding chunks:"];
    let renderedCount = 0;
    chunks.slice(0, 12).forEach((chunk, index) => {
        if (!chunk || typeof chunk !== "object") return;
        const path = safeString((chunk as RetrievedChunk).path || "", 500).trim();
        const chunkId = safeString((chunk as RetrievedChunk).chunkId || "", 200).trim();
        const lineRange = (chunk as RetrievedChunk).lineRange && typeof (chunk as RetrievedChunk).lineRange === "object"
            ? (chunk as RetrievedChunk).lineRange
            : null;
        const startLineValue = Number.isFinite(Number(lineRange?.start))
            ? Number(lineRange?.start)
            : Number.isFinite(Number((chunk as RetrievedChunk).startLine))
                ? Number((chunk as RetrievedChunk).startLine)
                : null;
        const endLineValue = Number.isFinite(Number(lineRange?.end))
            ? Number(lineRange?.end)
            : Number.isFinite(Number((chunk as RetrievedChunk).endLine))
                ? Number((chunk as RetrievedChunk).endLine)
                : null;
        const startLine = startLineValue !== null ? Math.max(1, Math.floor(startLineValue)) : null;
        const endLine = endLineValue !== null ? Math.max(1, Math.floor(endLineValue)) : null;
        const score = Number.isFinite(Number((chunk as RetrievedChunk).score)) ? Number((chunk as RetrievedChunk).score) : null;
        const text = safeString((chunk as RetrievedChunk).chunkText || (chunk as RetrievedChunk).text || (chunk as RetrievedChunk).excerpt || "", 12_000).trim();
        const source = safeString((chunk as RetrievedChunk).source || "", 200).trim();

        if (!path || !text) {
            throw new Error(
                `Retrieved embedding chunk ${index + 1} is missing readable code content. Expected path and chunkText.`
            );
        }

        renderedCount += 1;

        lines.push(
            [
                `${index + 1}. ${path || "(unknown path)"}${chunkId ? ` [${chunkId}]` : ""}`,
                startLine && endLine ? `   lines: ${startLine}-${endLine}` : "",
                score !== null ? `   score: ${score.toFixed(4)}` : "",
                source ? `   source: ${source}` : "",
                text ? `   text: ${text}` : "",
            ].filter(Boolean).join("\n"),
        );
    });

    if (renderedCount === 0) {
        throw new Error("Retrieved embedding chunks did not contain any readable code snippets.");
    }

    return lines.join("\n");
}