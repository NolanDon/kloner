// app/api/ai-agent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import { assertAppBuilderScope } from "../_lib/appBuilderScope";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

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

function requestLikelyNeedsDatabase(userMessage: string): boolean {
    const m = String(userMessage || "").toLowerCase();
    if (!m.trim()) return false;

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

async function getSupabaseIntegrationStatus(params: { db: any; uid: string }): Promise<{ connected: boolean; projectRef: string | null }> {
    const { db, uid } = params;
    try {
        const ref = db.collection("kloner_users").doc(uid).collection("integrations").doc("supabase");
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

function buildFileContext(files: Record<string, { content: string; lastModified: number }>): string {
    // Soft limit to avoid runaway prompts
    const MAX_TOTAL = 140_000;
    let total = 0;
    const parts: string[] = [];

    for (const [path, file] of Object.entries(files)) {
        const content = typeof file?.content === "string" ? file.content : "";
        const header = `File: ${path}\n`;
        const remaining = MAX_TOTAL - total;
        if (remaining <= header.length) break;

        const chunkBudget = Math.max(0, remaining - header.length);
        const chunk = content.slice(0, chunkBudget);
        parts.push(header + chunk);
        total += header.length + chunk.length;
        if (total >= MAX_TOTAL) break;
    }

    return parts.join("\n\n");
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
        try {
            const body = await req.json();
            const message = safeString(body?.message, 10_000);
            const appId = safeString(body?.appId, 200);
            const persistChat = body?.persistChat === true;
            const conversationId = safeString(body?.conversationId, 80);
            const conversationHistory = Array.isArray(body?.conversationHistory)
                ? (body.conversationHistory as any[])
                : [];
            const databaseConnections = Array.isArray(body?.databaseConnections)
                ? (body.databaseConnections as any[])
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
            const supabase = await getSupabaseIntegrationStatus({ db, uid });
            const hasAnyDb = supabase.connected || databaseConnections.length > 0;

            // Security-first guard: if a request likely needs persistence/auth and no DB is connected,
            // do not implement fake/local auth. Instead, push the user to connect Supabase.
            if (requestLikelyNeedsDatabase(message) && !hasAnyDb) {
                const response =
                    "This feature needs secure, persistent storage (database) to be safe. Right now no database is connected, so I won’t create local/in-memory users or store passwords on the client.\n\nDo you want to connect Supabase now and have me set up authentication + the required schema (e.g. a profiles table + RLS) for you?";

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

            const appData = snap.data() as any;
            const files: Record<string, { content: string; lastModified: number }> = appData?.files || {};

            const origin = new URL(req.url).origin;
            const recentConversation = conversationHistory
                .slice(-10)
                .map((m: any): ChatMessage => ({
                    role: m?.role === "assistant" ? "assistant" : "user",
                    content: safeString(m?.content, 4000),
                }))
                .map((m) => `${m.role}: ${m.content}`)
                .join("\n");

            const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-1.5-pro" });

            let lastBuild = { ok: true, exitCode: 0, logs: "" };
            let aggregatedEdits: FileEdit[] = [];
            let assistantSummary = "";
            let refreshServer = false;
            let setupDatabase = false;
            let lastRestorePointId: string | null = null;
            let dbMigrations: Array<{ sql: string; message?: string; destructive?: boolean }> = [];

            for (let attempt = 1; attempt <= maxIterations; attempt++) {
                const fileContext = buildFileContext(files);
                const buildContext = !lastBuild.ok
                    ? `\n\nLast build failed. Here are the build logs (most recent):\n${lastBuild.logs}`
                    : "";

                const dbContext = hasAnyDb
                    ? `\n\nDatabase status:\n- Supabase integration: ${supabase.connected ? `connected${supabase.projectRef ? ` (${supabase.projectRef})` : ""}` : "not connected"}\n${databaseConnections.length > 0
                        ? `\nConnected databases with MCP integration:\n${databaseConnections
                            .map((db) => `- ${db.name} (${db.type}): Full MCP access to database operations, schema exploration, query generation, and real-time development tools`)
                            .join("\n")}`
                        : ""}`
                    : "\n\nNo databases connected yet.";

                                const systemPrompt = `You are an expert Next.js developer working inside an app builder. Be conversational and helpful!

SECURITY + PERSISTENCE (TOP PRIORITY):
- NEVER implement "fake" auth or user storage using localStorage/sessionStorage/in-memory arrays/JSON files.
- NEVER store passwords client-side, never store plaintext passwords anywhere.
- If the user requests authentication, user accounts, or any persistent data feature and a database is not connected, DO NOT implement workarounds. Instead:
    - ask the user to connect Supabase,
    - set setupDatabase: true,
    - return zero fileEdits.
- If Supabase is connected, use Supabase Auth for authentication and propose any needed schema via dbMigrations (e.g. profiles table + RLS).

SUPABASE ENV SAFETY (DO NOT BREAK INITIAL RENDER):
- NEVER write '.env', '.env.local', or any '.env.*' file.
- NEVER call createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) at module scope.
- When you need a Supabase browser client, scaffold a helper (e.g. lib/supabaseClient.ts) that lazily creates the client ONLY after checking env vars at runtime.
- If env vars are missing, return null and show a friendly UI message instead of throwing or failing the TypeScript build.
- Only use NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY for browser code.

CRITICAL OUTPUT FORMAT:
Return ONLY valid JSON (no markdown, no backticks) matching this TypeScript shape:
{
  "response": string,
  "refreshServer": boolean,
  "fileEdits": Array<{ "path": string, "content": string }>,
    "setupDatabase": boolean,
    "dbMigrations"?: Array<{ "sql": string, "message"?: string, "destructive"?: boolean }>
}

Rules:
- response should be a simple, user-friendly summary of what you did (e.g., "Added a login button to the header" or "Fixed the styling on the contact form"). NEVER include code, file paths, or technical details in the response field.
- If you need to change the database schema, NEVER include SQL in response. Instead, put SQL statements into dbMigrations and describe the intent in response.
- Only include file edits for the user's app files.
- Each fileEdits entry MUST include the full, final content of the file.
- Keep changes minimal and ensure npm run build passes.
- If you need no file changes, return an empty fileEdits array.
- Be conversational! If the user might benefit from database connectivity, strongly recommend Supabase with MCP integration for AI-powered database operations.
- If no databases are connected and the user is building something that needs data persistence (like auth, user management, blog comments, e-commerce, etc.), you MUST suggest connecting Supabase specifically and set setupDatabase: true.
- With MCP integration, you have access to: database schema exploration, query generation, migration assistance, authentication setup, RLS policy creation, edge function development, and real-time feature implementation.
- Set setupDatabase: true if you want to offer Supabase MCP connection setup to the user.

Current app files:
${fileContext}${dbContext}

Recent conversation:
${recentConversation}

User request:
${message}
${buildContext}`;

                const result = await model.generateContent(systemPrompt);
                const raw = result.response.text().trim();

                let parsed: {
                    response?: string;
                    refreshServer?: boolean;
                    fileEdits?: FileEdit[];
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
                            parsed = { response: "I've made the requested changes to your app.", refreshServer: false, fileEdits: [] };
                        }
                    } else {
                        // No JSON found, use fallback
                        parsed = { response: "I've made the requested changes to your app.", refreshServer: false, fileEdits: [] };
                    }
                }

                // Post-parse guard: never allow insecure local user storage/auth to land in app files.
                const fileEdits = Array.isArray(parsed.fileEdits) ? (parsed.fileEdits as FileEdit[]) : [];
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
                
                // Ensure response doesn't contain code
                if (response.includes('content":') || response.includes('path":') || response.length > 500) {
                    response = "I've updated your app with the requested changes.";
                }
                
                assistantSummary = response;
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

                // Automatically refresh server if there are file edits
                if (appliedEdits.length > 0) {
                    refreshServer = true;
                }

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

                // Always build-check after an edit. If no edits, don't waste cycles.
                if (appliedEdits.length > 0) {
                    lastBuild = await runBuildCheck(origin, appId, files);
                    if (lastBuild.ok) break;
                    if (!autoFix) break;
                    // continue loop with build logs
                } else {
                    break;
                }
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

            return NextResponse.json({
                response: assistantSummary,
                fileEdits: aggregatedEdits,
                refreshServer,
                setupDatabase,
                dbMigrations,
                build: lastBuild,
                restorePointId: lastRestorePointId,
            });
        } catch (error) {
            console.error("AI agent error:", error);
            return NextResponse.json({ error: "Failed to process AI request" }, { status: 500 });
        }
        },
        { csrf: true, methods: ["POST"] }
    );
}