// app/api/app-builder/[appId]/ai-chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    type?: "text" | "code" | "file-edit";
    timestampMs?: number;
    restorePointId?: string | null;
    restoreActionLabel?: string | null;
};

function normalizeMessages(input: unknown): StoredMessage[] {
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

    // Keep a reasonable tail and stay well under the 1MB doc limit.
    const tailMax = 120;
    return out.slice(-tailMax);
}

export async function GET(req: NextRequest, { params }: { params: { appId: string } }) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const appId = params.appId;
            assertAppBuilderScope(authedReq, uid, appId);

            const db = getAdminDb();
            const chatRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("kloner_apps")
                .doc(appId)
                .collection("ai_chat")
                .doc("default");

            const snap = await chatRef.get();
            const data = snap.exists ? (snap.data() as any) : null;
            const messages = normalizeMessages(data?.messages);

            return NextResponse.json({ ok: true, messages }, { status: 200 });
        },
        { methods: ["GET"] }
    );
}

export async function POST(req: NextRequest, { params }: { params: { appId: string } }) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const appId = params.appId;
            assertAppBuilderScope(authedReq, uid, appId);

            const body = await req.json().catch(() => null);
            const messages = normalizeMessages(body?.messages);

            const db = getAdminDb();
            const chatRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("kloner_apps")
                .doc(appId)
                .collection("ai_chat")
                .doc("default");

            await chatRef.set(
                {
                    messages,
                    updatedAt: new Date(),
                },
                { merge: true }
            );

            return NextResponse.json({ ok: true, saved: messages.length }, { status: 200 });
        },
        { csrf: true, methods: ["POST"] }
    );
}
