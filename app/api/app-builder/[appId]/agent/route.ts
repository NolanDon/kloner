// app/api/app-builder/[appId]/agent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

export async function POST(req: NextRequest, { params }: { params: { appId: string } }) {
    return requireSessionAndMaybeCsrf(req, async ({ uid }) => {
        const db = getAdminDb();
        const { appId } = params;

        const appDoc = await db.collection("user_apps").doc(appId).get();
        if (!appDoc.exists) {
            return NextResponse.json({ error: "App not found" }, { status: 404 });
        }

        const appData = appDoc.data();
        if (appData?.userId !== uid) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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
            console.error("Gemini API error:", error);
            return NextResponse.json({ error: "Failed to generate code" }, { status: 500 });
        }
    });
}