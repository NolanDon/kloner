import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import OpenAI from "openai";
import {
    canConsumeCredit,
    monthlyLimitFor,
    type UserTier,
} from "@/src/lib/credits";

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

        let aiEditsRef: any | null = null;
        let tier: UserTier = "free";
        let creditsLimit: number | null = null;
        let creditsUsedBefore = 0;

        if (db) {
            try {
                const userRef = db.collection("kloner_users").doc(uid);

                // derive tier from user doc
                try {
                    const userSnap = await userRef.get();
                    if (userSnap.exists) {
                        const raw = (userSnap.data()?.userTier as string | undefined)?.toLowerCase();
                        if (
                            raw === "pro" ||
                            raw === "agency" ||
                            raw === "enterprise" ||
                            raw === "free"
                        ) {
                            tier = raw as UserTier;
                        } else {
                            tier = "free";
                        }
                    }
                } catch (e) {
                    console.error("[ai-edit] failed to read userTier; defaulting to free", e);
                    tier = "free";
                }

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

                // ── CREDIT CHECK: each AI edit consumes 5 "edit" credits ──
                try {
                    const startOfMonth = new Date(
                        now.getFullYear(),
                        now.getMonth(),
                        1
                    );

                    const monthSnap = await aiEditsRef
                        .where("createdAt", ">=", startOfMonth)
                        .get();

                    const editCountThisMonth = monthSnap.size ?? 0;
                    creditsUsedBefore = editCountThisMonth * 5; // 5 credits per edit

                    const allowed = canConsumeCredit(
                        tier,
                        "edit",
                        creditsUsedBefore
                    );

                    const limit = monthlyLimitFor(tier, "edit");
                    creditsLimit = limit || 0;

                    if (!allowed) {
                        return NextResponse.json(
                            {
                                error:
                                    "You’ve used all AI edit credits for this month. Upgrade your plan or wait until next month for more.",
                                meta: {
                                    tier,
                                    creditsRemaining: 0,
                                    creditsLimit,
                                },
                            },
                            { status: 402 }
                        );
                    }
                } catch (err) {
                    console.error("[ai-edit] credit check failed, allowing request", err);
                    // fail-open: allow the request if credit check itself blows up
                }
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
                    meta: {
                        tier,
                        creditsRemaining: null,
                        creditsLimit: null,
                    },
                },
                { status: 200 }
            );
        }

        // At this point the request has passed the credit check and the AI call succeeded.
        // Writing this doc is what we treat as “consuming” 5 edit credits.
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

        // recompute credits after this successful edit
        let creditsRemaining: number | null = null;
        try {
            const limit = monthlyLimitFor(tier, "edit");
            creditsLimit = limit || 0;

            if (limit) {
                const usedAfter = creditsUsedBefore + 5; // we just spent 5 credits
                creditsRemaining = Math.max(limit - usedAfter, 0);
            } else {
                creditsRemaining = null; // unlimited
            }
        } catch (err) {
            console.error("[ai-edit] failed computing remaining credits", err);
        }

        return NextResponse.json(
            {
                suggestions,
                meta: {
                    tier,
                    creditsRemaining,
                    creditsLimit,
                },
            },
            { status: 200 }
        );
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
            return NextResponse.json(
                {
                    suggestions: [],
                    meta: {
                        tier: "free",
                        creditsRemaining: null,
                        creditsLimit: null,
                    },
                },
                { status: 200 }
            );
        }

        try {
            const userRef = db.collection("kloner_users").doc(uid);

            let tier: UserTier = "free";
            try {
                const userSnap = await userRef.get();
                if (userSnap.exists) {
                    const raw = (userSnap.data()?.userTier as string | undefined)?.toLowerCase();
                    if (
                        raw === "pro" ||
                        raw === "agency" ||
                        raw === "enterprise" ||
                        raw === "free"
                    ) {
                        tier = raw as UserTier;
                    } else {
                        tier = "free";
                    }
                }
            } catch (e) {
                console.error("[ai-edit][GET] failed to read userTier; defaulting to free", e);
                tier = "free";
            }

            const renderRef = userRef.collection("kloner_renders").doc(renderId);
            const renderSnap = await renderRef.get();

            if (!renderSnap.exists) {
                return NextResponse.json(
                    {
                        suggestions: [],
                        meta: {
                            tier,
                            creditsRemaining: null,
                            creditsLimit: monthlyLimitFor(tier, "edit") || 0,
                        },
                    },
                    { status: 200 }
                );
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

            // compute remaining edit credits
            let creditsRemaining: number | null = null;
            let creditsLimit = 0;
            try {
                const now = new Date();
                const startOfMonth = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    1
                );

                const monthSnap = await aiEditsRef
                    .where("createdAt", ">=", startOfMonth)
                    .get();

                const editCountThisMonth = monthSnap.size ?? 0;
                const usedCredits = editCountThisMonth * 5; // 5 per edit

                const limit = monthlyLimitFor(tier, "edit");
                creditsLimit = limit || 0;

                if (limit) {
                    creditsRemaining = Math.max(limit - usedCredits, 0);
                } else {
                    creditsRemaining = null; // unlimited
                }
            } catch (err) {
                console.error("[ai-edit][GET] failed computing remaining credits", err);
            }

            return NextResponse.json(
                {
                    suggestions,
                    meta: {
                        tier,
                        creditsRemaining,
                        creditsLimit,
                    },
                },
                { status: 200 }
            );
        } catch (err) {
            console.error("[ai-edit] Firestore GET failed", err);
            return NextResponse.json(
                {
                    suggestions: [],
                    meta: {
                        tier: "free",
                        creditsRemaining: null,
                        creditsLimit: null,
                    },
                },
                { status: 200 }
            );
        }
    });
}

export async function POST(req: NextRequest) {
    return handlePost(req);
}

export async function GET(req: NextRequest) {
    return handleGet(req);
}
