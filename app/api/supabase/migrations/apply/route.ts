import { NextRequest, NextResponse } from "next/server";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { getAdminDb } from "../../../_lib/auth";
import { getSupabaseIntegration, getSupabaseAccessToken, isLikelyDestructiveSql } from "../_lib";

export const runtime = "nodejs";

type ParsedSqlError = {
    sqlState: string | null;
    relationName: string | null;
};

function parseSqlErrorDetails(raw: string): ParsedSqlError {
    const text = String(raw || "");
    const stateMatch = text.match(/ERROR:\s*([0-9A-Z]{5})\b/i);
    const relationMatch = text.match(/relation\s+"([^"]+)"\s+does\s+not\s+exist/i);

    return {
        sqlState: stateMatch ? String(stateMatch[1]).toUpperCase() : null,
        relationName: relationMatch ? String(relationMatch[1]) : null,
    };
}

async function runSupabaseSql(params: {
    accessToken: string;
    projectId: string;
    sql: string;
}): Promise<{ ok: boolean; result?: any; error?: string }> {
    const res = await fetch(`https://api.supabase.com/v1/projects/${params.projectId}/database/query`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${params.accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: params.sql }),
        signal: AbortSignal.timeout(60_000),
    });

    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) {
        const message = (json as any)?.message || (json as any)?.error || `Supabase query failed (${res.status})`;
        return { ok: false, error: message };
    }

    return { ok: true, result: json };
}

export async function POST(req: NextRequest) {
    return requireSessionAndMaybeCsrf(
        req,
        async ({ uid, req: authedReq }) => {
            const body = await authedReq.json().catch(() => ({} as any));
            const proposalId = typeof body?.proposalId === "string" ? body.proposalId : "";
            const confirm = typeof body?.confirm === "string" ? body.confirm : "";
            const appId = typeof body?.appId === "string" ? body.appId.trim() : "";

            if (!proposalId) {
                return NextResponse.json({ ok: false, error: "Missing proposalId" }, { status: 400 });
            }

            if (!appId) {
                return NextResponse.json({ ok: false, error: "Missing appId" }, { status: 400 });
            }

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

            const proposalSnap = await proposalRef.get();
            if (!proposalSnap.exists) {
                return NextResponse.json({ ok: false, error: "Proposal not found" }, { status: 404 });
            }

            const proposal = proposalSnap.data() as any;
            if (proposal?.status === "APPLIED") {
                return NextResponse.json({ ok: true, alreadyApplied: true });
            }

            const sql = typeof proposal?.sql === "string" ? proposal.sql : "";
            const destructive = Boolean(proposal?.destructive) || isLikelyDestructiveSql(sql);

            const expectedConfirm = `APPLY ${proposalId}`;
            if (confirm !== expectedConfirm) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: destructive
                            ? `Destructive migration. Set confirm to exactly: ${expectedConfirm}`
                            : `Set confirm to exactly: ${expectedConfirm}`,
                    },
                    { status: 400 }
                );
            }

            const integration = await getSupabaseIntegration(uid, appId);
            if (!integration?.projectId) {
                return NextResponse.json({ ok: false, error: "Supabase is not connected" }, { status: 400 });
            }

            let accessToken: string;
            try {
                accessToken = getSupabaseAccessToken(integration);
            } catch {
                return NextResponse.json(
                    {
                        ok: false,
                        error:
                            "Supabase is connected without an OAuth access token. To apply migrations, connect via \"Create New Supabase Project\" (OAuth).",
                    },
                    { status: 400 }
                );
            }

            await proposalRef.update({ status: "APPLYING", applyingAt: new Date() });

            const result = await runSupabaseSql({
                accessToken,
                projectId: integration.projectId,
                sql,
            });

            if (!result.ok) {
                const details = parseSqlErrorDetails(result.error || "");
                const isMissingRelation = details.sqlState === "42P01" || Boolean(details.relationName);
                await proposalRef.update({ status: "FAILED", failedAt: new Date(), error: result.error || "Unknown error" });
                return NextResponse.json(
                    {
                        ok: false,
                        code: isMissingRelation ? "SUPABASE_RELATION_MISSING" : "SUPABASE_MIGRATION_APPLY_FAILED",
                        errorCode: details.sqlState,
                        relationName: details.relationName,
                        canRegenerateMigration: isMissingRelation,
                        error: isMissingRelation
                            ? `Database update failed because ${details.relationName || "a required table"} was not found. We can regenerate the update for your current schema.`
                            : result.error || "Migration failed",
                    },
                    { status: 502 }
                );
            }

            await proposalRef.update({
                status: "APPLIED",
                appliedAt: new Date(),
                supabaseResult: result.result ?? null,
            });

            return NextResponse.json({
                ok: true,
                postApplyActions: {
                    refreshAppFiles: true,
                    regenerateDataAccess: true,
                    restartPreview: true,
                },
            });
        },
        { csrf: true, methods: ["POST"] }
    );
}
