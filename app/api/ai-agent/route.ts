// app/api/ai-agent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    type?: string;
};

export async function POST(request: NextRequest) {
    try {
        const { message, appId, files, databaseConnections, conversationHistory } = await request.json();

        // Build conversation context
        const conversationContext = conversationHistory ? 
            conversationHistory.slice(-10).map((msg: Message) => 
                `${msg.role}: ${msg.content}`
            ).join("\n") : "";

        // Get the Gemini model
        const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-1.5-pro" });

        // Build context from files and conversation
        const fileContext = Object.entries(files)
            .map(([path, file]: [string, any]) => `File: ${path}\n${file.content}`)
            .join("\n\n");
        const databaseContext = databaseConnections && databaseConnections.length > 0
            ? `\n\nConnected Databases:\n${databaseConnections
                .filter((db: any) => db.status === "connected")
                .map((db: any) => `- ${db.name} (${db.type}): ${db.host}:${db.port}/${db.database}`)
                .join("\n")}`
            : "";

        const systemPrompt = `You are an expert AI assistant for building web applications. You can help manage the development server, and connect to databases.

Available tools and capabilities:
1. File editing: You can create, modify, and delete files
2. Server management: You can refresh/restart the development server
3. Database connections: You can help set up database connections and queries${databaseContext}
4. API integrations: You can help integrate with external APIs
5. Code generation: You can generate complete components and features

Current project files:
${fileContext}

Recent conversation:
${conversationContext}

Instructions:
- Be helpful and proactive in building features
- When making file changes, provide clear explanations
- If you need to edit files, specify the exact changes
- Use modern React/Next.js best practices
- Include proper error handling and TypeScript types
- When you make changes that require a server restart, indicate this
- If databases are connected, you can suggest database operations and querie
- When making file changes, provide clear explanations
- If you need to edit files, specify the exact changes
- Use modern React/Next.js best practices
- Include proper error handling and TypeScript types
- When you make changes that require a server restart, indicate this

User request: ${message}

Respond with a helpful solution that may include file edits or other actions.`;

        // Generate response
        const result = await model.generateContent(systemPrompt);
        const response = result.response.text();

        // Parse response for file changes and actions
        const fileChanges: { [path: string]: string } = {};
        const filesEdited: string[] = [];
        let serverRefreshed = false;

        // Simple parsing for file edits (in a real implementation, you'd use more sophisticated parsing)
        const fileEditRegex = /```(\w+):(.+?)\n([\s\S]*?)```/g;
        let match;
        while ((match = fileEditRegex.exec(response)) !== null) {
            const [, type, filename, content] = match;
            if (type === "file" || type === "javascript" || type === "typescript" || type === "jsx" || type === "tsx") {
                fileChanges[filename] = content.trim();
                filesEdited.push(filename);
            }
        }

        // Check if server refresh is needed
        if (response.toLowerCase().includes("restart") ||
            response.toLowerCase().includes("refresh") ||
            response.toLowerCase().includes("reload")) {
            serverRefreshed = true;
        }

        return NextResponse.json({
            response: response.replace(fileEditRegex, "").trim(), // Remove code blocks from response
            fileChanges,
            filesEdited,
            serverRefreshed,
            type: filesEdited.length > 0 ? "file_edit" : serverRefreshed ? "server_refresh" : "text"
        });

    } catch (error) {
        console.error("AI agent error:", error);
        return NextResponse.json(
            { error: "Failed to process AI request" },
            { status: 500 }
        );
    }
}