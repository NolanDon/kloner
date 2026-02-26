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
            const requestAppId = typeof body?.appId === "string" ? body.appId.trim() : "";

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

            // Enforce 1:1 binding: only allow disconnecting the integration bound to this specific app.
            if (requestAppId) {
                const existingSnap = await integrations.doc("supabase").get();
                if (existingSnap.exists) {
                    const existingData = existingSnap.data() as any;
                    const storedBoundAppId = typeof existingData?.boundAppId === "string" && existingData.boundAppId.trim()
                        ? existingData.boundAppId.trim()
                        : null;
                    if (storedBoundAppId && storedBoundAppId !== requestAppId) {
                        return NextResponse.json(
                            { ok: false, error: "This Supabase connection belongs to a different Kloner project and cannot be disconnected from here." },
                            { status: 403 },
                        );
                    }
                }
            }

            await Promise.all([
                integrations.doc("supabase").delete().catch(() => undefined),
                integrations.doc("supabase_setup").delete().catch(() => undefined),
            ]);

            return NextResponse.json({ ok: true });
        },
        { csrf: true, methods: ["POST"] },
    );
}
