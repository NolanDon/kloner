type AppBuilderChatIntentKind = "quick-question" | "edit-request";

export type AppBuilderChatMode = "auto" | "ask" | "task";

export type AppBuilderChatRoute = "ask" | "task";

export type AppBuilderChatIntent = {
    kind: AppBuilderChatIntentKind;
    reason: string;
};

function normalizeIntentText(message: string, conversation: string): string {
    return `${String(message || "").trim()}\n${String(conversation || "").trim()}`.toLowerCase();
}

function hasCodeOrFileAnchors(text: string): boolean {
    if (!text.trim()) return false;

    return (
        /`[^`]+`/.test(text) ||
        /(?:^|\s)(?:src|app|pages|components|public|api)\/[\w./-]+\.(?:tsx|ts|jsx|js|mdx?|css|json|html?)(?:\b|$)/i.test(text) ||
        /\b(?:src|app|pages|components|public|api)\//i.test(text) ||
        /\b(?:file|files|path|component|components|page|pages|layout|route|code|folder|repo)\b/i.test(text) ||
        /\b(?:navbar|nav\b|navigation|footer|header|hero|banner|section|headline|subheadline|copy|text|button|cta|form|modal|sidebar)\b/i.test(text)
    );
}

function looksLikeHowToQuestion(text: string): boolean {
    return /\b(how do i|how can i|how to|what is|what are|where do i|where can i|why does|why is|can you explain|is there a way to|can i|should i|help me)\b/i.test(text);
}

export function classifyAppBuilderChatIntent(message: string, conversation = ""): AppBuilderChatIntent {
    const normalized = normalizeIntentText(message, conversation);
    if (!normalized.trim()) {
        return {
            kind: "edit-request",
            reason: "Empty input defaults to the edit flow.",
        };
    }

    if (looksLikeHowToQuestion(normalized) && !hasCodeOrFileAnchors(normalized)) {
        return {
            kind: "quick-question",
            reason: "The message reads like a general how-to question and does not point at code or files.",
        };
    }

    return {
        kind: "edit-request",
        reason: hasCodeOrFileAnchors(normalized)
            ? "The message points at code, files, or a specific app element, so it should go through the edit/search lane."
            : "The message does not clearly match the quick-answer lane.",
    };
}

export function shouldUseQuickQuestionLane(message: string, conversation = ""): boolean {
    return classifyAppBuilderChatIntent(message, conversation).kind === "quick-question";
}

export function resolveAppBuilderChatRoute(params: {
    mode?: AppBuilderChatMode;
    message: string;
    conversation?: string;
}): { route: AppBuilderChatRoute; reason: string; intent: AppBuilderChatIntent; mode: AppBuilderChatMode } {
    const mode = params.mode || "auto";
    const intent = classifyAppBuilderChatIntent(params.message, params.conversation || "");

    if (mode === "ask") {
        return {
            route: "ask",
            reason: "The user explicitly selected Ask mode.",
            intent,
            mode,
        };
    }

    if (mode === "task") {
        return {
            route: "task",
            reason: "The user explicitly selected Task mode.",
            intent,
            mode,
        };
    }

    return {
        route: intent.kind === "quick-question" ? "ask" : "task",
        reason: intent.reason,
        intent,
        mode,
    };
}