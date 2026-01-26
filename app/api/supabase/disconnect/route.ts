// app/api/supabase/disconnect/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../_lib/route-guard";
import { getAdminDb } from "../../_lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const confirm = typeof body?.confirm === "string" ? body.confirm : "";
            if (confirm !== "DISCONNECT") {
                return NextResponse.json(
                    { ok: false, error: "Confirmation required" },
                    { status: 400 },
                );
            }

            const db = getAdminDb();
            const integrations = db
                .collection("kloner_users")
                .doc(uid)
                .collection("integrations");

            await Promise.all([
                integrations.doc("supabase").delete().catch(() => undefined),
                integrations.doc("supabase_setup").delete().catch(() => undefined),
            ]);

            return NextResponse.json({ ok: true });
        },
        { csrf: true, methods: ["POST"] },
    );
}
