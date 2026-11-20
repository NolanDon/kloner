// app/api/admin/support/threads/[threadId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, requireAdmin } from "../../../../_lib/auth";
import {
    getThread,
    listMessages,
    markThreadRead,
    setThreadStatus,
} from "../../../../_lib/supportInboxStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ threadId: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
        return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
    }
    const { threadId } = await context.params;
    const db = getAdminDb();
    const thread = await getThread(db, threadId);
    if (!thread) {
        return NextResponse.json({ ok: false, error: "Thread not found." }, { status: 404 });
    }
    const messages = await listMessages(db, threadId);
    if (thread.unread) await markThreadRead(db, threadId);
    return NextResponse.json(
        { ok: true, thread: { ...thread, unread: false }, messages },
        { headers: { "Cache-Control": "no-store" } }
    );
}

export async function PATCH(req: NextRequest, context: RouteContext) {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
        return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
    }
    const { threadId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const status = body?.status;
    if (status !== "open" && status !== "closed") {
        return NextResponse.json({ ok: false, error: "Status must be open or closed." }, { status: 400 });
    }
    const db = getAdminDb();
    const thread = await getThread(db, threadId);
    if (!thread) {
        return NextResponse.json({ ok: false, error: "Thread not found." }, { status: 404 });
    }
    await setThreadStatus(db, threadId, status);
    return NextResponse.json({ ok: true, status }, { headers: { "Cache-Control": "no-store" } });
}
