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
            const conversationHistory = Array.isArray(body?.conversationHistory)
                ? (body.conversationHistory as any[])
                : [];
            const autoFix = body?.autoFix !== false;
            const maxIterations = typeof body?.maxIterations === "number" ? Math.min(3, Math.max(1, body.maxIterations)) : 2;

            if (!message || !appId) {
                return NextResponse.json({ error: "Missing message or appId" }, { status: 400 });
            }

            // Prevent request editing attacks: only allow the currently bound appId.
            assertAppBuilderScope(authedReq, uid, appId);

            const db = getAdminDb();
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
            let lastRestorePointId: string | null = null;

            for (let attempt = 1; attempt <= maxIterations; attempt++) {
                const fileContext = buildFileContext(files);
                const buildContext = !lastBuild.ok
                    ? `\n\nLast build failed. Here are the build logs (most recent):\n${lastBuild.logs}`
                    : "";

                const systemPrompt = `You are an expert Next.js developer working inside an app builder.

CRITICAL OUTPUT FORMAT:
Return ONLY valid JSON (no markdown, no backticks) matching this TypeScript shape:
{
  "response": string,
  "refreshServer": boolean,
  "fileEdits": Array<{ "path": string, "content": string }>
}

Rules:
- Only include file edits for the user's app files.
- Each fileEdits entry MUST include the full, final content of the file.
- Keep changes minimal and ensure npm run build passes.
- If you need no file changes, return an empty fileEdits array.

Current app files:
${fileContext}

Recent conversation:
${recentConversation}

User request:
${message}
${buildContext}`;

                const result = await model.generateContent(systemPrompt);
                const raw = result.response.text().trim();

                let parsed: { response?: string; refreshServer?: boolean; fileEdits?: FileEdit[] } = {
                    response: "",
                    refreshServer: false,
                    fileEdits: [],
                };
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    // If the model fails JSON, fall back to no edits but surface raw.
                    parsed = { response: raw, refreshServer: false, fileEdits: [] };
                }

                const fileEdits = Array.isArray(parsed.fileEdits) ? parsed.fileEdits : [];
                assistantSummary = safeString(parsed.response || raw, 20_000);
                refreshServer = Boolean(parsed.refreshServer);

                const appliedEdits: FileEdit[] = [];
                for (const edit of fileEdits) {
                    const path = safeString(edit?.path, 500);
                    const content = typeof edit?.content === "string" ? edit.content : "";
                    if (!isSafeAppFilePath(path)) continue;
                    // Update in-memory files
                    files[path] = { content, lastModified: Date.now() };
                    appliedEdits.push({ path, content });
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
                    await appRef.update({
                        files,
                        updatedAt: new Date(),
                    });
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

            return NextResponse.json({
                response: assistantSummary,
                fileEdits: aggregatedEdits,
                refreshServer,
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