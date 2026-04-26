// app/api/ai-agent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { assertAppBuilderScope } from "../_lib/appBuilderScope";
import { hydrateAppBuilderFiles, hydrateAppBuilderFilesByPaths } from "../_lib/htmlStorage";
import { shouldRefreshAfterAiEdits } from "../_lib/aiFileSelection";
import crypto from "node:crypto";
import { captureAuditEvent, captureCriticalEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const AI_AGENT_INPUT_TOKEN_CAP = parsePositiveNumber(process.env.AI_AGENT_INPUT_TOKEN_CAP, 12000);
const AI_AGENT_OUTPUT_TOKEN_CAP = parsePositiveNumber(process.env.AI_AGENT_OUTPUT_TOKEN_CAP, 4096);
const AI_AGENT_CONTEXT_CHAR_CAP = parsePositiveNumber(process.env.AI_AGENT_CONTEXT_CHAR_CAP, 36_000);
const GEMINI_INPUT_COST_PER_1M_TOKENS_USD = parsePositiveNumber(process.env.GEMINI_INPUT_COST_PER_1M_TOKENS_USD, 0);
const GEMINI_OUTPUT_COST_PER_1M_TOKENS_USD = parsePositiveNumber(process.env.GEMINI_OUTPUT_COST_PER_1M_TOKENS_USD, 0);

type ChatMessage = {
    role: "user" | "assistant";
    content: string;
};

type StoredMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    type?: "text" | "code" | "file-edit";
    timestampMs?: number;
    restorePointId?: string | null;
    restoreActionLabel?: string | null;
};

type FileEdit = { path: string; content: string };

type RestorePointPayload = {
    label: string;
    source: "ai-agent" | "undo" | "manual";
    createdAt: Date;
    kept: boolean;
    paths: string[];
    before: Record<string, string | null>;
    after?: Record<string, string>;
    messageSnippet?: string;
    buildOk?: boolean;
};

type AiTokenUsage = {
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    actualInputTokens: number | null;
    actualOutputTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
};

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function estimateTokens(text: string): number {
    const value = String(text || "");
    if (!value.trim()) return 0;
    return Math.max(1, Math.ceil(value.length / 4));
}

function estimateAiRequestCostUsd(inputTokens: number, outputTokens: number): number | null {
    if (!GEMINI_INPUT_COST_PER_1M_TOKENS_USD && !GEMINI_OUTPUT_COST_PER_1M_TOKENS_USD) return null;
    const inputCost = (inputTokens / 1_000_000) * GEMINI_INPUT_COST_PER_1M_TOKENS_USD;
    const outputCost = (outputTokens / 1_000_000) * GEMINI_OUTPUT_COST_PER_1M_TOKENS_USD;
    return Number((inputCost + outputCost).toFixed(6));
}

function summarizeAiUsage(usageMetadata: any, estimatedInputTokens: number, estimatedOutputTokens: number): AiTokenUsage {
    const actualInputTokens = Number.isFinite(Number(usageMetadata?.promptTokenCount)) ? Number(usageMetadata.promptTokenCount) : null;
    const actualOutputTokens = Number.isFinite(Number(usageMetadata?.candidatesTokenCount)) ? Number(usageMetadata.candidatesTokenCount) : null;
    const totalTokens = Number.isFinite(Number(usageMetadata?.totalTokenCount)) ? Number(usageMetadata.totalTokenCount) : null;
    const inputTokens = actualInputTokens ?? estimatedInputTokens;
    const outputTokens = actualOutputTokens ?? estimatedOutputTokens;

    return {
        estimatedInputTokens,
        estimatedOutputTokens,
        actualInputTokens,
        actualOutputTokens,
        totalTokens,
        estimatedCostUsd: estimateAiRequestCostUsd(inputTokens, outputTokens),
    };
}

function isUnsafeAiRequest(text: string): { blocked: boolean; code: string; reason: string } {
    const value = String(text || "").trim();
    if (!value) return { blocked: false, code: "", reason: "" };

    const lower = value.toLowerCase();
    const rules: Array<{ code: string; reason: string; test: RegExp | ((input: string) => boolean) }> = [
        {
            code: "AI_REQUEST_BLOCKED_ABUSE",
            reason: "Potential harassment, hate, or abuse content.",
            test: /(kill yourself|make a bomb|build a bomb|ransomware|malware|phishing|credential stuffing|steal passwords|steal api keys|doxx|doxing|ddos|sql injection|exploit the vulnerability|bypass security)/i,
        },
        {
            code: "AI_REQUEST_BLOCKED_SEXUAL",
            reason: "Potential sexual content involving minors or explicit sexual abuse content.",
            test: /(csam|child sexual|minor sexual|sexual abuse|explicit sexual content involving minors)/i,
        },
        {
            code: "AI_REQUEST_BLOCKED_VIOLENCE",
            reason: "Potential violent wrongdoing or weaponization content.",
            test: /(assassinate|murder|commit a crime|weaponize|poison|bomb-making)/i,
        },
        {
            code: "AI_REQUEST_BLOCKED_CREDENTIALS",
            reason: "Potential credential or account theft content.",
            test: /(steal tokens|steal cookies|session hijack|cookie theft|api key theft|password dump|credential theft)/i,
        },
    ];

    for (const rule of rules) {
        const matched = typeof rule.test === "function" ? rule.test(lower) : rule.test.test(lower);
        if (matched) return { blocked: true, code: rule.code, reason: rule.reason };
    }

    return { blocked: false, code: "", reason: "" };
}

function isPromptTooLarge(promptText: string): { blocked: boolean; estimatedTokens: number } {
    const estimatedTokens = estimateTokens(promptText);
    return {
        blocked: estimatedTokens > AI_AGENT_INPUT_TOKEN_CAP,
        estimatedTokens,
    };
}

function requestLikelyNeedsDatabase(userMessage: string): boolean {
    const m = String(userMessage || "").toLowerCase();
    if (!m.trim()) return false;

    const isLoginPageRemovalOrRename =
        /\b(login|log in|sign in|signin|auth|authentication)\b/i.test(m) &&
        /\b(remove|delete|hide|rename|replace|remove entirely|get rid of|eliminate|disable|take down)\b/i.test(m) &&
        /\b(page|screen|route|view|component|screen|ui)\b/i.test(m);

    if (isLoginPageRemovalOrRename) return false;

    // High-signal: auth/accounts/persistence.
    const keywords = [
        "auth",
        "authentication",
        "login",
        "log in",
        "logout",
        "log out",
        "signup",
        "sign up",
        "register",
        "password",
        "reset password",
        "user account",
        "user accounts",
        "profile",
        "roles",
        "admin",
        "rbac",
        "permissions",
        "database",
        "postgres",
        "supabase",
        "persist",
        "persistence",
        "store in db",
        "save to db",
        "crud",
        "create a record",
        "save to database",
        "comments",
        "orders",
        "subscriptions",
        "checkout history",
    ];

    return keywords.some((k) => m.includes(k));
}

function messageExplicitlyDeclinesDatabase(text: string): boolean {
    const m = String(text || "").toLowerCase();
    if (!m.trim()) return false;

    const noDbSignals = [
        /\b(no|without|dont|don't|do not)\b[^\n]{0,40}\b(database|db|supabase|postgres)\b/i,
        /\b(database|db|supabase|postgres)\b[^\n]{0,40}\b(not needed|not required|not now|later|skip|no thanks)\b/i,
        /\b(doesnt|doesn't|do not|don't)\s+need\b[^\n]{0,60}\b(database|db|supabase|postgres)\b/i,
        /\b(database|db|supabase|postgres)\b[^\n]{0,60}\b(doesnt|doesn't|do not|don't)\s+need\b/i,
        /\bno\s+database\b/i,
        /\bwithout\s+(a\s+)?database\b/i,
        /\b(do\s+not|don't)\s+ask\s+.*\b(database|db|supabase)\b/i,
    ];

    return noDbSignals.some((re) => re.test(m));
}

function userDeclinedDatabaseInRecentHistory(history: unknown[]): boolean {
    const recent = Array.isArray(history) ? history.slice(-12) : [];
    for (let i = recent.length - 1; i >= 0; i--) {
        const raw = recent[i] as any;
        if (!raw || typeof raw !== "object") continue;
        if (raw.role !== "user") continue;
        if (messageExplicitlyDeclinesDatabase(String(raw.content || ""))) {
            return true;
        }
    }
    return false;
}

function requestLooksLikeUiOnlyAuthPreference(userMessage: string): boolean {
    const m = String(userMessage || "").toLowerCase();
    if (!m.trim()) return false;
    const wantsAuthUi = /\b(login|log in|signup|sign up|register|auth|authentication)\b/i.test(m);
    const uiOnly = /\b(ui|frontend|front-end|mock|placeholder|not connected|conencted|unconnected|static|without backend|no backend|just the page|just screens?)\b/i.test(m);
    return wantsAuthUi && uiOnly;
}

function messageExplicitlyAllowsBasicNoDatabase(text: string): boolean {
    const m = String(text || "").toLowerCase();
    if (!m.trim()) return false;

    const allowSignals = [
        /\bcontinue\b[^\n]{0,60}\bwithout\b[^\n]{0,40}\b(database|db|supabase)\b/i,
        /\bwithout\b[^\n]{0,40}\b(database|db|supabase)\b[^\n]{0,80}\b(basic|simple|fallback|mvp|demo)\b/i,
        /\b(basic|simple|fallback|mvp|demo)\b[^\n]{0,80}\bwithout\b[^\n]{0,40}\b(database|db|supabase)\b/i,
        /\bno\s+persistence\b/i,
        /\bnon[-\s]?persistent\b/i,
        /\bin[-\s]?memory\b/i,
    ];

    return allowSignals.some((re) => re.test(m));
}

function userAllowedBasicNoDatabaseInRecentHistory(history: unknown[]): boolean {
    const recent = Array.isArray(history) ? history.slice(-12) : [];
    for (let i = recent.length - 1; i >= 0; i--) {
        const raw = recent[i] as any;
        if (!raw || typeof raw !== "object") continue;
        if (raw.role !== "user") continue;
        if (messageExplicitlyAllowsBasicNoDatabase(String(raw.content || ""))) {
            return true;
        }
    }
    return false;
}

function fileEditsLookLikeInsecureLocalAuth(edits: FileEdit[]): boolean {
    const joined = edits.map((e) => `${e.path}\n${e.content}`).join("\n\n").toLowerCase();

    // Disallow obvious non-persistent / insecure user storage patterns.
    const redFlags: Array<(s: string) => boolean> = [
        (s) => s.includes("localstorage") && (s.includes("password") || s.includes("users") || s.includes("user")),
        (s) => s.includes("sessionstorage") && (s.includes("password") || s.includes("users") || s.includes("user")),
        (s) => s.includes("users.json"),
        (s) => s.includes("fs.writefile") && (s.includes("user") || s.includes("password")),
        (s) => s.includes("writefileSync") && (s.includes("user") || s.includes("password")),
        (s) => s.includes("const users = [") && s.includes("password"),
        (s) => s.includes("let users = [") && s.includes("password"),
        (s) => s.includes("inmemory") && s.includes("user"),
    ];

    return redFlags.some((fn) => fn(joined));
}

function fileEditsUseBrowserModalApis(edits: FileEdit[]): boolean {
    const joined = edits.map((e) => `${e.path}\n${e.content}`).join("\n\n");
    const blockedModalApi = /\b(?:window\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/i;
    return blockedModalApi.test(joined);
}

async function getSupabaseIntegrationStatus(params: { db: any; uid: string; appId: string }): Promise<{ connected: boolean; projectRef: string | null }> {
    const { db, uid, appId } = params;
    try {
        const ref = db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).collection("integrations").doc("supabase");
        const snap = await ref.get();
        if (!snap.exists) return { connected: false, projectRef: null };
        const data = snap.data() as any;
        const projectRef = typeof data?.projectRef === "string" ? data.projectRef.trim() : "";
        return { connected: true, projectRef: projectRef || null };
    } catch {
        return { connected: false, projectRef: null };
    }
}

function isSafeAppFilePath(path: string): boolean {
    if (!path) return false;
    if (path.startsWith("/") || path.startsWith("\\")) return false;
    if (path.includes("..")) return false;
    if (path.includes("\0")) return false;
    // Basic denylist to avoid obvious foot-guns
    const lower = path.toLowerCase();
    if (lower.includes(".env")) return false;
    if (lower.includes("serviceaccount")) return false;
    return true;
}

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

function looksLikeGenericAiConversationError(text: string): boolean {
    const value = String(text || "").toLowerCase();
    if (!value.trim()) return false;
    return (
        value.includes("please try again in a few minutes") ||
        value.includes("couldn’t complete that request right now") ||
        value.includes("could not complete that request right now") ||
        value.includes("that request is too large") ||
        value.includes("failed to get ai response") ||
        value.includes("sorry, i couldn’t") ||
        value.includes("sorry, i could not")
    );
}

function classifyAiProviderError(err: unknown): {
    statusCode: number;
    providerMessage: string;
    userMessage: string;
    code: string;
    providerErrorName: string;
    slackMessage: string;
    providerDiagnostics: Record<string, unknown>;
} {
    const raw = err instanceof Error ? err.message : String(err || "Unknown AI provider error");
    const msg = safeString(raw, 1500) || "Unknown AI provider error";
    const lower = msg.toLowerCase();
    const providerErrorName = err instanceof Error && err.name ? err.name : typeof (err as any)?.name === "string" ? String((err as any).name) : "Error";
    const providerDiagnostics: Record<string, unknown> =
        err && typeof err === "object"
            ? {
                  name: (err as any).name,
                  message: (err as any).message,
                  status: (err as any).status,
                  statusCode: (err as any).statusCode,
                  code: (err as any).code,
                  details: (err as any).details,
                  errorInfo: (err as any).errorInfo,
                  cause: (err as any).cause,
                  response: (err as any).response
                      ? {
                            status: (err as any).response.status,
                            statusText: (err as any).response.statusText,
                            data: (err as any).response.data,
                            text: (err as any).response.text,
                        }
                      : undefined,
              }
            : {};

    const nestedReasonCandidates = [
        (providerDiagnostics as any)?.response?.data?.error?.message,
        (providerDiagnostics as any)?.response?.data?.error?.status,
        (providerDiagnostics as any)?.response?.data?.error?.details,
        (providerDiagnostics as any)?.response?.data?.message,
        (providerDiagnostics as any)?.details,
        (providerDiagnostics as any)?.errorInfo?.message,
        (providerDiagnostics as any)?.cause?.message,
        (providerDiagnostics as any)?.response?.text,
        (providerDiagnostics as any)?.response?.data,
    ];
    const nestedReason = nestedReasonCandidates
        .map((value) => safeString(typeof value === "string" ? value : JSON.stringify(value), 1200).trim())
        .find(Boolean) || "";
    const slackMessage = nestedReason
        ? `AI provider failure: ${msg} | rootCause: ${nestedReason}`
        : `AI provider failure: ${msg}`;

    const genericUserMessage = "The AI service is temporarily unavailable. Please try again in a few minutes.";

    const statusFromMessage = (() => {
        const m = msg.match(/\b(4\d\d|5\d\d)\b/);
        if (!m) return 500;
        const n = Number(m[1]);
        return Number.isFinite(n) ? n : 500;
    })();

    const explicitRateLimit =
        statusFromMessage === 429 &&
        (
            lower.includes("rate limit") ||
            lower.includes("resource_exhausted") ||
            lower.includes("quota") ||
            lower.includes("too many requests")
        );

    const genericOverload =
        lower.includes("overwhelmed by requests") ||
        lower.includes("temporarily unavailable") ||
        lower.includes("service unavailable") ||
        lower.includes("backend error") ||
        lower.includes("server error");

    if (explicitRateLimit) {
        return {
            statusCode: 429,
            providerMessage: msg,
            userMessage: genericUserMessage,
            code: "AI_RATE_LIMITED",
            providerErrorName,
            slackMessage,
            providerDiagnostics,
        };
    }

    if (statusFromMessage === 429 || genericOverload) {
        return {
            statusCode: 503,
            providerMessage: msg,
            userMessage: genericUserMessage,
            code: "AI_PROVIDER_UNAVAILABLE",
            providerErrorName,
            slackMessage,
            providerDiagnostics,
        };
    }

    if (
        lower.includes("candidate was blocked") ||
        lower.includes("recitation") ||
        lower.includes("safety") ||
        lower.includes("policy")
    ) {
        return {
            statusCode: 400,
            providerMessage: msg,
            userMessage: "That request couldn’t be completed as written. Try rephrasing it and send it again.",
            code: "AI_SAFETY_REJECTED",
            providerErrorName,
            slackMessage,
            providerDiagnostics,
        };
    }

    if (
        statusFromMessage === 503 ||
        lower.includes("service unavailable") ||
        lower.includes("temporarily unavailable") ||
        lower.includes("unavailable")
    ) {
        return {
            statusCode: 503,
            providerMessage: msg,
            userMessage: genericUserMessage,
            code: "AI_PROVIDER_UNAVAILABLE",
            providerErrorName,
            slackMessage,
            providerDiagnostics,
        };
    }

    if (statusFromMessage >= 500) {
        return {
            statusCode: 503,
            providerMessage: msg,
            userMessage: genericUserMessage,
            code: "AI_PROVIDER_SERVER_ERROR",
            providerErrorName,
            slackMessage,
            providerDiagnostics,
        };
    }

    if (statusFromMessage >= 400) {
        return {
            statusCode: 400,
            providerMessage: msg,
            userMessage: genericUserMessage,
            code: "AI_BAD_REQUEST",
            providerErrorName,
            slackMessage,
            providerDiagnostics,
        };
    }

    return {
        statusCode: 503,
        providerMessage: msg,
        userMessage: genericUserMessage,
        code: "AI_UNKNOWN_ERROR",
        providerErrorName,
        slackMessage,
        providerDiagnostics,
    };
}

function buildRecentConversationContext(history: unknown[]): string {
    const recent = Array.isArray(history) ? history.slice(-6) : [];
    const parts: string[] = [];

    for (const raw of recent) {
        if (!raw || typeof raw !== "object") continue;
        const msg = raw as any;
        const role = msg.role === "assistant" ? "assistant" : msg.role === "user" ? "user" : null;
        const content = safeString(msg.content, 1200);
        if (!role || !content.trim()) continue;
        if (role === "assistant" && looksLikeGenericAiConversationError(content)) continue;
        parts.push(`${role}: ${content}`);
    }

    return parts.join("\n");
}

function normalizeStoredMessages(input: unknown): StoredMessage[] {
    if (!Array.isArray(input)) return [];
    const out: StoredMessage[] = [];
    for (const raw of input) {
        if (!raw || typeof raw !== "object") continue;
        const m = raw as any;

        const id = typeof m.id === "string" ? m.id : "";
        const role = m.role === "user" || m.role === "assistant" ? m.role : null;
        const content = typeof m.content === "string" ? m.content : null;
        const type = m.type === "text" || m.type === "code" || m.type === "file-edit" ? m.type : "text";
        const timestampMs = typeof m.timestampMs === "number" ? m.timestampMs : Date.now();
        if (!id || !role || content == null) continue;

        out.push({
            id,
            role,
            content,
            type,
            timestampMs,
            restorePointId: typeof m.restorePointId === "string" ? m.restorePointId : null,
            restoreActionLabel: typeof m.restoreActionLabel === "string" ? m.restoreActionLabel : null,
        });
    }
    return out.slice(-120);
}

async function persistLegacyAiChat(params: {
    db: any;
    uid: string;
    appId: string;
    userMessage: string;
    assistantMessage: string;
    conversationId?: string;
}) {
    const { db, uid, appId, userMessage, assistantMessage } = params;
    const conversationId = safeString(params.conversationId || "default", 80) || "default";

    const chatRef = db
        .collection("kloner_users")
        .doc(uid)
        .collection("kloner_apps")
        .doc(appId)
        .collection("ai_chat")
        .doc(conversationId);

    // Best-effort transactional append with tail trimming.
    await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(chatRef);
        const existing = snap.exists ? (snap.data() as any) : null;
        const base = normalizeStoredMessages(existing?.messages);

        const now = Date.now();
        const userId = `user_${now}_${crypto.randomUUID()}`;
        const aiId = `ai_${now}_${crypto.randomUUID()}`;

        const next = [
            ...base,
            {
                id: userId,
                role: "user",
                content: safeString(userMessage, 10_000),
                type: "text",
                timestampMs: now,
                restorePointId: null,
                restoreActionLabel: null,
            },
            {
                id: aiId,
                role: "assistant",
                content: safeString(assistantMessage, 20_000),
                type: "text",
                timestampMs: now,
                restorePointId: null,
                restoreActionLabel: null,
            },
        ].slice(-120);

        tx.set(
            chatRef,
            {
                messages: next,
                updatedAt: new Date(),
            },
            { merge: true },
        );
    });
}

function normalizeLeadingSlash(rawPath: string): string {
    return String(rawPath || "").trim().replace(/^\/+/, "");
}

function canonicalizeEditPath(rawPath: string, files: Record<string, { content: string; lastModified: number }>): string {
    const p0 = normalizeLeadingSlash(rawPath);
    if (!p0) return "";
    if (Object.prototype.hasOwnProperty.call(files, p0)) return p0;

    const hasAnyPrefix = (prefix: string) => Object.keys(files).some((k) => k.startsWith(prefix));

    // Prefer src/* roots if present (Next.js convention).
    let p = p0;
    if (p.startsWith("app/") && hasAnyPrefix("src/app/")) {
        p = `src/${p}`;
        if (Object.prototype.hasOwnProperty.call(files, p)) return p;
    } else if (p.startsWith("src/app/") && hasAnyPrefix("app/")) {
        const without = p.replace(/^src\//, "");
        if (Object.prototype.hasOwnProperty.call(files, without)) return without;
    }
    if (p.startsWith("pages/") && hasAnyPrefix("src/pages/")) {
        p = `src/${p}`;
        if (Object.prototype.hasOwnProperty.call(files, p)) return p;
    } else if (p.startsWith("src/pages/") && hasAnyPrefix("pages/")) {
        const without = p.replace(/^src\//, "");
        if (Object.prototype.hasOwnProperty.call(files, without)) return without;
    }

    // If the agent targets a file with the "wrong" extension, prefer an existing sibling.
    const extMatch = p.match(/^(.*)\.(tsx|ts|jsx|js)$/i);
    if (extMatch) {
        const base = extMatch[1];
        const candidates = [`${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, base];
        for (const c of candidates) {
            if (Object.prototype.hasOwnProperty.call(files, c)) return c;
        }
    }

    // Router-specific entrypoint mapping (pages<->app), including src/*.
    const candidatesForBase = (base: string) => [`${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`];
    const swapIfExists = (from: string, to: string) => {
        for (const c of candidatesForBase(to)) {
            if (Object.prototype.hasOwnProperty.call(files, c)) return c;
        }
        for (const c of candidatesForBase(from)) {
            if (Object.prototype.hasOwnProperty.call(files, c)) return c;
        }
        return "";
    };

    if (/^(src\/)?pages\/index\.(tsx|ts|jsx|js)$/i.test(p0)) {
        const match = swapIfExists(p0.replace(/\.(tsx|ts|jsx|js)$/i, ""), p0.replace(/^(src\/)?pages\/index\.(tsx|ts|jsx|js)$/i, "src/app/page"));
        if (match) return match;
        const match2 = swapIfExists(p0.replace(/\.(tsx|ts|jsx|js)$/i, ""), p0.replace(/^(src\/)?pages\/index\.(tsx|ts|jsx|js)$/i, "app/page"));
        if (match2) return match2;
    }

    if (/^(src\/)?app\/page\.(tsx|ts|jsx|js)$/i.test(p0)) {
        const match = swapIfExists(p0.replace(/\.(tsx|ts|jsx|js)$/i, ""), p0.replace(/^(src\/)?app\/page\.(tsx|ts|jsx|js)$/i, "src/pages/index"));
        if (match) return match;
        const match2 = swapIfExists(p0.replace(/\.(tsx|ts|jsx|js)$/i, ""), p0.replace(/^(src\/)?app\/page\.(tsx|ts|jsx|js)$/i, "pages/index"));
        if (match2) return match2;
    }

    return p;
}

function normalizeJsTsConfig(path: string, content: string): { ok: true; content: string } | { ok: false; error: string } {
    const lower = path.toLowerCase();
    const isConfig = lower === "tsconfig.json" || lower.endsWith("/tsconfig.json") || lower === "jsconfig.json" || lower.endsWith("/jsconfig.json");
    if (!isConfig) return { ok: true, content };

    let parsed: any;
    try {
        parsed = JSON.parse(content);
    } catch {
        return { ok: false, error: "Invalid JSON in tsconfig/jsconfig." };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "tsconfig/jsconfig must be a JSON object." };
    }

    if (!parsed.compilerOptions || typeof parsed.compilerOptions !== "object" || Array.isArray(parsed.compilerOptions)) {
        parsed.compilerOptions = {};
    }

    return { ok: true, content: JSON.stringify(parsed, null, 2) + "\n" };
}

function extractQuotedPhrases(text: string): string[] {
    const phrases: string[] = [];
    const re = /["“”']([^"“”']{2,160})["“”']/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text || ""))) {
        const value = String(match[1] || "").trim();
        if (value) phrases.push(value.toLowerCase());
    }
    return Array.from(new Set(phrases));
}

function extractSearchTerms(message: string, conversation: string): { phrases: string[]; terms: string[] } {
    const combined = `${message}\n${conversation}`;
    const stopWords = new Set([
        "the",
        "and",
        "for",
        "with",
        "this",
        "that",
        "from",
        "please",
        "change",
        "update",
        "make",
        "add",
        "edit",
        "text",
        "banner",
        "top",
        "section",
    ]);

    const terms = Array.from(
        new Set(
            combined
                .toLowerCase()
                .match(/[a-z0-9][a-z0-9_-]{2,}/g)
                ?.filter((term) => !stopWords.has(term)) || [],
        ),
    );

    return {
        phrases: extractQuotedPhrases(combined),
        terms,
    };
}

function requestLooksLikeCopyOrTextEdit(message: string, conversation: string): boolean {
    const combined = `${message}
${conversation}`.toLowerCase();
    if (!combined.trim()) return false;

    if (extractQuotedPhrases(combined).length > 0) return true;

    return /\b(change|replace|rewrite|update|edit|revise)\b[\s\S]{0,80}\b(text|copy|banner|headline|title|cta|button|label|hero|subhead|subheading)\b/i.test(combined)
        || /\b(make|turn|swap)\b[\s\S]{0,40}\b(say|read|display|show)\b/i.test(combined)
        || /\b(the following text|this text|that text|banner text|page copy)\b/i.test(combined);
}

function scoreBroadCopyCandidate(path: string, content: string, phrases: string[], terms: string[]): number {
    const normalizedPath = String(path || "").toLowerCase();
    const normalizedContent = String(content || "").toLowerCase();
    let score = 0;

    if (/\.(tsx|ts|jsx|js|html|mdx?|css|json|md)$/i.test(normalizedPath)) score += 2;
    if (/(page|layout|home|hero|banner|header|footer|copy|text|content|cta|section|marketing|landing|article|blog|post)/i.test(normalizedPath)) score += 3;
    if (/(headline|subheadline|subtitle|description|label|announcement|notice|copy|banner|hero|cta|button|title|summary|paragraph)/i.test(normalizedPath)) score += 2;

    for (const phrase of phrases) {
        if (phrase && normalizedContent.includes(phrase.toLowerCase())) {
            score += 12;
        }
    }

    for (const term of terms) {
        if (term && normalizedContent.includes(term.toLowerCase())) {
            score += 1;
        }
    }

    return score;
}

function buildBroadCopyCandidatePaths(
    files: Record<string, { content: string; lastModified: number }>,
    message: string,
    conversation: string,
    maxPaths = 12,
): string[] {
    const { phrases, terms } = extractSearchTerms(message, conversation);
    const scored = Object.entries(files || {})
        .map(([path, file]) => ({
            path,
            score: scoreBroadCopyCandidate(path, String(file?.content || ""), phrases, terms),
        }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

    return scored.slice(0, maxPaths).map((entry) => entry.path);
}

function findExactPhraseMatches(
    files: Record<string, { content: string; lastModified: number }>,
    phrases: string[],
    maxPaths = 12,
): string[] {
    const needlePhrases = Array.from(new Set((phrases || []).map((phrase) => String(phrase || "").trim().toLowerCase()).filter(Boolean)));
    if (needlePhrases.length === 0) return [];

    const scored = Object.entries(files || {})
        .map(([path, file]) => {
            const content = String(file?.content || "").toLowerCase();
            const matchScore = needlePhrases.reduce((count, phrase) => count + (content.includes(phrase) ? 1 : 0), 0);
            return { path, score: matchScore };
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

    return scored.slice(0, maxPaths).map((entry) => entry.path);
}

function buildRelevantExcerpt(content: string, phrases: string[], terms: string[], maxSnippetChars = 12000): string {
    const raw = String(content || "");
    if (raw.length <= maxSnippetChars) return raw;

    const lower = raw.toLowerCase();
    const needles = [...phrases, ...terms].filter(Boolean);

    for (const needle of needles) {
        const idx = lower.indexOf(needle.toLowerCase());
        if (idx >= 0) {
            const radius = Math.floor(maxSnippetChars / 2);
            const start = Math.max(0, idx - radius);
            const end = Math.min(raw.length, idx + radius);
            return [
                raw.slice(start, idx > start ? idx : start),
                raw.slice(idx, Math.min(end, idx + maxSnippetChars)),
            ].join("");
        }
    }

    const head = raw.slice(0, Math.floor(maxSnippetChars * 0.7));
    const tail = raw.slice(Math.max(0, raw.length - Math.floor(maxSnippetChars * 0.3)));
    return `${head}\n\n[...truncated... ]\n\n${tail}`;
}

function buildFileContext(
    files: Record<string, { content: string; lastModified: number }>,
    message: string,
    conversation: string,
    mode: "copy" | "targeted" | "broad",
    priorityPaths: string[] = [],
): string {
    // Soft limit to avoid runaway prompts
    const MAX_TOTAL = mode === "copy" ? 14_000 : mode === "targeted" ? 24_000 : AI_AGENT_CONTEXT_CHAR_CAP;
    const { phrases, terms } = extractSearchTerms(message, conversation);
    let total = 0;
    const parts: string[] = [];

    const orderedPaths = Array.from(new Set([
        ...priorityPaths.map((path) => String(path || "").trim()).filter(Boolean),
        ...Object.keys(files),
    ]));

    for (const path of orderedPaths) {
        const file = files[path];
        const content = typeof file?.content === "string" ? file.content : "";
        const header = `File: ${path}\n`;
        const remaining = MAX_TOTAL - total;
        if (remaining <= header.length) break;

        const chunkBudget = Math.max(0, remaining - header.length);
        const chunk = buildRelevantExcerpt(content, phrases, terms, Math.min(chunkBudget, mode === "copy" ? 4_000 : mode === "targeted" ? 7_000 : 10_000));
        parts.push(header + chunk);
        total += header.length + chunk.length;
        if (total >= MAX_TOTAL) break;
    }

    return parts.join("\n\n");
}

function trimConversationForMode(conversation: string, mode: "copy" | "targeted" | "broad"): string {
    const limit = mode === "copy" ? 1200 : mode === "targeted" ? 2200 : 4000;
    const value = safeString(conversation, limit);
    return value.length > limit ? value.slice(-limit) : value;
}

function buildPromptPreview(prompt: string, maxChars = 2400): string {
    const value = safeString(prompt, maxChars * 2);
    return value.length > maxChars ? `${value.slice(0, maxChars)}\n...[truncated]` : value;
}

function buildSelectedFilesPreview(files: Record<string, { content: string; lastModified: number }>, maxFiles = 4, maxCharsPerFile = 320): Array<{ path: string; chars: number; preview: string }> {
    return Object.entries(files)
        .slice(0, maxFiles)
        .map(([path, file]) => {
            const content = safeString(file?.content || "", maxCharsPerFile * 2);
            return {
                path,
                chars: content.length,
                preview: buildPromptPreview(content, maxCharsPerFile),
            };
        });
}

function buildSystemPrompt(params: {
    fileSelectionNote: string;
    currentFileNote: string;
    fileContext: string;
    copyEditContext: string;
    retrievedChunksContext: string;
    dbContext: string;
    dbPreferenceContext: string;
    noDbFallbackContext: string;
    recentConversation: string;
    message: string;
    buildContext: string;
    mode: "copy" | "targeted" | "broad";
}): string {
    const {
        fileSelectionNote,
        currentFileNote,
        fileContext,
        copyEditContext,
        retrievedChunksContext,
        dbContext,
        dbPreferenceContext,
        noDbFallbackContext,
        recentConversation,
        message,
        buildContext,
        mode,
    } = params;

    const compactMode = mode === "copy";
    const tone = compactMode
        ? "You are a precise Next.js app builder. Make the smallest safe change that satisfies the request."
        : "You are an expert Next.js developer working inside an app builder. Be conversational and helpful!";

    const safetySection = compactMode
        ? [
            "SECURITY + FEEDBACK:",
            "- Never use fake auth or local-only user storage.",
            "- Never store passwords client-side.",
            "- Never use browser alert/confirm/prompt in generated app code.",
            "- For user feedback, use inline UI, toast, snackbar, or a React modal.",
            "- You already have the source files below; do not ask the user to open code or claim you can only see compiled output.",
            "- Treat the attached current file as the primary editing anchor when it plausibly matches the request.",
            "- Use the selected file contents and path clues to infer the best file to edit; do not ask the user to point at a file unless no safe match exists.",
            "- Edit the selected app files directly.",
        ].join("\n")
        : [
            "SECURITY + PERSISTENCE (TOP PRIORITY):",
            "- NEVER implement \"fake\" auth or user storage using localStorage/sessionStorage/in-memory arrays/JSON files.",
            "- NEVER store passwords client-side, never store plaintext passwords anywhere.",
            "- NEVER use browser modal APIs (alert/confirm/prompt) for user feedback in generated app code.",
            "- For warnings/errors/success states, use in-app UI patterns (inline banner, toast/snackbar, form helper text, or modal component rendered in React), not window-level dialogs.",
            "- If the user requests authentication, user accounts, or any persistent data feature and a database is not connected, DO NOT implement workarounds. Instead:",
            "    - ask the user to connect Supabase,",
            "    - set setupDatabase: true,",
            "    - return zero fileEdits.",
            "- Exception: if the user explicitly asks to continue without a database and accepts a basic/non-persistent version, implement a safe basic fallback with setupDatabase: false.",
            "- If Supabase is connected, use Supabase Auth for authentication and propose any needed schema via dbMigrations (e.g. profiles table + RLS).",
        ].join("\n");

    const envSafetySection = compactMode
        ? ""
        : [
            "SUPABASE ENV SAFETY (DO NOT BREAK INITIAL RENDER):",
            "- NEVER write '.env', '.env.local', or any '.env.*' file.",
            "- NEVER call createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) at module scope.",
            "- When you need a Supabase browser client, scaffold a helper that lazily creates the client only after checking env vars at runtime.",
            "- If env vars are missing, return null and show a friendly UI message instead of throwing or failing the TypeScript build.",
            "- Only use NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY for browser code.",
        ].join("\n");

    const outputSection = [
        "CRITICAL OUTPUT FORMAT:",
        "Return ONLY valid JSON (no markdown, no backticks) matching this TypeScript shape:",
        "{",
        '  "response": string,',
        '  "refreshServer": boolean,',
        '  "fileEdits": Array<{ "path": string, "content": string }>,',
        '  "htmlEdits"?: Array<{ "path": string, "find": string, "replace": string }>,',
        '  "setupDatabase": boolean,',
        '  "dbMigrations"?: Array<{ "sql": string, "message"?: string, "destructive"?: boolean }>',
        "}",
        "",
        "Rules:",
        "- response should be short and user-friendly. Never include code, file paths, or technical details.",
        "- Never put SQL in response; use dbMigrations instead.",
        "- Only include file edits for the user's app files.",
        "- Keep changes minimal and ensure npm run build passes.",
        "- If you need no file changes, return an empty fileEdits array.",
        "- If you can edit safely, you must return fileEdits. Do not answer by summarizing the request when the task is actionable.",
        "- Use htmlEdits for chunk-targeted HTML/banner/copy updates when the exact before/after snippet is known; keep fileEdits for full-file rewrites.",
    ].join("\n");

    const copySection = compactMode
        ? [
            "COPY / TEXT EDITING:",
            "- If the user request contains quoted text, treat the quote as the exact edit anchor.",
            "- Search the hydrated files for that exact text and edit the file that contains it, even if it is a public HTML file, banner, hero, or layout file.",
            "- Do not ask for more context when the quoted sentence uniquely identifies the text to replace.",
            "- If the exact phrase appears in more than one file, prefer the visible current page first, then the page/layout file that renders the banner or section.",
        ].join("\n")
        : "";

    const promptParts = [
        tone,
        safetySection,
        envSafetySection,
        outputSection,
        copySection,
        copyEditContext,
        `Selected app files:\n${fileSelectionNote}`,
        currentFileNote,
        fileContext,
        dbContext,
        dbPreferenceContext,
        noDbFallbackContext,
        retrievedChunksContext,
        `Recent conversation:\n${recentConversation}`,
        `User request:\n${message}`,
        buildContext,
    ].filter((part) => Boolean(String(part || "").trim()));

    return promptParts.join("\n\n");
}

type AiFileSearchPlan = {
    mode: "copy" | "targeted" | "broad";
    selectedPaths: string[];
    needsMoreContext: boolean;
    questions: string[];
    reason: string;
    assistantMessage: string;
};
function buildFileCatalog(paths: string[], currentFile: string | null, maxPaths = 240): string {
    const normalizedCurrent = safeString(currentFile || "", 500).trim();
    const uniquePaths = Array.from(new Set(paths.map((path) => String(path || "").trim()).filter(Boolean)));
    const currentFirst = normalizedCurrent ? [normalizedCurrent, ...uniquePaths.filter((path) => path !== normalizedCurrent)] : uniquePaths;
    const limited = currentFirst.slice(0, maxPaths);

    return limited
        .map((path, index) => `${index + 1}. ${path}${path === normalizedCurrent ? " [current]" : ""}`)
        .join("\n");
}

function collectPlannerPathHints(value: unknown, out: Set<string>, limit = 4000) {
    if (!value || out.size >= limit) return;

    if (typeof value === "string") {
        const raw = value.trim();
        if (!raw) return;
        if (/^([a-z0-9_.-]+\/)+[a-z0-9_.-]+/i.test(raw) || /\.(tsx?|jsx?|css|html?|json|md|yaml|yml|js|ts|mjs|cjs|png|jpg|jpeg|gif|svg|webp|woff2?|otf)$/i.test(raw)) {
            out.add(raw.replace(/^\/+/, ""));
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) collectPlannerPathHints(item, out, limit);
        return;
    }

    if (typeof value === "object") {
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            if (/(path|filePath|targetPath|htmlPath|entryPath|storagePath)/i.test(key) && typeof nested === "string") {
                out.add(String(nested).trim().replace(/^\/+/, ""));
            }
            if (typeof key === "string" && /\.(tsx?|jsx?|css|html?|json|md|yaml|yml|js|ts|mjs|cjs)$/i.test(key)) {
                out.add(key.trim().replace(/^\/+/, ""));
            }
            collectPlannerPathHints(nested, out, limit);
        }
    }
}

function parseJsonFromText<T>(raw: string, fallback: T): T {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return fallback;
    try {
        return JSON.parse(trimmed) as T;
    } catch {
        const match = trimmed.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]) as T;
            } catch {
                return fallback;
            }
        }
    }
    return fallback;
}

function buildFileSearchPrompt(params: {
    message: string;
    currentFile: string | null;
    recentConversation: string;
    fileCatalog: string;
}): string {
    const { message, currentFile, recentConversation, fileCatalog } = params;
    const currentPageLabel = currentFile ? "the currently open page" : "the selected page";

    return [
        "You are the file-search stage for an IDE-style code assistant.",
        "Choose the smallest useful set of files before any edits are written.",
        `The user cannot see file names. The current visible page should be treated as ${currentPageLabel}.`,
        "Return only valid JSON with this shape:",
        '{"mode":"copy|targeted|broad","selectedPaths":["path"],"needsMoreContext":boolean,"questions":["short question"],"reason":"short reason","assistantMessage":"short user-facing message"}',
        "Rules:",
        "- Prefer the current file when it plausibly matches the request.",
        "- Prefer editable source files over generated HTML when both exist.",
        "- For copy requests, choose 1 to 3 files.",
        "- For targeted requests, choose 1 to 6 files.",
        "- For broad requests, choose up to 10 files.",
        "- If the request is quoted copy/text or a banner rewrite and currentFile is null, favor broad mode and search page/layout/component/content files instead of asking for more details.",
        "- If no edits have been applied yet, assistantMessage must not claim the change is already done or promise a file edit. It should either summarize what was searched or ask a clarifying question.",
        "- If the request is too ambiguous, set needsMoreContext=true and ask at most 2 short questions that do not mention file paths.",
        "- Keep selectedPaths minimal and relevant.",
        `Recent conversation:\n${recentConversation}`,
        `User request:\n${message}`,
        `Available files:\n${fileCatalog}`,
    ].join("\n\n");
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

function buildUserFacingNoOpMessage(params: { currentFile: string | null; needsMoreContext?: boolean }): string {
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

function sanitizeUserFacingAiMessage(params: { text: unknown; fallback: string }): string {
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

type RetrievedChunk = {
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

function formatRetrievedChunksSection(chunks: unknown): string {
    if (!Array.isArray(chunks) || chunks.length === 0) return "";

    const lines: string[] = ["Retrieved embedding chunks:"];
    let renderedCount = 0;
    chunks.slice(0, 12).forEach((chunk, index) => {
        if (!chunk || typeof chunk !== "object") return;
        const path = safeString((chunk as any).path || "", 500).trim();
        const chunkId = safeString((chunk as any).chunkId || "", 200).trim();
        const lineRange = (chunk as any).lineRange && typeof (chunk as any).lineRange === "object"
            ? (chunk as any).lineRange
            : null;
        const startLineValue = Number.isFinite(Number(lineRange?.start))
            ? Number(lineRange?.start)
            : Number.isFinite(Number((chunk as any).startLine))
                ? Number((chunk as any).startLine)
                : null;
        const endLineValue = Number.isFinite(Number(lineRange?.end))
            ? Number(lineRange?.end)
            : Number.isFinite(Number((chunk as any).endLine))
                ? Number((chunk as any).endLine)
                : null;
        const startLine = startLineValue !== null ? Math.max(1, Math.floor(startLineValue)) : null;
        const endLine = endLineValue !== null ? Math.max(1, Math.floor(endLineValue)) : null;
        const score = Number.isFinite(Number((chunk as any).score)) ? Number((chunk as any).score) : null;
        const text = safeString((chunk as any).chunkText || (chunk as any).text || (chunk as any).excerpt || "", 12_000).trim();
        const source = safeString((chunk as any).source || "", 200).trim();

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

function replaceOnce(source: string, find: string, replace: string): { ok: boolean; content: string } {
    const haystack = String(source || "");
    const needle = String(find || "");
    if (!needle.trim()) return { ok: false, content: haystack };

    const index = haystack.indexOf(needle);
    if (index === -1) return { ok: false, content: haystack };
    return {
        ok: true,
        content: `${haystack.slice(0, index)}${replace}${haystack.slice(index + needle.length)}`,
    };
}

function normalizeHtmlEditOps(
    htmlEdits: unknown,
    files: Record<string, { content: string; lastModified: number }>,
): FileEdit[] {
    if (!Array.isArray(htmlEdits) || htmlEdits.length === 0) return [];

    const working = new Map<string, string>();
    const edits: FileEdit[] = [];

    for (const raw of htmlEdits) {
        if (!raw || typeof raw !== "object") continue;
        const path = canonicalizeEditPath(safeString((raw as any).path, 500), files);
        const find = safeString((raw as any).find || (raw as any).before || (raw as any).match || "", 30_000);
        const replace = safeString((raw as any).replace || (raw as any).after || (raw as any).content || "", 100_000);
        if (!path || !find.trim()) continue;

        const baseContent = working.has(path)
            ? working.get(path) || ""
            : String(files?.[path]?.content || "");
        const applied = replaceOnce(baseContent, find, replace);
        if (!applied.ok) continue;

        working.set(path, applied.content);
        edits.push({ path, content: applied.content });
    }

    return edits;
}

function looksLikeCompletionClaim(text: string): boolean {
    const value = String(text || "").toLowerCase();
    if (!value.trim()) return false;
    return /\b(i('| a)m|i have|i’ve|i've|i will|i’ll|i'll|added|updated|changed|fixed|made)\b/.test(value) && /\b(changes?|edit|file|background|hero|page|section)\b/.test(value);
}

async function planAiFiles(params: {
    model: any;
    message: string;
    currentFile: string | null;
    recentConversation: string;
    filePaths: string[];
    files: Record<string, { content: string; lastModified: number }>;
    fileManifest?: unknown;
    htmlEditIndex?: unknown;
    retrievedChunks?: unknown;
}): Promise<AiFileSearchPlan> {
    const { model, message, currentFile, recentConversation, filePaths, files, fileManifest, htmlEditIndex, retrievedChunks } = params;
    const manifestPaths = new Set<string>();
    collectPlannerPathHints(fileManifest, manifestPaths);
    collectPlannerPathHints(htmlEditIndex, manifestPaths);

    const catalogPaths = Array.from(new Set([
        ...filePaths,
        ...Array.from(manifestPaths),
    ].map((path) => String(path || "").trim()).filter(Boolean)));

    const prompt = buildFileSearchPrompt({
        message,
        currentFile,
        recentConversation,
        fileCatalog: buildFileCatalog(catalogPaths, currentFile),
    });

    const result = await model.generateContent(prompt);
    const raw = result.response?.text?.() || "";
    const parsed = parseJsonFromText<Partial<AiFileSearchPlan>>(raw, {});

    const isCopyOrTextEdit = requestLooksLikeCopyOrTextEdit(message, recentConversation);
    const searchTerms = extractSearchTerms(message, recentConversation);
    const broadCopyPaths = isCopyOrTextEdit ? buildBroadCopyCandidatePaths(files, message, recentConversation) : [];
    const exactPhrasePaths = isCopyOrTextEdit ? findExactPhraseMatches(files, searchTerms.phrases) : [];

    const selectedPaths = Array.isArray(parsed.selectedPaths)
        ? parsed.selectedPaths
              .map((path) => safeString(path, 500).trim())
              .filter(Boolean)
        : [];
    const questions = Array.isArray(parsed.questions)
        ? parsed.questions
              .map((question) => safeString(question, 240).trim())
              .filter(Boolean)
              .slice(0, 2)
        : [];
    const mode = isCopyOrTextEdit
        ? "broad"
        : parsed.mode === "copy" || parsed.mode === "broad" || parsed.mode === "targeted"
            ? parsed.mode
            : "targeted";

    const mergedSelectedPaths = Array.from(new Set([
        ...selectedPaths,
        ...exactPhrasePaths,
        ...broadCopyPaths,
    ])).slice(0, mode === "copy" ? 3 : mode === "targeted" ? 6 : 10);

    return {
        mode,
        selectedPaths: mergedSelectedPaths,
        needsMoreContext: isCopyOrTextEdit ? false : Boolean(parsed.needsMoreContext),
        questions,
        reason: isCopyOrTextEdit
            ? "Broad copy/text request detected; preselected page/layout/content files from the quoted phrase and broadened context."
            : safeString(parsed.reason || "", 500),
        assistantMessage: isCopyOrTextEdit
            ? "I found likely text-edit targets from the quoted copy and broadened the search across page and content files."
            : safeString(parsed.assistantMessage || "", 1200),
    };
}

async function runBuildCheck(origin: string, appId: string, files: Record<string, { content: string; lastModified: number }>) {
    const internalSecret = process.env.INTERNAL_API_SECRET;
    if (!internalSecret) {
        return {
            ok: true,
            exitCode: 0,
            logs: "INTERNAL_API_SECRET is not set; build check is disabled",
        };
    }

    const res = await fetch(`${origin}/api/webcontainer`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-kloner-internal": internalSecret,
        },
        body: JSON.stringify({ appId, files, mode: "build" }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        return {
            ok: false,
            exitCode: 1,
            logs: safeString((data as any)?.logs || (data as any)?.error || "Build failed", 60_000),
        };
    }

    return {
        ok: Boolean((data as any)?.ok),
        exitCode: (data as any)?.exitCode ?? 0,
        logs: safeString((data as any)?.logs || "", 60_000),
    };
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
        let observedAppId = "";
        let aiSlackPrompt = "";
        let aiSlackConversationTail = "";
        let aiSlackFileCount = 0;
        let aiSlackRequestDigest = "";
        let aiSlackSelectedFilesPreview: Array<{ path: string; chars: number; preview: string }> = [];
        let aiSlackFileContextPreview = "";
        let aiSlackFinalPromptPreview = "";
        let aiRequestPromptTokenEstimate = 0;
        const requestId = crypto.randomUUID().slice(0, 12);
        let aiRequestUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: null as number | null,
            attempts: 0,
        };
        try {
            const body = await req.json();
            const message = safeString(body?.message, 10_000);
            const appId = safeString(body?.appId, 200);
            const currentFile = safeString(body?.currentFile, 500) || null;
            const currentFileContent = safeString(body?.currentFileContent, 200_000) || null;
            observedAppId = appId;
            const persistChat = body?.persistChat === true;
            const conversationId = safeString(body?.conversationId, 80);
            const conversationHistory = Array.isArray(body?.conversationHistory)
                ? (body.conversationHistory as any[])
                : [];
            const databaseConnections = Array.isArray(body?.databaseConnections)
                ? (body.databaseConnections as any[])
                : [];
            const retrievedChunks = Array.isArray(body?.retrievedChunks)
                ? (body.retrievedChunks as RetrievedChunk[])
                : [];
            const autoFix = body?.autoFix !== false;
            const maxIterations = typeof body?.maxIterations === "number" ? Math.min(3, Math.max(1, body.maxIterations)) : 2;

            if (!message || !appId) {
                return NextResponse.json({ error: "Missing message or appId" }, { status: 400 });
            }

            // Prevent request editing attacks: only allow the currently bound appId.
            assertAppBuilderScope(authedReq, uid, appId);

            const db = getAdminDb();

            // Determine whether Supabase is actually connected (source of truth used elsewhere in the product).
            const supabase = await getSupabaseIntegrationStatus({ db, uid, appId });
            const hasSupabaseForApp = Boolean(supabase.connected);
            const hasUiDbConnections = databaseConnections.length > 0;
            const hasAnyDbSignal = hasSupabaseForApp || hasUiDbConnections;
            const userDeclinedDb =
                messageExplicitlyDeclinesDatabase(message) ||
                userDeclinedDatabaseInRecentHistory(conversationHistory);
            const allowUiOnlyAuthWithoutDb = userDeclinedDb && requestLooksLikeUiOnlyAuthPreference(message);
            const allowBasicWithoutDb =
                (userDeclinedDb || messageExplicitlyDeclinesDatabase(message)) &&
                (messageExplicitlyAllowsBasicNoDatabase(message) ||
                    userAllowedBasicNoDatabaseInRecentHistory(conversationHistory));

            // Security-first guard: if a request likely needs persistence/auth and no DB is connected,
            // do not implement fake/local auth. Instead, push the user to connect Supabase.
            if (requestLikelyNeedsDatabase(message) && !hasSupabaseForApp && !allowUiOnlyAuthWithoutDb && !allowBasicWithoutDb) {
                const response = hasUiDbConnections
                    ? "This request needs persistent storage, but Supabase is not currently connected to this app. I won’t generate database-dependent code until Supabase is connected to avoid partial/staged changes.\n\nPlease connect Supabase now, then I can continue and create the required schema safely."
                    : "This feature needs secure, persistent storage (database) to be safe. Right now no database is connected, so I won’t create local/in-memory users or store passwords on the client.\n\nDo you want to connect Supabase now and have me set up authentication + the required schema (e.g. a profiles table + RLS) for you?";

                if (persistChat) {
                    try {
                        await persistLegacyAiChat({
                            db,
                            uid,
                            appId,
                            userMessage: message,
                            assistantMessage: response,
                            conversationId: conversationId || undefined,
                        });
                    } catch (err) {
                        console.warn("[ai-agent] chat persistence failed", err);
                    }
                }

                return NextResponse.json(
                    {
                        response,
                        refreshServer: false,
                        fileEdits: [],
                        setupDatabase: true,
                        dbMigrations: [],
                    },
                    { status: 200 },
                );
            }

            const appRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("kloner_apps")
                .doc(appId);

            const snap = await appRef.get();
            if (!snap.exists) {
                return NextResponse.json({ error: "App not found" }, { status: 404 });
            }

            const recentConversation = buildRecentConversationContext(conversationHistory);
            const appData = snap.data() as any;
            const allFiles = (appData?.files || {}) as Record<string, { content: string; lastModified: number }>;
            if (currentFile && currentFileContent) {
                allFiles[currentFile] = {
                    content: currentFileContent,
                    lastModified: Date.now(),
                };
            }
            const filePaths = Object.keys(allFiles);
            const plannerModel = genAI.getGenerativeModel({
                model: process.env.GEMINI_MODEL || "gemini-3-pro-preview",
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                ],
                generationConfig: {
                    maxOutputTokens: 512,
                    temperature: 0.1,
                },
            });
            const plannedSelection = await planAiFiles({
                model: plannerModel,
                message,
                currentFile,
                recentConversation,
                filePaths,
                files: allFiles,
                fileManifest: appData?.fileManifest || null,
                htmlEditIndex: appData?.htmlEditIndex,
            });
            const selectedPaths = Array.from(new Set([
                ...(currentFile ? [currentFile] : []),
                ...plannedSelection.selectedPaths,
                ...(requestLooksLikeCopyOrTextEdit(message, recentConversation) ? findExactPhraseMatches(allFiles, extractSearchTerms(message, recentConversation).phrases) : []),
                ...(requestLooksLikeCopyOrTextEdit(message, recentConversation) ? buildBroadCopyCandidatePaths(allFiles, message, recentConversation) : []),
            ].map((path) => String(path || "").trim()).filter(Boolean)));
            const selectedFileContext = {
                mode: plannedSelection.mode,
                selectedPaths,
                summary: plannedSelection.reason
                    ? `Planner selected ${selectedPaths.length} files (${plannedSelection.mode}): ${selectedPaths.join(", ")} — ${plannedSelection.reason}`
                    : `Planner selected ${selectedPaths.length} files (${plannedSelection.mode}): ${selectedPaths.join(", ")}`,
                useFullContext: plannedSelection.mode === "broad" || selectedPaths.length === 0 || requestLooksLikeCopyOrTextEdit(message, recentConversation),
            };
            const effectiveMaxIterations = selectedFileContext.mode === "copy" ? 1 : maxIterations;

            if (plannedSelection.needsMoreContext && selectedPaths.length === 0) {
                    const response = sanitizeUserFacingAiMessage({
                        text: plannedSelection.assistantMessage || plannedSelection.questions.join("\n"),
                        fallback: buildUserFacingNoOpMessage({ currentFile, needsMoreContext: true }),
                    });

                if (persistChat) {
                    try {
                        await persistLegacyAiChat({
                            db,
                            uid,
                            appId,
                            userMessage: message,
                            assistantMessage: response,
                            conversationId: conversationId || undefined,
                        });
                    } catch (err) {
                        console.warn("[ai-agent] chat persistence failed", err);
                    }
                }

                return NextResponse.json(
                    {
                        response,
                        clarifyingQuestions: plannedSelection.questions,
                        fileEdits: [],
                        refreshServer: false,
                        setupDatabase: false,
                        dbMigrations: [],
                        requestId,
                        creditCost: 1,
                    },
                    { status: 200 },
                );
            }

            const files = selectedFileContext.useFullContext
                ? await hydrateAppBuilderFiles({
                    db,
                    uid,
                    appId,
                    files: allFiles,
                    fileManifest: appData?.fileManifest || null,
                    fileStorageCollection: typeof appData?.fileStorageCollection === "string" ? appData.fileStorageCollection : null,
                    fileStorageMode: typeof appData?.fileStorageMode === "string" ? appData.fileStorageMode : null,
                    containerCode: typeof appData?.containerCode === "string" ? appData.containerCode : null,
                    htmlStoragePath: appData?.htmlStoragePath || null,
                    htmlEditIndex: appData?.htmlEditIndex,
                })
                : await hydrateAppBuilderFilesByPaths({
                    db,
                    uid,
                    appId,
                    files: allFiles,
                    fileManifest: appData?.fileManifest || null,
                    fileStorageCollection: typeof appData?.fileStorageCollection === "string" ? appData.fileStorageCollection : null,
                    fileStorageMode: typeof appData?.fileStorageMode === "string" ? appData.fileStorageMode : null,
                    htmlStoragePath: appData?.htmlStoragePath || null,
                    htmlEditIndex: appData?.htmlEditIndex,
                    paths: selectedPaths,
                });
            aiSlackFileCount = Object.keys(files).length;

            const origin = new URL(req.url).origin;
            aiSlackPrompt = message;
            aiSlackConversationTail = trimConversationForMode(recentConversation, selectedFileContext.mode);
            aiSlackRequestDigest = requestId;

            const model = genAI.getGenerativeModel({
                model: process.env.GEMINI_MODEL || "gemini-3-pro-preview",
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                ],
                generationConfig: {
                    maxOutputTokens: AI_AGENT_OUTPUT_TOKEN_CAP,
                    temperature: 0.2,
                },
            });

            let lastBuild = { ok: true, exitCode: 0, logs: "" };
            let aggregatedEdits: FileEdit[] = [];
            let assistantSummary = "";
            let refreshServer = false;
            let setupDatabase = false;
            let lastRestorePointId: string | null = null;
            let dbMigrations: Array<{ sql: string; message?: string; destructive?: boolean }> = [];
            let aiFollowupQuestions: string[] = [];

            for (let attempt = 1; attempt <= effectiveMaxIterations; attempt++) {
                const promptMode = selectedFileContext.mode;
                const fileContext = buildFileContext(files, message, recentConversation, promptMode, selectedPaths);
                const fileSelectionNote = selectedFileContext.summary;
                const currentFileNote = currentFile ? `Current open file: ${currentFile}` : "Current open file: (none)";
                const copyEditContext = requestLooksLikeCopyOrTextEdit(message, recentConversation)
                    ? [
                        "Copy/text request search trace:",
                        `- Exact quoted phrases: ${extractSearchTerms(message, recentConversation).phrases.length ? extractSearchTerms(message, recentConversation).phrases.map((phrase: string) => JSON.stringify(phrase)).join(", ") : "(none found)"}`,
                        `- Exact phrase matches: ${findExactPhraseMatches(allFiles, extractSearchTerms(message, recentConversation).phrases).length ? findExactPhraseMatches(allFiles, extractSearchTerms(message, recentConversation).phrases).join(", ") : "(none)"}`,
                        `- Broad content candidates: ${buildBroadCopyCandidatePaths(allFiles, message, recentConversation).length ? buildBroadCopyCandidatePaths(allFiles, message, recentConversation).join(", ") : "(none)"}`,
                        `- Search-selected paths: ${selectedPaths.length ? selectedPaths.join(", ") : "(none)"}`,
                    ].join("\n")
                    : "";
                const retrievedChunksContext = formatRetrievedChunksSection(retrievedChunks);
                const buildContext = !lastBuild.ok
                    ? `\n\nLast build failed. Here are the build logs (most recent):\n${lastBuild.logs}\n\nThe previous attempt returned zero fileEdits. Return actual fileEdits for one of the selected files or ask a clarifying question. Do not summarize the request.`
                    : "";

                const dbContext = hasAnyDbSignal
                    ? `\n\nDatabase status:\n- Supabase integration: ${supabase.connected ? `connected${supabase.projectRef ? ` (${supabase.projectRef})` : ""}` : "not connected"}\n${databaseConnections.length > 0
                        ? `\nConnected databases with MCP integration:\n${databaseConnections
                            .map((db) => `- ${db.name} (${db.type}): Full MCP access to database operations, schema exploration, query generation, and real-time development tools`)
                            .join("\n")}`
                        : ""}${!hasSupabaseForApp && hasUiDbConnections
                        ? "\n- Important: Supabase is not connected for this app right now. Do not generate persistence-dependent code or schema plans until Supabase is connected."
                        : ""}`
                    : "\n\nNo databases connected yet.";

                const dbPreferenceContext = userDeclinedDb
                    ? "\n\nUser preference signal:\n- The user explicitly declined connecting a database in this conversation.\n- Do not ask them to connect Supabase again unless they explicitly request persistent auth/data.\n- If they ask for login/signup without backend persistence, provide UI-only pages/components (no localStorage/sessionStorage/in-memory user auth, no password handling), and set setupDatabase=false."
                    : "";

                const noDbFallbackContext = allowBasicWithoutDb
                    ? "\n\nNo-database fallback mode:\n- The user explicitly chose to continue without Supabase/database setup.\n- Implement a basic version that avoids persistence requirements.\n- Prefer UI-only or in-memory behavior for demo flows.\n- Do not store passwords, auth credentials, or user accounts in localStorage/sessionStorage/in-memory arrays.\n- Do not ask to connect Supabase again in this response.\n- Set setupDatabase=false."
                    : "";

                                const systemPrompt = buildSystemPrompt({
                                    fileSelectionNote,
                                    currentFileNote,
                                    fileContext,
                                    copyEditContext,
                                    retrievedChunksContext,
                                    dbContext,
                                    dbPreferenceContext,
                                    noDbFallbackContext,
                                    recentConversation: trimConversationForMode(recentConversation, promptMode),
                                    message,
                                    buildContext,
                                    mode: promptMode,
                                });

                const preflightPromptTokens = estimateTokens(systemPrompt);
                aiRequestPromptTokenEstimate = preflightPromptTokens;
                aiSlackSelectedFilesPreview = buildSelectedFilesPreview(files);
                aiSlackFileContextPreview = buildPromptPreview(fileContext);
                aiSlackFinalPromptPreview = buildPromptPreview(systemPrompt);

                await captureAuditEvent({
                    source: "internal",
                    severity: "info",
                    alwaysNotifySlack: true,
                    route: "/api/ai-agent",
                    method: "POST",
                    action: aiSlackRequestDigest ? `ai_agent_prompt_built:${aiSlackRequestDigest}` : "ai_agent_prompt_built",
                    userId: uid,
                    service: "ai-agent",
                    tags: ["ai-agent", "prompt-debug", "selection-preview"],
                    message: `AI agent prompt built with ${selectedFileContext.selectedPaths.length} selected files in ${promptMode} mode`,
                    extra: {
                        appId: observedAppId || null,
                        requestDigest: aiSlackRequestDigest || null,
                        selectionMode: selectedFileContext.mode,
                        selectionSummary: selectedFileContext.summary,
                        selectedPaths: selectedFileContext.selectedPaths,
                        selectedFileCount: selectedFileContext.selectedPaths.length,
                        selectedFilesPreview: aiSlackSelectedFilesPreview,
                        fileContextPreview: aiSlackFileContextPreview,
                        finalPromptPreview: aiSlackFinalPromptPreview,
                        promptTokens: preflightPromptTokens,
                        inputTokenCap: AI_AGENT_INPUT_TOKEN_CAP,
                        outputTokenCap: AI_AGENT_OUTPUT_TOKEN_CAP,
                    },
                });

                const tooLarge = isPromptTooLarge(systemPrompt);
                if (tooLarge.blocked) {
                    const response = `That request is too large for this AI route right now. Please shorten the prompt or reduce the amount of context and try again.`;

                    await captureAuditEvent({
                        source: "internal",
                        severity: "warning",
                        statusCode: 413,
                        alwaysNotifySlack: true,
                        route: "/api/ai-agent",
                        method: "POST",
                        action: aiSlackRequestDigest ? `ai_agent_request_rejected:${aiSlackRequestDigest}` : "ai_agent_request_rejected",
                        userId: uid,
                        message: `AI agent request rejected before Google: estimated ${tooLarge.estimatedTokens} input tokens exceeds cap ${AI_AGENT_INPUT_TOKEN_CAP}`,
                        errorName: "AI_REQUEST_TOO_LARGE",
                        service: "ai-agent",
                        tags: ["ai-agent", "request-validation", "token-cap"],
                        extra: {
                            appId: observedAppId || null,
                            requestDigest: aiSlackRequestDigest || null,
                            userFacingResponse: response,
                            estimatedInputTokens: tooLarge.estimatedTokens,
                            inputTokenCap: AI_AGENT_INPUT_TOKEN_CAP,
                            outputTokenCap: AI_AGENT_OUTPUT_TOKEN_CAP,
                            promptTokens: preflightPromptTokens,
                            messageLength: message.length,
                            selectionMode: selectedFileContext.mode,
                            selectedPaths: selectedFileContext.selectedPaths,
                            selectedFileCount: selectedFileContext.selectedPaths.length,
                            selectedFilesPreview: aiSlackSelectedFilesPreview,
                            fileContextPreview: aiSlackFileContextPreview,
                            finalPromptPreview: aiSlackFinalPromptPreview,
                        },
                    });

                    return NextResponse.json(
                        {
                            error: response,
                            code: "AI_REQUEST_TOO_LARGE",
                        },
                        { status: 413 },
                    );
                }

                const unsafeRequest = isUnsafeAiRequest(message);
                if (unsafeRequest.blocked) {
                    const response = "That request could not be sent to the model. Please rephrase it without abusive, violent, sexual, or malicious content.";

                    await captureAuditEvent({
                        source: "internal",
                        severity: "warning",
                        statusCode: 400,
                        alwaysNotifySlack: true,
                        route: "/api/ai-agent",
                        method: "POST",
                        action: aiSlackRequestDigest ? `ai_agent_request_blocked:${aiSlackRequestDigest}` : "ai_agent_request_blocked",
                        userId: uid,
                        message: `AI agent request blocked before Google: ${unsafeRequest.reason}`,
                        errorName: unsafeRequest.code,
                        service: "ai-agent",
                        tags: ["ai-agent", "request-validation", "safety-block"],
                        extra: {
                            appId: observedAppId || null,
                            requestDigest: aiSlackRequestDigest || null,
                            userFacingResponse: response,
                            reason: unsafeRequest.reason,
                            code: unsafeRequest.code,
                            inputTokenCap: AI_AGENT_INPUT_TOKEN_CAP,
                            outputTokenCap: AI_AGENT_OUTPUT_TOKEN_CAP,
                            selectionMode: selectedFileContext.mode,
                            selectedPaths: selectedFileContext.selectedPaths,
                            selectedFileCount: selectedFileContext.selectedPaths.length,
                            selectedFilesPreview: aiSlackSelectedFilesPreview,
                            fileContextPreview: aiSlackFileContextPreview,
                            finalPromptPreview: aiSlackFinalPromptPreview,
                        },
                    });

                    return NextResponse.json(
                        {
                            error: response,
                            code: unsafeRequest.code,
                        },
                        { status: 400 },
                    );
                }

                const result = await model.generateContent(systemPrompt);
                const geminiResponse = result.response as any;
                const raw = geminiResponse.text().trim();
                const usage = summarizeAiUsage(geminiResponse?.usageMetadata || null, preflightPromptTokens, estimateTokens(raw));
                aiRequestUsage.inputTokens += usage.actualInputTokens ?? usage.estimatedInputTokens;
                aiRequestUsage.outputTokens += usage.actualOutputTokens ?? usage.estimatedOutputTokens;
                aiRequestUsage.totalTokens += usage.totalTokens ?? (usage.actualInputTokens ?? usage.estimatedInputTokens) + (usage.actualOutputTokens ?? usage.estimatedOutputTokens);
                if (usage.estimatedCostUsd !== null) {
                    aiRequestUsage.estimatedCostUsd = Number(((aiRequestUsage.estimatedCostUsd ?? 0) + usage.estimatedCostUsd).toFixed(6));
                }
                aiRequestUsage.attempts += 1;

                if (looksLikeProviderLeak(raw)) {
                    throw new Error(raw);
                }

                let parsed: {
                    response?: string;
                    refreshServer?: boolean;
                    fileEdits?: FileEdit[];
                    htmlEdits?: Array<{ path?: string; find?: string; replace?: string }>;
                    setupDatabase?: boolean;
                    dbMigrations?: Array<{ sql?: string; message?: string; destructive?: boolean }>;
                } = {
                    response: "",
                    refreshServer: false,
                    fileEdits: [],
                    setupDatabase: false,
                };
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    // If the model fails JSON, try to extract JSON from the text
                    const jsonMatch = raw.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        try {
                            parsed = JSON.parse(jsonMatch[0]);
                        } catch {
                            // Still failed, use fallback
                            parsed = { response: "", refreshServer: false, fileEdits: [] };
                        }
                    } else {
                        // No JSON found, use fallback
                        parsed = { response: "", refreshServer: false, fileEdits: [] };
                    }
                }

                // Post-parse guard: never allow insecure local user storage/auth to land in app files.
                const fileEdits = [
                    ...(Array.isArray(parsed.fileEdits) ? (parsed.fileEdits as FileEdit[]) : []),
                    ...normalizeHtmlEditOps(parsed.htmlEdits, files),
                ];
                if (fileEdits.length > 0 && fileEditsUseBrowserModalApis(fileEdits)) {
                    return NextResponse.json(
                        {
                            response:
                                "I blocked this edit because it used browser dialogs (alert/confirm/prompt). I can regenerate it using in-app UI feedback (banner/toast/modal component) so it works reliably in embedded preview.",
                            refreshServer: false,
                            fileEdits: [],
                            setupDatabase: false,
                            dbMigrations: [],
                        },
                        { status: 200 },
                    );
                }

                if (fileEdits.length > 0 && fileEditsLookLikeInsecureLocalAuth(fileEdits)) {
                    return NextResponse.json(
                        {
                            response:
                                "I’m not going to implement authentication by storing users locally (it’s insecure and won’t persist). The secure path is to connect Supabase and use Supabase Auth, then I can create the required schema (profiles/RLS) for you.",
                            refreshServer: false,
                            fileEdits: [],
                            setupDatabase: true,
                            dbMigrations: [],
                        },
                        { status: 200 },
                    );
                }

                let response = safeString(parsed.response || "I've made the requested changes to your app.", 20_000);
                if (!response.trim()) {
                    response = "";
                }

                if (looksLikeProviderLeak(response)) {
                    throw new Error(response);
                }
                
                // Ensure response doesn't contain code
                if (response.includes('content":') || response.includes('path":') || response.length > 500) {
                    response = "";
                }
                
                setupDatabase = Boolean(parsed.setupDatabase);
                refreshServer = Boolean(parsed.refreshServer);

                // Database migrations are handled client-side via propose -> explicit confirm -> apply.
                // We just pass through the desired SQL + description.
                dbMigrations = Array.isArray(parsed.dbMigrations)
                    ? parsed.dbMigrations
                          .map((m) => ({
                              sql: safeString(m?.sql || "", 100_000),
                              message: safeString(m?.message || "", 2_000),
                              destructive: Boolean(m?.destructive),
                          }))
                          .filter((m) => Boolean(m.sql.trim()))
                    : [];

                const appliedEdits: FileEdit[] = [];
                for (const edit of fileEdits) {
                    const rawPath = safeString(edit?.path, 500);
                    const rawContent = typeof edit?.content === "string" ? edit.content : "";
                    const canonicalPath = canonicalizeEditPath(rawPath, files);
                    if (!isSafeAppFilePath(canonicalPath)) continue;

                    const normalized = normalizeJsTsConfig(canonicalPath, rawContent);
                    if (!normalized.ok) continue;

                    // Update in-memory files
                    files[canonicalPath] = { content: normalized.content, lastModified: Date.now() };
                    appliedEdits.push({ path: canonicalPath, content: normalized.content });
                }

                const appliedAnyChanges = appliedEdits.length > 0 || dbMigrations.length > 0 || setupDatabase;
                aiFollowupQuestions = appliedAnyChanges ? [] : plannedSelection.questions;
                assistantSummary = appliedAnyChanges
                    ? response
                    : sanitizeUserFacingAiMessage({
                        text: looksLikeCompletionClaim(plannedSelection.assistantMessage)
                            ? (plannedSelection.questions.length > 0 ? plannedSelection.questions.join("\n") : plannedSelection.reason)
                            : (plannedSelection.assistantMessage || plannedSelection.questions.join("\n") || plannedSelection.reason),
                        fallback: buildUserFacingNoOpMessage({ currentFile, needsMoreContext: false }),
                    });

                refreshServer = refreshServer || shouldRefreshAfterAiEdits(appliedEdits.map((edit) => edit.path));

                if (appliedEdits.length > 0) {
                    // Create a restore point capturing the *previous* content for touched files.
                    // This enables undo/keep inside the chat even across refreshes.
                    try {
                        const before: Record<string, string | null> = {};
                        const after: Record<string, string> = {};

                        for (const e of appliedEdits) {
                            const p = e.path;
                            // We need the previous content, so look it up from the last saved snapshot.
                            // appData.files was loaded into `files` initially; we kept mutating `files`.
                            // To capture "before", read from the Firestore doc again (authoritative).
                            // NOTE: This is only for the handful of touched files.
                            before[p] = null;
                            after[p] = e.content;
                        }

                        const appSnapForBefore = await appRef.get();
                        const appDataForBefore = appSnapForBefore.data() as any;
                        const savedFiles = (appDataForBefore?.files || {}) as Record<string, { content: string } | undefined>;

                        for (const p of Object.keys(before)) {
                            if (savedFiles && Object.prototype.hasOwnProperty.call(savedFiles, p)) {
                                const prev = (savedFiles as any)[p];
                                before[p] = typeof prev?.content === "string" ? prev.content : "";
                            } else {
                                before[p] = null;
                            }
                        }

                        const label = `AI edit: ${safeString(message, 80) || "change"}`;
                        const restoreDoc: RestorePointPayload = {
                            label,
                            source: "ai-agent",
                            createdAt: new Date(),
                            kept: false,
                            paths: Object.keys(before),
                            before,
                            after,
                            messageSnippet: safeString(message, 200),
                        };

                        const rpRef = appRef.collection("restore_points").doc(crypto.randomUUID());
                        await rpRef.set(restoreDoc);
                        lastRestorePointId = rpRef.id;

                        // Best-effort trim: keep the newest 25 non-kept restore points.
                        try {
                            const rpCol = appRef.collection("restore_points");
                            const extra = await rpCol
                                .where("kept", "==", false)
                                .orderBy("createdAt", "desc")
                                .offset(25)
                                .limit(50)
                                .get();
                            if (!extra.empty) {
                                const batch = db.batch();
                                extra.docs.forEach((d: any) => batch.delete(d.ref));
                                await batch.commit();
                            }
                        } catch {
                            // ignore trimming errors
                        }
                    } catch (err) {
                        console.warn("[ai-agent] failed creating restore point", err);
                    }

                    aggregatedEdits = [...aggregatedEdits, ...appliedEdits];
                    try {
                        await appRef.update({
                            files,
                            updatedAt: new Date(),
                        });
                    } catch (updateErr) {
                        console.error("[ai-agent] failed to update files in database", updateErr);
                    }
                }

                // Retry once when the model returns zero edits for an actionable request.
                if (appliedEdits.length === 0 && !plannedSelection.needsMoreContext && selectedPaths.length > 0 && attempt < effectiveMaxIterations) {
                    lastBuild = {
                        ok: false,
                        exitCode: 1,
                        logs: "Previous attempt returned zero fileEdits. Return actual fileEdits for the selected files and do not summarize the request.",
                    };
                    continue;
                }

                // Always build-check after an edit. If no edits remain after retries, stop.
                if (appliedEdits.length > 0) {
                    lastBuild = await runBuildCheck(origin, appId, files);
                    if (lastBuild.ok) break;
                    if (!autoFix) break;
                    // continue loop with build logs
                } else {
                    break;
                }
            }

            if (aggregatedEdits.length === 0 && dbMigrations.length === 0 && !setupDatabase && !plannedSelection.needsMoreContext) {
                const searchDebug = {
                    currentFile,
                    selectionMode: selectedFileContext.mode,
                    selectedPaths,
                    exactPhrasePaths: requestLooksLikeCopyOrTextEdit(message, recentConversation) ? findExactPhraseMatches(allFiles, extractSearchTerms(message, recentConversation).phrases) : [],
                    broadCopyPaths: requestLooksLikeCopyOrTextEdit(message, recentConversation) ? buildBroadCopyCandidatePaths(allFiles, message, recentConversation) : [],
                    copyRequest: requestLooksLikeCopyOrTextEdit(message, recentConversation),
                    quotedPhrases: extractSearchTerms(message, recentConversation).phrases,
                };

                void captureCriticalEvent({
                    source: "internal",
                    severity: "critical",
                    statusCode: 422,
                    route: "/api/ai-agent",
                    method: "POST",
                    action: aiSlackRequestDigest ? `ai_agent_no_changes_applied:${aiSlackRequestDigest}` : "ai_agent_no_changes_applied",
                    userId: uid,
                    message: `AI agent could not produce an edit. Search trace: ${JSON.stringify(searchDebug)}`,
                    tags: ["ai-agent", "writer-error", "no-changes-applied"],
                    extra: {
                        appId: observedAppId || null,
                        requestDigest: aiSlackRequestDigest || null,
                        prompt: aiSlackPrompt || null,
                        conversationTail: aiSlackConversationTail ? aiSlackConversationTail.slice(-4000) : null,
                        fileCount: aiSlackFileCount,
                        promptTokens: aiRequestPromptTokenEstimate || estimateTokens(aiSlackPrompt),
                        outputTokens: aiRequestUsage.outputTokens || 0,
                        totalTokens: aiRequestUsage.totalTokens || 0,
                        estimatedCostUsd: aiRequestUsage.estimatedCostUsd,
                        inputTokenCap: AI_AGENT_INPUT_TOKEN_CAP,
                        outputTokenCap: AI_AGENT_OUTPUT_TOKEN_CAP,
                        model: process.env.GEMINI_MODEL || "gemini-3-pro-preview",
                        searchDebug,
                        selectedFilesPreview: aiSlackSelectedFilesPreview,
                        fileContextPreview: aiSlackFileContextPreview,
                        finalPromptPreview: aiSlackFinalPromptPreview,
                        buildLogs: safeString(lastBuild.logs || "", 60_000),
                    },
                });

                return NextResponse.json(
                    {
                        error: currentFile
                            ? "I checked the attached page and nearby source files, but I couldn’t produce a safe edit from the request as written. Tell me the exact section, file, or text you want changed, and I’ll apply that directly."
                            : "I checked the selected page and nearby source files, but I couldn’t produce a safe edit from the request as written. Tell me the exact section, file, or text you want changed, and I’ll apply that directly.",
                        code: "AI_NO_CHANGES_APPLIED",
                        build: lastBuild,
                        searchDebug,
                        requestId,
                    },
                    { status: 422 },
                );
            }

            if (persistChat) {
                try {
                    await persistLegacyAiChat({
                        db,
                        uid,
                        appId,
                        userMessage: message,
                        assistantMessage: assistantSummary,
                        conversationId: conversationId || undefined,
                    });
                } catch (err) {
                    console.warn("[ai-agent] chat persistence failed", err);
                }
            }

            await captureAuditEvent({
                source: "internal",
                severity: "info",
                statusCode: 200,
                alwaysNotifySlack: true,
                route: "/api/ai-agent",
                method: "POST",
                action: aiSlackRequestDigest ? `ai_agent_request_completed:${aiSlackRequestDigest}` : "ai_agent_request_completed",
                userId: uid,
                message: `AI agent request completed`,
                service: "ai-agent",
                tags: ["ai-agent", "gemini", "usage"],
                extra: {
                    appId: observedAppId || null,
                    requestDigest: aiSlackRequestDigest || null,
                    promptTokens: aiRequestUsage.inputTokens,
                    outputTokens: aiRequestUsage.outputTokens,
                    totalTokens: aiRequestUsage.totalTokens,
                    estimatedCostUsd: aiRequestUsage.estimatedCostUsd,
                    creditCost: Math.max(1, Math.ceil((aiRequestUsage.inputTokens + aiRequestUsage.outputTokens) / 2000)),
                    attempts: aiRequestUsage.attempts,
                    inputTokenCap: AI_AGENT_INPUT_TOKEN_CAP,
                    outputTokenCap: AI_AGENT_OUTPUT_TOKEN_CAP,
                    selectionMode: selectedFileContext.mode,
                    selectedPaths: selectedFileContext.selectedPaths,
                    selectedFileCount: selectedFileContext.selectedPaths.length,
                    selectionSummary: selectedFileContext.summary,
                    selectedFilesPreview: aiSlackSelectedFilesPreview,
                    fileContextPreview: aiSlackFileContextPreview,
                    finalPromptPreview: aiSlackFinalPromptPreview,
                    estimatedInputTokens: aiRequestPromptTokenEstimate,
                    pricingConfigured: Boolean(GEMINI_INPUT_COST_PER_1M_TOKENS_USD || GEMINI_OUTPUT_COST_PER_1M_TOKENS_USD),
                },
            });

            return NextResponse.json({
                response: assistantSummary,
                clarifyingQuestions: aiFollowupQuestions,
                fileEdits: aggregatedEdits,
                refreshServer,
                setupDatabase,
                dbMigrations,
                build: lastBuild,
                restorePointId: lastRestorePointId,
                requestId,
                creditCost: Math.max(1, Math.ceil((aiRequestUsage.inputTokens + aiRequestUsage.outputTokens) / 2000)),
            });
        } catch (error) {
            const classified = classifyAiProviderError(error);

            void captureCriticalEvent({
                source: "internal",
                severity: classified.statusCode >= 500 ? "critical" : "error",
                statusCode: classified.statusCode,
                alwaysNotifySlack: true,
                route: "/api/ai-agent",
                method: "POST",
                action: aiSlackRequestDigest ? `ai_agent_generate_failed:${aiSlackRequestDigest}` : "ai_agent_generate_failed",
                userId: uid,
                message: classified.slackMessage,
                tags: ["ai-agent", "gemini", "provider-error"],
                extra: {
                    appId: observedAppId || null,
                    requestDigest: aiSlackRequestDigest || null,
                    clientResponse: classified.userMessage,
                    prompt: aiSlackPrompt || null,
                    conversationTail: aiSlackConversationTail ? aiSlackConversationTail.slice(-4000) : null,
                    fileCount: aiSlackFileCount,
                    promptTokens: aiRequestPromptTokenEstimate || estimateTokens(aiSlackPrompt),
                    outputTokens: aiRequestUsage.outputTokens || 0,
                    totalTokens: aiRequestUsage.totalTokens || 0,
                    estimatedCostUsd: aiRequestUsage.estimatedCostUsd,
                    inputTokenCap: AI_AGENT_INPUT_TOKEN_CAP,
                    outputTokenCap: AI_AGENT_OUTPUT_TOKEN_CAP,
                    model: process.env.GEMINI_MODEL || "gemini-3-pro-preview",
                    providerMessage: classified.providerMessage,
                    code: classified.code,
                    providerErrorName: classified.providerErrorName,
                    providerDiagnostics: classified.providerDiagnostics,
                },
            });

            console.error("AI agent error:", error);
            return NextResponse.json(
                { error: classified.userMessage, code: classified.code },
                { status: classified.statusCode },
            );
        }
        },
        { csrf: true, methods: ["POST"] }
    );
}