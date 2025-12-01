// app/api/ai-edit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
});

interface AiEditRequestBody {
    renderId: string;
    html: string;
    prompt: string;
}

interface AiEditModelResult {
    afterHtml: string;
    summary: string;
}

// keep payload small to reduce latency
const MAX_HTML_CHARS = 8_000;

function trimHtmlForModel(html: string): string {
    if (html.length <= MAX_HTML_CHARS) return html;

    const lower = html.toLowerCase();
    const headEnd = lower.indexOf("</head>");

    if (headEnd === -1) {
        return html.slice(0, MAX_HTML_CHARS);
    }

    const head = html.slice(0, headEnd + "</head>".length);
    const rest = html.slice(headEnd + "</head>".length);

    const remainingBudget = MAX_HTML_CHARS - head.length;
    if (remainingBudget <= 0) {
        return head.slice(0, MAX_HTML_CHARS);
    }

    return head + rest.slice(0, remainingBudget);
}

// Robust extractor for the Responses API shape
function extractTextFromResponse(resp: any): string {
    if (!resp || !resp.output) return "";

    const outputs = Array.isArray(resp.output) ? resp.output : [resp.output];
    const chunks: string[] = [];

    for (const out of outputs) {
        const content = Array.isArray(out?.content) ? out.content : [];
        for (const c of content) {
            const txt = c?.text?.value ?? c?.text ?? "";
            if (typeof txt === "string" && txt.trim().length > 0) {
                chunks.push(txt);
            }
        }
    }

    return chunks.join("\n").trim();
}

async function runAiEditModel(input: {
    html: string;
    prompt: string;
}): Promise<AiEditModelResult> {
    const trimmedHtml = trimHtmlForModel(input.html);
    const { prompt } = input;

    const system = `
You are an HTML refactoring assistant for a website "kloner" editor.

Rules:
- You receive HTML for a render (possibly truncated).
- Apply ONLY MINIMAL, TARGETED changes based on the user instruction.
- You MUST preserve:
  - Overall layout and structure
  - All data attributes (data-*)
  - All IDs and class names
  - Scripts, styles, and link tags
  - All kloner-specific guard rails (elements with id="kloner-guard-rails" etc.)

Absolutely forbidden:
- Deleting or emptying any major sections.
- Removing or renaming guard rail markers like id="kloner-guard-rails" or data-kloner-root.
- Returning a much shorter document than the input.
- Replacing the document with a bare skeleton. The full original structure must remain, only small in-place edits.

OUTPUT FORMAT (STRICT):
You must return plain text in exactly this format, with no extra commentary:

SUMMARY: <one short sentence describing what changed>
HTML:
<!doctype html>...

- Do not return JSON.
- Do not wrap anything in backticks.
- The HTML must be a complete document starting with <!doctype html>.
`.trim();

    const user = `
USER INSTRUCTION:
${prompt}

CURRENT HTML (may be truncated for performance):
${trimmedHtml}
`.trim();

    try {
        const resp = await client.responses.create({
            model: "gpt-5-mini",
            input: [
                {
                    role: "system",
                    content: [{ type: "input_text", text: system }],
                },
                {
                    role: "user",
                    content: [{ type: "input_text", text: user }],
                },
            ],
            max_output_tokens: 1536,
        });

        const raw = extractTextFromResponse(resp);

        if (!raw) {
            console.error(
                "[ai-edit] empty text from model, raw resp snippet:",
                JSON.stringify(resp, null, 2).slice(0, 2000)
            );
            throw new Error("model_failed");
        }

        const summaryMatch = raw.match(/^SUMMARY:\s*(.+)$/m);
        const summary =
            summaryMatch && summaryMatch[1].trim()
                ? summaryMatch[1].trim()
                : "Minimal changes applied.";

        const lower = raw.toLowerCase();
        let htmlStart = lower.indexOf("<!doctype html");
        if (htmlStart === -1) {
            htmlStart = lower.indexOf("<html");
        }
        if (htmlStart === -1) {
            const marker = "html:";
            const idx = lower.indexOf(marker);
            if (idx !== -1) {
                htmlStart = idx + marker.length;
            }
        }

        const afterHtml =
            htmlStart !== -1 ? raw.slice(htmlStart).trim() : raw.trim();

        if (!afterHtml.toLowerCase().includes("<html")) {
            console.error(
                "[ai-edit] no <html> tag in model output; first 300 chars:",
                raw.slice(0, 300)
            );
            throw new Error("model_failed");
        }

        return {
            afterHtml,
            summary,
        };
    } catch (err: any) {
        console.error("[ai-edit] OpenAI call failed", {
            name: err?.name,
            ctor: err?.constructor?.name,
            message: err?.message,
        });
        throw new Error("model_failed");
    }
}

async function handlePost(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req }) => {
        let db: any = null;

        try {
            db = await getAdminDb();
        } catch (err) {
            console.error("[ai-edit] failed to init Firestore", err);
        }

        const body = (await req.json()) as Partial<AiEditRequestBody>;

        const renderId = body.renderId?.trim();
        const html = body.html ?? "";
        const prompt = body.prompt?.trim() ?? "";

        if (!renderId || !html || !prompt) {
            return NextResponse.json(
                { error: "renderId, html, and prompt are required" },
                { status: 400 }
            );
        }

        const now = new Date();

        // bootstrap render doc under kloner_users/{uid}/kloner_renders/{renderId}
        let aiEditsRef: any | null = null;

        if (db) {
            try {
                const userRef = db.collection("kloner_users").doc(uid);
                const renderRef = userRef.collection("kloner_renders").doc(renderId);
                const renderSnap = await renderRef.get();

                if (!renderSnap.exists) {
                    await renderRef.set(
                        {
                            uid,
                            renderId,
                            createdAt: now,
                            source: "ai-edit-shell",
                        },
                        { merge: true }
                    );
                }

                aiEditsRef = renderRef.collection("ai_edits");
            } catch (err) {
                console.error(
                    "[ai-edit] Firestore read/write failed, skipping history bootstrap",
                    err
                );
                db = null;
            }
        }

        let modelResult: AiEditModelResult;
        try {
            modelResult = await runAiEditModel({ html, prompt });
        } catch (err: any) {
            console.error("[ai-edit] model error", err);
            return NextResponse.json({ error: "model_failed" }, { status: 502 });
        }

        const { afterHtml, summary } = modelResult;

        // If Firestore unavailable, just return a single suggestion without persistence
        if (!db || !aiEditsRef) {
            return NextResponse.json(
                {
                    suggestions: [
                        {
                            id: "local",
                            renderId,
                            prompt,
                            summary,
                            beforeHtml: html,
                            afterHtml,
                            createdAt: now.toISOString(),
                            uid,
                        },
                    ],
                },
                { status: 200 }
            );
        }

        const docRef = aiEditsRef.doc();

        await docRef.set({
            renderId,
            prompt,
            summary,
            beforeHtml: html,
            afterHtml,
            createdAt: now,
            uid,
        });

        // Trim history to last 5 docs using a batch
        try {
            const extraSnap = await aiEditsRef
                .orderBy("createdAt", "desc")
                .offset(5)
                .get();

            if (!extraSnap.empty) {
                const batch = db.batch();
                extraSnap.docs.forEach((d: any) => batch.delete(d.ref));
                await batch.commit();
            }
        } catch (err) {
            console.error("[ai-edit] failed trimming history", err);
        }

        const latestSnap = await aiEditsRef
            .orderBy("createdAt", "desc")
            .limit(5)
            .get();

        const suggestions = latestSnap.docs.map((d: any) => ({
            id: d.id,
            ...(d.data() as any),
        }));

        return NextResponse.json({ suggestions }, { status: 200 });
    });
}

async function handleGet(req: NextRequest) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req }) => {
        let db: any = null;

        try {
            db = await getAdminDb();
        } catch (err) {
            console.error("[ai-edit] failed to init Firestore on GET", err);
        }

        const { searchParams } = new URL(req.url);
        const renderId = searchParams.get("renderId")?.trim();

        if (!renderId) {
            return NextResponse.json(
                { error: "renderId is required" },
                { status: 400 }
            );
        }

        if (!db) {
            return NextResponse.json({ suggestions: [] }, { status: 200 });
        }

        try {
            const userRef = db.collection("kloner_users").doc(uid);
            const renderRef = userRef.collection("kloner_renders").doc(renderId);
            const renderSnap = await renderRef.get();

            if (!renderSnap.exists) {
                return NextResponse.json({ suggestions: [] }, { status: 200 });
            }

            const aiEditsRef = renderRef.collection("ai_edits");
            const snap = await aiEditsRef
                .orderBy("createdAt", "desc")
                .limit(5)
                .get();

            const suggestions = snap.docs.map((d: any) => ({
                id: d.id,
                ...(d.data() as any),
            }));

            return NextResponse.json({ suggestions }, { status: 200 });
        } catch (err) {
            console.error("[ai-edit] Firestore GET failed", err);
            return NextResponse.json({ suggestions: [] }, { status: 200 });
        }
    });
}

export async function POST(req: NextRequest) {
    return handlePost(req);
}

export async function GET(req: NextRequest) {
    return handleGet(req);
}
