// app/api/ai-edit/route.ts
//
// AI edit endpoint for Kloner.
//
// Responsibilities:
// - Auth + CSRF guard (requireSessionAndMaybeCsrf)
// - Safety: moderate user prompt and any AI image prompts BEFORE calling OpenAI
// - Call Gemini 3 Pro (code mode) or OpenAI gpt-5-mini (imagery mode) to do a small, HTML-scoped edit
// - Optionally materialize AI images into Firebase Storage via gpt-image-1
// - Track usage via Firestore and AI-edit credit buckets
//
// Safety goals:
// - Never let obviously illegal / disallowed prompts reach the main model
// - Force the model to refuse when users push outside allowed content
// - Keep the feature scoped to "HTML block editing" only

import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../_lib/route-guard";
import OpenAI from "openai";
import {
    canConsumeCredit,
    monthlyLimitFor,
    type UserTier,
} from "@/src/lib/credits";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";

// Gemini import
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
});

// Gemini client setup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const geminiClient = GEMINI_API_KEY
    ? new GoogleGenerativeAI(GEMINI_API_KEY)
    : null;

interface AiEditRequestBody {
    renderId: string;
    html: string;

    // legacy: some clients send the effective instruction here
    prompt?: string;

    // legacy: some clients send a "generated" prompt here (used previously for storage/display)
    originalPrompt?: string;

    mode?: "code" | "imagery";

    // NEW
    action?: "edit_block" | "create_page";
    pageId?: string; // e.g. "/pricing"
    slug?: string; // e.g. "pricing" or "docs/faq"
    userPrompt?: string; // raw user text only
}

interface AiEditModelResult {
    afterHtml: string;
    summary: string;
}

// Hard caps to keep payloads predictable
const MAX_HTML_CHARS = 8_000;

// This is the cap for what the USER typed and what we store in "prompt"
const MAX_USER_PROMPT_CHARS = 1_000;

// Model prompt can be a bit larger because it includes guard rails
const MAX_MODEL_PROMPT_CHARS = 2_200;

const STORAGE_BUCKET =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    undefined;

// helpers

function inferPageIntentFromSlug(slug: string): {
    kind:
    | "about"
    | "contact"
    | "pricing"
    | "services"
    | "faq"
    | "blog"
    | "features"
    | "landing"
    | "generic";
    title: string;
    hints: string[];
} {
    const s = String(slug || "").toLowerCase().trim();
    const parts = s.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "new page";
    const title = last
        .split("-")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

    const pick = (kind: any, hints: string[]) => ({ kind, title, hints });

    if (/(^|\/)(about|about-us|team|company|story|mission)(\/|$)/.test(s)) {
        return pick("about", [
            "mission + values",
            "team or founder section",
            "social proof / testimonials",
            "cta section",
        ]);
    }
    if (/(^|\/)(contact|support|help)(\/|$)/.test(s)) {
        return pick("contact", [
            "contact methods",
            "form area (fields only, no <form> submission logic)",
            "faq snippets",
            "cta section",
        ]);
    }
    if (/(^|\/)(pricing|plans|fees)(\/|$)/.test(s)) {
        return pick("pricing", [
            "tier cards (3 tiers)",
            "feature comparison bullets (not a table)",
            "faq section",
            "cta section",
        ]);
    }
    if (/(^|\/)(services|service)(\/|$)/.test(s)) {
        return pick("services", [
            "service list with short blurbs",
            "process steps",
            "case study highlight",
            "cta section",
        ]);
    }
    if (/(^|\/)(faq|faqs)(\/|$)/.test(s)) {
        return pick("faq", ["accordion-like blocks", "cta section"]);
    }
    if (/(^|\/)(blog|articles|posts)(\/|$)/.test(s)) {
        return pick("blog", ["blog grid placeholder", "categories strip", "cta section"]);
    }
    if (/(^|\/)(features|product|platform)(\/|$)/.test(s)) {
        return pick("features", [
            "hero + value prop",
            "feature sections (3+)",
            "cta section",
        ]);
    }
    if (/(^|\/)(home|landing|start)(\/|$)/.test(s)) {
        return pick("landing", ["hero", "benefits", "social proof", "cta"]);
    }
    return pick("generic", [
        "hero section",
        "2–4 content sections based on inferred topic",
        "cta section",
    ]);
}

function isVagueUserPrompt(p: string): boolean {
    const t = String(p || "").trim();
    if (!t) return true;
    if (t.length < 18) return true;
    const low = t.toLowerCase();
    const vagueSignals = [
        "make a page",
        "new page",
        "basic page",
        "nice page",
        "simple page",
        "make it look good",
        "something about",
    ];
    return vagueSignals.some((s) => low.includes(s));
}

function buildCreatePagePrompt(args: {
    pageId: string; // "/pricing"
    slug: string;   // "pricing" or "docs/faq"
    userPrompt: string;
}): { modelPrompt: string; userPromptForStorage: string } {
    const { pageId, slug, userPrompt } = args;

    const inferred = inferPageIntentFromSlug(slug);
    const title = inferred.title || "New page";
    const vague = isVagueUserPrompt(userPrompt);

    const intentLine = vague
        ? `No detailed brief was provided. Infer a complete multi-section layout from the page topic ("${title}") and standard expectations for a "${inferred.kind}" page.`
        : `User brief: ${userPrompt}`;

    /**
     * 🔒 AUTHORITATIVE THEME SNAPSHOT
     * This removes all guessing. The model must obey this.
     */
    const themeSnapshot = `
SITE THEME SNAPSHOT (AUTHORITATIVE — DO NOT GUESS):
- Background: full-bleed space / nebula imagery with purple + blue tones
- Overall background is DARK and image-based
- Primary text color: white (#ffffff)
- Secondary text: rgba(255,255,255,0.7)
- Headings: uppercase, wide letter-spacing, minimal, academic tone
- Accent elements: thin white lines, low opacity dividers
- Cards: translucent or outlined, NEVER solid dark panels
- Do NOT invent dark gradient panels
- Do NOT introduce a new design system
- Match the homepage visual language exactly
`;

    /**
     * 🔒 HARD CONTRAST RULE
     * Prevents black-on-black forever.
     */
    const contrastRule = `
CONTRAST RULE (NON-NEGOTIABLE):
- All readable text MUST have strong contrast against its background
- If background is dark or image-based, text MUST be white or near-white
- Black or dark gray text on dark backgrounds is FORBIDDEN
- If contrast is uncertain, add subtle overlays or outlines
`;

    const sectionsLine =
        `Minimum output: at least 4 distinct sections (hero + 2+ content sections + CTA). ` +
        `Avoid single-panel or hero-only layouts.`;

    const routingConsistencyLine =
        `ROUTING RULES (STRICT): ` +
        `You are editing ONLY this page container: <main class="page-root" data-route="${pageId}">. ` +
        `Do not change data-route.`;

    const structureLine =
        `Create the layout INSIDE the provided <main class="page-root" data-route="${pageId}"> block only. ` +
        `Return ONLY the updated HTML for this block.`;

    const globalLayoutLine =
        `Do NOT add or modify global header or footer elements.`;

    const privacyLine =
        `Do not print the route path anywhere in visible content.`;

    const cssRules =
        `If you include <style>, scope selectors under main.page-root[data-route="${pageId}"] only. ` +
        `Never target body, html, :root, header, or footer.`;

    const sectionHints =
        inferred.hints?.length
            ? `Suggested sections: ${inferred.hints.join(", ")}.`
            : "";

    const modelPrompt = [
        `Create a brand new page layout inside the provided <main class="page-root" data-route="${pageId}"> block.`,
        themeSnapshot,
        contrastRule,
        routingConsistencyLine,
        intentLine,
        sectionHints,
        sectionsLine,
        globalLayoutLine,
        privacyLine,
        cssRules,
        structureLine,
    ]
        .filter(Boolean)
        .join(" ");

    return {
        modelPrompt: modelPrompt.slice(0, MAX_MODEL_PROMPT_CHARS),
        userPromptForStorage: userPrompt || "",
    };
}


/**
 * Trim HTML to a bounded size while trying to keep <head> intact.
 * This keeps model latency and cost under control.
 */
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

// Robust extractor for the Responses API shape (OpenAI)
function extractTextFromResponse(resp: any): string {
    if (!resp || !resp.output) return "";

    const outputs = Array.isArray(resp.output) ? resp.output : [resp.output];
    const chunks: string[] = [];

    for (const out of outputs) {
        const content = Array.isArray(out?.content) ? out.content : [];
        for (const c of content) {
            const txt = (c as any)?.text?.value ?? (c as any)?.text ?? "";
            if (typeof txt === "string" && txt.trim().length > 0) {
                chunks.push(txt);
            }
        }
    }

    return chunks.join("\n").trim();
}

/**
 * Moderate user prompts (and image slot prompts) using omni-moderation-latest.
 *
 * Behavior:
 * - If moderation returns flagged: throw an error with code "PROMPT_UNSAFE"
 * - If moderation fails (network, config, etc): throw; caller should fail CLOSED
 */
async function assertPromptSafe(prompt: string) {
    try {
        const moderation = await client.moderations.create({
            model: "omni-moderation-latest",
            input: prompt,
        });

        const result: any = (moderation as any).results?.[0];
        if (!result) {
            console.error("[ai-edit] moderation: no results, failing closed");
            const err = new Error("moderation_failed");
            (err as any).code = "MODERATION_ERROR";
            throw err;
        }

        if (result.flagged) {
            console.warn("[ai-edit] moderation: prompt flagged", {
                categories: result.categories,
                category_scores: result.category_scores,
            });
            const err = new Error("prompt_unsafe");
            (err as any).code = "PROMPT_UNSAFE";
            throw err;
        }
    } catch (err: any) {
        console.error("[ai-edit] moderation error", {
            name: err?.name,
            message: err?.message,
            code: err?.code,
        });
        throw err;
    }
}

/**
 * Parse KLONER_IMAGE_SLOT comments.
 * Example: <!-- KLONER_IMAGE_SLOT_0: a wide elephant background -->
 */
function extractImageSlots(html: string): { index: number; prompt: string }[] {
    const slots: { index: number; prompt: string }[] = [];
    const regex = /<!--\s*KLONER_IMAGE_SLOT_(\d+)\s*:(.*?)-->/gis;

    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
        const idx = parseInt(m[1], 10);
        if (Number.isNaN(idx)) continue;
        const prompt = (m[2] || "").trim();
        if (!prompt) continue;
        slots.push({ index: idx, prompt });
    }

    return slots;
}

/**
 * Simple JPEG compression via sharp.
 * This keeps AI-generated images smaller without destroying quality.
 */
async function compressImageBuffer(buf: Buffer): Promise<any> {
    try {
        const output = await sharp(buf)
            .jpeg({ quality: 78, chromaSubsampling: "4:2:0" })
            .toBuffer();
        return output;
    } catch (err) {
        console.error("[ai-edit] compressImageBuffer failed, returning original", err);
        return buf;
    }
}

type ImageDebug = {
    imageSlotsFound: number;
    imageSlotsMaterialized: number;
    imageUrls: { index: number; url: string; prompt: string }[];
    imageErrorStatus?: number;
    imageErrorMessage?: string;
};

/**
 * Generate+upload images for the KLONER slots and wire them into the HTML.
 */
async function materializeAiImages(
    html: string,
    opts: { uid: string; renderId: string; originalHtml?: string }
): Promise<{
    html: string;
    debug: ImageDebug;
}> {
    const originalHtml = opts.originalHtml ?? html;

    const debug: ImageDebug = {
        imageSlotsFound: 0,
        imageSlotsMaterialized: 0,
        imageUrls: [],
    };

    if (!STORAGE_BUCKET) {
        console.warn("[ai-edit] STORAGE_BUCKET not configured; skipping AI image materialization");
        return { html, debug };
    }

    const slots = extractImageSlots(html);
    debug.imageSlotsFound = slots.length;

    if (!slots.length) {
        console.log("[ai-edit] no KLONER_IMAGE_SLOT markers in HTML");
        return { html, debug };
    }

    console.log("[ai-edit] materializeAiImages: found slots", slots);

    const bucket = getStorage().bucket(STORAGE_BUCKET);
    const slotUrlMap = new Map<number, string>();

    for (const slot of slots) {
        try {
            await assertPromptSafe(slot.prompt);

            console.log("[ai-edit] generating AI image for slot", slot);

            const imgResp = await client.images.generate({
                model: "gpt-image-1",
                prompt: slot.prompt,
                size: "1024x1024",
                n: 1,
            });

            const first = (imgResp as any)?.data?.[0];
            const b64 = first?.b64_json;

            if (!b64 || typeof b64 !== "string") {
                console.error("[ai-edit] no b64_json in image response for slot", {
                    slot,
                    imgRespSnippet: JSON.stringify(imgResp).slice(0, 400),
                });
                continue;
            }

            let buf = Buffer.from(b64, "base64");
            buf = await compressImageBuffer(buf);

            const now = Date.now();
            const filePath = `kloner_ai_images/${opts.renderId}/${now}_slot_${slot.index}.jpg`;
            const file = bucket.file(filePath);

            await file.save(buf, {
                contentType: "image/jpeg",
                resumable: false,
                metadata: { cacheControl: "public,max-age=31536000" },
            });

            const [signedUrl] = await file.getSignedUrl({
                action: "read",
                expires: "2500-01-01",
            });

            console.log("[ai-edit] uploaded AI image", {
                slotIndex: slot.index,
                filePath,
                signedUrl,
            });

            slotUrlMap.set(slot.index, signedUrl);
            debug.imageUrls.push({
                index: slot.index,
                url: signedUrl,
                prompt: slot.prompt,
            });
        } catch (err: any) {
            const status: number | undefined = err?.status ?? err?.response?.status;
            const message: string = err?.error?.message ?? err?.message ?? String(err);

            console.error("[ai-edit] failed generating/uploading AI image for slot", slot, {
                status,
                message,
            });

            if (status) {
                debug.imageErrorStatus = status;
                debug.imageErrorMessage = message;
                break;
            }

            if (err?.code === "PROMPT_UNSAFE" || err?.code === "MODERATION_ERROR") {
                debug.imageErrorStatus = 400;
                debug.imageErrorMessage =
                    "Image prompt was blocked or moderation failed; reverting image changes.";
                break;
            }
        }
    }

    debug.imageSlotsMaterialized = slotUrlMap.size;

    let outHtml = html;

    if (slotUrlMap.size === 0) {
        outHtml = outHtml.replace(/<!--\s*KLONER_IMAGE_SLOT_\d+\s*:[\s\S]*?-->/g, "");
        outHtml = outHtml.replace(/__KLONER_IMAGE_SLOT_\d+__/g, "");

        if (debug.imageErrorStatus === 400 || debug.imageErrorStatus === 403 || debug.imageErrorStatus === 401) {
            console.warn("[ai-edit] image materialization blocked; reverting to original HTML block");
            return { html: originalHtml, debug };
        }

        return { html: outHtml, debug };
    }

    for (const [idx, url] of slotUrlMap.entries()) {
        const placeholder = new RegExp(`__KLONER_IMAGE_SLOT_${idx}__`, "g");
        outHtml = outHtml.replace(placeholder, url);
    }

    outHtml = outHtml.replace(/__KLONER_IMAGE_SLOT_\d+__/g, "");
    outHtml = outHtml.replace(/<!--\s*KLONER_IMAGE_SLOT_\d+\s*:[\s\S]*?-->/g, "");

    return { html: outHtml, debug };
}

/**
 * Count occurrences of a tag like <div ...> or <section ...>.
 */
function countTag(html: string, tag: string): number {
    const re = new RegExp(`<${tag}[^>]*>`, "gi");
    let count = 0;
    while (re.exec(html)) count++;
    return count;
}

/**
 * Heuristic to block destructive edits.
 */
function isDestructiveEdit(beforeHtml: string, afterHtml: string): boolean {
    const beforeLen = beforeHtml.length;
    const afterLen = afterHtml.length;

    if (!afterLen) return true;

    if (afterLen < beforeLen * 0.4) {
        return true;
    }

    const keyTags = ["section", "div", "p", "img", "a"];
    for (const tag of keyTags) {
        const beforeCount = countTag(beforeHtml, tag);
        if (beforeCount === 0) continue;
        const afterCount = countTag(afterHtml, tag);

        if (afterCount < Math.floor(beforeCount * 0.5)) {
            return true;
        }
    }

    return false;
}

// Shared system prompt used for both Gemini and OpenAI
const AI_EDIT_SYSTEM_PROMPT = `
You are an HTML refactoring assistant for the Kloner website editor.

SAFETY AND POLICY (MUST FOLLOW):
- You must comply with OpenAI safety policies at all times.
- If the user asks for anything involving:
  - illegal content,
  - child sexual content,
  - explicit sexual content,
  - graphic violence,
  - self-harm,
  - hate or harassment,
  - or instructions that meaningfully facilitate wrongdoing
    (for example: hacking, explosives, serious harm),
  you MUST REFUSE.
- When refusing:
  - Do NOT change the HTML.
  - Set SUMMARY to a short refusal message like:
    "Request refused for safety reasons. No changes applied."
  - Under HTML: return the original HTML block unchanged.

ROLE:
- You receive the HTML for a single selected block (for example a section, div, card, or hero area)
  plus a short user instruction.
- Your job is to apply a small, focused change to that block while preserving the existing content and layout.

CORE BEHAVIOR:
- Apply only minimal, targeted changes based on the user instruction.
- Preserve all existing text, links, and nested elements unless the user explicitly asks to remove them.
- Preserve all IDs, class names, and data-* attributes.
- Preserve Kloner-specific guard rails (attributes like data-kloner-root, kloner markers, etc).
- Do not delete or empty major sections of the block.
- Do not replace the block with a bare wrapper. The original structure and content must remain,
  with only small adjustments (for example: colors, gradients, wording tweaks).

MEDIA RULES:
- Do not remove images or other media unless the user explicitly asks.
- Preserve all <img>, <picture>, <figure>, <video>, <source> tags and any background-image styles from the original HTML.
- You may adjust surrounding text or layout, but keep the media elements themselves.

THEME AND DESIGN RULES:
- Preserve the current theme of the block unless the user explicitly requests design changes.
- Preserve all existing classes that control theme, such as Tailwind utilities
  (bg-*, text-*, font-*, rounded-*, shadow-*), color tokens, and spacing.
- Preserve CSS variables and design tokens (for example: var(--accent), var(--primary), etc).
- When you add new elements, reuse the same style and theme classes already present
  in the surrounding HTML so the new content matches the current site.

AI IMAGE GENERATION RULES:
- You may request new AI-generated images only when the user's instruction clearly asks
  for a new or changed image or background.
- When you need a new AI-generated image, do not invent a final URL.
  Instead, use numbered image slots:

  1) At the top of your HTML output, add one comment per image:
     <!-- KLONER_IMAGE_SLOT_0: short description of the desired image -->
     <!-- KLONER_IMAGE_SLOT_1: another short description -->

  2) In the HTML where the image will be used:
     - For <img> tags, set:
         src="__KLONER_IMAGE_SLOT_0__"
       and keep a relevant alt attribute that matches the image.
     - For CSS backgrounds, use:
         style="background-image:url('__KLONER_IMAGE_SLOT_0__');"

  3) Reuse the same slot index everywhere that same image is used in this block.

- If the user does not explicitly ask for a new or changed image,
  do not create any KLONER_IMAGE_SLOT comments or placeholders.

CONFLICT HANDLING:
- If the user instruction conflicts with these rules,
  follow these rules first and then satisfy the instruction as much as possible
  within these constraints.

OUTPUT FORMAT (STRICT):
Return plain text in exactly this format, with no extra commentary:

SUMMARY: <one short sentence describing what changed or why it was refused>
HTML:
<the edited HTML for the same block, including any KLONER_IMAGE_SLOT comments if used>

Requirements:
- Return only the edited HTML for that block, not a full document.
- Do not include <!doctype> or <html> wrappers.
- Do not return JSON.
- Do not wrap anything in backticks.
`.trim();

/**
 * Core model call for AI editing.
 */
async function runAiEditModel(input: {
    html: string;
    prompt: string; // MODEL PROMPT (may include guard rails)
    uid: string;
    mode?: "code" | "imagery";
}): Promise<AiEditModelResult> {
    const trimmedHtml = trimHtmlForModel(input.html);
    const { prompt, uid } = input;
    const mode = input.mode ?? "code";

    const user = `
USER INSTRUCTION:
${prompt}

CURRENT HTML BLOCK (may be truncated for performance):
${trimmedHtml}
`.trim();

    if (mode === "code" && geminiClient) {
        try {
            console.log("[ai-edit] calling Gemini 3 Pro (code mode)", {
                htmlLength: trimmedHtml.length,
                promptSnippet: prompt.slice(0, 120),
            });

            const model = geminiClient.getGenerativeModel({
                model: "gemini-3-pro-preview",
            });

            const result = await model.generateContent({
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                text: `${AI_EDIT_SYSTEM_PROMPT}\n\n${user}`,
                            },
                        ],
                    },
                ],
            });

            const raw = result.response?.text()?.trim() ?? "";

            if (!raw) {
                console.error("[ai-edit] Gemini returned empty text; falling back to original HTML");
                return {
                    afterHtml: input.html,
                    summary: "No safe HTML returned; left the block unchanged.",
                };
            }

            const summaryMatch = raw.match(/^SUMMARY:\s*(.+)$/m);
            const summary =
                summaryMatch && summaryMatch[1].trim()
                    ? summaryMatch[1].trim()
                    : "Minimal changes applied.";

            let htmlSection = raw;
            const htmlMarkerIdx = raw.toLowerCase().indexOf("html:");
            if (htmlMarkerIdx !== -1) {
                htmlSection = raw.slice(htmlMarkerIdx + "html:".length).trim();
            }

            const lower = htmlSection.toLowerCase();
            let htmlStart = lower.indexOf("<!doctype html");
            if (htmlStart === -1) htmlStart = lower.indexOf("<html");

            let afterHtml: string;

            if (htmlStart !== -1) {
                afterHtml = htmlSection.slice(htmlStart).trim();
            } else {
                afterHtml = htmlSection.trim();
                if (!afterHtml) {
                    console.error("[ai-edit] Gemini returned empty HTML section; first 300 chars of raw:", raw.slice(0, 300));
                    return {
                        afterHtml: input.html,
                        summary:
                            summary +
                            " (Model did not return usable HTML; kept the original block unchanged.)",
                    };
                }
            }

            console.log("[ai-edit] Gemini model output lengths", {
                rawLength: raw.length,
                htmlLength: afterHtml.length,
                summary,
            });

            return { afterHtml, summary };
        } catch (err: any) {
            console.error("[ai-edit] Gemini call failed, falling back to OpenAI", {
                name: err?.name,
                message: err?.message,
            });
        }
    }

    try {
        console.log("[ai-edit] calling OpenAI gpt-5-mini", {
            htmlLength: trimmedHtml.length,
            promptSnippet: prompt.slice(0, 120),
            mode,
        });

        const resp = await client.responses.create({
            model: "gpt-5-mini",
            input: [
                {
                    role: "system",
                    content: [{ type: "input_text", text: AI_EDIT_SYSTEM_PROMPT }],
                },
                {
                    role: "user",
                    content: [{ type: "input_text", text: user }],
                },
            ],
            max_output_tokens: 12_000,
            metadata: {
                feature: "kloner_ai_edit",
                uid,
            },
        });

        const raw = extractTextFromResponse(resp);

        if (!raw) {
            console.error("[ai-edit] empty text from OpenAI model, raw resp snippet:", JSON.stringify(resp, null, 2).slice(0, 2000));
            return {
                afterHtml: input.html,
                summary: "No safe HTML returned; left the block unchanged.",
            };
        }

        const summaryMatch = raw.match(/^SUMMARY:\s*(.+)$/m);
        const summary =
            summaryMatch && summaryMatch[1].trim()
                ? summaryMatch[1].trim()
                : "Minimal changes applied.";

        let htmlSection = raw;
        const htmlMarkerIdx = raw.toLowerCase().indexOf("html:");
        if (htmlMarkerIdx !== -1) {
            htmlSection = raw.slice(htmlMarkerIdx + "html:".length).trim();
        }

        const lower = htmlSection.toLowerCase();
        let htmlStart = lower.indexOf("<!doctype html");
        if (htmlStart === -1) htmlStart = lower.indexOf("<html");

        let afterHtml: string;

        if (htmlStart !== -1) {
            afterHtml = htmlSection.slice(htmlStart).trim();
        } else {
            afterHtml = htmlSection.trim();
            if (!afterHtml) {
                console.error("[ai-edit] model returned empty HTML section; first 300 chars of raw:", raw.slice(0, 300));
                return {
                    afterHtml: input.html,
                    summary:
                        summary +
                        " (Model did not return usable HTML; kept the original block unchanged.)",
                };
            }
        }

        console.log("[ai-edit] OpenAI model output lengths", {
            rawLength: raw.length,
            htmlLength: afterHtml.length,
            summary,
        });

        return { afterHtml, summary };
    } catch (err: any) {
        console.error("[ai-edit] OpenAI call failed", {
            name: err?.name,
            ctor: err?.constructor?.name,
            message: err?.message,
        });
        return {
            afterHtml: input.html,
            summary: "AI edit failed; left the block unchanged.",
        };
    }
}

/**
 * Ensure / sync a dedicated credits.aiEdits bucket.
 */
async function syncAiEditCreditsBucket(opts: {
    userRef: any;
    tier: UserTier;
    now: Date;
    usedCreditsBefore: number;
    consumedNow: boolean;
}): Promise<{ remaining: number | null; limit: number | null }> {
    const { userRef, tier, now, usedCreditsBefore, consumedNow } = opts;

    let limit: number | null = null;
    try {
        const rawLimit = monthlyLimitFor(tier, "edit");
        limit = rawLimit || 0;
    } catch (err) {
        console.error("[ai-edit][credits] monthlyLimitFor(edit) failed", err);
        return { remaining: null, limit: null };
    }

    if (!limit) {
        return { remaining: null, limit: 0 };
    }

    let remainingResult: number = 0;

    try {
        const snap = await userRef.get();
        const data = snap.exists ? (snap.data() as any) : {};
        const bucket =
            data["credits.aiEdits"] ||
            (data.credits && data.credits.aiEdits) ||
            {};

        const rawEnd = bucket.periodEnd;
        let periodEndDate: Date | null = null;

        if (rawEnd && typeof rawEnd.toDate === "function") {
            periodEndDate = rawEnd.toDate() as Date;
        } else if (rawEnd instanceof Date) {
            periodEndDate = rawEnd;
        }

        const bucketHasActivePeriod = periodEndDate !== null && now < periodEndDate;

        const existingRemaining =
            typeof bucket.remaining === "number" && bucket.remaining >= 0
                ? bucket.remaining
                : 0;

        if (bucketHasActivePeriod) {
            remainingResult = consumedNow ? Math.max(existingRemaining - 5, 0) : existingRemaining;
        } else {
            const usedTotal = usedCreditsBefore + (consumedNow ? 5 : 0);
            remainingResult = Math.max(limit - usedTotal, 0);

            const year = now.getUTCFullYear();
            const month = now.getUTCMonth();
            const firstNextMonth = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
            periodEndDate = new Date(firstNextMonth.getTime() - 1);
        }

        await userRef.set(
            {
                "credits.aiEdits": {
                    remaining: remainingResult,
                    monthlyLimit: limit,
                    periodEnd: periodEndDate,
                },
            },
            { merge: true }
        );
    } catch (err) {
        console.error("[ai-edit][credits] failed syncing credits.aiEdits", err);
        return { remaining: null, limit };
    }

    return { remaining: remainingResult, limit };
}

/**
 * Normalize timestamps to ISO strings for response payloads.
 */
function normalizeCreatedAtToIso(raw: any): string | null {
    try {
        if (!raw) return null;
        if (typeof raw.toDate === "function") return raw.toDate().toISOString();
        if (raw instanceof Date) return raw.toISOString();
        if (typeof raw === "string") return raw;
        return null;
    } catch {
        return null;
    }
}

/**
 * POST /api/ai-edit
 */
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
        const mode: "code" | "imagery" = body.mode === "imagery" ? "imagery" : "code";

        const action: "edit_block" | "create_page" =
            body.action === "create_page" ? "create_page" : "edit_block";

        // USER PROMPT: this is what must be saved in DB and used for moderation
        const rawUserPrompt =
            (body.userPrompt ?? body.prompt ?? "").trim().slice(0, MAX_USER_PROMPT_CHARS);

        // DISPLAY PROMPT: optional generated prompt that can be shown in history if your UI chooses it
        // (kept for backwards compatibility with callers that used originalPrompt as "generated")
        const rawDisplayPrompt =
            (body.originalPrompt ?? "").trim().slice(0, MAX_MODEL_PROMPT_CHARS);

        // MODEL PROMPT: what we actually send to the model (can include guard rails)
        let modelPrompt = "";

        if (!renderId || !html) {
            return NextResponse.json({ error: "renderId and html are required" }, { status: 400 });
        }

        if (action === "create_page") {
            const pageId = String(body.pageId || "").trim();
            const slug = String(body.slug || "").trim();

            if (!pageId || !slug) {
                return NextResponse.json({ error: "pageId and slug are required" }, { status: 400 });
            }

            const built = buildCreatePagePrompt({
                pageId,
                slug,
                userPrompt: rawUserPrompt,
            });

            modelPrompt = built.modelPrompt.slice(0, MAX_MODEL_PROMPT_CHARS);
        } else {
            // edit_block: model prompt is exactly the user prompt
            if (!rawUserPrompt) {
                return NextResponse.json(
                    { error: "prompt is required" },
                    { status: 400 }
                );
            }
            modelPrompt = rawUserPrompt.slice(0, MAX_MODEL_PROMPT_CHARS);
        }

        console.log("[ai-edit] POST start", {
            uid,
            renderId,
            htmlLength: html.length,
            action,
            userPromptSnippet: rawUserPrompt.slice(0, 120),
            mode,
        });

        // Safety gate: moderate ONLY the user-entered text
        try {
            await assertPromptSafe(rawUserPrompt || "create_page");
        } catch (err: any) {
            if (err?.code === "PROMPT_UNSAFE") {
                return NextResponse.json(
                    { error: "This edit request was blocked because it violated our content rules." },
                    { status: 400 }
                );
            }

            return NextResponse.json(
                { error: "AI editing is temporarily unavailable due to a safety system error. Try again later." },
                { status: 503 }
            );
        }

        const now = new Date();

        let aiEditsRef: any | null = null;
        let userRef: any | null = null;
        let tier: UserTier = "free";
        let creditsLimit: number | null = null;
        let usedCreditsBefore = 0;

        if (db) {
            try {
                userRef = db.collection("kloner_users").doc(uid);

                try {
                    const userSnap = await userRef.get();
                    if (userSnap.exists) {
                        const data = userSnap.data() as any;
                        const rawTierValue = (data.userTier ?? data.tier) as string | undefined;
                        const rawTier = rawTierValue?.toLowerCase();

                        if (
                            rawTier === "pro" ||
                            rawTier === "agency" ||
                            rawTier === "enterprise" ||
                            rawTier === "free"
                        ) {
                            tier = rawTier as UserTier;
                        } else {
                            tier = "free";
                        }
                    }
                } catch (e) {
                    console.error("[ai-edit] failed to read userTier/tier; defaulting to free", e);
                    tier = "free";
                }

                const renderRef = userRef.collection("kloner_renders").doc(renderId);
                const renderSnap = await renderRef.get();

                if (!renderSnap.exists) {
                    await renderRef.set(
                        { uid, renderId, createdAt: now, source: "ai-edit-shell" },
                        { merge: true }
                    );
                }

                aiEditsRef = renderRef.collection("ai_edits");

                try {
                    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                    const monthSnap = await aiEditsRef.where("createdAt", ">=", startOfMonth).get();

                    const editCountThisMonth = monthSnap.size ?? 0;
                    usedCreditsBefore = editCountThisMonth * 5;

                    const allowed = canConsumeCredit(tier, "edit", usedCreditsBefore);

                    const limit = monthlyLimitFor(tier, "edit");
                    creditsLimit = limit || 0;

                    if (!allowed) {
                        console.log("[ai-edit] credit check blocked request", {
                            tier,
                            creditsLimit,
                            usedCreditsBefore,
                        });

                        if (userRef && limit) {
                            await syncAiEditCreditsBucket({
                                userRef,
                                tier,
                                now,
                                usedCreditsBefore,
                                consumedNow: false,
                            });
                        }

                        return NextResponse.json(
                            {
                                error:
                                    "You have used all AI edit credits for this month. Upgrade your plan or wait until next month for more.",
                                meta: { tier, creditsRemaining: 0, creditsLimit },
                            },
                            { status: 402 }
                        );
                    }
                } catch (err) {
                    console.error("[ai-edit] credit check failed, allowing request", err);
                }
            } catch (err) {
                console.error("[ai-edit] Firestore read/write failed, skipping history bootstrap", err);
                db = null;
            }
        }

        // HARD TIER GATE: AI edits are Pro+ only (kept as-is; currently disabled in your file)
        // const isPaidTier = tier === "pro" || tier === "agency" || tier === "enterprise";
        // if (!isPaidTier) { ... }

        let modelResult: AiEditModelResult;
        try {
            modelResult = await runAiEditModel({
                html,
                prompt: modelPrompt,
                uid,
                mode,
            });
        } catch (err: any) {
            console.error("[ai-edit] model error (unexpected throw)", err);
            return NextResponse.json({ error: "model_failed" }, { status: 502 });
        }

        let effectiveAfterHtml = modelResult.afterHtml;

        // Optional destructive diff guard (kept disabled)
        // if (isDestructiveEdit(html, effectiveAfterHtml)) { ... }

        // Materialize any AI image slots into real URLs
        let afterHtml = effectiveAfterHtml;
        let imageDebug: ImageDebug = {
            imageSlotsFound: 0,
            imageSlotsMaterialized: 0,
            imageUrls: [],
        };

        try {
            const result = await materializeAiImages(afterHtml, {
                uid,
                renderId: renderId!,
                originalHtml: html,
            });
            afterHtml = result.html;
            imageDebug = result.debug;

            console.log("[ai-edit] materializeAiImages debug", imageDebug);

            if (
                imageDebug.imageSlotsFound > 0 &&
                imageDebug.imageSlotsMaterialized === 0 &&
                (imageDebug.imageErrorStatus === 403 || imageDebug.imageErrorStatus === 400)
            ) {
                console.warn("[ai-edit] reverting AI edit because image generation is not allowed or was blocked");
                afterHtml = html;
            }
        } catch (err) {
            console.error("[ai-edit] materializeAiImages failed; falling back to raw HTML", err);
            afterHtml = effectiveAfterHtml;
        }

        // Final safety: never return unresolved KLONER image placeholders or comments
        afterHtml = afterHtml
            .replace(/__KLONER_IMAGE_SLOT_\d+__/g, "")
            .replace(/<!--\s*KLONER_IMAGE_SLOT_\d+\s*:[\s\S]*?-->/g, "");

        const summary = modelResult.summary;

        // If Firestore unavailable, return without persistence
        if (!db || !aiEditsRef) {
            console.log("[ai-edit] returning without Firestore persistence", {
                hasDb: !!db,
                hasAiEditsRef: !!aiEditsRef,
            });

            return NextResponse.json(
                {
                    suggestions: [
                        {
                            id: "local",
                            renderId,
                            // IMPORTANT: "prompt" is always the user-entered prompt
                            prompt: rawUserPrompt,
                            // Optional: UI can show this instead for history if desired
                            displayPrompt: rawDisplayPrompt || modelPrompt,
                            modelPrompt,
                            summary,
                            beforeHtml: html,
                            afterHtml,
                            createdAt: now.toISOString(),
                            uid,
                            action,
                        },
                    ],
                    meta: {
                        tier,
                        creditsRemaining: null,
                        creditsLimit: null,
                    },
                    debug: imageDebug,
                },
                { status: 200 }
            );
        }

        const docRef = aiEditsRef.doc();

        // Persistence rule:
        // - "prompt" field is ALWAYS the user-entered text (what you want stored).
        // - "displayPrompt" can store your generated prompt for history display.
        // - "modelPrompt" stores the exact prompt sent to the model for debugging/auditing.
        await docRef.set({
            renderId,
            action,
            prompt: rawUserPrompt, // USER ENTERED ONLY
            displayPrompt: rawDisplayPrompt || modelPrompt, // generated/expanded (optional)
            modelPrompt, // exact sent prompt
            summary,
            beforeHtml: html,
            afterHtml,
            createdAt: now,
            uid,
        });

        // Trim history to last 5 edits for this render
        try {
            const extraSnap = await aiEditsRef.orderBy("createdAt", "desc").offset(5).get();

            if (!extraSnap.empty) {
                const batch = db.batch();
                extraSnap.docs.forEach((d: any) => batch.delete(d.ref));
                await batch.commit();
            }
        } catch (err) {
            console.error("[ai-edit] failed trimming history", err);
        }

        const latestSnap = await aiEditsRef.orderBy("createdAt", "desc").limit(5).get();

        const suggestions = latestSnap.docs.map((d: any) => {
            const data = d.data() as any;
            return {
                id: d.id,
                ...data,
                createdAt: normalizeCreatedAtToIso(data.createdAt),
            };
        });

        // Sync / create credits.aiEdits and compute remaining for response
        let creditsRemaining: number | null = null;
        try {
            if (userRef) {
                const synced = await syncAiEditCreditsBucket({
                    userRef,
                    tier,
                    now,
                    usedCreditsBefore,
                    consumedNow: true,
                });
                creditsRemaining = synced.remaining;
                creditsLimit = synced.limit;
            } else {
                const limit = monthlyLimitFor(tier, "edit");
                creditsLimit = limit || 0;

                if (limit) {
                    const usedAfter = usedCreditsBefore + 5;
                    creditsRemaining = Math.max(limit - usedAfter, 0);
                } else {
                    creditsRemaining = null;
                }
            }
        } catch (err) {
            console.error("[ai-edit] failed computing/syncing AI edit credits", err);
        }

        console.log("[ai-edit] POST success", {
            uid,
            renderId,
            summary,
            action,
            imageSlotsFound: imageDebug.imageSlotsFound,
            imageSlotsMaterialized: imageDebug.imageSlotsMaterialized,
            imageErrorStatus: imageDebug.imageErrorStatus,
            mode,
        });

        return NextResponse.json(
            {
                suggestions,
                meta: {
                    tier,
                    creditsRemaining,
                    creditsLimit,
                },
                debug: imageDebug,
            },
            { status: 200 }
        );
    });
}

/**
 * GET /api/ai-edit?renderId=...
 */
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
            return NextResponse.json({ error: "renderId is required" }, { status: 400 });
        }

        if (!db) {
            return NextResponse.json(
                {
                    suggestions: [],
                    meta: { tier: "free", creditsRemaining: null, creditsLimit: null },
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
                    const data = userSnap.data() as any;
                    const rawTierValue = (data.userTier ?? data.tier) as string | undefined;
                    const rawTier = rawTierValue?.toLowerCase();

                    if (
                        rawTier === "pro" ||
                        rawTier === "agency" ||
                        rawTier === "enterprise" ||
                        rawTier === "free"
                    ) {
                        tier = rawTier as UserTier;
                    } else {
                        tier = "free";
                    }
                }
            } catch (e) {
                console.error("[ai-edit][GET] failed to read userTier/tier; defaulting to free", e);
                tier = "free";
            }

            const renderRef = userRef.collection("kloner_renders").doc(renderId);
            const renderSnap = await renderRef.get();

            if (!renderSnap.exists) {
                let creditsRemaining: number | null = null;
                let creditsLimit: number | null = null;

                try {
                    const now = new Date();
                    const synced = await syncAiEditCreditsBucket({
                        userRef,
                        tier,
                        now,
                        usedCreditsBefore: 0,
                        consumedNow: false,
                    });
                    creditsRemaining = synced.remaining;
                    creditsLimit = synced.limit;
                } catch (err) {
                    console.error("[ai-edit][GET] failed syncing AI edit credits for missing render", err);
                }

                return NextResponse.json(
                    { suggestions: [], meta: { tier, creditsRemaining, creditsLimit } },
                    { status: 200 }
                );
            }

            const aiEditsRef = renderRef.collection("ai_edits");
            const snap = await aiEditsRef.orderBy("createdAt", "desc").limit(5).get();

            const suggestions = snap.docs.map((d: any) => {
                const data = d.data() as any;
                return {
                    id: d.id,
                    ...data,
                    createdAt: normalizeCreatedAtToIso(data.createdAt),
                };
            });

            let creditsRemaining: number | null = null;
            let creditsLimit: number | null = null;

            try {
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

                const monthSnap = await aiEditsRef.where("createdAt", ">=", startOfMonth).get();
                const editCountThisMonth = monthSnap.size ?? 0;
                const usedCreditsBefore = editCountThisMonth * 5;

                const synced = await syncAiEditCreditsBucket({
                    userRef,
                    tier,
                    now,
                    usedCreditsBefore,
                    consumedNow: false,
                });

                creditsRemaining = synced.remaining;
                creditsLimit = synced.limit;
            } catch (err) {
                console.error("[ai-edit][GET] failed computing/syncing AI edit credits", err);
            }

            return NextResponse.json(
                { suggestions, meta: { tier, creditsRemaining, creditsLimit } },
                { status: 200 }
            );
        } catch (err) {
            console.error("[ai-edit] Firestore GET failed", err);
            return NextResponse.json(
                {
                    suggestions: [],
                    meta: { tier: "free", creditsRemaining: null, creditsLimit: null },
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
