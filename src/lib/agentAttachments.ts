export type AgentImageAttachment = { id: string; name: string; mimeType: "image/webp"; width: number; height: number };
export function normalizeAgentImages(value: unknown): AgentImageAttachment[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 3).flatMap((item) => {
        if (!item || typeof item !== "object" || !/^[a-f0-9-]{36}$/.test(String(item.id || ""))) return [];
        return [{ id: String(item.id), name: String(item.name || "Image").slice(0, 120), mimeType: "image/webp" as const, width: Math.max(1, Math.min(2048, Number(item.width) || 1)), height: Math.max(1, Math.min(2048, Number(item.height) || 1)) }];
    });
}
