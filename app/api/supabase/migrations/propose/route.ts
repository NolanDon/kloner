import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { getAdminDb } from "../../../_lib/auth";
import { getSupabaseIntegration, isLikelyDestructiveSql } from "../_lib";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const sql = typeof body?.sql === "string" ? body.sql : "";
            const message = typeof body?.message === "string" ? body.message : "";
            const appId = typeof body?.appId === "string" ? body.appId.trim() : "";

            if (!sql.trim()) {
                return NextResponse.json({ ok: false, error: "Missing sql" }, { status: 400 });
            }

            if (!appId) {
                return NextResponse.json({ ok: false, error: "Missing appId" }, { status: 400 });
            }

            const integration = await getSupabaseIntegration(uid, appId);
            if (!integration?.projectId) {
                return NextResponse.json(
                    { ok: false, error: "Supabase is not connected" },
                    { status: 400 }
                );
            }

            const destructive = Boolean(body?.destructive) || isLikelyDestructiveSql(sql);
            const proposalId = crypto.randomUUID();

            const db = getAdminDb();
            const proposalRef = db
                .collection("kloner_users")
                .doc(uid)
                .collection("kloner_apps")
                .doc(appId)
                .collection("integrations")
                .doc("supabase")
                .collection("migration_proposals")
                .doc(proposalId);

            await proposalRef.set({
                proposalId,
                sql,
                message,
                destructive,
                status: "PENDING",
                createdAt: new Date(),
            });

            return NextResponse.json({
                ok: true,
                proposalId,
                destructive,
                confirmPhrase: destructive ? `APPLY ${proposalId}` : `APPLY ${proposalId}`,
            });
        },
        { csrf: true, methods: ["POST"] }
    );
}
