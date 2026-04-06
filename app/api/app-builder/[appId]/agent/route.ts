// app/api/app-builder/[appId]/agent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { captureCriticalEvent } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

function classifyProviderError(err: unknown) {
    const raw = err instanceof Error ? err.message : String(err || "Unknown AI provider error");
    const message = raw.length > 1500 ? raw.slice(0, 1500) : raw;
    const lower = message.toLowerCase();
    const statusMatch = message.match(/\b(4\d\d|5\d\d)\b/);
    const statusFromMsg = statusMatch ? Number(statusMatch[1]) : 500;

    if (statusFromMsg === 429 || lower.includes("quota") || lower.includes("rate")) {
        return {
            statusCode: 429,
            userMessage: "AI usage is temporarily rate-limited. Please try again shortly.",
            code: "AI_RATE_LIMITED",
            providerMessage: message,
        };
    }

    if (statusFromMsg === 503 || lower.includes("service unavailable") || lower.includes("temporarily unavailable")) {
        return {
            statusCode: 503,
            userMessage: "The AI service is temporarily unavailable. Please try again in a few minutes.",
            code: "AI_PROVIDER_UNAVAILABLE",
            providerMessage: message,
        };
    }

    return {
        statusCode: statusFromMsg >= 400 ? statusFromMsg : 503,
        userMessage: "The AI request failed. Please try again in a few minutes.",
        code: "AI_PROVIDER_ERROR",
        providerMessage: message,
    };
}

export async function POST(req: NextRequest, { params }: any) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();
        const { appId } = await Promise.resolve(params);

        const appDoc = await db.collection("kloner_users").doc(uid).collection("kloner_apps").doc(appId).get();
        if (!appDoc.exists) {
            return NextResponse.json({ error: "App not found" }, { status: 404 });
        }

        const appData = appDoc.data();
        if (!appData) {
            return NextResponse.json({ error: "App data not found" }, { status: 404 });
        }

        const body = await req.json();
        const { prompt, currentFile, currentCode } = body;

        if (!prompt) {
            return NextResponse.json({ error: "Prompt required" }, { status: 400 });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" }); // Using Gemini 1.5 Pro as it's stable

        const systemPrompt = `You are an expert Next.js developer. Modify the provided code based on the user's request.

Current file: ${currentFile || 'unknown'}
Current code:
${currentCode || 'No code provided'}

User request: ${prompt}

Provide only the modified code, no explanations or markdown.`;

        try {
            const result = await model.generateContent(systemPrompt);
            const response = await result.response;
            const modifiedCode = response.text().trim();

            return NextResponse.json({ modifiedCode });
        } catch (error) {
            const classified = classifyProviderError(error);

            void captureCriticalEvent({
                source: "internal",
                severity: classified.statusCode >= 500 ? "critical" : "error",
                statusCode: classified.statusCode,
                route: "/api/app-builder/[appId]/agent",
                method: "POST",
                action: "app_builder_agent_generate_failed",
                userId: uid,
                message: `App builder agent provider failure: ${classified.providerMessage}`,
                service: "app-builder-agent",
                tags: ["app-builder", "ai-agent", "gemini", "provider-error"],
                extra: {
                    appId,
                    code: classified.code,
                    providerMessage: classified.providerMessage,
                    model: "gemini-1.5-pro",
                },
            });

            console.error("Gemini API error:", error);
            return NextResponse.json(
                { error: classified.userMessage, code: classified.code },
                { status: classified.statusCode },
            );
        }
    });
}