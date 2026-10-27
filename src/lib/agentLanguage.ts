export const AGENT_LANGUAGES = {
    en: "English",
    ko: "Korean",
    ja: "Japanese",
    zh: "Chinese",
    es: "Spanish",
    fr: "French",
    de: "German",
    pt: "Portuguese",
    ru: "Russian",
    ar: "Arabic",
    hi: "Hindi",
} as const;

export type AgentLanguage = keyof typeof AGENT_LANGUAGES;

export function normalizeAgentLanguage(value: unknown): AgentLanguage | null {
    return typeof value === "string" && Object.hasOwn(AGENT_LANGUAGES, value)
        ? value as AgentLanguage
        : null;
}

export function detectAgentLanguage(text: string): AgentLanguage | null {
    const value = String(text || "");
    if (/[\uAC00-\uD7AF]/u.test(value)) return "ko";
    if (/[\u3040-\u30FF]/u.test(value)) return "ja";
    if (/[\u4E00-\u9FFF]/u.test(value)) return "zh";
    if (/[\u0400-\u04FF]/u.test(value)) return "ru";
    if (/[\u0600-\u06FF]/u.test(value)) return "ar";
    if (/[\u0900-\u097F]/u.test(value)) return "hi";
    if (/[ãõç]/iu.test(value)) return "pt";
    if (/[¿¡ñ]/iu.test(value)) return "es";
    if (/[àâæçéèêëîïôœùûüÿ]/iu.test(value)) return "fr";
    if (/[äöüß]/iu.test(value)) return "de";
    return null;
}

export function languagePreferencePrompt(language: AgentLanguage): string {
    const prompts: Record<AgentLanguage, string> = {
        en: "Would you like me to keep replying in English? Reply yes or no.",
        ko: "앞으로 한국어로 답변드릴까요? 예 또는 아니요로 알려 주세요.",
        ja: "今後は日本語で返信しましょうか？「はい」または「いいえ」とお答えください。",
        zh: "之后希望我用中文回复吗？请回答“是”或“否”。",
        es: "¿Prefieres que te responda en español? Responde sí o no.",
        fr: "Préférez-vous que je réponde en français ? Répondez oui ou non.",
        de: "Soll ich künftig auf Deutsch antworten? Antworte mit Ja oder Nein.",
        pt: "Você prefere que eu responda em português? Responda sim ou não.",
        ru: "Хотите, чтобы я отвечал по-русски? Ответьте да или нет.",
        ar: "هل تفضل أن أجيبك باللغة العربية؟ أجب بنعم أو لا.",
        hi: "क्या आप चाहते हैं कि मैं आगे हिंदी में जवाब दूँ? हाँ या नहीं में बताइए।",
    };
    return prompts[language];
}

export function languagePreferenceAnswer(text: string): "yes" | "no" | null {
    const value = String(text || "").trim().toLocaleLowerCase();
    if (/^(yes|yeah|yep|sure|please|네|예|응|좋아요|はい|ええ|是的?|好的|sí|si|oui|ja|sim|да|نعم|हाँ|हां)(?:[\s,，.!。！]|$)/iu.test(value)) return "yes";
    if (/^(no|nope|nah|아니요|아니오|아니|いいえ|不是|不|否|no gracias|non|nein|não|нет|لا|नहीं)(?:[\s,，.!。！]|$)/iu.test(value)) return "no";
    return null;
}
