// app/api/admin/support/threads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, requireAdmin } from "../../../_lib/auth";
import { countUnreadThreads, listThreads } from "../../../_lib/supportInboxStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
        return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
    }
    const db = getAdminDb();
    const [threads, unreadCount] = await Promise.all([listThreads(db), countUnreadThreads(db)]);
    return NextResponse.json(
        { ok: true, threads, unreadCount },
        { headers: { "Cache-Control": "no-store" } }
    );
}
