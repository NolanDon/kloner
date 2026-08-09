import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";
import { buildSupportDocsContext, buildSupportPolicyContext, loadSupportDocs } from "@/src/lib/supportRag";
import { resolveGenerateContentModels } from "@/src/lib/geminiModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const geminiClient = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
const configuredSupportModel = process.env.GEMINI_CHAT_MODEL?.trim() || "";
const preferredSupportModel = configuredSupportModel && configuredSupportModel !== "gemini-1.5-flash"
    ? configuredSupportModel
    : "gemini-2.5-flash";
const supportModelFallbacks = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-pro"];

function buildAskPrompt(params: {
    question: string;
    contextBlob: string | null;
    recentConversation: string;
    currentFile: string | null;
    currentFileContent: string | null;
}): string {
    const { question, contextBlob, recentConversation, currentFile, currentFileContent } = params;
    return [
        "You are the app help assistant for Kloner.",
        "Answer only from the provided support docs and any explicit app context.",
        "If the answer is not in the docs, say you do not know and suggest the user switch to Task mode or ask for a specific change.",
        "If the question is about exporting, downloading, or extracting source code from Kloner, answer that code exporting is not currently available.",
        currentFile ? `Current file: ${currentFile}` : "Current file: (none)",
        currentFileContent ? `Current file content:\n${currentFileContent}` : "Current file content: (not provided)",
        recentConversation ? `Recent conversation:\n${recentConversation}` : "Recent conversation: (none)",
        contextBlob ? `Kloner support docs:\n\n${contextBlob}` : "Kloner support docs: (none found)",
        `User question: ${question}`,
        "Return plain text only.",
    ].join("\n\n");
}

export async function POST(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(req, async ({ uid, req: authedReq }) => {
        const { appId } = await Promise.resolve(params);
        assertAppBuilderScope(authedReq, uid, appId);

        const body = await req.json().catch(() => ({} as any));
        const question = String(body?.question || "").trim();
        if (!question) {
            return NextResponse.json({ ok: false, error: "Question required" }, { status: 400 });
        }

        const db = getAdminDb();
        const appDoc = await db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).get();
        if (!appDoc.exists) {
            return NextResponse.json({ ok: false, error: "App not found" }, { status: 404 });
        }

        if (!geminiClient) {
            return NextResponse.json({ ok: false, error: "Gemini API key not configured" }, { status: 503 });
        }

        const docs = await loadSupportDocs(db);
        const contextBlob = [
            buildSupportPolicyContext(question),
            buildSupportDocsContext(question, docs),
        ]
            .filter(Boolean)
            .join("\n\n---\n\n") || null;
        const currentFile = typeof body?.currentFile === "string" ? body.currentFile.trim() || null : null;
        const currentFileContent = typeof body?.currentFileContent === "string" ? body.currentFileContent : null;
        const recentConversation = typeof body?.recentConversation === "string" ? body.recentConversation : "";

        const prompt = buildAskPrompt({
            question,
            contextBlob,
            recentConversation,
            currentFile,
            currentFileContent,
        });

        const candidateModels = await resolveGenerateContentModels({
            apiKey: geminiApiKey,
            preferred: [preferredSupportModel, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-pro"],
            fallback: supportModelFallbacks,
        });

        try {
            let lastError: unknown = null;
            for (const modelName of candidateModels) {
                if (!modelName) continue;
                try {
                    const model = geminiClient.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            temperature: 0.2,
                            maxOutputTokens: 1024,
                        },
                    });
                    const result = await model.generateContent(prompt);
                    const answer = result.response.text().trim();
                    return NextResponse.json({ ok: true, route: "ask", response: answer, hasContext: Boolean(contextBlob), model: modelName });
                } catch (err) {
                    lastError = err;
                    const msg = String((err as any)?.message || err || "").toLowerCase();
                    if (!msg.includes("not found") && !msg.includes("not supported") && !msg.includes("404")) {
                        throw err;
                    }
                }
            }

            throw lastError || new Error("No supported Gemini generateContent model available");
        } catch (error: any) {
            const message = String(error?.message || "The question could not be answered right now.");
            return NextResponse.json({ ok: false, error: message, route: "ask" }, { status: 500 });
        }
    }, { csrf: true, methods: ["POST"] });
}
